import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, fail, required } from '../lib/http.js';
import { find } from '../lib/store.js';
import { executeToolCall, pendingForUser, resolveApproval } from '../lib/tools.js';
import { continueAfterApprovals, getAgent, getConversation } from '../lib/chat.js';
import { tenantWorkspace } from '../lib/store.js';
import { resolveSafe } from '../lib/tools.js';

export const toolsRouter = Router();
toolsRouter.use(requireAuth);

const sandboxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 20 } });

toolsRouter.post('/:agentId/files', sandboxUpload.array('files', 20), (req, res) => {
  getAgent(req.tenant.id, req.params.agentId);
  if (!req.files?.length) fail(400, 'Upload at least one file', 'validation_error');
  const root = tenantWorkspace(req.tenant.id);
  const targetDir = resolveSafe(root, String(req.body?.path || '.'));
  fs.mkdirSync(targetDir, { recursive: true });
  const saved = [];
  for (const file of req.files) {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || safeName.startsWith('.')) continue;
    const target = path.join(targetDir, safeName);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) continue;
    fs.writeFileSync(target, file.buffer);
    saved.push({ name: path.relative(root, target), size: file.size });
  }
  res.status(201).json({ files: saved });
});

toolsRouter.get('/:agentId/files', (req, res) => {
  getAgent(req.tenant.id, req.params.agentId);
  const root = tenantWorkspace(req.tenant.id);
  const relative = String(req.query.path || '.');
  const target = resolveSafe(root, relative);
  const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, 300).map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? 'dir' : 'file',
    size: entry.isFile() ? fs.statSync(path.join(target, entry.name)).size : 0,
  }));
  res.json({ cwd: root, path: relative, entries });
});

toolsRouter.get('/pending', (req, res) => {
  res.json({ pending: pendingForUser(req.tenant.id, req.user.id) });
});

toolsRouter.post('/approve', asyncHandler(async (req, res) => {
  const token = required(req.body?.token, 'approval token');
  const action = req.body?.action === 'deny' ? 'deny' : 'approve';
  const { pending, result: deniedResult } = resolveApproval(token, action, req.user);
  let result = deniedResult;
  if (action === 'approve') result = await executeToolCall(req.tenant.id, pending.toolCall);

  let conversation = null;
  let reply;
  try {
    conversation = getConversation(req.tenant.id, req.user.id, pending.conversationId);
    const continuation = await continueAfterApprovals({
      tenant: req.tenant,
      user: req.user,
      conversation,
      results: [{ call: pending.toolCall, result }],
    });
    conversation = continuation.conversation;
    reply = continuation.reply;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  res.json({
    ok: result.ok,
    result,
    pending: pendingForUser(req.tenant.id, req.user.id),
    ...(reply !== undefined ? { reply } : {}),
    ...(conversation ? { conversation } : {}),
  });
}));
