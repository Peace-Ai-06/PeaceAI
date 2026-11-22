// PeaceApi: tiny fetch helpers for the JSON API and SSE chat stream.
// Every request is same-origin and sends the session cookie.

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', response = null } = {}) {
    super(message || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

function errorFrom(payload, status) {
  if (payload && typeof payload === 'object') {
    const err = payload.error;
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
    if (typeof payload.message === 'string') return payload.message;
  }
  return `Request failed (${status || 'network'})`;
}

async function readBody(res) {
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * api(path, { method, body, form })
 * - `body` is JSON encoded, `form` is sent as FormData (multipart).
 * - successful responses are returned as parsed JSON; failures throw ApiError.
 */
export async function api(path, { method = 'GET', body, form, signal, timeout = 25000 } = {}) {
  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeout) : null;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) signal.aborted ? controller.abort(signal.reason) : signal.addEventListener('abort', onAbort, { once: true });
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal };
  if (form !== undefined && form !== null) {
    init.body = form; // browser sets the multipart boundary
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    const timedOut = err?.name === 'AbortError' && !signal?.aborted;
    throw new ApiError(timedOut ? 'Request timed out' : err?.name === 'AbortError' ? 'Request cancelled' : (err?.message || 'Network request failed'), { code: timedOut ? 'timeout' : 'network' });
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }

  if (res.status === 204) return { ok: true };
  const payload = await readBody(res);
  if (!res.ok) {
    throw new ApiError(errorFrom(payload, res.status), {
      status: res.status,
      code: payload?.error?.code || '',
      response: payload,
    });
  }
  return payload ?? { ok: true };
}

/**
 * api.stream(path, body, handlers, { signal })
 * Reads a text/event-stream and dispatches named events (meta, sources,
 * delta, tool, done, error) with their JSON payloads.
 */
export async function stream(path, body, handlers = {}, { signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name !== 'AbortError') handlers.error?.({ message: err?.message || 'Could not connect to the chat stream' });
    return;
  }

  if (!res.ok) {
    const payload = await readBody(res).catch(() => null);
    handlers.error?.({ message: errorFrom(payload, res.status) });
    return;
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    handlers.error?.({ message: 'Streaming is not supported by this browser.' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block) => {
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue; // comment / keep-alive
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    if (raw === '[DONE]') return;
    let data;
    try { data = JSON.parse(raw); } catch {
      handlers.error?.({ message: 'Received malformed stream data.' });
      return;
    }
    const handler = handlers[event] || handlers.onEvent;
    if (typeof handler === 'function') handler(data);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        dispatch(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
  } catch (err) {
    if (err?.name !== 'AbortError') handlers.error?.({ message: err?.message || 'Chat stream interrupted.' });
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
api.stream = stream;

// Escape a value before placing it in an HTML string or attribute.
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (ch) => map[ch]);
}
