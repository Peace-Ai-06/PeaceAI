#!/usr/bin/env node
// One-time admin bootstrap / password reset for a self-hosted PeaceAi workspace.
// Passwords are never written to source, .env or logs: only a scrypt hash is stored.
import '../src/env.js';
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { closeStore, db, filter, find, id, initStore, insert, logAudit, now, remove, update } from '../src/lib/store.js';
import { hashPassword } from '../src/lib/security.js';
import { DEFAULT_THEME } from '../src/lib/theme.js';

const USAGE = `
Usage: npm run admin:create -- --email <email> [options]

Creates (or updates) a workspace admin account using the app's own password
hashing. The password can be supplied in three ways, in order of preference:
  1. --password-stdin   read it from stdin (e.g. cat secret.txt | npm run ...)
  2. PEACEAI_ADMIN_PASSWORD environment variable
  3. interactive hidden prompt (when running in a terminal)

Options:
  --email <email>        Admin email address (required, or PEACEAI_ADMIN_EMAIL)
  --name <name>          Display name (defaults to the email's local part)
  --tenant-id <id>       Workspace to assign a new admin to (default: guest workspace)
  --reset-password       Update the existing account's password, role and active flag
                         and revoke all of its sessions. Does not create duplicates.
  --password <value>     Insecure: visible in process listings. Prefer stdin.
  -h, --help             Show this help
`;

function die(message) {
  console.error(`[PeaceAi] ${message}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = { reset: false, stdin: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '--reset-password') options.reset = true;
    else if (arg === '--password-stdin') options.stdin = true;
    else if (['--email', '--name', '--tenant-id', '--password'].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} needs a value`);
      options[{ '--email': 'email', '--name': 'name', '--tenant-id': 'tenantId', '--password': 'password' }[arg]] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function promptHidden(question) {
  if (!process.stdin.isTTY) return null;
  const stdin = process.stdin;
  const decoder = new StringDecoder('utf8');
  const wasRaw = stdin.isRaw;
  process.stdout.write(question);
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error, result) => {
      stdin.off('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(result);
    };
    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === '\r' || character === '\n') finish(null, value);
        else if (character === '\u0003') finish(new Error('cancelled'), null);
        else if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stdin.on('data', onData);
  });
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 12) return 'Password must be at least 12 characters long';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (kinds < 3) return 'Password must contain at least 3 of: lowercase, uppercase, number, symbol';
  return null;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    die(error.message);
    console.error(USAGE);
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const email = String(options.email || process.env.PEACEAI_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!validateEmail(email)) {
    die('A valid --email (or PEACEAI_ADMIN_EMAIL) is required');
    return;
  }

  let password = '';
  if (options.stdin) password = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  else if (options.password) {
    password = options.password;
    console.error('[PeaceAi] Warning: --password can be seen in the process list. Prefer --password-stdin.');
  } else if (process.env.PEACEAI_ADMIN_PASSWORD) password = process.env.PEACEAI_ADMIN_PASSWORD;
  else {
    password = await promptHidden('Admin password (hidden): ');
    if (password === null) {
      die('No password supplied. Use --password-stdin, PEACEAI_ADMIN_PASSWORD or run in a terminal.');
      return;
    }
  }
  const problem = passwordProblem(password);
  if (problem) {
    die(problem);
    return;
  }

  const state = initStore();
  const existing = find('users', (user) => user.email === email);
  if (existing && !options.reset) {
    die(`An account with ${email} already exists. Use --reset-password to update it.`);
    return;
  }

  const tenant = existing
    ? find('tenants', (item) => item.id === existing.tenantId)
    : (options.tenantId
      ? find('tenants', (item) => item.id === options.tenantId)
      : find('tenants', (item) => item.id === state.meta.guestTenantId) || state.tenants[0]);
  if (!tenant) {
    die(`Workspace not found${options.tenantId ? ` for id ${options.tenantId}` : ''}. Start the server once and try again.`);
    return;
  }

  const hasPlatformAdmin = filter('users', (user) => user.isPlatformAdmin).length > 0;
  if (existing) {
    const patch = { passwordHash: hashPassword(password), role: 'admin', active: true };
    // Never create a second platform admin by accident.
    if (!existing.isPlatformAdmin && !hasPlatformAdmin) patch.isPlatformAdmin = true;
    update('users', existing.id, patch);
    remove('sessions', (session) => session.userId === existing.id);
    logAudit(tenant.id, existing.id, 'auth.admin_password_reset', { email });
    console.log(`[PeaceAi] Admin account ${email} updated. All of its sessions were revoked.`);
    console.log('[PeaceAi] Restart a running PeaceAi server so it reloads this change.');
  } else {
    const user = {
      id: id('usr_'),
      tenantId: tenant.id,
      email,
      name: String(options.name || email.split('@')[0]).trim() || email.split('@')[0],
      passwordHash: hashPassword(password),
      role: 'admin',
      isPlatformAdmin: !hasPlatformAdmin,
      active: true,
      theme: { ...DEFAULT_THEME },
      createdAt: now(),
    };
    insert('users', user);
    logAudit(tenant.id, user.id, 'auth.admin_bootstrap', { email });
    console.log(`[PeaceAi] Admin account created for ${email} in workspace "${tenant.name}".`);
    console.log('[PeaceAi] Sign in at http://localhost:3000/#/login');
    console.log('[PeaceAi] Restart a running PeaceAi server so it reloads this change.');
  }
}

try {
  await main();
} catch (error) {
  die(error.message || 'Could not create the admin account');
} finally {
  closeStore();
}
