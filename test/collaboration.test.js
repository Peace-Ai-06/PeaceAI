import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { client, startMockProvider } from './helpers/mock-provider.js';

const tempDir = fs.mkdtempSync(path.join('/tmp/opencode', 'peaceai-collab-'));
process.env.PEACEAI_DATA_DIR = tempDir;

const { createApp } = await import('../src/server.js');
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

async function setup(email = 'collab@example.com') {
  const admin = client(base);
  const registered = await admin.request('POST', '/api/auth/register', {
    email, password: 'password123', name: 'Collab', tenantName: 'Collab Org',
  });
  assert.equal(registered.status, 201);
  const provider = await admin.request('POST', '/api/admin/providers', {
    name: 'Mock', kind: 'openai', baseUrl: mock.url, apiKey: 'test-key', enabled: true,
  });
  assert.equal(provider.status, 201);
  const agents = await admin.request('GET', '/api/admin/agents');
  const agent = agents.data.agents.find((item) => item.isGuestDefault);
  assert.equal((await admin.request('PUT', `/api/admin/agents/${agent.id}`, {
    ...agent, providerId: provider.data.provider.id, model: 'mock-model',
  })).status, 200);
  return { admin, agentId: agent.id };
}

test('admins can create and run a multi-agent workflow; MCP lists it as a tool', async () => {
  const { admin, agentId } = await setup();

  const created = await admin.request('POST', '/api/admin/workflows', {
    name: 'Draft then review',
    description: 'Two agents in sequence',
    steps: [
      { agentId, instruction: 'Draft the answer.' },
      { agentId, instruction: 'Review and improve the draft.' },
    ],
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.workflow.steps.length, 2);

  const listed = await admin.request('GET', '/api/workflows');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.workflows.length, 1);

  const run = await admin.request('POST', `/api/workflows/${created.data.workflow.id}/run`, {
    message: 'Write a haiku about sqlite',
  });
  assert.equal(run.status, 200);
  assert.equal(run.data.steps.length, 2);
  assert.deepEqual(run.data.steps.map((step) => step.index), [0, 1]);
  assert.match(run.data.reply, /Mock answer/);
  assert.ok(run.data.steps.every((step) => step.conversationId));

  const key = await admin.request('POST', '/api/admin/api-keys', { name: 'mcp', scopes: ['mcp'] });
  const rpc = (body) => fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.data.token}` },
    body: JSON.stringify(body),
  }).then((response) => response.json());
  const tools = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(tools.result.tools.some((tool) => tool.name.includes('wfl_')));

  const call = await rpc({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: `peaceai_wf_${created.data.workflow.id}`, arguments: { message: 'Hi' } },
  });
  assert.equal(call.result.isError, false);
  assert.match(call.result.content[0].text, /Mock answer/);

  const removed = await admin.request('DELETE', `/api/admin/workflows/${created.data.workflow.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await admin.request('GET', '/api/workflows')).data.workflows.length, 0);
});

test('shareable agent links expose a public chat with a hard message quota', async () => {
  const { admin, agentId } = await setup('share@example.com');
  const shared = await admin.request('POST', `/api/admin/agents/${agentId}/share`, { limit: 2, basis: 'messages' });
  assert.equal(shared.status, 201);
  assert.ok(shared.data.token);
  assert.equal(shared.data.shareUrl, `/share/${shared.data.token}`);

  const visitor = client(base);
  const info = await visitor.request('GET', `/api/share/${shared.data.token}`);
  assert.equal(info.status, 200);
  assert.equal(info.data.agent.name, 'PeaceAI Assistant');
  assert.equal(info.data.agent.limits.limit, 2);
  assert.ok(!JSON.stringify(info.data).includes('persona'));

  const session = await visitor.request('POST', `/api/share/${shared.data.token}/session`);
  assert.equal(session.status, 201);
  assert.equal(session.data.remaining.remaining, 2);

  const first = await visitor.request('POST', `/api/share/${shared.data.token}/chat`, { message: 'hello' });
  assert.equal(first.status, 200);
  assert.match(first.data.reply, /Mock answer/);
  assert.equal(first.data.remaining.remaining, 1);

  const second = await visitor.request('POST', `/api/share/${shared.data.token}/chat`, { message: 'again' });
  assert.equal(second.status, 200);
  assert.equal(second.data.remaining.remaining, 0);

  const blocked = await visitor.request('POST', `/api/share/${shared.data.token}/chat`, { message: 'once more' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'share_limit_reached');

  const disabled = await admin.request('DELETE', `/api/admin/agents/${agentId}/share`);
  assert.equal(disabled.status, 200);
  assert.equal((await visitor.request('GET', `/api/share/${shared.data.token}`)).status, 404);
});

test('tenant isolation applies to workflows', async () => {
  const { agentId } = await setup('owner@example.com');
  const created = await client(base);
  const registered = await created.request('POST', '/api/auth/register', {
    email: 'other@example.com', password: 'password123', name: 'Other', tenantName: 'Other Org',
  });
  assert.equal(registered.status, 201);
  const wf = await created.request('POST', '/api/admin/workflows', {
    name: 'Private', steps: [{ agentId, instruction: 'x' }],
  });
  // The agent belongs to the other tenant, so creation must be rejected.
  assert.equal(wf.status, 404);
});
