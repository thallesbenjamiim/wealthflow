// Notificações push (Web Push). As chaves VAPID são geradas uma vez e guardadas no próprio
// Firestore (config/vapid) — protegido pelas regras, só o dono e o servidor leem.
// As inscrições dos aparelhos ficam em config/push.
const webpush = require('web-push');

const SUBJECT = 'https://wealthflow-blush-nine.vercel.app';

async function getVapid(db) {
  const ref = db.collection('config').doc('vapid');
  const snap = await ref.get();
  if (snap.exists && snap.data().publicKey) return snap.data();
  const keys = webpush.generateVAPIDKeys();
  // create() falha se outra chamada criou ao mesmo tempo — aí usa a que ficou salva
  try { await ref.create({ ...keys, criadoEm: new Date().toISOString() }); return keys; }
  catch (e) { return (await ref.get()).data(); }
}

async function getSubs(db) {
  const snap = await db.collection('config').doc('push').get();
  return snap.exists ? (snap.data().subs || []) : [];
}

async function saveSubs(db, subs) {
  await db.collection('config').doc('push').set({ subs, atualizado: new Date().toISOString() });
}

// Envia para todos os aparelhos inscritos; remove os que o serviço de push diz que morreram
async function sendToAll(db, payload) {
  const vapid = await getVapid(db);
  webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);
  const subs = await getSubs(db);
  const vivos = [];
  let enviados = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
      vivos.push(s); enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) continue; // inscrição expirada
      console.error('push:', e.statusCode, e.body || e.message);
      vivos.push(s);
    }
  }
  if (vivos.length !== subs.length) await saveSubs(db, vivos);
  return { enviados, aparelhos: vivos.length };
}

module.exports = { getVapid, getSubs, saveSubs, sendToAll };
