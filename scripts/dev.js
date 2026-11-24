import { spawn } from 'child_process';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('\x1b[36m%s\x1b[0m', '>>> Starting SkillBridge Backend and Frontend in development mode...\n');

const backend = spawn(npmCmd, ['run', 'dev', '--prefix', 'Backend'], {
  stdio: 'inherit',
  shell: true
});

const frontend = spawn(npmCmd, ['run', 'dev', '--prefix', 'Frontend'], {
  stdio: 'inherit',
  shell: true
});

const cleanup = () => {
  try {
    if (isWin) {
      if (backend.pid) spawn('taskkill', ['/pid', backend.pid, '/f', '/t'], { stdio: 'ignore' });
      if (frontend.pid) spawn('taskkill', ['/pid', frontend.pid, '/f', '/t'], { stdio: 'ignore' });
    } else {
      backend.kill('SIGTERM');
      frontend.kill('SIGTERM');
    }
  } catch (_) {}
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

backend.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`Backend exited with code ${code}`);
  }
});

frontend.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`Frontend exited with code ${code}`);
  }
});
