import { Router } from 'express';
import { db, ensureGuestDefaults as seedGuestDefaults, filter, id, insert, now, save } from '../lib/store.js';
import { requirePlatformAdmin } from '../lib/auth.js';
import { fail, required } from '../lib/http.js';
import { DEFAULT_BRANDING, slugify } from '../lib/theme.js';

export const platformRouter = Router();
platformRouter.use(requirePlatformAdmin);

platformRouter.get('/settings', (_req, res) => {
  res.json({ guestTenantId: db().meta.guestTenantId || null });
});

platformRouter.get('/tenants', (_req, res) => {
  res.json({ tenants: filter('tenants', () => true) });
});

platformRouter.post('/tenants', (req, res) => {
  const name = required(req.body?.name, 'workspace name');
  const tenant = insert('tenants', {
    id: id('ten_'),
    name,
    slug: slugify(name) + '-' + Math.random().toString(36).slice(2, 6),
    branding: { ...DEFAULT_BRANDING, appName: name },
    createdAt: now(),
  });
  seedGuestDefaults();
  res.status(201).json({ tenant });
});

platformRouter.put('/guest-tenant', (req, res) => {
  const tenantId = required(req.body?.tenantId, 'tenantId');
  const tenant = filter('tenants', () => true).find((item) => item.id === tenantId);
  if (!tenant) fail(404, 'Workspace not found', 'not_found');
  db().meta.guestTenantId = tenantId;
  save();
  res.json({ tenant, guestTenantId: tenantId });
});

platformRouter.get('/audit', (_req, res) => {
  res.json({ entries: filter('audit', () => true).slice(-300).reverse() });
});
