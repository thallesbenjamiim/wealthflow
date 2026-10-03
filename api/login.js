// Login do WealthFlow — o PIN é verificado AQUI no servidor, nunca no navegador.
// Com o PIN certo, devolve um token do Firebase para o usuário fixo 'wf-owner';
// as regras do Firestore (firestore.rules) só deixam esse usuário ler/gravar.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   WF_PIN_HASH               SHA-256 (hex) do PIN
//   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase (Project settings → Service accounts)
//
// Enquanto FIREBASE_SERVICE_ACCOUNT não existir, responde { ok: true, token: null } e o app
// cai no login anônimo antigo — assim nada quebra antes da configuração ficar pronta.

const crypto = require('crypto');

const OWNER_UID = 'wf-owner';
// Hash antigo (estava no index.html, portanto já público) — só vale até WF_PIN_HASH ser definido
const LEGACY_PIN_HASH = '18a2c351a154bda5eb86114c87f6a90e2d5288ffa5d713c30df8be074b3bf92d';

let adminApp = null;
function getAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const admin = require('firebase-admin');
    if (!adminApp) {
      adminApp = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    }
    return admin;
  } catch (e) {
    console.error('firebase-admin indisponível:', e.message);
    return null;
  }
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { pin } = await readBody(req);
  // Tolera espaço, quebra de linha ou texto extra colado junto: pega só os 64 caracteres do hash
  const envHash = process.env.WF_PIN_HASH;
  const found = envHash ? (envHash.match(/[0-9a-f]{64}/i) || [])[0] : LEGACY_PIN_HASH;
  if (!found) {
    console.error('WF_PIN_HASH não contém um hash SHA-256 de 64 caracteres');
    return res.status(500).json({ ok: false, error: 'config_pin_hash' });
  }
  const expected = found.toLowerCase();
  const got = crypto.createHash('sha256').update(String(pin || '')).digest('hex');
  const match = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));

  if (!match) {
    // Atraso fixo: deixa a força bruta das 1.000.000 combinações lenta demais para valer a pena
    await new Promise(r => setTimeout(r, 1500));
    return res.status(401).json({ ok: false });
  }

  const admin = getAdmin();
  if (!admin) return res.status(200).json({ ok: true, token: null });

  try {
    const token = await admin.auth().createCustomToken(OWNER_UID);
    return res.status(200).json({ ok: true, token });
  } catch (e) {
    console.error('createCustomToken:', e.message);
    return res.status(500).json({ ok: false, error: 'falha ao gerar token' });
  }
};
