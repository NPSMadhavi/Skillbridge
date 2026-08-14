import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@skillbridge.com';
  const adminPassword = 'AdminPassword123';

  // Check if admin already exists
  const existingAdmin = await prisma.admin.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const newAdmin = await prisma.admin.create({
      data: {
        email: adminEmail,
        passwordHash: passwordHash
      }
    });
    console.log(`Seeded admin user: ${newAdmin.email}`);
  } else {
    console.log(`Admin user already exists: ${existingAdmin.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
