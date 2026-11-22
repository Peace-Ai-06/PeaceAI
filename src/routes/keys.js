import { Router } from 'express';
import { filter, logAudit } from '../lib/store.js';
import { requireAdmin } from '../lib/auth.js';
import { API_KEY_SCOPES, createApiKey, publicApiKey, revokeApiKey } from '../lib/apikeys.js';

export const keysRouter = Router();
keysRouter.use(requireAdmin);

keysRouter.get('/', (req, res) => {
  res.json({
    apiKeys: filter('apiKeys', (key) => key.tenantId === req.tenant.id).map(publicApiKey),
    scopes: API_KEY_SCOPES,
  });
});

keysRouter.post('/', (req, res) => {
  const body = req.body || {};
  const scopes = Array.isArray(body.scopes) && body.scopes.length
    ? body.scopes.filter((scope) => API_KEY_SCOPES.includes(scope))
    : API_KEY_SCOPES;
  const { apiKey, token } = createApiKey({
    tenantId: req.tenant.id,
    name: body.name,
    scopes,
    createdBy: req.user.id,
  });
  logAudit(req.tenant.id, req.user.id, 'api_key_created', { keyId: apiKey.id, scopes });
  res.status(201).json({ apiKey, token });
});

keysRouter.delete('/:id', (req, res) => {
  revokeApiKey(req.tenant.id, req.params.id);
  logAudit(req.tenant.id, req.user.id, 'api_key_revoked', { keyId: req.params.id });
  res.json({ ok: true });
});
