// PeaceAI SPA entry point: bootstraps the session, hash routing and app shell.
import { api, escapeHtml } from './api.js';
import { state, setSession, setGuestSession, clearSession } from './store.js';
import { applyTheme, icons, toast, updateBranding, brandLogo } from './ui.js';
import { renderChat } from './chat.js';
import { ADMIN_NAV, renderAdmin } from './admin.js';
import { renderSettings } from './settings.js';

const root = document.getElementById('app');
let routeSeq = 0;

function currentPath() {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || '';
}

const SEO = {
  'app/chat': { title: 'Chat — PeaceAI', description: 'Chat with PeaceAI agents in a private workspace.', robots: 'noindex,nofollow' },
  'app/settings': { title: 'Settings — PeaceAI', description: 'Manage your PeaceAI account settings.', robots: 'noindex,nofollow' },
  'app/admin': { title: 'Admin — PeaceAI', description: 'Manage PeaceAI workspace settings and agents.', robots: 'noindex,nofollow' },
  login: { title: 'Sign in — PeaceAI', description: 'Sign in to your PeaceAI workspace.', robots: 'noindex,nofollow' },
  register: { title: 'Create account — PeaceAI', description: 'Create your PeaceAI workspace account.', robots: 'noindex,nofollow' },
  'forgot-password': { title: 'Forgot password — PeaceAI', description: 'Reset your PeaceAI password.', robots: 'noindex,nofollow' },
  'reset-password': { title: 'Reset password — PeaceAI', description: 'Set a new PeaceAI password.', robots: 'noindex,nofollow' },
  default: { title: 'PeaceAI — Private AI Workspace', description: 'PeaceAI is a private AI workspace for chat, document Q&A, agents, and secure coding tools.', robots: 'index,follow,max-image-preview:large' },
};

function applySeo(path = currentPath()) {
  const key = path.startsWith('app/admin') ? 'app/admin' : path.startsWith('app/') ? `app/${path.split('/')[1] || 'chat'}` : path;
  const meta = SEO[key] || SEO.default;
  document.title = meta.title;
  const setMeta = (selector, attr, value) => {
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement('meta');
      const m = selector.match(/\[(.+?)="(.+?)"\]/);
      if (m) el.setAttribute(m[1], m[2]);
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  };
  setMeta('[name="description"]', 'content', meta.description);
  setMeta('[name="robots"]', 'content', meta.robots);
  setMeta('[property="og:title"]', 'content', meta.title);
  setMeta('[property="og:description"]', 'content', meta.description);
  setMeta('[property="og:url"]', 'content', location.origin + '/' + (key === 'default' ? '' : `#/${key}`));
  setMeta('[name="twitter:title"]', 'content', meta.title);
  setMeta('[name="twitter:description"]', 'content', meta.description);
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
  canonical.href = location.origin + '/';
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
      tenant: { name: 'PeaceAI', branding: { appName: 'PeaceAI', logoText: 'P', tagline: 'Intelligence, in harmony.' } },
      guest: { enabled: true, basis: 'messages', limit: 10, remaining: 10 },
      agent: { name: 'PeaceAI Assistant', icon: '✨' },
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
  applySeo(path);

  // Auth screens are opt-in (topbar "Sign in"), never the app's starting page.
  if (path === 'login' || path === 'register' || path === 'forgot-password' || path === 'reset-password') {
    if (state.me) { goChat(); return; }
    if (path === 'forgot-password') { renderForgotPassword(); return; }
    if (path === 'reset-password') { renderResetPassword(); return; }
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

  const parts = path.split('/');
  const view = parts[1] || 'chat';
  state.route = ['chat', 'admin', 'settings'].includes(view) ? view : 'chat';
  if (view === 'admin') {
    const allowed = ADMIN_NAV.filter((item) => !item.platformOnly || state.me?.isPlatformAdmin).map((item) => item.id);
    state.adminTab = allowed.includes(parts[2]) ? parts[2] : 'overview';
    const expected = `#/app/admin/${state.adminTab}`;
    if (location.hash !== expected) history.replaceState(null, '', expected);
  }
  if (state.route !== view) {
    history.replaceState(null, '', `#/app/${state.route}`);
    route();
    return;
  }
  renderShell(state.route, seq);
}

// --- Authentication screen (login / register in one place) ------------------
function authShell({ eyebrow, title, subtitle, body, foot = '' }) {
  return `
    <div class="auth-page">
      <div class="auth-layout">
        <aside class="auth-visual">
          <div class="auth-brand">
            ${brandLogo('full', 'auth-logo', 'PeaceAI — Create, Code, Learn, Improve')}
          </div>
          <div class="auth-claim">
            <span class="eyebrow">A calmer workspace</span>
            <h2>One clear place for every answer.</h2>
            <p class="muted">Bring your agents, documents and code together in a private workspace shaped around how you work.</p>
          </div>
          <ul class="auth-points">
            <li><span class="auth-point-icon">${icons.spark}</span><span>Agents that know your documents</span></li>
            <li><span class="auth-point-icon">${icons.file}</span><span>Private knowledge, cited in every answer</span></li>
            <li><span class="auth-point-icon">${icons.admin}</span><span>Admin control without the noise</span></li>
          </ul>
        </aside>
        <section class="auth-panel">
          <div class="auth-panel-head">
            <span class="eyebrow">${escapeHtml(eyebrow)}</span>
            <h2>${escapeHtml(title)}</h2>
            <p class="muted">${escapeHtml(subtitle)}</p>
          </div>
          ${body}
          ${foot}
        </section>
      </div>
      <p class="auth-copy muted">Multi-tenant AI assistants, knowledge bases and tools — in one place.</p>
    </div>`;
}

function renderAuth(mode) {
  if (routeSeq && !state.me && currentPath() === 'register') mode = 'register';
  const isRegister = mode === 'register';
  root.innerHTML = authShell({
    eyebrow: isRegister ? 'Get started' : 'Welcome back',
    title: isRegister ? 'Create your workspace' : 'Sign in to PeaceAI',
    subtitle: isRegister ? 'A private home for your agents and knowledge.' : 'Pick up where your work left off.',
    body: `
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
        ${!isRegister ? '<div class="auth-inline"><button type="button" class="link-btn" data-nav="forgot-password">Forgot password?</button></div>' : ''}
        <button type="submit" class="btn btn-primary btn-block" data-submit>${isRegister ? 'Create workspace' : 'Sign in'}</button>
      </form>
      <div class="auth-divider">or</div>
      <button type="button" class="btn btn-block" data-action="continue-guest" style="margin-top:.75rem">Continue as guest — no sign in needed</button>
      <p class="auth-foot muted">${isRegister ? 'Already have a workspace?' : 'New to PeaceAI?'}
        <button type="button" class="link-btn" data-auth-mode="${isRegister ? 'login' : 'register'}">${isRegister ? 'Sign in' : 'Create an account'}</button>
      </p>`,
  });

  root.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.authMode;
      if (next === currentPath()) renderAuth(next);
      else location.hash = `#/${next}`;
    });
  });

  root.querySelector('[data-nav="forgot-password"]')?.addEventListener('click', () => { location.hash = '#/forgot-password'; });
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

function renderForgotPassword() {
  root.innerHTML = authShell({
    eyebrow: 'Account recovery',
    title: 'Forgot password',
    subtitle: "Enter your email and we'll send a reset link.",
    body: `
      <div id="auth-alert"></div>
      <form id="forgot-form" class="form-stack" novalidate>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
        <button type="submit" class="btn btn-primary btn-block" data-submit>Send reset link</button>
      </form>
      <p class="auth-foot muted"><button type="button" class="link-btn" data-nav="login">Back to sign in</button></p>`,
  });
  root.querySelector('[data-nav="login"]')?.addEventListener('click', () => { location.hash = '#/login'; });
  root.querySelector('#forgot-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const alertBox = root.querySelector('#auth-alert');
    const submit = event.currentTarget.querySelector('[data-submit]');
    alertBox.innerHTML = '';
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const result = await api('/api/auth/forgot-password', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) });
      alertBox.innerHTML = `<div class="alert alert-success" role="alert">${escapeHtml(result.message || 'If an account exists for that email, a reset link has been sent.')}</div>`;
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err.message)}</div>`;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send reset link';
    }
  });
}

function renderResetPassword() {
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';
  root.innerHTML = authShell({
    eyebrow: 'Account recovery',
    title: 'Reset password',
    subtitle: 'Choose a new password for your account.',
    body: `
      <div id="auth-alert"></div>
      ${token ? `
        <form id="reset-form" class="form-stack" novalidate>
          <label class="field"><span>New password</span><input name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required minlength="8"></label>
          <label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" placeholder="Re-enter password" required minlength="8"></label>
          <button type="submit" class="btn btn-primary btn-block" data-submit>Reset password</button>
        </form>
      ` : `<div class="alert alert-error" role="alert">This reset link is missing a token. Request a new one.</div>`}
      <p class="auth-foot muted">
        <button type="button" class="link-btn" data-nav="forgot-password">Request a new link</button>
        <span class="muted"> · </span>
        <button type="button" class="link-btn" data-nav="login">Back to sign in</button>
      </p>`,
  });
  root.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => { location.hash = `#/${button.dataset.nav}`; });
  });
  root.querySelector('#reset-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const alertBox = root.querySelector('#auth-alert');
    const submit = event.currentTarget.querySelector('[data-submit]');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    alertBox.innerHTML = '';
    if (body.password !== body.confirm) {
      alertBox.innerHTML = '<div class="alert alert-error" role="alert">Passwords do not match.</div>';
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Resetting…';
    try {
      const result = await api('/api/auth/reset-password', { method: 'POST', body: { token, password: body.password } });
      alertBox.innerHTML = `<div class="alert alert-success" role="alert">${escapeHtml(result.message || 'Password updated. Please sign in.')}</div>`;
      event.currentTarget.reset();
      setTimeout(() => { location.hash = '#/login'; }, 900);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err.message)}</div>`;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Reset password';
    }
  });
}

// --- App shell --------------------------------------------------------------
function renderShell(view, seq) {
  const branding = state.tenant?.branding || {};
  const user = state.me || {};
  const isAdmin = !state.isGuest && user.role === 'admin';
  const viewLabel = view === 'admin' ? 'Admin' : view === 'settings' ? 'Settings' : 'Chat';
  const adminLabel = ADMIN_NAV.find((item) => item.id === state.adminTab)?.label || 'Overview';
  const navItem = (key, label, icon) => `<a href="#/app/${key}" class="nav-item ${view === key ? 'active' : ''}" data-view="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
  const railItem = (key, href, label, icon) => `<a href="${href}" class="rail-btn ${view === key ? 'active' : ''}" data-view="${key}" title="${label}" aria-label="${label}" ${view === key ? 'aria-current="page"' : ''}>${icon}</a>`;

  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.dataset.view = view;
  shell.innerHTML = `
    <aside class="rail" aria-label="Primary navigation">
      ${brandLogo('emblem', 'rail-logo', 'PeaceAI')}
      <div class="rail-sep"></div>
      <nav class="rail-nav">
        ${railItem('chat', '#/app/chat', 'Chat', icons.chat)}
        ${isAdmin ? railItem('admin', `#/app/admin/${state.adminTab}`, 'Admin', icons.admin) : ''}
        ${state.isGuest ? '' : railItem('settings', '#/app/settings', 'Settings', icons.settings)}
      </nav>
      <div class="rail-bottom">
        ${state.isGuest
          ? `<button type="button" class="rail-btn" data-action="sign-in" title="Sign in" aria-label="Sign in">${icons.user}</button>`
          : `<span class="rail-btn rail-avatar avatar" title="Signed in as ${escapeHtml(user.name || user.email || 'member')}">${escapeHtml((user.name || user.email || '?').slice(0, 1).toUpperCase())}</span>`}
      </div>
    </aside>
    <header class="topbar">
      <button type="button" class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="Toggle navigation">${icons.menu}</button>
      <div class="crumbs">
        <span class="crumb-dot"></span>
        <span class="crumb-root" data-app-name>${escapeHtml(branding.appName || 'PeaceAI')}</span>
        <span class="crumb-sep">/</span>
        <span class="crumb-current">${viewLabel}</span>
        ${view === 'admin' ? `<span class="crumb-sep">/</span><span class="crumb-current muted">${escapeHtml(adminLabel)}</span>` : ''}
      </div>
      <div class="topbar-spacer"></div>
      ${state.isGuest ? `<span class="badge badge-warn" title="Guest chat limit">${escapeHtml(guestLimitLabel())}</span>
        <button type="button" class="btn btn-sm btn-primary" data-action="sign-in">Sign in</button>` : ''}
      <span class="topbar-status"><i></i>${state.isGuest ? 'Guest session' : escapeHtml(user.role || 'member')}</span>
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
      <div class="sidebar-brand">${brandLogo('compact', '', 'PeaceAI')}</div>
      <div class="sidebar-section-label">${view === 'admin' ? 'Administration' : 'Workspace'}</div>
      <nav class="nav" aria-label="Main navigation">
        ${navItem('chat', 'Chat', icons.chat)}
        ${isAdmin ? `
          <a href="#/app/admin/${state.adminTab}" class="nav-item ${view === 'admin' ? 'active' : ''}" data-view="admin">${icons.admin}<span>Admin</span></a>
          <div class="nav-sub" aria-label="Admin sections">
            ${ADMIN_NAV.filter((item) => !item.platformOnly || user.isPlatformAdmin).map((item) => `
              <a href="#/app/admin/${item.id}" class="nav-sub-item ${view === 'admin' && state.adminTab === item.id ? 'active' : ''}" data-view="admin" title="${escapeHtml(item.label)}">${item.icon}<span>${escapeHtml(item.label)}</span></a>`).join('')}
          </div>` : ''}
        ${state.isGuest ? '' : navItem('settings', 'Settings', icons.settings)}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-tenant">${escapeHtml(state.tenant?.name || 'PeaceAI')}</div>
        <div class="muted small" data-tagline>${escapeHtml(branding.tagline || '')}</div>
      </div>
    </aside>
    <main class="view" id="view" tabindex="-1"></main>`;

  root.replaceChildren(shell);
  updateBranding();

  shell.querySelector('[data-action="toggle-sidebar"]')?.addEventListener('click', () => shell.classList.toggle('sidebar-open'));
  shell.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', () => shell.classList.remove('sidebar-open')));

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

  shell.querySelectorAll('[data-action="sign-in"]').forEach((button) => {
    button.addEventListener('click', () => { location.hash = '#/login'; });
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
