import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = path.resolve(process.cwd(), process.env.PEACEAI_DATA_DIR || './data');
const dbFile = path.join(dataDir, 'db.json');
const workspacesDir = path.join(dataDir, 'workspaces');

const EMPTY = {
  meta: { version: 2, createdAt: new Date().toISOString(), guestTenantId: null },
  tenants: [],
  users: [],
  sessions: [],
  guests: [],
  providers: [],
  knowledgeBases: [],
  documents: [],
  agents: [],
  conversations: [],
  pendingApprovals: [],
  audit: [],
};

let state = null;

export function id(prefix = '') {
  return prefix + crypto.randomBytes(12).toString('hex');
}

export function now() {
  return new Date().toISOString();
}

export function initStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspacesDir, { recursive: true });
  if (fs.existsSync(dbFile)) {
    const raw = fs.readFileSync(dbFile, 'utf8');
    state = { ...structuredClone(EMPTY), ...JSON.parse(raw || '{}') };
  } else {
    state = structuredClone(EMPTY);
    save();
  }
  ensureGuestDefaults();
  return state;
}

export function ensureGuestDefaults() {
  let changed = false;
  if (!state.meta || typeof state.meta !== 'object') { state.meta = structuredClone(EMPTY.meta); changed = true; }
  if (state.meta.guestTenantId === undefined) { state.meta.guestTenantId = null; changed = true; }
  if (!Array.isArray(state.guests)) { state.guests = []; changed = true; }
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
        accent: '#7c5cff',
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
  }
  if (changed) save();
}

export function db() {
  if (!state) initStore();
  return state;
}

export function save() {
  if (!state) return;
  const tmp = `${dbFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, dbFile);
}

export function all(name) {
  return db()[name];
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

export { dataDir, dbFile, workspacesDir };
