// Login do WealthFlow — o PIN é verificado AQUI no servidor, nunca no navegador.
// Com o PIN certo, devolve um token do Firebase para o usuário fixo 'wf-owner';
// as regras do Firestore (firestore.rules) só deixam esse usuário ler/gravar.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   WF_PIN_HASH               o PIN (só dígitos) ou o SHA-256 (hex) dele
//   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase (Project settings → Service accounts)
//
// Enquanto FIREBASE_SERVICE_ACCOUNT não existir, responde { ok: true, token: null } e o app
// cai no login anônimo antigo — assim nada quebra antes da configuração ficar pronta.

const crypto = require('crypto');
const { getAdmin, readBody, OWNER_UID } = require('./_lib/admin');

// Hash antigo (estava no index.html, portanto já público) — só vale até WF_PIN_HASH ser definido
const LEGACY_PIN_HASH = '18a2c351a154bda5eb86114c87f6a90e2d5288ffa5d713c30df8be074b3bf92d';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { pin } = await readBody(req);
  // WF_PIN_HASH aceita o hash SHA-256 OU o próprio PIN (4-8 dígitos) — a variável é secreta
  // e só existe no servidor, então guardar o PIN puro lá é tão seguro quanto o hash.
  // Tolera espaço, quebra de linha ou texto extra colado junto.
  const envHash = (process.env.WF_PIN_HASH || '').trim();
  let found;
  if (!envHash) found = LEGACY_PIN_HASH;
  else if (/^\d{4,8}$/.test(envHash)) found = crypto.createHash('sha256').update(envHash).digest('hex');
  else found = (envHash.match(/[0-9a-f]{64}/i) || [])[0];
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
