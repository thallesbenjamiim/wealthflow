// Rodado 1x por dia pelo Vercel Cron (vercel.json). Manda notificação quando:
//  - chegou o dia do aporte (Perfil → "Dia do aporte") e ainda não há aporte registrado no mês;
//  - um FII da carteira anunciou dividendo novo (último dividendo do Yahoo Finance).
// Cada aviso é enviado uma única vez (controle em config/pushState).
const { getAdmin } = require('./_lib/admin');
const { sendToAll, getSubs } = require('./_lib/push');
const { getMarketData } = require('./market-data');
const { ATIVOS_DIVIDENDOS, ehAporte } = require('../js/ativos.js');

const TZ = 'Europe/Dublin';

function hojeEm(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

const brl = v => 'R$' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

module.exports = async (req, res) => {
  // Só o agendador do Vercel (com CRON_SECRET, se configurado). Mesmo se alguém chamar a URL,
  // cada aviso só sai uma vez — o pior caso é antecipar um aviso que sairia de qualquer jeito.
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization || '');
  const ua = String(req.headers['user-agent'] || '');
  if (secret ? auth !== `Bearer ${secret}` : !ua.includes('vercel-cron')) return res.status(401).json({ ok: false });

  const admin = getAdmin();
  if (!admin) return res.status(503).json({ ok: false, error: 'sem_conta_de_servico' });
  const db = admin.firestore();

  if (!(await getSubs(db)).length) return res.status(200).json({ ok: true, info: 'nenhum aparelho inscrito' });

  const stateRef = db.collection('config').doc('pushState');
  const state = (await stateRef.get()).data() || {};
  const sent = state.sent || {};
  const avisos = [];

  const [profileSnap, portfolioSnap] = await Promise.all([
    db.collection('profile').doc('main').get(),
    db.collection('portfolio').doc('main').get()
  ]);
  const profile = profileSnap.data() || {};
  const pf = portfolioSnap.data() || {};

  // ── Dia do aporte ──
  const hoje = hojeEm(TZ);
  const mesKey = `${hoje.y}-${String(hoje.m).padStart(2, '0')}`;
  const diaPlano = parseInt(String(profile.diaAporte || '28').match(/\d+/)?.[0] || '28', 10);
  const ultimoDia = new Date(hoje.y, hoje.m, 0).getDate();
  const diaAviso = Math.min(diaPlano, ultimoDia);
  if (hoje.d >= diaAviso && !sent['aporte-' + mesKey]) {
    const inicioMes = new Date(Date.UTC(hoje.y, hoje.m - 1, 1)).getTime() - 864e5; // folga de fuso
    const snap = await db.collection('aportes').where('timestamp', '>=', inicioMes).get();
    // Mesma regra de "aporte" do app (ehAporte, em js/ativos.js): Bitcoin, Reserva, dividendo e ajuste não contam
    const aportou = snap.docs.map(d => d.data()).some(d => String(d.data || '').slice(0, 7) === mesKey && ehAporte(d));
    if (!aportou) {
      const total = profile.aporteMensalEur || 100, br = profile.aporteBrEur || 60, intl = profile.aporteIntlEur || 40;
      avisos.push({ key: 'aporte-' + mesKey, title: '📅 Dia de aporte', body: `Hora do aporte do mês: €${total} (€${br} Brasil + €${intl} Internacional). Depois registre em Aportar.`, url: '/?p=aportar' });
    }
  }

  // ── Dividendos anunciados ──
  try {
    const md = await getMarketData();
    ATIVOS_DIVIDENDOS.map(a => [a.key, a.id]).forEach(([k, nome]) => {
      const div = md[k + 'Dividend'];
      const cotas = pf[k + '_cotas'] || 0;
      if (!div?.amount || !div.date || !cotas) return;
      const key = `div-${k}-${div.date}`;
      const dias = (Date.now() - new Date(div.date + 'T12:00:00Z').getTime()) / 864e5;
      if (sent[key] || dias > 10 || dias < -40) return;
      const [y, m, d] = div.date.split('-');
      avisos.push({ key, title: `💚 ${nome} anunciou dividendo`, body: `${brl(div.amount)}/cota (data ${d}/${m}) — cerca de ${brl(div.amount * cotas)} nas suas ${cotas} cotas. Quando cair no Nubank, registre em Aportar → Dividendo.`, url: '/?p=aportar' });
    });
  } catch (e) { console.error('dividendos:', e.message); }

  let enviados = 0;
  for (const a of avisos) {
    const r = await sendToAll(db, { title: a.title, body: a.body, url: a.url });
    enviados += r.enviados;
    sent[a.key] = new Date().toISOString();
  }
  // Guarda só os últimos 60 controles para o documento não crescer para sempre
  const recentes = Object.fromEntries(Object.entries(sent).sort((a, b) => a[1] < b[1] ? 1 : -1).slice(0, 60));
  if (avisos.length) await stateRef.set({ sent: recentes, ultimaExecucao: new Date().toISOString() });

  return res.status(200).json({ ok: true, avisos: avisos.map(a => a.key), enviados });
};
