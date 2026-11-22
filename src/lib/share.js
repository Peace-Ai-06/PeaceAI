import { find, id, insert, now, update } from './store.js';
import { ApiError } from './http.js';
import { GUEST_COOKIE, findGuest, parseCookies, setGuestCookie } from './auth.js';

export const SHARE_BASIS = ['messages', 'sessions'];

export function agentForShareToken(token) {
  if (!token) return null;
  return find('agents', (agent) => agent.shareToken === token && agent.share?.enabled !== false) || null;
}

export function enableShare(tenantId, agentId, { limit = 10, basis = 'messages' } = {}) {
  const agent = find('agents', (item) => item.id === agentId && item.tenantId === tenantId);
  if (!agent) throw new ApiError(404, 'Agent not found', 'not_found');
  const share = {
    enabled: true,
    limit: Math.max(1, Math.min(10000, Number(limit) || 10)),
    basis: SHARE_BASIS.includes(basis) ? basis : 'messages',
  };
  const updated = update('agents', agentId, {
    share,
    shareToken: agent.shareToken || id('pub_').replace('pub_', ''),
    visibility: 'link',
  });
  return updated;
}

export function disableShare(tenantId, agentId) {
  const agent = find('agents', (item) => item.id === agentId && item.tenantId === tenantId);
  if (!agent) throw new ApiError(404, 'Agent not found', 'not_found');
  return update('agents', agentId, { share: { ...(agent.share || {}), enabled: false }, shareToken: null, visibility: 'tenant' });
}

export function publicShareAgent(agent, tenant) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    accent: agent.accent,
    tenant: { name: tenant.name, appName: tenant.branding?.appName || tenant.name, tagline: tenant.branding?.tagline || '' },
    limits: { basis: agent.share?.basis || 'messages', limit: agent.share?.limit || 10 },
  };
}

export function shareRemaining(agent, guest) {
  const config = agent.share || {};
  const basis = SHARE_BASIS.includes(config.basis) ? config.basis : 'messages';
  const limit = Math.max(1, Number(config.limit) || 10);
  const used = basis === 'sessions' ? (guest?.sessionCount || 0) : (guest?.messageCount || 0);
  return { basis, limit, used, remaining: Math.max(0, limit - used) };
}

export function assertShareAllowed(agent, guest) {
  if (agent.share?.enabled === false) throw new ApiError(403, 'This link is no longer active', 'share_disabled');
  if (!guest) throw new ApiError(401, 'Please start a shared chat', 'unauthorized');
  if (shareRemaining(agent, guest).remaining <= 0) {
    throw new ApiError(403, 'The free preview for this link has ended.', 'share_limit_reached');
  }
  return guest;
}

export function ensureShareGuest(req, res, tenant, agent) {
  const existing = findGuest(req);
  if (existing && existing.tenantId === tenant.id) return existing;
  const token = id('gst_');
  const guest = {
    id: token,
    token,
    tenantId: tenant.id,
    agentId: agent.id,
    messageCount: 0,
    sessionCount: 0,
    shared: true,
    startedAt: now(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    createdAt: now(),
  };
  insert('guests', guest);
  setGuestCookie(res, token);
  return guest;
}

export function shareGuestFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[GUEST_COOKIE];
  if (!token) return null;
  return find('guests', (guest) => guest.token === token && guest.shared === true && new Date(guest.expiresAt) > new Date());
}
