import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREPARE_SCRIPT = path.join(__dirname, 'prepare-prisma.mjs');
const SERVER_ENTRY = path.resolve(__dirname, '../dist/server.js');

execFileSync(process.execPath, [PREPARE_SCRIPT, '--push'], {
  stdio: 'inherit',
  env: process.env,
});

const child = spawn(process.execPath, [SERVER_ENTRY], {
  stdio: 'inherit',
  env: process.env,
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
