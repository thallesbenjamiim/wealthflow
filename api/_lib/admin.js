// Firebase Admin compartilhado pelas funções do Vercel (arquivos em api/_lib não viram rotas).
// Usa a conta de serviço da variável FIREBASE_SERVICE_ACCOUNT; sem ela, devolve null.
let cached = null;

function getAdmin() {
  if (cached) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    cached = admin;
    return admin;
  } catch (e) {
    console.error('firebase-admin indisponível:', e.message);
    return null;
  }
}

// Confere o token do Firebase enviado pelo app (Authorization: Bearer ...) — só o dono passa
async function verifyOwner(req) {
  const admin = getAdmin();
  if (!admin) return null;
  const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return decoded.uid === 'wf-owner' ? decoded : null;
  } catch (e) {
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

module.exports = { getAdmin, verifyOwner, readBody, OWNER_UID: 'wf-owner' };
