import http from 'node:http';

export function vectorFor(text) {
  const vector = Array(16).fill(0);
  for (const token of String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []) {
    let hash = 0;
    for (const char of token) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % vector.length] += 1;
  }
  return vector;
}

export function startMockProvider() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    requests.push({ url: req.url, body });

    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-embed' }] }));
    }
    if (req.url === '/v1/embeddings') {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: inputs.map((input, index) => ({ index, embedding: vectorFor(input) })) }));
    }
    if (req.url === '/v1/chat/completions') {
      const hasToolResult = (body.messages || []).some((message) => message.role === 'tool');
      const wantsTool = !body.stream && !hasToolResult && (body.tools || []).length > 0;
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const content = hasToolResult ? 'Done after tool.' : 'Streaming hello from PeaceAi.';
        for (const piece of content.split(' ')) {
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece + ' ' } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (wantsTool) {
        return res.end(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'call_mock_1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'notes.txt' }) } }],
            },
          }],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }));
      }
      return res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: hasToolResult ? 'Done after tool.' : 'Mock answer.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      }));
    }
    res.writeHead(404);
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}/v1` }));
  });
}

export function client(base) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  return {
    get cookie() { return cookieHeader(); },
    async request(method, path, body, form) {
      const headers = cookieHeader() ? { Cookie: cookieHeader() } : {};
      let payload;
      if (form) payload = form;
      else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const response = await fetch(base + path, { method, headers, body: payload });
      const setCookies = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
      for (const header of setCookies) {
        const pair = header.split(';')[0];
        const index = pair.indexOf('=');
        if (index === -1) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!value || /expires=Thu, 01 Jan 1970/i.test(header)) jar.delete(name);
        else jar.set(name, value);
      }
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, data };
    },
  };
}
