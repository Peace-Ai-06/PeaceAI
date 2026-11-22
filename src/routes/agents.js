import { Router } from 'express';
import { filter, find } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';
import { fail } from '../lib/http.js';

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

agentsRouter.get('/', (req, res) => {
  res.json({ agents: filter('agents', (agent) => agent.tenantId === req.tenant.id) });
});

agentsRouter.get('/:id', (req, res) => {
  const agent = find('agents', (a) => a.id === req.params.id && a.tenantId === req.tenant.id);
  if (!agent) fail(404, 'Agent not found', 'not_found');
  res.json({ agent });
});
