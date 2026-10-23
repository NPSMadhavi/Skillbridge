import prisma from '../config/prisma.js';

async function main() {
  const course = await prisma.course.findFirst({
    where: { title: { contains: '5S' } },
    select: { id: true, curriculum: true }
  });
  console.log('Total Slides:', course.curriculum?.slides?.length);
  course.curriculum?.slides?.forEach(s => {
    console.log(`Slide ${s.slideNumber}: "${s.title}"`);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
