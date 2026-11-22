import { Router } from 'express';
import { filter, find, insert, logAudit, update } from '../lib/store.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { clampNumber, fail, required } from '../lib/http.js';
import { usageFor } from '../lib/usage.js';

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

insightsRouter.get('/usage', (req, res) => {
  const since = typeof req.query.since === 'string' && !Number.isNaN(Date.parse(req.query.since))
    ? new Date(req.query.since).toISOString()
    : null;
  const userId = req.user.role === 'admin' && req.query.userId ? String(req.query.userId) : req.user.id;
  res.json(usageFor(req.tenant.id, { since, userId }));
});

export const adminInsightsRouter = Router();
adminInsightsRouter.use(requireAdmin);

adminInsightsRouter.get('/usage', (req, res) => {
  const since = typeof req.query.since === 'string' && !Number.isNaN(Date.parse(req.query.since))
    ? new Date(req.query.since).toISOString()
    : null;
  res.json(usageFor(req.tenant.id, { since, userId: req.query.userId ? String(req.query.userId) : null }));
});

adminInsightsRouter.put('/limits', (req, res) => {
  const body = req.body || {};
  const limits = {
    monthlyTokens: body.monthlyTokens === null || body.monthlyTokens === ''
      ? null : clampNumber(body.monthlyTokens, 0, 1e12, 0) || null,
    monthlyCost: body.monthlyCost === null || body.monthlyCost === ''
      ? null : clampNumber(body.monthlyCost, 0, 1e9, 0) || null,
  };
  const tenant = update('tenants', req.tenant.id, { limits });
  logAudit(req.tenant.id, req.user.id, 'tenant_limits_updated', { limits });
  res.json({ tenant });
});

adminInsightsRouter.get('/feedback', (req, res) => {
  const items = filter('feedback', (row) => row.tenantId === req.tenant.id)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, 300);
  res.json({ feedback: items });
});

adminInsightsRouter.get('/feedback/summary', (req, res) => {
  const items = filter('feedback', (row) => row.tenantId === req.tenant.id);
  const summary = { total: items.length, positive: 0, negative: 0, average: 0, byAgent: {} };
  let score = 0;
  for (const item of items) {
    score += Number(item.rating) || 0;
    if (item.rating >= 4) summary.positive += 1;
    if (item.rating <= 2) summary.negative += 1;
    const agentId = item.agentId || 'unknown';
    summary.byAgent[agentId] ||= { count: 0, total: 0 };
    summary.byAgent[agentId].count += 1;
    summary.byAgent[agentId].total += Number(item.rating) || 0;
  }
  summary.average = items.length ? Number((score / items.length).toFixed(2)) : 0;
  for (const value of Object.values(summary.byAgent)) value.average = value.count ? Number((value.total / value.count).toFixed(2)) : 0;
  res.json(summary);
});

export function feedbackRouter() {
  const router = Router();
  router.use(requireAuth);
  router.post('/', (req, res) => {
    const body = req.body || {};
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'rating must be an integer from 1 to 5', 'validation_error');
    const messageId = required(body.messageId, 'messageId');
    const conversation = find('conversations', (c) => c.id === body.conversationId && c.tenantId === req.tenant.id);
    if (!conversation) fail(404, 'Conversation not found', 'not_found');
    const item = {
      id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: req.tenant.id,
      userId: req.user?.id || null,
      conversationId: conversation.id,
      messageId,
      agentId: conversation.agentId,
      rating,
      comment: typeof body.comment === 'string' ? body.comment.slice(0, 2000) : '',
      ts: new Date().toISOString(),
    };
    insert('feedback', item);
    res.status(201).json({ feedback: item });
  });
  return router;
}
