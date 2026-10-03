// WealthFlow — Estado global, modo teste, perfil do usuário, prompts do assistente e navegação.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// MODO TESTE — abra o app com ?teste=1 na URL.
// Nada é salvo no Firebase; o chat usa um histórico separado;
// aportes de teste ficam só em memória e somem ao recarregar.
// ─────────────────────────────────────────
const TEST_MODE = new URLSearchParams(location.search).get('teste') === '1';
let testAportes = [];
if (TEST_MODE) {
  document.title = '[TESTE] ' + document.title;
  const b = document.createElement('div');
  b.className = 'test-mode-badge';
  b.innerHTML = '<svg class="i"><use href="#i-flask"/></svg> Modo teste — nada é salvo';
  document.body.appendChild(b);
}

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────
let apiKey        = localStorage.getItem('wf_api_key')        || '';
let geminiKey     = localStorage.getItem('wf_gemini_key')     || '';
let activeProvider = localStorage.getItem('wf_active_provider') || 'gemini';

// ─────────────────────────────────────────
// OCULTAR VALORES (blur toggle, tipo app de banco)
// ─────────────────────────────────────────
let valuesHidden = localStorage.getItem('wf_values_hidden') === '1';

// Ícone do conjunto do app (sprite no index.html) — use no lugar de emojis
function icon(name, size) {
  const s = size ? ` width="${size}" height="${size}" style="width:${size}px;height:${size}px"` : '';
  return `<svg class="i"${s} aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Janela de confirmação do app (no lugar do confirm() do navegador). Devolve uma Promise<boolean>.
function confirmDialog(texto, { titulo = 'Confirmar', ok = 'Confirmar', perigo = false } = {}) {
  const modal = document.getElementById('modal');
  if (!modal) return Promise.resolve(confirm(texto));
  document.getElementById('modal-title').textContent = titulo;
  document.getElementById('modal-text').textContent = texto;
  const btnOk = document.getElementById('modal-ok');
  const btnCancel = document.getElementById('modal-cancel');
  btnOk.textContent = ok;
  btnOk.className = 'btn ' + (perigo ? 'btn-danger' : 'btn-primary');
  modal.hidden = false;
  btnOk.focus();
  return new Promise(resolve => {
    const fechar = r => {
      modal.hidden = true;
      btnOk.onclick = btnCancel.onclick = modal.onclick = null;
      document.removeEventListener('keydown', tecla);
      resolve(r);
    };
    const tecla = e => { if (e.key === 'Escape') fechar(false); };
    btnOk.onclick = () => fechar(true);
    btnCancel.onclick = () => fechar(false);
    modal.onclick = e => { if (e.target === modal) fechar(false); };
    document.addEventListener('keydown', tecla);
  });
}

function applyValuesVisibility() {
  document.body.classList.toggle('values-hidden', valuesHidden);
  const btn = document.getElementById('valueToggleBtn');
  const icon = document.getElementById('eyeIcon');
  if (btn) btn.classList.toggle('active', valuesHidden);
  if (icon) icon.setAttribute('href', valuesHidden ? '#i-eye-off' : '#i-eye');
  if (btn) btn.title = valuesHidden ? 'Mostrar valores' : 'Ocultar valores';
}

function toggleValuesVisibility() {
  valuesHidden = !valuesHidden;
  localStorage.setItem('wf_values_hidden', valuesHidden ? '1' : '0');
  applyValuesVisibility();
}
let proxyAvailable = false;
let proxyBase = 'http://localhost:3001'; // definido em checkProxy: /api no Vercel, localhost no PC
// v2: chat único (assistente unificado). As conversas antigas dos 5 agentes ficam
// nas chaves antigas do localStorage, não são migradas.
const CHAT_STORE_KEY = TEST_MODE ? 'wf_chat_v2_test' : 'wf_chat_v2';
let chatHistory = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_STORE_KEY));
    if (Array.isArray(saved)) return saved;
  } catch {}
  return [];
})();
function saveHistories() {
  try { localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(chatHistory)); } catch {}
}
let loading = false;
const CHAT_CONTEXT_MSGS = 20; // quantas mensagens recentes vão como contexto para a IA
let portfolioData = {
  mxrf11: 79.84, mxrf11_cotas: 8, mxrf11_preco: 9.98,
  hglg11: 0, hglg11_cotas: 0, hglg11_preco: 0,
  knri11: 0, knri11_cotas: 0, knri11_preco: 0,
  bova11: 0, bova11_cotas: 0, bova11_preco: 0,
  ipca: 118.47,
  selic: 0, caixinha: 152.63,
  vwce: 25.28, vwce_cotas: 0.1528491, vwce_preco: 165.39,
  euna: 14.97, euna_cotas: 3.04346061, euna_preco: 4.92,
  bitcoin: 0.00118117,
  bitcoin_invested_eur: 6,
  dividendos: 0.80,
  reserva: 0
};

// Ativos da lista única que ainda não têm campos na carteira começam zerados
ATIVOS.forEach(a => {
  ['', '_cotas', '_preco'].forEach(suf => { if (portfolioData[a.key + suf] === undefined) portfolioData[a.key + suf] = 0; });
});

// Soma o valor (na moeda do ativo) de um grupo da lista única — ATIVOS_BR em R$, ATIVOS_INTL em €
function somaAtivos(lista) {
  return lista.reduce((s, a) => s + (portfolioData[a.key] || 0), 0);
}

// Quanto o Tesouro IPCA+ VALE: o valor de mercado informado na conferência com a corretora
// (o Nubank mostra) quando existir; senão, o total aplicado. Não há fonte gratuita confiável
// para a cotação do título, e o app não guarda a quantidade de títulos — por isso é manual.
function ipcaValor() {
  return portfolioData.ipca_mercado != null ? portfolioData.ipca_mercado : (portfolioData.ipca || 0);
}

// Último dividendo real por cota (Brasil apenas) — atualizado por applyLivePrices() quando os
// dados de mercado chegam; os valores abaixo são só o fallback caso a fonte esteja fora do ar.
let divPerShare = Object.fromEntries(ATIVOS_DIVIDENDOS.flatMap(a => [[a.key, a.divPadrao], [a.key + 'Date', null]]));

// ─────────────────────────────────────────
// PERFIL DO USUÁRIO — editável na página Perfil, persistido no Firebase
// ─────────────────────────────────────────
let profileData = {
  nome: 'Thales',
  idade: 30,
  pais: 'Irlanda',
  cidadania: 'brasileiro, cidadania italiana',
  horizonteRetorno: '10-12 anos',
  perfilRisco: 'Conservador, longo prazo, sem trading',
  rendaPassivaAlvo: 30000,
  anoAlvo: 2046,
  metaIntermediariaBRL: 1000000,
  aporteMensalEur: 100,
  aporteBrEur: 60,
  aporteIntlEur: 40,
  diaAporte: '28/29',
  bitcoinMensalEur: 10,
  reservaMetaEur: 15000
};

async function loadProfile() {
  if (TEST_MODE) return;
  const db = window._db;
  const { doc, getDoc } = window._dbFns;
  try {
    const snap = await getDoc(doc(db, 'profile', 'main'));
    if (snap.exists()) profileData = { ...profileData, ...snap.data() };
  } catch (e) { console.error(e); }
}

async function saveProfile() {
  if (TEST_MODE) return;
  const db = window._db;
  const { doc, setDoc } = window._dbFns;
  await setDoc(doc(db, 'profile', 'main'), { ...profileData, updated: new Date().toISOString() });
}

function preencherPerfil() {
  document.getElementById('pf-nome').value = profileData.nome;
  document.getElementById('pf-idade').value = profileData.idade;
  document.getElementById('pf-pais').value = profileData.pais;
  document.getElementById('pf-cidadania').value = profileData.cidadania;
  document.getElementById('pf-horizonte').value = profileData.horizonteRetorno;
  document.getElementById('pf-risco').value = profileData.perfilRisco;
  setMaskedValue(document.getElementById('pf-renda'), profileData.rendaPassivaAlvo, 0);
  document.getElementById('pf-ano').value = profileData.anoAlvo;
  setMaskedValue(document.getElementById('pf-meta-app'), profileData.metaIntermediariaBRL, 0);
  document.getElementById('pf-aporte-total').value = (profileData.aporteBrEur || 0) + (profileData.aporteIntlEur || 0);
  document.getElementById('pf-aporte-br').value = profileData.aporteBrEur;
  document.getElementById('pf-aporte-intl').value = profileData.aporteIntlEur;
  document.getElementById('pf-dia').value = profileData.diaAporte;
  document.getElementById('pf-btc').value = profileData.bitcoinMensalEur;
  document.getElementById('pf-reserva-meta').value = profileData.reservaMetaEur;
}

// O total do plano é sempre Brasil + Internacional (não é digitado à parte, para nunca divergir)
function atualizarTotalAporte() {
  const v = id => parseFloat(document.getElementById(id).value) || 0;
  document.getElementById('pf-aporte-total').value = v('pf-aporte-br') + v('pf-aporte-intl');
}

async function salvarPerfil() {
  const num = (id, fallback) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? fallback : v; };
  const numMasked = (id, fallback) => { const v = parsePtBrNumber(document.getElementById(id).value); return isNaN(v) ? fallback : v; };
  const txt = (id, fallback) => { const v = document.getElementById(id).value.trim(); return v || fallback; };

  profileData = {
    ...profileData,
    nome: txt('pf-nome', profileData.nome),
    idade: num('pf-idade', profileData.idade),
    pais: txt('pf-pais', profileData.pais),
    cidadania: txt('pf-cidadania', profileData.cidadania),
    horizonteRetorno: txt('pf-horizonte', profileData.horizonteRetorno),
    perfilRisco: txt('pf-risco', profileData.perfilRisco),
    rendaPassivaAlvo: numMasked('pf-renda', profileData.rendaPassivaAlvo),
    anoAlvo: num('pf-ano', profileData.anoAlvo),
    metaIntermediariaBRL: numMasked('pf-meta-app', profileData.metaIntermediariaBRL),
    aporteBrEur: num('pf-aporte-br', profileData.aporteBrEur),
    aporteIntlEur: num('pf-aporte-intl', profileData.aporteIntlEur),
    diaAporte: txt('pf-dia', profileData.diaAporte),
    bitcoinMensalEur: num('pf-btc', profileData.bitcoinMensalEur),
    reservaMetaEur: num('pf-reserva-meta', profileData.reservaMetaEur)
  };
  profileData.aporteMensalEur = (profileData.aporteBrEur || 0) + (profileData.aporteIntlEur || 0);

  try {
    await saveProfile();
    refreshDerivedFromProfile();
    updateDashboard(getRate());
    showToast('✓ Perfil salvo!');
  } catch (e) {
    showToast('❌ Erro ao salvar perfil. Verifique a conexão.');
    console.error(e);
  }
}

// ─────────────────────────────────────────
// PERFIL COMPACTO — enviado ao assistente em toda pergunta
// (versão enxuta: só os dados que mudam as respostas; o resto vive no system prompt)
// ─────────────────────────────────────────
function getProfile() {
  const cambio = 'R$' + fmtNum(getRate());
  const selic = fmtNum(marketRates.selic ?? 13.75) + '%' + (marketRates.selicEstimada ? ' (ESTIMATIVA — dado do dia indisponível; não tire conclusões de gatilho com ela)' : '');
  const ipca = fmtNum(marketRates.ipca ?? 4.22) + '%' + (marketRates.ipcaEstimado ? ' (ESTIMATIVA)' : '');
  const fx = v => (v || 0).toFixed(2);
  const btcEur = btcPriceEur ? (portfolioData.bitcoin * btcPriceEur).toFixed(0) : (portfolioData.bitcoin_invested_eur || 0);
  const patrimonioAlvo = (profileData.rendaPassivaAlvo * 650 / 1000000).toFixed(1);

  return `PERFIL — ${profileData.nome}, ${profileData.idade} anos, morando em ${profileData.pais} (${profileData.cidadania}), volta ao Brasil em ~${profileData.horizonteRetorno}. ${profileData.perfilRisco}.
HOJE (${new Date().toLocaleDateString('pt-BR')}): EUR/BRL ${cambio} · Selic ${selic} · IPCA 12m ${ipca}.
CARTEIRA ATUAL:
- Brasil (Nubank): ${ATIVOS_BR.filter(a => (portfolioData[a.key + '_cotas'] || 0) > 0 || (portfolioData[a.key] || 0) > 0).map(a => `${a.id} R$${fx(portfolioData[a.key])} (${portfolioData[a.key + '_cotas'] || 0} cotas${a.descricaoIA ? ', ' + a.descricaoIA : ''}${a.dividendos ? `, último dividendo R$${divPerShare[a.key]}/cota/mês` : ''})`).join(' · ')} · Tesouro IPCA+ R$${fx(ipcaValor())}${portfolioData.ipca_mercado != null ? ` (valor de mercado; aplicado R$${fx(portfolioData.ipca)})` : " (valor aplicado)"} · Caixinha CDI R$${fx(portfolioData.caixinha)} (liquidez temporária entre aportes) · Dividendos recebidos R$${fx(portfolioData.dividendos)}
- Internacional (Revolut): ${ATIVOS_INTL.map(a => `${a.id} €${fx(portfolioData[a.key])}`).join(' · ')} (${ATIVOS_INTL.length === 2 ? 'ambos' : 'todos'} Acc — sem imposto anual de dividendos)
- Bitcoin informal (fora do plano): ${portfolioData.bitcoin || 0} BTC (~€${btcEur})
- Reserva de emergência (fora do plano de investimento, intocável): €${fx(portfolioData.reserva)} de uma meta de €${profileData.reservaMetaEur}
META: renda passiva de R$${fmtNum(profileData.rendaPassivaAlvo, 0)}/mês em valores de hoje aos ${profileData.anoAlvo} — patrimônio-alvo ~R$${patrimonioAlvo} mi. Meta intermediária do app: R$${fmtNum(profileData.metaIntermediariaBRL, 0)}.
APORTE: €${profileData.aporteMensalEur}/mês todo dia ${profileData.diaAporte} (€${profileData.aporteBrEur} Brasil + €${profileData.aporteIntlEur} Internacional). Referência 60/40 Brasil/Internacional — é referência, não regra rígida; EUNA sempre considerado no lado internacional. Bitcoin €${profileData.bitcoinMensalEur}/mês informal. Reserva de emergência €${profileData.reservaMetaEur} separada e INTOCÁVEL.
REGRAS DO PLANO: NUNCA Tesouro Selic (Caixinha é liquidez temporária — sempre direcionar ao ativo mais adequado); nunca day trade/alavancagem/margem/especulação; reinvestir 100% dos dividendos; aportar todo mês independente do mercado; só realocar em desvio ESTRUTURAL (oscilação cambial de semanas é ruído); mudanças graduais (5-10% por vez); KNRI11 já faz parte dos FIIs acompanhados, ao lado de MXRF11 e HGLG11.
FISCAL: Irlanda — Exit Tax 38% sobre ETFs, deemed disposal 8 anos após CADA compra (o 1º, pelo histórico registrado, em ${primeiroDeemedDisposal ? primeiroDeemedDisposal.toLocaleDateString('pt-BR') : 'data a calcular'}; planejar liquidez 1 ano antes). Brasil — dividendos de FII isentos de IR; Tesouro com IR retido na fonte.
GATILHOS: Selic <10% → migrar aporte renda fixa p/ FIIs e internacional; Selic <7% → realocar gradual BR→Intl; ETFs -20% → comprar mais; 2 anos antes de voltar ao Brasil → parar ETFs europeus e converter gradualmente.`;
}

// ─────────────────────────────────────────
// ASSISTENTE ÚNICO (v2) — substitui os 5 agentes
// ─────────────────────────────────────────

const getAssistantSystem = () => `Você é o ASSISTENTE do WealthFlow, a carteira digital inteligente do ${profileData.nome}. Você cobre todos os assuntos num só lugar: alocação e rebalanceamento, dividendos e reinvestimento, projeções de longo prazo, questões fiscais (Brasil + Irlanda) e gestão de risco — além de dúvidas conceituais sobre investimentos.

COMO RESPONDER:
- Pergunta CONCEITUAL/educativa (ex: "o que é um FII?", "Acc vs Dist?"): responda como um bom professor, claro e neutro, SEM citar os dados pessoais do ${profileData.nome}.
- Pergunta sobre A CARTEIRA ou a situação dele: use os números reais do perfil abaixo.
- Dividendo informado: mostrar o efeito composto de reinvestir em cada ativo Brasil elegível (FIIs ou IPCA+ — nunca Selic), sem indicar uma preferida — a escolha é do ${profileData.nome}.
- Projeções: sempre cenário conservador E otimista, com números.
- Assunto fiscal: nunca aconselhamento definitivo — diga "possível obrigação fiscal" e recomende validação com contador qualificado.
- Risco/desvio estrutural detectado: alerte com motivo, risco e sugestão — a decisão final é sempre do ${profileData.nome}. Nada é executado automaticamente.
- NUNCA incentivar: day trade, alavancagem, margem, ETFs alavancados, especulação, Tesouro Selic.
- SEMPRE em português do Brasil.`;

const MODES = {
  risco:  { label: 'Risco', icon: 'shield',       system: 'PARA ESTA RESPOSTA: adote o olhar de um GESTOR DE RISCO conservador — proteção patrimonial antes de retorno; foque concentração, equilíbrio Brasil/Internacional e exposição cambial estrutural.' },
  fiscal: { label: 'Fiscal', icon: 'scale',      system: 'PARA ESTA RESPOSTA: adote o olhar de um CONTADOR FISCAL Brasil+Irlanda — Exit Tax 38%, deemed disposal 8 anos após cada compra, Revenue (Form 11) e Receita Federal. Linguagem de "possível obrigação"; recomende validação com contador.' },
  longo:  { label: 'Longo prazo', icon: 'hourglass', system: 'PARA ESTA RESPOSTA: adote o olhar de um PLANEJADOR DE LONGO PRAZO — projeções realistas até 2046 (cenário conservador e otimista) e disciplina emocional: quando o mercado cai, o plano não muda.' }
};
let chatMode = null;

const QUICK_QUESTIONS = [
  'Minha carteira está equilibrada?',
  'Qual a concentração de risco atual?',
  'Como está minha rentabilidade real?',
  'O que é deemed disposal?'
];

const getWelcome = () => `Olá ${profileData.nome}! Sou o <strong>assistente do WealthFlow</strong> — pergunte qualquer coisa: carteira, dividendos, projeções, impostos ou conceitos de investimento.<br><br>Hoje o câmbio está em <strong id="w0-cambio">—</strong> e a Selic em <strong id="w0-selic">—</strong> — os €${profileData.aporteBrEur} do lado Brasil valem <strong id="w0-brl">—</strong>.`;

// ─────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────
const pageTitles = {
  dashboard: ['Início', 'Sua situação em um olhar'],
  carteira: ['Carteira', 'Tudo o que você tem, quanto vale e quanto rendeu'],
  agentes: ['Assistente', 'Pergunte sobre sua carteira, impostos ou investimentos'],
  aportar: ['Registrar aporte', 'Atualize a carteira depois de cada compra'],
  alertas: ['Alertas', 'Gatilhos do seu plano e avisos importantes'],
  config: ['Chaves de IA', 'Conecte o Gemini ou o Claude para ativar o Assistente'],
  perfil: ['Perfil e plano', 'Seus dados, metas e plano de aportes']
};

// 2º parâmetro (elemento do menu) é ignorado: o item ativo é achado pelo data-page.
// Mantido só para não quebrar chamadas antigas do tipo showPage('x', el).
function showPage(id) {
  if (!pageTitles[id]) id = 'dashboard';
  // Ao sair de Alertas, a nota atual do Score passa a ser a "vista" (o aviso "subiu/caiu" compara com ela)
  if (id !== 'alertas' && document.getElementById('page-alertas')?.classList.contains('active') && typeof scoreAtual !== 'undefined' && scoreAtual) {
    try { localStorage.setItem('wf_score_visto', JSON.stringify({ total: scoreAtual.total })); } catch {}
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.nav-item, .bnav-item').forEach(n => n.classList.toggle('active', n.dataset.page === id));
  document.getElementById('pageTitle').textContent = pageTitles[id][0];
  document.getElementById('pageSub').textContent = pageTitles[id][1];
  const mt = document.getElementById('mobilePageTitle');
  if (mt) mt.textContent = pageTitles[id][0];
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  if (id === 'agentes') initAgents();
  if (id === 'aportar') { loadHistorico(); renderAporteGuide(); }
  if (id === 'alertas') renderAlertas();
  if (id === 'config')  updateKeyStatus();
  if (id === 'perfil')  { preencherPerfil(); atualizarStatusPush(); }
  if (id === 'carteira') {
    renderWallet(getRate());
    restoreLastAnalysis();
  }
  closeSidebar();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}
