import { spawnSync } from 'node:child_process';

// Optional OS-level isolation for allowlisted commands. When bubblewrap is
// available, commands run in a new user/PID/network namespace with only the
// tenant workspace writable. Otherwise we fall back to the existing path and
// command allowlists, which are *not* a true sandbox.
const mode = String(process.env.PEACEAI_SANDBOX || 'auto').toLowerCase();
let bwrap = null;
let prlimit = null;

function exists(binary) {
  try {
    return spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
}

function hasBwrap() {
  if (bwrap === null) bwrap = exists('bwrap');
  return bwrap;
}

function hasPrlimit() {
  if (prlimit === null) prlimit = exists('prlimit');
  return prlimit;
}

export function sandboxInfo() {
  const isolated = mode === 'bwrap' || (mode === 'auto' && hasBwrap());
  return {
    mode: isolated ? 'bwrap' : 'host',
    isolated,
    required: mode === 'bwrap',
    resourceLimits: isolated && hasPrlimit(),
  };
}

export function wrapCommand(command, args, cwd, forceHost = false) {
  const info = sandboxInfo();
  if (forceHost || !info.isolated) return { command, args };

  const inner = info.resourceLimits
    ? ['prlimit', '--as=536870912', '--nproc=64', '--', command, ...args]
    : [command, ...args];
  return {
    command: 'bwrap',
    args: [
      '--ro-bind', '/', '/',
      '--bind', cwd, cwd,
      '--chdir', cwd,
      '--unshare-all',
      '--die-with-parent',
      '--dev', '/dev',
      '--proc', '/proc',
      '--cap-drop', 'ALL',
      '--setenv', 'HOME', cwd,
      '--setenv', 'PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '--',
      ...inner,
    ],
  };
}
