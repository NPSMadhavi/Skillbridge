import prisma from '../config/prisma.js';

async function main() {
  const course = await prisma.course.findFirst({
    where: { title: { contains: '5S' } },
    select: { id: true, title: true, curriculum: true }
  });
  console.log('Course ID:', course?.id);
  console.log('Course Title:', course?.title);
  console.log('Curriculum lessons count:', course?.curriculum?.lessons?.length);
  if (course?.curriculum?.lessons) {
    course.curriculum.lessons.forEach((l, idx) => {
      console.log(`Curriculum Lesson #${idx + 1}: [ID: ${l.id}] ${l.title} (Module: ${l.moduleTitle}, Slides: ${JSON.stringify(l.sourceSlides)})`);
    });
  }

  const chunks = await prisma.courseChunk.findMany({
    where: { courseId: course?.id },
    orderBy: { chunkIndex: 'asc' },
    select: { id: true, chunkIndex: true, topic: true, subtopic: true, concept: true, sourcePage: true, sourceSlides: true }
  });
  console.log('\nTotal chunks in CourseChunk table:', chunks.length);
  chunks.forEach(c => console.log(`[#${c.chunkIndex} slide:${c.sourcePage || JSON.stringify(c.sourceSlides)}] Topic: "${c.topic}" | Subtopic: "${c.subtopic}" | Concept: "${c.concept}"`));
}
main().catch(console.error).finally(() => prisma.$disconnect());
