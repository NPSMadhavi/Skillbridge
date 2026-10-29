import bcrypt from 'bcryptjs';
import masterPrisma from '../config/masterPrisma.js';
import { tenantService } from '../services/tenantService.js';

async function main() {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@skillbridge.com';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!';
  const superAdminName = 'Global Super Admin';

  console.log('--- Seeding Super Admin ---');

  const existing = await masterPrisma.superAdmin.findUnique({
    where: { email: superAdminEmail }
  });

  if (!existing) {
    const passwordHash = await bcrypt.hash(superAdminPassword, 10);
    const created = await masterPrisma.superAdmin.create({
      data: {
        email: superAdminEmail,
        passwordHash,
        name: superAdminName
      }
    });
    console.log(`[Success] Created Super Admin: ${created.email}`);
    console.log(`[Credentials] Super Admin account ready: ${superAdminEmail}`);
  } else {
    console.log(`[Info] Super Admin already exists: ${existing.email}`);
  }

  // Ensure default company exists in Master DB
  await tenantService.ensureDefaultCompany();
  console.log('--- Multi-Tenant Master Seed Complete ---');
}

main()
  .catch((err) => {
    console.error('Super Admin seed error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await masterPrisma.$disconnect();
  });

