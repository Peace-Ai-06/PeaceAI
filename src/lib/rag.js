import { filter, find } from './store.js';
import { embed } from './providers.js';
import { chunkText } from './files.js';
import { id } from './store.js';

export function embeddingConfig(tenantId, agent) {
  const provider = agent?.embeddingProviderId ? find('providers', (p) => p.id === agent.embeddingProviderId && p.tenantId === tenantId) : null;
  const model = agent?.embeddingModel || '';
  return provider && model ? { provider, model } : null;
}

export async function indexDocument(tenantId, kbId, document, text, agent = null) {
  const chunks = chunkText(text).map((chunk, index) => ({
    id: id('chk_'),
    index,
    text: chunk,
    vector: null,
  }));
  return attachVectors(tenantId, document, chunks, agent);
}

export async function indexAttachments(tenantId, agent, attachments = []) {
  const chunks = [];
  for (const attachment of attachments) {
    if (!attachment?.text) continue;
    for (const [index, text] of chunkText(String(attachment.text)).entries()) {
      chunks.push({ id: id('chk_'), index, text, vector: null, documentName: attachment.name || 'attachment' });
    }
  }
  const pseudo = { id: id('att_') };
  const config = embeddingConfig(tenantId, agent);
  if (config && chunks.length) {
    try {
      const vectors = await embed(config.provider, config.model, chunks.map((c) => c.text));
      chunks.forEach((chunk, index) => { if (vectors[index]) chunk.vector = vectors[index]; });
    } catch {
      // Lexical retrieval remains available when embeddings are not configured/reachable.
    }
  }
  return chunks;
}

async function attachVectors(tenantId, document, chunks, agent = null) {
  const config = embeddingConfig(tenantId, agent);
  if (config && chunks.length) {
    try {
      const vectors = await embed(config.provider, config.model, chunks.map((c) => c.text));
      chunks.forEach((chunk, index) => { if (vectors[index]) chunk.vector = vectors[index]; });
      document.embeddingModel = config.model;
    } catch (error) {
      document.embeddingError = error.message;
    }
  }
  return chunks;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokens(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || [];
}

function lexicalScore(queryTokens, chunkTokens, idf) {
  if (!queryTokens.length || !chunkTokens.length) return 0;
  const counts = new Map();
  for (const token of chunkTokens) counts.set(token, (counts.get(token) || 0) + 1);
  let score = 0;
  for (const token of new Set(queryTokens)) {
    const tf = counts.get(token) || 0;
    if (tf) score += (1 + Math.log(tf)) * (idf.get(token) || 1);
  }
  return score / Math.max(1, Math.sqrt(chunkTokens.length));
}

export async function retrieve(tenantId, agent, query, { topK = 5, extraChunks = [] } = {}) {
  const kbIds = new Set(agent?.knowledgeBaseIds || []);
  const documents = filter('documents', (doc) => doc.tenantId === tenantId && kbIds.has(doc.knowledgeBaseId) && doc.status === 'ready');
  const candidates = [];
  for (const doc of documents) {
    for (const chunk of doc.chunks || []) {
      candidates.push({ ...chunk, documentName: doc.name, documentId: doc.id, knowledgeBaseId: doc.knowledgeBaseId });
    }
  }
  for (const chunk of extraChunks) candidates.push(chunk);
  if (!candidates.length) return [];

  const qTokens = tokens(query);
  const docFreq = new Map();
  for (const candidate of candidates) {
    for (const token of new Set(tokens(candidate.text))) docFreq.set(token, (docFreq.get(token) || 0) + 1);
  }
  const idf = new Map();
  for (const [token, count] of docFreq) idf.set(token, Math.log(1 + candidates.length / count));

  let queryVector = null;
  const config = embeddingConfig(tenantId, agent);
  if (config) {
    try {
      const vectors = await embed(config.provider, config.model, [query]);
      queryVector = vectors[0] || null;
    } catch {
      queryVector = null;
    }
  }

  const scored = candidates.map((candidate) => {
    const chunkTokens = tokens(candidate.text);
    const lexical = lexicalScore(qTokens, chunkTokens, idf);
    const semantic = queryVector && candidate.vector ? (cosine(queryVector, candidate.vector) + 1) / 2 : null;
    const score = semantic === null ? lexical : semantic * 0.75 + Math.min(1, lexical) * 0.25;
    return { ...candidate, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((item) => item.score > 0.02)
    .map((item) => ({
      documentName: item.documentName || 'attachment',
      documentId: item.documentId || null,
      chunkIndex: item.index ?? 0,
      score: Number(item.score.toFixed(4)),
      preview: item.text.slice(0, 320),
      text: item.text,
    }));
}
