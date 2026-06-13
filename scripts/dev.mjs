import { spawn } from 'node:child_process';

const children = [
  spawn('vite', ['--host', '0.0.0.0'], { stdio: 'inherit', shell: true }),
  spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { stdio: 'inherit' }),
];

const stop = (code = 0) => {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(code);
};

for (const child of children) {
  child.on('exit', (code) => stop(code ?? 0));
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
