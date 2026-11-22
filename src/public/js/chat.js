// Chat view: agents, conversations, streaming replies, sources and tool approvals.
import { api, escapeHtml } from './api.js';
import { state } from './store.js';
import { icons, renderMarkdown, formatDate, stateBox, errorBox, toast } from './ui.js';

// Attribute selector helper for arbitrary ids/tokens.
const attr = (value) => String(value ?? '').replace(/["\\]/g, '\\$&');
const byToolId = (scope, id) => scope?.querySelector(`[data-tool-id="${attr(id)}"]`);
const scrollBottom = (el) => { if (el) el.scrollTop = el.scrollHeight; };

const SUGGESTIONS = [
  { icon: icons.spark, title: 'Explain a concept', prompt: 'Explain how retrieval-augmented generation works in simple terms.' },
  { icon: icons.edit, title: 'Write something', prompt: 'Write a short, friendly project update for my team.' },
  { icon: icons.file, title: 'Use my documents', prompt: 'Summarize the key points of my uploaded documents.' },
  { icon: icons.chat, title: 'Debug with me', prompt: 'Help me debug a Node.js error. I will paste the code and the error.' },
];

function chatSkeleton() {
  return `
    <div class="page-head">
      <div><h1>Chat</h1><p class="muted">Talk to your agents and review their work.</p></div>
      <button type="button" class="btn btn-primary" data-action="new-chat">${icons.plus} New chat</button>
    </div>
    <div class="chat-layout">
      <section class="panel conv-panel" aria-label="Conversations">
        <div class="panel-head"><label class="field compact-field" for="agent-select"><span>Agent</span></label><div id="agent-slot">${stateBox('loading', 'Loading agents')}</div></div>
        <div class="conv-list" id="conv-list">${stateBox('loading', 'Loading conversations')}</div>
      </section>
      <section class="panel chat-panel" aria-label="Conversation">
        <div id="chat-alerts"></div>
        <div class="messages" id="messages" aria-live="polite">${stateBox('loading', 'Loading chat')}</div>
        <div id="pending-approvals"></div>
        <form class="composer" id="composer">
          <div class="chips" id="attachment-chips"></div>
          <div class="composer-row">
            <button type="button" class="icon-btn" data-action="attach" title="Attach files" aria-label="Attach files">${icons.attach}</button>
            <textarea id="composer-input" rows="2" placeholder="Message your agent… (Enter to send, Shift+Enter for a new line)"></textarea>
            <button type="submit" class="btn btn-primary" data-send>${icons.send} <span>Send</span></button>
          </div>
          <input type="file" id="attachment-input" multiple hidden>
        </form>
      </section>
    </div>`;
}

function current(container) {
  return container?.isConnected && state.route === 'chat';
}

export async function renderChat(container, seq) {
  state.conversationFromApproval = false;
  container.innerHTML = chatSkeleton();
  bindEvents(container);

  try {
    if (state.isGuest) {
      const guestRes = await api('/api/guest/me');
      if (!current(container)) return;
      state.guest = guestRes.guest || state.guest;
      state.tenant = guestRes.tenant || state.tenant;
      state.guestAgent = guestRes.agent || state.guestAgent;
      state.agents = state.guestAgent ? [state.guestAgent] : [];
      state.pendingTools = [];
      state.currentAgentId = state.guestAgent?.id || null;
      window.dispatchEvent(new CustomEvent('peaceai:guest-update', { detail: state.guest }));
    } else {
      const [agentsRes, pendingRes] = await Promise.all([
        api('/api/agents'),
        api('/api/tools/pending').catch(() => ({ pending: [] })),
      ]);
      if (!current(container)) return;
      state.agents = agentsRes.agents || [];
      state.pendingTools = pendingRes.pending || [];
      if (!state.agents.some((a) => a.id === state.currentAgentId)) {
        state.currentAgentId = state.agents[0]?.id || null;
      }
    }
    renderAgentSelect(container);
    renderPendingPanel(container);
    renderAttachmentChips(container);
    await loadConversations(container);
    if (!current(container)) return;
    if (state.currentConversationId) await loadConversation(container, state.currentConversationId);
    else showEmptyChat(container);
  } catch (err) {
    if (!current(container)) return;
    container.querySelector('#agent-slot').innerHTML = errorBox(err, 'retry-chat');
    container.querySelector('#conv-list').innerHTML = errorBox(err, 'retry-chat');
    container.querySelector('#messages').innerHTML = errorBox(err, 'retry-chat');
  }
}

function bindEvents(container) {
  const composer = container.querySelector('#composer');
  const input = container.querySelector('#composer-input');

  container.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    const action = el.dataset.action;

    if (action === 'retry-chat') { renderChat(container); return; }
    if (action === 'use-prompt') {
      const field = container.querySelector('#composer-input');
      if (field) { field.value = el.dataset.prompt || ''; field.focus(); }
      return;
    }
    if (action === 'new-chat') { newChat(container); return; }
    if (action === 'attach') { container.querySelector('#attachment-input').click(); return; }
    if (action === 'dismiss-alert') { el.closest('.alert')?.remove(); return; }
    if (action === 'goto-login') { location.hash = '#/login'; return; }
    if (action === 'remove-attachment') {
      state.draftAttachments.splice(Number(el.dataset.index), 1);
      renderAttachmentChips(container);
      return;
    }
    if (action === 'load-conversation') { await loadConversation(container, el.dataset.id); return; }
    if (action === 'delete-conversation') {
      if (!confirm('Delete this conversation? This cannot be undone.')) return;
      try {
        await api(`/api/conversations/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
        if (state.currentConversationId === el.dataset.id) newChat(container);
        await loadConversations(container);
        toast('Conversation deleted', 'success');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (action === 'tool-approve' || action === 'tool-deny') {
      const card = el.closest('.tool-card');
      await handleApproval(container, {
        token: card?.dataset.token || el.dataset.token,
        toolId: card?.dataset.toolId || el.dataset.toolId,
        action: action === 'tool-approve' ? 'approve' : 'deny',
      });
    }
  });

  container.querySelector('#agent-select')?.addEventListener('change', (event) => {
    state.currentAgentId = event.target.value || null;
    state.currentConversationId = null;
    state.conversation = null;
    showEmptyChat(container);
    loadConversations(container);
    renderPendingPanel(container);
  });

  // The select is re-created on refresh, so keep a delegated change handler too.
  container.addEventListener('change', async (event) => {
    if (event.target.id === 'attachment-input') {
      const files = [...event.target.files];
      event.target.value = '';
      if (!files.length) return;
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      try {
        const res = await api('/api/chat/attachments', { method: 'POST', form });
        state.draftAttachments.push(...(res.attachments || []));
        renderAttachmentChips(container);
        toast(`${files.length} file${files.length === 1 ? '' : 's'} attached`, 'success');
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage(container);
    }
  });
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(container);
  });
}

function renderAgentSelect(container) {
  const slot = container.querySelector('#agent-slot');
  if (!slot) return;
  if (state.isGuest) {
    slot.innerHTML = `<div class="mini-empty muted">${state.guestAgent?.icon || '✨'} ${escapeHtml(state.guestAgent?.name || 'PeaceAi Assistant')} <span class="badge">Guest</span></div>`;
    return;
  }
  const select = state.agents.length
    ? `<select id="agent-select" class="select">${state.agents.map((agent) => `<option value="${escapeHtml(agent.id)}" ${agent.id === state.currentAgentId ? 'selected' : ''}>${escapeHtml(agent.icon || '')} ${escapeHtml(agent.name || 'Untitled agent')}</option>`).join('')}</select>`
    : `<div class="mini-empty muted">No agents yet. Create one in Admin.</div>`;
  slot.innerHTML = select;
  slot.querySelector('#agent-select')?.addEventListener('change', (event) => {
    state.currentAgentId = event.target.value || null;
    state.currentConversationId = null;
    state.conversation = null;
    showEmptyChat(container);
    loadConversations(container);
    renderPendingPanel(container);
  });
}

async function loadConversations(container, silent = false) {
  const list = container.querySelector('#conv-list');
  if (!list || !current(container)) return;
  if (!silent) list.innerHTML = stateBox('loading', 'Loading conversations');
  try {
    const query = state.currentAgentId ? `?agentId=${encodeURIComponent(state.currentAgentId)}` : '';
    const res = await api(`/api/conversations${query}`);
    if (!current(container)) return;
    const conversations = (res.conversations || []).slice().sort((a, b) =>
      String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    state.conversations = conversations;
    if (!conversations.length) {
      list.innerHTML = stateBox('empty', 'No conversations', 'Start a new chat with the button above.');
      return;
    }
    list.innerHTML = conversations.map((conv) => `
      <div class="conv-item ${conv.id === state.currentConversationId ? 'active' : ''}">
        <button type="button" class="conv-open" data-action="load-conversation" data-id="${escapeHtml(conv.id)}">
          <span class="conv-title">${escapeHtml(conv.title || 'Untitled chat')}</span>
          <span class="muted small">${escapeHtml(formatDate(conv.updatedAt || conv.createdAt))}</span>
        </button>
        <button type="button" class="icon-btn icon-btn-sm" data-action="delete-conversation" data-id="${escapeHtml(conv.id)}" title="Delete conversation" aria-label="Delete conversation">${icons.trash}</button>
      </div>`).join('');
  } catch (err) {
    if (current(container)) list.innerHTML = errorBox(err, 'retry-chat');
  }
}

async function loadConversation(container, id) {
  const messages = container.querySelector('#messages');
  if (!messages) return;
  messages.innerHTML = stateBox('loading', 'Loading messages');
  try {
    const res = await api(`/api/conversations/${encodeURIComponent(id)}`);
    if (!current(container)) return;
    state.conversation = res.conversation;
    state.currentConversationId = res.conversation?.id || id;
    state.conversationFromApproval = false;
    renderConversation(messages, res.conversation);
    await loadConversations(container, true);
  } catch (err) {
    if (current(container)) messages.innerHTML = errorBox(err, 'retry-chat');
  }
}

function newChat(container) {
  state.currentConversationId = null;
  state.conversation = null;
  state.conversationFromApproval = false;
  state.messageSources = {};
  container.querySelector('#conv-list')?.querySelectorAll('.conv-item.active').forEach((el) => el.classList.remove('active'));
  showEmptyChat(container);
  showChatError(container, '', true);
  container.querySelector('#composer-input')?.focus();
}

function showEmptyChat(container) {
  const messages = container.querySelector('#messages');
  if (!messages) return;
  const agent = state.agents.find((a) => a.id === state.currentAgentId);
  messages.innerHTML = `<div class="chat-empty">
    <div class="empty-glyph">${icons.spark}</div>
    <h2>${agent ? 'What can I help with?' : 'Start a conversation'}</h2>
    <p class="muted">${agent ? `You're chatting with ${escapeHtml(agent.name)}. Ask anything, or try one of these:` : 'Select or create an agent to begin.'}</p>
    ${agent ? `<div class="suggestions">${SUGGESTIONS.map((item) => `
      <button type="button" class="suggestion" data-action="use-prompt" data-prompt="${escapeHtml(item.prompt)}">
        ${item.icon}<span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.prompt)}</small></span>
      </button>`).join('')}</div>` : ''}
  </div>`;
}

// --- Rendering messages, sources and tool cards -----------------------------
function sourcesHtml(messageId) {
  const sources = state.messageSources?.[messageId] || [];
  if (!sources.length) return '';
  return `<details class="sources"><summary>${icons.file} Sources (${sources.length})</summary><ul>${sources.map((source) => `
    <li><strong>${escapeHtml(source.documentName || 'Document')}</strong>
      <span class="badge">${Number(source.score ?? 0).toFixed(2)}</span>
      ${source.chunkIndex !== undefined ? `<span class="muted small">chunk ${escapeHtml(source.chunkIndex)}</span>` : ''}
      <p class="muted small">${escapeHtml(source.preview || '')}</p></li>`).join('')}</ul></details>`;
}

function toolCardHtml(toolCall = {}, ts = {}, tokenOverride = '') {
  const id = toolCall.id || ts.id || '';
  const status = ts.status || 'pending';
  const token = ts.token || tokenOverride || '';
  const labels = { pending: 'Needs approval', submitted: 'Awaiting result', done: 'Completed', denied: 'Denied', error: 'Failed', running: 'Running' };
  const badgeClass = status === 'done' ? 'badge-ok' : status === 'denied' || status === 'error' ? 'badge-danger' : 'badge-warn';
  const actions = status === 'pending' && token
    ? `<div class="tool-actions"><button type="button" class="btn btn-sm btn-primary" data-action="tool-approve">${icons.check} Approve</button><button type="button" class="btn btn-sm" data-action="tool-deny">Deny</button></div>`
    : '';
  const result = (ts.result !== undefined || ts.error)
    ? `<details class="tool-result"><summary>Result</summary><pre><code>${escapeHtml(JSON.stringify(ts.error ? { error: ts.error } : ts.result, null, 2) || '')}</code></pre></details>`
    : '';
  return `<div class="tool-card" data-tool-id="${escapeHtml(id)}" ${token ? `data-token="${escapeHtml(token)}"` : ''}>
    <div class="tool-head"><span class="tool-glyph">${icons.chevron}</span><code>${escapeHtml(toolCall.name || 'tool')}</code><span class="badge ${badgeClass}">${escapeHtml(labels[status] || status)}</span></div>
    <details class="tool-args"><summary>Arguments</summary><pre><code>${escapeHtml(JSON.stringify(toolCall.arguments || {}, null, 2))}</code></pre></details>
    ${actions}${result}
  </div>`;
}

function toolResultsHtml(results = []) {
  if (!results.length) return '';
  return `<div class="tool-results">${results.map((result) => `<details class="tool-result"><summary>Tool result</summary><pre><code>${escapeHtml(JSON.stringify(result, null, 2) || '')}</code></pre></details>`).join('')}</div>`;
}

function messageHtml(message = {}, { typing = false } = {}) {
  const role = message.role || 'assistant';
  const agent = state.agents.find((a) => a.id === state.conversation?.agentId);
  const label = role === 'user' ? 'You' : role === 'tool' ? 'Tool' : (agent?.name || 'Assistant');
  const body = typing
    ? `<div class="message-content md"><div class="typing"><span></span><span></span><span></span> Thinking…</div></div>`
    : `<div class="message-content md">${renderMarkdown(message.content || '')}</div>`;
  const toolCalls = (message.toolCalls || []).map((tc) => toolCardHtml(tc, state.toolStates[tc.id] || {})).join('');
  return `<article class="message message-${role}" data-message-id="${escapeHtml(message.id || '')}" ${typing ? 'data-streaming="1"' : ''}>
    <div class="message-avatar">${role === 'user' ? 'Y' : escapeHtml((agent?.icon || 'A').slice(0, 2))}</div>
    <div class="message-body">
      <div class="message-meta"><strong>${escapeHtml(label)}</strong><time>${escapeHtml(formatDate(message.ts))}</time></div>
      ${body}
      ${sourcesHtml(message.id)}
      ${toolCalls}
      ${toolResultsHtml(message.toolResults)}
    </div>
  </article>`;
}

function renderConversation(messages, conversation) {
  if (!messages) return;
  const msgs = conversation?.messages || [];
  messages.innerHTML = msgs.length
    ? msgs.map((msg) => messageHtml(msg)).join('')
    : `<div class="chat-empty"><div class="empty-glyph">${icons.chat}</div><h2>Empty conversation</h2><p class="muted">Send a message to get started.</p></div>`;
  scrollBottom(messages);
}

function renderPendingPanel(container) {
  const host = container.querySelector('#pending-approvals');
  if (!host) return;
  const messages = container.querySelector('#messages');
  const resolvedStatuses = new Set(['done', 'denied', 'error', 'submitted']);
  const visible = (state.pendingTools || []).filter((item) => {
    const id = item.toolCall?.id;
    if (!id) return true;
    if (resolvedStatuses.has(state.toolStates[id]?.status)) return false;
    return !byToolId(messages, id);
  });
  host.innerHTML = visible.length ? `<details class="pending-panel" open>
    <summary>Pending approvals (${visible.length})</summary>
    <div class="pending-list">${visible.map((item) => toolCardHtml(item.toolCall || {}, { status: 'pending', token: item.token }, item.token)).join('')}</div>
  </details>` : '';
}

function updateToolCard(container, toolId, toolState, toolCall) {
  const messages = container.querySelector('#messages');
  let card = byToolId(messages, toolId);
  if (card) {
    card.outerHTML = toolCardHtml(toolCall || state.toolStates[toolId]?.toolCall || {}, toolState, toolState.token || '');
  } else {
    const pending = container.querySelector('#pending-approvals');
    card = byToolId(pending, toolId);
    if (card) card.outerHTML = toolCardHtml(toolCall || {}, toolState, toolState.token || '');
  }
  renderPendingPanel(container);
  scrollBottom(messages);
}

function handleToolEvent(data, container) {
  const toolCall = data.toolCall || {};
  const id = toolCall.id;
  if (!id) return;
  const previous = state.toolStates[id] || {};
  state.toolStates[id] = {
    ...previous,
    ...toolCall,
    ...data,
    toolCall,
    token: data.approvalToken || previous.token,
    status: data.status || 'pending',
    result: data.result ?? previous.result,
  };
  const messages = container.querySelector('#messages');
  if (byToolId(messages, id)) {
    updateToolCard(container, id, state.toolStates[id], toolCall);
    return;
  }
  // Attach the card to the active assistant bubble, or the pending panel.
  let target = state.activeStream?.assistantEl;
  if (!target || !target.isConnected) target = messages?.querySelector('[data-streaming="1"]');
  if (target) {
    target.querySelector('.message-body')?.insertAdjacentHTML('beforeend', toolCardHtml(toolCall, state.toolStates[id], state.toolStates[id].token));
  }
  renderPendingPanel(container);
  scrollBottom(messages);
}

async function refreshPendingTools(container) {
  try {
    const res = await api('/api/tools/pending');
    state.pendingTools = res.pending || [];
  } catch { /* keep the last known list */ }
  renderPendingPanel(container);
}

// --- Tool approval -----------------------------------------------------------
async function handleApproval(container, { token, toolId, action }) {
  if (!token) { toast('Approval token is missing.', 'error'); return; }
  const card = byToolId(container, toolId) || byToolId(container.querySelector('#pending-approvals'), toolId);
  if (card) {
    card.querySelectorAll('[data-action="tool-approve"], [data-action="tool-deny"]').forEach((button) => {
      button.disabled = true;
    });
    card.querySelector('.tool-head .badge')?.replaceWith(Object.assign(document.createElement('span'), {
      className: 'badge badge-warn', textContent: 'Submitting…',
    }));
  }

  try {
    const res = await api('/api/tools/approve', { method: 'POST', body: { token, action } });
    const id = toolId || res?.toolCall?.id || '';
    const previous = state.toolStates[id] || {};
    const status = res.ok === false ? 'error' : action === 'deny' ? 'denied' : 'done';
    state.toolStates[id] = {
      ...previous,
      token,
      status,
      result: res.result,
      error: res.error,
      toolCall: res.toolCall || previous.toolCall,
    };
    if (id) updateToolCard(container, id, state.toolStates[id], state.toolStates[id].toolCall);

    // The backend may continue the LLM turn after an approval/denial.
    const messages = container.querySelector('#messages');
    if (res.conversation) {
      state.conversation = res.conversation;
      state.currentConversationId = res.conversation.id || state.currentConversationId;
      state.conversationFromApproval = true;
      if (state.activeStream?.assistantEl) state.activeStream.assistantEl.dataset.finalized = '1';
      renderConversation(messages, res.conversation);
      loadConversations(container, true);
    } else if (res.reply) {
      state.conversationFromApproval = true;
      // Keep the client snapshot current so a later `done` event cannot revert it.
      const replyMessage = {
        id: `approval-reply-${Date.now()}`, role: 'assistant', content: res.reply, ts: new Date().toISOString(),
      };
      if (state.conversation && !state.conversation.messages?.some((m) => m.role === 'assistant' && m.content === res.reply)) {
        state.conversation = {
          ...state.conversation,
          messages: [...(state.conversation.messages || []), replyMessage],
          updatedAt: replyMessage.ts,
        };
      }
      renderContinuationReply(container, res.reply, replyMessage.id);
    }
    toast(action === 'approve' ? 'Tool approved' : 'Tool denied', res.ok === false ? 'error' : 'success');
  } catch (err) {
    const previous = state.toolStates[toolId] || {};
    state.toolStates[toolId] = { ...previous, status: 'error', error: err.message, token };
    if (toolId) updateToolCard(container, toolId, state.toolStates[toolId], previous.toolCall);
    toast(err.message, 'error');
  }
  refreshPendingTools(container);
}

function renderContinuationReply(container, reply, messageId) {
  const messages = container.querySelector('#messages');
  if (!messages) return;
  const stream = state.activeStream;
  const bubble = stream?.assistantEl;
  const hasContent = bubble?.querySelector('.message-content')?.textContent.trim();
  if (bubble && bubble.isConnected && bubble.dataset.finalized !== '1' && !hasContent) {
    bubble.querySelector('.message-content').innerHTML = renderMarkdown(reply);
    bubble.querySelector('.typing')?.remove();
    bubble.dataset.messageId = messageId || bubble.dataset.messageId;
    bubble.dataset.finalized = '1';
    bubble.removeAttribute('data-streaming');
  } else {
    const message = { id: messageId || `reply-${Date.now()}`, role: 'assistant', content: reply, ts: new Date().toISOString() };
    messages.insertAdjacentHTML('beforeend', messageHtml(message));
  }
  scrollBottom(messages);
}

// --- Composer / streaming ----------------------------------------------------
function renderAttachmentChips(container) {
  const host = container.querySelector('#attachment-chips');
  if (!host) return;
  host.innerHTML = state.draftAttachments.map((attachment, index) => `
    <span class="chip">${icons.file}<span>${escapeHtml(attachment.name || 'attachment')}</span>
      <button type="button" data-action="remove-attachment" data-index="${index}" aria-label="Remove attachment">${icons.close}</button></span>`).join('');
}

function setComposerBusy(container, busy) {
  const input = container.querySelector('#composer-input');
  const send = container.querySelector('[data-send]');
  if (input) input.disabled = busy;
  if (send) send.disabled = busy;
}

function showChatError(container, message, clear = false, signIn = false) {
  const host = container.querySelector('#chat-alerts');
  if (!host) return;
  if (clear) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(message)}
    ${signIn ? '<button type="button" class="btn btn-sm btn-primary" data-action="goto-login" style="margin-left:.5rem">Sign in to continue</button>' : ''}
    <button type="button" class="icon-btn icon-btn-sm" data-action="dismiss-alert" aria-label="Dismiss">${icons.close}</button></div>`;
}

async function sendMessage(container) {
  const input = container.querySelector('#composer-input');
  if (!input || input.disabled) return;
  const text = input.value.trim();
  if (!text && !state.draftAttachments.length) return;
  if (!state.currentAgentId) { toast('Select or create an agent first.', 'error'); return; }

  const body = {
    agentId: state.currentAgentId,
    message: text,
    attachments: state.draftAttachments.map((a) => ({ name: a.name, text: a.text })),
  };
  if (state.currentConversationId) body.conversationId = state.currentConversationId;

  const messages = container.querySelector('#messages');
  messages.querySelector('.chat-empty')?.remove();
  const userMessage = { id: `local-user-${Date.now()}`, role: 'user', content: text || '(attachments)', ts: new Date().toISOString() };
  const assistantMessage = { id: `local-assistant-${Date.now()}`, role: 'assistant', content: '', ts: new Date().toISOString() };
  messages.insertAdjacentHTML('beforeend', messageHtml(userMessage) + messageHtml(assistantMessage, { typing: true }));
  let assistantEl = messages.lastElementChild;
  const userEl = assistantEl.previousElementSibling;
  state.conversationFromApproval = false;
  state.activeStream = { assistantEl, userEl, streamKey: assistantMessage.id, acc: '', firstDelta: false };
  state.messageSources[assistantMessage.id] = [];
  renderPendingPanel(container);
  scrollBottom(messages);

  input.value = '';
  state.draftAttachments = [];
  renderAttachmentChips(container);
  setComposerBusy(container, true);
  showChatError(container, '', true);

  const controller = new AbortController();
  state.streamAbort = controller;

  const ensureAssistant = () => {
    if (assistantEl?.isConnected && assistantEl.dataset.finalized !== '1') return assistantEl;
    const fresh = { id: `stream-${Date.now()}`, role: 'assistant', content: '', ts: new Date().toISOString() };
    messages.insertAdjacentHTML('beforeend', messageHtml(fresh, { typing: true }));
    assistantEl = messages.lastElementChild;
    if (state.activeStream) {
      state.activeStream.assistantEl = assistantEl;
      state.activeStream.acc = '';
    }
    return assistantEl;
  };

  try {
    await api.stream('/api/chat/stream', body, {
      meta: (data) => {
        if (data.conversationId) state.currentConversationId = data.conversationId;
        if (data.userMessageId && userEl) userEl.dataset.messageId = data.userMessageId;
        if (data.assistantMessageId && assistantEl) {
          const oldKey = state.messageSources[assistantMessage.id] || [];
          assistantEl.dataset.messageId = data.assistantMessageId;
          state.messageSources[data.assistantMessageId] = state.messageSources[data.assistantMessageId]?.length ? state.messageSources[data.assistantMessageId] : oldKey;
        }
        loadConversations(container, true);
      },
      sources: (data) => {
        const key = assistantEl?.dataset.messageId || assistantMessage.id;
        state.messageSources[key] = data.sources || [];
        const el = ensureAssistant();
        el.querySelector('.sources')?.remove();
        el.querySelector('.message-body')?.insertAdjacentHTML('beforeend', sourcesHtml(key));
        scrollBottom(messages);
      },
      delta: (data) => {
        const el = ensureAssistant();
        el.querySelector('.typing')?.remove();
        const stream = state.activeStream;
        if (stream) { stream.firstDelta = true; stream.acc += data.text || ''; }
        el.querySelector('.message-content').innerHTML = renderMarkdown(stream?.acc || '');
        scrollBottom(messages);
      },
      tool: (data) => handleToolEvent(data, container),
      done: (data) => {
        const conversation = data.conversation;
        if (!conversation) return;
        const incomingTs = Date.parse(conversation.updatedAt || 0) || 0;
        const currentTs = Date.parse(state.conversation?.updatedAt || 0) || 0;
        // An approval response may already contain a newer turn; don't undo it.
        if (state.conversationFromApproval && incomingTs <= currentTs) return;
        state.conversationFromApproval = false;
        state.conversation = conversation;
        state.currentConversationId = conversation.id || state.currentConversationId;
        renderConversation(messages, conversation);
        loadConversations(container, true);
      },
      error: (data) => {
        ensureAssistant().querySelector('.typing')?.remove();
        showChatError(container, data.message || 'The chat stream failed.', false, data.code === 'guest_limit_reached');
      },
      guest: (data) => {
        state.guest = { ...(state.guest || {}), remaining: data.remaining };
        window.dispatchEvent(new CustomEvent('peaceai:guest-update', { detail: state.guest }));
      },
    }, { signal: controller.signal });

    if (state.activeStream && !state.activeStream.firstDelta && !state.conversationFromApproval) {
      const el = assistantEl;
      const content = el?.querySelector('.message-content');
      if (content && !content.textContent.trim() && !content.querySelector('.typing')) {
        content.textContent = 'No response was returned.';
      }
    }
  } catch (err) {
    showChatError(container, err.message || 'Could not send the message.');
    ensureAssistant().querySelector('.typing')?.remove();
  } finally {
    setComposerBusy(container, false);
    state.streamAbort = null;
    state.activeStream = null;
    scrollBottom(messages);
    input.focus();
  }
}
