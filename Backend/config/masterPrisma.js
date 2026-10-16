import { PrismaClient } from '@prisma/master-client';
import dotenv from 'dotenv';
dotenv.config();

const masterDatabaseUrl = process.env.MASTER_DATABASE_URL || 'postgresql://postgres:praveen@localhost:5432/skillbridge_master?schema=public';

const masterPrisma = new PrismaClient({
  datasources: {
    db: {
      url: masterDatabaseUrl
    }
  }
});

export default masterPrisma;
