import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MODE = String(process.env.PEACEAI_OCR || 'auto').toLowerCase();
const LANGUAGE = String(process.env.PEACEAI_OCR_LANG || 'eng').replace(/[^a-zA-Z0-9_+-]/g, '') || 'eng';
const MAX_PAGES = Math.max(1, Math.min(40, Number(process.env.PEACEAI_OCR_PAGES) || 12));

let available = null;

function has(binary, args) {
  try {
    return spawnSync(binary, args, { stdio: 'ignore', timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}

export function ocrAvailability() {
  if (available === null) {
    available = {
      enabled: MODE !== 'off',
      required: MODE === 'on',
      pdftoppm: has('pdftoppm', ['-v']),
      tesseract: has('tesseract', ['--version']),
    };
    available.ready = available.pdftoppm && available.tesseract;
  }
  return available;
}

/**
 * OCR a scanned PDF using poppler + tesseract, both optional system binaries.
 * Returns an empty string when OCR is disabled or unavailable in `auto` mode.
 */
export function ocrPdf(buffer) {
  const info = ocrAvailability();
  if (!info.enabled) return '';
  if (!info.ready) {
    if (info.required) {
      throw new Error('OCR is required but pdftoppm/tesseract are not installed. Install poppler-utils and tesseract-ocr.');
    }
    return '';
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peaceai-ocr-'));
  const input = path.join(dir, 'input.pdf');
  const prefix = path.join(dir, 'page');
  try {
    fs.writeFileSync(input, buffer);
    const render = spawnSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', String(MAX_PAGES), input, prefix], {
      stdio: 'ignore', timeout: 60_000,
    });
    if (render.status !== 0) throw new Error(`pdftoppm failed with status ${render.status}`);
    const pages = fs.readdirSync(dir).filter((name) => /^page-.*\.png$/i.test(name)).sort();
    const text = [];
    for (const page of pages) {
      const result = spawnSync('tesseract', [path.join(dir, page), 'stdout', '-l', LANGUAGE], {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
      });
      if (result.status === 0 && result.stdout) text.push(result.stdout.trim());
    }
    return text.join('\n\n').trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
