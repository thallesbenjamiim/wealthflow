// WealthFlow — Utilidades: notificações push, escape de HTML e toast.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// NOTIFICAÇÕES PUSH — inscrição deste aparelho (envio diário em api/cron-notify.js)
// ─────────────────────────────────────────
async function pushApi(action, extra = {}) {
  const user = window._auth?.currentUser;
  if (!user || user.isAnonymous) throw new Error('Faça login com o PIN novamente');
  const token = await user.getIdToken();
  const r = await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action, ...extra })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function pushSuportado() {
  return location.protocol === 'https:' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const ehApp = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function atualizarStatusPush() {
  const st = document.getElementById('push-status');
  if (!st) return;
  const show = (ativar, teste, desativar) => {
    document.getElementById('push-ativar').hidden = !ativar;
    document.getElementById('push-teste').hidden = !teste;
    document.getElementById('push-desativar').hidden = !desativar;
  };
  if (!pushSuportado()) {
    st.textContent = ehIOS() && !ehApp()
      ? 'No iPhone, as notificações só funcionam com o app instalado: Compartilhar → "Adicionar à Tela de Início", e abra por lá.'
      : 'Este navegador não suporta notificações (abra pelo endereço https do app).';
    show(false, false, false);
    return;
  }
  if (Notification.permission === 'denied') {
    st.textContent = 'Notificações bloqueadas nas configurações do navegador/aparelho para este site.';
    show(false, false, false);
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    st.textContent = '✓ Ativas neste aparelho.';
    show(false, true, true);
  } else {
    st.textContent = 'Desativadas neste aparelho.';
    show(true, false, false);
  }
}

async function ativarNotificacoes() {
  try {
    if (!pushSuportado()) return atualizarStatusPush();
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { showToast('Permissão de notificação não concedida'); return atualizarStatusPush(); }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await pushApi('key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await pushApi('subscribe', { subscription: sub.toJSON() });
    showToast('✓ Notificações ativadas neste aparelho');
  } catch (e) {
    console.error(e);
    showToast('❌ Não foi possível ativar: ' + e.message);
  }
  atualizarStatusPush();
}

async function testarNotificacao() {
  try {
    const r = await pushApi('test');
    showToast(r.enviados ? `✓ Teste enviado para ${r.enviados} aparelho(s)` : '⚠️ Nenhum aparelho recebeu — tente desativar e ativar de novo');
  } catch (e) { showToast('❌ ' + e.message); }
}

async function desativarNotificacoes() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      await pushApi('unsubscribe', { subscription: sub.toJSON() }).catch(() => {});
      await sub.unsubscribe();
    }
    showToast('Notificações desativadas neste aparelho');
  } catch (e) { showToast('❌ ' + e.message); }
  atualizarStatusPush();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Markdown mínimo para respostas da IA — escapa o HTML ANTES de formatar, então nada
// que venha da IA (ou do histórico salvo) consegue injetar tags ou scripts na página
function mdLite(text) {
  return escapeHtml(text).replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<em>$1</em>');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

