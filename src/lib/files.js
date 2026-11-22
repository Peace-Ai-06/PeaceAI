import path from 'node:path';
import { ApiError } from './http.js';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.html', '.htm', '.xml',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.h',
  '.cpp', '.cs', '.rb', '.php', '.sh', '.yaml', '.yml', '.toml', '.ini', '.sql', '.log',
  '.env.example', '.css', '.scss',
]);

export function isSupportedFile(name) {
  const ext = path.extname(name || '').toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || ext === '.pdf' || ext === '.docx';
}

export async function extractText(file) {
  const name = file.originalname || file.name || 'untitled';
  const ext = path.extname(name).toLowerCase();
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer)) throw new ApiError(400, `No data received for ${name}`, 'empty_file');

  let text = '';
  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = result.text || '';
    } finally {
      await parser.destroy();
    }
    // Scanned PDFs have little or no text layer. OCR them when the optional
    // system binaries are installed (or when explicitly required).
    if (text.trim().length < 40) {
      const { ocrPdf } = await import('./ocr.js');
      const ocrText = ocrPdf(buffer);
      if (ocrText) text = text ? `${text}\n\n${ocrText}` : ocrText;
    }
  } else if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || '';
  } else if (TEXT_EXTENSIONS.has(ext)) {
    text = buffer.toString('utf8');
    if (ext === '.html' || ext === '.htm' || ext === '.xml') {
      text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    }
  } else {
    throw new ApiError(415, `Unsupported file type: ${ext || 'unknown'}`, 'unsupported_file');
  }

  text = text.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!text) throw new ApiError(422, `No readable text found in ${name}`, 'empty_document');
  if (text.length > 2_000_000) text = text.slice(0, 2_000_000);
  return text;
}

// Structure-aware chunking for indexed documents. Markdown headings become
// section labels, and long blocks are split with overlap so answers can cite
// the part of the document they came from.
export function chunkDocument(text, { size = 900, overlap = 120 } = {}) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const pieces = [];
  let section = '';
  let buffer = '';
  const flush = () => {
    if (buffer.trim()) pieces.push({ text: buffer.trim(), section });
    buffer = '';
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) { flush(); section = heading[2].trim().slice(0, 120); continue; }
    if (!trimmed) continue;
    const candidate = buffer ? `${buffer}\n${trimmed}` : trimmed;
    if (candidate.length <= size) { buffer = candidate; continue; }
    flush();
    if (trimmed.length > size) {
      const step = Math.max(1, size - overlap);
      for (let i = 0; i < trimmed.length; i += step) {
        pieces.push({ text: trimmed.slice(i, i + size), section });
      }
    } else {
      buffer = trimmed;
    }
  }
  flush();
  return pieces.map((piece, index) => ({ ...piece, index }));
}

export function chunkText(text, { size = 900, overlap = 120 } = {}) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= size) {
      pieces.push(paragraph);
      continue;
    }
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
    let current = '';
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= size) {
        current = current ? `${current} ${sentence}` : sentence;
      } else {
        if (current) pieces.push(current);
        if (sentence.length > size) {
          for (let i = 0; i < sentence.length; i += size - overlap) pieces.push(sentence.slice(i, i + size));
          current = '';
        } else {
          current = sentence;
        }
      }
    }
    if (current) pieces.push(current);
  }

  const chunks = [];
  for (const piece of pieces) {
    const previous = chunks[chunks.length - 1];
    if (previous && previous.length + piece.length + 1 <= size) {
      chunks[chunks.length - 1] = `${previous}\n${piece}`;
    } else {
      chunks.push(piece);
    }
  }
  return chunks.filter((chunk) => chunk.trim().length > 0);
}
