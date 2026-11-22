// PeaceAi SPA entry point: bootstraps the session, hash routing and app shell.
import { api, escapeHtml } from './api.js';
import { state, setSession, setGuestSession, clearSession } from './store.js';
import { applyTheme, icons, toast, updateBranding } from './ui.js';
import { renderChat } from './chat.js';
import { renderAdmin } from './admin.js';
import { renderSettings } from './settings.js';

const root = document.getElementById('app');
let routeSeq = 0;

function currentPath() {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || '';
}

function navigate(path) {
  if (currentPath() === path) route();
  else location.hash = `#/${path}`;
}

function guestLimitLabel() {
  const guest = state.guest || {};
  if (guest.enabled === false) return 'Guest chat off';
  const basis = guest.basis || 'messages';
  const remaining = Number.isFinite(guest.remaining) ? guest.remaining : '—';
  return `${remaining} ${basis} left`;
}

async function bootstrap() {
  applyTheme();
  window.addEventListener('hashchange', route);
  window.addEventListener('peaceai:guest-update', (event) => {
    state.guest = event.detail;
    const badge = document.querySelector('.topbar .badge-warn');
    if (badge) badge.textContent = guestLimitLabel();
  });

  try {
    setSession(await api('/api/auth/me'));
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'error');
    clearSession();
    try {
      // ChatGPT-style start: guests can chat before creating an account.
      setGuestSession(await api('/api/guest/session', { method: 'POST' }));
    } catch (guestErr) {
      toast(guestErr.message, 'error');
    }
  }
  const initialPath = currentPath();
  if (!state.me && (initialPath === 'login' || initialPath === 'register')) {
    // A hash left over from an earlier visit must not resurrect the login wall.
    history.replaceState(null, '', '#/app/chat');
  }
  updateBranding();
  route();
}

async function startGuest() {
  try {
    setGuestSession(await api('/api/guest/session', { method: 'POST' }));
  } catch (err) {
    // Never turn the home page into a login wall, even if the session call fails.
    setGuestSession({
      tenant: { name: 'PeaceAi', branding: { appName: 'PeaceAi', logoText: 'P', tagline: 'Intelligence, in harmony.' } },
      guest: { enabled: true, basis: 'messages', limit: 10, remaining: 10 },
      agent: { name: 'PeaceAi Assistant', icon: '✨' },
    });
    toast(err.message, 'error');
  }
  updateBranding();
  if (currentPath() !== 'app/chat') history.replaceState(null, '', '#/app/chat');
  route();
}

function goChat() {
  if (currentPath() !== 'app/chat') history.replaceState(null, '', '#/app/chat');
  route();
}

async function route() {
  const seq = ++routeSeq;
  const path = currentPath();

  // Auth screens are opt-in (topbar "Sign in"), never the app's starting page.
  if (path === 'login' || path === 'register') {
    if (state.me) { goChat(); return; }
    state.authMode = path === 'register' ? 'register' : 'login';
    renderAuth(state.authMode);
    return;
  }

  if (!state.me && !state.isGuest) {
    startGuest();
    return;
  }

  if (!path || !path.startsWith('app/')) { goChat(); return; }
  if (state.isGuest && path !== 'app/chat') { goChat(); return; }

  const view = path.split('/')[1] || 'chat';
  state.route = ['chat', 'admin', 'settings'].includes(view) ? view : 'chat';
  if (state.route !== view) {
    history.replaceState(null, '', `#/app/${state.route}`);
    route();
    return;
  }
  renderShell(state.route, seq);
}

// --- Authentication screen (login / register in one place) ------------------
function renderAuth(mode) {
  if (routeSeq && !state.me && currentPath() === 'register') mode = 'register';
  const isRegister = mode === 'register';
  root.innerHTML = `
    <div class="auth-page">
      <div class="auth-card card">
        <div class="auth-brand">
          <span class="brand-mark brand-mark-lg">P</span>
          <div>
            <h1>PeaceAi</h1>
            <p class="muted">Your private, configurable AI workspace.</p>
          </div>
        </div>
        <div class="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" role="tab" class="${isRegister ? '' : 'active'}" data-auth-mode="login" aria-selected="${!isRegister}">Sign in</button>
          <button type="button" role="tab" class="${isRegister ? 'active' : ''}" data-auth-mode="register" aria-selected="${isRegister}">Create account</button>
        </div>
        <div id="auth-alert"></div>
        <form id="auth-form" class="form-stack" novalidate>
          ${isRegister ? `
            <label class="field"><span>Name</span><input name="name" type="text" autocomplete="name" placeholder="Your name" required></label>
            <label class="field"><span>Workspace name</span><input name="tenantName" type="text" placeholder="Acme Studio" required></label>
          ` : ''}
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" placeholder="At least 8 characters" required minlength="8"></label>
          <button type="submit" class="btn btn-primary btn-block" data-submit>${isRegister ? 'Create workspace' : 'Sign in'}</button>
        </form>
        <button type="button" class="btn btn-block" data-action="continue-guest" style="margin-top:.75rem">Continue as guest — no sign in needed</button>
        <p class="auth-foot muted">${isRegister ? 'Already have a workspace?' : 'New to PeaceAi?'}
          <button type="button" class="link-btn" data-auth-mode="${isRegister ? 'login' : 'register'}">${isRegister ? 'Sign in' : 'Create an account'}</button>
        </p>
      </div>
      <p class="auth-copy muted">Multi-tenant AI assistants, knowledge bases and tools — in one place.</p>
    </div>`;

  root.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.authMode;
      if (next === currentPath()) renderAuth(next);
      else location.hash = `#/${next}`;
    });
  });

  root.querySelector('[data-action="continue-guest"]')?.addEventListener('click', startGuest);

  const form = root.querySelector('#auth-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const alertBox = root.querySelector('#auth-alert');
    const submit = form.querySelector('[data-submit]');
    const body = Object.fromEntries(new FormData(form));
    alertBox.innerHTML = '';
    submit.disabled = true;
    submit.textContent = 'Please wait…';
    try {
      const result = await api(isRegister ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
      setSession(result);
      updateBranding();
      toast(`Welcome, ${result.user?.name || 'there'}!`, 'success');
      navigate('app/chat');
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err.message)}</div>`;
    } finally {
      submit.disabled = false;
      submit.textContent = isRegister ? 'Create workspace' : 'Sign in';
    }
  });
}

// --- App shell --------------------------------------------------------------
function renderShell(view, seq) {
  const branding = state.tenant?.branding || {};
  const user = state.me || {};
  const navItem = (key, label, icon) => `<a href="#/app/${key}" class="nav-item ${view === key ? 'active' : ''}" data-view="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;

  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <header class="topbar">
      <button type="button" class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="Toggle navigation">${icons.menu}</button>
      <div class="brand">
        <span class="brand-mark" data-logo-text>${escapeHtml(branding.logoText || 'P')}</span>
        <span class="brand-name" data-app-name>${escapeHtml(branding.appName || 'PeaceAi')}</span>
      </div>
      <div class="topbar-spacer"></div>
      ${state.isGuest ? `<span class="badge badge-warn" title="Guest chat limit">${escapeHtml(guestLimitLabel())}</span>
        <button type="button" class="btn btn-sm btn-primary" data-action="sign-in">Sign in</button>` : ''}
      <button type="button" class="icon-btn" data-action="theme-toggle" aria-label="Toggle dark and light theme" title="Toggle theme">${(state.isGuest ? (document.documentElement.dataset.theme === 'light') : state.me?.theme?.mode === 'light') ? icons.sun : icons.moon}</button>
      ${state.isGuest ? '' : `<details class="user-menu">
        <summary class="user-summary" aria-label="User menu">
          <span class="avatar">${escapeHtml((user.name || user.email || '?').slice(0, 1).toUpperCase())}</span>
          <span class="user-summary-name">${escapeHtml(user.name || user.email || 'Account')}</span>
          ${icons.chevron}
        </summary>
        <div class="menu-popover">
          <div class="menu-info"><strong>${escapeHtml(user.name || '')}</strong><span class="muted">${escapeHtml(user.email || '')}</span><span class="badge">${escapeHtml(user.role || 'member')}</span></div>
          <button type="button" class="menu-item" data-action="goto-settings">${icons.settings} Settings</button>
          <button type="button" class="menu-item danger" data-action="logout">${icons.logout} Log out</button>
        </div>
      </details>`}
    </header>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-section-label">Workspace</div>
      <nav class="nav" aria-label="Main navigation">
        ${navItem('chat', 'Chat', icons.chat)}
        ${(!state.isGuest && user.role === 'admin') ? navItem('admin', 'Admin', icons.admin) : ''}
        ${state.isGuest ? '' : navItem('settings', 'Settings', icons.settings)}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-tenant">${escapeHtml(state.tenant?.name || 'PeaceAi')}</div>
        <div class="muted small" data-tagline>${escapeHtml(branding.tagline || '')}</div>
      </div>
    </aside>
    <main class="view" id="view" tabindex="-1"></main>`;

  root.replaceChildren(shell);
  updateBranding();

  shell.querySelector('[data-action="toggle-sidebar"]')?.addEventListener('click', () => shell.classList.toggle('sidebar-open'));
  shell.querySelectorAll('.nav-item').forEach((link) => link.addEventListener('click', () => shell.classList.remove('sidebar-open')));

  shell.querySelector('[data-action="theme-toggle"]').addEventListener('click', async () => {
    const next = (document.documentElement.dataset.theme === 'light') ? 'dark' : 'light';
    state.previewTheme = { ...(state.previewTheme || {}), mode: next };
    applyTheme();
    const toggle = shell.querySelector('[data-action="theme-toggle"]');
    toggle.innerHTML = next === 'light' ? icons.sun : icons.moon;
    const modeSelect = document.getElementById('theme-mode');
    if (modeSelect) modeSelect.value = next;
    if (state.isGuest) {
      toast('Theme preference is saved when you sign in.', 'info');
      return;
    }
    const theme = { ...(state.me?.theme || {}), mode: next };
    try {
      const res = await api('/api/me/theme', { method: 'PUT', body: { theme } });
      state.me = res.user || state.me;
      state.previewTheme = null;
      applyTheme();
    } catch (err) {
      state.previewTheme = null;
      applyTheme();
      toast(err.message, 'error');
    }
  });

  shell.querySelector('[data-action="sign-in"]')?.addEventListener('click', () => {
    location.hash = '#/login';
  });

  const menu = shell.querySelector('.user-menu');
  if (menu) {
    menu.querySelector('[data-action="goto-settings"]').addEventListener('click', () => {
      menu.open = false;
      navigate('app/settings');
    });
    menu.querySelector('[data-action="logout"]').addEventListener('click', async () => {
      menu.open = false;
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* local logout still applies */ }
      clearSession();
      startGuest();
    });
    document.addEventListener('click', (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
  }

  const container = shell.querySelector('#view');
  if (view === 'admin') renderAdmin(container, seq);
  else if (view === 'settings') renderSettings(container, seq);
  else renderChat(container, seq);
}

bootstrap();
