import { Router } from 'express';
import { find, id, logAudit } from '../lib/store.js';
import { requireAdmin } from '../lib/auth.js';
import { asyncHandler, ApiError } from '../lib/http.js';
import { createConversation, runChat } from '../lib/chat.js';
import { recordGuestMessage, recordGuestSession } from '../lib/guest.js';
import {
  agentForShareToken, assertShareAllowed, disableShare, enableShare,
  ensureShareGuest, publicShareAgent, shareRemaining, shareGuestFromRequest,
} from '../lib/share.js';

export const shareRouter = Router();

function context(req) {
  const agent = agentForShareToken(req.params.token);
  if (!agent) throw new ApiError(404, 'Shared agent not found', 'not_found');
  const tenant = find('tenants', (item) => item.id === agent.tenantId);
  if (!tenant) throw new ApiError(404, 'Shared agent not found', 'not_found');
  return { agent, tenant };
}

shareRouter.get('/:token', (req, res) => {
  const { agent, tenant } = context(req);
  res.json({ agent: publicShareAgent(agent, tenant), isShared: true });
});

shareRouter.post('/:token/session', (req, res) => {
  const { agent, tenant } = context(req);
  const guest = ensureShareGuest(req, res, tenant, agent);
  res.status(201).json({
    agent: publicShareAgent(agent, tenant),
    remaining: shareRemaining(agent, guest),
    isShared: true,
  });
});

async function chat(req, res, stream) {
  const { agent, tenant } = context(req);
  let guest = shareGuestFromRequest(req);
  if (!guest) guest = ensureShareGuest(req, res, tenant, agent);
  assertShareAllowed(agent, guest);

  const send = (event, data) => {
    if (!stream || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ids = { userMessageId: id('msg_'), assistantMessageId: id('msg_') };
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    send('meta', { agentId: agent.id, userMessageId: ids.userMessageId, assistantMessageId: ids.assistantMessageId });
  }

  const conversation = createConversation({
    tenantId: tenant.id,
    userId: null,
    guestToken: guest.token,
    agentId: agent.id,
  });
  guest = recordGuestSession(guest);
  const user = { id: `guest_${guest.id}`, tenantId: tenant.id, isGuest: true };
  const result = await runChat({
    tenant,
    user,
    agent,
    conversation,
    message: req.body?.message,
    attachments: [],
    stream,
    ids,
    onEvent: send,
  });
  guest = recordGuestMessage(guest, 1);
  const remaining = shareRemaining(agent, guest);
  if (stream) {
    send('done', { reply: result.reply, conversationId: conversation.id, remaining });
    res.end();
  }
  return { reply: result.reply, sources: result.sources, conversationId: conversation.id, remaining };
}

shareRouter.post('/:token/chat', asyncHandler(async (req, res) => {
  res.json(await chat(req, res, false));
}));

shareRouter.post('/:token/chat/stream', asyncHandler(async (req, res) => {
  await chat(req, res, true);
}));

export const shareAdminRouter = Router();
shareAdminRouter.use(requireAdmin);

shareAdminRouter.post('/agents/:id/share', (req, res) => {
  const agent = enableShare(req.tenant.id, req.params.id, {
    limit: req.body?.limit,
    basis: req.body?.basis,
  });
  logAudit(req.tenant.id, req.user.id, 'agent.share_enabled', { agentId: agent.id });
  res.status(201).json({
    agent,
    token: agent.shareToken,
    shareUrl: `/share/${agent.shareToken}`,
  });
});

shareAdminRouter.delete('/agents/:id/share', (req, res) => {
  disableShare(req.tenant.id, req.params.id);
  logAudit(req.tenant.id, req.user.id, 'agent.share_disabled', { agentId: req.params.id });
  res.json({ ok: true });
});
