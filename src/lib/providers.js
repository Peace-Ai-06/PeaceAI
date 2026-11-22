import { decrypt } from './security.js';
import { ApiError } from './http.js';

const DEFAULT_BASE = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://127.0.0.1:11434',
};

export function providerApiKey(provider) {
  return decrypt(provider.encryptedApiKey);
}

function baseUrl(provider) {
  return String(provider.baseUrl || DEFAULT_BASE[provider.kind] || '').replace(/\/$/, '');
}

function headers(provider) {
  const h = { 'Content-Type': 'application/json' };
  if (provider.kind === 'anthropic') {
    const key = providerApiKey(provider);
    if (key) h['x-api-key'] = key;
    h['anthropic-version'] = '2023-06-01';
  } else if (provider.kind === 'openai') {
    const key = providerApiKey(provider);
    if (key) h.Authorization = `Bearer ${key}`;
  }
  return h;
}

async function request(url, options, timeout = 120000) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    throw new ApiError(502, `Could not reach model provider: ${error.message}`, 'provider_unreachable');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(502, `Model provider returned ${response.status}: ${body.slice(0, 600)}`, 'provider_error');
  }
  return response;
}

async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = parseEvent(raw);
      if (event) yield event;
    }
  }
  if (buffer.trim()) {
    const event = parseEvent(buffer);
    if (event) yield event;
  }
}

function parseEvent(raw) {
  const event = { event: 'message', data: '' };
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event.event = line.slice(6).trim();
    else if (line.startsWith('data:')) event.data += line.slice(5).trim();
  }
  if (!event.data) return null;
  return event;
}

function safeParseJson(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeToolCalls(calls = []) {
  return calls.map((call, index) => {
    const raw = call.arguments ?? call.function?.arguments ?? call.input ?? {};
    return {
      id: call.id || call.tool_call_id || `call_${index}_${Date.now().toString(36)}`,
      name: call.name || call.function?.name || call.tool_name || 'unknown_tool',
      arguments: typeof raw === 'string' ? safeParseJson(raw) : (raw || {}),
    };
  });
}

/* ---------------------------------- models --------------------------------- */

export async function listModels(provider) {
  if (provider.kind === 'ollama') {
    const response = await request(`${baseUrl(provider)}/api/tags`, { headers: headers(provider) });
    const data = await response.json();
    return (data.models || []).map((m) => m.name);
  }
  const response = await request(`${baseUrl(provider)}/models`, { headers: headers(provider) });
  const data = await response.json();
  if (Array.isArray(data.data)) return data.data.map((m) => m.id);
  if (Array.isArray(data.models)) return data.models.map((m) => m.id || m.name);
  return [];
}

/* -------------------------------- embeddings -------------------------------- */

export async function embed(provider, model, input) {
  const texts = Array.isArray(input) ? input : [input];
  if (!texts.length) return [];
  if (provider.kind === 'ollama') {
    const response = await request(`${baseUrl(provider)}/api/embed`, {
      method: 'POST',
      headers: headers(provider),
      body: JSON.stringify({ model, input: texts }),
    });
    const data = await response.json();
    return data.embeddings || [];
  }
  if (provider.kind === 'openai') {
    const response = await request(`${baseUrl(provider)}/embeddings`, {
      method: 'POST',
      headers: headers(provider),
      body: JSON.stringify({ model, input: texts }),
    });
    const data = await response.json();
    return (data.data || []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
  throw new ApiError(400, 'This provider does not support embeddings', 'embeddings_unsupported');
}

/* --------------------------------- chat: shared ------------------------------ */

function openAIMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) };
    }
    if (message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function anthropicMessages(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const blocks = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      blocks.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) }],
      });
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments || {} });
      blocks.push({ role: 'assistant', content });
      continue;
    }
    blocks.push({ role: message.role, content: message.content });
  }
  // Anthropic requires alternating roles; merge neighbouring blocks of the same role.
  const merged = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === block.role) {
      previous.content = [...(Array.isArray(previous.content) ? previous.content : [{ type: 'text', text: previous.content }]),
        ...(Array.isArray(block.content) ? block.content : [{ type: 'text', text: block.content }])];
    } else {
      merged.push({ ...block, content: Array.isArray(block.content) ? block.content : block.content });
    }
  }
  return { system, messages: merged };
}

function anthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

/* ------------------------------- chat: OpenAI -------------------------------- */

async function openAIChat(provider, options, onDelta) {
  const body = {
    model: options.model,
    messages: openAIMessages(options.messages),
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };
  if (options.tools?.length) body.tools = options.tools;

  if (!options.stream) {
    const response = await request(`${baseUrl(provider)}/chat/completions`, {
      method: 'POST', headers: headers(provider), body: JSON.stringify({ ...body, stream: false }),
    });
    const data = await response.json();
    const choice = data.choices?.[0] || {};
    return {
      content: choice.message?.content || '',
      toolCalls: normalizeToolCalls(choice.message?.tool_calls || []),
      usage: data.usage,
    };
  }

  const response = await request(`${baseUrl(provider)}/chat/completions`, {
    method: 'POST', headers: headers(provider), body: JSON.stringify({ ...body, stream: true }),
  });
  const calls = new Map();
  let content = '';
  for await (const event of sseEvents(response.body)) {
    if (event.data === '[DONE]') break;
    const payload = safeParseJson(event.data);
    const delta = payload.choices?.[0]?.delta || {};
    if (delta.content) {
      content += delta.content;
      onDelta?.(delta.content);
    }
    for (const call of delta.tool_calls || []) {
      const index = call.index ?? 0;
      const current = calls.get(index) || { id: '', name: '', args: '' };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name += call.function.name;
      if (call.function?.arguments) current.args += call.function.arguments;
      calls.set(index, current);
    }
  }
  return {
    content,
    toolCalls: [...calls.values()].map((call) => ({
      id: call.id || `call_${Date.now().toString(36)}`,
      name: call.name,
      arguments: safeParseJson(call.args),
    })),
  };
}

/* ------------------------------ chat: Anthropic ------------------------------ */

async function anthropicChat(provider, options, onDelta) {
  const { system, messages } = anthropicMessages(options.messages);
  const body = {
    model: options.model,
    max_tokens: options.maxTokens || 4096,
    temperature: options.temperature,
    messages,
  };
  if (system) body.system = system;
  if (options.tools?.length) body.tools = anthropicTools(options.tools);

  if (!options.stream) {
    const response = await request(`${baseUrl(provider)}/messages`, {
      method: 'POST', headers: headers(provider), body: JSON.stringify(body),
    });
    const data = await response.json();
    const content = (data.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
    const toolCalls = (data.content || []).filter((block) => block.type === 'tool_use').map((block) => ({
      id: block.id, name: block.name, arguments: block.input || {},
    }));
    return { content, toolCalls, usage: data.usage };
  }

  const response = await request(`${baseUrl(provider)}/messages`, {
    method: 'POST', headers: headers(provider), body: JSON.stringify({ ...body, stream: true }),
  });
  const blocks = new Map();
  let content = '';
  for await (const event of sseEvents(response.body)) {
    const payload = safeParseJson(event.data);
    const type = payload.type || event.event;
    if (type === 'content_block_start') {
      const block = payload.content_block || {};
      blocks.set(payload.index, { type: block.type, id: block.id, name: block.name, text: '', json: block.input ? JSON.stringify(block.input) : '' });
    } else if (type === 'content_block_delta') {
      const delta = payload.delta || {};
      const block = blocks.get(payload.index) || { type: delta.type === 'input_json_delta' ? 'tool_use' : 'text', text: '', json: '' };
      if (delta.type === 'text_delta') {
        block.text += delta.text || '';
        content += delta.text || '';
        onDelta?.(delta.text || '');
      } else if (delta.type === 'input_json_delta') {
        block.json += delta.partial_json || '';
      }
      blocks.set(payload.index, block);
    }
  }
  const toolCalls = [...blocks.values()].filter((block) => block.type === 'tool_use').map((block) => ({
    id: block.id || `call_${Date.now().toString(36)}`,
    name: block.name,
    arguments: safeParseJson(block.json),
  }));
  return { content, toolCalls };
}

/* -------------------------------- chat: Ollama -------------------------------- */

function ollamaMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) };
    }
    if (message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments || {} },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function ollamaTools(tools) {
  return tools.map((tool) => ({ type: 'function', function: tool.function }));
}

async function ollamaChat(provider, options, onDelta) {
  const body = {
    model: options.model,
    messages: ollamaMessages(options.messages),
    stream: Boolean(options.stream),
    options: { temperature: options.temperature, num_predict: options.maxTokens },
  };
  if (options.tools?.length) body.tools = ollamaTools(options.tools);

  const response = await request(`${baseUrl(provider)}/api/chat`, {
    method: 'POST', headers: headers(provider), body: JSON.stringify(body),
  });

  if (!options.stream) {
    const data = await response.json();
    const calls = data.message?.tool_calls || [];
    return {
      content: data.message?.content || '',
      toolCalls: calls.map((call, index) => ({
        id: call.id || `call_${index}_${Date.now().toString(36)}`,
        name: call.function?.name || call.name || 'unknown_tool',
        arguments: typeof call.function?.arguments === 'string' ? safeParseJson(call.function.arguments) : (call.function?.arguments || {}),
      })),
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const calls = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const data = safeParseJson(line);
      if (data.message?.content) {
        content += data.message.content;
        onDelta?.(data.message.content);
      }
      for (const call of data.message?.tool_calls || []) {
        calls.push({
          id: call.id || `call_${calls.length}_${Date.now().toString(36)}`,
          name: call.function?.name || call.name || 'unknown_tool',
          arguments: typeof call.function?.arguments === 'string' ? safeParseJson(call.function.arguments) : (call.function?.arguments || {}),
        });
      }
    }
  }
  return { content, toolCalls: calls };
}

/* --------------------------------- public API -------------------------------- */

export async function chat(provider, options, onDelta) {
  if (!provider || !options.model) throw new ApiError(400, 'An agent needs an active provider and model', 'model_not_configured');
  if (provider.kind === 'ollama') return ollamaChat(provider, options, onDelta);
  if (provider.kind === 'anthropic') return anthropicChat(provider, options, onDelta);
  return openAIChat(provider, options, onDelta);
}
