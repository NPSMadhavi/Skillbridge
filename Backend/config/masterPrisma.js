import dotenv from 'dotenv';
dotenv.config();

let PrismaClient;
try {
  // 1. Direct path within Backend node_modules (most reliable in ESM)
  const masterModule = await import('../node_modules/@prisma/master-client/index.js');
  PrismaClient = masterModule.PrismaClient;
} catch (e1) {
  try {
    // 2. Package-specifier fallback
    const masterModule = await import('@prisma/master-client');
    PrismaClient = masterModule.PrismaClient;
  } catch (e2) {
    console.warn('[MasterPrisma] Warning: @prisma/master-client not found, falling back to default PrismaClient:', e2.message);
    const defaultModule = await import('@prisma/client');
    PrismaClient = defaultModule.PrismaClient;
  }
}

function getMasterDbUrl() {
  if (process.env.MASTER_DATABASE_URL) {
    return process.env.MASTER_DATABASE_URL;
  }
  if (process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      u.pathname = '/skillbridge_master';
      return u.toString();
    } catch (_) {}
  }
  return 'postgresql://postgres:Premsai%40123@localhost:5433/skillbridge_master?schema=public';
}

const masterDatabaseUrl = getMasterDbUrl();

const masterPrisma = new PrismaClient({
  datasources: {
    db: {
      url: masterDatabaseUrl
    }
  }
});

export default masterPrisma;
