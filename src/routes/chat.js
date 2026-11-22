import { Router } from 'express';
import multer from 'multer';
import { remove, update } from '../lib/store.js';
import { optionalAuth } from '../lib/auth.js';
import { asyncHandler, fail, optionalString } from '../lib/http.js';
import { assertGuestAllowed, guestConfig, recordGuestMessage, recordGuestSession } from '../lib/guest.js';
import { extractText, isSupportedFile } from '../lib/files.js';
import { id } from '../lib/store.js';
import {
  createConversation,
  getAgent,
  getConversation,
  listConversations,
  runChat,
} from '../lib/chat.js';

export const chatRouter = Router();
chatRouter.use(optionalAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    if (isSupportedFile(file.originalname)) callback(null, true);
    else callback(new Error(`Unsupported file type: ${file.originalname}`));
  },
});

function identity(req) {
  if (req.guest) {
    return {
      userId: null,
      guestToken: req.guest.token,
      actor: { id: `guest_${req.guest.id}`, tenantId: req.tenant.id },
    };
  }
  return { userId: req.user.id, guestToken: null, actor: req.user };
}

function resolveChat(req, body) {
  const { userId, guestToken } = identity(req);
  let config = null;
  let agent;
  if (req.guest) {
    config = assertGuestAllowed(req.tenant, req.guest);
    agent = config.agent;
  } else {
    agent = getAgent(req.tenant.id, body.agentId);
  }

  let conversation;
  let isNew = false;
  if (body.conversationId) {
    conversation = getConversation(req.tenant.id, userId, body.conversationId, guestToken);
    if (conversation.agentId !== agent.id) fail(400, 'This conversation belongs to a different agent', 'validation_error');
  } else {
    conversation = createConversation({ tenantId: req.tenant.id, userId, guestToken, agentId: agent.id });
    isNew = true;
    if (req.guest) req.guest = recordGuestSession(req.guest);
  }
  const message = optionalString(body.message);
  if (conversation.title === 'New conversation' && message) {
    update('conversations', conversation.id, { title: message.slice(0, 60) + (message.length > 60 ? '…' : '') });
    conversation.title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
  }
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter((item) => item && typeof item.text === 'string').slice(0, 5)
    : [];
  return { agent, conversation, message, attachments, isNew, config };
}

chatRouter.get('/conversations', (req, res) => {
  const { userId, guestToken } = identity(req);
  res.json({ conversations: listConversations(req.tenant.id, userId, req.query.agentId, guestToken) });
});

chatRouter.post('/conversations', (req, res) => {
  const { userId, guestToken } = identity(req);
  const agent = req.guest ? assertGuestAllowed(req.tenant, req.guest).agent : getAgent(req.tenant.id, req.body?.agentId);
  const conversation = createConversation({
    tenantId: req.tenant.id,
    userId,
    guestToken,
    agentId: agent.id,
    title: optionalString(req.body?.title) || 'New conversation',
  });
  if (req.guest) req.guest = recordGuestSession(req.guest);
  res.status(201).json({ conversation });
});

chatRouter.get('/conversations/:id', (req, res) => {
  const { userId, guestToken } = identity(req);
  res.json({ conversation: getConversation(req.tenant.id, userId, req.params.id, guestToken) });
});

chatRouter.delete('/conversations/:id', (req, res) => {
  const { userId, guestToken } = identity(req);
  const conversation = getConversation(req.tenant.id, userId, req.params.id, guestToken);
  remove('conversations', (c) => c.id === conversation.id);
  res.json({ ok: true });
});

chatRouter.post('/chat', asyncHandler(async (req, res) => {
  const { actor } = identity(req);
  const { agent, conversation, message, attachments } = resolveChat(req, req.body || {});
  const result = await runChat({ tenant: req.tenant, user: actor, agent, conversation, message, attachments });
  if (req.guest) req.guest = recordGuestMessage(req.guest, message ? 1 : 0);
  res.json({
    conversation: result.conversation,
    reply: result.reply,
    sources: result.sources,
    pending: result.conversation.messages.some((m) => m.role === 'assistant' && m.toolCalls?.length),
    guest: req.guest ? { remaining: Math.max(0, guestConfig(req.tenant).limit - (req.guest.messageCount || 0)) } : null,
  });
}));

chatRouter.post('/chat/stream', asyncHandler(async (req, res) => {
  const { actor } = identity(req);
  const { agent, conversation, message, attachments } = resolveChat(req, req.body || {});
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ids = { userMessageId: id('msg_'), assistantMessageId: id('msg_') };
  send('meta', { conversationId: conversation.id, userMessageId: ids.userMessageId, assistantMessageId: ids.assistantMessageId });
  try {
    const result = await runChat({ tenant: req.tenant, user: actor, agent, conversation, message, attachments, stream: true, ids, onEvent: send });
    if (req.guest) {
      req.guest = recordGuestMessage(req.guest, message ? 1 : 0);
      send('guest', { remaining: Math.max(0, guestConfig(req.tenant).limit - (req.guest.messageCount || 0)) });
    }
    send('done', { conversation: result.conversation });
  } catch (error) {
    send('error', { message: error.message || 'Something went wrong', code: error.code || 'error' });
  }
  res.end();
}));

chatRouter.post('/chat/attachments', upload.array('files', 5), asyncHandler(async (req, res) => {
  if (req.guest) assertGuestAllowed(req.tenant, req.guest);
  if (!req.files?.length) fail(400, 'Upload at least one file', 'validation_error');
  const attachments = [];
  for (const file of req.files) {
    try {
      attachments.push({ name: file.originalname, text: await extractText(file) });
    } catch (error) {
      attachments.push({ name: file.originalname, text: '', error: error.message });
    }
  }
  res.json({ attachments });
}));
