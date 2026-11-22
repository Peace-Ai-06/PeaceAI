import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { client, startMockProvider } from './helpers/mock-provider.js';

const tempDir = fs.mkdtempSync(path.join('/tmp/opencode', 'peaceai-test-'));
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

test('full flow: auth, RAG upload, provider, agent, tool approval, streaming and tenant isolation', async () => {
  const admin = client(base);
  const health = await admin.request('GET', '/api/health');
  assert.equal(health.status, 200);

  const registered = await admin.request('POST', '/api/auth/register', {
    email: 'owner@example.com', password: 'password123', name: 'Owner', tenantName: 'Harmony Inc',
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, 'admin');
  assert.equal(registered.data.user.isPlatformAdmin, true);
  const tenantId = registered.data.tenant.id;

  const me = await admin.request('GET', '/api/auth/me');
  assert.equal(me.data.user.email, 'owner@example.com');

  // Home page works immediately: a built-in offline model is wired to guest chat.
  const seededProviders = await admin.request('GET', '/api/admin/providers');
  const builtIn = seededProviders.data.providers.find((item) => item.kind === 'local' && item.isBuiltIn);
  assert.ok(builtIn, 'the built-in PeaceAi Local provider is seeded');
  const seededAgents = await admin.request('GET', '/api/admin/agents');
  const seededGuestAgent = seededAgents.data.agents.find((item) => item.isGuestDefault);
  assert.equal(seededGuestAgent.providerId, builtIn.id);
  assert.equal(seededGuestAgent.model, 'peaceai-local');

  const firstGuest = client(base);
  assert.equal((await firstGuest.request('POST', '/api/guest/session')).status, 201);
  const firstReply = await firstGuest.request('POST', '/api/chat', { message: 'hello' });
  assert.equal(firstReply.status, 200);
  assert.match(firstReply.data.reply, /PeaceAi/);

  const provider = await admin.request('POST', '/api/admin/providers', {
    name: 'Mock', kind: 'openai', baseUrl: mock.url, apiKey: 'test-key', enabled: true,
  });
  assert.equal(provider.status, 201);
  assert.equal(provider.data.provider.hasApiKey, true);
  assert.ok(!JSON.stringify(provider.data).includes('test-key'));

  const models = await admin.request('POST', `/api/admin/providers/${provider.data.provider.id}/test`);
  assert.deepEqual(models.data.models, ['mock-model', 'mock-embed']);

  // The default guest assistant needs a model before guests can chat.
  const initialAgents = await admin.request('GET', '/api/admin/agents');
  const guestAgent = initialAgents.data.agents.find((item) => item.isGuestDefault);
  assert.ok(guestAgent, 'a default guest agent is created with the workspace');
  const guestAgentUpdate = await admin.request('PUT', `/api/admin/agents/${guestAgent.id}`, {
    ...guestAgent, providerId: provider.data.provider.id, model: 'mock-model',
  });
  assert.equal(guestAgentUpdate.status, 200);

  const kb = await admin.request('POST', '/api/admin/knowledge-bases', {
    name: ' handbook ', description: 'Internal handbook',
    embeddingProviderId: provider.data.provider.id, embeddingModel: 'mock-embed',
  });
  assert.equal(kb.status, 201);

  const form = new FormData();
  form.append('files', new Blob(['The secret word is harmony. PeaceAi keeps work calm.'], { type: 'text/plain' }), 'handbook.txt');
  const upload = await admin.request('POST', `/api/admin/knowledge-bases/${kb.data.knowledgeBase.id}/documents`, undefined, form);
  assert.equal(upload.status, 201);
  assert.equal(upload.data.documents[0].status, 'ready');
  assert.equal(upload.data.documents[0].chunkCount, 1);

  const agent = await admin.request('POST', '/api/admin/agents', {
    name: 'Handbook Bot', persona: 'Answer from the handbook.', icon: '📘',
    providerId: provider.data.provider.id, model: 'mock-model',
    embeddingProviderId: provider.data.provider.id, embeddingModel: 'mock-embed',
    knowledgeBaseIds: [kb.data.knowledgeBase.id],
    generation: { temperature: 0.2, maxTokens: 512 },
    tools: { enabled: ['read_file', 'write_file'], approvalRequired: true },
  });
  assert.equal(agent.status, 201);
  assert.deepEqual(agent.data.agent.tools.enabled, ['read_file', 'write_file']);

  // Upload project files into the tenant sandbox, then verify the coding-agent file API.
  const sandboxForm = new FormData();
  sandboxForm.append('path', 'src');
  sandboxForm.append('files', new Blob(['console.log("hello peace")'], { type: 'text/plain' }), 'app.js');
  const sandboxUpload = await admin.request('POST', `/api/tools/${agent.data.agent.id}/files`, undefined, sandboxForm);
  assert.equal(sandboxUpload.status, 201);
  assert.equal(sandboxUpload.data.files[0].name, path.join('src', 'app.js'));
  const listing = await admin.request('GET', `/api/tools/${agent.data.agent.id}/files?path=src`);
  assert.ok(listing.data.entries.some((entry) => entry.name === 'app.js'));

  // Pre-create the file the mock model asks to read inside the tenant sandbox.
  fs.mkdirSync(path.join(tempDir, 'workspaces', tenantId), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'workspaces', tenantId, 'notes.txt'), 'Sandbox note content');

  const chat = await admin.request('POST', '/api/chat', {
    agentId: agent.data.agent.id, message: 'What is the secret word?',
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.data.sources[0].documentName, 'handbook.txt');
  const modelRequest = mock.requests.find((entry) => entry.url === '/v1/chat/completions');
  assert.match(modelRequest.body.messages[0].content, /secret word is harmony/);

  const pending = await admin.request('GET', '/api/tools/pending');
  assert.equal(pending.data.pending.length, 1);
  assert.equal(pending.data.pending[0].toolCall.name, 'read_file');

  const approval = await admin.request('POST', '/api/tools/approve', {
    token: pending.data.pending[0].token, action: 'approve',
  });
  assert.equal(approval.status, 200);
  assert.equal(approval.data.result.ok, true);
  assert.equal(approval.data.reply, 'Done after tool.');
  assert.equal((await admin.request('GET', '/api/tools/pending')).data.pending.length, 0);

  const traversal = await admin.request('GET', `/api/tools/${agent.data.agent.id}/files?path=../etc`);
  assert.equal(traversal.status, 400);

  const streamResponse = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ agentId: agent.data.agent.id, message: 'Stream please' }),
  });
  assert.equal(streamResponse.status, 200);
  const events = parseSSE(await streamResponse.text());
  assert.ok(events.some((event) => event.event === 'meta'));
  assert.ok(events.some((event) => event.event === 'sources'));
  assert.ok(events.some((event) => event.event === 'delta'));
  assert.ok(events.some((event) => event.event === 'done'));
  const streamedText = events.filter((event) => event.event === 'delta').map((event) => event.data.text).join('');
  assert.match(streamedText, /Streaming hello/);

  const themed = await admin.request('PUT', '/api/me/theme', { theme: { mode: 'light', accent: '#123456' } });
  assert.equal(themed.data.user.theme.mode, 'light');
  assert.equal((await admin.request('GET', '/api/auth/me')).data.user.theme.accent, '#123456');

  const branded = await admin.request('PUT', '/api/admin/branding', { branding: { appName: 'CalmAI', tagline: 'Stay focused' } });
  assert.equal(branded.data.tenant.branding.appName, 'CalmAI');

  const other = client(base);
  const otherRegister = await other.request('POST', '/api/auth/register', {
    email: 'other@example.com', password: 'password123', name: 'Other', tenantName: 'Other Org',
  });
  assert.equal(otherRegister.status, 201);
  assert.equal((await other.request('GET', '/api/agents')).data.agents.length, 1);
  assert.equal((await other.request('GET', `/api/conversations/${chat.data.conversation.id}`)).status, 404);
  assert.equal((await other.request('GET', '/api/admin/overview')).data.counts.agents, 1);

  const memberCreated = await admin.request('POST', '/api/admin/users', {
    email: 'member@example.com', password: 'password123', name: 'Member', role: 'member',
  });
  assert.equal(memberCreated.status, 201);
  const member = client(base);
  const loggedIn = await member.request('POST', '/api/auth/login', { email: 'member@example.com', password: 'password123' });
  assert.equal(loggedIn.status, 200);
  assert.equal((await member.request('GET', '/api/admin/overview')).status, 403);
  assert.equal((await member.request('GET', '/api/agents')).status, 200);

  // Guest chat works before any login, using only the default agent.
  const guest = client(base);
  const guestSession = await guest.request('POST', '/api/guest/session');
  assert.equal(guestSession.status, 201);
  assert.equal(guestSession.data.isGuest, true);
  assert.equal(guestSession.data.agent.id, guestAgent.id);
  const guestChat = await guest.request('POST', '/api/chat', { message: 'Hello from guest' });
  assert.equal(guestChat.status, 200);
  assert.equal(guestChat.data.reply, 'Mock answer.');
  assert.equal(guestChat.data.guest.remaining, 9);
  assert.equal((await guest.request('GET', '/api/conversations')).data.conversations.length, 1);

  // Admin-configured limit forces sign-in once reached.
  const limitSave = await admin.request('PUT', '/api/admin/guest-access', { enabled: true, basis: 'messages', limit: 1 });
  assert.equal(limitSave.status, 200);
  const guest2 = client(base);
  await guest2.request('POST', '/api/guest/session');
  const firstGuestMessage = await guest2.request('POST', '/api/chat', { message: 'one' });
  assert.equal(firstGuestMessage.status, 200);
  const blocked = await guest2.request('POST', '/api/chat', { message: 'two' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'guest_limit_reached');

  const blockedStream = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guest2.cookie },
    body: JSON.stringify({ message: 'three' }),
  });
  const blockedEvents = parseSSE(await blockedStream.text());
  assert.ok(blockedEvents.some((event) => event.event === 'error' && event.data.code === 'guest_limit_reached'));

  // Signing up discards guest history and starts fresh.
  const guest3 = client(base);
  await guest3.request('POST', '/api/guest/session');
  const guestConversation = await guest3.request('POST', '/api/chat', { message: 'before signup' });
  const guestConversationId = guestConversation.data.conversation.id;
  const signupAfterGuest = await guest3.request('POST', '/api/auth/register', {
    email: 'converted@example.com', password: 'password123', name: 'Converted', tenantName: 'Converted Org',
  });
  assert.equal(signupAfterGuest.status, 201);
  assert.equal((await guest3.request('GET', `/api/conversations/${guestConversationId}`)).status, 404);
});

function parseSSE(text) {
  return text.split('\n\n').filter(Boolean).map((block) => {
    const event = { event: 'message', data: '' };
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event.event = line.slice(6).trim();
      else if (line.startsWith('data:')) event.data += line.slice(5).trim();
    }
    event.data = JSON.parse(event.data);
    return event;
  });
}
