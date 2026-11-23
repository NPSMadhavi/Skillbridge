import bcrypt from 'bcryptjs';
import masterPrisma from '../config/masterPrisma.js';
import prisma from '../config/prisma.js';
import { tenantService } from '../services/tenantService.js';

async function cleanReset() {
  console.log('=== STARTING DATABASE CLEAN & RESET ===');

  // 1. Clean non-default companies from Master DB
  console.log('[1/4] Cleaning test tenant companies...');
  const companies = await masterPrisma.company.findMany();
  for (const comp of companies) {
    if (comp.code !== 'default') {
      console.log(`  Deleting test company "${comp.name}" (${comp.code})...`);
      try {
        await tenantService.deleteCompany(comp.id, { dropDatabase: true });
        console.log(`  Successfully deleted company and dropped db: ${comp.dbName}`);
      } catch (err) {
        console.warn(`  Failed to delete company ${comp.name}:`, err.message);
      }
    }
  }

  // 2. Reset Super Admin credentials in Master DB
  console.log('[2/4] Resetting Super Admin credentials...');
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@skillbridge.com').toLowerCase().trim();
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!';
  const superAdminName = 'Global Super Admin';
  const superAdminHash = await bcrypt.hash(superAdminPassword, 10);

  await masterPrisma.superAdmin.upsert({
    where: { email: superAdminEmail },
    update: {
      passwordHash: superAdminHash,
      name: superAdminName
    },
    create: {
      email: superAdminEmail,
      passwordHash: superAdminHash,
      name: superAdminName
    }
  });
  console.log(`  Super Admin ready: ${superAdminEmail} / ${superAdminPassword}`);

  // 3. Clean default tenant database data (courses, users, chunks)
  console.log('[3/4] Cleaning default tenant database records...');
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "CourseChunk", "CourseProgress", "UserCourseAssignment", "Course" CASCADE;`);
    console.log('  Cleaned courses and vector chunks.');
  } catch (err) {
    console.log('  Course cleanup notice:', err.message);
  }

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE;`);
    console.log('  Cleaned test users.');
  } catch (err) {
    console.log('  User cleanup notice:', err.message);
  }

  // 4. Reset Default Tenant Admin
  console.log('[4/4] Setting default tenant Admin...');
  const tenantAdminEmail = (process.env.ADMIN_EMAIL || 'admin@skillbridge.com').toLowerCase().trim();
  const tenantAdminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';
  const tenantAdminHash = await bcrypt.hash(tenantAdminPassword, 12);

  await prisma.admin.upsert({
    where: { email: tenantAdminEmail },
    update: {
      passwordHash: tenantAdminHash
    },
    create: {
      email: tenantAdminEmail,
      passwordHash: tenantAdminHash
    }
  });
  console.log(`  Tenant Admin ready: ${tenantAdminEmail} / ${tenantAdminPassword}`);

  // Ensure default company structure in master DB
  await tenantService.ensureDefaultCompany();

  console.log('=== DATABASE CLEAN & RESET COMPLETE ===');
}

cleanReset()
  .catch((err) => {
    console.error('Fatal error during clean reset:', err);
    process.exit(1);
  })
  .finally(async () => {
    await masterPrisma.$disconnect();
    await prisma.$disconnect();
  });
