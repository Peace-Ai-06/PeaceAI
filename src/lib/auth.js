import { db, filter, find, insert, now, remove } from './store.js';
import { randomToken, sign } from './security.js';
import { ApiError } from './http.js';

export const SESSION_COOKIE = 'peaceai_session';
export const GUEST_COOKIE = 'peaceai_guest';

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function setSessionCookie(res, token) {
  const maxAge = Number(process.env.SESSION_HOURS || 168) * 3600 * 1000;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.HTTPS === 'true',
    maxAge,
  });
}

export function setGuestCookie(res, token) {
  res.cookie(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.HTTPS === 'true',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function guestTenant() {
  const state = db();
  const tenant = find('tenants', (t) => t.id === state.meta.guestTenantId) || state.tenants[0];
  return tenant || null;
}

export function findGuest(req) {
  const token = parseCookies(req.headers.cookie)[GUEST_COOKIE];
  if (!token) return null;
  const guest = find('guests', (g) => g.token === token && new Date(g.expiresAt) > new Date());
  if (!guest) return null;
  const tenant = find('tenants', (t) => t.id === guest.tenantId);
  if (!tenant) return null;
  return guest;
}

export function ensureGuest(req, res) {
  const existing = findGuest(req);
  if (existing) return existing;
  const tenant = guestTenant();
  if (!tenant) throw new ApiError(503, 'No workspace is available for guest chat yet', 'guest_unavailable');
  const token = randomToken(24);
  const guest = {
    id: token,
    token,
    tenantId: tenant.id,
    agentId: tenant.guestAccess?.agentId || null,
    messageCount: 0,
    sessionCount: 0,
    startedAt: now(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    createdAt: now(),
  };
  insert('guests', guest);
  setGuestCookie(res, token);
  return guest;
}

export function clearGuest(req, res) {
  const guest = findGuest(req);
  if (guest) {
    remove('guests', (g) => g.id === guest.id);
    remove('conversations', (c) => c.guestToken === guest.token);
  }
  res.clearCookie(GUEST_COOKIE);
}

export function createSession(res, userId) {
  const token = `${userId}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
  insert('sessions', {
    id: token,
    token,
    userId,
    signature: sign(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + Number(process.env.SESSION_HOURS || 168) * 3600 * 1000).toISOString(),
  });
  setSessionCookie(res, token);
  return token;
}

export function requireAuth(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return next(new ApiError(401, 'Please sign in to continue', 'unauthorized'));
  const session = find('sessions', (s) => s.token === token);
  if (!session || session.signature !== sign(token) || new Date(session.expiresAt) < new Date()) {
    return next(new ApiError(401, 'Your session has expired', 'unauthorized'));
  }
  const user = find('users', (u) => u.id === session.userId && u.active !== false);
  if (!user) return next(new ApiError(401, 'Account unavailable', 'unauthorized'));
  const tenant = find('tenants', (t) => t.id === user.tenantId);
  if (!tenant) return next(new ApiError(401, 'Workspace unavailable', 'unauthorized'));
  req.session = session;
  req.user = user;
  req.tenant = tenant;
  next();
}

export function optionalAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const session = find('sessions', (s) => s.token === token);
    if (session && session.signature === sign(token) && new Date(session.expiresAt) >= new Date()) {
      const user = find('users', (u) => u.id === session.userId && u.active !== false);
      const tenant = user && find('tenants', (t) => t.id === user.tenantId);
      if (user && tenant) {
        req.session = session;
        req.user = user;
        req.guest = null;
        req.tenant = tenant;
        return next();
      }
    }
  }
  const guest = findGuest(req);
  if (guest) {
    const tenant = find('tenants', (t) => t.id === guest.tenantId);
    if (tenant) {
      req.user = null;
      req.guest = guest;
      req.tenant = tenant;
      return next();
    }
  }
  return next(new ApiError(401, 'Please start a guest chat or sign in', 'unauthorized'));
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (req.user.role !== 'admin') return next(new ApiError(403, 'Admin access required', 'forbidden'));
    next();
  });
}

export function requirePlatformAdmin(req, res, next) {
  requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (!req.user.isPlatformAdmin) return next(new ApiError(403, 'Platform admin access required', 'forbidden'));
    next();
  });
}

export function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export function publicTenant(tenant) {
  const { ...rest } = tenant;
  return rest;
}
