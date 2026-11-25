import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const isWin = process.platform === 'win32';

/**
 * Ensures required ports are free before launching Vite and Express
 */
function freePortIfOccupied(port) {
  if (isWin) {
    try {
      const output = execSync(`netstat -ano -p tcp | findstr :${port} | findstr LISTENING`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          console.log(`[Dev Runner] Freeing occupied port ${port} (orphaned PID: ${pid})...`);
          execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' });
        }
      }
    } catch (_) {}
  }
}

freePortIfOccupied(5000);
freePortIfOccupied(5173);

/**
 * Resolves safe npm command invocation without triggering Node.js DEP0190:
 * "DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities."
 * Uses node executable directly with npm-cli.js (or cmd.exe on Windows fallback) with shell: false.
 */
function getSafeNpmInvocation(args) {
  if (isWin) {
    const candidateCliPaths = [
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    for (const cliPath of candidateCliPaths) {
      if (fs.existsSync(cliPath)) {
        return {
          command: process.execPath,
          args: [cliPath, ...args],
          shell: false,
        };
      }
    }
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
      shell: false,
    };
  }
  return {
    command: 'npm',
    args,
    shell: false,
  };
}

console.log('\x1b[36m%s\x1b[0m', '>>> Starting SkillBridge Backend and Frontend in development mode...\n');

// Force development environment for local startup
const devEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: process.env.PORT || '5000',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  FORCE_COLOR: '1',
};

const backendInv = getSafeNpmInvocation(['run', 'dev', '--prefix', 'Backend']);
const backend = spawn(backendInv.command, backendInv.args, {
  stdio: 'inherit',
  shell: backendInv.shell,
  env: devEnv,
});

const frontendInv = getSafeNpmInvocation(['run', 'dev', '--prefix', 'Frontend']);
const frontend = spawn(frontendInv.command, frontendInv.args, {
  stdio: 'inherit',
  shell: frontendInv.shell,
  env: devEnv,
});

let isCleaningUp = false;
const cleanup = () => {
  if (isCleaningUp) return;
  isCleaningUp = true;
  try {
    if (isWin) {
      if (backend?.pid) spawn('taskkill', ['/pid', String(backend.pid), '/f', '/t'], { stdio: 'ignore', shell: false });
      if (frontend?.pid) spawn('taskkill', ['/pid', String(frontend.pid), '/f', '/t'], { stdio: 'ignore', shell: false });
    } else {
      backend?.kill('SIGTERM');
      frontend?.kill('SIGTERM');
    }
  } catch (_) {}
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

backend.on('close', (code) => {
  if (code !== 0 && code !== null && !isCleaningUp) {
    console.log(`Backend exited with code ${code}`);
  }
});

frontend.on('close', (code) => {
  if (code !== 0 && code !== null && !isCleaningUp) {
    console.log(`Frontend exited with code ${code}`);
  }
});
