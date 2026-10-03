// Inscrição de aparelhos para notificações — só o dono (token Firebase 'wf-owner').
// POST { action: 'key' | 'subscribe' | 'unsubscribe' | 'test' | 'status', subscription? }
const { getAdmin, verifyOwner, readBody } = require('./_lib/admin');
const { getVapid, getSubs, saveSubs, sendToAll } = require('./_lib/push');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!(await verifyOwner(req))) return res.status(401).json({ ok: false, error: 'nao_autorizado' });

  const db = getAdmin().firestore();
  const { action, subscription } = await readBody(req);
  try {
    if (action === 'key') {
      const { publicKey } = await getVapid(db);
      return res.status(200).json({ ok: true, publicKey });
    }
    if (action === 'subscribe') {
      if (!subscription?.endpoint) return res.status(400).json({ ok: false });
      const subs = (await getSubs(db)).filter(s => s.endpoint !== subscription.endpoint);
      subs.push(subscription);
      await saveSubs(db, subs);
      return res.status(200).json({ ok: true, aparelhos: subs.length });
    }
    if (action === 'unsubscribe') {
      const subs = (await getSubs(db)).filter(s => s.endpoint !== subscription?.endpoint);
      await saveSubs(db, subs);
      return res.status(200).json({ ok: true, aparelhos: subs.length });
    }
    if (action === 'test') {
      const r = await sendToAll(db, { title: 'WealthFlow', body: '🔔 Notificações funcionando! Você será avisado no dia do aporte e quando os FIIs anunciarem dividendos.', url: '/' });
      return res.status(200).json({ ok: true, ...r });
    }
    if (action === 'status') {
      return res.status(200).json({ ok: true, aparelhos: (await getSubs(db)).length });
    }
    return res.status(400).json({ ok: false, error: 'acao_invalida' });
  } catch (e) {
    console.error('push:', e);
    return res.status(500).json({ ok: false, error: 'erro_interno' });
  }
};
