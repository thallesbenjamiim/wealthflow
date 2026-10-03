// WealthFlow — Dashboard, carteira, rentabilidade, conferência com a corretora, Exit Tax e gráfico de evolução.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// DASHBOARD — copiloto financeiro
// ─────────────────────────────────────────
// Derivados do profileData — recalculados por refreshDerivedFromProfile() após editar o Perfil
let GOAL_TARGET_BRL = profileData.metaIntermediariaBRL;
let MONTHLY_APORTE_EUR = profileData.aporteMensalEur; // aporte oficial mensal (BR + INTL)

function refreshDerivedFromProfile() {
  GOAL_TARGET_BRL = profileData.metaIntermediariaBRL;
  MONTHLY_APORTE_EUR = profileData.aporteMensalEur;
}

// ─────────────────────────────────────────
// SUGESTÃO DE APORTE — gerada pelo Analista de Portfólio
// ─────────────────────────────────────────
// AI HELPER — usa Gemini se disponível, senão Anthropic
// ─────────────────────────────────────────
async function callAI(systemPrompt, messages, maxTokens = 1000) {
  const useAnthropic = (activeProvider === 'anthropic' && apiKey) || (!geminiKey && apiKey);
  const useGemini    = (activeProvider === 'gemini'    && geminiKey) || (!apiKey && geminiKey);

  if (useAnthropic) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system: systemPrompt, messages })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`Claude ${res.status}: ${e.error?.message || 'erro'}`); }
    const d = await res.json();
    const txt = d.content?.[0]?.text || '';
    if (!txt) throw new Error('Claude retornou resposta vazia — tente novamente');
    return txt;
  }

  if (useGemini) {
    const contents = messages.map((m, i) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: (i === 0 && systemPrompt) ? systemPrompt + '\n\n' + m.content : m.content }]
    }));
    // thinkingBudget: 0 — sem isso o gemini-2.5-flash gasta o maxOutputTokens "pensando"
    // e pode devolver parts vazio (bolha em branco no chat)
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } } })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`Gemini ${res.status}: ${e.error?.message || 'erro'}`); }
    const d = await res.json();
    const txt = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!txt) throw new Error('Gemini retornou resposta vazia — tente novamente');
    return txt;
  }

  throw new Error('Nenhuma chave API configurada');
}

function openAssessorChat() {
  showPage('agentes', document.querySelectorAll('.nav-item')[2]);
}

// ─────────────────────────────────────────
// FORMATAÇÃO NUMÉRICA — padrão pt-BR (ponto de milhar, vírgula decimal)
// ─────────────────────────────────────────
function fmtNum(value, decimals = 2) {
  return (value || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Mês ("AAAA-MM") de um aporte no fuso LOCAL. Aportes novos guardam data ISO em UTC
// (um aporte às 00:30 do dia 1º seria do mês anterior em UTC); os antigos guardam só
// "AAAA-MM-DD", que já é a data local e não pode passar por new Date (seria lida como UTC).
function monthKeyOf(dataStr) {
  const s = String(dataStr || '');
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) return s.slice(0, 7); // sem fuso = já é local
  const d = new Date(s);
  if (isNaN(d)) return s.slice(0, 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentMonthKey(offset = 0) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Converte texto digitado no padrão pt-BR ("1.234,56") de volta para número puro.
function parsePtBrNumber(str) {
  if (!str) return NaN;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.'));
}

// Preenche um campo de texto já formatado com ponto de milhar (usado ao carregar a tela).
function setMaskedValue(el, num, decimals = 0) {
  el.value = (num || num === 0) ? Number(num).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '';
}

// Formata um campo de texto com ponto de milhar EM TEMPO REAL, enquanto o usuário digita —
// evita a confusão de ler "1000000" sem separador. Decimais só quando decimals > 0.
function maskThousandsInput(el, decimals = 0) {
  el.addEventListener('input', () => {
    const cursorFromEnd = el.value.length - el.selectionStart;
    let raw = el.value;
    if (decimals > 0) {
      // aceita "." OU "," como decimal — o último símbolo digitado vira a vírgula decimal,
      // os anteriores (ponto de milhar já formatado) são descartados e recriados abaixo
      const lastSepIdx = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
      if (lastSepIdx >= 0) {
        raw = raw.slice(0, lastSepIdx).replace(/[.,]/g, '') + ',' + raw.slice(lastSepIdx + 1).replace(/[.,]/g, '');
      }
    }
    let digits = raw.replace(/[^\d,]/g, '');
    if (decimals === 0) digits = digits.replace(/,/g, '');
    const commaIdx = digits.indexOf(',');
    let intPart = (commaIdx >= 0 ? digits.slice(0, commaIdx) : digits).replace(/^0+(?=\d)/, '');
    let decPart = commaIdx >= 0 ? digits.slice(commaIdx + 1).replace(/,/g, '').slice(0, decimals) : null;
    const formattedInt = intPart ? Number(intPart).toLocaleString('pt-BR') : '';
    el.value = formattedInt + (decPart !== null ? ',' + decPart : (commaIdx >= 0 && decimals > 0 ? ',' : ''));
    const newPos = Math.max(0, el.value.length - cursorFromEnd);
    el.setSelectionRange(newPos, newPos);
  });
}

// ─────────────────────────────────────────
// RENTABILIDADE REAL — custo de aquisição a partir dos aportes registrados
// ─────────────────────────────────────────
const ASSET_CURRENCY = { 'MXRF11':'BRL', 'HGLG11':'BRL', 'KNRI11':'BRL', 'IPCA+':'BRL', 'Selic':'BRL', 'Caixinha':'BRL', 'Dividendo':'BRL', 'VWCE':'EUR', 'EUNA':'EUR', 'Bitcoin':'EUR', 'Reserva':'EUR' };

// Soma o valor aportado por ativo, na moeda nativa de cada um
function computeInvested(docs, rate) {
  const inv = {};
  (docs || []).forEach(d => {
    if (d.ativo === 'Dividendo') return; // dividendo é renda, não custo
    const cur = ASSET_CURRENCY[d.ativo] || 'EUR';
    let v = parseFloat(d.valor) || 0;
    if (d.moeda === 'EUR' && cur === 'BRL') v *= rate;
    if (d.moeda === 'BRL' && cur === 'EUR') v /= rate;
    inv[d.ativo] = (inv[d.ativo] || 0) + v;
  });
  // Bitcoin: compras antigas (pré-app) vivem em bitcoin_invested_eur, que já acumula as novas também
  if (portfolioData.bitcoin_invested_eur) inv['Bitcoin'] = portfolioData.bitcoin_invested_eur;
  return inv;
}

// Total tirado do bolso, em €: soma dos ativos (a Caixinha entra pelo SALDO atual —
// o que saiu dela virou aporte em outro ativo e já está contado lá) MENOS os dividendos
// recebidos: dividendo reinvestido é dinheiro que a carteira gerou, não que saiu do bolso.
// (Se o dividendo não foi reinvestido, a conta dá no mesmo: valor + dividendos − aportado.)
function totalInvestedEur(inv, rate) {
  let total = 0;
  Object.entries(inv).forEach(([ativo, v]) => {
    if (ativo === 'Caixinha' || ativo === 'Reserva') return;
    total += ASSET_CURRENCY[ativo] === 'BRL' ? v / rate : v;
  });
  return total + (portfolioData.caixinha || 0) / rate - (portfolioData.dividendos || 0) / rate;
}

// Só vira true quando a carteira real do Firebase chegou — antes disso o dashboard não
// renderiza, para nunca mostrar os valores de exemplo do código como se fossem seus.
let portfolioLoaded = false;

async function updateDashboard(cambio) {
  if (!portfolioLoaded) return;
  const rate = parseFloat(cambio) || 6.0;
  const brInvested = portfolioData.mxrf11 + (portfolioData.hglg11 || 0) + (portfolioData.knri11 || 0) + ipcaValor() + portfolioData.selic;
  const cashEur = portfolioData.caixinha / rate;
  const brInvestedEur = brInvested / rate;
  const intlEur = portfolioData.vwce + portfolioData.euna;
  const btcPrice = await fetchBTCPriceEUR();
  const btcValueEur = btcPrice ? portfolioData.bitcoin * btcPrice : (portfolioData.bitcoin_invested_eur || 0);
  const totalEur = brInvestedEur + intlEur + cashEur + btcValueEur;

  // ── 1. HERO ──
  document.getElementById('hero-total').textContent = '€' + fmtNum(totalEur, 0);
  document.getElementById('hero-total-brl').textContent = 'R$' + fmtNum(totalEur * rate, 0) + ' equivalente';

  const brPct = totalEur > 0 ? (brInvestedEur + cashEur) / totalEur : 0;
  const concentrationOk = brPct < 0.75 && brPct > 0.15;
  const statusEl = document.getElementById('hero-status');
  const statusText = document.getElementById('hero-status-text');
  if (concentrationOk) {
    statusEl.className = 'hero-status';
    statusText.textContent = 'Carteira equilibrada';
  } else {
    statusEl.className = 'hero-status amber';
    statusText.textContent = 'Atenção à alocação';
  }
  // Rentabilidade real: valor de mercado vs total aportado (dos registros de aporte)
  const growthEl = document.getElementById('hero-growth');
  let invDocs = []; // reutilizado no cálculo de Disciplina do Score
  try {
    invDocs = await loadAportesForEvo();
    primeiroDeemedDisposal = calcularLotesExitTax(invDocs, rate)[0]?.disposal || null;
    const investedEur = totalInvestedEur(computeInvested(invDocs, rate), rate);
    if (investedEur > 1) {
      const diff = totalEur - investedEur;
      const diffPct = (diff / investedEur) * 100;
      growthEl.textContent = `${diff >= 0 ? '▲ +' : '▼ −'}€${fmtNum(Math.abs(diff))} (${diff >= 0 ? '+' : '−'}${Math.abs(diffPct).toFixed(1).replace(".", ",")}%) vs €${fmtNum(investedEur, 0)} do seu bolso`;
      growthEl.title = 'Inclui dividendos recebidos — reinvestidos ou não';
      growthEl.style.color = diff >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
      growthEl.textContent = totalEur > 0 ? '+ R$' + fmtNum(portfolioData.dividendos) + ' em dividendos' : 'iniciando';
    }
  } catch(e) {
    growthEl.textContent = totalEur > 0 ? '+ R$' + fmtNum(portfolioData.dividendos) + ' em dividendos' : 'iniciando';
  }

  // ── 2. META (meta editável no Perfil, em reais, convertida dinamicamente pela cotação do dia) ──
  const goalTargetEur = GOAL_TARGET_BRL / rate;
  const pct = (totalEur / goalTargetEur) * 100;
  document.getElementById('goal-target').textContent = 'R$' + fmtNum(GOAL_TARGET_BRL, 0);
  document.getElementById('goal-pct').textContent = pct.toFixed(pct < 1 ? 3 : 1).replace('.', ',') + '%';
  document.getElementById('goal-bar-fill').style.width = Math.max(pct, 0.3) + '%';
  document.getElementById('goal-current').textContent = 'R$' + fmtNum(totalEur * rate, 0);

  // Projeção simples: total atual + aportes mensais crescendo a ~0.6%/mês até atingir a meta
  const monthlyReturn = 0.006;
  let bal = totalEur;
  let months = 0;
  while (bal < goalTargetEur && months < 12 * 60) {
    bal = bal * (1 + monthlyReturn) + MONTHLY_APORTE_EUR;
    months++;
  }
  // Ano em que a meta é atingida = hoje + N meses (não um ano-base fixo)
  const hojeD = new Date();
  const projYear = new Date(hojeD.getFullYear(), hojeD.getMonth() + months, 1).getFullYear();
  document.getElementById('goal-year').textContent = months >= 12 * 60 ? '60+ anos' : projYear;

  // ── 3b. RESERVA DE EMERGÊNCIA (independente da meta de R$1.000.000) ──
  const reservaEur = portfolioData.reserva || 0;
  const reservaPct = Math.min(100, (reservaEur / profileData.reservaMetaEur) * 100);
  document.getElementById('reserva-target').textContent = '€' + fmtNum(profileData.reservaMetaEur, 0);
  document.getElementById('reserva-pct').textContent = reservaPct.toFixed(0) + '%';
  document.getElementById('reserva-bar-fill').style.width = Math.max(reservaPct, reservaEur > 0 ? 0.3 : 0) + '%';
  document.getElementById('reserva-current').textContent = '€' + fmtNum(reservaEur);

  // ── 4. ALOCAÇÃO SIMPLIFICADA ──
  const intlPct = totalEur > 0 ? (intlEur / totalEur) * 100 : 0;
  const brPctDisp = totalEur > 0 ? (brInvestedEur / totalEur) * 100 : 0;
  const cashPct = totalEur > 0 ? (cashEur / totalEur) * 100 : 0;
  const btcPct = totalEur > 0 ? (btcValueEur / totalEur) * 100 : 0;
  const setAllocSeg = (id, pct) => {
    const el = document.getElementById(id);
    el.style.display = pct > 0 ? '' : 'none';
    el.style.flex = Math.max(pct, 0.5);
  };
  setAllocSeg('alloc-seg-intl', intlPct);
  setAllocSeg('alloc-seg-br', brPctDisp);
  setAllocSeg('alloc-seg-cash', cashPct);
  setAllocSeg('alloc-seg-btc', btcPct);
  document.getElementById('alloc-pct-intl').textContent = intlPct.toFixed(0) + '%';
  document.getElementById('alloc-pct-br').textContent = brPctDisp.toFixed(0) + '%';
  document.getElementById('alloc-pct-cash').textContent = cashPct.toFixed(0) + '%';
  document.getElementById('alloc-pct-btc').textContent = btcPct.toFixed(0) + '%';

  // Referência do plano (proporção Brasil/Internacional dos aportes definidos no Perfil)
  const planTotal = (profileData.aporteBrEur || 0) + (profileData.aporteIntlEur || 0);
  if (planTotal > 0) {
    const planBr = Math.round((profileData.aporteBrEur / planTotal) * 100);
    const refBr = document.getElementById('alloc-ref-br');
    const refIntl = document.getElementById('alloc-ref-intl');
    const refTxt = document.getElementById('alloc-ref-text');
    if (refBr) refBr.style.flex = planBr;
    if (refIntl) refIntl.style.flex = 100 - planBr;
    if (refTxt) refTxt.textContent = `${planBr}% Brasil / ${100 - planBr}% Internacional`;
  }

  // ── 6. SCORE — calculado a partir dos seus dados reais ──
  // Cada posição convertida para EUR, para medir concentração e diversificação de verdade
  const positions = [
    { name: 'mxrf11', eur: portfolioData.mxrf11 / rate },
    { name: 'hglg11', eur: (portfolioData.hglg11 || 0) / rate },
    { name: 'knri11', eur: (portfolioData.knri11 || 0) / rate },
    { name: 'ipca', eur: ipcaValor() / rate },
    { name: 'selic', eur: (portfolioData.selic + portfolioData.caixinha) / rate },
    { name: 'vwce', eur: portfolioData.vwce },
    { name: 'euna', eur: portfolioData.euna },
    { name: 'bitcoin', eur: btcValueEur }
  ];
  const positionsTotal = positions.reduce((s, p) => s + p.eur, 0) || 1;
  const activeCount = positions.filter(p => p.eur > 0).length;
  const maxWeightPct = Math.max(...positions.map(p => (p.eur / positionsTotal) * 100));

  // Selo do hero fica coerente com os Alertas: concentração >30% também tira o "equilibrada"
  if (concentrationOk && maxWeightPct > 30) {
    statusEl.className = 'hero-status amber';
    statusText.textContent = 'Concentração alta — veja Alertas';
  }

  // Diversificação: quantas posições de investimento você já tem, de todas as possíveis.
  // Dinheiro parado na Caixinha não é diversificação — só o Tesouro Selic conta nessa linha.
  const investCount = positions.filter(p => (p.name === 'selic' ? portfolioData.selic : p.eur) > 0).length;
  const diversificacaoScore = Math.round(Math.min(100, (investCount / positions.length) * 100));

  // Risco: começa em 100 e desconta fatores reais — concentração numa única posição,
  // cripto acima de 5% da carteira e desvio estrutural da referência 60/40
  let riscoScore = 100;
  riscoScore -= Math.max(0, maxWeightPct - 25) * 1.6;
  riscoScore -= Math.max(0, btcPct - 5) * 2.2;
  riscoScore -= Math.max(0, Math.abs(brPct * 100 - 60) - 15) * 0.8;
  riscoScore = Math.round(Math.max(10, Math.min(100, riscoScore)));

  // Disciplina: consistência REAL de aportes — meses fechados com registro (janela de 3),
  // dividendos reinvestindo e pouco dinheiro parado. Pular um mês agora derruba o número.
  const firstMonth = (invDocs || []).map(d => monthKeyOf(d.data)).filter(Boolean).sort()[0] || null;
  let mesesAvaliados = 0, mesesComAporte = 0;
  if (firstMonth) {
    for (let i = 1; i <= 3; i++) {
      const key = currentMonthKey(-i);
      if (key < firstMonth) break; // não penaliza meses antes do app existir
      mesesAvaliados++;
      if ((invDocs || []).some(dc => monthKeyOf(dc.data) === key && dc.ativo !== 'Dividendo' && dc.ativo !== 'Reserva')) mesesComAporte++;
    }
  }
  const aderencia = mesesAvaliados > 0 ? mesesComAporte / mesesAvaliados : 0.5; // sem mês fechado ainda: neutro
  let disciplinaScore = 30 + aderencia * 50;
  if (portfolioData.dividendos > 0) disciplinaScore += 10;
  if (cashPct < 35) disciplinaScore += 10;
  disciplinaScore = Math.round(Math.max(10, Math.min(100, disciplinaScore)));

  // Progresso: % real da meta de R$1.000.000
  const progressScore = Math.round(Math.min(100, Math.max(1, pct * 8 + 20)));

  document.getElementById('score-bar-disciplina').style.width = disciplinaScore + '%';
  document.getElementById('score-bar-diversificacao').style.width = diversificacaoScore + '%';
  document.getElementById('score-bar-risco').style.width = riscoScore + '%';
  document.getElementById('score-bar-progress').style.width = progressScore + '%';
  document.getElementById('score-num-disciplina').textContent = disciplinaScore;
  document.getElementById('score-num-diversificacao').textContent = diversificacaoScore;
  document.getElementById('score-num-risco').textContent = riscoScore;
  document.getElementById('score-num-progresso').textContent = progressScore;

  const overallScore = Math.round((disciplinaScore + diversificacaoScore + riscoScore + progressScore) / 4);
  document.getElementById('score-value').textContent = overallScore;
  const circumference = 2 * Math.PI * 52; // r=52 no SVG
  const offset = circumference * (1 - overallScore / 100);
  document.getElementById('score-ring-fill').setAttribute('stroke-dasharray', circumference.toFixed(1));
  document.getElementById('score-ring-fill').setAttribute('stroke-dashoffset', offset.toFixed(1));

  // ── 7. EVOLUÇÃO (tendência ilustrativa a partir do total atual) ──
  renderEvolution(totalEur);
  populateEvoFromPortfolio();

  // ── CARTEIRA DETALHADA ──
  renderWallet(rate);

  // Formulário de aporte: atualiza saldo/visibilidade da opção "pagar com a Caixinha"
  onAtivoChange();
}

// Toggle de moeda: 'nativa' (cada ativo na sua moeda), 'EUR' ou 'BRL' (tudo convertido)
let walletCurrency = localStorage.getItem('wf_wallet_currency') || 'nativa';

function setWalletCurrency(cur) {
  walletCurrency = cur;
  localStorage.setItem('wf_wallet_currency', cur);
  renderWallet(getRate());
}

async function renderWallet(rate) {
  const list = document.getElementById('wallet-list');
  if (!list) return;
  const items = [];

  document.querySelectorAll('.cur-btn').forEach(b => b.classList.toggle('active', b.dataset.cur === walletCurrency));

  // Exibe um valor na moeda escolhida no toggle (convertendo pelo câmbio do dia)
  const showVal = (num, cur) => {
    if (walletCurrency === 'EUR') return '€' + fmtNum(cur === 'BRL' ? num / rate : num);
    if (walletCurrency === 'BRL') return 'R$' + fmtNum(cur === 'EUR' ? num * rate : num);
    return (cur === 'BRL' ? 'R$' : '€') + fmtNum(num);
  };

  // Custo de aquisição real por ativo (a partir dos aportes registrados)
  const invDocs = await loadAportesForEvo();
  const inv = computeInvested(invDocs, rate);

  // Monta a linha de ganho/perda de um ativo com preço de mercado
  const plLine = (invested, current, sym) => {
    if (!invested || invested <= 0 || !current) return null;
    const diff = current - invested;
    const pct = (diff / invested) * 100;
    return { txt: `${diff >= 0 ? '▲ +' : '▼ −'}${sym}${fmtNum(Math.abs(diff))} (${diff >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1).replace(".", ",")}%)`, cls: diff >= 0 ? 'pl-pos' : 'pl-neg' };
  };
  const pm = (invested, cotas) => (invested > 0 && cotas > 0) ? invested / cotas : null;

  const mxrfVal = portfolioData.mxrf11_cotas
    ? (portfolioData.mxrf11_cotas * portfolioData.mxrf11_preco)
    : portfolioData.mxrf11;
  const mxrfPm = pm(inv['MXRF11'], portfolioData.mxrf11_cotas);
  items.push({
    icon: '🏢', name: 'MXRF11', type: 'FII de Papel · Nubank', cat: 'br',
    val: showVal(mxrfVal, 'BRL'),
    meta: portfolioData.mxrf11_cotas ? fmtNum(portfolioData.mxrf11_cotas, 0) + ' cotas · R$' + fmtNum(portfolioData.mxrf11_preco) + (mxrfPm ? ' · PM R$' + fmtNum(mxrfPm) : '') : '',
    pl: plLine(inv['MXRF11'], mxrfVal, 'R$')
  });

  if ((portfolioData.hglg11_cotas && portfolioData.hglg11_cotas > 0) || portfolioData.hglg11 > 0) {
    const hglgVal = portfolioData.hglg11_cotas
      ? (portfolioData.hglg11_cotas * portfolioData.hglg11_preco)
      : portfolioData.hglg11;
    const hglgPm = pm(inv['HGLG11'], portfolioData.hglg11_cotas);
    items.push({
      icon: '🏭', name: 'HGLG11', type: 'FII de Logística · Nubank', cat: 'br',
      val: showVal(hglgVal, 'BRL'),
      meta: portfolioData.hglg11_cotas ? fmtNum(portfolioData.hglg11_cotas, 0) + ' cotas · R$' + fmtNum(portfolioData.hglg11_preco) + (hglgPm ? ' · PM R$' + fmtNum(hglgPm) : '') : '',
      pl: plLine(inv['HGLG11'], hglgVal, 'R$')
    });
  }

  if ((portfolioData.knri11_cotas && portfolioData.knri11_cotas > 0) || portfolioData.knri11 > 0) {
    const knriVal = portfolioData.knri11_cotas
      ? (portfolioData.knri11_cotas * portfolioData.knri11_preco)
      : portfolioData.knri11;
    const knriPm = pm(inv['KNRI11'], portfolioData.knri11_cotas);
    items.push({
      icon: '🏛️', name: 'KNRI11', type: 'FII Híbrido · Nubank', cat: 'br',
      val: showVal(knriVal, 'BRL'),
      meta: portfolioData.knri11_cotas ? fmtNum(portfolioData.knri11_cotas, 0) + ' cotas · R$' + fmtNum(portfolioData.knri11_preco) + (knriPm ? ' · PM R$' + fmtNum(knriPm) : '') : '',
      pl: plLine(inv['KNRI11'], knriVal, 'R$')
    });
  }

  const ipcaMercado = portfolioData.ipca_mercado != null;
  items.push({
    icon: '📈', name: 'Tesouro IPCA+', type: 'Renda Fixa · Nubank', cat: 'br', val: showVal(ipcaValor(), 'BRL'),
    meta: ipcaMercado
      ? 'valor de mercado' + (portfolioData.ipca_mercado_data ? ' de ' + new Date(portfolioData.ipca_mercado_data).toLocaleDateString('pt-BR') : '')
      : 'valor aplicado — informe o de mercado em "Conferir com a corretora"',
    pl: ipcaMercado ? plLine(portfolioData.ipca, ipcaValor(), 'R$') : null
  });

  if (portfolioData.selic > 0) {
    items.push({ icon: '💵', name: 'Tesouro Selic', type: 'Liquidez · Nubank', cat: 'br', val: showVal(portfolioData.selic, 'BRL'), meta: '' });
  }
  if (portfolioData.caixinha > 0) {
    items.push({ icon: '💰', name: 'Caixinha CDI', type: 'Aguardando destino · Nubank', cat: 'cash', val: showVal(portfolioData.caixinha, 'BRL'), meta: '' });
  }

  const vwcePm = pm(inv['VWCE'], portfolioData.vwce_cotas);
  items.push({
    icon: '🌍', name: 'VWCE', type: 'ETF Global Acc · Revolut', cat: 'intl',
    val: showVal(portfolioData.vwce, 'EUR'),
    meta: portfolioData.vwce_cotas ? fmtNum(portfolioData.vwce_cotas, 4) + ' cotas · €' + fmtNum(portfolioData.vwce_preco || 0) + (vwcePm ? ' · PM €' + fmtNum(vwcePm) : '') : '',
    pl: plLine(inv['VWCE'], portfolioData.vwce, '€')
  });
  const eunaPm = pm(inv['EUNA'], portfolioData.euna_cotas);
  items.push({
    icon: '🔒', name: 'EUNA', type: 'ETF Bonds Acc · Revolut', cat: 'intl',
    val: showVal(portfolioData.euna, 'EUR'),
    meta: portfolioData.euna_cotas ? fmtNum(portfolioData.euna_cotas, 4) + ' cotas · €' + fmtNum(portfolioData.euna_preco || 0) + (eunaPm ? ' · PM €' + fmtNum(eunaPm) : '') : '',
    pl: plLine(inv['EUNA'], portfolioData.euna, '€')
  });

  if (portfolioData.bitcoin > 0 || portfolioData.bitcoin_invested_eur > 0) {
    const btcPrice = await fetchBTCPriceEUR();
    const qty = portfolioData.bitcoin || 0;
    const invested = portfolioData.bitcoin_invested_eur || 0;
    const currentVal = btcPrice ? qty * btcPrice : null;
    items.push({
      icon: '₿', name: 'Bitcoin', type: 'Crypto · Informal', cat: 'btc',
      val: currentVal !== null ? showVal(currentVal, 'EUR') : showVal(invested, 'EUR') + ' investido',
      meta: qty > 0 ? qty.toFixed(8) + ' BTC' + (currentVal !== null ? ' · cotação ao vivo' : ' · cotação indisponível')
            : 'aguardando cotação para converter',
      pl: currentVal !== null ? plLine(inv['Bitcoin'], currentVal, '€') : null
    });
  }
  if (portfolioData.dividendos > 0) {
    items.push({ icon: '💚', name: 'Dividendos recebidos', type: 'Acumulado total', cat: 'div', val: showVal(portfolioData.dividendos, 'BRL'), meta: '' });
  }
  if (portfolioData.reserva > 0) {
    items.push({ icon: '🛟', name: 'Reserva de Emergência', type: 'Intocável · Revolut', cat: 'reserva', val: showVal(portfolioData.reserva, 'EUR'), meta: 'Meta: €' + fmtNum(profileData.reservaMetaEur, 0) });
  }

  list.innerHTML = items.map(it => `
    <div class="wallet-item">
      <div class="wallet-left">
        <div class="wallet-icon wallet-icon-${it.cat}">${it.icon}</div>
        <div><div class="wallet-name">${it.name}</div><div class="wallet-type">${it.type}</div></div>
      </div>
      <div class="wallet-right">
        <div class="wallet-val mval">${it.val}</div>
        ${it.meta ? `<div class="wallet-meta mval">${it.meta}</div>` : ''}
        ${it.pl ? `<div class="wallet-pl mval ${it.pl.cls}">${it.pl.txt}</div>` : ''}
      </div>
    </div>`).join('');

  // ── Resumo: aportado vs vale hoje ──
  const summaryEl = document.getElementById('wallet-summary');
  if (summaryEl) {
    const btcPriceNow = await fetchBTCPriceEUR();
    const btcNow = btcPriceNow ? (portfolioData.bitcoin || 0) * btcPriceNow : (portfolioData.bitcoin_invested_eur || 0);
    const currentTotal = (portfolioData.mxrf11 + (portfolioData.hglg11 || 0) + (portfolioData.knri11 || 0) + ipcaValor() + portfolioData.selic + portfolioData.caixinha) / rate
      + portfolioData.vwce + portfolioData.euna + btcNow;
    const investedTotal = totalInvestedEur(inv, rate);
    const diff = currentTotal - investedTotal;
    const pct = investedTotal > 0 ? (diff / investedTotal) * 100 : 0;
    const sumVal = v => walletCurrency === 'BRL' ? 'R$' + fmtNum(v * rate) : '€' + fmtNum(v);
    summaryEl.innerHTML = `
      <div class="ws-tile"><div class="ws-label">Do seu bolso</div><div class="ws-value mval">${sumVal(investedTotal)}</div></div>
      <div class="ws-tile"><div class="ws-label">Vale hoje</div><div class="ws-value mval">${sumVal(currentTotal)}</div></div>
      <div class="ws-tile"><div class="ws-label">Resultado</div><div class="ws-value mval ${diff >= 0 ? 'pl-pos' : 'pl-neg'}">${diff >= 0 ? '+' : '−'}${sumVal(Math.abs(diff))} (${diff >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1).replace(".", ",")}%)</div></div>`;
  }

  // ── Painel de dividendos ──
  const divStats = document.getElementById('div-stats');
  if (divStats) {
    const mesAtual = currentMonthKey();
    const esteMes = (invDocs || []).filter(d => d.ativo === 'Dividendo' && monthKeyOf(d.data) === mesAtual).reduce((s, d) => s + (d.moeda === 'EUR' ? parseFloat(d.valor) * rate : parseFloat(d.valor)), 0);

    // Estimativa real: último dividendo por cota de fato pago por cada FII (Brasil apenas — MXRF11/HGLG11/KNRI11)
    const mxrfPorCota = divPerShare.mxrf11;
    const hglgPorCota = divPerShare.hglg11;
    const knriPorCota = divPerShare.knri11;
    const estMxrf = (portfolioData.mxrf11_cotas || 0) * mxrfPorCota;
    const estHglg = (portfolioData.hglg11_cotas || 0) * hglgPorCota;
    const estKnri = (portfolioData.knri11_cotas || 0) * knriPorCota;
    const estMensal = estMxrf + estHglg + estKnri;
    const invFiis = (inv['MXRF11'] || 0) + (inv['HGLG11'] || 0) + (inv['KNRI11'] || 0);
    const yoc = invFiis > 0 ? (estMensal * 12 / invFiis) * 100 : 0;

    divStats.innerHTML = `
      <div class="ws-tile"><div class="ws-label">Total recebido</div><div class="ws-value mval">R$${fmtNum(portfolioData.dividendos)}</div></div>
      <div class="ws-tile"><div class="ws-label">Este mês</div><div class="ws-value mval">R$${fmtNum(esteMes)}</div></div>
      <div class="ws-tile"><div class="ws-label">Próximo dividendo (estimado)</div><div class="ws-value mval">R$${fmtNum(estMensal)}</div></div>
      <div class="ws-tile"><div class="ws-label">Yield on cost (a.a.)</div><div class="ws-value mval">${yoc.toFixed(1).replace('.', ',')}%</div></div>`;
    const divNote = document.getElementById('div-note');
    if (divNote) {
      const partes = [];
      if (portfolioData.mxrf11_cotas > 0) partes.push(`MXRF11: R$${fmtNum(mxrfPorCota)}/cota × ${fmtNum(portfolioData.mxrf11_cotas, 0)} = R$${fmtNum(estMxrf)}`);
      if (portfolioData.hglg11_cotas > 0) partes.push(`HGLG11: R$${fmtNum(hglgPorCota)}/cota × ${fmtNum(portfolioData.hglg11_cotas, 0)} = R$${fmtNum(estHglg)}`);
      if (portfolioData.knri11_cotas > 0) partes.push(`KNRI11: R$${fmtNum(knriPorCota)}/cota × ${fmtNum(portfolioData.knri11_cotas, 0)} = R$${fmtNum(estKnri)}`);
      divNote.textContent = (partes.length ? partes.join(' · ') + '. ' : '') + 'Baseado no último dividendo real pago por cada FII (Yahoo Finance/B3), só Brasil — VWCE e EUNA são Acc e não distribuem. Registre cada dividendo recebido em "Registrar Aporte" → Dividendo para o total real crescer.';
    }
  }

  renderExitTax(rate);
  if (!document.getElementById('conf-body')?.hidden) renderConferencia();
}

// points/months: a série principal (linha cheia). nowValue (opcional): valor de mercado de hoje,
// desenhado como um trecho tracejado à parte — assim a linha nunca mistura "aportado" com "vale hoje".
// ─────────────────────────────────────────
// CONFERIR COM A CORRETORA — corrige a carteira pelo que o Nubank/Revolut mostram
// ─────────────────────────────────────────
function conferenciaItens() {
  const itens = [
    { ativo: 'MXRF11', campo: 'mxrf11_cotas', nome: 'MXRF11', sub: 'cotas · Nubank', dec: 0, un: 'cotas' },
    { ativo: 'HGLG11', campo: 'hglg11_cotas', nome: 'HGLG11', sub: 'cotas · Nubank', dec: 0, un: 'cotas' },
    { ativo: 'KNRI11', campo: 'knri11_cotas', nome: 'KNRI11', sub: 'cotas · Nubank', dec: 0, un: 'cotas' },
    { ativo: 'IPCA+', campo: 'ipca_mercado', nome: 'Tesouro IPCA+', sub: 'valor atual (R$) · Nubank', dec: 2, un: 'R$', atual: () => ipcaValor() },
    { ativo: 'Caixinha', campo: 'caixinha', nome: 'Caixinha CDI', sub: 'saldo (R$) · Nubank', dec: 2, un: 'R$' },
    { ativo: 'VWCE', campo: 'vwce_cotas', nome: 'VWCE', sub: 'cotas · Revolut', dec: 8, un: 'cotas' },
    { ativo: 'EUNA', campo: 'euna_cotas', nome: 'EUNA', sub: 'cotas · Revolut', dec: 8, un: 'cotas' },
    { ativo: 'Bitcoin', campo: 'bitcoin', nome: 'Bitcoin', sub: 'quantidade (BTC) · Revolut', dec: 8, un: 'BTC' },
    { ativo: 'Reserva', campo: 'reserva', nome: 'Reserva de emergência', sub: 'saldo (€) · Revolut', dec: 2, un: '€' }
  ];
  if ((portfolioData.selic || 0) > 0) itens.splice(4, 0, { ativo: 'Selic', campo: 'selic', nome: 'Tesouro Selic', sub: 'valor atual (R$)', dec: 2, un: 'R$' });
  return itens.map(it => ({ ...it, valorApp: it.atual ? it.atual() : (portfolioData[it.campo] || 0) }));
}

function fmtConf(it, v) {
  const n = fmtNum(v, it.dec);
  return it.un === 'R$' ? 'R$' + n : it.un === '€' ? '€' + n : n;
}

function toggleConferencia() {
  const body = document.getElementById('conf-body');
  const abrir = body.hidden;
  body.hidden = !abrir;
  document.getElementById('conf-toggle').textContent = abrir ? 'Fechar' : 'Abrir conferência';
  if (abrir) renderConferencia();
}

function renderConferencia() {
  const list = document.getElementById('conf-list');
  if (!list) return;
  list.innerHTML = conferenciaItens().map(it => `
    <div class="conf-row">
      <div><div class="conf-name">${it.nome}</div><div class="conf-sub">${it.sub}</div></div>
      <div class="conf-app mval">no app: ${fmtConf(it, it.valorApp)}</div>
      <div>
        <input class="form-input" type="text" inputmode="decimal" data-campo="${it.campo}" placeholder="na corretora" oninput="atualizarDiffConferencia(this)">
        <div class="conf-diff" id="conf-diff-${it.campo}"></div>
      </div>
    </div>`).join('');
}

function atualizarDiffConferencia(input) {
  const it = conferenciaItens().find(x => x.campo === input.dataset.campo);
  const out = document.getElementById('conf-diff-' + it.campo);
  const v = parseFlexNumber(input.value);
  if (!input.value.trim() || isNaN(v)) { out.textContent = ''; return; }
  const diff = v - it.valorApp;
  const tol = it.dec === 8 ? 1e-8 : it.dec === 0 ? 0.5 : 0.005;
  if (Math.abs(diff) < tol) { out.textContent = '✓ bate'; out.style.color = 'var(--green)'; return; }
  out.textContent = (diff > 0 ? '+' : '−') + fmtConf(it, Math.abs(diff)) + ' de diferença';
  out.style.color = 'var(--amber)';
}

async function salvarConferencia() {
  const itens = conferenciaItens();
  const mudancas = [];
  document.querySelectorAll('#conf-list input[data-campo]').forEach(inp => {
    if (!inp.value.trim()) return;
    const it = itens.find(x => x.campo === inp.dataset.campo);
    const v = parseFlexNumber(inp.value);
    if (isNaN(v) || v < 0) return;
    const tol = it.dec === 8 ? 1e-8 : it.dec === 0 ? 0.5 : 0.005;
    if (Math.abs(v - it.valorApp) < tol && it.campo !== 'ipca_mercado') return;
    // IPCA+: mesmo batendo, gravar a 1ª vez transforma "valor aplicado" em "valor de mercado"
    if (it.campo === 'ipca_mercado' && Math.abs(v - it.valorApp) < 0.005 && portfolioData.ipca_mercado != null) return;
    mudancas.push({ it, novo: it.dec === 0 ? Math.round(v) : v });
  });
  if (!mudancas.length) { showToast('Nada a corrigir — tudo bate ✓'); return; }

  const resumo = mudancas.map(m => `• ${m.it.nome}: ${fmtConf(m.it, m.it.valorApp)} → ${fmtConf(m.it, m.novo)}`).join('\n');
  if (!confirm(`Corrigir a carteira com estes valores?\n\n${resumo}`)) return;

  const agora = new Date();
  const moedaDe = a => ['VWCE', 'EUNA', 'Bitcoin', 'Reserva'].includes(a) ? 'EUR' : 'BRL';
  // Monta o ajuste a partir da carteira FRESCA (dentro da transação): o delta registrado
  // é exatamente o que foi aplicado, então excluir o ajuste depois desfaz certinho
  const montar = (p, m, i) => {
    const anterior = m.it.campo === 'ipca_mercado' ? (p.ipca_mercado ?? null) : (p[m.it.campo] || 0);
    const base = m.it.campo === 'ipca_mercado' ? (p.ipca_mercado ?? p.ipca ?? 0) : (p[m.it.campo] || 0);
    return {
      tipo: 'ajuste', ativo: m.it.ativo, campo: m.it.campo,
      anterior, novo: m.novo, delta: +(m.novo - base).toFixed(8),
      valor: 0, moeda: moedaDe(m.it.ativo), qtd: null, preco: null,
      nota: 'Conferência com a corretora',
      data: agora.toISOString(), timestamp: agora.getTime() + i
    };
  };

  const btn = document.getElementById('conf-save');
  btn.disabled = true;
  try {
    if (TEST_MODE) {
      mudancas.forEach((m, i) => {
        const aj = montar(portfolioData, m, i);
        applyAporteToPortfolio(portfolioData, aj, 1);
        if (m.it.campo === 'ipca_mercado') portfolioData.ipca_mercado_data = agora.toISOString();
        testAportes.unshift({ ...aj, _id: 'teste-aj-' + aj.timestamp });
      });
    } else {
      const { collection, doc } = window._dbFns;
      const ajustes = [];
      await updatePortfolioAtomic(p => {
        ajustes.length = 0; // a transação pode repetir: recomeça do zero a cada tentativa
        mudancas.forEach((m, i) => {
          const aj = montar(p, m, i);
          applyAporteToPortfolio(p, aj, 1);
          if (m.it.campo === 'ipca_mercado') p.ipca_mercado_data = agora.toISOString();
          ajustes.push(aj);
        });
      }, tx => ajustes.forEach(aj => tx.set(doc(collection(window._db, 'aportes')), aj)));
    }
    showToast(TEST_MODE ? '🧪 Correções simuladas — nada foi salvo' : `✓ ${mudancas.length} correç${mudancas.length > 1 ? 'ões salvas' : 'ão salva'}`);
    renderConferencia();
    refreshAfterHistoryChange();
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível salvar as correções');
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────
// EXIT TAX IRLANDÊS — deemed disposal (8 anos após CADA compra de VWCE/EUNA)
// Estimativa, não aconselhamento: alíquota de 38% (2026) sobre o ganho presumido.
// ─────────────────────────────────────────
const EXIT_TAX_RATE = 0.38;
const EXIT_TAX_RETORNO = { VWCE: { cons: 0.04, otim: 0.08 }, EUNA: { cons: 0.02, otim: 0.04 } };
let primeiroDeemedDisposal = null; // Date — usado nos Alertas e no perfil enviado à IA

function dataLocalDe(dataStr) {
  const s = String(dataStr || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  return new Date(s);
}

function calcularLotesExitTax(docs, rate) {
  const lotes = [];
  ['VWCE', 'EUNA'].forEach(ativo => {
    const key = COTA_KEY[ativo];
    const preco = portfolioData[key + '_preco'] || 0;
    const valorAtual = portfolioData[key] || 0;
    const compras = (docs || []).filter(d => d.ativo === ativo && d.tipo !== 'ajuste');
    const custos = compras.map(d => { const v = parseFloat(d.valor) || 0; return d.moeda === 'BRL' ? v / (d.cambio || rate) : v; });
    const custoTotal = custos.reduce((s, v) => s + v, 0);
    let brutos = compras.map((d, i) => parseFloat(d.qtd) > 0 && preco ? parseFloat(d.qtd) * preco : custos[i] * (custoTotal > 0 ? valorAtual / custoTotal : 1));
    // Escala para a soma bater com o valor real da posição (lotes antigos sem cotas registradas)
    const soma = brutos.reduce((s, v) => s + v, 0);
    if (soma > 0 && valorAtual > 0) brutos = brutos.map(v => v * valorAtual / soma);
    compras.forEach((d, i) => {
      const compra = dataLocalDe(d.data);
      const disposal = new Date(compra.getFullYear() + 8, compra.getMonth(), compra.getDate());
      lotes.push({ ativo, compra, disposal, custo: custos[i], valorHoje: brutos[i] });
    });
  });
  return lotes.sort((a, b) => a.disposal - b.disposal);
}

async function renderExitTax(rate) {
  const el = document.getElementById('tax-body');
  if (!el) return;
  const docs = await loadAportesForEvo();
  const lotes = calcularLotesExitTax(docs, rate);
  if (!lotes.length) { el.textContent = 'Nenhuma compra de VWCE ou EUNA registrada ainda.'; return; }

  const hoje = new Date();
  const anosAte = d => Math.max(0, (d - hoje) / (365.25 * 864e5));
  const imposto = (l, cen) => {
    const r = EXIT_TAX_RETORNO[l.ativo][cen];
    const projetado = l.valorHoje * Math.pow(1 + r, anosAte(l.disposal));
    return EXIT_TAX_RATE * Math.max(0, projetado - l.custo);
  };

  const porAno = {};
  lotes.forEach(l => {
    const y = l.disposal.getFullYear();
    porAno[y] = porAno[y] || { lotes: 0, custo: 0, cons: 0, otim: 0 };
    porAno[y].lotes++; porAno[y].custo += l.custo;
    porAno[y].cons += imposto(l, 'cons'); porAno[y].otim += imposto(l, 'otim');
  });

  primeiroDeemedDisposal = lotes[0].disposal;
  const anos = Object.keys(porAno).sort();
  const primeiroAno = +anos[0];
  const p1 = porAno[primeiroAno];
  // Declaração (Form 11) e pagamento até 31/out do ano seguinte; o plano começa a guardar 1 ano antes
  const prazo = new Date(primeiroAno + 1, 9, 31);
  const inicio = new Date(Math.max(hoje, new Date(primeiroAno - 1, 0, 1)));
  const meses = Math.max(1, (prazo.getFullYear() - inicio.getFullYear()) * 12 + prazo.getMonth() - inicio.getMonth());
  const porMes = p1.otim / meses;

  // Cada mês de aporte internacional de hoje vira um lote que paga daqui a 8 anos
  const aporteIntl = profileData.aporteIntlEur || 0;
  const impostoAporteMes = aporteIntl * EXIT_TAX_RATE * (Math.pow(1 + EXIT_TAX_RETORNO.VWCE.otim, 8) - 1);
  const totalCons = Object.values(porAno).reduce((s, a) => s + a.cons, 0);
  const totalOtim = Object.values(porAno).reduce((s, a) => s + a.otim, 0);

  el.innerHTML = `
    <div class="tax-kpis">
      <div class="ws-tile"><div class="ws-label">1º deemed disposal</div><div class="ws-value">${primeiroDeemedDisposal.toLocaleDateString('pt-BR')}</div></div>
      <div class="ws-tile"><div class="ws-label">Imposto em ${primeiroAno}</div><div class="ws-value mval">€${fmtNum(p1.cons, 0)}–${fmtNum(p1.otim, 0)}</div></div>
      <div class="ws-tile"><div class="ws-label">Guardar por mês</div><div class="ws-value mval">€${fmtNum(porMes)}</div></div>
    </div>
    <div class="tax-wrap"><table class="tax-table">
      <thead><tr><th>Ano</th><th>Lotes</th><th>Aportado</th><th>Imposto (cons.)</th><th>Imposto (otim.)</th></tr></thead>
      <tbody>${anos.map(y => `<tr><td>${y}</td><td>${porAno[y].lotes}</td><td class="mval">€${fmtNum(porAno[y].custo, 0)}</td><td class="mval">€${fmtNum(porAno[y].cons, 0)}</td><td class="mval">€${fmtNum(porAno[y].otim, 0)}</td></tr>`).join('')}
      <tr><td><b>Total</b></td><td>${lotes.length}</td><td class="mval">€${fmtNum(lotes.reduce((s, l) => s + l.custo, 0), 0)}</td><td class="mval">€${fmtNum(totalCons, 0)}</td><td class="mval">€${fmtNum(totalOtim, 0)}</td></tr></tbody>
    </table></div>
    <div style="margin-top:12px">Cada compra de VWCE/EUNA é tributada 8 anos depois, como se tivesse sido vendida (38% sobre o ganho). "Guardar por mês" divide o imposto de ${primeiroAno} (cenário otimista) de ${inicio.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })} até o prazo da declaração (31/10/${primeiroAno + 1}). Os aportes futuros entram na conta quando forem feitos: hoje, cada €${fmtNum(aporteIntl, 0)}/mês de aporte internacional deve gerar ~€${fmtNum(impostoAporteMes)} de imposto 8 anos depois. Cenários: VWCE ${EXIT_TAX_RETORNO.VWCE.cons * 100}–${EXIT_TAX_RETORNO.VWCE.otim * 100}% a.a., EUNA ${EXIT_TAX_RETORNO.EUNA.cons * 100}–${EXIT_TAX_RETORNO.EUNA.otim * 100}% a.a. O imposto pago no deemed disposal é abatido na venda real. Estimativa de possível obrigação fiscal — valide com um contador.</div>`;
}

function _drawEvoChart(points, months, sym, nowValue = null) {
  const width = 560, height = 120, pad = 10;
  const hasNow = nowValue !== null && nowValue !== undefined;
  const all = hasNow ? [...points, nowValue] : points;
  const slots = all.length;
  const min = Math.min(...all), max = Math.max(...all, min + 1);
  const range = max - min || 1;
  const coords = all.map((v, i) => ({
    x: pad + (i / (slots - 1)) * (width - pad * 2),
    y: height - pad - ((v - min) / range) * (height - pad * 2),
  }));
  const main = coords.slice(0, points.length);
  const linePath = main.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${main[main.length-1].x.toFixed(1)} ${height-pad} L${main[0].x.toFixed(1)} ${height-pad} Z`;
  document.getElementById('evo-line')?.setAttribute('d', linePath);
  document.getElementById('evo-area')?.setAttribute('d', areaPath);

  // Trecho tracejado até o valor de mercado de hoje (criado sob demanda dentro do SVG)
  const svg = document.getElementById('evo-svg');
  let nowLine = document.getElementById('evo-now-line');
  if (svg && !nowLine) {
    nowLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    nowLine.id = 'evo-now-line';
    nowLine.setAttribute('fill', 'none');
    nowLine.setAttribute('stroke', 'var(--gold)');
    nowLine.setAttribute('stroke-width', '2.5');
    nowLine.setAttribute('stroke-dasharray', '6 5');
    nowLine.setAttribute('stroke-linecap', 'round');
    svg.appendChild(nowLine);
  }
  if (nowLine) {
    const a = main[main.length - 1], b = coords[coords.length - 1];
    nowLine.setAttribute('d', hasNow ? `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}` : '');
  }

  const labelsEl = document.getElementById('evo-labels');
  if (labelsEl) {
    labelsEl.style.gridTemplateColumns = `repeat(${slots}, 1fr)`;
    labelsEl.innerHTML = all.map((v, i) => {
      const isNow = hasNow && i === slots - 1;
      return `
      <div class="evo-label-item">
        <div class="evo-label-month"${isNow ? ' style="color:var(--gold)"' : ''}>${isNow ? 'vale hoje' : months[i]}</div>
        <div class="evo-label-value mval"${isNow ? ' style="color:var(--gold)"' : ''}>${sym}${fmtNum(v, 0)}</div>
      </div>`;
    }).join('');
  }
}

async function renderEvolution(currentTotal) {
  _lastTotalEur = currentTotal;
  const monthNames = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const tagEl  = document.getElementById('evo-tag');
  const noteEl = document.querySelector('.evo-note');

  const docs = await loadAportesForEvo();

  if (docs && docs.length > 0) {
    // Dados reais: dinheiro do bolso acumulado mês a mês, em €.
    // - Caixinha fica fora do histórico: o que entra nela vira aporte em outro ativo depois
    //   (contar os dois seria dobrar); o saldo atual entra no mês corrente via totalInvestedEur.
    // - Reserva de emergência não é investimento.
    // - Dividendo registrado é dinheiro gerado pela carteira: desconta (igual ao hero).
    const rate = getRate();
    const byMonth = {};
    docs.forEach(d => {
      if (d.ativo === 'Caixinha' || d.ativo === 'Reserva') return;
      const key = monthKeyOf(d.data);
      if (!key) return;
      const v = parseFloat(d.valor) || 0;
      const valEur = d.moeda === 'EUR' ? v : v / rate;
      byMonth[key] = (byMonth[key] || 0) + (d.ativo === 'Dividendo' ? -valEur : valEur);
    });

    const currentKey = currentMonthKey();
    if (!(currentKey in byMonth)) byMonth[currentKey] = 0;

    const sortedKeys = Object.keys(byMonth).sort();
    let cumulative = 0;
    const points = [], months = [];
    sortedKeys.forEach(key => {
      cumulative += byMonth[key];
      months.push(monthNames[parseInt(key.split('-')[1]) - 1]);
      points.push(cumulative);
    });
    // Mês atual: usa exatamente o mesmo "do seu bolso" do hero (inclui saldo da Caixinha)
    points[points.length - 1] = totalInvestedEur(computeInvested(docs, rate), rate);

    if (points.length === 1) { months.unshift('início'); points.unshift(0); }

    if (tagEl)  tagEl.textContent  = 'dados reais';
    if (noteEl) noteEl.textContent = 'Linha cheia: dinheiro do seu bolso acumulado mês a mês. Tracejado dourado: quanto a carteira vale hoje a preço de mercado. Valores em reais convertidos pelo câmbio de hoje.';
    _drawEvoChart(points, months, '€', currentTotal);
    return;
  }

  // Fallback ilustrativo (sem nenhum aporte no Firebase ainda)
  if (tagEl)  tagEl.textContent  = 'tendência ilustrativa';
  if (noteEl) noteEl.textContent = 'Histórico real ainda está sendo construído — esta curva é uma estimativa até hoje.';
  const base = Math.max(currentTotal * 0.55, 1);
  const points = [base, base * 1.12, base * 1.28, base * 1.5, base * 1.74, currentTotal];
  const now = new Date();
  const months = [];
  for (let i = points.length - 1; i >= 0; i--)
    months.push(monthNames[new Date(now.getFullYear(), now.getMonth() - i, 1).getMonth()]);
  _drawEvoChart(points, months, '€');
}


