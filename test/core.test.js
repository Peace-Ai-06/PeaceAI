import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../src/lib/files.js';
import { cosine } from '../src/lib/rag.js';
import { resolveSafe, requiresApproval } from '../src/lib/tools.js';
import { hashPassword, verifyPassword, encrypt, decrypt } from '../src/lib/security.js';
import { sanitizeTheme, sanitizeBranding } from '../src/lib/theme.js';
import { buildSystemPrompt } from '../src/lib/agents.js';
import { generateLocal, embedLocal, localModels, LOCAL_MODEL } from '../src/lib/local-model.js';

test('chunkText splits long paragraphs and respects size', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} contains useful details.`).join(' ');
  const chunks = chunkText(text, { size: 200, overlap: 20 });
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200);
});

test('cosine similarity handles identical, orthogonal and invalid vectors', () => {
  assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 2], [1]), 0);
});

test('resolveSafe blocks traversal, hidden paths and absolute paths', () => {
  const root = '/tmp/peaceai-sandbox';
  assert.equal(resolveSafe(root, 'src/app.js'), `${root}/src/app.js`);
  assert.equal(resolveSafe(root), root);
  assert.throws(() => resolveSafe(root, '../secret'), /not allowed/);
  assert.throws(() => resolveSafe(root, '.env'), /not allowed/);
  assert.throws(() => resolveSafe(root, '/etc/passwd'), /not allowed/);
});

test('requiresApproval defaults sensitive tools to approval', () => {
  const agent = { tools: { enabled: ['read_file', 'write_file'] } };
  assert.equal(requiresApproval(agent, 'read_file'), false);
  assert.equal(requiresApproval(agent, 'write_file'), true);
  assert.equal(requiresApproval({ tools: { enabled: ['read_file'], approvalRequired: true } }, 'read_file'), true);
});

test('passwords and provider keys round-trip safely', () => {
  const hash = hashPassword('correct horse battery');
  assert.equal(verifyPassword('correct horse battery', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  const encrypted = encrypt('sk-super-secret-key');
  assert.notEqual(encrypted, 'sk-super-secret-key');
  assert.equal(decrypt(encrypted), 'sk-super-secret-key');
  assert.equal(decrypt('garbage'), '');
});

test('theme and branding sanitizers strip unsafe content', () => {
  const theme = sanitizeTheme({ mode: 'light', accent: '#fff', customCss: '</style><script>alert(1)</script>body{}' });
  assert.equal(theme.mode, 'light');
  assert.equal(theme.accent, '#fff');
  assert.ok(!theme.customCss.includes('<script'));
  assert.ok(!theme.customCss.includes('</style>'));
  const branding = sanitizeBranding({ appName: '<img src=x>Peace', accent: 'red' });
  assert.ok(!branding.appName.includes('<'));
  assert.equal(branding.accent, '#6D28FF');
});

test('built-in local model chats, uses sources, math and tools offline', () => {
  const system = buildSystemPrompt(
    { persona: 'You are PeaceAi.', tools: { enabled: [] } },
    { name: 'Harmony', branding: { appName: 'PeaceAi' } },
    [{ documentName: 'manual.txt', chunkIndex: 0, text: 'The backup code is harmony42. Restore it from Settings.' }],
  );
  const greeting = generateLocal([{ role: 'system', content: system }, { role: 'user', content: 'hello' }]);
  assert.match(greeting.content, /PeaceAi/);
  assert.equal(greeting.toolCalls.length, 0);

  const grounded = generateLocal([
    { role: 'system', content: system },
    { role: 'user', content: 'What is the backup code?' },
  ]);
  assert.match(grounded.content, /harmony42/);
  assert.match(grounded.content, /manual\.txt/);

  const math = generateLocal([{ role: 'user', content: '12 * (3 + 1)' }]);
  assert.match(math.content, /48/);
  assert.match(generateLocal([{ role: 'user', content: 'what is 12 * (3 + 1)?' }]).content, /48/);
  assert.equal(generateLocal([{ role: 'user', content: 'What is your name?' }]).content.includes('Local'), true);

  const tool = generateLocal(
    [{ role: 'user', content: 'list files in src' }],
    { tools: [{ function: { name: 'list_files' } }] },
  );
  assert.equal(tool.content, '');
  assert.equal(tool.toolCalls[0].name, 'list_files');
  assert.equal(tool.toolCalls[0].arguments.path, 'src');

  assert.deepEqual(localModels(), [LOCAL_MODEL]);
  const vectors = embedLocal(['harmony', 'harmony', 'different']);
  assert.equal(vectors.length, 3);
  assert.equal(vectors[0].length, 64);
  assert.deepEqual(vectors[0], vectors[1]);
  assert.notDeepEqual(vectors[0], vectors[2]);
});

test('built-in local model answers common topics and never echoes an unknown question', () => {
  const biology = generateLocal([{ role: 'user', content: 'assit biology day' }]);
  assert.match(biology.content, /Biology is the science of life/);
  assert.doesNotMatch(biology.content, /you asked about/);

  const photosynthesis = generateLocal([{ role: 'user', content: 'What is photosynthesis?' }]);
  assert.match(photosynthesis.content, /glucose and oxygen/);
  assert.match(photosynthesis.content, /chloroplasts/);

  const mitosis = generateLocal([{ role: 'user', content: 'Explain mitosis' }]);
  assert.match(mitosis.content, /two daughter cells/);

  const unknown = generateLocal([{ role: 'user', content: 'why is the sky blue?' }]);
  assert.match(unknown.content, /don't have a dependable offline answer/);
  assert.match(unknown.content, /rephrase/);
  assert.doesNotMatch(unknown.content, /you asked about/);
});

test('system prompt includes persona, tenant and sources', () => {
  const prompt = buildSystemPrompt(
    { persona: 'Be terse.', tools: { enabled: ['read_file'] } },
    { name: 'Acme', branding: { appName: 'PeaceAi' } },
    [{ documentName: 'manual.txt', chunkIndex: 0, text: 'Secret word is harmony.' }],
  );
  assert.match(prompt, /Be terse/);
  assert.match(prompt, /Acme/);
  assert.match(prompt, /Secret word is harmony/);
  assert.match(prompt, /read_file/);
});
