import { Router } from 'express';
import multer from 'multer';
import { all, chunkCountForDocument, deleteChunks, filter, find, id, insert, logAudit, now, remove, update } from '../lib/store.js';
import { requireAdmin, publicUser } from '../lib/auth.js';
import { asyncHandler, clampNumber, fail, optionalString, required } from '../lib/http.js';
import { encrypt, hashPassword } from '../lib/security.js';
import { sanitizeBranding } from '../lib/theme.js';
import { listModels } from '../lib/providers.js';
import { extractText, isSupportedFile } from '../lib/files.js';
import { indexDocument } from '../lib/rag.js';
import { AGENT_TEMPLATES } from '../lib/agents.js';
import { guestConfig } from '../lib/guest.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, callback) => {
    if (isSupportedFile(file.originalname)) callback(null, true);
    else callback(new Error(`Unsupported file type: ${file.originalname}`));
  },
});

function publicProvider(provider) {
  const { encryptedApiKey, ...rest } = provider;
  return { ...rest, hasApiKey: Boolean(encryptedApiKey) };
}

function providerFields(body, existing = {}) {
  const kind = existing.isBuiltIn
    ? 'local'
    : (['openai', 'anthropic', 'ollama', 'local'].includes(body.kind) ? body.kind : existing.kind);
  if (!kind) fail(400, 'A provider kind is required', 'validation_error');
  const fields = {
    name: required(body.name ?? existing.name, 'provider name'),
    kind,
    baseUrl: optionalString(body.baseUrl ?? existing.baseUrl, ''),
    enabled: body.enabled === undefined ? existing.enabled !== false : Boolean(body.enabled),
  };
  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    fields.encryptedApiKey = encrypt(body.apiKey || '');
  }
  return fields;
}

function agentFields(body, tenantId) {
  const providerId = body.providerId || null;
  if (providerId && !find('providers', (p) => p.id === providerId && p.tenantId === tenantId)) {
    fail(400, 'Selected model provider does not exist', 'validation_error');
  }
  const embeddingProviderId = body.embeddingProviderId || null;
  if (embeddingProviderId && !find('providers', (p) => p.id === embeddingProviderId && p.tenantId === tenantId)) {
    fail(400, 'Selected embedding provider does not exist', 'validation_error');
  }
  const rerankProviderId = body.rerankProviderId || null;
  if (rerankProviderId && !find('providers', (p) => p.id === rerankProviderId && p.tenantId === tenantId)) {
    fail(400, 'Selected reranker provider does not exist', 'validation_error');
  }
  const knowledgeBaseIds = Array.isArray(body.knowledgeBaseIds) ? body.knowledgeBaseIds : [];
  for (const kbId of knowledgeBaseIds) {
    if (!find('knowledgeBases', (kb) => kb.id === kbId && kb.tenantId === tenantId)) {
      fail(400, `Knowledge base ${kbId} does not exist`, 'validation_error');
    }
  }
  const validTools = ['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'run_command'];
  const enabled = Array.isArray(body.tools?.enabled) ? body.tools.enabled.filter((tool) => validTools.includes(tool)) : [];
  return {
    name: required(body.name, 'agent name'),
    description: optionalString(body.description),
    icon: optionalString(body.icon, '🤖').slice(0, 8),
    accent: /^#[0-9a-fA-F]{3,8}$/.test(String(body.accent || '')) ? String(body.accent) : '#8b7bff',
    persona: optionalString(body.persona, 'You are PeaceAi, a helpful assistant.'),
    providerId,
    model: optionalString(body.model),
    embeddingProviderId,
    embeddingModel: optionalString(body.embeddingModel),
    rerankProviderId,
    rerankModel: optionalString(body.rerankModel).slice(0, 200),
    knowledgeBaseIds,
    generation: {
      temperature: clampNumber(body.generation?.temperature, 0, 2, 0.6),
      maxTokens: Math.round(clampNumber(body.generation?.maxTokens, 128, 32000, 2048)),
    },
    tools: { enabled, approvalRequired: body.tools?.approvalRequired !== false },
    visibility: ['tenant', 'link'].includes(body.visibility) ? body.visibility : 'tenant',
  };
}

/* --------------------------------- overview --------------------------------- */

adminRouter.get('/overview', (req, res) => {
  const tenantId = req.tenant.id;
  res.json({
    counts: {
      users: filter('users', (u) => u.tenantId === tenantId).length,
      agents: filter('agents', (a) => a.tenantId === tenantId).length,
      knowledgeBases: filter('knowledgeBases', (kb) => kb.tenantId === tenantId).length,
      documents: filter('documents', (d) => d.tenantId === tenantId).length,
      conversations: filter('conversations', (c) => c.tenantId === tenantId).length,
    },
    tenant: req.tenant,
  });
});

/* -------------------------------- providers --------------------------------- */

adminRouter.get('/providers', (req, res) => {
  res.json({ providers: filter('providers', (p) => p.tenantId === req.tenant.id).map(publicProvider) });
});

adminRouter.post('/providers', asyncHandler((req, res) => {
  const fields = providerFields(req.body || {});
  const provider = insert('providers', { id: id('prv_'), tenantId: req.tenant.id, ...fields, createdAt: now() });
  logAudit(req.tenant.id, req.user.id, 'provider.create', { providerId: provider.id });
  res.status(201).json({ provider: publicProvider(provider) });
}));

adminRouter.put('/providers/:id', asyncHandler((req, res) => {
  const existing = find('providers', (p) => p.id === req.params.id && p.tenantId === req.tenant.id);
  if (!existing) fail(404, 'Provider not found', 'not_found');
  const provider = update('providers', existing.id, providerFields(req.body || {}, existing));
  logAudit(req.tenant.id, req.user.id, 'provider.update', { providerId: provider.id });
  res.json({ provider: publicProvider(provider) });
}));

adminRouter.delete('/providers/:id', (req, res) => {
  const existing = find('providers', (p) => p.id === req.params.id && p.tenantId === req.tenant.id);
  if (!existing) fail(404, 'Provider not found', 'not_found');
  if (existing.isBuiltIn) fail(400, 'The built-in PeaceAi Local provider cannot be deleted; disable it instead.', 'validation_error');
  remove('providers', (p) => p.id === existing.id);
  for (const agent of filter('agents', (a) => a.tenantId === req.tenant.id)) {
    const patch = {};
    if (agent.providerId === existing.id) patch.providerId = null;
    if (agent.embeddingProviderId === existing.id) patch.embeddingProviderId = null;
    if (Object.keys(patch).length) update('agents', agent.id, patch);
  }
  logAudit(req.tenant.id, req.user.id, 'provider.delete', { providerId: existing.id });
  res.json({ ok: true });
});

adminRouter.post('/providers/:id/test', asyncHandler(async (req, res) => {
  const provider = find('providers', (p) => p.id === req.params.id && p.tenantId === req.tenant.id);
  if (!provider) fail(404, 'Provider not found', 'not_found');
  const models = await listModels(provider);
  res.json({ ok: true, models });
}));

/* ------------------------------ knowledge bases ----------------------------- */

function publicKnowledgeBase(kb) {
  const documents = filter('documents', (doc) => doc.knowledgeBaseId === kb.id);
  return {
    ...kb,
    documentCount: documents.length,
    chunkCount: documents.reduce((sum, doc) => sum + (doc.chunkCount || 0), 0),
  };
}

adminRouter.get('/knowledge-bases', (req, res) => {
  res.json({ knowledgeBases: filter('knowledgeBases', (kb) => kb.tenantId === req.tenant.id).map(publicKnowledgeBase) });
});

adminRouter.post('/knowledge-bases', (req, res) => {
  const kb = insert('knowledgeBases', {
    id: id('kb_'),
    tenantId: req.tenant.id,
    name: required(req.body?.name, 'knowledge base name'),
    description: optionalString(req.body?.description),
    embeddingProviderId: req.body?.embeddingProviderId || null,
    embeddingModel: optionalString(req.body?.embeddingModel),
    createdAt: now(),
  });
  logAudit(req.tenant.id, req.user.id, 'knowledge_base.create', { knowledgeBaseId: kb.id });
  res.status(201).json({ knowledgeBase: publicKnowledgeBase(kb) });
});

adminRouter.delete('/knowledge-bases/:id', (req, res) => {
  const kb = find('knowledgeBases', (k) => k.id === req.params.id && k.tenantId === req.tenant.id);
  if (!kb) fail(404, 'Knowledge base not found', 'not_found');
  for (const doc of filter('documents', (doc) => doc.knowledgeBaseId === kb.id)) deleteChunks(doc.id);
  remove('documents', (doc) => doc.knowledgeBaseId === kb.id);
  remove('knowledgeBases', (k) => k.id === kb.id);
  for (const agent of filter('agents', (a) => a.tenantId === req.tenant.id)) {
    if (agent.knowledgeBaseIds?.includes(kb.id)) {
      update('agents', agent.id, { knowledgeBaseIds: agent.knowledgeBaseIds.filter((value) => value !== kb.id) });
    }
  }
  logAudit(req.tenant.id, req.user.id, 'knowledge_base.delete', { knowledgeBaseId: kb.id });
  res.json({ ok: true });
});

adminRouter.get('/knowledge-bases/:id/documents', (req, res) => {
  const kb = find('knowledgeBases', (k) => k.id === req.params.id && k.tenantId === req.tenant.id);
  if (!kb) fail(404, 'Knowledge base not found', 'not_found');
  res.json({
    documents: filter('documents', (doc) => doc.knowledgeBaseId === kb.id).map((doc) => ({
      ...doc,
      chunkCount: doc.chunkCount || 0,
    })),
  });
});

adminRouter.post('/knowledge-bases/:id/documents', upload.array('files', 10), asyncHandler(async (req, res) => {
  const kb = find('knowledgeBases', (k) => k.id === req.params.id && k.tenantId === req.tenant.id);
  if (!kb) fail(404, 'Knowledge base not found', 'not_found');
  if (!req.files?.length) fail(400, 'Upload at least one file', 'validation_error');
  const agents = filter('agents', (a) => a.tenantId === req.tenant.id && a.knowledgeBaseIds?.includes(kb.id));
  const embedAgent = agents[0] || { embeddingProviderId: kb.embeddingProviderId, embeddingModel: kb.embeddingModel };
  const documents = [];
  for (const file of req.files) {
    const document = {
      id: id('doc_'),
      tenantId: req.tenant.id,
      knowledgeBaseId: kb.id,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      chunkCount: 0,
      status: 'processing',
      createdAt: now(),
    };
    insert('documents', document);
    try {
      const text = await extractText(file);
      document.chunkCount = await indexDocument(req.tenant.id, kb.id, document, text, embedAgent);
      document.status = 'ready';
    } catch (error) {
      document.status = 'error';
      document.error = error.message;
    }
    update('documents', document.id, { chunkCount: document.chunkCount, status: document.status, error: document.error });
    documents.push({ ...document });
  }
  logAudit(req.tenant.id, req.user.id, 'document.upload', { knowledgeBaseId: kb.id, count: documents.length });
  res.status(201).json({ documents });
}));

adminRouter.delete('/knowledge-bases/:id/documents/:docId', (req, res) => {
  const doc = find('documents', (d) => d.id === req.params.docId && d.knowledgeBaseId === req.params.id && d.tenantId === req.tenant.id);
  if (!doc) fail(404, 'Document not found', 'not_found');
  deleteChunks(doc.id);
  remove('documents', (d) => d.id === doc.id);
  logAudit(req.tenant.id, req.user.id, 'document.delete', { documentId: doc.id });
  res.json({ ok: true });
});

/* ---------------------------------- agents ---------------------------------- */

adminRouter.get('/agents', (req, res) => {
  res.json({ agents: filter('agents', (a) => a.tenantId === req.tenant.id) });
});

adminRouter.post('/agents', (req, res) => {
  const agent = insert('agents', { id: id('agt_'), tenantId: req.tenant.id, ...agentFields(req.body || {}, req.tenant.id), createdBy: req.user.id, createdAt: now() });
  logAudit(req.tenant.id, req.user.id, 'agent.create', { agentId: agent.id });
  res.status(201).json({ agent });
});

adminRouter.put('/agents/:id', (req, res) => {
  const existing = find('agents', (a) => a.id === req.params.id && a.tenantId === req.tenant.id);
  if (!existing) fail(404, 'Agent not found', 'not_found');
  const agent = update('agents', existing.id, agentFields(req.body || {}, req.tenant.id));
  logAudit(req.tenant.id, req.user.id, 'agent.update', { agentId: agent.id });
  res.json({ agent });
});

adminRouter.delete('/agents/:id', (req, res) => {
  const existing = find('agents', (a) => a.id === req.params.id && a.tenantId === req.tenant.id);
  if (!existing) fail(404, 'Agent not found', 'not_found');
  remove('agents', (a) => a.id === existing.id);
  logAudit(req.tenant.id, req.user.id, 'agent.delete', { agentId: existing.id });
  res.json({ ok: true });
});

/* ---------------------------------- users ----------------------------------- */

adminRouter.get('/users', (req, res) => {
  res.json({ users: filter('users', (u) => u.tenantId === req.tenant.id).map(publicUser) });
});

adminRouter.post('/users', (req, res) => {
  const email = required(req.body?.email, 'email').toLowerCase();
  const password = required(req.body?.password, 'password');
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email address', 'validation_error');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters', 'validation_error');
  if (find('users', (u) => u.email === email)) fail(409, 'An account with that email already exists', 'conflict');
  const user = insert('users', {
    id: id('usr_'),
    tenantId: req.tenant.id,
    email,
    name: required(req.body?.name, 'name'),
    passwordHash: hashPassword(password),
    role: ['admin', 'member'].includes(req.body?.role) ? req.body.role : 'member',
    isPlatformAdmin: false,
    active: true,
    theme: {},
    createdAt: now(),
  });
  logAudit(req.tenant.id, req.user.id, 'user.create', { userId: user.id });
  res.status(201).json({ user: publicUser(user) });
});

adminRouter.put('/users/:id', (req, res) => {
  const existing = find('users', (u) => u.id === req.params.id && u.tenantId === req.tenant.id);
  if (!existing) fail(404, 'User not found', 'not_found');
  const patch = {};
  if (req.body?.name !== undefined) patch.name = required(req.body.name, 'name');
  if (req.body?.role !== undefined) {
    if (!['admin', 'member'].includes(req.body.role)) fail(400, 'Invalid role', 'validation_error');
    if (existing.id === req.user.id && req.body.role !== 'admin'
      && filter('users', (u) => u.tenantId === req.tenant.id && u.role === 'admin').length <= 1) {
      fail(400, 'A workspace needs at least one admin', 'validation_error');
    }
    patch.role = req.body.role;
  }
  if (req.body?.active !== undefined) {
    if (existing.id === req.user.id && req.body.active === false) fail(400, 'You cannot disable your own account', 'validation_error');
    patch.active = Boolean(req.body.active);
  }
  const user = update('users', existing.id, patch);
  logAudit(req.tenant.id, req.user.id, 'user.update', { userId: user.id });
  res.json({ user: publicUser(user) });
});

adminRouter.delete('/users/:id', (req, res) => {
  const existing = find('users', (u) => u.id === req.params.id && u.tenantId === req.tenant.id);
  if (!existing) fail(404, 'User not found', 'not_found');
  if (existing.id === req.user.id) fail(400, 'You cannot delete your own account', 'validation_error');
  if (existing.role === 'admin' && filter('users', (u) => u.tenantId === req.tenant.id && u.role === 'admin').length <= 1) {
    fail(400, 'A workspace needs at least one admin', 'validation_error');
  }
  remove('users', (u) => u.id === existing.id);
  remove('sessions', (s) => s.userId === existing.id);
  logAudit(req.tenant.id, req.user.id, 'user.delete', { userId: existing.id });
  res.json({ ok: true });
});

/* -------------------------------- branding ---------------------------------- */

adminRouter.put('/branding', (req, res) => {
  const tenant = update('tenants', req.tenant.id, { branding: sanitizeBranding(req.body?.branding || {}) });
  logAudit(req.tenant.id, req.user.id, 'tenant.branding', {});
  res.json({ tenant });
});

/* ------------------------------- guest access -------------------------------- */

adminRouter.get('/guest-access', (req, res) => {
  const config = guestConfig(req.tenant);
  res.json({
    guestAccess: { enabled: config.enabled, basis: config.basis, limit: config.limit, agentId: config.agentId },
    agent: config.agent,
  });
});

adminRouter.put('/guest-access', (req, res) => {
  const body = req.body || {};
  const current = req.tenant.guestAccess || {};
  const basis = ['messages', 'sessions', 'minutes'].includes(body.basis) ? body.basis : (current.basis || 'messages');
  const limit = Math.round(clampNumber(body.limit, 1, 10000, current.limit || 10));
  const agentId = body.agentId || current.agentId || null;
  if (agentId && !find('agents', (a) => a.id === agentId && a.tenantId === req.tenant.id)) {
    fail(400, 'Selected guest agent does not exist', 'validation_error');
  }
  const guestAccess = { enabled: body.enabled === undefined ? current.enabled !== false : Boolean(body.enabled), basis, limit, agentId };
  const tenant = update('tenants', req.tenant.id, { guestAccess });
  req.tenant.guestAccess = guestAccess;
  logAudit(req.tenant.id, req.user.id, 'tenant.guest_access', guestAccess);
  res.json({ guestAccess, tenant });
});

/* ---------------------------------- audit ----------------------------------- */

adminRouter.get('/audit', (req, res) => {
  res.json({ entries: filter('audit', (entry) => entry.tenantId === req.tenant.id).slice(-200).reverse() });
});

/* -------------------------------- templates --------------------------------- */

adminRouter.get('/templates', (req, res) => {
  res.json({ templates: AGENT_TEMPLATES });
});

export const templatesRouter = Router();
templatesRouter.get('/', requireAdmin, (_req, res) => {
  res.json({ templates: AGENT_TEMPLATES });
});
