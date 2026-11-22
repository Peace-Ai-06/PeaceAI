import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.cwd(), process.env.PEACEAI_DATA_DIR || './data');
const legacyFile = path.join(dataDir, 'db.json');
const sqliteFile = path.join(dataDir, 'peaceai.sqlite');
const workspacesDir = path.join(dataDir, 'workspaces');

const COLLECTIONS = [
  'tenants', 'users', 'sessions', 'guests', 'providers', 'knowledgeBases',
  'documents', 'agents', 'conversations', 'pendingApprovals', 'audit',
  'usage', 'feedback', 'apiKeys', 'workflows', 'passwordResets',
];

const EMPTY_META = { version: 5, createdAt: new Date().toISOString(), guestTenantId: null };

let state = null;
let sql = null;
let upsertRecord = null;
let deleteRecord = null;
let snapshots = new Map();

export function id(prefix = '') {
  return prefix + crypto.randomBytes(12).toString('hex');
}

export function now() {
  return new Date().toISOString();
}

function openDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspacesDir, { recursive: true });
  sql = new DatabaseSync(sqliteFile);
  sql.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS records_collection ON records(collection);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      documentId TEXT,
      knowledgeBaseId TEXT,
      idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      vector TEXT,
      embeddingModel TEXT,
      section TEXT
    );
    CREATE INDEX IF NOT EXISTS chunks_tenant ON chunks(tenantId);
    CREATE INDEX IF NOT EXISTS chunks_document ON chunks(documentId);
  `);
  upsertRecord = sql.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data');
  deleteRecord = sql.prepare('DELETE FROM records WHERE collection = ? AND id = ?');
}

function loadState() {
  state = { meta: structuredClone(EMPTY_META) };
  for (const name of COLLECTIONS) state[name] = [];
  for (const row of sql.prepare('SELECT collection, data FROM records').all()) {
    if (Array.isArray(state[row.collection])) state[row.collection].push(JSON.parse(row.data));
  }
  const metaRow = sql.prepare('SELECT value FROM meta WHERE key = ?').get('state');
  if (metaRow) state.meta = { ...structuredClone(EMPTY_META), ...JSON.parse(metaRow.value) };
}

function migrateLegacyJson() {
  if (!fs.existsSync(legacyFile)) return;
  const { count } = sql.prepare('SELECT COUNT(*) AS count FROM records').get();
  if (count > 0) return;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8') || '{}');
  } catch {
    return;
  }
  state.meta = { ...structuredClone(EMPTY_META), ...(legacy.meta || {}) };
  for (const name of COLLECTIONS) {
    state[name] = Array.isArray(legacy[name]) ? legacy[name] : [];
  }
  // Vectors move out of the main records table and into the indexed chunks table.
  for (const doc of state.documents) {
    if (!Array.isArray(doc.chunks)) continue;
    insertChunks(doc.chunks.map((chunk) => ({
      ...chunk,
      tenantId: doc.tenantId,
      documentId: doc.id,
      knowledgeBaseId: doc.knowledgeBaseId,
    })));
    doc.chunkCount = doc.chunkCount || doc.chunks.length;
    delete doc.chunks;
  }
  save();
  fs.renameSync(legacyFile, `${legacyFile}.migrated`);
}

export function initStore() {
  if (!sql) openDatabase();
  loadState();
  migrateLegacyJson();
  runMigrations();
  ensureGuestDefaults();
  return state;
}

// Forward-only schema upgrades. New releases add collections or meta fields
// without discarding existing tenant data.
export function runMigrations() {
  if (!state) return state;
  let changed = false;
  for (const name of COLLECTIONS) {
    if (!Array.isArray(state[name])) { state[name] = []; changed = true; }
  }
  if (!state.meta || typeof state.meta !== 'object') { state.meta = structuredClone(EMPTY_META); changed = true; }
  if (typeof state.meta.version !== 'number' || state.meta.version < 5) {
    state.meta.version = 5;
    changed = true;
  }
  if (changed) save();
  return state;
}

// Mirrors providers.js LOCAL_MODEL without importing it (avoids a cycle).
const LOCAL_MODEL_ID = 'peaceai-local';

function ensureLocalProvider(tenant) {
  const existing = state.providers.find((item) => item.tenantId === tenant.id && item.kind === 'local' && item.isBuiltIn);
  if (existing) return { provider: existing, created: false };
  const provider = {
    id: id('prv_'),
    tenantId: tenant.id,
    name: 'PeaceAi Local',
    kind: 'local',
    baseUrl: '',
    model: LOCAL_MODEL_ID,
    enabled: true,
    isBuiltIn: true,
    createdAt: now(),
  };
  state.providers.push(provider);
  return { provider, created: true };
}

export function ensureGuestDefaults() {
  let changed = false;
  if (!state.meta || typeof state.meta !== 'object') { state.meta = structuredClone(EMPTY_META); changed = true; }
  if (state.meta.guestTenantId === undefined) { state.meta.guestTenantId = null; changed = true; }
  if (!Array.isArray(state.guests)) { state.guests = []; changed = true; }
  if (!state.tenants.length) {
    const tenant = {
      id: id('ten_'),
      name: 'PeaceAi',
      slug: 'peaceai',
      branding: { appName: 'PeaceAi', logoText: 'P', accent: '#8b7bff', tagline: 'Intelligence, in harmony.' },
      createdAt: now(),
    };
    state.tenants.push(tenant);
    state.meta.guestTenantId = tenant.id;
    changed = true;
  }
  if (!state.meta.guestTenantId && state.tenants.length) {
    state.meta.guestTenantId = [...state.tenants].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0].id;
    changed = true;
  }
  for (const tenant of state.tenants) {
    if (!tenant.guestAccess) {
      tenant.guestAccess = { enabled: true, basis: 'messages', limit: 10, agentId: null };
      changed = true;
    }
    let agent = tenant.guestAccess.agentId && state.agents.find((a) => a.id === tenant.guestAccess.agentId);
    if (!agent) agent = state.agents.find((a) => a.tenantId === tenant.id && a.isGuestDefault);
    if (!agent) {
      agent = {
        id: id('agt_'),
        tenantId: tenant.id,
        name: 'PeaceAi Assistant',
        description: 'Default guest assistant',
        icon: '✨',
        accent: '#8b7bff',
        persona: 'You are PeaceAi, a helpful, precise and friendly assistant. Answer directly, ask clarifying questions when needed, and keep replies clear and useful.',
        providerId: null,
        model: '',
        embeddingProviderId: null,
        embeddingModel: '',
        knowledgeBaseIds: [],
        generation: { temperature: 0.6, maxTokens: 2048 },
        tools: { enabled: [], approvalRequired: true },
        visibility: 'tenant',
        isGuestDefault: true,
        createdBy: null,
        createdAt: now(),
      };
      state.agents.push(agent);
      changed = true;
    }
    if (tenant.guestAccess.agentId !== agent.id) { tenant.guestAccess.agentId = agent.id; changed = true; }

    const { provider, created } = ensureLocalProvider(tenant);
    if (created) changed = true;
    const providerExists = state.providers.some((item) => item.id === agent.providerId && item.tenantId === tenant.id);
    if (!agent.providerId || !providerExists) { agent.providerId = provider.id; changed = true; }
    if (!agent.model) { agent.model = LOCAL_MODEL_ID; changed = true; }
  }
  if (changed) save();
}

export function db() {
  if (!state) initStore();
  return state;
}

// Persist only records that actually changed, in one transaction. Callers can
// keep mutating objects returned by find()/filter() and then call save().
export function save() {
  if (!sql || !state) return;
  const pending = [];
  for (const name of COLLECTIONS) {
    const items = Array.isArray(state[name]) ? state[name] : [];
    const previous = snapshots.get(name) || new Map();
    const current = new Map();
    for (const item of items) {
      if (!item || item.id == null) continue;
      const json = JSON.stringify(item);
      current.set(item.id, json);
      if (previous.get(item.id) !== json) pending.push(['upsert', name, item.id, json]);
    }
    for (const itemId of previous.keys()) {
      if (!current.has(itemId)) pending.push(['delete', name, itemId]);
    }
    snapshots.set(name, current);
  }
  const metaJson = JSON.stringify(state.meta || {});
  const metaChanged = snapshots.get('__meta__') !== metaJson;
  snapshots.set('__meta__', metaJson);
  if (!pending.length && !metaChanged) return;

  sql.exec('BEGIN IMMEDIATE');
  try {
    for (const [action, name, itemId, json] of pending) {
      if (action === 'upsert') upsertRecord.run(name, itemId, json);
      else deleteRecord.run(name, itemId);
    }
    if (metaChanged) {
      sql.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('state', metaJson);
    }
    sql.exec('COMMIT');
  } catch (error) {
    sql.exec('ROLLBACK');
    throw error;
  }
}

export function all(name) {
  return db()[name] || [];
}

export function find(name, predicate) {
  return all(name).find(predicate) ?? null;
}

export function filter(name, predicate) {
  return all(name).filter(predicate);
}

export function insert(name, item) {
  all(name).push(item);
  save();
  return item;
}

export function update(name, idValue, patch) {
  const items = all(name);
  const index = items.findIndex((item) => item.id === idValue);
  if (index === -1) return null;
  items[index] = { ...items[index], ...patch };
  save();
  return items[index];
}

export function remove(name, predicate) {
  const items = all(name);
  const kept = [];
  const removed = [];
  for (const item of items) {
    if (predicate(item)) removed.push(item);
    else kept.push(item);
  }
  if (removed.length) {
    db()[name] = kept;
    save();
  }
  return removed;
}

/* --------------------------- indexed chunk store --------------------------- */

export function insertChunks(chunks = []) {
  if (!chunks.length) return;
  if (!sql) initStore();
  const stmt = sql.prepare(`INSERT INTO chunks (id, tenantId, documentId, knowledgeBaseId, idx, text, vector, embeddingModel, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET text = excluded.text, vector = excluded.vector, section = excluded.section`);
  sql.exec('BEGIN IMMEDIATE');
  try {
    for (const chunk of chunks) {
      stmt.run(
        chunk.id,
        chunk.tenantId || '',
        chunk.documentId || null,
        chunk.knowledgeBaseId || null,
        Number(chunk.index || 0),
        String(chunk.text || ''),
        chunk.vector ? JSON.stringify(chunk.vector) : null,
        chunk.embeddingModel || null,
        chunk.section || null,
      );
    }
    sql.exec('COMMIT');
  } catch (error) {
    sql.exec('ROLLBACK');
    throw error;
  }
}

export function deleteChunks(documentId) {
  if (!sql) initStore();
  sql.prepare('DELETE FROM chunks WHERE documentId = ?').run(documentId);
}

export function chunksForDocuments(documentIds = []) {
  if (!sql) initStore();
  if (!documentIds.length) return [];
  const placeholders = documentIds.map(() => '?').join(',');
  return sql.prepare(`SELECT * FROM chunks WHERE documentId IN (${placeholders}) ORDER BY documentId, idx`).all(...documentIds)
    .map((row) => ({
      id: row.id,
      index: row.idx,
      text: row.text,
      vector: row.vector ? JSON.parse(row.vector) : null,
      embeddingModel: row.embeddingModel,
      section: row.section,
      documentId: row.documentId,
      knowledgeBaseId: row.knowledgeBaseId,
      documentName: null,
    }));
}

export function chunkCountForDocument(documentId) {
  if (!sql) initStore();
  return sql.prepare('SELECT COUNT(*) AS count FROM chunks WHERE documentId = ?').get(documentId).count;
}

export function purgeSession(token) {
  remove('sessions', (s) => s.token === token);
}

export function logAudit(tenantId, userId, action, detail = {}) {
  insert('audit', { id: id('aud_'), tenantId, userId, action, detail, ts: now() });
}

export function tenantWorkspace(tenantId) {
  const dir = path.join(workspacesDir, tenantId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function closeStore() {
  if (sql) { sql.close(); sql = null; }
}

export { dataDir, sqliteFile, legacyFile as dbFile, workspacesDir };
