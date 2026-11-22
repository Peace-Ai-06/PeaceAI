import { find, update } from './store.js';
import { ApiError } from './http.js';
import { db } from './store.js';

export const GUEST_BASES = ['messages', 'sessions', 'minutes'];

export function guestConfig(tenant) {
  const config = tenant?.guestAccess || { enabled: true, basis: 'messages', limit: 10, agentId: null };
  const agent = config.agentId ? find('agents', (a) => a.id === config.agentId && a.tenantId === tenant.id) : null;
  return {
    enabled: config.enabled !== false,
    basis: GUEST_BASES.includes(config.basis) ? config.basis : 'messages',
    limit: Number(config.limit) || 10,
    agentId: agent?.id || null,
    agent,
  };
}

export function guestUsage(guest) {
  const elapsedMinutes = Math.floor((Date.now() - new Date(guest.startedAt).getTime()) / 60000);
  return { messages: guest.messageCount || 0, sessions: guest.sessionCount || 0, minutes: Math.max(0, elapsedMinutes) };
}

export function guestRemaining(tenant, guest) {
  const config = guestConfig(tenant);
  const usage = guestUsage(guest);
  const remaining = Math.max(0, config.limit - usage[config.basis]);
  return { enabled: config.enabled, basis: config.basis, limit: config.limit, used: usage[config.basis], remaining };
}

export function assertGuestAllowed(tenant, guest) {
  if (!guest) throw new ApiError(401, 'Please sign in to continue', 'unauthorized');
  const config = guestConfig(tenant);
  if (!config.enabled) throw new ApiError(403, 'Guest chat is disabled for this workspace', 'guest_disabled');
  if (!config.agent) throw new ApiError(503, 'The guest assistant has not been configured yet', 'guest_agent_unconfigured');
  const { remaining } = guestRemaining(tenant, guest);
  if (remaining <= 0) {
    throw new ApiError(403, 'You have reached the guest chat limit. Sign in to keep chatting.', 'guest_limit_reached');
  }
  return config;
}

export function recordGuestMessage(guest, count = 1) {
  return update('guests', guest.id, { messageCount: (guest.messageCount || 0) + count });
}

export function recordGuestSession(guest) {
  return update('guests', guest.id, { sessionCount: (guest.sessionCount || 0) + 1 });
}

export function publicGuest(guest, tenant) {
  if (!guest) return null;
  return { token: guest.token, ...guestRemaining(tenant, guest), startedAt: guest.startedAt };
}

export function guestTenantId() {
  return db().meta.guestTenantId || null;
}
