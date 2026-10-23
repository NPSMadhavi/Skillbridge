import prisma from '../config/prisma.js';

async function main() {
  const course = await prisma.course.findFirst({
    where: { title: { contains: '5S' } },
    select: { id: true }
  });
  const chunks = await prisma.courseChunk.findMany({
    where: { courseId: course.id },
    orderBy: { chunkIndex: 'asc' }
  });
  console.log(`Found ${chunks.length} chunks:`);
  chunks.forEach(c => {
    console.log(`\n--- Chunk #${c.chunkIndex} (Page/Slide: ${c.sourcePage}) ---`);
    console.log(`Topic: ${c.topic}`);
    console.log(`Subtopic: ${c.subtopic}`);
    console.log(`Concept: ${c.concept}`);
    console.log(`Text snippet: ${c.chunkText?.slice(0, 150)}...`);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
