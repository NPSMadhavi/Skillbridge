import masterPrisma from '../config/masterPrisma.js';

async function ensureAllColumns() {
  try {
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aiName" TEXT DEFAULT 'ARIA';`);
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "wakeWord" TEXT;`);
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aiVoiceGender" TEXT DEFAULT 'FEMALE';`);
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aiVoiceName" TEXT DEFAULT 'Veda';`);
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aiVoiceRate" REAL DEFAULT 1.0;`);
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aiVoicePitch" REAL DEFAULT 1.0;`);
    await masterPrisma.$executeRawUnsafe(`UPDATE "Company" SET "aiName" = 'ARIA' WHERE "aiName" IS NULL;`);
    console.log('All Company AI & Voice columns ensured successfully.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

ensureAllColumns();
