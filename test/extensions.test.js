import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { client, startMockProvider } from './helpers/mock-provider.js';

const tempDir = fs.mkdtempSync(path.join('/tmp/opencode', 'peaceai-ext-'));
process.env.PEACEAI_DATA_DIR = tempDir;

const { createApp } = await import('../src/server.js');
const { rateLimit, clearRateLimits } = await import('../src/lib/ratelimit.js');
const { normalizeUsage, estimateCost } = await import('../src/lib/usage.js');
const mock = await startMockProvider();
const app = createApp();
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  mock.server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('usage normalization and cost estimate handle both provider shapes', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 10, completion_tokens: 4 }), {
    promptTokens: 10, completionTokens: 4, totalTokens: 14,
  });
  assert.equal(normalizeUsage({ input_tokens: 3, output_tokens: 2 }).totalTokens, 5);
  assert.ok(estimateCost('gpt-4o-mini', 1_000_000, 0) === 0.15);
  assert.equal(estimateCost('unknown-model', 100, 100), 0);
});

test('rate limiter blocks requests over the window', () => {
  clearRateLimits();
  const middleware = rateLimit({ scope: 'unit', limit: 2, windowMs: 60_000, keyFn: () => 'same-ip' });
  const run = () => new Promise((resolve) => {
    let result = null;
    middleware({ ip: 'same-ip' }, {}, (error) => { result = error?.code || 'ok'; resolve(result); });
  });
  return (async () => {
    assert.equal(await run(), 'ok');
    assert.equal(await run(), 'ok');
    assert.equal(await run(), 'rate_limited');
  })();
});

test('chat records token usage and budgets can be enforced', async () => {
  const admin = client(base);
  const registered = await admin.request('POST', '/api/auth/register', {
    email: 'usage@example.com', password: 'password123', name: 'Usage', tenantName: 'Usage Org',
  });
  assert.equal(registered.status, 201);
  const provider = await admin.request('POST', '/api/admin/providers', {
    name: 'Mock', kind: 'openai', baseUrl: mock.url, apiKey: 'test-key', enabled: true,
  });
  const agents = await admin.request('GET', '/api/admin/agents');
  const agent = agents.data.agents.find((item) => item.isGuestDefault);
  assert.equal((await admin.request('PUT', `/api/admin/agents/${agent.id}`, {
    ...agent, providerId: provider.data.provider.id, model: 'mock-model',
  })).status, 200);

  const chat = await admin.request('POST', '/api/chat', { agentId: agent.id, message: 'hello' });
  assert.equal(chat.status, 200);
  const usage = await admin.request('GET', '/api/me/usage');
  assert.equal(usage.status, 200);
  assert.ok(usage.data.totals.totalTokens >= 17, 'mock usage was persisted');
  assert.equal(usage.data.totals.requests, 1);

  const limit = await admin.request('PUT', '/api/admin/limits', { monthlyTokens: 1 });
  assert.equal(limit.status, 200);
  const blocked = await admin.request('POST', '/api/chat', { agentId: agent.id, message: 'again' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error.code, 'budget_exceeded');
  assert.equal((await admin.request('PUT', '/api/admin/limits', { monthlyTokens: null, monthlyCost: null })).status, 200);
});

test('feedback is stored and summarized for admins', async () => {
  const admin = client(base);
  await admin.request('POST', '/api/auth/login', { email: 'usage@example.com', password: 'password123' });
  const agents = await admin.request('GET', '/api/agents');
  const conversation = await admin.request('POST', '/api/conversations', { agentId: agents.data.agents[0].id });
  const chat = await admin.request('POST', '/api/chat', {
    agentId: agents.data.agents[0].id, conversationId: conversation.data.conversation.id, message: 'rate this',
  });
  assert.equal(chat.status, 200);
  const assistant = [...chat.data.conversation.messages].reverse().find((message) => message.role === 'assistant');
  const saved = await admin.request('POST', '/api/feedback', {
    conversationId: conversation.data.conversation.id, messageId: assistant.id, rating: 5, comment: 'great',
  });
  assert.equal(saved.status, 201);
  const list = await admin.request('GET', '/api/admin/feedback');
  assert.equal(list.data.feedback.length, 1);
  const summary = await admin.request('GET', '/api/admin/feedback/summary');
  assert.equal(summary.data.average, 5);
  assert.equal(summary.data.positive, 1);
});

test('API keys unlock an MCP endpoint that exposes agents as tools', async () => {
  const admin = client(base);
  await admin.request('POST', '/api/auth/login', { email: 'usage@example.com', password: 'password123' });
  const created = await admin.request('POST', '/api/admin/api-keys', { name: 'CI', scopes: ['mcp', 'chat'] });
  assert.equal(created.status, 201);
  const token = created.data.token;
  assert.ok(!JSON.stringify(created.data.apiKey).includes(token));

  const rpc = (method, params = {}) => fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((response) => response.json());

  assert.equal((await rpc('initialize')).result.protocolVersion, '2024-11-05');
  const tools = await rpc('tools/list');
  assert.ok(tools.result.tools.length >= 1);
  const name = tools.result.tools[0].name;
  const called = await rpc('tools/call', { name, arguments: { message: 'from MCP' } });
  assert.equal(called.result.isError, false);
  assert.match(called.result.content[0].text, /Mock answer/);

  const listed = await admin.request('GET', '/api/admin/api-keys');
  assert.equal(listed.data.apiKeys.length, 1);
  assert.equal((await admin.request('DELETE', `/api/admin/api-keys/${created.data.apiKey.id}`)).status, 200);
  const denied = await fetch(`${base}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(denied.status, 401);
});
