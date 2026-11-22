const token = location.pathname.split('/').filter(Boolean).pop();
const BRAND_EMBLEM = '/brand/peaceai-emblem.svg';
const escape = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderShell({ title, brand, icon, accent, body, disabled = false }) {
  if (accent) document.documentElement.style.setProperty('--accent', accent);
  document.title = `${title} · PeaceAI`;
  document.body.innerHTML = `
    <div class="shell">
      <header class="share-head">
        <div class="icon"><img src="${BRAND_EMBLEM}" alt="PeaceAI"></div>
        <div><span class="eyebrow">Shared agent</span><h1>${escape(icon || '✨')} ${escape(title)}</h1><div class="brand">${escape(brand || 'PeaceAI')}</div></div>
      </header>
      <div class="card" id="thread">${body}</div>
      <div class="meta"><span id="quota"></span><span>Powered by PeaceAI</span></div>
    </div>
    <div class="composer">
      <form id="form">
        <textarea id="input" rows="1" placeholder="Ask a question…" autocomplete="off" ${disabled ? 'disabled' : ''}></textarea>
        <button id="send" type="submit" ${disabled ? 'disabled' : ''}>Send</button>
      </form>
    </div>`;
}

function add(role, text) {
  const thread = document.getElementById('thread');
  if (thread.querySelector('.empty')) thread.innerHTML = '';
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  thread.appendChild(div);
  div.scrollIntoView({ block: 'end' });
}

function updateQuota(remaining) {
  if (!remaining) return;
  document.getElementById('quota').textContent = `${remaining.remaining} of ${remaining.limit} ${remaining.basis} remaining`;
  if (remaining.remaining <= 0) {
    document.getElementById('input').disabled = true;
    document.getElementById('send').disabled = true;
  }
}

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; --accent: #6D28FF; --brand-purple: #6D28FF; --brand-violet: #9333EA; --brand-cyan: #00C8FF; --accent-contrast: #ffffff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    background: radial-gradient(760px 420px at 12% -10%, color-mix(in srgb, var(--brand-purple) 18%, transparent), transparent 70%), #090B24;
    color: #f4f2ff; font: 14.5px/1.58 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell { max-width: 800px; margin: 0 auto; padding: 36px 18px 150px; }
  .share-head { display: flex; gap: 14px; align-items: center; margin-bottom: 22px; }
  .icon {
    width: 50px; height: 50px; display: grid; place-items: center; border-radius: 15px; font-size: 23px;
    background: color-mix(in srgb, var(--brand-purple) 18%, #12153A); border: 1px solid color-mix(in srgb, var(--brand-cyan) 26%, #343A72);
  }
  .icon img { display: block; width: 40px; height: 40px; }
  .eyebrow { display: block; color: #9b98c7; font-size: .64rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; margin-bottom: 4px; }
  h1 { margin: 0; font-size: 1.35rem; letter-spacing: -.03em; }
  .brand { color: #9b98c7; font-size: .78rem; margin-top: 2px; }
  .card { background: #12153A; border: 1px solid #343A72; border-radius: 18px; padding: 22px; box-shadow: 0 18px 44px rgba(0,0,0,.3); }
  .msg { margin: 0 0 16px; padding: 13px 16px; border-radius: 13px; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #2A2F60; }
  .user { background: color-mix(in srgb, var(--brand-purple) 16%, #191D4A); margin-left: 52px; border-color: color-mix(in srgb, var(--brand-violet) 32%, #343A72); border-bottom-right-radius: 5px; }
  .assistant { background: #191D4A; margin-right: 52px; border-bottom-left-radius: 5px; }
  .empty { color: #9b98c7; text-align: center; padding: 48px 10px; max-width: 460px; margin: 0 auto; }
  .composer { position: fixed; bottom: 0; left: 0; right: 0; padding: 20px 18px 22px; background: linear-gradient(transparent, #090B24 24%); }
  .composer form {
    max-width: 764px; margin: auto; display: flex; gap: 10px; align-items: flex-end;
    background: #12153A; border: 1px solid #343A72; border-radius: 16px; padding: 8px;
    box-shadow: 0 12px 34px rgba(0,0,0,.36);
  }
  .composer form:focus-within { border-color: color-mix(in srgb, var(--brand-cyan) 45%, #343A72); }
  textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; padding: 9px 10px; max-height: 150px; min-height: 46px; }
  textarea::placeholder { color: #736c9c; }
  button { border: 0; border-radius: 12px; background: linear-gradient(120deg, var(--brand-purple), var(--brand-violet) 48%, var(--brand-cyan)); color: var(--accent-contrast); font: inherit; font-weight: 700; padding: 11px 22px; cursor: pointer; }
  button:disabled, textarea:disabled { opacity: .45; cursor: not-allowed; }
  .meta { display: flex; justify-content: space-between; color: #9b98c7; font-size: .74rem; margin-top: 12px; gap: 12px; }
  .error { color: #ff7d9a; }
  @media (max-width: 560px) {
    .shell { padding-top: 24px; }
    .user { margin-left: 12px; }
    .assistant { margin-right: 12px; }
    .card { padding: 16px; }
  }
`;
document.head.appendChild(style);

try {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok || !data.agent) {
    renderShell({ title: 'Shared agent unavailable', brand: 'PeaceAI', icon: '⚠️', body: `<div class="empty error">${escape(data.error?.message || 'This link is not available.')}</div>`, disabled: true });
  } else {
    const agent = data.agent;
    renderShell({
      title: agent.name,
      brand: agent.tenant?.appName || 'PeaceAI',
      icon: agent.icon || '✨',
      accent: agent.accent,
      body: `<div class="empty">${escape(agent.description || 'Ask this agent anything.')}</div>`,
    });
    const session = await fetch(`/api/share/${encodeURIComponent(token)}/session`, { method: 'POST', credentials: 'same-origin' }).then((r) => r.json());
    updateQuota(session.remaining);
    document.getElementById('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('input');
      const send = document.getElementById('send');
      const message = input.value.trim();
      if (!message || send.disabled) return;
      add('user', message);
      input.value = '';
      send.disabled = true;
      send.textContent = '…';
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(token)}/chat`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
        });
        const payload = await response.json();
        if (!response.ok) {
          add('assistant', payload.error?.message || 'Something went wrong.');
          if (payload.error?.code === 'share_limit_reached') add('assistant', 'Sign up for PeaceAI to keep chatting with your own agents.');
        } else {
          add('assistant', payload.reply || '(no reply)');
          updateQuota(payload.remaining);
        }
      } catch {
        add('assistant', 'Could not reach the server.');
      } finally {
        const quota = document.getElementById('quota').textContent;
        const exhausted = /(^|\s)0 of /.test(quota);
        send.disabled = exhausted;
        input.disabled = exhausted;
        send.textContent = 'Send';
        if (!exhausted) input.focus();
      }
    });
  }
} catch {
  renderShell({ title: 'Shared agent unavailable', brand: 'PeaceAI', icon: '⚠️', body: '<div class="empty error">Could not load this shared agent.</div>', disabled: true });
}
