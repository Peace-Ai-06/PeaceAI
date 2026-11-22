import { filter, find, id, insertChunks, chunksForDocuments } from './store.js';
import { embed } from './providers.js';
import { chunkDocument, chunkText } from './files.js';

export function embeddingConfig(tenantId, agent) {
  const provider = agent?.embeddingProviderId ? find('providers', (p) => p.id === agent.embeddingProviderId && p.tenantId === tenantId) : null;
  const model = agent?.embeddingModel || '';
  return provider && model ? { provider, model } : null;
}

export async function indexDocument(tenantId, kbId, document, text, agent = null) {
  const chunks = chunkDocument(text).map((chunk) => ({
    id: id('chk_'),
    index: chunk.index,
    text: chunk.text,
    section: chunk.section || '',
    vector: null,
  }));
  const prepared = await attachVectors(tenantId, document, chunks, agent);
  insertChunks(prepared.map((chunk) => ({ ...chunk, tenantId, documentId: document.id, knowledgeBaseId: kbId })));
  return prepared.length;
}

export async function indexAttachments(tenantId, agent, attachments = []) {
  const chunks = [];
  for (const attachment of attachments) {
    if (!attachment?.text) continue;
    for (const piece of chunkDocument(String(attachment.text))) {
      chunks.push({
        id: id('chk_'),
        index: piece.index,
        text: piece.text,
        section: piece.section || '',
        vector: null,
        documentName: attachment.name || 'attachment',
      });
    }
  }
  const config = embeddingConfig(tenantId, agent);
  if (config && chunks.length) {
    try {
      const vectors = await embed(config.provider, config.model, chunks.map((c) => c.text));
      chunks.forEach((chunk, index) => { if (vectors[index]) chunk.vector = vectors[index]; });
    } catch {
      // Lexical retrieval remains available when embeddings are unreachable.
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

// Second-pass feature scoring. Cheap heuristics that reliably improve the
// ordering of the hybrid candidates without needing a separate reranker model.
function rerankScore(query, candidate, queryTokens) {
  const text = String(candidate.text || '').toLowerCase();
  const phrase = query.trim().toLowerCase();
  let score = 0;
  if (phrase.length >= 4 && text.includes(phrase)) score += 0.5;
  const unique = new Set(queryTokens);
  const present = [...unique].filter((token) => text.includes(token)).length;
  score += (present / Math.max(1, unique.size)) * 0.35;
  if (candidate.section) {
    const section = candidate.section.toLowerCase();
    if ([...unique].some((token) => section.includes(token))) score += 0.15;
  }
  return Math.min(1, score);
}

export async function retrieve(tenantId, agent, query, { topK = 5, extraChunks = [] } = {}) {
  const kbIds = new Set(agent?.knowledgeBaseIds || []);
  const documents = filter('documents', (doc) => doc.tenantId === tenantId && kbIds.has(doc.knowledgeBaseId) && doc.status === 'ready');
  const documentIds = documents.map((doc) => doc.id);
  const names = new Map(documents.map((doc) => [doc.id, doc.name]));
  const stored = chunksForDocuments(documentIds).map((chunk) => ({
    ...chunk,
    documentName: names.get(chunk.documentId) || 'attachment',
  }));
  const candidates = [...stored, ...extraChunks];
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
    const hybrid = semantic === null ? lexical : semantic * 0.65 + Math.min(1, lexical) * 0.35;
    const rerank = rerankScore(query, candidate, qTokens);
    return { ...candidate, score: hybrid * 0.7 + rerank * 0.3 };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((item) => item.score > 0.02)
    .map((item) => ({
      documentName: item.documentName || 'attachment',
      documentId: item.documentId || null,
      chunkIndex: item.index ?? 0,
      section: item.section || '',
      score: Number(item.score.toFixed(4)),
      preview: item.text.slice(0, 320),
      text: item.text,
    }));
}

// Kept as a named export for older integrations that used character chunking.
export const chunkTextForRetrieval = chunkText;
