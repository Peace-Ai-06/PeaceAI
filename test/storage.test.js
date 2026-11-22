import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join('/tmp/opencode', 'peaceai-sqlite-'));
process.env.PEACEAI_DATA_DIR = tempDir;

// A legacy JSON database is written before the store is imported so the very
// first init exercises the automatic migration path.
fs.writeFileSync(path.join(tempDir, 'db.json'), JSON.stringify({
  meta: { version: 3, createdAt: new Date().toISOString(), guestTenantId: 'ten_legacy' },
  tenants: [{ id: 'ten_legacy', name: 'Legacy', slug: 'legacy', branding: {}, createdAt: new Date().toISOString() }],
  agents: [],
  documents: [{
    id: 'doc_legacy', tenantId: 'ten_legacy', knowledgeBaseId: 'kb_legacy',
    name: 'guide.md', status: 'ready',
    chunks: [{ id: 'chk_legacy', index: 0, text: 'Legacy content', vector: [1, 0], section: 'Intro' }],
  }],
}));

const store = await import('../src/lib/store.js');
const { chunkDocument } = await import('../src/lib/files.js');
const { sandboxInfo, wrapCommand } = await import('../src/lib/sandbox.js');

store.initStore();

test.after(() => {
  store.closeStore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('legacy db.json is imported into SQLite and vectors move to the chunk table', () => {
  assert.ok(fs.existsSync(path.join(tempDir, 'peaceai.sqlite')));
  assert.ok(fs.existsSync(path.join(tempDir, 'db.json.migrated')));
  assert.ok(store.find('tenants', (tenant) => tenant.id === 'ten_legacy'));
  const chunks = store.chunksForDocuments(['doc_legacy']);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].section, 'Intro');
  assert.deepEqual(chunks[0].vector, [1, 0]);
  const document = store.find('documents', (item) => item.id === 'doc_legacy');
  assert.equal(document.chunkCount, 1);
  assert.equal(document.chunks, undefined);
});

test('chunkDocument keeps heading sections and splits long blocks with overlap', () => {
  const text = `# Setup\nInstall the tool.\n\n## Usage\n${'A long paragraph that must be split cleanly. '.repeat(20)}`;
  const chunks = chunkDocument(text, { size: 200, overlap: 40 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].section, 'Setup');
  assert.ok(chunks.some((chunk) => chunk.section === 'Usage'));
  assert.ok(chunks.every((chunk) => chunk.text.length <= 200));
});

test('records and chunks survive a store reload', () => {
  store.insert('knowledgeBases', { id: 'kb_test', tenantId: 'ten_legacy', name: 'Docs', createdAt: new Date().toISOString() });
  store.insertChunks([{
    id: 'chk_test', tenantId: 'ten_legacy', documentId: 'doc_test',
    knowledgeBaseId: 'kb_test', index: 0, text: 'Fresh content', section: 'Setup',
  }]);
  store.initStore();
  assert.equal(store.find('knowledgeBases', (item) => item.id === 'kb_test').name, 'Docs');
  assert.equal(store.chunksForDocuments(['doc_test'])[0].text, 'Fresh content');
  assert.equal(store.chunkCountForDocument('doc_test'), 1);
  store.deleteChunks('doc_test');
  assert.equal(store.chunkCountForDocument('doc_test'), 0);
});

test('sandbox wrapper reports its mode and can be forced to host execution', () => {
  const info = sandboxInfo();
  assert.ok(['host', 'bwrap'].includes(info.mode));
  const wrapped = wrapCommand('node', ['--version'], tempDir, true);
  assert.equal(wrapped.command, 'node');
  assert.deepEqual(wrapped.args, ['--version']);
});
