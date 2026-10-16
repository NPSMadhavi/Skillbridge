import masterPrisma from '../config/masterPrisma.js';

async function updateCompanyTable() {
  try {
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aiName" TEXT DEFAULT 'ARIA';`);
    await masterPrisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "wakeWord" TEXT;`);
    await masterPrisma.$executeRawUnsafe(`UPDATE "Company" SET "aiName" = 'ARIA' WHERE "aiName" IS NULL;`);
    console.log('Successfully added aiName and wakeWord columns to master Company table.');
    
    const companies = await masterPrisma.company.findMany();
    console.log('Current companies with AI settings:');
    console.log(companies.map(c => ({ code: c.code, name: c.name, aiName: c.aiName })));
    process.exit(0);
  } catch (err) {
    console.error('Error updating master Company table:', err);
    process.exit(1);
  }
}

updateCompanyTable();
