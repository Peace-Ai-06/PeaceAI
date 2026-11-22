import nodemailer from 'nodemailer';

let cachedTransport = null;
let cachedConfigKey = '';

export function mailDriver() {
  const explicit = String(process.env.PEACEAI_MAIL_DRIVER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.PEACEAI_MAIL_WEBHOOK_URL) return 'webhook';
  if (process.env.PEACEAI_SMTP_HOST) return 'smtp';
  return 'none';
}

export function mailFrom() {
  return process.env.PEACEAI_MAIL_FROM || process.env.PEACEAI_SMTP_FROM || 'PeaceAi <no-reply@peaceai.local>';
}

export function appBaseUrl(req) {
  if (process.env.PEACEAI_PUBLIC_URL) return process.env.PEACEAI_PUBLIC_URL.replace(/\/+$/, '');
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('host') || 'localhost:3000').split(',')[0].trim();
  // Reject malformed Host headers so reset links cannot be poisoned.
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return `http://localhost:${process.env.PORT || 3000}`;
  return `${protocol === 'https' ? 'https' : 'http'}://${host}`;
}

function smtpOptions() {
  const host = process.env.PEACEAI_SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.PEACEAI_SMTP_PORT || 587);
  return {
    host,
    port,
    secure: String(process.env.PEACEAI_SMTP_SECURE ?? (port === 465)).toLowerCase() === 'true',
    auth: process.env.PEACEAI_SMTP_USER
      ? { user: process.env.PEACEAI_SMTP_USER, pass: process.env.PEACEAI_SMTP_PASS || '' }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    ...(String(process.env.PEACEAI_SMTP_IGNORE_TLS || '').toLowerCase() === 'true'
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  };
}

async function sendSmtp(message) {
  const options = smtpOptions();
  if (!options) throw new Error('SMTP is not configured');
  const configKey = JSON.stringify(options);
  if (!cachedTransport || configKey !== cachedConfigKey) {
    cachedTransport = nodemailer.createTransport(options);
    cachedConfigKey = configKey;
  }
  await cachedTransport.sendMail({ from: mailFrom(), ...message });
}

async function sendWebhook(message) {
  const url = process.env.PEACEAI_MAIL_WEBHOOK_URL;
  if (!url) throw new Error('Mail webhook is not configured');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.PEACEAI_MAIL_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.PEACEAI_MAIL_WEBHOOK_TOKEN}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ from: mailFrom(), ...message }) });
  if (!response.ok) throw new Error(`Mail webhook returned HTTP ${response.status}`);
}

// Test hook: set PEACEAI_MAIL_TEST_HANDLER=module#export to delegate delivery.
async function testHandler() {
  const spec = process.env.PEACEAI_MAIL_TEST_HANDLER;
  if (!spec) return null;
  const [modulePath, exportName = 'default'] = spec.split('#');
  const mod = await import(modulePath);
  const handler = mod[exportName];
  if (typeof handler !== 'function') throw new Error(`Mail test handler ${spec} is not a function`);
  return handler;
}

export async function sendMail(message) {
  const handler = await testHandler();
  if (handler) return handler(message);
  const driver = mailDriver();
  if (driver === 'smtp') return sendSmtp(message);
  if (driver === 'webhook') return sendWebhook(message);
  if (driver === 'console') {
    console.info(`[PeaceAi][mail:console] To: ${message.to}\nSubject: ${message.subject}\n${message.text}`);
    return;
  }
  throw new Error('No email provider configured (set PEACEAI_SMTP_HOST or PEACEAI_MAIL_WEBHOOK_URL)');
}
