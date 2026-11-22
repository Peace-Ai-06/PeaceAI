// Shared UI helpers: inline SVG icons, theme application, safe markdown, formatting.
import { escapeHtml } from './api.js';
import { state, getTheme } from './store.js';

const svg = (paths) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  chat: svg('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>'),
  admin: svg('<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
  logout: svg('<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  attach: svg('<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l8-8"/>'),
  send: svg('<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 4-4"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14 6 4 4"/>'),
  test: svg('<path d="m9 6 6 3-4 3 4 3-6 3"/><path d="M3 12h3m12 0h3"/>'),
  upload: svg('<path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  refresh: svg('<path d="M20 11A8 8 0 1 0 18 17"/><path d="M20 4v7h-7"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  spark: svg('<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/><circle cx="12" cy="12" r="2.5"/>'),
};

// Apply theme variables/attributes, including the user's scoped custom CSS.
export function applyTheme() {
  const t = getTheme();
  const root = document.documentElement;
  root.dataset.theme = t.mode === 'light' ? 'light' : 'dark';
  root.dataset.density = t.density === 'compact' ? 'compact' : 'comfortable';
  root.dataset.font = t.font || 'system';
  root.dataset.sidebar = t.sidebar === 'right' ? 'right' : 'left';
  const accent = t.accent || '#8b7bff';
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-2', `color-mix(in srgb, ${accent} 55%, #39d7c4)`);

  let style = document.getElementById('user-css');
  if (!style) {
    style = document.createElement('style');
    style.id = 'user-css';
    document.head.appendChild(style);
  }
  // @layer keeps user rules scoped to a low-priority cascade layer.
  style.textContent = t.customCss ? `@layer user-custom {\n${t.customCss}\n}` : '';
}

// Keep top bar / document title in sync after branding updates.
export function updateBranding() {
  const branding = state.tenant?.branding || {};
  const name = branding.appName || 'PeaceAi';
  document.title = name;
  document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('[data-logo-text]').forEach((el) => { el.textContent = branding.logoText || name.slice(0, 1).toUpperCase() || 'P'; });
  document.querySelectorAll('[data-tagline]').forEach((el) => { el.textContent = branding.tagline || ''; });
  applyTheme();
}

export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.classList.add('toast-hide');
    setTimeout(() => node.remove(), 250);
  }, 4200);
}

export function formatDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(value); }
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function stateBox(kind, title, message = '', actionHtml = '') {
  const fallback = { loading: 'Loading', empty: 'Nothing here yet', error: 'Something went wrong' };
  return `<div class="state-box state-${kind}" role="status">
    <div class="state-glyph">${kind === 'loading' ? icons.refresh : kind === 'error' ? icons.close : icons.file}</div>
    <h3>${escapeHtml(title || fallback[kind] || '')}</h3>
    ${message ? `<p>${escapeHtml(message)}</p>` : ''}
    ${actionHtml}
  </div>`;
}

export function errorBox(err, retryAction = '') {
  const message = err?.message || 'The request could not be completed.';
  return stateBox('error', 'Could not load this section', message,
    retryAction ? `<button type="button" class="btn btn-sm" data-action="${escapeHtml(retryAction)}">${icons.refresh} Try again</button>` : '');
}

// --- Safe, minimal markdown -------------------------------------------------
function safeUrl(raw) {
  const url = String(raw || '').trim();
  return /^(https?:\/\/|mailto:|\/|#)/i.test(url) ? url : '';
}

function formatInline(raw) {
  let text = escapeHtml(raw);
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const url = safeUrl(href);
    if (!url) return match;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return text.replace(/\n/g, '<br>');
}

/** Escapes everything, then applies fenced/inline code, bold and links. */
export function renderMarkdown(input) {
  const text = String(input ?? '');
  const blocks = text.split(/```/);
  let html = '';
  blocks.forEach((block, index) => {
    if (index % 2 === 1) {
      const newline = block.indexOf('\n');
      const lang = newline === -1 ? '' : block.slice(0, newline).trim();
      const code = newline === -1 ? block : block.slice(newline + 1);
      html += `<pre class="code-block"><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
      return;
    }
    const parts = block.split(/(`[^`\n]+`)/g);
    for (const part of parts) {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        html += `<code class="inline-code">${escapeHtml(part.slice(1, -1))}</code>`;
      } else {
        html += formatInline(part);
      }
    }
  });
  return html;
}
