import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join('/tmp/opencode', 'peaceai-retrieval-'));
process.env.PEACEAI_DATA_DIR = tempDir;

const { ocrAvailability } = await import('../src/lib/ocr.js');
const { rerank } = await import('../src/lib/providers.js');
const { rerankConfig } = await import('../src/lib/rag.js');
const { insert, closeStore } = await import('../src/lib/store.js');

test.after(() => {
  closeStore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('OCR availability is reported without requiring system binaries', () => {
  const info = ocrAvailability();
  assert.equal(typeof info.enabled, 'boolean');
  assert.equal(typeof info.required, 'boolean');
  assert.equal(typeof info.pdftoppm, 'boolean');
  assert.equal(typeof info.tesseract, 'boolean');
  assert.equal(info.ready, info.pdftoppm && info.tesseract);
});

test('rerank parses model scores and normalizes them to 0..1', async () => {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: '[8, 1, 0.5]' } }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = {
      kind: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      encryptedApiKey: null,
    };
    const scores = await rerank(provider, 'rerank-model', 'sqlite migration', ['a', 'b', 'c']);
    assert.deepEqual(scores, [0.8, 0.1, 0.05]);
    assert.deepEqual(await rerank(provider, 'rerank-model', 'x', []), []);
  } finally {
    server.close();
  }
});

test('rerankConfig only activates when both provider and model are configured', () => {
  const provider = insert('providers', { id: 'prv_1', tenantId: 'ten_1', name: 'Rerank', kind: 'openai', baseUrl: '', enabled: true });
  assert.equal(rerankConfig('ten_1', { rerankProviderId: 'prv_1', rerankModel: 'cross-encoder' }).provider.id, provider.id);
  assert.equal(rerankConfig('ten_1', { rerankProviderId: 'prv_1' }), null);
  assert.equal(rerankConfig('ten_2', { rerankProviderId: 'prv_1', rerankModel: 'x' }), null);
});
