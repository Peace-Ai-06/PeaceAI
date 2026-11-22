// Settings view: profile, live theme editor and password change.
import { api, escapeHtml } from './api.js';
import { state, getTheme } from './store.js';
import { applyTheme, icons, toast } from './ui.js';

function themeFormHtml(theme) {
  const select = (name, options) => `<select name="${name}" id="theme-${name}" class="select">${options.map(([value, label]) =>
    `<option value="${value}" ${theme[name] === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`;
  return `
    <form id="theme-form" class="form-stack">
      <div class="form-grid">
        <label class="field"><span>Appearance</span>${select('mode', [['dark', 'Dark'], ['light', 'Light']])}</label>
        <label class="field"><span>Accent colour</span><input name="accent" id="theme-accent" type="color" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(theme.accent || '') ? theme.accent : '#6D28FF')}"></label>
        <label class="field"><span>Font</span>${select('font', [['system', 'System UI'], ['serif', 'Serif'], ['mono', 'Monospace'], ['rounded', 'Rounded']])}</label>
        <label class="field"><span>Density</span>${select('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']])}</label>
        <label class="field"><span>Sidebar</span>${select('sidebar', [['left', 'Left'], ['right', 'Right']])}</label>
      </div>
      <label class="field"><span>Custom CSS</span><textarea name="customCss" id="theme-customCss" rows="7" placeholder="/* Scoped to PeaceAI's custom layer */">${escapeHtml(theme.customCss || '')}</textarea>
        <small class="muted">Changes preview live and are saved when you click Save theme.</small></label>
      <div class="form-actions"><button type="submit" class="btn btn-primary">Save theme</button><button type="button" class="btn" data-action="reset-theme">Discard changes</button></div>
    </form>`;
}

export async function renderSettings(container) {
  const user = state.me || {};
  const theme = getTheme();
  container.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">Personal preferences</span>
        <h1>Settings</h1>
        <p class="muted">Your profile, security and workspace appearance.</p>
      </div>
    </div>
    <div class="settings-grid">
      <section class="panel admin-card">
        <div class="card-head"><div><h2>Profile</h2><p class="muted">Your account details.</p></div></div>
        <dl class="details-list">
          <div><dt>Name</dt><dd>${escapeHtml(user.name || '—')}</dd></div>
          <div><dt>Email</dt><dd>${escapeHtml(user.email || '—')}</dd></div>
          <div><dt>Role</dt><dd><span class="badge ${user.role === 'admin' ? 'badge-warn' : ''}">${escapeHtml(user.role || 'member')}</span>${user.isPlatformAdmin ? ' <span class="badge">Platform admin</span>' : ''}</dd></div>
          <div><dt>Workspace</dt><dd>${escapeHtml(state.tenant?.name || '—')}</dd></div>
        </dl>
      </section>
      <section class="panel admin-card">
        <div class="card-head"><div><h2>Change password</h2><p class="muted">Use at least 8 characters for the new password.</p></div></div>
        <div id="password-alert"></div>
        <form id="password-form" class="form-stack">
          <label class="field"><span>Current password</span><input name="currentPassword" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>New password</span><input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
          <label class="field"><span>Confirm new password</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label>
          <div class="form-actions"><button type="submit" class="btn btn-primary">Update password</button></div>
        </form>
      </section>
      <section class="panel admin-card settings-wide">
        <div class="card-head"><div><h2>Theme</h2><p class="muted">Tailor colours, typography and layout to your liking.</p></div><span class="stat-icon">${icons.settings}</span></div>
        <div id="theme-alert"></div>
        <div id="theme-form-slot">${themeFormHtml(theme)}</div>
      </section>
    </div>`;

  const slot = container.querySelector('#theme-form-slot');
  bindThemeForm(slot, container);

  const passwordForm = container.querySelector('#password-form');
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const alertBox = container.querySelector('#password-alert');
    const submit = passwordForm.querySelector('[type="submit"]');
    alertBox.innerHTML = '';
    const body = Object.fromEntries(new FormData(passwordForm));
    if (body.newPassword !== body.confirmPassword) {
      alertBox.innerHTML = '<div class="alert alert-error" role="alert">New passwords do not match.</div>';
      return;
    }
    delete body.confirmPassword;
    submit.disabled = true;
    try {
      await api('/api/auth/change-password', { method: 'POST', body });
      passwordForm.reset();
      alertBox.innerHTML = '<div class="alert alert-success">Password updated successfully.</div>';
      toast('Password changed', 'success');
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err.message)}</div>`;
    } finally { submit.disabled = false; }
  });
}

// Rebind after the form is replaced with canonical values following a save.
function bindThemeForm(slot, container) {
  const form = slot.querySelector('#theme-form');
  const collect = () => ({
    mode: form.elements.mode.value,
    accent: form.elements.accent.value,
    font: form.elements.font.value,
    density: form.elements.density.value,
    sidebar: form.elements.sidebar.value,
    customCss: form.elements.customCss.value,
  });
  const preview = () => { state.previewTheme = collect(); applyTheme(); };
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const alertBox = container.querySelector('#theme-alert');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const res = await api('/api/me/theme', { method: 'PUT', body: { theme: collect() } });
      state.me = res.user || state.me;
      state.previewTheme = null;
      applyTheme();
      toast('Theme saved', 'success');
      slot.innerHTML = themeFormHtml(getTheme());
      bindThemeForm(slot, container);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err.message)}</div>`;
      submit.disabled = false;
    }
  });
  slot.querySelector('[data-action="reset-theme"]').addEventListener('click', () => {
    state.previewTheme = null;
    applyTheme();
    slot.innerHTML = themeFormHtml(getTheme());
    bindThemeForm(slot, container);
  });
}
