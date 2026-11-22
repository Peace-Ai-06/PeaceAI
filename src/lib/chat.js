import { find, filter, id, insert, now, save, update } from './store.js';
import { chat as providerChat } from './providers.js';
import { retrieve, indexAttachments } from './rag.js';
import { buildSystemPrompt } from './agents.js';
import { TOOL_DEFINITIONS, executeToolCall, requiresApproval, requestApproval } from './tools.js';
import { ApiError } from './http.js';

const MAX_HISTORY = 24;

export function getAgent(tenantId, agentId) {
  if (!agentId) throw new ApiError(400, 'agentId is required', 'validation_error');
  const agent = find('agents', (a) => a.id === agentId && a.tenantId === tenantId);
  if (!agent) throw new ApiError(404, 'Agent not found', 'not_found');
  return agent;
}

export function getConversation(tenantId, userId, conversationId, guestToken = null) {
  const conversation = find('conversations', (c) => c.id === conversationId && c.tenantId === tenantId
    && (userId ? c.userId === userId : c.guestToken === guestToken));
  if (!conversation) throw new ApiError(404, 'Conversation not found', 'not_found');
  return conversation;
}

export function createConversation({ tenantId, userId, agentId, title, guestToken = null }) {
  const conversation = {
    id: id('con_'),
    tenantId,
    userId,
    guestToken,
    agentId,
    title: title || 'New conversation',
    messages: [],
    createdAt: now(),
    updatedAt: now(),
  };
  return insert('conversations', conversation);
}

export function listConversations(tenantId, userId, agentId, guestToken = null) {
  return filter('conversations', (c) => c.tenantId === tenantId
    && (userId ? c.userId === userId : c.guestToken === guestToken) && (!agentId || c.agentId === agentId))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length }));
}

function providerFor(tenantId, providerId) {
  return providerId ? find('providers', (p) => p.id === providerId && p.tenantId === tenantId) : null;
}

function prepareMessages(conversation, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const message of conversation.messages.slice(-MAX_HISTORY)) {
    if (message.role === 'tool') {
      messages.push({ role: 'tool', toolCallId: message.toolCallId, content: message.content });
    } else if (message.toolCalls?.length) {
      messages.push({ role: 'assistant', content: message.content || '', toolCalls: message.toolCalls });
    } else if (message.role === 'user' || message.role === 'assistant') {
      messages.push({ role: message.role, content: message.content });
    }
  }
  return messages;
}

function appendUserMessage(conversation, content, messageId) {
  const message = { id: messageId || id('msg_'), role: 'user', content, ts: now() };
  conversation.messages.push(message);
  return message;
}

function appendAssistantMessage(conversation, result, sources = [], messageId) {
  const message = {
    id: messageId || id('msg_'),
    role: 'assistant',
    content: result.content || '',
    ts: now(),
    toolCalls: result.toolCalls || [],
    sources: sources.map(({ text, ...source }) => source),
  };
  conversation.messages.push(message);
  return message;
}

function appendToolMessage(conversation, call, result) {
  const message = {
    id: id('msg_'),
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: JSON.stringify(result),
    ts: now(),
  };
  conversation.messages.push(message);
  return message;
}

function allowedTools(agent) {
  const enabled = new Set(agent.tools?.enabled || []);
  return TOOL_DEFINITIONS.filter((tool) => enabled.has(tool.function.name));
}

async function invokeModel({ tenant, agent, conversation, systemPrompt, stream, onDelta }) {
  const provider = providerFor(tenant.id, agent.providerId);
  if (!provider) throw new ApiError(400, 'This agent has no active model provider. Ask an admin to configure one.', 'model_not_configured');
  const result = await providerChat(provider, {
    model: agent.model,
    messages: prepareMessages(conversation, systemPrompt),
    tools: allowedTools(agent),
    temperature: agent.generation?.temperature ?? 0.6,
    maxTokens: agent.generation?.maxTokens || 2048,
    stream,
  }, onDelta);
  return result;
}

function emit(onEvent, event, data) {
  if (typeof onEvent === 'function') onEvent(event, data);
}

export async function handleToolCalls({ tenant, user, agent, conversation, calls, sources, onEvent, depth = 0 }) {
  let pendingCount = 0;
  let executedCount = 0;
  for (const call of calls) {
    if (requiresApproval(agent, call.name)) {
      const token = requestApproval({
        tenantId: tenant.id,
        userId: user.id,
        conversationId: conversation.id,
        agentId: agent.id,
        toolCall: call,
      });
      pendingCount += 1;
      emit(onEvent, 'tool', { toolCall: call, status: 'pending', approvalToken: token });
    } else {
      const result = await executeToolCall(tenant.id, call);
      appendToolMessage(conversation, call, result);
      executedCount += 1;
      emit(onEvent, 'tool', { toolCall: call, status: 'done', result });
    }
  }
  conversation.updatedAt = now();
  save();
  if (executedCount && depth < 4) {
    await continueModel({ tenant, user, agent, conversation, sources, onEvent, depth: depth + 1 });
  }
  return pendingCount;
}

export async function continueModel({ tenant, user, agent, conversation, sources = [], onEvent, stream = false, depth = 0, assistantMessageId }) {
  const systemPrompt = buildSystemPrompt(agent, tenant, sources);
  const result = await invokeModel({ tenant, agent, conversation, systemPrompt, stream, onDelta: (text) => emit(onEvent, 'delta', { text }) });
  const assistant = appendAssistantMessage(conversation, result, sources, assistantMessageId);
  conversation.updatedAt = now();
  save();
  emit(onEvent, 'message', { message: assistant });
  if (result.toolCalls?.length) {
    await handleToolCalls({ tenant, user, agent, conversation, calls: result.toolCalls, sources, onEvent, depth });
  }
  return { assistant, toolCalls: result.toolCalls || [] };
}

export async function runChat({ tenant, user, agent, conversation, message, attachments = [], onEvent, stream = false, ids = {} }) {
  if (message) appendUserMessage(conversation, message, ids.userMessageId);
  conversation.updatedAt = now();
  save();

  const extraChunks = attachments.length ? await indexAttachments(tenant.id, agent, attachments) : [];
  let sources = [];
  if (extraChunks.length || (agent.knowledgeBaseIds || []).length) {
    sources = await retrieve(tenant.id, agent, message || '', { topK: 6, extraChunks });
  }
  emit(onEvent, 'sources', { sources });

  if (!message && !attachments.length) throw new ApiError(400, 'A message or attachment is required', 'validation_error');

  const result = await continueModel({ tenant, user, agent, conversation, sources, onEvent, stream, assistantMessageId: ids.assistantMessageId });
  return { conversation, reply: result.assistant.content, toolCalls: result.toolCalls, sources };
}

export function sourcesFromConversation(conversation) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === 'assistant' && Array.isArray(message.sources)) return message.sources;
  }
  return [];
}

export async function continueAfterApprovals({ tenant, user, conversation, results, stream = false, onEvent }) {
  const agent = getAgent(tenant.id, conversation.agentId);
  for (const { call, result } of results) {
    appendToolMessage(conversation, call, result);
    emit(onEvent, 'tool', { toolCall: call, status: 'done', result });
  }
  conversation.updatedAt = now();
  save();
  const response = await continueModel({
    tenant,
    user,
    agent,
    conversation,
    sources: sourcesFromConversation(conversation),
    onEvent,
    stream,
  });
  return { conversation, reply: response.assistant.content };
}

export function updateConversationTitle(conversation, title) {
  return update('conversations', conversation.id, { title, updatedAt: now() });
}
