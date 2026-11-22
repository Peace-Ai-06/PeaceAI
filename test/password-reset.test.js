import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempDir = fs.mkdtempSync(path.join('/tmp/opencode', 'peaceai-reset-'));
process.env.PEACEAI_DATA_DIR = tempDir;
process.env.COOKIE_SECURE = 'false';
process.env.PEACEAI_PUBLIC_URL = 'http://peaceai.test';
process.env.PEACEAI_MAIL_TEST_HANDLER = `${pathToFileURL(path.resolve('test/helpers/mail-capture.js')).href}#captureMail`;

const capture = await import('./helpers/mail-capture.js');
const { createApp } = await import('../src/server.js');
const { clearRateLimits } = await import('../src/lib/ratelimit.js');
const { closeStore, filter, find } = await import('../src/lib/store.js');
const { verifyPassword } = await import('../src/lib/security.js');
const { client } = await import('./helpers/mock-provider.js');

const app = createApp();
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const base = `http://127.0.0.1:${server.address().port}`;
const email = 'reset@example.com';
const originalPassword = 'Password123!';

test.before(async () => {
  const admin = client(base);
  const reg = await admin.request('POST', '/api/auth/register', {
    email, password: originalPassword, name: 'Reset User', tenantName: 'Reset Space',
  });
  assert.equal(reg.status, 201);
});

test.beforeEach(() => {
  clearRateLimits();
  capture.resetMailCapture();
});

test.after(() => {
  server.close();
  closeStore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function extractToken(message) {
  const match = String(message.text).match(/token=([A-Za-z0-9_-]+)/);
  assert.ok(match, 'reset token present in email');
  return match[1];
}

test('forgot password is generic and sends a single-use token for real accounts', async () => {
  const anon = client(base);
  const missing = await anon.request('POST', '/api/auth/forgot-password', { email: 'nobody@example.com' });
  assert.equal(missing.status, 200);
  assert.match(missing.data.message, /If an account exists/);
  assert.equal(capture.sent.length, 0);

  const ok = await anon.request('POST', '/api/auth/forgot-password', { email });
  assert.equal(ok.status, 200);
  assert.equal(capture.sent.length, 1);
  assert.equal(capture.sent[0].to, email);
  const token = extractToken(capture.sent[0]);
  const resetRecord = find('passwordResets', (item) => !item.usedAt);
  assert.ok(resetRecord);
  assert.notEqual(resetRecord.tokenHash, token, 'raw token is never stored');

  const bad = await anon.request('POST', '/api/auth/reset-password', { token: 'bad-token', password: 'NewPassword123!' });
  assert.equal(bad.status, 400);

  const changed = await anon.request('POST', '/api/auth/reset-password', { token, password: 'NewPassword123!' });
  assert.equal(changed.status, 200);

  const oldLogin = await client(base).request('POST', '/api/auth/login', { email, password: originalPassword });
  assert.equal(oldLogin.status, 401);
  const newLogin = await client(base).request('POST', '/api/auth/login', { email, password: 'NewPassword123!' });
  assert.equal(newLogin.status, 200);

  const reused = await anon.request('POST', '/api/auth/reset-password', { token, password: 'AnotherPassword123!' });
  assert.equal(reused.status, 400);
});

test('reset revokes existing sessions and replaces previous unused tokens', async () => {
  const sessionA = client(base);
  const sessionB = client(base);
  assert.equal((await sessionA.request('POST', '/api/auth/login', { email, password: 'NewPassword123!' })).status, 200);
  assert.equal((await sessionB.request('POST', '/api/auth/login', { email, password: 'NewPassword123!' })).status, 200);

  const anon = client(base);
  assert.equal((await anon.request('POST', '/api/auth/forgot-password', { email })).status, 200);
  const first = extractToken(capture.sent[0]);
  assert.equal((await anon.request('POST', '/api/auth/forgot-password', { email })).status, 200);
  const second = extractToken(capture.sent[1]);
  const active = filter('passwordResets', (item) => item.userId && !item.usedAt);
  assert.equal(active.length, 1, 'only newest token remains usable');

  assert.equal((await anon.request('POST', '/api/auth/reset-password', { token: first, password: 'NewestPassword123!' })).status, 400);
  assert.equal((await anon.request('POST', '/api/auth/reset-password', { token: second, password: 'NewestPassword123!' })).status, 200);

  assert.equal((await sessionA.request('GET', '/api/auth/me')).status, 401);
  assert.equal((await sessionB.request('GET', '/api/auth/me')).status, 401);
  const login = await client(base).request('POST', '/api/auth/login', { email, password: 'NewestPassword123!' });
  assert.equal(login.status, 200);
  assert.equal(verifyPassword('NewestPassword123!', find('users', (u) => u.email === email).passwordHash), true);
});

test('mail delivery failures are logged but the forgot-password response stays generic', async () => {
  capture.setMailFailure(true);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const res = await client(base).request('POST', '/api/auth/forgot-password', { email });
    assert.equal(res.status, 200);
    assert.match(res.data.message, /If an account exists/);
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((line) => line.includes('Password reset email could not be sent')));
  assert.equal(filter('passwordResets', (item) => !item.usedAt).length, 0, 'undelivered tokens are removed');
});
