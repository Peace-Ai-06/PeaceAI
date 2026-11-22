import { Router } from 'express';
import { id, insert, logAudit, now, remove, update } from '../lib/store.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { asyncHandler, fail, optionalString, required } from '../lib/http.js';
import { findWorkflow, publicWorkflow, runWorkflow, workflowsFor } from '../lib/workflows.js';
import { getAgent } from '../lib/chat.js';
import { assertBudget } from '../lib/usage.js';

export const workflowsAdminRouter = Router();
workflowsAdminRouter.use(requireAdmin);

function workflowFields(body, tenantId, existing = {}) {
  const name = required(body.name ?? existing.name, 'workflow name');
  const rawSteps = body.steps ?? existing.steps ?? [];
  if (!Array.isArray(rawSteps) || !rawSteps.length) fail(400, 'At least one step is required', 'validation_error');
  const steps = rawSteps.slice(0, 8).map((step) => {
    const agentId = required(step?.agentId, 'step agentId');
    getAgent(tenantId, agentId);
    return { agentId, instruction: optionalString(step.instruction).slice(0, 1000) };
  });
  return {
    name,
    description: optionalString(body.description ?? existing.description).slice(0, 1000),
    steps,
    enabled: body.enabled === undefined ? existing.enabled !== false : Boolean(body.enabled),
  };
}

workflowsAdminRouter.get('/', (req, res) => {
  res.json({ workflows: workflowsFor(req.tenant.id).map(publicWorkflow) });
});

workflowsAdminRouter.post('/', (req, res) => {
  const workflow = insert('workflows', {
    id: id('wfl_'),
    tenantId: req.tenant.id,
    createdBy: req.user.id,
    createdAt: now(),
    ...workflowFields(req.body || {}, req.tenant.id),
  });
  logAudit(req.tenant.id, req.user.id, 'workflow.create', { workflowId: workflow.id });
  res.status(201).json({ workflow: publicWorkflow(workflow) });
});

workflowsAdminRouter.put('/:id', (req, res) => {
  const existing = findWorkflow(req.tenant.id, req.params.id);
  if (!existing) fail(404, 'Workflow not found', 'not_found');
  const updated = update('workflows', existing.id, workflowFields(req.body || {}, req.tenant.id, existing));
  logAudit(req.tenant.id, req.user.id, 'workflow.update', { workflowId: existing.id });
  res.json({ workflow: publicWorkflow(updated) });
});

workflowsAdminRouter.delete('/:id', (req, res) => {
  const existing = findWorkflow(req.tenant.id, req.params.id);
  if (!existing) fail(404, 'Workflow not found', 'not_found');
  remove('workflows', (item) => item.id === existing.id);
  logAudit(req.tenant.id, req.user.id, 'workflow.delete', { workflowId: existing.id });
  res.json({ ok: true });
});

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

workflowsRouter.get('/', (req, res) => {
  res.json({ workflows: workflowsFor(req.tenant.id).filter((item) => item.enabled !== false).map(publicWorkflow) });
});

workflowsRouter.get('/:id', (req, res) => {
  const workflow = findWorkflow(req.tenant.id, req.params.id);
  if (!workflow) fail(404, 'Workflow not found', 'not_found');
  res.json({ workflow: publicWorkflow(workflow) });
});

workflowsRouter.post('/:id/run', asyncHandler(async (req, res) => {
  const workflow = findWorkflow(req.tenant.id, req.params.id);
  if (!workflow || workflow.enabled === false) fail(404, 'Workflow not found', 'not_found');
  assertBudget(req.tenant);
  const result = await runWorkflow({ tenant: req.tenant, user: req.user, workflow, message: req.body?.message });
  res.json(result);
}));

workflowsRouter.post('/:id/run/stream', asyncHandler(async (req, res) => {
  const workflow = findWorkflow(req.tenant.id, req.params.id);
  if (!workflow || workflow.enabled === false) fail(404, 'Workflow not found', 'not_found');
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    assertBudget(req.tenant);
    const result = await runWorkflow({
      tenant: req.tenant, user: req.user, workflow, message: req.body?.message, stream: true, onEvent: send,
    });
    send('done', result);
  } catch (error) {
    send('error', { message: error.message, code: error.code || 'workflow_error' });
  }
  res.end();
}));
