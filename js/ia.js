// WealthFlow — Insight do dia, resumo do mês e análise completa com IA.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// FASE 3 — INTELIGÊNCIA EMBUTIDA
// ─────────────────────────────────────────

// 💡 Insight do dia — 1 chamada de IA por dia, com cache no aparelho
const INSIGHT_VERSAO = 2; // mude ao alterar o prompt para invalidar o cache dos aparelhos
async function loadDailyInsight() {
  const card = document.getElementById('insight-card');
  const txt = document.getElementById('insight-text');
  if (!card || !txt) return;
  if (!apiKey && !geminiKey) { card.style.display = 'none'; return; }

  const today = new Date().toISOString().slice(0, 10);
  const KEY = 'wf_daily_insight';
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    // O cache vale só para o mesmo dia, a mesma versão do prompt e a mesma Selic — se os
    // indicadores mudarem (ex.: Selic estimada → real), o insight é refeito
    if (c && c.date === today && c.text && c.v === INSIGHT_VERSAO && c.selic === selicLabel()) { txt.textContent = c.text; card.style.display = 'flex'; return; }
  } catch {}

  try {
    const prompt = 'Gere UM insight útil de HOJE para o investidor, com base no perfil e nos indicadores atuais. Máximo 35 palavras, texto corrido, direto, sem saudação e sem repetir números óbvios da carteira. Temas possíveis: câmbio da semana, dividendo esperado, proximidade do dia de aporte (dia ' + profileData.diaAporte + '), equilíbrio da carteira. É uma OBSERVAÇÃO, não uma recomendação: NUNCA diga em qual ativo ou lado (Brasil/Internacional) aportar, nem use "priorize", "compre" ou "invista em". Use exatamente os indicadores do perfil (não invente Selic, câmbio ou IPCA).';
    const insight = await callAI(getAssistantSystem() + '\n\n' + getProfile(), [{ role: 'user', content: prompt }], 120);
    localStorage.setItem(KEY, JSON.stringify({ date: today, text: insight, v: INSIGHT_VERSAO, selic: selicLabel() }));
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
  // Depósitos antigos na Caixinha ficam fora: o dinheiro dela conta quando vira a compra de um ativo
  const monthDocs = (docs || []).filter(d => monthKeyOf(d.data) === prevKey && d.ativo !== 'Caixinha');
  if (monthDocs.length === 0) return; // sem movimentos no mês anterior — nada a resumir

  const linhas = monthDocs.map(d => `${d.ativo} ${d.moeda === 'EUR' ? '€' : 'R$'}${d.valor}${d.qtd ? ' (' + d.qtd + ' cotas)' : ''}`).join('; ');
  try {
    const prompt = `Resuma o mês de ${monthLabel} do investidor em UM parágrafo de no máximo 70 palavras, tom de extrato inteligente: o que foi aportado (${linhas}), dividendos se houve, e se ficou aderente ao plano de €${profileData.aporteMensalEur}/mês (€${profileData.aporteBrEur} Brasil + €${profileData.aporteIntlEur} Internacional). Texto corrido, sem listas, sem saudação.`;
    const text = await callAI(getAssistantSystem() + '\n\n' + getProfile(), [{ role: 'user', content: prompt }], 200);
    localStorage.setItem(KEY, JSON.stringify({ month: prevKey, text }));
    show(text);
  } catch (e) {}
}

// 🔍 Análise completa da carteira — sob demanda, único lugar com tom de assessor
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
    const prompt = 'Faça uma ANÁLISE COMPLETA da carteira: proporção Brasil/Internacional vs referência 60/40, concentração por ativo, rentabilidade vs aportado, riscos relevantes, aderência ao plano e sugestão concreta para o próximo aporte. Aqui você PODE se aprofundar: até ~250 palavras, em parágrafos curtos, sem títulos e sem listas com asteriscos.';
    const text = await callAI(getAssistantSystem() + '\n\n' + getProfile(), [{ role: 'user', content: prompt }], 900);
    txtEl.innerHTML = mdLite(text);
    document.getElementById('analysis-date').textContent = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    card.style.display = '';
    localStorage.setItem('wf_last_analysis', JSON.stringify({ ts: Date.now(), text }));
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
    if (!c || !c.text) return;
    document.getElementById('analysis-text').innerHTML = mdLite(c.text);
    document.getElementById('analysis-date').textContent = new Date(c.ts).toLocaleDateString('pt-BR');
    document.getElementById('analysis-card').style.display = '';
  } catch {}
}

function askRiskAgentAboutScore() {
  // Manda as notas e os motivos que tiraram pontos, para a IA comentar sobre fatos e não adivinhar
  const sc = scoreAtual;
  const detalhe = sc ? sc.itens.map(i => `${i.nome} ${i.valor}${i.motivos.length ? ' (' + i.motivos.join('; ') + ')' : ''}`).join(', ') : '';
  const question = `Meu WealthFlow Score está em ${sc ? sc.total : document.getElementById('score-value').textContent}/100 — ${detalhe}. Pode analisar o que isso significa na minha carteira atual e o que eu poderia ajustar para melhorar?`;

  showPage('agentes');
  chatMode = 'risco'; // pergunta sobre score vai com o olhar de risco
  document.querySelectorAll('.qbtn.mode').forEach(b => b.classList.toggle('active', b.id === 'mode-risco'));
  document.getElementById('userInput').value = question;
  sendMsg();
}

