import { Router } from 'express';
import { db, ensureGuestDefaults as seedGuestDefaults, find, filter, id, insert, logAudit, now, remove, update } from '../lib/store.js';
import { hashPassword, verifyPassword } from '../lib/security.js';
import { clearGuest, createSession, publicTenant, publicUser, requireAuth, SESSION_COOKIE } from '../lib/auth.js';
import { asyncHandler, fail, required } from '../lib/http.js';
import { DEFAULT_BRANDING, DEFAULT_THEME, sanitizeTheme, slugify } from '../lib/theme.js';

export const authRouter = Router();

authRouter.post('/register', asyncHandler((req, res) => {
  const email = required(req.body?.email, 'email').toLowerCase();
  const password = required(req.body?.password, 'password');
  const name = required(req.body?.name, 'name');
  const tenantName = required(req.body?.tenantName, 'workspace name');
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email address', 'validation_error');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters', 'validation_error');
  if (find('users', (u) => u.email === email)) fail(409, 'An account with that email already exists', 'conflict');

  const isFirst = filter('users', () => true).length === 0;
  const guestWorkspace = find('tenants', (t) => t.id === db().meta.guestTenantId);
  const claimGuestWorkspace = isFirst && guestWorkspace && filter('users', (u) => u.tenantId === guestWorkspace.id).length === 0;
  const tenant = claimGuestWorkspace
    ? update('tenants', guestWorkspace.id, {
      name: tenantName,
      branding: { ...DEFAULT_BRANDING, appName: tenantName },
    })
    : insert('tenants', {
      id: id('ten_'),
      name: tenantName,
      slug: slugify(tenantName) + '-' + Math.random().toString(36).slice(2, 6),
      branding: { ...DEFAULT_BRANDING, appName: tenantName },
      createdAt: now(),
    });
  const user = {
    id: id('usr_'),
    tenantId: tenant.id,
    email,
    name,
    passwordHash: hashPassword(password),
    role: 'admin',
    isPlatformAdmin: isFirst,
    active: true,
    theme: { ...DEFAULT_THEME },
    createdAt: now(),
  };
  insert('users', user);
  seedGuestDefaults();
  clearGuest(req, res);
  createSession(res, user.id);
  logAudit(tenant.id, user.id, 'auth.register', { email });
  res.status(201).json({ user: publicUser(user), tenant });
}));

authRouter.post('/login', asyncHandler((req, res) => {
  const email = required(req.body?.email, 'email').toLowerCase();
  const password = required(req.body?.password, 'password');
  const user = find('users', (u) => u.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) fail(401, 'Invalid email or password', 'invalid_credentials');
  if (user.active === false) fail(403, 'This account has been disabled', 'account_disabled');
  const tenant = find('tenants', (t) => t.id === user.tenantId);
  if (!tenant) fail(401, 'Workspace unavailable', 'unauthorized');
  clearGuest(req, res);
  createSession(res, user.id);
  logAudit(tenant.id, user.id, 'auth.login', {});
  res.json({ user: publicUser(user), tenant: publicTenant(tenant) });
}));

authRouter.post('/logout', requireAuth, asyncHandler((req, res) => {
  remove('sessions', (s) => s.token === req.session.token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), tenant: publicTenant(req.tenant) });
});

authRouter.post('/change-password', requireAuth, asyncHandler((req, res) => {
  const current = required(req.body?.currentPassword, 'current password');
  const next = required(req.body?.newPassword, 'new password');
  if (!verifyPassword(current, req.user.passwordHash)) fail(400, 'Current password is incorrect', 'validation_error');
  if (next.length < 8) fail(400, 'New password must be at least 8 characters', 'validation_error');
  update('users', req.user.id, { passwordHash: hashPassword(next) });
  logAudit(req.tenant.id, req.user.id, 'auth.change_password', {});
  res.json({ ok: true });
}));

const applyTheme = (req, res) => {
  const theme = sanitizeTheme(req.body?.theme || {});
  const user = update('users', req.user.id, { theme });
  res.json({ user: publicUser(user) });
};

authRouter.put('/me/theme', requireAuth, applyTheme);

export const meRouter = Router();
meRouter.put('/theme', requireAuth, applyTheme);
