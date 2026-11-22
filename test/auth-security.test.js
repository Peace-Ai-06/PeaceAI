import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join('/tmp/opencode', 'peaceai-auth-'));
process.env.PEACEAI_DATA_DIR = tempDir;
process.env.COOKIE_SECURE = 'false';

const script = path.resolve('scripts/create-admin.js');
const email = 'admin@example.com';
const firstPassword = 'StrongPassw0rd!';
const secondPassword = 'EvenStronger2026!';

function runScript(args = [], { password, env = {} } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    input: password === undefined ? undefined : `${password}\n`,
    env: { ...process.env, PEACEAI_DATA_DIR: tempDir, ...env },
  });
}

// The account must exist before the server imports/caches the store.
const created = runScript(['--email', email, '--name', 'Admin', '--password-stdin'], { password: firstPassword });
assert.equal(created.status, 0, `bootstrap failed: ${created.stderr}`);

const { createApp } = await import('../src/server.js');
const { clearRateLimits } = await import('../src/lib/ratelimit.js');
const { closeStore, find, initStore } = await import('../src/lib/store.js');
const { verifyPassword } = await import('../src/lib/security.js');
const { client } = await import('./helpers/mock-provider.js');

const app = createApp();
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const base = `http://127.0.0.1:${server.address().port}`;

test.beforeEach(() => clearRateLimits());
test.after(() => {
  server.close();
  closeStore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function login(password) {
  return client(base).request('POST', '/api/auth/login', { email, password });
}

test('bootstrap creates a real admin that can sign in and use admin APIs', async () => {
  const stored = find('users', (user) => user.email === email);
  assert.ok(stored, 'the admin is persisted');
  assert.equal(stored.role, 'admin');
  assert.equal(stored.isPlatformAdmin, true);
  assert.equal(stored.active, true);
  assert.notEqual(stored.passwordHash, firstPassword, 'the raw password is not stored');
  assert.equal(verifyPassword(firstPassword, stored.passwordHash), true);

  const response = await login(firstPassword);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.user.email, email);
  assert.equal(response.data.user.passwordHash, undefined, 'hash is not exposed by the API');
  assert.equal(response.data.user.role, 'admin');

  const me = await client(base);
  await me.request('POST', '/api/auth/login', { email, password: firstPassword });
  assert.equal((await me.request('GET', '/api/auth/me')).status, 200);
  assert.equal((await me.request('GET', '/api/admin/overview')).status, 200);

  const wrong = await login('NotTheRightPassword1!');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error.code, 'invalid_credentials');
});

test('duplicate bootstrap is refused; reset changes the hash and revokes sessions', async () => {
  const duplicate = runScript(['--email', email, '--password-stdin'], { password: secondPassword });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists/i);

  const reset = runScript(['--email', email, '--reset-password', '--password-stdin'], { password: secondPassword });
  assert.equal(reset.status, 0, reset.stderr);
  assert.match(reset.stdout, /revoked/i);

  // Reload the server-side store snapshot after the external process wrote to it.
  initStore();
  const stored = find('users', (user) => user.email === email);
  assert.equal(verifyPassword(firstPassword, stored.passwordHash), false);
  assert.equal(verifyPassword(secondPassword, stored.passwordHash), true);
  assert.equal((await login(firstPassword)).status, 401);
  assert.equal((await login(secondPassword)).status, 200);
});

test('tampered sessions are rejected and a password change revokes other sessions', async () => {
  const first = client(base);
  const second = client(base);
  assert.equal((await first.request('POST', '/api/auth/login', { email, password: secondPassword })).status, 200);
  assert.equal((await second.request('POST', '/api/auth/login', { email, password: secondPassword })).status, 200);

  const raw = second.cookie;
  const token = raw.split(';').find((part) => part.startsWith('peaceai_session=')).split('=')[1];
  const last = token.at(-1);
  const flipped = last === 'a' ? 'b' : 'a';
  const response = await fetch(`${base}/api/auth/me`, { headers: { Cookie: raw.replace(token, token.slice(0, -1) + flipped) } });
  assert.equal(response.status, 401, 'a modified signed cookie is not accepted');

  const changed = await second.request('POST', '/api/auth/change-password', {
    currentPassword: secondPassword,
    newPassword: 'RotatedAdmin2026#',
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal((await first.request('GET', '/api/auth/me')).status, 401, 'other sessions are revoked');
  assert.equal((await second.request('GET', '/api/auth/me')).status, 200, 'current session stays valid');
  assert.equal((await login(secondPassword)).status, 401);
  assert.equal((await login('RotatedAdmin2026#')).status, 200);
});
