const http = require('http');
const https = require('https');

const PORT = 3001;

function fetchJson(url, headers = {}) {
  return new Promise((resolve) => {
    const opts = new URL(url);
    https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'WealthFlow/1.0', ...headers } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: null }); }
      });
    }).on('error', () => resolve({ status: 0, body: null }));
  });
}

// Yahoo Finance v8 chart — o v7/quote foi descontinuado (401); o v8 segue aberto
// e cobre tanto os ETFs europeus (.AS) quanto os FIIs da B3 (.SA).
async function yahooQuote(symbol) {
  const r = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
  const meta = r.body?.chart?.result?.[0]?.meta;
  if (r.status !== 200 || !meta?.regularMarketPrice) return null;
  const prev = meta.chartPreviousClose || meta.previousClose;
  return {
    price: meta.regularMarketPrice,
    change1d: prev ? (((meta.regularMarketPrice - prev) / prev) * 100).toFixed(2) : null,
    week52High: meta.fiftyTwoWeekHigh,
    week52Low: meta.fiftyTwoWeekLow
  };
}

// Último dividendo por cota realmente pago (FIIs da B3 — só Brasil, ETFs Acc não distribuem).
async function yahooLastDividend(symbol) {
  const r = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=3mo&events=div`);
  const divs = r.body?.chart?.result?.[0]?.events?.dividends;
  if (r.status !== 200 || !divs) return null;
  const last = Object.values(divs).sort((a, b) => a.date - b.date).pop();
  if (!last) return null;
  return { amount: last.amount, date: new Date(last.date * 1000).toISOString().slice(0, 10) };
}

async function getMarketData() {
  const out = {};

  const [vwce, euna, mxrf11, hglg11, mxrf11Div, hglg11Div, cambio, selic, ipca] = await Promise.all([
    yahooQuote('VWCE.AS').catch(() => null),
    // EUNA.DE (Xetra) — o EUNA.AS de Amsterdã é outra classe do fundo (~€49) e distorceria a carteira 10x
    yahooQuote('EUNA.DE').catch(() => null),
    yahooQuote('MXRF11.SA').catch(() => null),
    yahooQuote('HGLG11.SA').catch(() => null),
    yahooLastDividend('MXRF11.SA').catch(() => null),
    yahooLastDividend('HGLG11.SA').catch(() => null),
    fetchJson('https://api.exchangerate-api.com/v4/latest/EUR').catch(() => null),
    // Banco Central (SGS): 432 = Selic meta, 13522 = IPCA acumulado 12 meses
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json').catch(() => null),
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json').catch(() => null)
  ]);

  if (vwce)   out.vwce = vwce;
  if (euna)   out.euna = euna;
  if (mxrf11) out.mxrf11 = mxrf11;
  if (hglg11) out.hglg11 = hglg11;
  if (mxrf11Div) out.mxrf11Dividend = mxrf11Div;
  if (hglg11Div) out.hglg11Dividend = hglg11Div;
  if (cambio?.status === 200 && cambio.body?.rates?.BRL) out.eurbrl = cambio.body.rates.BRL.toFixed(4);
  if (selic?.status === 200 && selic.body?.[0]?.valor) out.selic = parseFloat(selic.body[0].valor).toFixed(2);
  if (ipca?.status === 200 && ipca.body?.[0]?.valor) out.ipca12m = parseFloat(ipca.body[0].valor).toFixed(2);

  return out;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === '/market-data' && req.method === 'GET') {
    const data = await getMarketData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': req.headers['x-api-key'] || '',
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const proxyReq = https.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  WealthFlow Proxy ativo em http://localhost:' + PORT);
  console.log('  Dados de mercado em tempo real habilitados.');
  console.log('  Mantenha este terminal aberto enquanto usa o app.');
  console.log('');
});
