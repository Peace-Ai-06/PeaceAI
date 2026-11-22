import { Router } from 'express';
import { find } from '../lib/store.js';
import { ensureGuest, optionalAuth } from '../lib/auth.js';
import { ApiError } from '../lib/http.js';
import { guestConfig, publicGuest } from '../lib/guest.js';

export const guestRouter = Router();

guestRouter.post('/session', (req, res) => {
  const guest = ensureGuest(req, res);
  const tenant = find('tenants', (t) => t.id === guest.tenantId);
  const config = guestConfig(tenant);
  res.status(201).json({
    guest: publicGuest(guest, tenant),
    tenant,
    agent: config.agent,
    isGuest: true,
  });
});

guestRouter.get('/me', optionalAuth, (req, res) => {
  if (!req.guest) throw new ApiError(400, 'You are signed in, not in guest mode', 'not_guest');
  const config = guestConfig(req.tenant);
  res.json({
    guest: publicGuest(req.guest, req.tenant),
    tenant: req.tenant,
    agent: config.agent,
    isGuest: true,
  });
});

guestRouter.get('/limit', optionalAuth, (req, res) => {
  if (!req.guest) throw new ApiError(400, 'You are signed in, not in guest mode', 'not_guest');
  const info = publicGuest(req.guest, req.tenant);
  res.json({ guest: info, remaining: info.remaining });
});
