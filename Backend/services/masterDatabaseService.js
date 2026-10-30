import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();
const potentialEnvPaths = [
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'Backend', '.env')
];
for (const envFile of potentialEnvPaths) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile, override: false });
  }
}

const { Client } = pg;

function getCandidateMasterDbUrls() {
  const candidates = [];
  if (process.env.MASTER_DATABASE_URL) {
    candidates.push(process.env.MASTER_DATABASE_URL);
  }
  if (process.env.DATABASE_URL) {
    // 1. Same database server, database 'skillbridge_master'
    try {
      const u = new URL(process.env.DATABASE_URL);
      u.pathname = '/skillbridge_master';
      candidates.push(u.toString());
    } catch (_) {}
    // 2. Fallback to primary database if skillbridge_master does not exist
    candidates.push(process.env.DATABASE_URL);
  }
  return candidates;
}

export async function getWorkingMasterClient() {
  const urls = getCandidateMasterDbUrls();
  for (const url of urls) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      return { client, url };
    } catch (err) {
      await client.end().catch(() => {});
    }
  }
  return null;
}

/**
 * Ensures that the Master database and tables ('SuperAdmin', 'Company') exist and are seeded.
 */
export async function ensureMasterDatabase() {
  const connection = await getWorkingMasterClient();
  if (!connection) {
    console.warn('[MasterDB] Notice: Could not connect to any master database candidate.');
    return false;
  }

  const { client, url } = connection;
  try {
    // 1. Ensure SuperAdmin table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "SuperAdmin" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT UNIQUE NOT NULL,
        "passwordHash" TEXT NOT NULL,
        "name" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Ensure Company table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Company" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "code" TEXT UNIQUE NOT NULL,
        "dbName" TEXT UNIQUE NOT NULL,
        "dbUrl" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "adminEmail" TEXT NOT NULL,
        "fullName" TEXT,
        "nricFin" TEXT,
        "phone" TEXT,
        "department" TEXT,
        "aiName" TEXT NOT NULL DEFAULT 'ARIA',
        "wakeWord" TEXT,
        "aiVoiceGender" TEXT DEFAULT 'FEMALE',
        "aiVoiceName" TEXT DEFAULT 'Veda',
        "aiVoiceRate" DOUBLE PRECISION DEFAULT 1.0,
        "aiVoicePitch" DOUBLE PRECISION DEFAULT 1.0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Ensure initial Super Admin account exists
    const adminCheck = await client.query('SELECT id, email FROM "SuperAdmin" LIMIT 1');
    if (adminCheck.rowCount === 0) {
      const email = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@skillbridge.com').toLowerCase().trim();
      const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!';
      const hash = await bcrypt.hash(password, 10);
      const id = crypto.randomUUID();

      await client.query(
        'INSERT INTO "SuperAdmin" ("id", "email", "passwordHash", "name") VALUES ($1, $2, $3, $4)',
        [id, email, hash, 'Global Super Admin']
      );
      console.log(`[MasterDB] Seeded initial Super Admin account: ${email}`);
    }

    console.log('[MasterDB] SuperAdmin and Company tables verified successfully.');
    return true;
  } catch (err) {
    console.error('[MasterDB] Error initializing master schema:', err.message);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Robust SuperAdmin finder that checks masterPrisma with automatic fallback to direct PostgreSQL.
 */
export async function findSuperAdminByEmail(email, masterPrisma) {
  const cleanEmail = email.toLowerCase().trim();

  // Try via masterPrisma if available
  if (masterPrisma && masterPrisma.superAdmin && typeof masterPrisma.superAdmin.findUnique === 'function') {
    try {
      const admin = await masterPrisma.superAdmin.findUnique({
        where: { email: cleanEmail }
      });
      if (admin) return admin;
    } catch (e) {
      console.warn('[MasterDB] Notice: masterPrisma query failed, falling back to direct SQL:', e.message);
    }
  }

  // Fallback to direct SQL
  const connection = await getWorkingMasterClient();
  if (!connection) return null;

  const { client } = connection;
  try {
    const res = await client.query(
      'SELECT id, email, "passwordHash", name FROM "SuperAdmin" WHERE LOWER(email) = $1 LIMIT 1',
      [cleanEmail]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[MasterDB] Direct SQL query error:', err.message);
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Robust SuperAdmin finder by ID.
 */
export async function findSuperAdminById(id, masterPrisma) {
  if (masterPrisma && masterPrisma.superAdmin && typeof masterPrisma.superAdmin.findUnique === 'function') {
    try {
      const admin = await masterPrisma.superAdmin.findUnique({ where: { id } });
      if (admin) return admin;
    } catch (_) {}
  }

  const connection = await getWorkingMasterClient();
  if (!connection) return null;

  const { client } = connection;
  try {
    const res = await client.query(
      'SELECT id, email, name, "createdAt" FROM "SuperAdmin" WHERE id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] || null;
  } catch (err) {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Robust SuperAdmin list query.
 */
export async function listAllSuperAdmins(masterPrisma) {
  if (masterPrisma && masterPrisma.superAdmin && typeof masterPrisma.superAdmin.findMany === 'function') {
    try {
      return await masterPrisma.superAdmin.findMany({
        select: { id: true, email: true, name: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
      });
    } catch (_) {}
  }

  const connection = await getWorkingMasterClient();
  if (!connection) return [];

  const { client } = connection;
  try {
    const res = await client.query(
      'SELECT id, email, name, "createdAt" FROM "SuperAdmin" ORDER BY "createdAt" DESC'
    );
    return res.rows;
  } catch (err) {
    return [];
  } finally {
    await client.end().catch(() => {});
  }
}
