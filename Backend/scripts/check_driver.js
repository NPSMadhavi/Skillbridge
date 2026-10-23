import prisma from '../config/prisma.js';

async function main() {
  const course = await prisma.course.findFirst({
    where: { title: { contains: 'Driver' } },
    include: { chunks: { orderBy: { chunkIndex: 'asc' } } }
  });
  console.log('Course ID:', course?.id);
  console.log('Course Title:', course?.title);
  console.log('Total Chunks:', course?.chunks?.length);
  console.log('Curriculum lessons count:', course?.curriculum?.lessons?.length);
  if (course?.curriculum?.lessons) {
    course.curriculum.lessons.forEach((l, i) => {
      console.log(`Lesson ${i + 1}: ${l.title} (Module: ${l.moduleTitle})`);
      console.log(`  Explanation snippet: ${l.explanation?.slice(0, 100)}...`);
    });
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
