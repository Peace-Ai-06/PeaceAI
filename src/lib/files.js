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
