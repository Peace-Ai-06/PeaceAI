// Admin view: providers, knowledge bases, agents, users, branding and audit.
import { api, escapeHtml } from './api.js';
import { state } from './store.js';
import { icons, formatDate, formatBytes, stateBox, errorBox, toast, updateBranding } from './ui.js';

const TOOL_IDS = ['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'run_command'];
const TABS = [
  ['overview', 'Overview'], ['providers', 'Providers'], ['knowledge', 'Knowledge Bases'],
  ['agents', 'Agents'], ['guest', 'Guest Access'], ['users', 'Users'], ['branding', 'Branding'], ['audit', 'Audit'],
];

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
      ${TABS.map(([id, label]) => `<button type="button" role="tab" class="tab ${state.adminTab === id ? 'active' : ''}" data-tab="${id}" aria-selected="${state.adminTab === id}">${escapeHtml(label)}</button>`).join('')}
    </div>
    <div id="admin-content">${stateBox('loading', 'Loading admin section')}</div>`;

  container.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.adminTab === button.dataset.tab) return;
      state.adminTab = button.dataset.tab;
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
    else if (tab === 'knowledge') await knowledgeTab(host, container);
    else if (tab === 'agents') await agentsTab(host, container);
    else if (tab === 'guest') await guestTab(host, container);
    else if (tab === 'users') await usersTab(host, container);
    else if (tab === 'branding') await brandingTab(host, container);
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
    ${card('Model providers', 'Connections used by your agents.', table(
      ['Name', 'Kind', 'Base URL', 'API key', 'Enabled', 'Actions'],
      providers.map((p) => `<tr>
        <td><strong>${escapeHtml(p.name)}</strong>${p.isBuiltIn ? ' <span class="badge">Built-in</span>' : ''}</td><td>${escapeHtml(p.kind)}</td>
        <td class="muted mono">${escapeHtml(p.baseUrl || '—')}</td>
        <td><span class="badge ${p.hasApiKey ? 'badge-ok' : 'badge-warn'}">${p.hasApiKey ? 'Set' : 'None'}</span></td>
        <td><span class="badge ${p.enabled ? 'badge-ok' : ''}">${p.enabled ? 'Enabled' : 'Disabled'}</span></td>
        <td class="actions-cell">
          <button type="button" class="btn btn-sm" data-action="test-provider" data-id="${escapeHtml(p.id)}">${icons.test} Test</button>
          <button type="button" class="btn btn-sm" data-action="edit-provider" data-id="${escapeHtml(p.id)}">${icons.edit} Edit</button>
          ${p.isBuiltIn ? '' : `<button type="button" class="btn btn-sm btn-danger" data-action="delete-provider" data-id="${escapeHtml(p.id)}">${icons.trash}</button>`}
        </td></tr>`)),
      `<button type="button" class="btn btn-sm btn-primary" data-action="show-provider-form">${icons.plus} Add provider</button>`)}
    <div id="provider-form-card" hidden>${card('Provider details', 'API keys are stored encrypted and never shown again.', `
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
