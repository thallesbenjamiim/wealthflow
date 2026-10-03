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
  const brInvestedEur = (portfolioData.mxrf11 + (portfolioData.hglg11 || 0) + (portfolioData.knri11 || 0) + ipcaValor() + portfolioData.selic) / rate;
  const cashEur = portfolioData.caixinha / rate;
  const intlEur = portfolioData.vwce + portfolioData.euna;
  // Usa a cotação ao vivo do BTC quando já buscada nesta sessão — igual ao Dashboard
  const btcValueEur = btcPriceEur ? portfolioData.bitcoin * btcPriceEur : (portfolioData.bitcoin_invested_eur || 0);
  const totalEur = brInvestedEur + intlEur + cashEur + btcValueEur;
  const brPct = totalEur > 0 ? (brInvestedEur + cashEur) / totalEur : 0;

  if (totalEur > 0 && (brPct >= 0.75 || brPct <= 0.15)) {
    const desc = brPct >= 0.75
      ? `${(brPct*100).toFixed(0)}% da carteira está em Brasil/Caixa — considere reforçar Internacional (VWCE/EUNA) no próximo aporte. Pergunte ao Assistente (modo 🛡️ Risco) antes de agir.`
      : `Só ${(brPct*100).toFixed(0)}% da carteira está em Brasil/Caixa, abaixo da referência 60/40. Pergunte ao Assistente (modo 🛡️ Risco) antes de agir.`;
    alerts.push({ type: 'red', icon: '⚖️', title: 'AÇÃO SUGERIDA: Carteira desequilibrada', desc, action: true });
    actionableCount++;
  }

  // Gatilho de concentração excessiva numa única posição — mesmo limiar de 30% usado no WealthFlow Score (Risco)
  const positions = [
    { name: 'MXRF11', eur: portfolioData.mxrf11 / rate },
    { name: 'HGLG11', eur: (portfolioData.hglg11 || 0) / rate },
    { name: 'KNRI11', eur: (portfolioData.knri11 || 0) / rate },
    { name: 'Tesouro IPCA+', eur: ipcaValor() / rate },
    { name: 'Tesouro Selic + Caixinha', eur: (portfolioData.selic + portfolioData.caixinha) / rate },
    { name: 'VWCE', eur: portfolioData.vwce },
    { name: 'EUNA', eur: portfolioData.euna },
    { name: 'Bitcoin', eur: btcValueEur }
  ];
  const positionsTotal = positions.reduce((s, p) => s + p.eur, 0) || 1;
  const maxPosition = positions.reduce((max, p) => p.eur > max.eur ? p : max, positions[0]);
  const maxWeightPct = (maxPosition.eur / positionsTotal) * 100;

  if (totalEur > 0 && maxWeightPct > 30) {
    alerts.push({ type: 'red', icon: '🎯', title: `AÇÃO SUGERIDA: Concentração alta em ${maxPosition.name}`, desc: `${maxPosition.name} representa ${maxWeightPct.toFixed(0)}% da carteira — acima do limite saudável de 30%. Pergunte ao Assistente (modo 🛡️ Risco) antes do próximo aporte.`, action: true });
    actionableCount++;
  }

  // Gatilho Selic — só avalia com o dado real do Banco Central; a estimativa fixa nunca dispara gatilho
  if (marketRates.selicEstimada) {
    // informativo, adicionado abaixo junto dos demais
  } else if (selicVal < 7) {
    alerts.push({ type: 'red', icon: '🚨', title: 'AÇÃO SUGERIDA: Selic abaixo de 7%', desc: 'Realocar gradualmente do Brasil para Internacional (5-10% por vez, 60/40 → 50/50). Pergunte ao Assistente (modo 🛡️ Risco) antes de agir.', action: true });
    actionableCount++;
  } else if (selicVal < 10) {
    alerts.push({ type: 'amber', icon: '🔔', title: 'AÇÃO SUGERIDA: Selic abaixo de 10%', desc: 'Migrar o aporte de renda fixa para FIIs e Internacional. Pergunte ao Assistente antes de agir.', action: true });
    actionableCount++;
  }

  // Caixinha parada há muito tempo sem destino definido
  if (portfolioData.caixinha > 150) {
    alerts.push({ type: 'amber', icon: '🔔', title: 'AÇÃO SUGERIDA: Caixinha com saldo a decidir', desc: `R$${fmtNum(portfolioData.caixinha)} aguardando destino. Decida no próximo aporte (dia ${profileData.diaAporte}): HGLG11, KNRI11, MXRF11 ou IPCA+.`, action: true });
    actionableCount++;
  }

  // Lembrete do aporte mensal — só se ainda não aportou este mês (Caixinha/Reserva não são aporte de investimento)
  const aportouEsteMes = (docs || []).some(d => monthKeyOf(d.data) === mesKey && !['Dividendo', 'Reserva', 'Caixinha'].includes(d.ativo));
  if (diaHoje >= 26 && !aportouEsteMes) {
    alerts.push({ type: 'amber', icon: '📅', title: 'AÇÃO SUGERIDA: Aporte do mês chegando', desc: `O aporte de €${profileData.aporteMensalEur} é sempre dia ${profileData.diaAporte} e ainda não há registro em ${hoje.toLocaleDateString('pt-BR', { month: 'long' })}.`, action: true });
    actionableCount++;
  }

  const badgeDesk = document.getElementById('alertCount');
  badgeDesk.textContent = actionableCount;
  badgeDesk.style.display = actionableCount > 0 ? '' : 'none';
  const badgeMobile = document.getElementById('alertCountMobile');
  if (badgeMobile) {
    badgeMobile.textContent = actionableCount;
    badgeMobile.style.display = actionableCount > 0 ? '' : 'none';
  }

  // ─── SEPARADOR ───
  if (actionableCount > 0) {
    alerts.push({ type: 'divider', title: '— Informativos abaixo, sem ação necessária —' });
  } else {
    alerts.unshift({ type: 'green', icon: '✅', title: 'Nenhuma ação necessária agora', desc: 'Carteira dentro do plano. Os gatilhos só disparam quando Selic, câmbio ou mercado saírem da faixa definida na Constituição do WealthFlow.' });
  }

  // ─── INFORMATIVOS (situação, sem exigir ação) ───
  alerts.push({ type: 'green', icon: '✅', title: 'Dupla residência fiscal confirmada', desc: 'Brasil e Irlanda — situação regularizada.' });
  if (primeiroDeemedDisposal) {
    const anoDD = primeiroDeemedDisposal.getFullYear();
    alerts.push({ type: 'blue', icon: '📅', title: `Deemed disposal — ${primeiroDeemedDisposal.toLocaleDateString('pt-BR')}`, desc: `Exit Tax 38% sobre VWCE e EUNA, 8 anos após cada compra. A partir de ${anoDD - 1}, planejar liquidez — veja a estimativa em Carteira → Exit Tax.` });
  }

  if (marketRates.selicEstimada) {
    alerts.push({ type: 'blue', icon: '📡', title: 'Selic do dia indisponível', desc: `O Banco Central não respondeu — o app está usando a estimativa ${selicLabel()} e os gatilhos de Selic ficam pausados até o dado real voltar.` });
  }

  if (portfolioData.dividendos > 0) {
    const pagantes = [['MXRF11', portfolioData.mxrf11_cotas], ['HGLG11', portfolioData.hglg11_cotas], ['KNRI11', portfolioData.knri11_cotas]]
      .filter(([, c]) => (c || 0) > 0).map(([n]) => n);
    const quem = pagantes.length ? `${pagantes.join(', ')} gerando renda passiva mensal.` : '';
    alerts.push({ type: 'green', icon: '💚', title: 'Dividendos ativos', desc: `Total recebido: R$${fmtNum(portfolioData.dividendos)}. ${quem}` });
  }

  if (portfolioData.hglg11_cotas && portfolioData.hglg11_cotas > 0) {
    alerts.push({ type: 'green', icon: '🏭', title: 'HGLG11 ativo na carteira', desc: `${fmtNum(portfolioData.hglg11_cotas, 0)} cotas de FII de logística.` });
  } else {
    alerts.push({ type: 'blue', icon: '🎯', title: 'Próximo objetivo: HGLG11', desc: `Programado para o próximo aporte mensal (dia ${profileData.diaAporte}).` });
  }

  if (portfolioData.knri11_cotas && portfolioData.knri11_cotas > 0) {
    alerts.push({ type: 'green', icon: '🏛️', title: 'KNRI11 ativo na carteira', desc: `${fmtNum(portfolioData.knri11_cotas, 0)} cotas de FII híbrido.` });
  } else {
    alerts.push({ type: 'blue', icon: '🎯', title: 'Próximo objetivo: KNRI11', desc: `Programado para o próximo aporte mensal (dia ${profileData.diaAporte}).` });
  }

  // Janela típica de pagamento do MXRF11 (~dia 15) — informativo, só se ainda não registrou dividendo no mês
  if (diaHoje >= 12 && diaHoje <= 18 && (portfolioData.mxrf11_cotas || 0) > 0) {
    const jaRegistrou = (docs || []).some(d => d.ativo === 'Dividendo' && monthKeyOf(d.data) === mesKey);
    if (!jaRegistrou) {
      const est = portfolioData.mxrf11_cotas * divPerShare.mxrf11;
      alerts.push({ type: 'blue', icon: '💰', title: 'Dividendo do MXRF11 esperado', desc: `O MXRF11 costuma pagar nesta janela (~R$${fmtNum(est)} com suas ${fmtNum(portfolioData.mxrf11_cotas, 0)} cotas). Quando cair no Nubank, registre em Registrar Aporte → Dividendo.` });
    }
  }

  document.getElementById('alertsList').innerHTML = alerts.map(a => {
    if (a.type === 'divider') {
      return `<div style="text-align:center;padding:10px 0;font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">${a.title}</div>`;
    }
    return `<div class="alert-card ${a.type}">
      <div class="alert-icon">${a.icon}</div>
      <div><div class="alert-title">${a.title}</div><div class="alert-desc">${a.desc}</div></div>
    </div>`;
  }).join('');

  return actionableCount;
}

