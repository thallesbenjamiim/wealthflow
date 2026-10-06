// WealthFlow — Alertas: lembretes e avisos.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).
// O app acompanha a carteira, não diz o que fazer: aqui entram só os lembretes do que falta
// registrar (contam no sino) e avisos informativos (não contam). O 60/40 aparece no selo do Início.

// ─────────────────────────────────────────
// ALERTAS
// ─────────────────────────────────────────
async function renderAlertas() {
  const docs = await loadAportesForEvo().catch(() => []);
  const hoje = new Date();
  const diaHoje = hoje.getDate();
  const mesKey = currentMonthKey();
  const rate = getRate();
  primeiroDeemedDisposal = calcularLotesExitTax(docs, rate)[0]?.disposal || primeiroDeemedDisposal;
  const lembretes = []; // contam no sino
  const avisos = [];    // só informam

  // ─── LEMBRETES ───

  // Aporte do mês — some quando houver aporte registrado no mês (regra única: ehAporte, em ativos.js)
  const aportouEsteMes = (docs || []).some(d => monthKeyOf(d.data) === mesKey && ehAporte(d));
  if (diaHoje >= 26 && !aportouEsteMes) {
    lembretes.push({ type: 'amber', icon: 'calendar', title: 'Aporte do mês chegando', desc: `O aporte de €${profileData.aporteMensalEur} é sempre dia ${profileData.diaAporte} e ainda não há registro em ${hoje.toLocaleDateString('pt-BR', { month: 'long' })}.` });
  }

  // Dividendos do mês: os três FIIs pagam dia 14 ou 15 (confirmado pelo Thales). O aviso aparece
  // do dia 11 em diante, com o total estimado (último dividendo por cota × cotas), e some quando
  // os dividendos do mês forem registrados — se registrar só parte, mostra quanto ainda falta.
  // O valor real costuma variar um pouco do estimado: o botão "Já registrei tudo" dispensa o aviso no mês
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
      lembretes.push({
        type: 'green', icon: 'coins',
        title: registrado > 0
          ? `Dividendos do mês: faltam ~R$${fmtNum(falta)} para registrar`
          : (antes ? `Dividendos caem dia 14–15: ~R$${fmtNum(estimado)}` : `Dividendos do mês: ~R$${fmtNum(estimado)} para registrar`),
        desc: `${detalhe}.${registrado > 0 ? ` Já registrado: R$${fmtNum(registrado)}.` : ''} Estimativa pelo último dividendo pago por cada FII. Quando cair no Nubank, registre em Registrar aporte → Dividendo.`,
        botao: registrado > 0 ? { texto: 'Já registrei tudo', acao: 'dispensarAvisoDividendos()' } : null
      });
    }
  }

  // ─── AVISOS ───
  if (primeiroDeemedDisposal) {
    const anoDD = primeiroDeemedDisposal.getFullYear();
    avisos.push({ type: 'blue', icon: 'calendar', title: `Deemed disposal — ${primeiroDeemedDisposal.toLocaleDateString('pt-BR')}`, desc: `Exit Tax 38% sobre VWCE e EUNA, 8 anos após cada compra. A partir de ${anoDD - 1}, planejar liquidez — veja a estimativa em Carteira → Exit Tax.` });
  }
  if (marketRates.selicEstimada) {
    avisos.push({ type: 'blue', icon: 'info', title: 'Selic do dia indisponível', desc: `O Banco Central não respondeu — o app está usando a estimativa ${selicLabel()} até o dado do dia voltar.` });
  }

  // O sino conta só os lembretes
  const badgeDesk = document.getElementById('alertCount');
  badgeDesk.textContent = lembretes.length;
  badgeDesk.hidden = lembretes.length === 0;
  const badgeMobile = document.getElementById('alertCountMobile');
  if (badgeMobile) {
    badgeMobile.textContent = lembretes.length;
    badgeMobile.hidden = lembretes.length === 0;
  }

  const card = a => `<div class="alert-card ${a.type}">
      <div class="alert-icon">${icon(a.icon)}</div>
      <div><div class="alert-title">${a.title}</div><div class="alert-desc">${a.desc}</div>${a.botao ? `<button class="btn btn-ghost btn-sm alert-btn" onclick="${a.botao.acao}">${a.botao.texto}</button>` : ''}</div>
    </div>`;
  const semLembretes = { type: 'green', icon: 'check-circle', title: 'Nenhum lembrete agora', desc: 'Quando chegar o dia do aporte ou os dividendos do mês, o aviso aparece aqui.' };
  document.getElementById('alertsList').innerHTML =
    `<div class="alert-section">Lembretes${lembretes.length ? ` <span class="count">${lembretes.length}</span>` : ''}</div>` +
    (lembretes.length ? lembretes : [semLembretes]).map(card).join('') +
    (avisos.length ? `<div class="alert-section">Avisos</div>` + avisos.map(card).join('') : '');

  return lembretes.length;
}


function dispensarAvisoDividendos() {
  try { localStorage.setItem('wf_div_ok', currentMonthKey()); } catch {}
  renderAlertas();
}
