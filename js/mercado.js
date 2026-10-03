// WealthFlow — Dados de mercado: câmbio, Selic/IPCA, Bitcoin e cotações ao vivo.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// MARKET DATA
// ─────────────────────────────────────────
// Valores numéricos dos indicadores — fonte única para os cálculos.
// Os pills mostram texto formatado pt-BR; nunca ler número de volta do textContent.
let marketRates = { eurbrl: null, selic: null, ipca: null, selicEstimada: false, ipcaEstimado: false };
let lastMarketData = null; // última resposta do /market-data — reaplicada quando a carteira é relida do Firebase
function getRate() { return marketRates.eurbrl || 6; }

// Escreve num indicador do topo (se ele existir na tela), com dica opcional ao passar o mouse
function setText(id, txt, title) {
  const e = document.getElementById(id);
  if (!e) return;
  e.textContent = txt;
  if (title) e.title = title;
}

async function fetchCambio() {
  try {
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/EUR-BRL');
    const d = await r.json();
    const val = parseFloat(d.EURBRL.bid);
    marketRates.eurbrl = val;
    setText('pill-cambio', 'R$' + fmtNum(val));
    return val;
  } catch {
    setText('pill-cambio', '≈R$6,00');
    return 6;
  }
}

async function fetchSelic() {
  // FALLBACK usado só quando o proxy não traz a Selic (BrasilAPI e BCB fora do ar, ou sem proxy).
  // Valor de referência de out/2026 — o "≈" na tela avisa que é estimativa, não o dado do dia.
  const SELIC_FALLBACK = 13.75;
  marketRates.selic = SELIC_FALLBACK;
  marketRates.selicEstimada = true;
  setText('pill-selic', '≈' + fmtNum(SELIC_FALLBACK) + '%', 'Estimativa — Banco Central indisponível agora');
  return SELIC_FALLBACK;
}

async function fetchIPCA() {
  // FALLBACK usado só quando o proxy não traz o IPCA 12m (ref. out/2026).
  const IPCA_FALLBACK = 4.22;
  marketRates.ipca = IPCA_FALLBACK;
  marketRates.ipcaEstimado = true;
  setText('pill-ipca', '≈' + fmtNum(IPCA_FALLBACK) + '%', 'Estimativa — Banco Central indisponível agora');
  return IPCA_FALLBACK;
}

// Selic formatada para textos: com "≈" quando é a estimativa fixa
function selicLabel() {
  return (marketRates.selicEstimada ? '≈' : '') + fmtNum(marketRates.selic ?? 13.75) + '%';
}

let btcPriceEur = null; // cache em memória — evita repetir a chamada à API a cada render

async function fetchBTCPriceEUR() {
  if (btcPriceEur) return btcPriceEur; // já buscado nesta sessão
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur');
    if (!r.ok) throw new Error('indisponível');
    const d = await r.json();
    const price = d?.bitcoin?.eur;
    if (price && price > 0) {
      btcPriceEur = price;
      return price;
    }
    throw new Error('sem dados');
  } catch {
    // Fallback aproximado caso a API esteja fora do ar — sinalizado como estimativa
    return null;
  }
}

// Aplica cotações ao vivo aos ativos com cotas registradas.
// Se o valor guardado for bem maior que cotas × preço, existe aporte antigo registrado
// sem quantidade de cotas — avisa em vez de "sumir" com o dinheiro silenciosamente.
function applyLivePrices(md) {
  const desatualizados = [];
  [['mxrf11','MXRF11'], ['hglg11','HGLG11'], ['knri11','KNRI11'], ['bova11','BOVA11'], ['vwce','VWCE'], ['euna','EUNA']].forEach(([k, name]) => {
    const q = md[k];
    const cotas = portfolioData[k + '_cotas'];
    if (!q?.price || !cotas) return;
    const novo = cotas * q.price;
    if (portfolioData[k] > novo * 1.15) desatualizados.push(name);
    portfolioData[k + '_preco'] = q.price;
    portfolioData[k] = novo;
  });
  if (desatualizados.length && !window._cotasWarned) {
    window._cotasWarned = true;
    showToast('⚠️ ' + desatualizados.join(' e ') + ' com aportes sem quantidade de cotas — registre as cotas que aparecem na corretora para o valor ao vivo ficar completo.');
  }
  // Último dividendo por cota realmente pago (Brasil apenas — MXRF11/HGLG11/KNRI11)
  if (md.mxrf11Dividend?.amount) { divPerShare.mxrf11 = md.mxrf11Dividend.amount; divPerShare.mxrf11Date = md.mxrf11Dividend.date; }
  if (md.hglg11Dividend?.amount) { divPerShare.hglg11 = md.hglg11Dividend.amount; divPerShare.hglg11Date = md.hglg11Dividend.date; }
  if (md.knri11Dividend?.amount) { divPerShare.knri11 = md.knri11Dividend.amount; divPerShare.knri11Date = md.knri11Dividend.date; }
}

async function loadMarketData() {
  btcPriceEur = null;

  if (proxyAvailable) {
    // Proxy ativo: busca tudo server-side, sem CORS
    try {
      const md = await fetch(proxyBase + '/market-data').then(r => r.json());
      lastMarketData = md;
      if (md.eurbrl) {
        marketRates.eurbrl = parseFloat(md.eurbrl);
        setText('pill-cambio', 'R$' + fmtNum(marketRates.eurbrl));
      }
      applyLivePrices(md);
      // Selic e IPCA reais (BrasilAPI/Banco Central) via proxy — fallback fixo se faltarem
      if (md.selic) {
        marketRates.selic = parseFloat(md.selic);
        marketRates.selicEstimada = false;
        setText('pill-selic', fmtNum(marketRates.selic) + '%', 'Dado do dia (BrasilAPI/Banco Central)');
      }
      else await fetchSelic();
      if (md.ipca12m) {
        marketRates.ipca = parseFloat(md.ipca12m);
        marketRates.ipcaEstimado = false;
        setText('pill-ipca', fmtNum(marketRates.ipca) + '%', 'Dado do dia (BrasilAPI/Banco Central)');
      }
      else await fetchIPCA();
      // Câmbio: se o proxy não trouxe, usa a fonte direta (awesomeapi tem CORS liberado)
      if (!md.eurbrl) await fetchCambio();
    } catch(e) {
      await Promise.all([fetchCambio(), fetchSelic(), fetchIPCA()]);
    }
  } else {
    // Sem proxy: usa fallback direto (chamadas externas bloqueadas por CORS)
    await Promise.all([fetchCambio(), fetchSelic(), fetchIPCA()]);
  }

  document.getElementById('topbarRight')?.classList.remove('pills-loading');

  const rate = getRate();

  const w0c = document.getElementById('w0-cambio');
  const w0s = document.getElementById('w0-selic');
  const w0b = document.getElementById('w0-brl');
  if (w0c) w0c.textContent = 'R$' + fmtNum(rate);
  if (w0s) w0s.textContent = selicLabel();
  if (w0b) w0b.textContent = 'R$' + fmtNum(profileData.aporteBrEur * rate, 0);

  updateDashboard(rate);
}

