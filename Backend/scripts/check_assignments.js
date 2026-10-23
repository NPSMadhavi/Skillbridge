import prisma from '../config/prisma.js';

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  console.log('Users in DB:', users);
  const assignments = await prisma.userCourseAssignment.findMany();
  console.log('Assignments in DB:', assignments);
}

main().finally(() => prisma.$disconnect());
