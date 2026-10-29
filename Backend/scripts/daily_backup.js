import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(backendDir, '.env') });

const RETENTION_DAYS = 14;
const BACKUPS_DIR = path.join(backendDir, 'backups');

function findPgDumpExecutable() {
  const commonPaths = [
    'pg_dump',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
    '/usr/bin/pg_dump',
    '/usr/local/bin/pg_dump'
  ];

  for (const p of commonPaths) {
    if (p === 'pg_dump') continue;
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'pg_dump';
}

function parseDbUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port || '5432',
      user: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || ''),
      database: dbName,
      fullUrl: rawUrl
    };
  } catch (err) {
    console.error('Failed to parse database connection URL:', err.message);
    return null;
  }
}

async function dumpDatabase(pgDumpPath, dbConfig, outputPath) {
  console.log(`[Backup] Dumping database: ${dbConfig.database} on ${dbConfig.host}:${dbConfig.port}...`);

  const args = [
    '-h', dbConfig.host,
    '-p', String(dbConfig.port),
    '-U', dbConfig.user,
    '-d', dbConfig.database,
    '-F', 'c', // Custom compressed format (standard, reliable, restorable with pg_restore)
    '-b', // Include large objects / blobs
    '-v', // Verbose
    '-f', outputPath
  ];

  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password
  };

  try {
    const { stdout, stderr } = await execFileAsync(pgDumpPath, args, { env, maxBuffer: 100 * 1024 * 1024 });
    const stats = fs.statSync(outputPath);
    console.log(`[Backup] Successfully created ${path.basename(outputPath)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    return true;
  } catch (error) {
    console.error(`[Backup] Dump failed for ${dbConfig.database}:`, error.message);
    return false;
  }
}

function cleanOldBackups(backupDir, retentionDays) {
  if (!fs.existsSync(backupDir)) return;
  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirPath = path.join(backupDir, entry.name);
      try {
        const stats = fs.statSync(dirPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`[Backup Cleanup] Removed expired backup archive: ${entry.name}`);
        }
      } catch (err) {
        console.warn(`[Backup Cleanup] Notice cleaning ${entry.name}:`, err.message);
      }
    }
  }
}

export async function runDailyBackup() {
  console.log('====================================================');
  console.log(`[Daily Backup] Starting backup at ${new Date().toISOString()}`);
  console.log('====================================================');

  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  const pgDumpPath = findPgDumpExecutable();
  console.log(`[Backup] Using pg_dump executable: ${pgDumpPath}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.join(BACKUPS_DIR, `backup_${timestamp}`);
  fs.mkdirSync(targetDir, { recursive: true });

  const targets = [];

  const mainDb = parseDbUrl(process.env.DATABASE_URL);
  if (mainDb) {
    targets.push({ config: mainDb, label: 'primary' });
  }

  const masterDb = parseDbUrl(process.env.MASTER_DATABASE_URL);
  if (masterDb && (!mainDb || masterDb.database !== mainDb.database)) {
    targets.push({ config: masterDb, label: 'master' });
  }

  let successCount = 0;
  for (const target of targets) {
    const outFile = path.join(targetDir, `${target.config.database}_${target.label}.dump`);
    const ok = await dumpDatabase(pgDumpPath, target.config, outFile);
    if (ok) successCount++;
  }

  cleanOldBackups(BACKUPS_DIR, RETENTION_DAYS);

  console.log('====================================================');
  console.log(`[Daily Backup] Completed: ${successCount} database(s) backed up to ${targetDir}`);
  console.log('====================================================');

  return { success: successCount > 0, backupDir: targetDir, count: successCount };
}

// Allow standalone execution: node scripts/daily_backup.js
if (process.argv[1] && process.argv[1].endsWith('daily_backup.js')) {
  runDailyBackup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal backup error:', err);
      process.exit(1);
    });
}

