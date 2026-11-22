import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { closeStore, initStore, now } from './lib/store.js';
import { ApiError } from './lib/http.js';
import { authRouter, meRouter } from './routes/auth.js';
import { adminRouter, templatesRouter } from './routes/admin.js';
import { agentsRouter } from './routes/agents.js';
import { chatRouter } from './routes/chat.js';
import { toolsRouter } from './routes/tools.js';
import { platformRouter } from './routes/platform.js';
import { guestRouter } from './routes/guest.js';
import { adminInsightsRouter, feedbackRouter, insightsRouter } from './routes/insights.js';
import { keysRouter } from './routes/keys.js';
import { mcpRouter } from './routes/mcp.js';
import { rateLimit } from './lib/ratelimit.js';
import { sandboxInfo } from './lib/sandbox.js';
import { ocrAvailability } from './lib/ocr.js';
import { shareAdminRouter, shareRouter } from './routes/share.js';
import { workflowsAdminRouter, workflowsRouter } from './routes/workflows.js';

const publicDir = path.resolve('src/public');

export function createApp() {
  initStore();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '0.1.0', time: now(), storage: 'sqlite', sandbox: sandboxInfo(), ocr: ocrAvailability() });
  });

  app.use('/api/auth', rateLimit({ scope: 'auth', limit: 10, windowMs: 60_000 }), authRouter);
  app.use('/api/guest', rateLimit({ scope: 'guest', limit: 30, windowMs: 60_000 }), guestRouter);
  app.use('/api/me', meRouter);
  app.use('/api/me', insightsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/admin', adminInsightsRouter);
  app.use('/api/admin', shareAdminRouter);
  app.use('/api/admin/workflows', workflowsAdminRouter);
  app.use('/api/admin/api-keys', keysRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/feedback', feedbackRouter());
  // Mount MCP before the catch-all chat router so its API-key auth applies.
  app.use('/api/mcp', rateLimit({ scope: 'mcp', limit: 120, windowMs: 60_000 }), mcpRouter);
  app.use('/api/share', rateLimit({ scope: 'share', limit: 40, windowMs: 60_000 }), shareRouter);
  app.use('/api/workflows', workflowsRouter);
  app.use('/api', chatRouter);
  app.use('/api/tools', toolsRouter);
  app.use('/api/platform', platformRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'API route not found' } });
  });

  app.get('/share/:token', (_req, res) => res.sendFile(path.join(publicDir, 'share.html')));

  // No aggressive caching: frontend changes must appear on a normal refresh.
  app.use(express.static(publicDir, {
    index: false,
    maxAge: 0,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'),
  }));
  app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const badUpload = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || String(error.message || '').startsWith('Unsupported file type');
    const status = error instanceof ApiError ? error.status : badUpload ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500;
    const code = error instanceof ApiError ? error.code : status === 413 ? 'file_too_large' : status === 400 ? 'validation_error' : 'internal_error';
    const message = status === 500 ? 'An unexpected error occurred' : error.message;
    if (status === 500) console.error('[PeaceAi]', error);
    res.status(status).json({ error: { code, message } });
  });
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => {
    console.log(`\n  PeaceAi is running at http://localhost:${port}`);
    console.log(`  Health check: http://localhost:${port}/api/health\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => {
      closeStore();
      process.exit(0);
    }));
  }
}
