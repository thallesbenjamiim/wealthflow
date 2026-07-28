// Função serverless do Vercel — mesma lógica do server.js local (getMarketData),
// para o app ter cotações completas no celular e em qualquer lugar, sem PC ligado.

async function yahooQuote(symbol) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
    { headers: { 'User-Agent': 'WealthFlow/1.0' } }
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
    const r = await fetch(url, { headers: { 'User-Agent': 'WealthFlow/1.0' } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

// Último dividendo por cota realmente pago (FIIs da B3 — só Brasil, ETFs Acc não distribuem).
async function yahooLastDividend(symbol) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=3mo&events=div`,
    { headers: { 'User-Agent': 'WealthFlow/1.0' } }
  );
  if (!r.ok) return null;
  const d = await r.json();
  const divs = d?.chart?.result?.[0]?.events?.dividends;
  if (!divs) return null;
  const last = Object.values(divs).sort((a, b) => a.date - b.date).pop();
  if (!last) return null;
  return { amount: last.amount, date: new Date(last.date * 1000).toISOString().slice(0, 10) };
}

module.exports = async (req, res) => {
  const out = {};

  const [vwce, euna, mxrf11, hglg11, knri11, mxrf11Div, hglg11Div, knri11Div, cambio, selic, ipca] = await Promise.all([
    yahooQuote('VWCE.AS').catch(() => null),
    // EUNA.DE (Xetra) — o EUNA.AS de Amsterdã é outra classe do fundo (~€49) e distorceria a carteira 10x
    yahooQuote('EUNA.DE').catch(() => null),
    yahooQuote('MXRF11.SA').catch(() => null),
    yahooQuote('HGLG11.SA').catch(() => null),
    yahooQuote('KNRI11.SA').catch(() => null),
    yahooLastDividend('MXRF11.SA').catch(() => null),
    yahooLastDividend('HGLG11.SA').catch(() => null),
    yahooLastDividend('KNRI11.SA').catch(() => null),
    fetchJson('https://api.exchangerate-api.com/v4/latest/EUR'),
    // Banco Central (SGS): 432 = Selic meta, 13522 = IPCA acumulado 12 meses
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json'),
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json')
  ]);

  if (vwce)   out.vwce = vwce;
  if (euna)   out.euna = euna;
  if (mxrf11) out.mxrf11 = mxrf11;
  if (hglg11) out.hglg11 = hglg11;
  if (knri11) out.knri11 = knri11;
  if (mxrf11Div) out.mxrf11Dividend = mxrf11Div;
  if (hglg11Div) out.hglg11Dividend = hglg11Div;
  if (knri11Div) out.knri11Dividend = knri11Div;
  if (cambio?.rates?.BRL) out.eurbrl = cambio.rates.BRL.toFixed(4);
  if (selic?.[0]?.valor) out.selic = parseFloat(selic[0].valor).toFixed(2);
  if (ipca?.[0]?.valor) out.ipca12m = parseFloat(ipca[0].valor).toFixed(2);

  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache de 5 min na CDN do Vercel — as fontes não mudam mais rápido que isso
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json(out);
};
