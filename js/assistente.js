// WealthFlow — Evolução por ativo, chat do assistente e chaves de API.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// EVOLUÇÃO POR ATIVO
// ─────────────────────────────────────────
let _evoAportes = null;
let _lastTotalEur = 0;

async function loadAportesForEvo() {
  // Em modo teste, os aportes de teste (só em memória) entram no gráfico junto com os do Firebase
  const withTest = docs => TEST_MODE ? [...docs, ...testAportes.filter(d => d.tipo !== 'ajuste' && !d._excluido)] : docs;
  if (_evoAportes) return withTest(_evoAportes);
  const db = window._db;
  if (!db) return withTest([]);
  const { collection, getDocs, query, orderBy } = window._dbFns;
  try {
    const q = query(collection(db, 'aportes'), orderBy('timestamp', 'asc'));
    const snap = await getDocs(q);
    // Ajustes de conferência (valor 0) só corrigem a carteira — não são aporte de dinheiro
    _evoAportes = snap.docs.map(d => d.data()).filter(d => d.tipo !== 'ajuste');
    return withTest(_evoAportes);
  } catch(e) {
    return withTest([]);
  }
}

function populateEvoFromPortfolio() {
  const sel = document.getElementById('evo-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="total">Total (€)</option>';

  const candidates = [
    { value: 'MXRF11',   label: 'MXRF11',       active: (portfolioData.mxrf11 || 0) > 0 || (portfolioData.mxrf11_cotas || 0) > 0 },
    { value: 'HGLG11',   label: 'HGLG11',       active: (portfolioData.hglg11 || 0) > 0 || (portfolioData.hglg11_cotas || 0) > 0 },
    { value: 'KNRI11',   label: 'KNRI11',       active: (portfolioData.knri11 || 0) > 0 || (portfolioData.knri11_cotas || 0) > 0 },
    { value: 'IPCA+',    label: 'IPCA+',        active: (portfolioData.ipca || 0) > 0 },
    { value: 'Selic',    label: 'Selic',        active: (portfolioData.selic || 0) > 0 },
    { value: 'Caixinha', label: 'Caixinha CDI', active: (portfolioData.caixinha || 0) > 0 },
    { value: 'VWCE',     label: 'VWCE',         active: (portfolioData.vwce || 0) > 0 || (portfolioData.vwce_cotas || 0) > 0 },
    { value: 'EUNA',     label: 'EUNA',         active: (portfolioData.euna || 0) > 0 || (portfolioData.euna_cotas || 0) > 0 },
    { value: 'Bitcoin',  label: 'Bitcoin',      active: (portfolioData.bitcoin || 0) > 0 || (portfolioData.bitcoin_invested_eur || 0) > 0 },
  ];

  candidates.filter(c => c.active).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.value;
    opt.textContent = c.label;
    sel.appendChild(opt);
  });

  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function populateEvoDropdown(docs) {
  const sel = document.getElementById('evo-select');
  if (!sel || !docs.length) return;
  const existing = new Set([...sel.options].map(o => o.value));
  const assets = [...new Set(docs.map(d => d.ativo))];
  assets.forEach(a => {
    if (!existing.has(a)) {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      sel.appendChild(opt);
    }
  });
}

const _EVO_ASSET = {
  'MXRF11':   { get: () => portfolioData.mxrf11 || 0,              sym: 'R$' },
  'HGLG11':   { get: () => portfolioData.hglg11 || 0,              sym: 'R$' },
  'KNRI11':   { get: () => portfolioData.knri11 || 0,              sym: 'R$' },
  'IPCA+':    { get: () => ipcaValor(),               sym: 'R$' },
  'Selic':    { get: () => portfolioData.selic || 0,               sym: 'R$' },
  'Caixinha': { get: () => portfolioData.caixinha || 0,            sym: 'R$' },
  'VWCE':     { get: () => portfolioData.vwce || 0,                sym: '€'  },
  'EUNA':     { get: () => portfolioData.euna || 0,                sym: '€'  },
  'Bitcoin':  { get: () => btcPriceEur ? (portfolioData.bitcoin || 0) * btcPriceEur : (portfolioData.bitcoin_invested_eur || 0), sym: '€' },
};

function renderEvoForAsset(ativo, docs) {
  const info = _EVO_ASSET[ativo];
  const sym = info?.sym ?? '€';
  const monthNames = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const filtered = docs.filter(d => d.ativo === ativo);

  let points = [], months = [], isReal = false;

  if (filtered.length > 0) {
    // Dados reais do Firebase — cada aporte convertido para a moeda nativa do ativo
    // (um aporte de FII informado em € não pode somar como se fosse R$)
    const rate = getRate();
    const nativeCur = ASSET_CURRENCY[ativo] || 'EUR';
    const byMonth = {};
    filtered.forEach(d => {
      const key = monthKeyOf(d.data);
      if (!key) return;
      let v = parseFloat(d.valor) || 0;
      if (d.moeda === 'EUR' && nativeCur === 'BRL') v *= rate;
      if (d.moeda === 'BRL' && nativeCur === 'EUR') v /= rate;
      if (ativo === 'Reserva' && d.tipo === 'retirada') v = -v;
      byMonth[key] = (byMonth[key] || 0) + v;
    });
    const sortedKeys = Object.keys(byMonth).sort();
    let cumulative = 0;
    sortedKeys.forEach(key => {
      cumulative += byMonth[key];
      months.push(monthNames[parseInt(key.split('-')[1]) - 1]);
      points.push(cumulative);
    });
    if (points.length === 1) { months.unshift('início'); points.unshift(0); }
    isReal = true;
  } else {
    // Sem aportes no Firebase — curva ilustrativa a partir do valor atual
    const cur = info?.get() || 0;
    if (cur <= 0) return;
    const base = cur * 0.55;
    points = [base, base * 1.12, base * 1.28, base * 1.5, base * 1.74, cur];
    const now = new Date();
    for (let i = points.length - 1; i >= 0; i--) {
      months.push(monthNames[new Date(now.getFullYear(), now.getMonth() - i, 1).getMonth()]);
    }
  }

  const tagEl  = document.getElementById('evo-tag');
  const noteEl = document.querySelector('.evo-note');
  if (tagEl)  tagEl.textContent  = isReal ? 'dados reais' : 'tendência ilustrativa';
  // Valor de mercado de hoje como trecho tracejado — só para posições de investimento
  // (Caixinha, Dividendo e afins não têm "valor de mercado" diferente do registrado)
  const MERCADO = ['MXRF11', 'HGLG11', 'KNRI11', 'VWCE', 'EUNA', 'Bitcoin'];
  const nowVal = isReal && MERCADO.includes(ativo) && info ? info.get() : null;

  if (noteEl) noteEl.textContent = isReal
    ? `Linha cheia: quanto você aportou em ${ativo}, acumulado.${nowVal !== null ? ' Tracejado dourado: quanto vale hoje.' : ''}`
    : `Curva estimada para ${ativo} — registre aportes para ver dados reais.`;

  _drawEvoChart(points, months, sym, nowVal);
}

async function onEvoChange() {
  const val = document.getElementById('evo-select')?.value;
  if (!val || val === 'total') {
    renderEvolution(_lastTotalEur);
    return;
  }
  const docs = await loadAportesForEvo();
  renderEvoForAsset(val, docs);
}

// ─────────────────────────────────────────
// AGENTS
// ─────────────────────────────────────────
function initAgents() {
  document.getElementById('apiNotice').style.display = (apiKey || geminiKey) ? 'none' : 'flex';

  const qa = document.getElementById('quickArea');
  qa.innerHTML = '';
  QUICK_QUESTIONS.forEach(q => {
    const btn = document.createElement('button');
    btn.className = 'qbtn';
    btn.textContent = q;
    btn.addEventListener('click', () => sendQuick(q));
    qa.appendChild(btn);
  });

  const ma = document.getElementById('modeArea');
  ma.innerHTML = '<span class="mode-label">Tom da resposta:</span>';
  Object.entries(MODES).forEach(([key, m]) => {
    const btn = document.createElement('button');
    btn.className = 'qbtn mode' + (chatMode === key ? ' active' : '');
    btn.id = 'mode-' + key;
    btn.innerHTML = icon(m.icon) + ' ' + m.label;
    btn.title = 'Responder com o olhar de ' + m.label.toLowerCase() + ' (clique de novo para desligar)';
    btn.addEventListener('click', () => toggleMode(key));
    ma.appendChild(btn);
  });

  renderMsgs();
}

function toggleMode(key) {
  chatMode = chatMode === key ? null : key;
  document.querySelectorAll('.qbtn.mode').forEach(b => b.classList.toggle('active', b.id === 'mode-' + chatMode));
}

async function clearChat() {
  if (chatHistory.length && !await confirmDialog('As mensagens desta conversa serão apagadas deste aparelho.', { titulo: 'Limpar a conversa?', ok: 'Limpar', perigo: true })) return;
  chatHistory = [];
  saveHistories();
  renderMsgs();
}

function renderMsgs() {
  const msgs = document.getElementById('msgs');
  msgs.innerHTML = '';

  if (chatHistory.length === 0) {
    msgs.innerHTML += buildAgentMsg(getWelcome(), true);
    // Update welcome with real data
    setTimeout(() => {
      const w0c = document.getElementById('w0-cambio');
      const w0s = document.getElementById('w0-selic');
      const w0b = document.getElementById('w0-brl');
      if(w0c) w0c.textContent = 'R$' + fmtNum(getRate());
      if(w0s) w0s.textContent = selicLabel();
      if(w0b) w0b.textContent = 'R$' + fmtNum(profileData.aporteBrEur * getRate(), 0);
    }, 500);
  } else {
    chatHistory.forEach(m => {
      if (m.role === 'user') msgs.innerHTML += buildUserMsg(m.content);
      else msgs.innerHTML += buildAgentMsg(m.content);
    });
  }
  // Sugestões rápidas só aparecem em conversa nova — depois liberam espaço p/ mensagens
  const qa = document.getElementById('quickArea');
  if (qa) qa.style.display = chatHistory.length === 0 ? '' : 'none';
  msgs.scrollTop = msgs.scrollHeight;
}

// raw = HTML do próprio app (boas-vindas); qualquer texto vindo da IA passa pelo mdLite, que escapa antes
function buildAgentMsg(text, raw = false) {
  const fmt = raw ? text : mdLite(text);
  return `<div class="msg agent"><div class="mavatar">${icon('sparkles')}</div><div><div class="mbubble">${fmt}</div></div></div>`;
}

function buildUserMsg(text) {
  const inicial = (profileData.nome || 'T').charAt(0).toUpperCase();
  return `<div class="msg user"><div class="mavatar">${escapeHtml(inicial)}</div><div><div class="mbubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div></div></div>`;
}

function sendQuick(t) { document.getElementById('userInput').value = t; sendMsg(); }

async function sendMsg() {
  if (loading) return;
  const inp = document.getElementById('userInput');
  const text = inp.value.trim();
  if (!text) return;

  if (!apiKey && !geminiKey) {
    showPage('config');
    showToast('⚠️ Configure sua chave API primeiro!');
    return;
  }

  const msgs = document.getElementById('msgs');
  inp.value = ''; inp.style.height = 'auto';

  msgs.innerHTML += buildUserMsg(text);
  chatHistory.push({ role: 'user', content: text });
  saveHistories();
  const qa = document.getElementById('quickArea');
  if (qa) qa.style.display = 'none';

  const tid = 'typing-' + Date.now();
  msgs.innerHTML += `<div class="msg agent" id="${tid}"><div class="mavatar">${icon('sparkles')}</div><div class="typing"><div class="tdot"></div><div class="tdot"></div><div class="tdot"></div></div></div>`;
  msgs.scrollTop = msgs.scrollHeight;

  loading = true;
  document.getElementById('sbtn').disabled = true;

  try {
    const modeCtx = chatMode ? '\n\n' + MODES[chatMode].system : '';
    const styleReminder = '\n\nLEMBRETE FINAL (PRIORIDADE MÁXIMA, sobrepõe qualquer instrução anterior de formato): responda em NO MÁXIMO 120 palavras, em texto corrido, SEM títulos, SEM seções e SEM listas com asteriscos. Mesmo que mensagens anteriores desta conversa tenham sido longas e estruturadas, a partir de agora responda curto. Se precisar aprofundar, resuma e pergunte se o ' + profileData.nome + ' quer os detalhes.';
    const fullSystem = getAssistantSystem() + '\n\n' + getProfile() + modeCtx + styleReminder;
    // Só as últimas mensagens vão para a IA: o custo não cresce para sempre com a conversa.
    // A janela sempre começa numa mensagem do usuário (exigência das APIs).
    let janela = chatHistory.slice(-CHAT_CONTEXT_MSGS);
    while (janela.length && janela[0].role !== 'user') janela = janela.slice(1);
    const reply = await callAI(fullSystem, janela, 450);
    chatHistory.push({ role: 'assistant', content: reply });
    saveHistories();

    const el = document.getElementById(tid);
    if (el) el.innerHTML = `<div class="mavatar">${icon('sparkles')}</div><div><div class="mbubble">${mdLite(reply)}</div></div>`;

  } catch (err) {
    chatHistory.pop();
    saveHistories();
    const el = document.getElementById(tid);
    const msg = err.message.includes('401') ? 'Chave de IA inválida. Confira em Chaves de IA.' : `Não foi possível responder: ${escapeHtml(err.message)}`;
    if (el) { el.classList.add('error'); el.innerHTML = `<div class="mavatar">${icon('alert')}</div><div><div class="mbubble">${msg}</div></div>`; }
  }

  loading = false;
  document.getElementById('sbtn').disabled = false;
  msgs.scrollTop = msgs.scrollHeight;
}

// ─────────────────────────────────────────
// API KEY
// ─────────────────────────────────────────
function updateKeyStatus() {
  const geminiEl    = document.getElementById('gemini-status');
  const anthropicEl = document.getElementById('anthropic-status');
  if (!geminiEl || !anthropicEl) return;

  const ATIVO   = `<span class="pill-tag active-state">Ativo</span>`;
  const INATIVO = `<span class="pill-tag inactive-state">Inativo</span>`;

  const geminiAtivo    = geminiKey    && activeProvider === 'gemini';
  const anthropicAtivo = apiKey       && activeProvider === 'anthropic';

  geminiEl.innerHTML    = geminiKey    ? (geminiAtivo    ? ATIVO : INATIVO) : '';
  anthropicEl.innerHTML = apiKey       ? (anthropicAtivo ? ATIVO : INATIVO) : '';
}

function saveGeminiKey() {
  const val = document.getElementById('geminiKeyInput').value.trim();
  if (!val || val.length < 10) { showToast('⚠️ Chave inválida.'); return; }
  geminiKey = val;
  activeProvider = 'gemini';
  localStorage.setItem('wf_gemini_key', geminiKey);
  localStorage.setItem('wf_active_provider', 'gemini');
  localStorage.removeItem('wf_suggestion_cache');
  updateKeyStatus();
  showToast('✓ Gemini conectado');
  setTimeout(() => showPage('agentes'), 800);
}

function saveApiKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val || !val.startsWith('sk-ant')) { showToast('⚠️ Chave inválida — deve começar com sk-ant...'); return; }
  apiKey = val;
  activeProvider = 'anthropic';
  localStorage.setItem('wf_api_key', apiKey);
  localStorage.setItem('wf_active_provider', 'anthropic');
  localStorage.removeItem('wf_suggestion_cache');
  updateKeyStatus();
  showToast('✓ Claude conectado');
  setTimeout(() => showPage('agentes'), 800);
}

