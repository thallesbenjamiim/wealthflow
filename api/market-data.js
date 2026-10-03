// Função serverless do Vercel — mesma lógica do server.js local (getMarketData),
// para o app ter cotações completas no celular e em qualquer lugar, sem PC ligado.

// Lista única de ativos — o mesmo arquivo que o app usa no navegador
const { ATIVOS, ATIVOS_DIVIDENDOS } = require('../js/ativos.js');

async function yahooQuote(symbol) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
    { headers: { 'User-Agent': 'WealthFlow/1.0' }, signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  const meta = d?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  const prev = meta.chartPreviousClose || meta.previousClose;
  return {
    price: meta.regularMarketPrice,
    change1d: prev ? (((meta.regularMarketPrice - prev) / prev) * 100).toFixed(2) : null,
    week52High: meta.fiftyTwoWeekHigh,
    week52Low: meta.fiftyTwoWeekLow
  };
}

async function fetchJson(url) {
  try {
    // Limite de tempo: uma fonte travada não pode segurar a resposta inteira
    const r = await fetch(url, { headers: { 'User-Agent': 'WealthFlow/1.0' }, signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

// Taxas do Brasil. A API do Banco Central (SGS) recusa servidores de nuvem, inclusive
// no Vercel em São Paulo — a BrasilAPI republica os mesmos dados do BCB e responde.
// O SGS fica como segunda opção. Retorna { selic, ipca12m } (podem vir null).
async function brazilRates() {
  const taxas = await fetchJson('https://brasilapi.com.br/api/taxas/v1');
  const pick = nome => taxas?.find?.(t => (t.nome || '').toLowerCase() === nome)?.valor;
  let selic = pick('selic'), ipca12m = pick('ipca');
  if (selic == null || ipca12m == null) {
    // Banco Central (SGS): 432 = Selic meta, 13522 = IPCA acumulado 12 meses
    const [s, i] = await Promise.all([
      selic == null ? fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json') : null,
      ipca12m == null ? fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json') : null
    ]);
    if (selic == null && s?.[0]?.valor) selic = s[0].valor;
    if (ipca12m == null && i?.[0]?.valor) ipca12m = i[0].valor;
  }
  return { selic: selic != null ? parseFloat(selic) : null, ipca12m: ipca12m != null ? parseFloat(ipca12m) : null };
}

// Último dividendo por cota realmente pago (FIIs da B3 — só Brasil, ETFs Acc não distribuem).
async function yahooLastDividend(symbol) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=3mo&events=div`,
    { headers: { 'User-Agent': 'WealthFlow/1.0' }, signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  const divs = d?.chart?.result?.[0]?.events?.dividends;
  if (!divs) return null;
  const last = Object.values(divs).sort((a, b) => a.date - b.date).pop();
  if (!last) return null;
  return { amount: last.amount, date: new Date(last.date * 1000).toISOString().slice(0, 10) };
}

async function getMarketData() {
  const out = {};

  // Cotação de todos os ativos da lista única + último dividendo dos que distribuem
  const [cotacoes, dividendos, cambio, rates] = await Promise.all([
    Promise.all(ATIVOS.map(a => yahooQuote(a.yahoo).catch(() => null))),
    Promise.all(ATIVOS_DIVIDENDOS.map(a => yahooLastDividend(a.yahoo).catch(() => null))),
    fetchJson('https://api.exchangerate-api.com/v4/latest/EUR'),
    brazilRates().catch(() => ({}))
  ]);

  ATIVOS.forEach((a, i) => { if (cotacoes[i]) out[a.key] = cotacoes[i]; });
  ATIVOS_DIVIDENDOS.forEach((a, i) => { if (dividendos[i]) out[a.key + 'Dividend'] = dividendos[i]; });
  if (cambio?.rates?.BRL) out.eurbrl = cambio.rates.BRL.toFixed(4);
  if (Number.isFinite(rates.selic)) out.selic = rates.selic.toFixed(2);
  if (Number.isFinite(rates.ipca12m)) out.ipca12m = rates.ipca12m.toFixed(2);
  return out;
}

module.exports = async (req, res) => {
  const out = await getMarketData();
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache de 5 min na CDN do Vercel — as fontes não mudam mais rápido que isso
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json(out);
};

// Usado também pelo aviso diário de dividendos (api/cron-notify.js)
module.exports.getMarketData = getMarketData;
