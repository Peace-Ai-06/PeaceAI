// Admin view: providers, knowledge bases, agents, users, branding and audit.
import { api, escapeHtml } from './api.js';
import { state } from './store.js';
import { icons, formatDate, formatBytes, stateBox, errorBox, toast, updateBranding } from './ui.js';

const TOOL_IDS = ['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'run_command'];
export const ADMIN_NAV = [
  { id: 'overview', label: 'Overview', icon: icons.admin },
  { id: 'providers', label: 'Providers', icon: icons.spark },
  { id: 'catalog', label: 'Model catalog', icon: icons.refresh },
  { id: 'knowledge', label: 'Knowledge bases', icon: icons.file },
  { id: 'agents', label: 'Agents', icon: icons.chat },
  { id: 'guest', label: 'Guest access', icon: icons.check },
  { id: 'users', label: 'Users', icon: icons.check },
  { id: 'usage', label: 'Usage & limits', icon: icons.chart },
  { id: 'feedback', label: 'Feedback', icon: icons.feedback },
  { id: 'keys', label: 'API keys', icon: icons.key },
  { id: 'workflows', label: 'Workflows', icon: icons.workflow },
  { id: 'shares', label: 'Shares', icon: icons.share },
  { id: 'branding', label: 'Branding', icon: icons.settings },
  { id: 'audit', label: 'Audit', icon: icons.file },
  { id: 'platform', label: 'Platform', icon: icons.globe, platformOnly: true },
];

const visibleNav = () => ADMIN_NAV.filter((item) => !item.platformOnly || state.me?.isPlatformAdmin);
const TABS = () => visibleNav().map(({ id, label }) => [id, label]);

const isCurrent = (container) => container?.isConnected && state.route === 'admin';
const input = (name, type = 'text', value = '', extra = '') =>
  `<input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra}>`;
const field = (label, control, hint = '') => `<label class="field"><span>${escapeHtml(label)}</span>${control}${hint ? `<small class="muted">${escapeHtml(hint)}</small>` : ''}</label>`;
const card = (title, description, body, actions = '') => `<section class="panel admin-card">
  <div class="card-head"><div><h2>${escapeHtml(title)}</h2>${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}</div>${actions}</div>${body}</section>`;
const table = (headers, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="table-empty">Nothing to show yet.</td></tr>`}</tbody></table></div>`;
const setField = (form, name, value) => {
  const el = form.elements[name];
  if (!el || value === undefined || value === null) return;
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = value;
};

export async function renderAdmin(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1>Admin</h1><p class="muted">Configure this workspace and its AI capabilities.</p></div>
      <span class="badge badge-ok">${escapeHtml(state.tenant?.name || 'Workspace')}</span>
    </div>
    <div class="tabs" role="tablist" aria-label="Admin sections">
      ${TABS().map(([id, label]) => `<button type="button" role="tab" class="tab ${state.adminTab === id ? 'active' : ''}" data-tab="${id}" aria-selected="${state.adminTab === id}">${escapeHtml(label)}</button>`).join('')}
    </div>
    <div id="admin-content">${stateBox('loading', 'Loading admin section')}</div>`;

  container.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.adminTab === button.dataset.tab) return;
      state.adminTab = button.dataset.tab;
      history.replaceState(null, '', `#/app/admin/${state.adminTab}`);
      renderAdmin(container);
    });
  });
  await loadTab(container, state.adminTab);
}

async function loadTab(container, tab) {
  const host = container.querySelector('#admin-content');
  if (!host) return;
  try {
    if (tab === 'overview') await overviewTab(host, container);
    else if (tab === 'providers') await providersTab(host, container);
    else if (tab === 'catalog') await catalogTab(host, container);
    else if (tab === 'knowledge') await knowledgeTab(host, container);
    else if (tab === 'agents') await agentsTab(host, container);
    else if (tab === 'guest') await guestTab(host, container);
    else if (tab === 'users') await usersTab(host, container);
    else if (tab === 'usage') await usageTab(host, container);
    else if (tab === 'feedback') await feedbackTab(host, container);
    else if (tab === 'keys') await keysTab(host, container);
    else if (tab === 'workflows') await workflowsTab(host, container);
    else if (tab === 'shares') await sharesTab(host, container);
    else if (tab === 'branding') await brandingTab(host, container);
    else if (tab === 'platform') await platformTab(host, container);
    else await auditTab(host, container);
  } catch (err) {
    if (isCurrent(container)) host.innerHTML = errorBox(err, 'retry-admin');
  }
  host.querySelector('[data-action="retry-admin"]')?.addEventListener('click', () => loadTab(container, tab));
}

// --- Overview ---------------------------------------------------------------
async function overviewTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading overview');
  const res = await api('/api/admin/overview');
  if (!isCurrent(container)) return;
  const counts = res.counts || {};
  const tiles = [
    ['Users', counts.users, icons.check], ['Agents', counts.agents, icons.spark],
    ['Knowledge bases', counts.knowledgeBases, icons.file], ['Documents', counts.documents, icons.file],
    ['Conversations', counts.conversations, icons.chat],
  ];
  host.innerHTML = `<div class="stat-grid">${tiles.map(([label, value, icon]) => `
    <div class="stat-card card"><div class="stat-icon">${icon}</div><div class="stat-value">${escapeHtml(value ?? 0)}</div><div class="muted">${escapeHtml(label)}</div></div>`).join('')}</div>
    ${card('Workspace', 'Identity and branding', `<dl class="details-list">
      <div><dt>Name</dt><dd>${escapeHtml(res.tenant?.name || state.tenant?.name || '')}</dd></div>
      <div><dt>Slug</dt><dd>${escapeHtml(res.tenant?.slug || '')}</dd></div>
      <div><dt>App name</dt><dd>${escapeHtml(res.tenant?.branding?.appName || '')}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(formatDate(res.tenant?.createdAt))}</dd></div>
    </dl>`)}`;
}

// --- Providers --------------------------------------------------------------
async function providersTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading providers');
  const res = await api('/api/admin/providers');
  if (!isCurrent(container)) return;
  const providers = res.providers || [];
  host.innerHTML = `
    <div id="provider-alert"></div>
    ${card('Model providers', 'Connections used by your agents. Saved keys stay encrypted on the server and are only decrypted for model fetches or an explicit admin reveal.', table(
      ['Name', 'Kind', 'Base URL', 'API key', 'Enabled', 'Actions'],
      providers.map((p) => `<tr>
        <td><strong>${escapeHtml(p.name)}</strong>${p.isBuiltIn ? ' <span class="badge">Built-in</span>' : ''}</td><td>${escapeHtml(p.kind)}</td>
        <td class="muted mono">${escapeHtml(p.baseUrl || '—')}</td>
        <td><span class="badge ${p.hasApiKey ? 'badge-ok' : 'badge-warn'}">${p.hasApiKey ? 'Set' : 'None'}</span></td>
        <td><span class="badge ${p.enabled ? 'badge-ok' : ''}">${p.enabled ? 'Enabled' : 'Disabled'}</span></td>
        <td class="actions-cell">
          <button type="button" class="btn btn-sm" data-action="test-provider" data-id="${escapeHtml(p.id)}">${icons.test} Test</button>
          ${p.hasApiKey ? `<button type="button" class="btn btn-sm" data-action="reveal-key" data-id="${escapeHtml(p.id)}">${icons.key} Read key</button>` : ''}
          <button type="button" class="btn btn-sm" data-action="edit-provider" data-id="${escapeHtml(p.id)}">${icons.edit} Edit</button>
          ${p.isBuiltIn ? '' : `<button type="button" class="btn btn-sm btn-danger" data-action="delete-provider" data-id="${escapeHtml(p.id)}">${icons.trash}</button>`}
        </td></tr>`)),
      `<button type="button" class="btn btn-sm btn-primary" data-action="show-provider-form">${icons.plus} Add provider</button>`)}
    <div id="provider-form-card" hidden>${card('Provider details', 'API keys are encrypted at rest. Leave blank to keep an existing key.', `
      <form id="provider-form" class="form-grid">
        ${field('Name', input('name', 'text', '', 'required'))}
        ${field('Kind', `<select name="kind" class="select"><option value="local">PeaceAi Local (built-in, offline)</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="ollama">Ollama</option></select>`)}
        <div data-provider-connection>
          ${field('Base URL', input('baseUrl', 'url', '', 'placeholder="https://api.openai.com/v1"'))}
          ${field('API key', input('apiKey', 'password', '', 'autocomplete="off" placeholder="Leave blank to keep existing"'))}
        </div>
        <label class="check-line"><input type="checkbox" name="enabled" checked> Enabled</label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save provider</button><button type="button" class="btn" data-action="hide-provider-form">Cancel</button></div>
      </form>`)}</div>`;

  const formCard = host.querySelector('#provider-form-card');
  const form = host.querySelector('#provider-form');
  const connection = host.querySelector('[data-provider-connection]');
  const syncConnectionFields = () => {
    connection.hidden = form.elements.kind.value === 'local';
  };
  syncConnectionFields();
  form.elements.kind.addEventListener('change', syncConnectionFields);
  host.querySelector('[data-action="show-provider-form"]').addEventListener('click', () => {
    form.reset(); form.removeAttribute('data-edit-id'); formCard.hidden = false;
    form.elements.enabled.checked = true;
    syncConnectionFields();
  });
  host.querySelector('[data-action="hide-provider-form"]').addEventListener('click', () => { formCard.hidden = true; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const editId = form.dataset.editId;
    const body = Object.fromEntries(new FormData(form));
    body.enabled = form.elements.enabled.checked;
    if (!body.apiKey) delete body.apiKey;
    if (!body.baseUrl) body.baseUrl = '';
    try {
      await api(editId ? `/api/admin/providers/${encodeURIComponent(editId)}` : '/api/admin/providers', { method: editId ? 'PUT' : 'POST', body });
      toast(editId ? 'Provider updated' : 'Provider created', 'success');
      providersTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  });

  host.querySelectorAll('[data-action]').forEach((button) => {
    const { action, id } = button.dataset;
    if (action === 'edit-provider') {
      button.addEventListener('click', () => {
        const p = providers.find((item) => item.id === id);
        if (!p) return;
        form.reset(); form.dataset.editId = id; formCard.hidden = false;
        form.elements.name.value = p.name;
        form.elements.kind.value = p.kind;
        form.elements.baseUrl.value = p.baseUrl || '';
        form.elements.apiKey.value = '';
        form.elements.enabled.checked = Boolean(p.enabled);
        syncConnectionFields();
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } else if (action === 'test-provider') {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const res = await api(`/api/admin/providers/${encodeURIComponent(id)}/test`, { method: 'POST' });
          host.querySelector('#provider-alert').innerHTML = `<div class="alert alert-success">${res.ok === false ? 'Connection failed' : 'Connection successful'}. Models: ${escapeHtml((res.models || []).join(', ') || 'none reported')}</div>`;
        } catch (err) {
          host.querySelector('#provider-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        } finally { button.disabled = false; }
      });
    } else if (action === 'reveal-key') {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const res = await api(`/api/admin/providers/${encodeURIComponent(id)}/key`);
          const alertBox = host.querySelector('#provider-alert');
          alertBox.innerHTML = `<div class="alert alert-info">
            <div><strong>API key revealed</strong>
              <p class="mono small">${escapeHtml(res.apiKey || '(no key stored)')}</p>
              <small class="muted">This reveal was recorded in the audit log.</small>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-sm" data-action="copy-key">${icons.file} Copy</button>
              <button type="button" class="btn btn-sm" data-action="hide-key">${icons.close} Hide</button>
            </div>
          </div>`;
          alertBox.querySelector('[data-action="copy-key"]')?.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(res.apiKey || ''); toast('API key copied', 'success'); }
            catch { toast('Clipboard unavailable — select the key manually.', 'error'); }
          });
          alertBox.querySelector('[data-action="hide-key"]')?.addEventListener('click', () => { alertBox.innerHTML = ''; });
        } catch (err) {
          host.querySelector('#provider-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        } finally { button.disabled = false; }
      });
    } else if (action === 'delete-provider') {
      button.addEventListener('click', async () => {
        if (!confirm('Delete this provider? Agents using it may stop working.')) return;
        try { await api(`/api/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Provider deleted', 'success'); providersTab(host, container); }
        catch (err) { toast(err.message, 'error'); }
      });
    }
  });
}

// --- Knowledge bases --------------------------------------------------------
async function knowledgeTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading knowledge bases');
  const res = await api('/api/admin/knowledge-bases');
  if (!isCurrent(container)) return;
  const bases = res.knowledgeBases || [];
  if (state.selectedKbId && !bases.some((kb) => kb.id === state.selectedKbId)) state.selectedKbId = null;
  host.innerHTML = `
    <div class="admin-grid">
      ${card('Knowledge bases', 'Collections of documents available to agents.', `
        <div class="stack-list">${bases.length ? bases.map((kb) => `
          <div class="list-row ${kb.id === state.selectedKbId ? 'selected' : ''}">
            <div class="row-main"><strong>${escapeHtml(kb.name)}</strong><p class="muted small">${escapeHtml(kb.description || 'No description')}</p>
              <span class="muted small">${escapeHtml(kb.documentCount ?? 0)} documents · ${escapeHtml(kb.chunkCount ?? 0)} chunks</span></div>
            <div class="row-actions">
              <button type="button" class="btn btn-sm" data-action="view-kb" data-id="${escapeHtml(kb.id)}">Documents</button>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete-kb" data-id="${escapeHtml(kb.id)}">${icons.trash}</button>
            </div>
          </div>`).join('') : stateBox('empty', 'No knowledge bases', 'Create one to upload documents.')}</div>
        <form id="kb-form" class="form-grid form-inline">
          ${field('Name', input('name', 'text', '', 'required placeholder="Product docs"'))}
          ${field('Description', input('description', 'text', '', 'placeholder="What is in this collection?"'))}
          <button type="submit" class="btn btn-primary">${icons.plus} Create</button>
        </form>`)}
      ${card('Documents', state.selectedKbId ? 'Upload and manage files in this knowledge base.' : 'Select a knowledge base to see its documents.', `
        <div id="kb-docs">${state.selectedKbId ? stateBox('loading', 'Loading documents') : stateBox('empty', 'No knowledge base selected')}</div>`)}
    </div>`;

  const form = host.querySelector('#kb-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      await api('/api/admin/knowledge-bases', { method: 'POST', body });
      toast('Knowledge base created', 'success');
      knowledgeTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  });
  host.querySelectorAll('[data-action="view-kb"]').forEach((button) => button.addEventListener('click', () => {
    state.selectedKbId = button.dataset.id;
    knowledgeTab(host, container);
  }));
  host.querySelectorAll('[data-action="delete-kb"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this knowledge base and all of its documents?')) return;
    try {
      await api(`/api/admin/knowledge-bases/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      if (state.selectedKbId === button.dataset.id) state.selectedKbId = null;
      toast('Knowledge base deleted', 'success');
      knowledgeTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  }));
  if (state.selectedKbId) await loadDocuments(host, container, state.selectedKbId);
}

async function loadDocuments(host, container, kbId) {
  const slot = host.querySelector('#kb-docs');
  if (!slot || !isCurrent(container)) return;
  try {
    const res = await api(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents`);
    if (!isCurrent(container) || state.selectedKbId !== kbId) return;
    const docs = res.documents || [];
    slot.innerHTML = `
      <div class="doc-upload">
        <label class="btn btn-sm btn-primary file-btn">${icons.upload} Upload files<input type="file" id="kb-files" multiple hidden></label>
        <span class="muted small">PDF, DOCX, TXT and Markdown</span>
      </div>
      ${table(['Name', 'Type', 'Size', 'Chunks', 'Status', ''], docs.map((doc) => `<tr>
        <td>${escapeHtml(doc.name)}</td><td class="muted">${escapeHtml(doc.mimeType || '—')}</td>
        <td class="muted">${escapeHtml(formatBytes(doc.size))}</td><td>${escapeHtml(doc.chunkCount ?? 0)}</td>
        <td><span class="badge ${doc.status === 'ready' ? 'badge-ok' : 'badge-danger'}">${escapeHtml(doc.status || 'unknown')}</span>
          ${doc.error ? `<span class="muted small">${escapeHtml(doc.error)}</span>` : ''}</td>
        <td><button type="button" class="btn btn-sm btn-danger" data-action="delete-doc" data-kb="${escapeHtml(kbId)}" data-id="${escapeHtml(doc.id)}" aria-label="Delete document">${icons.trash}</button></td>
      </tr>`))}`;
    slot.querySelector('#kb-files').addEventListener('change', async (event) => {
      const files = [...event.target.files];
      event.target.value = '';
      if (!files.length) return;
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      slot.querySelector('.doc-upload').insertAdjacentHTML('afterend', '<div class="alert alert-info" id="upload-status">Uploading…</div>');
      try {
        await api(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents`, { method: 'POST', form });
        toast(`${files.length} file${files.length === 1 ? '' : 's'} indexed`, 'success');
        knowledgeTab(host, container);
      } catch (err) {
        slot.querySelector('#upload-status')?.remove();
        toast(err.message, 'error');
      }
    });
    slot.querySelectorAll('[data-action="delete-doc"]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm(`Delete document "${button.closest('tr')?.querySelector('td')?.textContent || ''}"?`)) return;
      try {
        await api(`/api/admin/knowledge-bases/${encodeURIComponent(button.dataset.kb)}/documents/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast('Document deleted', 'success');
        knowledgeTab(host, container);
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) {
    if (isCurrent(container)) slot.innerHTML = errorBox(err);
  }
}

// --- Agents -----------------------------------------------------------------
async function agentsTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading agents');
  const [agentsRes, providersRes, kbRes, templatesRes] = await Promise.all([
    api('/api/admin/agents'), api('/api/admin/providers'),
    api('/api/admin/knowledge-bases'), api('/api/templates').catch(() => ({ templates: [] })),
  ]);
  if (!isCurrent(container)) return;
  const agents = agentsRes.agents || [];
  const providers = providersRes.providers || [];
  const bases = kbRes.knowledgeBases || [];
  const templates = templatesRes.templates || [];
  const providerOptions = `<option value="">— Select —</option>${providers.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}`;

  host.innerHTML = `
    <div id="agent-alert"></div>
    ${card('Agents', 'Configure the assistants your users can talk to.', table(
      ['Agent', 'Provider', 'Model', 'Visibility', 'Tools', 'Actions'],
      agents.map((agent) => `<tr>
        <td><span class="agent-icon">${escapeHtml(agent.icon || 'A')}</span><strong>${escapeHtml(agent.name)}</strong><div class="muted small">${escapeHtml(agent.description || '')}</div></td>
        <td>${escapeHtml(providers.find((p) => p.id === agent.providerId)?.name || '—')}</td>
        <td class="mono">${escapeHtml(agent.model || '—')}</td>
        <td><span class="badge">${escapeHtml(agent.visibility || 'tenant')}</span></td>
        <td>${escapeHtml((agent.tools?.enabled || []).length)}${agent.tools?.approvalRequired ? ' · approval' : ''}</td>
        <td class="actions-cell"><button type="button" class="btn btn-sm" data-action="edit-agent" data-id="${escapeHtml(agent.id)}">${icons.edit} Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete-agent" data-id="${escapeHtml(agent.id)}">${icons.trash}</button></td>
      </tr>`)),
      `<button type="button" class="btn btn-sm btn-primary" data-action="show-agent-form">${icons.plus} New agent</button>`)}
    <div id="agent-form-card" hidden>${card('Agent details', 'Persona, model, knowledge and tools.', `
      <form id="agent-form" class="form-stack">
        ${field('Create from template', `<select name="template" id="agent-template" class="select"><option value="">— Start from scratch —</option>${templates.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')}</select>`, 'Optional: pre-fill the fields below.')}
        <div class="form-grid">
          ${field('Name', input('name', 'text', '', 'required'))}
          ${field('Icon (emoji or letter)', input('icon', 'text', '🤖', 'maxlength="8"'))}
          ${field('Accent colour', input('accent', 'color', '#8b7bff'))}
          ${field('Visibility', `<select name="visibility" class="select"><option value="tenant">Tenant</option><option value="link">Link</option></select>`)}
        </div>
        ${field('Description', input('description', 'text', ''))}
        ${field('Persona', `<textarea name="persona" rows="4" placeholder="Describe how this agent should behave…"></textarea>`)}
        <div class="form-grid">
          ${field('Provider', `<select name="providerId" id="agent-provider" class="select">${providerOptions}</select>`)}
          ${field('Model', `${input('model', 'text', '', 'list="agent-model-options" placeholder="gpt-4o-mini"')}<datalist id="agent-model-options"></datalist>`, 'Use Load models to discover available names.')}
          <div class="field"><span>&nbsp;</span><button type="button" class="btn btn-sm" data-action="load-models">${icons.test} Load models</button></div>
          ${field('Embedding provider', `<select name="embeddingProviderId" class="select"><option value="">— None —</option>${providers.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}</select>`)}
          ${field('Embedding model', input('embeddingModel', 'text', '', 'placeholder="text-embedding-3-small"'))}
          ${field('Temperature', input('temperature', 'number', '0.7', 'min="0" max="2" step="0.1"'))}
          ${field('Max tokens', input('maxTokens', 'number', '2048', 'min="1" step="1"'))}
        </div>
        <fieldset class="check-group"><legend>Knowledge bases</legend><div class="check-grid">
          ${bases.length ? bases.map((kb) => `<label class="check-line"><input type="checkbox" name="knowledgeBaseIds" value="${escapeHtml(kb.id)}"> ${escapeHtml(kb.name)}</label>`).join('') : '<span class="muted">No knowledge bases configured.</span>'}
        </div></fieldset>
        <fieldset class="check-group"><legend>Tools</legend><div class="check-grid">
          ${TOOL_IDS.map((tool) => `<label class="check-line"><input type="checkbox" name="toolsEnabled" value="${tool}"> <code>${tool}</code></label>`).join('')}
        </div></fieldset>
        <label class="check-line"><input type="checkbox" name="approvalRequired"> Require approval for dangerous tools</label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save agent</button><button type="button" class="btn" data-action="hide-agent-form">Cancel</button></div>
      </form>`)}</div>`;

  const formCard = host.querySelector('#agent-form-card');
  const form = host.querySelector('#agent-form');
  host.querySelector('[data-action="show-agent-form"]').addEventListener('click', () => {
    form.reset(); form.removeAttribute('data-edit-id'); formCard.hidden = false;
    form.elements.temperature.value = '0.7'; form.elements.maxTokens.value = '2048';
  });
  host.querySelector('[data-action="hide-agent-form"]').addEventListener('click', () => { formCard.hidden = true; });

  const fillForm = (agent) => {
    form.reset(); formCard.hidden = false;
    const values = {
      name: agent.name || '', description: agent.description || '', icon: agent.icon || '🤖',
      accent: /^#[0-9a-f]{6}$/i.test(agent.accent || '') ? agent.accent : '#8b7bff',
      persona: agent.persona || '', providerId: agent.providerId || '', model: agent.model || '',
      embeddingProviderId: agent.embeddingProviderId || '', embeddingModel: agent.embeddingModel || '',
      visibility: agent.visibility || 'tenant', temperature: agent.generation?.temperature ?? 0.7,
      maxTokens: agent.generation?.maxTokens ?? 2048,
      approvalRequired: Boolean(agent.tools?.approvalRequired),
    };
    Object.entries(values).forEach(([name, value]) => setField(form, name, value));
    const kbIds = new Set(agent.knowledgeBaseIds || []);
    const toolIds = new Set(agent.tools?.enabled || []);
    [...form.elements.knowledgeBaseIds || []].forEach((el) => { el.checked = kbIds.has(el.value); });
    [...form.elements.toolsEnabled || []].forEach((el) => { el.checked = toolIds.has(el.value); });
  };

  form.querySelector('#agent-template').addEventListener('change', (event) => {
    const template = templates.find((t) => t.id === event.target.value);
    if (template) fillForm(template.agent || {});
    form.querySelector('#agent-template').value = template?.id || '';
  });
  host.querySelector('[data-action="load-models"]').addEventListener('click', async () => {
    const id = form.elements.providerId.value;
    if (!id) { toast('Choose a provider first.', 'error'); return; }
    try {
      const res = await api(`/api/admin/providers/${encodeURIComponent(id)}/test`, { method: 'POST' });
      const list = host.querySelector('#agent-model-options');
      list.innerHTML = (res.models || []).map((model) => `<option value="${escapeHtml(model)}"></option>`).join('');
      toast(res.models?.length ? `${res.models.length} models available` : 'No models reported', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const editId = form.dataset.editId;
    const checked = (name) => [...(form.elements[name]?.length ? form.elements[name] : [form.elements[name]])]
      .filter((el) => el?.checked).map((el) => el.value);
    const body = {
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim(),
      icon: form.elements.icon.value,
      accent: form.elements.accent.value,
      persona: form.elements.persona.value,
      providerId: form.elements.providerId.value || null,
      model: form.elements.model.value.trim(),
      embeddingProviderId: form.elements.embeddingProviderId.value || null,
      embeddingModel: form.elements.embeddingModel.value.trim(),
      knowledgeBaseIds: checked('knowledgeBaseIds'),
      generation: {
        temperature: Number(form.elements.temperature.value) || 0,
        maxTokens: Number(form.elements.maxTokens.value) || 2048,
      },
      tools: {
        enabled: checked('toolsEnabled'),
        approvalRequired: form.elements.approvalRequired.checked,
      },
      visibility: form.elements.visibility.value,
    };
    try {
      await api(editId ? `/api/admin/agents/${encodeURIComponent(editId)}` : '/api/admin/agents', { method: editId ? 'PUT' : 'POST', body });
      toast(editId ? 'Agent updated' : 'Agent created', 'success');
      agentsTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  });

  host.querySelectorAll('[data-action="edit-agent"]').forEach((button) => button.addEventListener('click', () => {
    const agent = agents.find((a) => a.id === button.dataset.id);
    if (!agent) return;
    form.dataset.editId = agent.id;
    fillForm(agent);
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  host.querySelectorAll('[data-action="delete-agent"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this agent? Its conversations will remain but may no longer work.')) return;
    try {
      await api(`/api/admin/agents/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      toast('Agent deleted', 'success');
      agentsTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  }));
}

// --- Guest access ------------------------------------------------------------
async function guestTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading guest access');
  const [res, agentsRes] = await Promise.all([
    api('/api/admin/guest-access'),
    api('/api/admin/agents'),
  ]);
  if (!isCurrent(container)) return;
  const config = res.guestAccess || {};
  const agents = agentsRes.agents || [];
  host.innerHTML = card(
    'Guest access',
    'Let people chat immediately without an account, then ask them to sign in after the limit you choose.',
    `<form id="guest-form" class="form-grid">
      <label class="check-line"><input type="checkbox" name="enabled" ${config.enabled !== false ? 'checked' : ''}> Allow guest chat</label>
      ${field('Count limit by', `<select name="basis" class="select">
        <option value="messages" ${config.basis === 'messages' ? 'selected' : ''}>Messages sent</option>
        <option value="sessions" ${config.basis === 'sessions' ? 'selected' : ''}>New conversations</option>
        <option value="minutes" ${config.basis === 'minutes' ? 'selected' : ''}>Minutes since first message</option>
      </select>`)}
      ${field('Limit', input('limit', 'number', config.limit ?? 10, 'min="1" max="10000" step="1"'), 'e.g. 10 messages or 3 conversations')}
      ${field('Guest assistant', `<select name="agentId" class="select"><option value="">Default assistant</option>${agents.map((a) => `<option value="${escapeHtml(a.id)}" ${a.id === config.agentId ? 'selected' : ''}>${escapeHtml(a.icon || '')} ${escapeHtml(a.name)}</option>`).join('')}</select>`, 'Guests only see this agent')}
      <div class="form-actions"><button type="submit" class="btn btn-primary">Save guest settings</button></div>
    </form>
    <div id="guest-alert"></div>`,
  );
  host.querySelector('#guest-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      enabled: form.elements.enabled.checked,
      basis: form.elements.basis.value,
      limit: Number(form.elements.limit.value),
      agentId: form.elements.agentId.value || null,
    };
    try {
      const saved = await api('/api/admin/guest-access', { method: 'PUT', body });
      host.querySelector('#guest-alert').innerHTML = `<div class="alert alert-success">Guest access saved. Guests can now use up to ${escapeHtml(saved.guestAccess.limit)} ${escapeHtml(saved.guestAccess.basis)} before signing in.</div>`;
    } catch (err) {
      host.querySelector('#guest-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

// --- Users ------------------------------------------------------------------
async function usersTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading users');
  const res = await api('/api/admin/users');
  if (!isCurrent(container)) return;
  const users = res.users || [];
  host.innerHTML = `
    ${card('Users', 'Members of this workspace.', table(['Name', 'Email', 'Role', 'Status', 'Actions'], users.map((user) => `<tr>
      <td><strong>${escapeHtml(user.name)}</strong></td><td class="muted">${escapeHtml(user.email)}</td>
      <td><span class="badge ${user.role === 'admin' ? 'badge-warn' : ''}">${escapeHtml(user.role)}</span></td>
      <td><span class="badge ${user.active === false ? 'badge-danger' : 'badge-ok'}">${user.active === false ? 'Inactive' : 'Active'}</span>
        ${user.isPlatformAdmin ? '<span class="badge">Platform admin</span>' : ''}</td>
      <td class="actions-cell"><button type="button" class="btn btn-sm" data-action="edit-user" data-id="${escapeHtml(user.id)}">${icons.edit} Edit</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete-user" data-id="${escapeHtml(user.id)}">${icons.trash}</button></td>
    </tr>`)))}
    <div class="admin-grid">
      ${card('Add user', 'Invite a member by creating their account.', `<form id="user-form" class="form-grid">
        ${field('Name', input('name', 'text', '', 'required'))}
        ${field('Email', input('email', 'email', '', 'required'))}
        ${field('Password', input('password', 'password', '', 'required minlength="8"'))}
        ${field('Role', `<select name="role" class="select"><option value="member">Member</option><option value="admin">Admin</option></select>`)}
        <div class="form-actions"><button type="submit" class="btn btn-primary">${icons.plus} Create user</button></div>
      </form>`)}
      <div id="user-edit-card" hidden>${card('Edit user', 'Update profile, role and access.', `<form id="user-edit-form" class="form-stack">
        ${field('Name', input('name', 'text', '', 'required'))}
        ${field('Role', `<select name="role" class="select"><option value="member">Member</option><option value="admin">Admin</option></select>`)}
        <label class="check-line"><input type="checkbox" name="active" checked> Active account</label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save changes</button><button type="button" class="btn" data-action="cancel-user-edit">Cancel</button></div>
      </form>`)}</div>
    </div>`;

  const form = host.querySelector('#user-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/users', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset(); toast('User created', 'success'); usersTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  });
  const editForm = host.querySelector('#user-edit-form');
  const editCard = host.querySelector('#user-edit-card');
  host.querySelector('[data-action="cancel-user-edit"]').addEventListener('click', () => { editCard.hidden = true; });
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = editForm.dataset.editId;
    try {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: {
        name: editForm.elements.name.value,
        role: editForm.elements.role.value,
        active: editForm.elements.active.checked,
      } });
      editCard.hidden = true; toast('User updated', 'success'); usersTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  });
  host.querySelectorAll('[data-action="edit-user"]').forEach((button) => button.addEventListener('click', () => {
    const user = users.find((u) => u.id === button.dataset.id);
    if (!user) return;
    editForm.dataset.editId = user.id;
    editForm.elements.name.value = user.name;
    editForm.elements.role.value = user.role;
    editForm.elements.active.checked = user.active !== false;
    editCard.hidden = false;
  }));
  host.querySelectorAll('[data-action="delete-user"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      toast('User deleted', 'success'); usersTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  }));
}

// --- Branding ---------------------------------------------------------------
async function brandingTab(host, container) {
  const branding = state.tenant?.branding || {};
  host.innerHTML = card('Branding', 'This appears across the workspace for every member.', `<form id="branding-form" class="form-stack">
    <div class="form-grid">
      ${field('App name', input('appName', 'text', branding.appName || ''))}
      ${field('Logo text', input('logoText', 'text', branding.logoText || '', 'maxlength="3"'))}
      ${field('Accent colour', input('accent', 'color', branding.accent || '#8b7bff'))}
    </div>
    ${field('Tagline', input('tagline', 'text', branding.tagline || ''))}
    <div class="form-actions"><button type="submit" class="btn btn-primary">Save branding</button></div>
  </form>`);
  host.querySelector('#branding-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const next = Object.fromEntries(new FormData(form));
    try {
      const res = await api('/api/admin/branding', { method: 'PUT', body: { branding: next } });
      state.tenant = res.tenant || state.tenant;
      updateBranding();
      toast('Branding updated', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// --- Audit ------------------------------------------------------------------
async function auditTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading audit log');
  const res = await api('/api/admin/audit');
  if (!isCurrent(container)) return;
  const entries = res.entries || [];
  host.innerHTML = card('Audit log', 'Recent changes in this workspace.', table(['Time', 'Actor', 'Action', 'Details'], entries.map((entry) => {
    const actor = entry.actor?.name || entry.actorName || entry.user?.email || entry.userEmail || entry.email || entry.actor || '—';
    const action = entry.action || entry.type || entry.event || '—';
    const details = entry.detail ?? entry.details ?? entry.target ?? entry.resource ?? '';
    return `<tr><td class="muted">${escapeHtml(formatDate(entry.createdAt || entry.ts || entry.timestamp || entry.at))}</td>
      <td>${escapeHtml(typeof actor === 'object' ? JSON.stringify(actor) : actor)}</td>
      <td><code>${escapeHtml(action)}</code></td>
      <td class="muted small">${escapeHtml(typeof details === 'object' ? JSON.stringify(details) : details)}</td></tr>`;
  })));
}

// --- Model catalog -----------------------------------------------------------
async function catalogTab(host, container) {
  host.innerHTML = stateBox('loading', 'Fetching models from your providers');
  const res = await api('/api/admin/models/catalog');
  if (!isCurrent(container)) return;
  const catalog = res.catalog || [];
  const rows = [];
  for (const entry of catalog) {
    if (!entry.models.length) {
      rows.push(`<tr><td><strong>${escapeHtml(entry.providerName)}</strong></td><td>${escapeHtml(entry.kind)}</td>
        <td class="muted">—</td><td><span class="badge badge-warn">${escapeHtml(entry.ok ? 'No models reported' : entry.error || 'Failed')}</span></td></tr>`);
      continue;
    }
    for (const model of entry.models) {
      rows.push(`<tr><td><strong>${escapeHtml(entry.providerName)}</strong></td><td>${escapeHtml(entry.kind)}</td>
        <td class="mono">${escapeHtml(model)}</td><td><span class="badge badge-ok">Available</span></td></tr>`);
    }
  }
  host.innerHTML = card(
    'Model catalog',
    `Fetched ${escapeHtml(formatDate(res.fetchedAt))} server-side using each provider's saved key. Keys are never sent to the browser.`,
    table(['Provider', 'Kind', 'Model / resource', 'Status'], rows),
    `<div class="form-actions"><button type="button" class="btn btn-sm" data-action="refresh-catalog">${icons.refresh} Refresh</button>
      <button type="button" class="btn btn-sm btn-primary" data-action="catalog-to-agents">${icons.chat} Configure agents</button></div>`,
  );
  host.querySelector('[data-action="refresh-catalog"]')?.addEventListener('click', () => catalogTab(host, container));
  host.querySelector('[data-action="catalog-to-agents"]')?.addEventListener('click', () => { location.hash = '#/app/admin/agents'; });
}

// --- Usage & limits ----------------------------------------------------------
async function usageTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading usage');
  const userId = state.usageFilter?.userId || '';
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const [usage, overview, users] = await Promise.all([
    api(`/api/admin/usage${query}`), api('/api/admin/overview'), api('/api/admin/users'),
  ]);
  if (!isCurrent(container)) return;
  const totals = usage.totals || {};
  const limits = overview.tenant?.limits || {};
  const count = (value) => Number(value || 0).toLocaleString();
  const cost = (value) => `$${Number(value || 0).toFixed(4)}`;
  const userOptions = `<option value="">All users</option>${(users.users || []).map((user) => `
    <option value="${escapeHtml(user.id)}" ${user.id === userId ? 'selected' : ''}>${escapeHtml(user.name)} — ${escapeHtml(user.email)}</option>`).join('')}`;
  const modelRows = Object.entries(usage.byModel || {}).sort((a, b) => b[1].totalTokens - a[1].totalTokens).map(([model, value]) => `<tr>
    <td class="mono">${escapeHtml(model)}</td><td>${escapeHtml(value.requests ?? 0)}</td>
    <td>${count(value.totalTokens)}</td><td>${cost(value.cost)}</td></tr>`);
  const dayRows = Object.entries(usage.byDay || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14).map(([day, value]) => `<tr>
    <td class="mono">${escapeHtml(day)}</td><td>${escapeHtml(value.requests ?? 0)}</td>
    <td>${count(value.totalTokens)}</td><td>${cost(value.cost)}</td></tr>`);
  host.innerHTML = `
    <div class="stat-grid">
      ${[
        ['Requests', count(totals.requests), icons.chat],
        ['Tokens', count(totals.totalTokens), icons.spark],
        ['Estimated cost', cost(totals.cost), icons.chart],
        ['Period start', String(usage.periodStart || '').slice(0, 10) || '—', icons.refresh],
      ].map(([label, value, icon]) => `
        <div class="stat-card card"><div class="stat-icon">${icon}</div><div class="stat-value">${escapeHtml(value)}</div><div class="muted">${escapeHtml(label)}</div></div>`).join('')}
    </div>
    ${card('Filter', 'Usage is measured from the start of the current billing period.', `<form id="usage-filter" class="form-grid form-inline">
      ${field('User', `<select name="userId" class="select">${userOptions}</select>`)}
      <div class="form-actions"><button type="submit" class="btn btn-sm btn-primary">Apply</button>
        <button type="button" class="btn btn-sm" data-action="clear-usage-filter">Reset</button></div>
    </form>`)}
    <div class="admin-grid">
      ${card('Monthly limits', 'Leave a field blank for no limit. Exceeding a limit returns HTTP 429 to users.', `<form id="limits-form" class="form-grid">
        ${field('Monthly tokens', input('monthlyTokens', 'number', limits.monthlyTokens ?? '', 'min="0" step="1000"'))}
        ${field('Monthly cost (USD)', input('monthlyCost', 'number', limits.monthlyCost ?? '', 'min="0" step="0.01"'))}
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save limits</button></div>
      </form>`)}
      ${card('Usage by model', 'Current billing period.', table(['Model', 'Requests', 'Tokens', 'Est. cost'], modelRows))}
    </div>
    ${card('Recent activity', 'Last 14 days with recorded usage.', table(['Day', 'Requests', 'Tokens', 'Est. cost'], dayRows))}`;
  host.querySelector('#usage-filter').addEventListener('submit', (event) => {
    event.preventDefault();
    state.usageFilter = { userId: event.currentTarget.elements.userId.value || undefined };
    usageTab(host, container);
  });
  host.querySelector('[data-action="clear-usage-filter"]').addEventListener('click', () => {
    state.usageFilter = {};
    usageTab(host, container);
  });
  host.querySelector('#limits-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const saved = await api('/api/admin/limits', { method: 'PUT', body: {
        monthlyTokens: form.elements.monthlyTokens.value === '' ? null : Number(form.elements.monthlyTokens.value),
        monthlyCost: form.elements.monthlyCost.value === '' ? null : Number(form.elements.monthlyCost.value),
      } });
      state.tenant = saved.tenant || state.tenant;
      toast('Limits saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// --- Feedback ----------------------------------------------------------------
async function feedbackTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading feedback');
  const [summary, res, agentsRes] = await Promise.all([
    api('/api/admin/feedback/summary'), api('/api/admin/feedback'), api('/api/admin/agents'),
  ]);
  if (!isCurrent(container)) return;
  const agentNames = new Map((agentsRes.agents || []).map((agent) => [agent.id, agent.name]));
  const rows = (res.feedback || []).map((item) => `<tr>
    <td class="muted">${escapeHtml(formatDate(item.ts))}</td>
    <td><span class="badge ${item.rating >= 4 ? 'badge-ok' : item.rating <= 2 ? 'badge-danger' : ''}">${escapeHtml(item.rating)} / 5</span></td>
    <td>${escapeHtml(agentNames.get(item.agentId) || item.agentId || '—')}</td>
    <td>${escapeHtml(item.comment || '—')}</td></tr>`);
  host.innerHTML = `
    <div class="stat-grid">
      ${[['Average rating', summary.average ?? 0, icons.chart], ['Positive', summary.positive ?? 0, icons.check], ['Negative', summary.negative ?? 0, icons.feedback], ['Total', summary.total ?? 0, icons.chat]].map(([label, value, icon]) => `
        <div class="stat-card card"><div class="stat-icon">${icon}</div><div class="stat-value">${escapeHtml(value)}</div><div class="muted">${escapeHtml(label)}</div></div>`).join('')}
    </div>
    ${card('Recent feedback', 'Ratings left by members on assistant replies.', table(['Time', 'Rating', 'Agent', 'Comment'], rows))}`;
}

// --- PeaceAi API keys --------------------------------------------------------
async function keysTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading API keys');
  const res = await api('/api/admin/api-keys');
  if (!isCurrent(container)) return;
  const scopes = res.scopes || [];
  const rows = (res.apiKeys || []).map((key) => `<tr>
    <td><strong>${escapeHtml(key.name)}</strong></td><td class="mono">${escapeHtml(key.prefix || '')}…${escapeHtml(key.last4 || '')}</td>
    <td>${(key.scopes || []).map((scope) => `<span class="badge">${escapeHtml(scope)}</span>`).join(' ')}</td>
    <td class="muted">${escapeHtml(formatDate(key.createdAt))}</td>
    <td><button type="button" class="btn btn-sm btn-danger" data-action="revoke-key" data-id="${escapeHtml(key.id)}">${icons.trash}</button></td></tr>`);
  host.innerHTML = `
    <div id="key-alert"></div>
    <div class="admin-grid">
      ${card('API keys', 'Tokens for programmatic chat, agent and MCP access.', table(['Name', 'Token', 'Scopes', 'Created', ''], rows))}
      ${card('Create key', 'The token is shown once — copy it immediately.', `<form id="api-key-form" class="form-stack">
        ${field('Name', input('name', 'text', '', 'required placeholder="CI / integration"'))}
        <fieldset class="check-group"><legend>Scopes</legend><div class="check-grid">
          ${scopes.map((scope) => `<label class="check-line"><input type="checkbox" name="scopes" value="${escapeHtml(scope)}" checked> ${escapeHtml(scope)}</label>`).join('')}
        </div></fieldset>
        <button type="submit" class="btn btn-primary">${icons.plus} Create API key</button>
      </form>`)}
    </div>`;
  host.querySelector('#api-key-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const selected = [...form.elements.scopes].filter((el) => el.checked).map((el) => el.value);
    try {
      const created = await api('/api/admin/api-keys', { method: 'POST', body: { name: form.elements.name.value, scopes: selected } });
      // Refresh the list first, then write the one-time token into the new DOM so it is not wiped.
      await keysTab(host, container);
      const alertBox = host.querySelector('#key-alert');
      if (alertBox) {
        alertBox.innerHTML = `<div class="alert alert-success"><div>
          <strong>New API key</strong><p class="mono small">${escapeHtml(created.token)}</p>
          <small class="muted">Copy this now — PeaceAi stores only a hash.</small></div>
          <button type="button" class="btn btn-sm" data-action="copy-token">${icons.file} Copy</button></div>`;
        alertBox.querySelector('[data-action="copy-token"]')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(created.token); toast('Token copied', 'success'); }
          catch { toast('Clipboard unavailable — select the token manually.', 'error'); }
        });
      }
      toast('API key created', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  host.querySelectorAll('[data-action="revoke-key"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Revoke this API key? Integrations using it will stop working.')) return;
    try { await api(`/api/admin/api-keys/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' }); toast('API key revoked', 'success'); keysTab(host, container); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

// --- Workflows ---------------------------------------------------------------
async function workflowsTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading workflows');
  const [res, agentsRes] = await Promise.all([api('/api/admin/workflows'), api('/api/admin/agents')]);
  if (!isCurrent(container)) return;
  const workflows = res.workflows || [];
  const agents = agentsRes.agents || [];
  const agentOptions = `<option value="">— Select agent —</option>${agents.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.icon || '')} ${escapeHtml(a.name)}</option>`).join('')}`;
  const stepRow = (index) => `<div class="form-grid">
    ${field(`Step ${index} agent`, `<select name="stepAgent${index}" class="select">${agentOptions}</select>`)}
    ${field('Instruction (optional)', input(`stepInstruction${index}`, 'text', '', 'placeholder="What should this agent do?"'))}
  </div>`;
  host.innerHTML = `
    <div id="workflow-result"></div>
    <div class="admin-grid">
      ${card('Workflows', 'Chain up to eight agents into one reusable run.', table(['Name', 'Steps', 'Status', 'Actions'], workflows.map((workflow) => `<tr>
        <td><strong>${escapeHtml(workflow.name)}</strong><div class="muted small">${escapeHtml(workflow.description || '')}</div></td>
        <td>${escapeHtml((workflow.steps || []).length)}</td>
        <td><span class="badge ${workflow.enabled === false ? '' : 'badge-ok'}">${workflow.enabled === false ? 'Disabled' : 'Enabled'}</span></td>
        <td class="actions-cell"><button type="button" class="btn btn-sm" data-action="test-workflow" data-id="${escapeHtml(workflow.id)}">${icons.test} Test</button>
          <button type="button" class="btn btn-sm" data-action="edit-workflow" data-id="${escapeHtml(workflow.id)}">${icons.edit} Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete-workflow" data-id="${escapeHtml(workflow.id)}">${icons.trash}</button></td></tr>`)))}
      ${card('Workflow details', 'Pick up to eight agents, in order.', `<form id="workflow-form" class="form-stack">
        ${field('Name', input('name', 'text', '', 'required'))}
        ${field('Description', input('description', 'text', ''))}
        ${[1, 2, 3, 4, 5, 6, 7, 8].map(stepRow).join('')}
        <label class="check-line"><input type="checkbox" name="enabled" checked> Enabled</label>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save workflow</button>
          <button type="button" class="btn" data-action="reset-workflow">Clear</button></div>
      </form>`)}
    </div>`;
  const form = host.querySelector('#workflow-form');
  const reset = () => { form.reset(); form.removeAttribute('data-edit-id'); form.elements.enabled.checked = true; };
  host.querySelector('[data-action="reset-workflow"]').addEventListener('click', reset);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const steps = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
      agentId: form.elements[`stepAgent${index}`].value,
      instruction: form.elements[`stepInstruction${index}`].value,
    })).filter((step) => step.agentId);
    if (!steps.length) { toast('Choose at least one agent step.', 'error'); return; }
    const editId = form.dataset.editId;
    const body = {
      name: form.elements.name.value,
      description: form.elements.description.value,
      steps,
      enabled: form.elements.enabled.checked,
    };
    try {
      await api(editId ? `/api/admin/workflows/${encodeURIComponent(editId)}` : '/api/admin/workflows', { method: editId ? 'PUT' : 'POST', body });
      toast(editId ? 'Workflow updated' : 'Workflow created', 'success');
      workflowsTab(host, container);
    } catch (err) { toast(err.message, 'error'); }
  });
  host.querySelectorAll('[data-action="edit-workflow"]').forEach((button) => button.addEventListener('click', () => {
    const workflow = workflows.find((item) => item.id === button.dataset.id);
    if (!workflow) return;
    form.dataset.editId = workflow.id;
    form.elements.name.value = workflow.name || '';
    form.elements.description.value = workflow.description || '';
    form.elements.enabled.checked = workflow.enabled !== false;
    (workflow.steps || []).slice(0, 8).forEach((step, index) => {
      form.elements[`stepAgent${index + 1}`].value = step.agentId || '';
      form.elements[`stepInstruction${index + 1}`].value = step.instruction || '';
    });
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  host.querySelectorAll('[data-action="delete-workflow"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this workflow?')) return;
    try { await api(`/api/admin/workflows/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' }); toast('Workflow deleted', 'success'); workflowsTab(host, container); }
    catch (err) { toast(err.message, 'error'); }
  }));
  host.querySelectorAll('[data-action="test-workflow"]').forEach((button) => button.addEventListener('click', async () => {
    const message = prompt('Test message for this workflow:');
    if (!message) return;
    const slot = host.querySelector('#workflow-result');
    slot.innerHTML = stateBox('loading', 'Running workflow');
    try {
      const result = await api(`/api/workflows/${encodeURIComponent(button.dataset.id)}/run`, { method: 'POST', body: { message } });
      slot.innerHTML = card('Test result', `${result.steps?.length || 0} step(s) completed`,
        (result.steps || []).map((step) => `<div class="alert alert-info"><strong>${escapeHtml(step.agentName)}</strong><div>${escapeHtml(step.output)}</div></div>`).join('')
        + (result.error ? `<div class="alert alert-error">${escapeHtml(result.error.message)}</div>` : ''));
    } catch (err) { slot.innerHTML = errorBox(err); }
  }));
}

// --- Share links -------------------------------------------------------------
async function sharesTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading share links');
  const res = await api('/api/admin/agents');
  if (!isCurrent(container)) return;
  const agents = res.agents || [];
  const rows = agents.map((agent) => {
    const share = agent.share || {};
    const active = Boolean(agent.shareToken) && share.enabled !== false;
    return `<tr>
    <td><span class="agent-icon">${escapeHtml(agent.icon || 'A')}</span><strong>${escapeHtml(agent.name)}</strong></td>
    <td>${active ? `<a class="mono small" href="/share/${encodeURIComponent(agent.shareToken)}" target="_blank" rel="noopener">${escapeHtml('/share/' + agent.shareToken)}</a>` : '<span class="muted">Not shared</span>'}</td>
    <td>${escapeHtml(share.limit ?? '—')} ${escapeHtml(share.basis || '')}</td>
    <td class="actions-cell">
      <button type="button" class="btn btn-sm" data-action="enable-share" data-id="${escapeHtml(agent.id)}">${icons.share} ${active ? 'Update' : 'Enable'}</button>
      ${agent.shareToken ? `<button type="button" class="btn btn-sm btn-danger" data-action="disable-share" data-id="${escapeHtml(agent.id)}">${icons.trash}</button>` : ''}
    </td></tr>`;
  });
  host.innerHTML = `
    <div id="share-alert"></div>
    ${card('Shareable agent links', 'Publish an agent as a standalone chat page with its own guest limit.', table(['Agent', 'Public link', 'Limit', 'Actions'], rows))}
    ${card('Enable a share link', 'Choose an agent and an optional visitor limit.', `<form id="share-form" class="form-grid">
      ${field('Agent', `<select name="agentId" class="select" required><option value="">— Select —</option>${agents.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('')}</select>`)}
      ${field('Limit', input('limit', 'number', '10', 'min="1" step="1"'))}
      ${field('Count by', `<select name="basis" class="select"><option value="messages">Messages</option><option value="sessions">Sessions</option></select>`)}
      <div class="form-actions"><button type="submit" class="btn btn-primary">${icons.share} Save share link</button></div>
    </form>`)}`;
  const showShare = (result) => {
    host.querySelector('#share-alert').innerHTML = `<div class="alert alert-success"><div>
      <strong>Share link ready</strong><p class="mono small">${escapeHtml(result.shareUrl || '')}</p></div>
      <a class="btn btn-sm" href="${escapeHtml(result.shareUrl || '#')}" target="_blank" rel="noopener">Open</a></div>`;
  };
  host.querySelector('#share-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.agentId.value;
    if (!id) return;
    try {
      const result = await api(`/api/admin/agents/${encodeURIComponent(id)}/share`, { method: 'POST', body: {
        limit: Number(form.elements.limit.value) || 10,
        basis: form.elements.basis.value,
      } });
      // Re-render first so the new link row is current, then show the share URL.
      await sharesTab(host, container);
      showShare(result);
      toast('Share link saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  host.querySelectorAll('[data-action="enable-share"]').forEach((button) => button.addEventListener('click', () => {
    const agent = agents.find((item) => item.id === button.dataset.id);
    if (!agent) return;
    const form = host.querySelector('#share-form');
    form.elements.agentId.value = agent.id;
    form.elements.limit.value = agent.share?.limit || 10;
    form.elements.basis.value = agent.share?.basis || 'messages';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  host.querySelectorAll('[data-action="disable-share"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Disable this public share link?')) return;
    try { await api(`/api/admin/agents/${encodeURIComponent(button.dataset.id)}/share`, { method: 'DELETE' }); toast('Share link disabled', 'success'); sharesTab(host, container); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

// --- Platform ----------------------------------------------------------------
async function platformTab(host, container) {
  host.innerHTML = stateBox('loading', 'Loading platform');
  const [tenantsRes, auditRes, settingsRes] = await Promise.all([
    api('/api/platform/tenants'), api('/api/platform/audit'), api('/api/platform/settings'),
  ]);
  if (!isCurrent(container)) return;
  const tenants = tenantsRes.tenants || [];
  const rows = tenants.map((tenant) => {
    const isGuest = tenant.id === settingsRes.guestTenantId;
    return `<tr>
    <td><strong>${escapeHtml(tenant.name)}</strong></td><td class="mono">${escapeHtml(tenant.slug)}</td>
    <td class="mono small">${escapeHtml(tenant.id)}</td>
    <td>${isGuest ? '<span class="badge badge-ok">Guest workspace</span>' : '—'}</td>
    <td><button type="button" class="btn btn-sm" data-action="make-guest" data-id="${escapeHtml(tenant.id)}" ${isGuest ? 'disabled' : ''}>Use for guests</button></td></tr>`;
  });
  const auditRows = (auditRes.entries || []).slice(0, 100).map((entry) => `<tr>
    <td class="muted">${escapeHtml(formatDate(entry.createdAt || entry.ts))}</td>
    <td><code>${escapeHtml(entry.action || '')}</code></td>
    <td class="muted small">${escapeHtml(typeof (entry.detail || entry.details) === 'object' ? JSON.stringify(entry.detail || entry.details) : (entry.detail || entry.details || ''))}</td></tr>`);
  host.innerHTML = `
    <div class="admin-grid">
      ${card('Workspaces', 'All tenants on this PeaceAi instance.', table(['Name', 'Slug', 'ID', 'Guest', 'Actions'], rows))}
      ${card('New workspace', 'Create an isolated tenant.', `<form id="tenant-form" class="form-stack">
        ${field('Workspace name', input('name', 'text', '', 'required'))}
        <button type="submit" class="btn btn-primary">${icons.plus} Create workspace</button>
      </form>`)}
    </div>
    ${card('Platform audit', 'Actions across every workspace.', table(['Time', 'Action', 'Details'], auditRows))}`;
  host.querySelector('#tenant-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try { await api('/api/platform/tenants', { method: 'POST', body: { name: form.elements.name.value } }); toast('Workspace created', 'success'); platformTab(host, container); }
    catch (err) { toast(err.message, 'error'); }
  });
  host.querySelectorAll('[data-action="make-guest"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Use this workspace for new guest sessions?')) return;
    try {
      await api('/api/platform/guest-tenant', { method: 'PUT', body: { tenantId: button.dataset.id } });
      toast('Guest workspace updated', 'success');
      await platformTab(host, container);
    }
    catch (err) { toast(err.message, 'error'); }
  }));
}
