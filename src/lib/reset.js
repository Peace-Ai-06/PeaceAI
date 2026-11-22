import crypto from 'node:crypto';
import { filter, find, id, insert, logAudit, now, remove, update } from './store.js';
import { hashPassword } from './security.js';
import { appBaseUrl, sendMail } from './mail.js';

function ttlMinutes() {
  const value = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30);
  return Number.isFinite(value) ? Math.min(1440, Math.max(5, value)) : 30;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Returns true only when a reset email was actually queued. Callers must not
// expose that distinction to clients (no account enumeration).
export async function requestPasswordReset(email, req) {
  const user = find('users', (item) => item.email === String(email).trim().toLowerCase() && item.active !== false);
  if (!user) return false;

  // Only the newest link for an account is valid.
  remove('passwordResets', (item) => item.userId === user.id && !item.usedAt);
  const token = crypto.randomBytes(32).toString('base64url');
  const record = {
    id: id('rst_'),
    userId: user.id,
    tenantId: user.tenantId,
    tokenHash: tokenHash(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + ttlMinutes() * 60 * 1000).toISOString(),
    usedAt: null,
  };
  insert('passwordResets', record);

  const link = `${appBaseUrl(req)}/#/reset-password?token=${encodeURIComponent(token)}`;
  const message = {
    to: user.email,
    subject: 'Reset your PeaceAi password',
    text: [
      `Hello ${user.name || 'there'},`,
      '',
      'We received a request to reset your PeaceAi password.',
      `Open this link within ${ttlMinutes()} minutes to choose a new one:`,
      link,
      '',
      'If you did not request this, you can ignore this email — your password will not change.',
    ].join('\n'),
  };

  try {
    await sendMail(message);
  } catch (error) {
    // Do not leave an undelivered token lying around.
    remove('passwordResets', (item) => item.id === record.id);
    throw error;
  }
  logAudit(user.tenantId, user.id, 'auth.password_reset_requested', { email: user.email });
  return true;
}

// Single-use: consuming a token marks every outstanding token for that user as
// used, updates the hash and revokes all sessions.
export function consumePasswordReset(token, newPassword) {
  const hash = tokenHash(token);
  const record = find('passwordResets', (item) => (
    item.tokenHash === hash && !item.usedAt && new Date(item.expiresAt) > new Date()
  ));
  if (!record) return false;
  const user = find('users', (item) => item.id === record.userId && item.active !== false);
  if (!user) return false;

  for (const outstanding of filter('passwordResets', (item) => item.userId === user.id && !item.usedAt)) {
    update('passwordResets', outstanding.id, { usedAt: now() });
  }
  update('users', user.id, { passwordHash: hashPassword(newPassword) });
  remove('sessions', (session) => session.userId === user.id);
  logAudit(user.tenantId, user.id, 'auth.password_reset_completed', { email: user.email });
  return true;
}
