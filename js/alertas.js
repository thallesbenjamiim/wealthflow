// WealthFlow — Alertas e gatilhos do plano.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// ALERTAS
// ─────────────────────────────────────────
async function renderAlertas() {
  const docs = await loadAportesForEvo().catch(() => []);
  const hoje = new Date();
  const diaHoje = hoje.getDate();
  const mesKey = currentMonthKey();
  const selicVal = marketRates.selic ?? 13.75;
  const rate = getRate();
  primeiroDeemedDisposal = calcularLotesExitTax(docs, rate)[0]?.disposal || primeiroDeemedDisposal;
  const alerts = [];
  let actionableCount = 0; // só conta alertas que exigem ação REAL do investidor

  // ─── GATILHOS ACIONÁVEIS (definidos na Constituição do WealthFlow) ───

  // Gatilho de desequilíbrio Brasil/Internacional — mesma faixa 15%-75% usada no badge do Dashboard
  const brInvestedEur = (somaAtivos(ATIVOS_BR) + ipcaValor() + portfolioData.selic) / rate;
  const cashEur = portfolioData.caixinha / rate;
  const intlEur = somaAtivos(ATIVOS_INTL);
  // Usa a cotação ao vivo do BTC quando já buscada nesta sessão — igual ao Dashboard
  const btcValueEur = btcPriceEur ? portfolioData.bitcoin * btcPriceEur : (portfolioData.bitcoin_invested_eur || 0);
  const totalEur = brInvestedEur + intlEur + cashEur + btcValueEur;
  const brPct = totalEur > 0 ? (brInvestedEur + cashEur) / totalEur : 0;

  if (totalEur > 0 && (brPct >= 0.75 || brPct <= 0.15)) {
    const desc = brPct >= 0.75
      ? `${(brPct*100).toFixed(0)}% da carteira está em Brasil/Caixa — considere reforçar Internacional (VWCE/EUNA) no próximo aporte. Pergunte ao Assistente (tom Risco) antes de agir.`
      : `Só ${(brPct*100).toFixed(0)}% da carteira está em Brasil/Caixa, abaixo da referência 60/40. Pergunte ao Assistente (tom Risco) antes de agir.`;
    alerts.push({ type: 'red', icon: 'scale', title: 'Carteira desequilibrada', desc, action: true });
    actionableCount++;
  }

  // Gatilho de concentração excessiva numa única posição — mesmo limiar de 30% usado no WealthFlow Score (Risco)
  const positions = [
    ...ATIVOS_BR.map(a => ({ name: a.id, eur: (portfolioData[a.key] || 0) / rate })),
    { name: 'Tesouro IPCA+', eur: ipcaValor() / rate },
    { name: 'Tesouro Selic + Caixinha', eur: (portfolioData.selic + portfolioData.caixinha) / rate },
    ...ATIVOS_INTL.map(a => ({ name: a.id, eur: portfolioData[a.key] || 0 })),
    { name: 'Bitcoin', eur: btcValueEur }
  ];
  const positionsTotal = positions.reduce((s, p) => s + p.eur, 0) || 1;
  const maxPosition = positions.reduce((max, p) => p.eur > max.eur ? p : max, positions[0]);
  const maxWeightPct = (maxPosition.eur / positionsTotal) * 100;

  if (totalEur > 0 && maxWeightPct > 30) {
    alerts.push({ type: 'red', icon: 'pie', title: `Concentração alta em ${maxPosition.name}`, desc: `${maxPosition.name} representa ${maxWeightPct.toFixed(0)}% da carteira — acima do limite saudável de 30%. Pergunte ao Assistente (tom Risco) antes do próximo aporte.`, action: true });
    actionableCount++;
  }

  // Gatilho Selic — só avalia com o dado real do Banco Central; a estimativa fixa nunca dispara gatilho
  if (marketRates.selicEstimada) {
    // informativo, adicionado abaixo junto dos demais
  } else if (selicVal < 7) {
    alerts.push({ type: 'red', icon: 'alert', title: 'Selic abaixo de 7%', desc: 'Realocar gradualmente do Brasil para Internacional (5-10% por vez, 60/40 → 50/50). Pergunte ao Assistente (tom Risco) antes de agir.', action: true });
    actionableCount++;
  } else if (selicVal < 10) {
    alerts.push({ type: 'amber', icon: 'bell', title: 'Selic abaixo de 10%', desc: 'Migrar o aporte de renda fixa para FIIs e Internacional. Pergunte ao Assistente antes de agir.', action: true });
    actionableCount++;
  }

  // Caixinha parada há muito tempo sem destino definido
  if (portfolioData.caixinha > 150) {
    alerts.push({ type: 'amber', icon: 'coins', title: 'Caixinha com saldo a decidir', desc: `R$${fmtNum(portfolioData.caixinha)} aguardando destino. Decida no próximo aporte (dia ${profileData.diaAporte}): ${ATIVOS_BR.map(a => a.id).join(', ')} ou IPCA+.`, action: true });
    actionableCount++;
  }

  // Lembrete do aporte mensal — só se ainda não aportou este mês (Caixinha/Reserva não são aporte de investimento)
  const aportouEsteMes = (docs || []).some(d => monthKeyOf(d.data) === mesKey && !['Dividendo', 'Reserva', 'Caixinha'].includes(d.ativo));
  if (diaHoje >= 26 && !aportouEsteMes) {
    alerts.push({ type: 'amber', icon: 'calendar', title: 'Aporte do mês chegando', desc: `O aporte de €${profileData.aporteMensalEur} é sempre dia ${profileData.diaAporte} e ainda não há registro em ${hoje.toLocaleDateString('pt-BR', { month: 'long' })}.`, action: true });
    actionableCount++;
  }

  // Dividendos do mês: os três FIIs pagam dia 14 ou 15 (confirmado pelo Thales). O aviso aparece
  // do dia 11 em diante, com o total estimado (último dividendo por cota × cotas), e some quando
  // os dividendos do mês forem registrados — se registrar só parte, mostra quanto ainda falta.
  // O valor real costuma variar um pouco do estimado: o botão "Já registrei tudo" dispensa o aviso no mês
  let divAlert = null;
  let dispensado = null;
  try { dispensado = localStorage.getItem('wf_div_ok'); } catch {}
  if (diaHoje >= 11 && dispensado !== mesKey) {
    const fiis = ATIVOS_DIVIDENDOS.map(a => [a.id, a.key])
      .map(([nome, k]) => ({ nome, cotas: portfolioData[k + '_cotas'] || 0, porCota: divPerShare[k] || 0 }))
      .filter(f => f.cotas > 0 && f.porCota > 0);
    const estimado = fiis.reduce((s, f) => s + f.cotas * f.porCota, 0);
    const registrado = (docs || [])
      .filter(d => d.ativo === 'Dividendo' && monthKeyOf(d.data) === mesKey)
      .reduce((s, d) => s + (parseFloat(d.valor) || 0) * (d.moeda === 'EUR' ? rate : 1), 0);
    const falta = estimado - registrado;
    if (estimado > 0 && falta > estimado * 0.05) {
      const detalhe = fiis.map(f => `${f.nome}: R$${fmtNum(f.porCota)} × ${fmtNum(f.cotas, 0)} = R$${fmtNum(f.cotas * f.porCota)}`).join(' · ');
      const antes = diaHoje < 14;
      divAlert = {
        type: 'green', icon: 'coins',
        title: registrado > 0
          ? `Dividendos do mês: faltam ~R$${fmtNum(falta)} para registrar`
          : (antes ? `Dividendos caem dia 14–15: ~R$${fmtNum(estimado)}` : `Dividendos do mês: ~R$${fmtNum(estimado)} para registrar`),
        desc: `${detalhe}.${registrado > 0 ? ` Já registrado: R$${fmtNum(registrado)}.` : ''} Estimativa pelo último dividendo pago por cada FII. Quando cair no Nubank, registre em Registrar aporte → Dividendo.`,
        botao: registrado > 0 ? { texto: 'Já registrei tudo', acao: 'dispensarAvisoDividendos()' } : null
      };
    }
  }

  const contagemSino = actionableCount + (divAlert ? 1 : 0);
  const badgeDesk = document.getElementById('alertCount');
  badgeDesk.textContent = contagemSino;
  badgeDesk.hidden = contagemSino === 0;
  const badgeMobile = document.getElementById('alertCountMobile');
  if (badgeMobile) {
    badgeMobile.textContent = contagemSino;
    badgeMobile.hidden = contagemSino === 0;
  }

  // ─── SEPARADOR ───
  if (actionableCount > 0) {
    alerts.push({ type: 'divider', title: 'Informativos' });
  } else {
    alerts.unshift({ type: 'divider', title: 'Informativos' });
    alerts.unshift({ type: 'green', icon: 'check-circle', title: 'Nenhuma ação necessária agora', desc: 'Carteira dentro do plano. Os gatilhos só disparam quando Selic, câmbio ou mercado saírem da faixa definida na Constituição do WealthFlow.' });
  }

  // ─── INFORMATIVOS (situação, sem exigir ação) ───
  if (divAlert) alerts.push(divAlert);

  // WealthFlow Score: o card do Início mostra só os números; o porquê fica aqui.
  // Aparece quando algo está tirando pontos ou quando a nota mudou desde a última visita a Alertas.
  if (scoreAtual) {
    let visto = null;
    try { visto = JSON.parse(localStorage.getItem('wf_score_visto')); } catch {}
    const mudouDesdeVisto = visto && visto.total !== scoreAtual.total;
    const comMotivo = scoreAtual.itens.filter(i => i.motivos.length);
    if (comMotivo.length || mudouDesdeVisto) {
      const subiu = mudouDesdeVisto && scoreAtual.total > visto.total;
      alerts.push({
        type: mudouDesdeVisto ? (subiu ? 'green' : 'amber') : 'blue',
        icon: 'target',
        title: mudouDesdeVisto
          ? `WealthFlow Score ${subiu ? 'subiu' : 'caiu'}: ${visto.total} → ${scoreAtual.total}`
          : `WealthFlow Score ${scoreAtual.total}: o que está tirando pontos`,
        desc: comMotivo.length
          ? comMotivo.map(i => `<strong>${i.nome} ${i.valor}</strong> — ${i.motivos.join('; ')}.`).join('<br>')
          : 'Nada está tirando pontos agora.'
      });
    }
  }
  if (primeiroDeemedDisposal) {
    const anoDD = primeiroDeemedDisposal.getFullYear();
    alerts.push({ type: 'blue', icon: 'calendar', title: `Deemed disposal — ${primeiroDeemedDisposal.toLocaleDateString('pt-BR')}`, desc: `Exit Tax 38% sobre VWCE e EUNA, 8 anos após cada compra. A partir de ${anoDD - 1}, planejar liquidez — veja a estimativa em Carteira → Exit Tax.` });
  }

  if (marketRates.selicEstimada) {
    alerts.push({ type: 'blue', icon: 'info', title: 'Selic do dia indisponível', desc: `O Banco Central não respondeu — o app está usando a estimativa ${selicLabel()} e os gatilhos de Selic ficam pausados até o dado real voltar.` });
  }

  // Status da carteira (FII já comprado, total de dividendos) fica na Carteira — aqui só o que pede atenção.
  // "Próximo objetivo" aparece apenas para um FII acompanhado que ainda não foi comprado.
  ATIVOS.filter(a => a.classe === 'fii' && !(portfolioData[a.key + '_cotas'] > 0)).forEach(a => {
    alerts.push({ type: 'blue', icon: 'target', title: `Próximo objetivo: ${a.id}`, desc: `Programado para o próximo aporte mensal (dia ${profileData.diaAporte}).` });
  });

  // Sem nenhum informativo, não deixa o título "Informativos" sozinho no fim da lista
  if (alerts.length && alerts[alerts.length - 1].type === 'divider') alerts.pop();

  const cabecalho = actionableCount > 0
    ? `<div class="alert-section">Pedem sua atenção <span class="count">${actionableCount}</span></div>`
    : '';
  document.getElementById('alertsList').innerHTML = cabecalho + alerts.map(a => {
    if (a.type === 'divider') return `<div class="alert-section">${a.title}</div>`;
    return `<div class="alert-card ${a.type}${a.action ? ' action' : ''}">
      <div class="alert-icon">${icon(a.icon)}</div>
      <div><div class="alert-title">${a.title}${a.action ? '<span class="alert-badge">Ação sugerida</span>' : ''}</div><div class="alert-desc">${a.desc}</div>${a.botao ? `<button class="btn btn-ghost btn-sm alert-btn" onclick="${a.botao.acao}">${a.botao.texto}</button>` : ''}</div>
    </div>`;
  }).join('');

  return actionableCount;
}


function dispensarAvisoDividendos() {
  try { localStorage.setItem('wf_div_ok', currentMonthKey()); } catch {}
  renderAlertas();
}
