// WealthFlow — Tela de PIN, login no servidor e inicialização do app.
// Script clássico: compartilha o escopo global com os demais arquivos de js/ (carregados em ordem pelo index.html).

// ─────────────────────────────────────────
// PIN LOCK
// ─────────────────────────────────────────
// O PIN é conferido no SERVIDOR (api/login.js) — no navegador não existe hash nenhum para
// alguém quebrar. Com o PIN certo o servidor devolve um token do Firebase do usuário 'wf-owner',
// o único que as regras do Firestore aceitam. Enquanto o servidor ainda não tem a conta de
// serviço configurada, ele devolve token null e o app usa o login anônimo antigo (modo transição).
let enteredPin = '';
let pinChecking = false;

function loginEndpoint() {
  return location.protocol.startsWith('http') ? location.origin + '/api/login' : 'http://localhost:3001/login';
}

function updatePinDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((d, i) => d.classList.toggle('filled', i < enteredPin.length));
}

function pinFail(msg) {
  document.getElementById('pinError').textContent = msg;
  document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('error'));
  setTimeout(() => {
    enteredPin = '';
    updatePinDots();
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('error'));
    document.getElementById('pinError').textContent = '';
  }, msg === 'PIN incorreto' ? 500 : 2500);
}

function unlockApp() {
  document.getElementById('pinLock').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  init();
}

async function checkPin() {
  if (pinChecking) return;
  pinChecking = true;
  document.getElementById('pinError').textContent = 'Verificando…';
  try {
    let res;
    try {
      res = await fetch(loginEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin })
      });
    } catch (e) {
      pinFail('Servidor de login indisponível — verifique a internet');
      return;
    }
    if (res.status === 401) { pinFail('PIN incorreto'); return; }
    const d = await res.json().catch(() => ({}));
    if (d.error === 'config_pin_hash') { pinFail('WF_PIN_HASH mal configurado na Vercel'); return; }
    if (!res.ok || !d.ok) { pinFail('Erro no login — tente de novo'); return; }

    try {
      if (d.token) {
        await window._authFns.signInWithCustomToken(window._auth, d.token);
        localStorage.setItem('wf_auth_mode', 'owner');
      } else {
        await window._authFns.signInAnonymously(window._auth);
        localStorage.setItem('wf_auth_mode', 'anon');
      }
    } catch (e) {
      console.error('Erro de autenticação:', e);
      pinFail('Erro ao conectar no Firebase');
      return;
    }
    document.getElementById('pinError').textContent = '';
    localStorage.setItem('wf_pin_session', Date.now().toString());
    unlockApp();
  } finally {
    pinChecking = false;
  }
}

function setupPinKeypad() {
  document.querySelectorAll('.pin-key[data-num]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (enteredPin.length < 6) {
        enteredPin += btn.dataset.num;
        updatePinDots();
        if (enteredPin.length === 6) {
          setTimeout(checkPin, 150);
        }
      }
    });
  });
  document.getElementById('pinBackspace').addEventListener('click', () => {
    enteredPin = enteredPin.slice(0, -1);
    updatePinDots();
  });

  // Allow physical keyboard input too
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('pinLock').style.display === 'none') return;
    if (e.key >= '0' && e.key <= '9' && enteredPin.length < 6) {
      enteredPin += e.key;
      updatePinDots();
      if (enteredPin.length === 6) setTimeout(checkPin, 150);
    } else if (e.key === 'Backspace') {
      enteredPin = enteredPin.slice(0, -1);
      updatePinDots();
    }
  });
}

// Verifica se já tem sessão válida (24h)
function checkExistingSession() {
  const session = localStorage.getItem('wf_pin_session');
  if (session) {
    const elapsed = Date.now() - parseInt(session);
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (elapsed < TWENTY_FOUR_HOURS) {
      return true;
    }
  }
  return false;
}

// Espera o Firebase restaurar o login salvo no aparelho (onAuthStateChanged dispara uma vez ao carregar)
function waitForAuthUser() {
  return new Promise(resolve => {
    if (!window._authFns || !window._auth) return resolve(null);
    const unsub = window._authFns.onAuthStateChanged(window._auth, user => { unsub(); resolve(user); });
  });
}

async function startApp() {
  setupPinKeypad();
  maskThousandsInput(document.getElementById('f-valor'), 2);
  maskThousandsInput(document.getElementById('pf-renda'), 0);
  maskThousandsInput(document.getElementById('pf-meta-app'), 0);

  const user = await waitForAuthUser();
  if (checkExistingSession()) {
    if (user && !user.isAnonymous) { unlockApp(); return; }
    // Modo transição (servidor ainda sem conta de serviço): mantém o login anônimo antigo
    if (localStorage.getItem('wf_auth_mode') === 'anon') {
      try { await window._authFns.signInAnonymously(window._auth); } catch (e) { console.error(e); }
      unlockApp();
      return;
    }
  }
  // Sessão de 24h vencida (ou sem login válido): sai do Firebase e pede o PIN de novo
  localStorage.removeItem('wf_pin_session');
  if (user) { try { await window._authFns.signOut(window._auth); } catch {} }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
async function checkProxy() {
  // Ordem de busca: /api na mesma origem (deploy Vercel — funciona no celular),
  // depois o server.js local (index.html aberto direto no PC).
  const candidates = [];
  if (location.protocol === 'http:' || location.protocol === 'https:') candidates.push(location.origin + '/api');
  candidates.push('http://localhost:3001');
  proxyAvailable = false;
  for (const base of candidates) {
    try {
      const r = await fetch(base + '/health', { signal: AbortSignal.timeout(2500) });
      const d = await r.json();
      if (d.ok === true) { proxyAvailable = true; proxyBase = base; break; }
    } catch(e) {}
  }
}

async function init() {
  applyValuesVisibility();
  if (apiKey)    document.getElementById('apiKeyInput').value    = apiKey;
  if (geminiKey) document.getElementById('geminiKeyInput').value = geminiKey;
  await checkProxy();
  await loadMarketData();
  const loadUserData = async () => {
    await loadProfile();
    refreshDerivedFromProfile();
    await loadPortfolio();
    renderAlertas();
  };
  if (window._dbReady) await loadUserData();
  else window.addEventListener('dbready', loadUserData, { once: true });
  // Notificação tocada (ex.: ?p=aportar) abre direto na página certa
  const paginaInicial = new URLSearchParams(location.search).get('p');
  if (paginaInicial && pageTitles[paginaInicial]) {
    showPage(paginaInicial);
  }
  // Inteligência embutida (fase 3): geradas 1x/dia e 1x/mês, com cache — custo mínimo
  loadDailyInsight();
  loadMonthlySummary();
  setInterval(loadMarketData, 5 * 60 * 1000);
}

// PWA: service worker só quando servido por http(s) — file:// não suporta
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
