import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, find, id, now, remove, save, tenantWorkspace } from './store.js';
import { randomToken } from './security.js';
import { ApiError } from './http.js';

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and folders inside the tenant sandbox workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path, defaults to "."' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the sandbox.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative file path' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file contents in the sandbox for a text query.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, path: { type: 'string', description: 'Optional relative directory' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a text file in the sandbox. Requires user approval.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace one exact block of text inside a sandbox file. Requires user approval.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run an allowlisted read-only command in the sandbox. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['ls', 'pwd', 'git', 'node', 'npm', 'cat'] },
          args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
        },
        required: ['command'],
      },
    },
  },
];

const APPROVAL_REQUIRED = new Set(['write_file', 'edit_file', 'run_command']);

export function requiresApproval(agent, name) {
  if (agent?.tools?.approvalRequired === false) return false;
  return APPROVAL_REQUIRED.has(name) || Boolean(agent?.tools?.approvalRequired);
}

export function resolveSafe(root, relative = '.') {
  const value = String(relative || '.').replace(/\\/g, '/');
  if (value.includes('\0') || path.posix.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    throw new ApiError(400, 'Absolute or invalid paths are not allowed', 'unsafe_path');
  }
  const segments = value.split('/').filter((segment) => segment && segment !== '.');
  if (segments.includes('..') || segments.some((segment) => segment.startsWith('.'))) {
    throw new ApiError(400, 'Parent and hidden paths are not allowed', 'unsafe_path');
  }
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new ApiError(400, 'Path escapes the sandbox', 'unsafe_path');
  }
  return target;
}

async function runProcess(root, command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, shell: false, timeout: 10000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ ok: false, error: error.message }));
    child.on('close', (code) => resolve({
      ok: code === 0,
      output: (stdout + (stderr ? `\n[stderr] ${stderr}` : '')).slice(0, 100000),
      exitCode: code,
    }));
  });
}

export async function executeToolCall(tenantId, call) {
  const root = tenantWorkspace(tenantId);
  const args = call.arguments || {};
  try {
    if (call.name === 'list_files') {
      const target = resolveSafe(root, args.path || '.');
      const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, 300).map((entry) => {
        let size = 0;
        try { if (entry.isFile()) size = fs.statSync(path.join(target, entry.name)).size; } catch { /* ignore */ }
        return { name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size };
      });
      return { ok: true, output: { path: String(args.path || '.'), entries } };
    }

    if (call.name === 'read_file') {
      const target = resolveSafe(root, args.path);
      const stat = fs.statSync(target);
      if (!stat.isFile()) throw new ApiError(400, 'Path is not a file', 'not_a_file');
      if (stat.size > 200000) throw new ApiError(400, 'File is too large to read (200 KB limit)', 'file_too_large');
      return { ok: true, output: fs.readFileSync(target, 'utf8') };
    }

    if (call.name === 'search_files') {
      const start = resolveSafe(root, args.path || '.');
      const query = String(args.query || '').toLowerCase();
      if (!query) throw new ApiError(400, 'query is required', 'validation_error');
      const matches = [];
      const walk = (dir, depth) => {
        if (depth > 5 || matches.length >= 50) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', '.git', 'data'].includes(entry.name) || entry.name.startsWith('.')) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, depth + 1);
          else if (entry.isFile() && fs.statSync(full).size < 300000) {
            const lines = fs.readFileSync(full, 'utf8').split('\n');
            for (const [index, line] of lines.entries()) {
              if (line.toLowerCase().includes(query)) {
                matches.push({ path: path.relative(root, full), line: index + 1, text: line.trim().slice(0, 240) });
                if (matches.length >= 50) return;
              }
            }
          }
        }
      };
      walk(start, 0);
      return { ok: true, output: { query, matches } };
    }

    if (call.name === 'write_file') {
      const target = resolveSafe(root, args.path);
      const content = String(args.content ?? '');
      if (content.length > 200000) throw new ApiError(400, 'Content exceeds 200 KB limit', 'file_too_large');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
      return { ok: true, output: { path: path.relative(root, target), written: content.length } };
    }

    if (call.name === 'edit_file') {
      const target = resolveSafe(root, args.path);
      const content = fs.readFileSync(target, 'utf8');
      const oldText = String(args.oldText ?? '');
      const occurrences = content.split(oldText).length - 1;
      if (!oldText || occurrences !== 1) throw new ApiError(400, 'oldText must occur exactly once in the file', 'ambiguous_edit');
      const updated = content.replace(oldText, String(args.newText ?? ''));
      fs.writeFileSync(target, updated, 'utf8');
      return { ok: true, output: { path: path.relative(root, target), replaced: occurrences } };
    }

    if (call.name === 'run_command') {
      const command = String(args.command || '');
      const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
      if (!['ls', 'pwd', 'git', 'node', 'npm', 'cat'].includes(command)) {
        throw new ApiError(400, `Command "${command}" is not allowlisted`, 'command_not_allowed');
      }
      if (command === 'git' && !['status', 'diff', 'log', 'show', 'branch', 'remote'].includes(cmdArgs[0])) {
        throw new ApiError(400, 'Only read-only git subcommands are allowed', 'command_not_allowed');
      }
      if (command === 'cat') {
        if (cmdArgs.length !== 1) throw new ApiError(400, 'cat accepts exactly one path', 'validation_error');
        cmdArgs[0] = path.relative(root, resolveSafe(root, cmdArgs[0]));
      }
      if (command === 'node' && !['--version', '-v'].includes(cmdArgs[0])) {
        throw new ApiError(400, 'Only node --version is allowed', 'command_not_allowed');
      }
      if (command === 'npm' && !['--version', '-v'].includes(cmdArgs[0])) {
        throw new ApiError(400, 'Only npm --version is allowed', 'command_not_allowed');
      }
      if (cmdArgs.some((arg) => arg.includes('\0'))) throw new ApiError(400, 'Invalid argument', 'validation_error');
      return await runProcess(root, command, cmdArgs);
    }

    throw new ApiError(400, `Unknown tool: ${call.name}`, 'unknown_tool');
  } catch (error) {
    return { ok: false, error: error.message || 'Tool execution failed' };
  }
}

export function requestApproval({ tenantId, userId, conversationId, agentId, toolCall }) {
  const token = randomToken(24);
  const pending = {
    id: id('apr_'),
    token,
    tenantId,
    userId,
    conversationId,
    agentId,
    toolCall,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  db().pendingApprovals.push(pending);
  save();
  return token;
}

export function pendingForUser(tenantId, userId) {
  return db().pendingApprovals.filter((p) => p.tenantId === tenantId && p.userId === userId && new Date(p.expiresAt) > new Date())
    .map(({ token, agentId, conversationId, toolCall, createdAt }) => ({ token, agentId, conversationId, toolCall, createdAt }));
}

export function resolveApproval(token, action, user) {
  const pending = find('pendingApprovals', (p) => p.token === token && p.tenantId === user.tenantId);
  if (!pending) throw new ApiError(404, 'Approval request not found', 'not_found');
  if (pending.userId !== user.id) throw new ApiError(403, 'This approval belongs to another user', 'forbidden');
  if (new Date(pending.expiresAt) < new Date()) {
    remove('pendingApprovals', (p) => p.id === pending.id);
    throw new ApiError(410, 'Approval request expired', 'expired');
  }
  remove('pendingApprovals', (p) => p.id === pending.id);
  if (action === 'deny') {
    return { pending, result: { ok: false, denied: true, error: 'User denied this tool call' } };
  }
  return { pending, result: null };
}
