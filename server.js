// Servidor local do WealthFlow (http://localhost:3001) — usado quando o index.html é aberto
// direto no PC. Não tem lógica própria: reaproveita as mesmas funções da pasta api/ que rodam
// no Vercel, então qualquer mudança feita lá vale automaticamente aqui.
const http = require('http');

const PORT = 3001;

const routes = {
  '/health': require('./api/health'),
  '/market-data': require('./api/market-data'),
  '/login': require('./api/login')
};

// Adiciona ao res do Node os helpers que o Vercel oferece (res.status().json())
function vercelRes(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const handler = routes[req.url.split('?')[0]];
  if (!handler) { res.writeHead(404); res.end('Not found'); return; }
  try {
    await handler(req, vercelRes(res));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); res.end('Erro interno'); }
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  WealthFlow Proxy ativo em http://localhost:' + PORT);
  console.log('  Dados de mercado em tempo real habilitados.');
  console.log('  Mantenha este terminal aberto enquanto usa o app.');
  console.log('');
});
