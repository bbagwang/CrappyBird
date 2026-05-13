import { existsSync, readFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const [, , command, ...args] = process.argv;

if (!command) {
  throw new Error('Usage: node scripts/run-with-playwright-env.mjs <command> [...args]');
}

function isUbuntu2604() {
  if (process.platform !== 'linux' || !existsSync('/etc/os-release')) return false;
  const osRelease = readFileSync('/etc/os-release', 'utf8');
  return /(^|\n)ID=ubuntu(\n|$)/.test(osRelease) && /(^|\n)VERSION_ID="?26\.04"?(\n|$)/.test(osRelease);
}

const env = { ...process.env };
if (isUbuntu2604() && !env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE) {
  env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = 'ubuntu24.04-x64';
}

const localLibDir = resolve('.omx/browser-libs/extract/usr/lib/x86_64-linux-gnu');
if (existsSync(localLibDir)) {
  env.LD_LIBRARY_PATH = [localLibDir, env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter);
}

const child = spawn(command, args, {
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
