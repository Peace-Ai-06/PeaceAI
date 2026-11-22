import crypto from 'node:crypto';
import { db, find, now, remove, update } from './store.js';
import { ApiError } from './http.js';

export const API_KEY_SCOPES = ['chat', 'agents', 'mcp'];

export function hashKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function publicApiKey(key) {
  const { hash, ...rest } = key;
  return rest;
}

export function createApiKey({ tenantId, name, scopes = API_KEY_SCOPES, createdBy = null }) {
  const token = `pk_live_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = token.slice(0, 12);
  const key = {
    id: `key_${crypto.randomBytes(8).toString('hex')}`,
    tenantId,
    name: String(name || 'API key').slice(0, 80),
    prefix,
    last4: token.slice(-4),
    hash: hashKey(token),
    scopes: API_KEY_SCOPES.filter((scope) => scopes.includes(scope)),
    active: true,
    createdBy,
    createdAt: now(),
    lastUsedAt: null,
  };
  db().apiKeys.push(key);
  return { apiKey: publicApiKey(key), token };
}

export function verifyApiKey(token) {
  if (typeof token !== 'string' || !token.startsWith('pk_live_')) return null;
  const key = find('apiKeys', (item) => item.prefix === token.slice(0, 12) && item.hash === hashKey(token));
  if (!key || key.active === false) return null;
  update('apiKeys', key.id, { lastUsedAt: now() });
  return key;
}

export function requireApiKey(req, _res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const key = verifyApiKey(token);
  if (!key) return next(new ApiError(401, 'A valid API key is required', 'invalid_api_key'));
  const tenant = find('tenants', (item) => item.id === key.tenantId);
  if (!tenant) return next(new ApiError(401, 'Workspace unavailable', 'unauthorized'));
  req.apiKey = key;
  req.tenant = tenant;
  req.user = { id: key.createdBy || `apikey_${key.id}`, apiKeyId: key.id, tenantId: tenant.id };
  return next();
}

export function requireScope(scope) {
  return (req, _res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) {
      return next(new ApiError(403, `This API key cannot use the ${scope} scope`, 'insufficient_scope'));
    }
    return next();
  };
}

export function revokeApiKey(tenantId, keyId) {
  const key = find('apiKeys', (item) => item.id === keyId && item.tenantId === tenantId);
  if (!key) throw new ApiError(404, 'API key not found', 'not_found');
  remove('apiKeys', (item) => item.id === keyId);
  return key;
}
