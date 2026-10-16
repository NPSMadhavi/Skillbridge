import { PrismaClient } from '@prisma/master-client';
import dotenv from 'dotenv';
dotenv.config();

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
