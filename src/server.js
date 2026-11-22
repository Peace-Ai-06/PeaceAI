import './env.js';
import fs from 'node:fs';
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
import { absoluteUrl, escapeHtml, getBaseUrl, seoDescription } from './lib/seo.js';
import { agentForShareToken } from './lib/share.js';

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

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/app/') || ['/login', '/register', '/forgot-password', '/reset-password'].includes(req.path)) {
      res.set('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  app.get('/robots.txt', (req, res) => {
    const body = [
      'User-agent: *',
      'Allow: /',
      'Allow: /share/',
      'Disallow: /api/',
      'Disallow: /app/',
      'Disallow: /login',
      'Disallow: /register',
      'Disallow: /forgot-password',
      'Disallow: /reset-password',
      '',
      `Sitemap: ${absoluteUrl(req, '/sitemap.xml')}`,
      '',
    ].join('\n');
    res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(body);
  });

  app.get('/sitemap.xml', (req, res) => {
    const urls = [absoluteUrl(req, '/')];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`).join('\n')}\n</urlset>\n`;
    res.type('application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(xml);
  });

  app.get('/site.webmanifest', (_req, res) => {
    res.sendFile(path.join(publicDir, 'site.webmanifest'), {
      headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  });

  app.get('/share/:token', (req, res) => {
    const agent = agentForShareToken(req.params.token);
    const base = getBaseUrl(req);
    const canonical = `${base}/share/${encodeURIComponent(req.params.token)}`;
    const title = agent ? `${agent.name} · PeaceAI` : 'Shared agent · PeaceAI';
    const description = seoDescription(agent?.description, 'Chat with a shared PeaceAI agent.');
    const image = absoluteUrl(req, '/logo.svg');
    const noIndex = !agent || agent.shareEnabled === false;
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${noIndex ? 'noindex, nofollow' : 'index, follow'}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="PeaceAI">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <meta name="theme-color" content="#090B24">
  <link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
</head>
<body>
  <noscript><p>PeaceAI shared chat requires JavaScript.</p></noscript>
  <script type="module" src="/js/share-page.js?v=2"></script>
</body>
</html>`;
    res.status(noIndex ? 404 : 200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache, no-store, must-revalidate').send(html);
  });

  // No aggressive caching: frontend changes must appear on a normal refresh.
  app.use(express.static(publicDir, {
    index: false,
    maxAge: 0,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'),
  }));
  app.get(/.*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const filePath = path.join(publicDir, 'index.html');
    const canonical = absoluteUrl(req, '/');
    const html = fs.readFileSync(filePath, 'utf8')
      .replace('<link rel="canonical" href="/">', `<link rel="canonical" href="${escapeHtml(canonical)}">`)
      .replace('<meta property="og:url" content="/">', `<meta property="og:url" content="${escapeHtml(canonical)}">`)
      .replace('<meta property="og:image" content="/logo.svg">', `<meta property="og:image" content="${escapeHtml(absoluteUrl(req, '/logo.svg'))}">`)
      .replace('<meta name="twitter:image" content="/logo.svg">', `<meta name="twitter:image" content="${escapeHtml(absoluteUrl(req, '/logo.svg'))}">`)
      .replace('"url":"/"', `"url":"${escapeHtml(canonical)}"`);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const badUpload = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || String(error.message || '').startsWith('Unsupported file type');
    const status = error instanceof ApiError ? error.status : badUpload ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500;
    const code = error instanceof ApiError ? error.code : status === 413 ? 'file_too_large' : status === 400 ? 'validation_error' : 'internal_error';
    const message = status === 500 ? 'An unexpected error occurred' : error.message;
    if (status === 500) console.error('[PeaceAI]', error);
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
    console.log(`\n  PeaceAI is running at http://localhost:${port}`);
    console.log(`  Health check: http://localhost:${port}/api/health\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => {
      closeStore();
      process.exit(0);
    }));
  }
}
