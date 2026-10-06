// WealthFlow — Aportes: registro, histórico (editar/excluir), carteira no Firebase e backup.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// SEED — aportes iniciais de maio/2026
// ─────────────────────────────────────────
async function seedMayAportes() {
  if (TEST_MODE) return;
  if (localStorage.getItem('wf_aportes_may2026')) return;
  const db = window._db;
  if (!db) return;
  const { collection, addDoc, getDocs } = window._dbFns;

  // Guarda contra reseed: localStorage não é confiável (novo device/browser sempre está vazio),
  // então confirma no próprio Firestore se o lote inicial já existe antes de inserir de novo.
  try {
    const existing = await getDocs(collection(db, 'aportes'));
    const alreadySeeded = existing.docs.some(d => d.data().data === '2026-05-28' && d.data().nota === 'Primeiro aporte');
    if (alreadySeeded) {
      localStorage.setItem('wf_aportes_may2026', '1');
      return;
    }
  } catch (e) { return; }

  const base = new Date('2026-05-28T20:00:00').getTime();
  const entries = [
    { ativo: 'MXRF11',   valor: 79.84,  moeda: 'BRL', qtd: '8', nota: 'Primeiro aporte',                      data: '2026-05-28', timestamp: base },
    { ativo: 'IPCA+',    valor: 118.47, moeda: 'BRL', qtd: '',  nota: 'Primeiro aporte',                      data: '2026-05-28', timestamp: base + 1 },
    { ativo: 'Caixinha', valor: 152.63, moeda: 'BRL', qtd: '',  nota: 'Caixinha CDI — aguardando Tesouro Selic', data: '2026-05-28', timestamp: base + 2 },
    { ativo: 'VWCE',     valor: 25,     moeda: 'EUR', qtd: '',  nota: 'Primeiro aporte',                      data: '2026-05-28', timestamp: base + 3 },
    { ativo: 'EUNA',     valor: 15,     moeda: 'EUR', qtd: '',  nota: 'Primeiro aporte',                      data: '2026-05-28', timestamp: base + 4 },
  ];
  try {
    for (const e of entries) await addDoc(collection(db, 'aportes'), e);
    _evoAportes = null;
    localStorage.setItem('wf_aportes_may2026', '1');
    showToast('✓ Aportes iniciais de maio registrados!');
    renderEvolution(_lastTotalEur);
  } catch(e) {
    console.error('seedMayAportes:', e);
  }
}

// ─────────────────────────────────────────
// FIREBASE — APORTES
// ─────────────────────────────────────────
// Ativos negociados em cotas: a carteira calcula o valor deles como cotas × preço,
// então um aporte sem quantidade seria apagado na próxima atualização de mercado.
const COTA_ASSETS = ATIVOS.map(a => a.id);


// Lado do 60/40 de um registro: os ativos da lista única dizem o lado; o Tesouro é Brasil
function ladoDoAporte(d) {
  return ATIVO_POR_ID[d.ativo]?.lado || (['IPCA+', 'Selic'].includes(d.ativo) ? 'br' : null);
}

// Soma os aportes de um mês pela regra única (ehAporte, em ativos.js), em €, separando Brasil e
// Internacional. Valores em reais viram euro pelo câmbio do dia do registro. O Bitcoin vem à
// parte: é dinheiro investido, mas fora do plano.
function resumoAportesDoMes(docs, mesKey, rate) {
  let br = 0, intl = 0, bitcoin = 0;
  (docs || []).forEach(d => {
    if (monthKeyOf(d.data) !== mesKey || d.tipo === 'ajuste') return;
    const v = parseFloat(d.valor) || 0;
    const eur = d.moeda === 'EUR' ? v : v / (d.cambio || rate);
    if (d.ativo === 'Bitcoin') bitcoin += eur;
    else if (ehAporte(d)) { if (ladoDoAporte(d) === 'intl') intl += eur; else br += eur; }
  });
  const total = br + intl;
  const brPct = total > 0 ? Math.round((br / total) * 100) : 0;
  return { totalEur: total, brEur: br, intlEur: intl, brPct, intlPct: total > 0 ? 100 - brPct : 0, bitcoinEur: bitcoin };
}

// Ritmo real de aporte: média por mês dos últimos 6 meses fechados (ou desde o 1º aporte, se
// houver menos). Sem nenhum mês fechado ainda, vale o aporte do plano (Perfil).
function ritmoDeAporte(docs, rate) {
  const primeiro = (docs || []).filter(ehAporte).map(d => monthKeyOf(d.data)).filter(Boolean).sort()[0];
  let soma = 0, meses = 0;
  if (primeiro) {
    for (let i = 1; i <= 6; i++) {
      const key = currentMonthKey(-i);
      if (key < primeiro) break;
      soma += resumoAportesDoMes(docs, key, rate).totalEur;
      meses++;
    }
  }
  return meses ? { eurMes: soma / meses, meses } : { eurMes: profileData.aporteMensalEur || 0, meses: 0 };
}

// Resumo neutro do mês: quanto você registrou de verdade, comparado com o plano, e a divisão
// Brasil/Internacional — sem indicar o que comprar a seguir (a decisão de alocação é do usuário).
async function renderAporteGuide() {
  const textEl = document.getElementById('guide-text');
  if (!textEl) return;
  const docs = await loadAportesForEvo().catch(() => []);
  const m = resumoAportesDoMes(docs, currentMonthKey(), getRate());
  const plano = profileData.aporteMensalEur;
  const pb = planoBrPct();
  const btc = m.bitcoinEur > 0 ? ` Mais €${fmtNum(m.bitcoinEur)} em Bitcoin, fora do plano.` : '';
  if (m.totalEur <= 0) {
    textEl.innerHTML = 'Nenhum aporte registrado este mês ainda.' + btc;
    return;
  }
  textEl.innerHTML = `Você aportou <strong>€${fmtNum(m.totalEur)}</strong> este mês${plano ? ` (plano: €${fmtNum(plano, 0)})` : ''} — <strong>${m.brPct}% Brasil</strong> / <strong>${m.intlPct}% Internacional</strong> (referência ${pb}/${100 - pb}).${btc}`;
}

// Tesouro Selic não faz parte do plano: só aparece no formulário se já existir saldo nele
function garantirOpcaoSelic() {
  const sel = document.getElementById('f-ativo');
  if (!sel) return;
  const existe = sel.querySelector('option[value="Selic"]');
  if ((portfolioData.selic || 0) > 0 && !existe) {
    const opt = document.createElement('option');
    opt.value = 'Selic'; opt.textContent = 'Tesouro Selic';
    sel.querySelector('optgroup[label="Brasil"]')?.appendChild(opt);
  }
}

// Ao trocar o ativo, a moeda acompanha a moeda do ativo (VWCE → €, MXRF11 → R$...).
// Continua dando para mudar à mão depois, se a compra foi feita na outra moeda.
let _ultimoAtivoForm = null;
function onAtivoChange() {
  garantirOpcaoSelic();
  const ativo = document.getElementById('f-ativo').value;
  if (ativo !== _ultimoAtivoForm) {
    _ultimoAtivoForm = ativo;
    const moedaSel = document.getElementById('f-moeda');
    if (moedaSel && ASSET_CURRENCY[ativo]) moedaSel.value = ASSET_CURRENCY[ativo];
  }
  const el = document.getElementById('f-qtd-req');
  if (el) el.textContent = COTA_ASSETS.includes(ativo) ? 'obrigatória' : 'opcional';

  const rowReserva = document.getElementById('row-tipo-reserva');
  if (rowReserva) rowReserva.style.display = ativo === 'Reserva' ? '' : 'none';
}

async function registrarAporte() {
  const ativo = document.getElementById('f-ativo').value;
  const valor = parsePtBrNumber(document.getElementById('f-valor').value);
  const moeda = document.getElementById('f-moeda').value;
  const qtd = document.getElementById('f-qtd').value;
  const nota = document.getElementById('f-nota').value;
  const tipoReserva = ativo === 'Reserva' ? document.getElementById('f-tipo-reserva').value : null;

  if (!valor || valor <= 0) { showToast('⚠️ Coloque um valor válido!'); return; }
  if (COTA_ASSETS.includes(ativo) && !(parseFloat(qtd) > 0)) {
    showToast('⚠️ Informe a quantidade de cotas — obrigatória para ' + ativo + '!');
    return;
  }
  // Sanidade anti-typo: se o preço por cota implícito (valor ÷ qtd) fugir muito do último
  // preço conhecido, o aporte revalorizaria a posição inteira errado — confirma antes.
  if (COTA_ASSETS.includes(ativo)) {
    const nativoBRL = ASSET_CURRENCY[ativo] === 'BRL';
    let vNat = valor;
    if (nativoBRL && moeda === 'EUR') vNat = valor * getRate();
    if (!nativoBRL && moeda === 'BRL') vNat = valor / getRate();
    const precoInformado = parseFloat(document.getElementById('f-preco').value);
    const precoAporte = precoInformado > 0 ? precoInformado : vNat / parseFloat(qtd);
    const precoRef = portfolioData[ativo.toLowerCase() + '_preco'] || 0;
    const sym = nativoBRL ? 'R$' : '€';
    if (precoRef > 0 && (precoAporte > precoRef * 1.5 || precoAporte < precoRef / 1.5)) {
      const ok = await confirmDialog(`O preço por cota deste aporte (${sym}${fmtNum(precoAporte)}) está muito longe do preço atual do ${ativo} (${sym}${fmtNum(precoRef)}).\n\nConfira o valor e a quantidade digitados.`, { titulo: 'Preço fora do esperado', ok: 'Registrar mesmo assim' });
      if (!ok) return;
    }
  }
  if (ativo === 'Reserva' && tipoReserva === 'retirada') {
    const valorEmEur = moeda === 'BRL' ? valor / getRate() : valor;
    if (valorEmEur > (portfolioData.reserva || 0) + 0.01) {
      showToast('⚠️ Valor maior que o saldo atual da Reserva (€' + fmtNum(portfolioData.reserva || 0) + ')!');
      return;
    }
  }

  const btn = document.getElementById('aporteSubmitBtn');
  const btnOriginalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Salvando…';

  try {
    const preco = document.getElementById('f-preco').value;
    const cambio = getRate();
    let qtdFinal = qtd || null, qtdEstimada = false;
    // Bitcoin sem quantidade: estima pela cotação do momento e GRAVA no registro — assim,
    // se este aporte for editado ou excluído, dá para desfazer exatamente a mesma quantidade
    if (ativo === 'Bitcoin' && !(parseFloat(qtd) > 0)) {
      const btcPrice = await fetchBTCPriceEUR();
      if (btcPrice) {
        const vEur = moeda === 'BRL' ? valor / cambio : valor;
        qtdFinal = (vEur / btcPrice).toFixed(8);
        qtdEstimada = true;
      } else {
        showToast('⚠️ CoinGecko indisponível — preencha o campo "Quantidade" com os BTC recebidos no Revolut para registrar corretamente.');
      }
    }
    const aporteDoc = {
      ativo, valor, moeda, qtd: qtdFinal, preco: preco || null, nota: nota || null,
      tipo: tipoReserva,
      cambio,
      ...(qtdEstimada ? { qtdEstimada: true } : {}),
      data: new Date().toISOString(),
      timestamp: Date.now()
    };

    if (TEST_MODE) {
      testAportes.unshift({ ...aporteDoc, _id: 'teste-' + aporteDoc.timestamp });
      applyAporteToPortfolio(portfolioData, aporteDoc, 1);
    } else {
      // Grava o aporte E atualiza a carteira numa única transação: relê a carteira do Firebase
      // (se outro aparelho registrou algo depois que este abriu o app, nada é sobrescrito)
      // e, se qualquer parte falhar, nada é gravado pela metade
      const { collection, doc } = window._dbFns;
      const novoRef = doc(collection(window._db, 'aportes'));
      await updatePortfolioAtomic(p => applyAporteToPortfolio(p, aporteDoc, 1), tx => tx.set(novoRef, aporteDoc));
    }
    _evoAportes = null; // invalida o cache para o gráfico de evolução refletir este aporte

    document.getElementById('f-valor').value = '';
    document.getElementById('f-qtd').value = '';
    document.getElementById('f-nota').value = '';
    document.getElementById('f-preco').value = '';

    // A confirmação mostra o que você registrou de verdade no mês (não o valor do plano)
    let resumo = '';
    try {
      if (ehAporte(aporteDoc)) {
        const m = resumoAportesDoMes(await loadAportesForEvo(), currentMonthKey(), getRate());
        const plano = profileData.aporteMensalEur;
        if (m.totalEur > 0) resumo = ` · este mês: €${fmtNum(m.totalEur, 0)}${plano ? ` (plano €${fmtNum(plano, 0)})` : ''} · ${m.brPct}% Brasil / ${m.intlPct}% Internacional`;
      }
    } catch (e) { console.error(e); }
    showToast((TEST_MODE ? '🧪 Aporte de TESTE registrado — não foi salvo' : '✓ Aporte registrado') + resumo);
    loadHistorico();
    renderAporteGuide();
    updateDashboard(getRate());
    renderAlertas();    // o lembrete do aporte do mês some na hora
    loadDailyInsight(); // o insight do dia passa a considerar este aporte

  } catch (e) {
    showToast('❌ Erro ao salvar. Verifique a conexão.');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnOriginalText;
  }
}

// Chave da carteira para os ativos negociados em cotas
const COTA_KEY = Object.fromEntries(ATIVOS.map(a => [a.id, a.key]));

// Aplica (sign = 1) ou DESFAZ (sign = -1) um registro do histórico na carteira p (muta p).
// Recebe o próprio documento salvo no Firebase, então excluir/editar um aporte desfaz
// exatamente o que ele fez. Sem efeitos externos: pode rodar de novo se a transação repetir.
function applyAporteToPortfolio(p, a, sign = 1) {
  const { ativo, valor, moeda, qtd, preco, tipo } = a;

  // Ajuste de conferência com a corretora: soma/subtrai um delta num campo da carteira
  if (tipo === 'ajuste') {
    const campo = a.campo;
    if (!campo) return;
    if (campo === 'ipca_mercado' && p.ipca_mercado == null) p.ipca_mercado = p.ipca || 0;
    p[campo] = (p[campo] || 0) + sign * (a.delta || 0);
    // Desfazendo o PRIMEIRO valor de mercado do IPCA+ informado: volta a usar o valor aplicado
    if (sign < 0 && campo === 'ipca_mercado' && a.anterior == null) p.ipca_mercado = null;
    if (campo.endsWith('_cotas')) {
      const key = campo.replace('_cotas', '');
      p[campo] = Math.max(0, +p[campo].toFixed(8));
      p[key] = p[campo] * (p[key + '_preco'] || 0);
    }
    if (campo !== 'ipca_mercado' || p.ipca_mercado != null) p[campo] = Math.max(0, p[campo]);
    return;
  }

  // Conversão de moeda: cada ativo tem moeda nativa (FIIs/Tesouro/Caixinha/Dividendo em BRL,
  // ETFs/Bitcoin em EUR). Se o valor foi informado na outra moeda, converte pelo câmbio do dia
  // do registro (registros antigos, sem câmbio salvo, usam o de hoje).
  const cambio = a.cambio || getRate();
  const NATIVO_BRL = [...ATIVOS.filter(x => x.moeda === 'BRL').map(x => x.id), 'IPCA+', 'Selic', 'Caixinha', 'Dividendo'];
  let v = parseFloat(valor) || 0;
  if (NATIVO_BRL.includes(ativo) && moeda === 'EUR') v *= cambio;
  if (!NATIVO_BRL.includes(ativo) && moeda === 'BRL') v /= cambio;
  const sv = sign * v;

  const qtdNum = parseFloat(qtd) > 0 ? parseFloat(qtd) : 0;
  const key = COTA_KEY[ativo];

  if (key) {
    if (qtdNum) {
      p[key + '_cotas'] = Math.max(0, +((p[key + '_cotas'] || 0) + sign * qtdNum).toFixed(8));
      // Preço por cota é opcional: se não informado, é derivado de valor/qtd (o app faz a conta).
      // Ao desfazer, mantém o preço atual — as cotações ao vivo corrigem na sequência.
      if (sign > 0) p[key + '_preco'] = preco ? parseFloat(preco) : (v / qtdNum);
      p[key] = p[key + '_cotas'] * (p[key + '_preco'] || 0);
    } else {
      p[key] = Math.max(0, (p[key] || 0) + sv);
    }
  }

  // Registros antigos pagos com a Caixinha: o dinheiro saiu de lá (ao desfazer, volta para lá).
  // A Caixinha não aparece mais no app, mas o saldo guardado continua consistente.
  if (a.viaCaixinha) p.caixinha = Math.max(0, (p.caixinha || 0) - sv);

  if (ativo === 'Bitcoin') {
    p.bitcoin_invested_eur = Math.max(0, (p.bitcoin_invested_eur || 0) + sv);
    if (qtdNum) p.bitcoin = Math.max(0, +((p.bitcoin || 0) + sign * qtdNum).toFixed(8));
  }
  else if (ativo === 'IPCA+') {
    p.ipca = Math.max(0, (p.ipca || 0) + sv);
    // Com valor de mercado informado, o dinheiro novo entra nele também
    if (p.ipca_mercado != null) p.ipca_mercado = Math.max(0, p.ipca_mercado + sv);
  }
  else if (ativo === 'Selic')     p.selic = Math.max(0, (p.selic || 0) + sv);
  else if (ativo === 'Caixinha')  p.caixinha = Math.max(0, (p.caixinha || 0) + sv);
  else if (ativo === 'Dividendo') p.dividendos = Math.max(0, (p.dividendos || 0) + sv);
  else if (ativo === 'Reserva') {
    p.reserva = Math.max(0, (p.reserva || 0) + (tipo === 'retirada' ? -sv : sv));
  }
}

// Lê portfolio/main do Firebase, aplica a mudança e grava — tudo numa transação.
// Evita que um aparelho com a carteira desatualizada em memória apague o que outro gravou.
// txExtra (opcional) grava outros documentos (o aporte em si) na MESMA transação.
async function updatePortfolioAtomic(mutator, txExtra) {
  const db = window._db;
  if (!db || !window._dbFns) throw new Error('Firebase não carregou — verifique a conexão');
  const { doc, runTransaction } = window._dbFns;
  const ref = doc(db, 'portfolio', 'main');
  const fresh = await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const base = { ...portfolioData, ...(snap.exists() ? snap.data() : {}) };
    mutator(base);
    base.updated = new Date().toISOString();
    tx.set(ref, base);
    if (txExtra) txExtra(tx);
    return base;
  });
  portfolioData = fresh;
  if (lastMarketData) applyLivePrices(lastMarketData); // reaplica as cotações do dia sobre os dados relidos
}

async function savePortfolio() {
  if (TEST_MODE) return;
  const db = window._db;
  const { doc, setDoc } = window._dbFns;
  await setDoc(doc(db, 'portfolio', 'main'), { ...portfolioData, updated: new Date().toISOString() });
}

async function loadPortfolio() {
  const db = window._db;
  const { doc, getDoc } = window._dbFns;
  try {
    const snap = await getDoc(doc(db, 'portfolio', 'main'));
    if (snap.exists()) {
      portfolioData = { ...portfolioData, ...snap.data() };
      // Migração v2: corrige qty exata do Bitcoin (0.00118117 confirmado no Revolut)
      if (!portfolioData._migration_v2) {
        portfolioData.bitcoin = 0.00118117;
        portfolioData.bitcoin_invested_eur = 6;
        portfolioData._migration_v2 = true;
        await savePortfolio();
      }
      // Migração v3: corrige cotas e valores actuais de VWCE e EUNA (confirmados no Revolut)
      if (!portfolioData._migration_v3) {
        portfolioData.vwce = 25.28;
        portfolioData.vwce_cotas = 0.1528491;
        portfolioData.vwce_preco = 165.39;
        portfolioData.euna = 14.97;
        portfolioData.euna_cotas = 3.04346061;
        portfolioData.euna_preco = 4.92;
        portfolioData._migration_v3 = true;
        await savePortfolio();
      }
      // Migração v4: incorpora as cotas dos aportes de 26/06 registrados sem quantidade
      // (VWCE €50 = 0.30864197 cotas, EUNA €30 = 6.06219815 cotas — confirmados no Revolut)
      if (!portfolioData._migration_v4) {
        portfolioData.vwce_cotas = 0.1528491 + 0.30864197;   // 0.46149107
        portfolioData.euna_cotas = 3.04346061 + 6.06219815;  // 9.10565876
        portfolioData.vwce = portfolioData.vwce_cotas * (portfolioData.vwce_preco || 165.39);
        portfolioData.euna = portfolioData.euna_cotas * (portfolioData.euna_preco || 4.92);
        portfolioData._migration_v4 = true;
        await savePortfolio();
      }
      // Migração v5: corrige o custo real do Bitcoin (Revolut 04/07/2026:
      // 0.00153789 BTC × entrada média $76.769,77 = $118,07 ≈ €101,84)
      if (!portfolioData._migration_v5) {
        portfolioData.bitcoin = 0.00153789;
        portfolioData.bitcoin_invested_eur = 101.84;
        portfolioData._migration_v5 = true;
        await savePortfolio();
      }
      // Migração v6: registra no histórico as compras antigas de Bitcoin feitas fora do app
      // (custo real Revolut €101,84 − €26 já registrados = €75,84), para o extrato bater com
      // o "você aportou". Não muda nenhum cálculo: o custo do BTC já vem de bitcoin_invested_eur.
      if (!TEST_MODE && !portfolioData._migration_v6) {
        try {
          const { collection, addDoc } = window._dbFns;
          const docsExist = await loadAportesForEvo();
          const jaTem = (docsExist || []).some(d => d.ativo === 'Bitcoin' && (d.nota || '').startsWith('Ajuste de custo'));
          if (!jaTem) {
            await addDoc(collection(db, 'aportes'), {
              ativo: 'Bitcoin', valor: 75.84, moeda: 'EUR', qtd: null, preco: null,
              nota: 'Ajuste de custo: compras antigas no Revolut (pré-app)', tipo: null,
              data: '2026-06-15T12:00:00', timestamp: new Date('2026-06-15T12:00:00').getTime()
            });
            _evoAportes = null;
          }
          portfolioData._migration_v6 = true;
          await savePortfolio();
        } catch (e) { console.error('migração v6:', e); }
      }
      // Cotações já buscadas por loadMarketData: reaplica sobre a carteira recém-carregada
      if (lastMarketData) applyLivePrices(lastMarketData);
      seedMayAportes();
    }
    // Documento inexistente = primeira vez: os valores iniciais do código viram o ponto de partida
    portfolioLoaded = true;
    updateDashboard(getRate());
  } catch(e) {
    console.error('Erro ao carregar portfólio:', e);
    const g = document.getElementById('hero-growth');
    if (g) { g.textContent = 'Não foi possível carregar sua carteira — verifique a conexão e recarregue'; g.style.color = 'var(--amber)'; }
    showToast('❌ Erro ao carregar sua carteira do Firebase');
  }
}

let historicoFilter = 'total';

function populateHistoricoFilter(allDocs) {
  const sel = document.getElementById('historico-filter');
  if (!sel) return;
  const current = sel.value || historicoFilter;
  sel.innerHTML = '<option value="total">Todos os ativos</option>';
  const assets = [...new Set(allDocs.map(d => d.ativo))].sort();
  assets.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    sel.appendChild(opt);
  });
  sel.value = [...sel.options].some(o => o.value === current) ? current : 'total';
}

function onHistoricoFilterChange() {
  historicoFilter = document.getElementById('historico-filter').value;
  loadHistorico();
}

// Histórico completo (com id do documento), do mais recente para o mais antigo.
// Em modo teste, mescla os aportes de teste e as edições/exclusões simuladas.
let _historicoDocs = [];
const testOverrides = {}; // modo teste: id → { excluido } ou { dados } — nada vai para o Firebase

async function fetchHistoricoDocs() {
  let docs = [];
  try {
    const { collection, getDocs, query, orderBy } = window._dbFns;
    const snap = await getDocs(query(collection(window._db, 'aportes'), orderBy('timestamp', 'desc')));
    docs = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
  } catch (e) {
    if (!TEST_MODE) throw e; // em modo teste o histórico funciona mesmo sem Firebase
  }
  if (TEST_MODE) {
    docs = [...testAportes.filter(d => !d._excluido), ...docs]
      .filter(d => !testOverrides[d._id]?.excluido)
      .map(d => testOverrides[d._id]?.dados ? { ...d, ...testOverrides[d._id].dados } : d);
  }
  return docs;
}

function descreverRegistro(d) {
  if (d.tipo === 'ajuste') {
    const ROTULO = { ipca_mercado: 'valor de mercado', caixinha: 'saldo', reserva: 'saldo', bitcoin: 'BTC' };
    const r = d.campo?.endsWith('_cotas') ? 'cotas' : (ROTULO[d.campo] || d.campo);
    const fmt = v => d.campo?.endsWith('_cotas') || d.campo === 'bitcoin' ? fmtNum(v, d.campo === 'bitcoin' ? 8 : 4) : fmtNum(v);
    return `Ajuste ${d.ativo} · ${r}: ${d.anterior != null ? fmt(d.anterior) : '—'} → ${fmt(d.novo)}`;
  }
  const extra = d.ativo === 'Reserva' ? (d.tipo === 'retirada' ? ' · retirada' : ' · depósito') : '';
  return `${d.ativo}${extra}${d.qtd ? ' · ' + d.qtd + (d.ativo === 'Bitcoin' ? ' BTC' : ' cotas') + (d.qtdEstimada ? ' (estimado)' : '') : ''}${d.viaCaixinha ? ' · pago c/ Caixinha' : ''}`;
}

async function loadHistorico() {
  const list = document.getElementById('historicoList');
  let allDocs = [];
  try {
    allDocs = await fetchHistoricoDocs();
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Erro ao carregar histórico.</div>';
    return;
  }
  _historicoDocs = allDocs;
  try {
    if (allDocs.length === 0) {
      list.innerHTML = '<div class="empty-state">Nenhum aporte registrado ainda.</div>';
      populateHistoricoFilter([]);
      return;
    }
    populateHistoricoFilter(allDocs);

    const filtered = historicoFilter === 'total' ? allDocs : allDocs.filter(d => d.ativo === historicoFilter);
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state">Nenhum aporte de ' + escapeHtml(historicoFilter) + ' ainda.</div>';
      return;
    }

    let mesAnterior = null;
    list.innerHTML = filtered.map(data => {
      const dt = new Date(data.data);
      const date = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
      const mes = monthKeyOf(data.data);
      let cabecalhoMes = '';
      if (mes !== mesAnterior) {
        mesAnterior = mes;
        const [a, m] = mes.split('-').map(Number);
        const doMes = filtered.filter(x => monthKeyOf(x.data) === mes).length;
        cabecalhoMes = `<div class="hist-month"><span>${new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span><span>${doMes} registro${doMes > 1 ? 's' : ''}</span></div>`;
      }
      const sym = data.moeda === 'EUR' ? '€' : 'R$';
      const ajuste = data.tipo === 'ajuste';
      const id = escapeHtml(data._id);
      return cabecalhoMes + `<div class="history-item" id="hist-${id}">
        <div class="hi-left">
          <div class="hi-asset">${ajuste ? icon('wrench') : ''}${escapeHtml(descreverRegistro(data))}</div>
          <div class="hi-date">${date}${data.nota ? ' · ' + escapeHtml(data.nota) : ''}</div>
        </div>
        <div class="hi-right">
          ${ajuste ? '' : `<div class="hi-val mval">${sym}${fmtNum(parseFloat(data.valor))}</div>`}
          <div class="hi-actions">
            ${ajuste ? '' : `<button class="hi-btn" title="Editar" aria-label="Editar" onclick="editarAporte('${id}')">${icon('pencil')}</button>`}
            <button class="hi-btn danger" title="Excluir" aria-label="Excluir" onclick="excluirAporte('${id}')">${icon('trash')}</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error(e);
    list.innerHTML = '<div class="empty-state">Erro ao carregar histórico.</div>';
  }
}

// Atualiza tudo que depende do histórico depois de editar/excluir/ajustar
function refreshAfterHistoryChange() {
  _evoAportes = null;
  loadHistorico();
  renderAporteGuide();
  updateDashboard(getRate());
  renderAlertas();
}

// ── EXCLUIR: desfaz o efeito do registro na carteira e apaga o documento, na mesma transação
async function excluirAporte(id) {
  const d = _historicoDocs.find(x => x._id === id);
  if (!d) return;
  const quando = new Date(d.data).toLocaleDateString('pt-BR');
  const valorTxt = d.tipo === 'ajuste' ? '' : ` de ${d.moeda === 'EUR' ? '€' : 'R$'}${fmtNum(parseFloat(d.valor))}`;
  let aviso = '';
  if (d.ativo === 'Bitcoin' && d.tipo !== 'ajuste' && !(parseFloat(d.qtd) > 0)) aviso = '\n\nEste registro antigo não tem a quantidade de BTC: só o custo será desfeito. Confira a quantidade em "Conferir com a corretora" depois.';
  if (!await confirmDialog(`A carteira será recalculada como se ele nunca tivesse existido.${aviso}`, { titulo: `Excluir ${d.tipo === 'ajuste' ? 'o ajuste' : 'o aporte'} de ${d.ativo}${valorTxt} (${quando})?`, ok: 'Excluir', perigo: true })) return;

  try {
    if (TEST_MODE) {
      applyAporteToPortfolio(portfolioData, d, -1);
      if (id.startsWith('teste-')) { const t = testAportes.find(x => x._id === id); if (t) t._excluido = true; }
      else testOverrides[id] = { excluido: true };
    } else {
      const { doc } = window._dbFns;
      const ref = doc(window._db, 'aportes', id);
      await updatePortfolioAtomic(p => applyAporteToPortfolio(p, d, -1), tx => tx.delete(ref));
    }
    showToast(TEST_MODE ? '🧪 Exclusão simulada — nada foi salvo' : '✓ Registro excluído e carteira recalculada');
    refreshAfterHistoryChange();
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível excluir. Verifique a conexão.');
  }
}

// ── EDITAR: formulário dentro do próprio item do histórico
function editarAporte(id) {
  const d = _historicoDocs.find(x => x._id === id);
  const el = document.getElementById('hist-' + id);
  if (!d || !el) return;
  const dataLocal = (() => {
    const dt = new Date(d.data);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.data)) return d.data;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  })();
  const temQtd = COTA_ASSETS.includes(d.ativo) || d.ativo === 'Bitcoin';
  el.classList.add('editing');
  el.innerHTML = `
    <div class="hi-edit">
      <div class="hi-edit-title">Editar ${escapeHtml(d.ativo)}${d.ativo === 'Reserva' ? (d.tipo === 'retirada' ? ' (retirada)' : ' (depósito)') : ''}</div>
      <div class="hi-edit-grid">
        <label>Valor<input class="form-input" id="e-valor-${id}" type="text" inputmode="decimal" value="${escapeHtml(fmtNum(parseFloat(d.valor)))}"></label>
        <label>Moeda<select class="form-select" id="e-moeda-${id}">
          <option value="BRL"${d.moeda === 'BRL' ? ' selected' : ''}>R$</option>
          <option value="EUR"${d.moeda === 'EUR' ? ' selected' : ''}>€</option>
        </select></label>
        ${temQtd ? `<label>${d.ativo === 'Bitcoin' ? 'Quantidade (BTC)' : 'Cotas'}<input class="form-input" id="e-qtd-${id}" type="text" inputmode="decimal" value="${escapeHtml(d.qtd || '')}"></label>` : ''}
        <label>Data<input class="form-input" id="e-data-${id}" type="date" value="${dataLocal}"></label>
        <label class="full">Nota<input class="form-input" id="e-nota-${id}" type="text" value="${escapeHtml(d.nota || '')}"></label>
      </div>
      <div class="hi-edit-actions">
        <button class="btn btn-primary btn-sm" onclick="salvarEdicaoAporte('${escapeHtml(id)}')">Salvar</button>
        <button class="btn btn-ghost btn-sm" onclick="loadHistorico()">Cancelar</button>
      </div>
    </div>`;
  maskThousandsInput(document.getElementById('e-valor-' + id), 2);
}

async function salvarEdicaoAporte(id) {
  const d = _historicoDocs.find(x => x._id === id);
  if (!d) return;
  const valor = parsePtBrNumber(document.getElementById('e-valor-' + id).value);
  const moeda = document.getElementById('e-moeda-' + id).value;
  const qtdEl = document.getElementById('e-qtd-' + id);
  const qtd = qtdEl ? parseFlexNumber(qtdEl.value) : null;
  const dataStr = document.getElementById('e-data-' + id).value;
  const nota = document.getElementById('e-nota-' + id).value.trim();

  if (!(valor > 0)) { showToast('⚠️ Valor inválido'); return; }
  if (COTA_ASSETS.includes(d.ativo) && !(qtd > 0)) { showToast('⚠️ Informe as cotas'); return; }
  if (!dataStr) { showToast('⚠️ Informe a data'); return; }

  // Mantém o horário original quando só a data mudou de dia; data nova vira meio-dia local
  const mesmoDia = monthKeyOf(d.data) === dataStr.slice(0, 7) && String(d.data).slice(0, 10) === dataStr;
  const novaData = mesmoDia ? d.data : new Date(dataStr + 'T12:00:00').toISOString();
  const { _id, ...antigo } = d;
  const novo = {
    ...antigo, valor, moeda,
    qtd: qtdEl ? (qtd > 0 ? String(qtd) : null) : (antigo.qtd ?? null),
    nota: nota || null,
    data: novaData,
    timestamp: mesmoDia ? antigo.timestamp : new Date(novaData).getTime(),
    cambio: antigo.cambio || getRate(),
    editadoEm: new Date().toISOString()
  };
  if (qtdEl && novo.qtd !== antigo.qtd) delete novo.qtdEstimada;

  // Troca de preço com cotas: o preço gravado era do aporte antigo — recalcula pelo novo valor
  if (COTA_ASSETS.includes(d.ativo) && antigo.preco) novo.preco = null;

  try {
    if (TEST_MODE) {
      applyAporteToPortfolio(portfolioData, antigo, -1);
      applyAporteToPortfolio(portfolioData, novo, 1);
      if (id.startsWith('teste-')) { const i = testAportes.findIndex(x => x._id === id); if (i >= 0) testAportes[i] = { ...novo, _id: id }; }
      else testOverrides[id] = { dados: novo };
    } else {
      const { doc } = window._dbFns;
      const ref = doc(window._db, 'aportes', id);
      // Desfaz o registro antigo e aplica o novo na mesma transação que regrava o documento
      await updatePortfolioAtomic(p => {
        applyAporteToPortfolio(p, antigo, -1);
        applyAporteToPortfolio(p, novo, 1);
      }, tx => tx.set(ref, novo));
    }
    showToast(TEST_MODE ? '🧪 Edição simulada — nada foi salvo' : '✓ Aporte atualizado e carteira recalculada');
    refreshAfterHistoryChange();
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível salvar. Verifique a conexão.');
  }
}

// Número digitado com vírgula OU ponto decimal (cotas, BTC, saldos).
// "1,57209555" → 1.57209555 · "1.340,33" → 1340.33 · "1.340" (milhar) → 1340 · "0.0019" → 0.0019
function parseFlexNumber(str) {
  const s = String(str ?? '').trim().replace(/\s/g, '').replace(/^R\$|^€/, '');
  if (!s) return NaN;
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
  return parseFloat(s);
}

// ─────────────────────────────────────────
// BACKUP — planilha (CSV) e backup completo (JSON)
// ─────────────────────────────────────────
function baixarArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportarCSV() {
  try {
    const docs = (await fetchHistoricoDocs()).slice().reverse(); // mais antigo primeiro
    // Padrão do Excel em português: separador ";" e vírgula decimal
    const num = v => (v === null || v === undefined || v === '' || isNaN(parseFloat(v))) ? '' : String(parseFloat(v)).replace('.', ',');
    const cel = v => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const linhas = [['Data', 'Ativo', 'Tipo', 'Valor', 'Moeda', 'Cotas/Qtd', 'Preço por cota', 'Câmbio EUR/BRL', 'Pago c/ Caixinha', 'Nota', 'ID'].join(';')];
    docs.forEach(d => {
      const dt = new Date(d.data);
      linhas.push([
        isNaN(dt) ? d.data : dt.toLocaleDateString('pt-BR'),
        d.ativo,
        d.tipo === 'ajuste' ? `ajuste (${d.campo}: ${d.anterior ?? ''} → ${d.novo})` : (d.tipo || ''),
        num(d.valor), d.moeda || '', num(d.qtd), num(d.preco), num(d.cambio),
        d.viaCaixinha ? 'sim' : '', d.nota || '', d._id
      ].map(cel).join(';'));
    });
    baixarArquivo(`wealthflow-aportes-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
    showToast(`✓ Planilha com ${docs.length} registros baixada`);
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível gerar a planilha');
  }
}

async function exportarBackupJSON() {
  try {
    const docs = await fetchHistoricoDocs();
    const backup = {
      app: 'WealthFlow', versao: 1, geradoEm: new Date().toISOString(),
      perfil: profileData,
      carteira: portfolioData,
      aportes: docs
    };
    baixarArquivo(`wealthflow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
    showToast('✓ Backup completo baixado');
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível gerar o backup');
  }
}

