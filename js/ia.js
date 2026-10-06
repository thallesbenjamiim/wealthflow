// WealthFlow — Insight do dia, resumo do mês e análise da carteira com IA.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).
// O app acompanha a carteira: a IA descreve e explica os números, nunca diz o que comprar ou vender.

// ─────────────────────────────────────────
// FASE 3 — INTELIGÊNCIA EMBUTIDA
// ─────────────────────────────────────────

// 💡 Insight do dia — 1 chamada de IA por dia, refeita quando você registra um aporte; cache no aparelho
const INSIGHT_VERSAO = 3; // mude ao alterar o prompt para invalidar o cache dos aparelhos
async function loadDailyInsight() {
  const card = document.getElementById('insight-card');
  const txt = document.getElementById('insight-text');
  if (!card || !txt) return;
  if (!apiKey && !geminiKey) { card.style.display = 'none'; return; }

  const today = new Date().toISOString().slice(0, 10);
  const KEY = 'wf_daily_insight';
  // O que você registrou de verdade no mês (não o valor do plano) — quando muda, o insight é refeito
  const mes = resumoAportesDoMes(await loadAportesForEvo().catch(() => []), currentMonthKey(), getRate());
  const aportesMes = mes.totalEur > 0
    ? `€${fmtNum(mes.totalEur)} (${mes.brPct}% Brasil / ${mes.intlPct}% Internacional)`
    : 'nenhum ainda';
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    // O cache vale só para o mesmo dia, a mesma versão do prompt, a mesma Selic e os mesmos aportes
    // do mês — se algo disso mudar (ex.: Selic estimada → real, aporte novo), o insight é refeito
    if (c && c.date === today && c.text && c.v === INSIGHT_VERSAO && c.selic === selicLabel() && c.aportes === aportesMes) { txt.textContent = c.text; card.style.display = 'flex'; return; }
  } catch {}

  try {
    const prompt = `Gere UM insight útil de HOJE para o investidor, com base no perfil e nos indicadores atuais. Máximo 35 palavras, texto corrido, direto, sem saudação e sem repetir números óbvios da carteira. APORTES REGISTRADOS ESTE MÊS: ${aportesMes}; o plano é €${profileData.aporteMensalEur}/mês — se falar do aporte, use o valor REAL registrado, não o do plano. Temas possíveis: o aporte deste mês, dividendo esperado, proximidade do dia de aporte (dia ${profileData.diaAporte}) se ainda não houve aporte no mês, câmbio do dia, divisão 60/40. É uma OBSERVAÇÃO, não uma recomendação: NUNCA diga em qual ativo ou lado (Brasil/Internacional) aportar, nem use "priorize", "compre" ou "invista em". Use exatamente os indicadores do perfil (não invente Selic, câmbio ou IPCA).`;
    const insight = await callAI(getAssistantSystem() + '\n\n' + getProfile(), [{ role: 'user', content: prompt }], 120);
    localStorage.setItem(KEY, JSON.stringify({ date: today, text: insight, v: INSIGHT_VERSAO, selic: selicLabel(), aportes: aportesMes }));
    txt.textContent = insight;
    card.style.display = 'flex';
  } catch (e) { card.style.display = 'none'; }
}

// 📄 Resumo do mês anterior — extrato inteligente, gerado 1x quando o mês vira
async function loadMonthlySummary() {
  const card = document.getElementById('month-summary-card');
  if (!card) return;
  if (!apiKey && !geminiKey) return;

  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = prev.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const KEY = 'wf_month_summary';

  const show = text => {
    document.getElementById('ms-tag').textContent = monthLabel;
    document.getElementById('ms-text').innerHTML = mdLite(text);
    card.style.display = '';
  };

  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && c.month === prevKey && c.text) { show(c.text); return; }
  } catch {}

  const docs = await loadAportesForEvo();
  const doMes = (docs || []).filter(d => monthKeyOf(d.data) === prevKey);
  // Separa o que é aporte (regra única: ehAporte, em ativos.js) do resto — Bitcoin, dividendo e
  // Reserva. Depósitos antigos na Caixinha ficam fora: o dinheiro dela conta quando vira a compra de um ativo
  const aportes = doMes.filter(ehAporte);
  const outros = doMes.filter(d => !ehAporte(d) && d.ativo !== 'Caixinha');
  if (!aportes.length && !outros.length) return; // sem movimentos no mês anterior — nada a resumir

  const fmtDoc = d => `${d.ativo}${d.ativo === 'Reserva' ? (d.tipo === 'retirada' ? ' (retirada)' : ' (depósito)') : ''} ${d.moeda === 'EUR' ? '€' : 'R$'}${d.valor}${d.qtd ? ' (' + d.qtd + (d.ativo === 'Bitcoin' ? ' BTC' : ' cotas') + ')' : ''}`;
  const m = resumoAportesDoMes(docs, prevKey, getRate());
  try {
    const prompt = `Resuma o mês de ${monthLabel} do investidor em UM parágrafo de no máximo 70 palavras, tom de extrato inteligente. APORTES: ${aportes.length ? `${aportes.map(fmtDoc).join('; ')} — total €${fmtNum(m.totalEur)} (${m.brPct}% Brasil / ${m.intlPct}% Internacional)` : 'nenhum'}. OUTROS MOVIMENTOS (não contam como aporte): ${outros.length ? outros.map(fmtDoc).join('; ') : 'nenhum'}. Compare o total aportado com o plano de €${profileData.aporteMensalEur}/mês (€${profileData.aporteBrEur} Brasil + €${profileData.aporteIntlEur} Internacional). Texto corrido, sem listas, sem saudação e sem recomendar compra ou venda.`;
    const text = await callAI(getAssistantSystem() + '\n\n' + getProfile(), [{ role: 'user', content: prompt }], 200);
    localStorage.setItem(KEY, JSON.stringify({ month: prevKey, text }));
    show(text);
  } catch (e) {}
}

// 🔍 Análise da carteira — sob demanda e descritiva: mostra o que os números dizem, sem recomendar
const ANALISE_VERSAO = 2; // análises salvas antes desta versão (que sugeriam aporte) não são reexibidas
async function analyzePortfolio() {
  if (!apiKey && !geminiKey) {
    showPage('config');
    showToast('⚠️ Configure sua chave API primeiro!');
    return;
  }
  const btn = document.getElementById('analyzeBtn');
  const card = document.getElementById('analysis-card');
  const txtEl = document.getElementById('analysis-text');
  btn.disabled = true;
  btn.innerHTML = icon('search') + ' Analisando sua carteira…';
  try {
    const prompt = 'Faça uma ANÁLISE DESCRITIVA da carteira: a divisão Brasil/Internacional comparada ao 60/40 do plano, o peso de cada ativo, quanto cada um rendeu em relação ao que foi aportado (use os números de RESULTADO do perfil) e os dividendos. Descreva o que os números mostram; NÃO sugira compra, venda nem onde aportar. Até ~250 palavras, em parágrafos curtos, sem títulos e sem listas com asteriscos.';
    const text = await callAI(getAssistantSystem() + '\n\n' + getProfile(), [{ role: 'user', content: prompt }], 900);
    txtEl.innerHTML = mdLite(text);
    document.getElementById('analysis-date').textContent = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    card.style.display = '';
    localStorage.setItem('wf_last_analysis', JSON.stringify({ ts: Date.now(), text, v: ANALISE_VERSAO }));
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    showToast('❌ ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon('search') + ' Analisar carteira com IA';
  }
}

// Restaura a última análise salva ao abrir a Carteira
function restoreLastAnalysis() {
  try {
    const c = JSON.parse(localStorage.getItem('wf_last_analysis'));
    if (!c || !c.text || c.v !== ANALISE_VERSAO) return;
    document.getElementById('analysis-text').innerHTML = mdLite(c.text);
    document.getElementById('analysis-date').textContent = new Date(c.ts).toLocaleDateString('pt-BR');
    document.getElementById('analysis-card').style.display = '';
  } catch {}
}
