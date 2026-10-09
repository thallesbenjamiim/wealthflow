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
// Só fatos e números: o app acompanha a carteira, regras de investimento não entram aqui.
// ─────────────────────────────────────────
// Premissas da meta, as do plano original: retirada de 4% a.a. e inflação de ~3,94% a.a.
// (R$30 mil hoje ≈ R$65 mil em 20 anos). O patrimônio-alvo vai em valores de hoje E no do ano-alvo.
const META_RETIRADA = 0.04, META_INFLACAO = 0.0394;

function getProfile() {
  const rate = getRate();
  const cambio = 'R$' + fmtNum(rate);
  const selic = fmtNum(marketRates.selic ?? 13.75) + '%' + (marketRates.selicEstimada ? ' (ESTIMATIVA — dado do dia indisponível)' : '');
  const ipca = fmtNum(marketRates.ipca ?? 4.22) + '%' + (marketRates.ipcaEstimado ? ' (ESTIMATIVA)' : '');
  const fx = v => fmtNum(v || 0); // formato brasileiro (1.234,56): a IA repete o formato que recebe
  const btcEur = btcPriceEur ? (portfolioData.bitcoin * btcPriceEur).toFixed(0) : (portfolioData.bitcoin_invested_eur || 0);
  const alvoHoje = profileData.rendaPassivaAlvo * 12 / META_RETIRADA;
  const alvoNoAno = alvoHoje * Math.pow(1 + META_INFLACAO, Math.max(0, profileData.anoAlvo - new Date().getFullYear()));
  const mi = v => fmtNum(v / 1e6, 1);
  const plano = planoBrPct();
  const div = divisao6040(rate);
  const r = resumoParaIA; // números da última atualização do Início (custo por ativo, aportes, ritmo)

  // Resultado por ativo: quanto foi aportado (custo) × quanto vale hoje, na moeda do ativo
  const resultado = (nome, aportado, hoje, sym) => {
    if (!(aportado > 0) || !(hoje > 0)) return null;
    const p = (hoje - aportado) / aportado * 100;
    return `${nome} aportado ${sym}${fx(aportado)} → hoje ${sym}${fx(hoje)} (${p >= 0 ? '+' : ''}${fmtNum(p, 1)}%)`;
  };
  const varPct = (de, para) => de > 0 ? `${para >= de ? '+' : ''}${fmtNum((para - de) / de * 100, 1)}%` : '—';
  const porAtivo = r ? [
    ...ATIVOS.map(a => resultado(a.id, r.inv[a.id], portfolioData[a.key], a.moeda === 'BRL' ? 'R$' : '€')),
    resultado('Tesouro IPCA+', r.inv['IPCA+'], ipcaValor(), 'R$'),
    resultado('Bitcoin', r.inv['Bitcoin'], r.btcValueEur, '€')
  ].filter(Boolean).join(' · ') : '';
  const mes = r ? resumoAportesDoMes(r.docs, currentMonthKey(), rate) : null;
  const btcCusto = r ? (r.inv['Bitcoin'] || 0) : 0;

  // Projeções feitas pelo APP (a IA só cita — modelos rápidos erram juros compostos de cabeça):
  // patrimônio de hoje + ritmo real de aporte, juros mensais a 5% a.a. (conservador) e 8% a.a.
  // (otimista). Valores futuros, sem descontar a inflação; renda = retirada de 4% a.a.
  const projecoes = r ? [5, 10, 15, 20, 25, 30].map(anos => {
    const futuro = taxa => { const i = taxa / 12, n = anos * 12, f = Math.pow(1 + i, n); return r.totalEur * f + r.ritmo.eurMes * (f - 1) / i; };
    const c = futuro(0.05), o = futuro(0.08), eur = v => '€' + fmtNum(v, 0);
    return `${new Date().getFullYear() + anos}: ${eur(c)} a ${eur(o)} (≈R$${fmtNum(c * rate, 0)} a R$${fmtNum(o * rate, 0)} no câmbio de hoje), renda de ${eur(c * META_RETIRADA / 12)} a ${eur(o * META_RETIRADA / 12)}/mês`;
  }).join(' · ') : '';

  return `PERFIL — ${profileData.nome}, ${profileData.idade} anos, morando em ${profileData.pais} (${profileData.cidadania}), volta ao Brasil em ~${profileData.horizonteRetorno}. ${profileData.perfilRisco}.
HOJE (${new Date().toLocaleDateString('pt-BR')}): EUR/BRL ${cambio} · Selic ${selic} · IPCA 12m ${ipca}.
CARTEIRA ATUAL:
- Brasil (Nubank): ${ATIVOS_BR.filter(a => (portfolioData[a.key + '_cotas'] || 0) > 0 || (portfolioData[a.key] || 0) > 0).map(a => `${a.id} R$${fx(portfolioData[a.key])} (${portfolioData[a.key + '_cotas'] || 0} cotas${a.descricaoIA ? ', ' + a.descricaoIA : ''}${a.dividendos ? `, último dividendo R$${fx(divPerShare[a.key])}/cota/mês` : ''})`).join(' · ')} · Tesouro IPCA+ R$${fx(ipcaValor())}${portfolioData.ipca_mercado != null ? ` (valor de mercado; aplicado R$${fx(portfolioData.ipca)})` : " (valor aplicado)"} · Dividendos recebidos R$${fx(portfolioData.dividendos)}
- Internacional (Revolut): ${ATIVOS_INTL.map(a => `${a.id} €${fx(portfolioData[a.key])}`).join(' · ')} (${ATIVOS_INTL.length === 2 ? 'ambos' : 'todos'} Acc — não distribuem dividendos)
- Bitcoin (fora do plano): ${portfolioData.bitcoin || 0} BTC (~€${btcEur})
- Reserva de emergência (fora dos investimentos): €${fx(portfolioData.reserva)} de uma meta de €${fmtNum(profileData.reservaMetaEur, 0)}
${r ? `RESULTADO (o total INCLUI o Bitcoin): do bolso €${fx(r.investedEur)} → vale hoje €${fx(r.totalEur)} (${varPct(r.investedEur, r.totalEur)}). Sem o Bitcoin: €${fx(r.investedEur - btcCusto)} → €${fx(r.totalEur - r.btcValueEur)} (${varPct(r.investedEur - btcCusto, r.totalEur - r.btcValueEur)}). Por ativo: ${porAtivo || 'sem dados'}.\n` : ''}DIVISÃO 60/40 (carteira inteira, sem o Bitcoin): hoje ${div.brPct}% Brasil / ${div.intlPct}% Internacional. O plano é ${plano}/${100 - plano} e o ${profileData.nome} considera a carteira equilibrada com até ${FOLGA_6040} pontos de diferença (Brasil entre ${plano - FOLGA_6040}% e ${plano + FOLGA_6040}%) — hoje está ${div.dentro ? 'DENTRO da faixa (o selo do app mostra "Carteira equilibrada")' : 'FORA da faixa'}. O 60/40 se mede pela carteira inteira, não pelo aporte de um mês.
APORTES: plano de €${profileData.aporteMensalEur}/mês todo dia ${profileData.diaAporte} (€${profileData.aporteBrEur} Brasil + €${profileData.aporteIntlEur} Internacional), mais €${profileData.bitcoinMensalEur}/mês de Bitcoin por fora.${mes ? ` Registrado este mês (mês em andamento, até o dia ${new Date().getDate()}): ${mes.totalEur > 0 ? `€${fx(mes.totalEur)} (${mes.brPct}% Brasil / ${mes.intlPct}% Internacional)` : 'nenhum aporte ainda'}${mes.bitcoinEur > 0 ? ` + €${fx(mes.bitcoinEur)} em Bitcoin` : ''}. Ritmo real: ${r.ritmo.meses ? `€${fx(r.ritmo.eurMes)}/mês (média dos últimos ${r.ritmo.meses} meses)` : 'ainda sem mês fechado'}.` : ''}
${r ? `PROJEÇÕES (calculadas pelo app a partir do patrimônio de hoje, €${fx(r.totalEur)}, + ${r.ritmo.meses ? 'ritmo real' : 'plano'} de €${fx(r.ritmo.eurMes)}/mês; 5% a.a. conservador a 8% a.a. otimista; valores futuros, sem descontar a inflação; renda = retirada de 4% a.a.): ${projecoes}.\n` : ''}META: renda passiva de R$${fmtNum(profileData.rendaPassivaAlvo, 0)}/mês em valores de hoje em ${profileData.anoAlvo} — patrimônio-alvo ~R$${mi(alvoHoje)} mi em valores de hoje (~R$${mi(alvoNoAno)} mi em ${profileData.anoAlvo}, com inflação de ~4% a.a. e retirada de 4% a.a.). Meta intermediária do app: R$${fmtNum(profileData.metaIntermediariaBRL, 0)}.
FISCAL: Irlanda — Exit Tax 38% sobre os ETFs, deemed disposal 8 anos após CADA compra (o 1º, pelo histórico registrado, em ${primeiroDeemedDisposal ? primeiroDeemedDisposal.toLocaleDateString('pt-BR') : 'data a calcular'}; planejar liquidez 1 ano antes). Brasil — dividendos de FII isentos de IR no Brasil; Tesouro com IR retido na fonte. Na Irlanda, a tributação da renda brasileira (FIIs, Tesouro, BOVA11) e do Bitcoin depende da situação fiscal dele, e não há acordo Brasil–Irlanda contra bitributação: trate como "possível obrigação" e indique contador.`;
}

// ─────────────────────────────────────────
// ASSISTENTE ÚNICO (v2) — substitui os 5 agentes
// ─────────────────────────────────────────

const getAssistantSystem = () => `Você é o ASSISTENTE do WealthFlow, a carteira digital do ${profileData.nome}. O app serve para ACOMPANHAR os investimentos dele, não para decidir onde investir. Seu papel: explicar os números da carteira e tirar dúvidas sobre investimentos, impostos e conceitos.

COMO RESPONDER:
- Pergunta CONCEITUAL/educativa (ex: "o que é um FII?", "Acc vs Dist?"): responda como um bom professor, claro e neutro, SEM citar os dados pessoais do ${profileData.nome}.
- Pergunta sobre A CARTEIRA ou a situação dele: use os números reais do perfil abaixo e descreva o que eles mostram.
- NUNCA diga o que comprar, vender ou onde aportar, nem indique um ativo preferido — essa decisão é do ${profileData.nome}, fora do app. Se ele pedir, mostre os prós e contras de cada opção sem escolher por ele.
- Projeções: use SÓ os números da linha PROJEÇÕES do perfil — não calcule juros compostos de cabeça. Para um ano fora da lista, use o mais próximo e diga que é aproximado. Sempre cenário conservador E otimista, avisando que são valores futuros, sem descontar a inflação.
- Se perguntarem o que melhorar ou como está a carteira: compare com o plano dele (60/40 com a folga de 10 pontos, aporte mensal do plano) e diga o que está dentro e o que está fora, sem dar ordens. Um mês ainda em andamento não é desvio.
- Assunto fiscal: nunca aconselhamento definitivo — diga "possível obrigação fiscal" e recomende validação com contador qualificado.
- SEMPRE em português do Brasil.`;

const MODES = {
  risco:  { label: 'Risco', icon: 'shield',       system: 'PARA ESTA RESPOSTA: olhe a carteira pelo lado do risco — concentração em poucos ativos, equilíbrio Brasil/Internacional (pela faixa do plano, não por um mês) e exposição ao câmbio — e descreva o que os números mostram, sem recomendar compra, venda ou onde aportar.' },
  fiscal: { label: 'Fiscal', icon: 'scale',      system: 'PARA ESTA RESPOSTA: adote o olhar de um CONTADOR FISCAL Brasil+Irlanda — Exit Tax 38%, deemed disposal 8 anos após cada compra, Revenue (Form 11) e Receita Federal. Linguagem de "possível obrigação"; recomende validação com contador.' },
  // O ano vem do Perfil (getter: lido na hora da pergunta)
  longo:  { label: 'Longo prazo', icon: 'hourglass', get system() { return `PARA ESTA RESPOSTA: adote o olhar de um PLANEJADOR DE LONGO PRAZO — projeções realistas até ${profileData.anoAlvo} (cenário conservador e otimista) e disciplina emocional: quando o mercado cai, o plano não muda.`; } }
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
  alertas: ['Alertas', 'Lembretes e avisos'],
  config: ['Chaves de IA', 'Conecte o Gemini ou o Claude para ativar o Assistente'],
  perfil: ['Perfil e plano', 'Seus dados, metas e plano de aportes']
};

// 2º parâmetro (elemento do menu) é ignorado: o item ativo é achado pelo data-page.
// Mantido só para não quebrar chamadas antigas do tipo showPage('x', el).
function showPage(id) {
  if (!pageTitles[id]) id = 'dashboard';
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
