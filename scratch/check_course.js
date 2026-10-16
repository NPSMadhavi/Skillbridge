import prisma from '../Backend/config/prisma.js';

async function main() {
  const course = await prisma.course.findUnique({
    where: { id: '60f9da04-d8e8-43cd-8d6d-17c882c9e1ae' }
  });
  if (!course) {
    console.log('Course not found');
    return;
  }
  console.log('Course Title:', course.title);
  const lessons = course.curriculum?.lessons || [];
  console.log('Total lessons:', lessons.length);
  lessons.forEach((l, i) => {
    console.log(`L${i+1} [id=${l.id}]: "${l.title}" (slideNumber: ${l.slideNumber || l.sourceSlides?.[0] || 'none'})`);
  });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
