import tenantService from '../services/tenantService.js';
import interactiveCourseService from '../services/interactiveCourseService.js';
import { stripSlidePlaceholders, cleanUnsupportedWords } from '../utils/contentQuality.js';

async function main() {
  console.log('[NatSteel Clean] Connecting to tenant client for premsai_p4p8...');
  const tenantClient = await tenantService.getTenantClient('premsai_p4p8');
  if (!tenantClient) {
    console.error('Could not get tenant client for premsai_p4p8');
    process.exit(1);
  }

  const courses = await tenantClient.course.findMany({
    select: {
      id: true,
      title: true,
      curriculum: true,
      fileName: true
    }
  });

  console.log(`[NatSteel Clean] Found ${courses.length} courses in premsai_p4p8.`);
  for (const c of courses) {
    console.log(`- Course ID: ${c.id}, Title: ${c.title}, FileName: ${c.fileName}`);
    if (c.curriculum && Array.isArray(c.curriculum.lessons)) {
      console.log(`  Total lessons: ${c.curriculum.lessons.length}`);
      let modified = false;
      for (let i = 0; i < c.curriculum.lessons.length; i++) {
        const lesson = c.curriculum.lessons[i];
        console.log(`  Lesson ${i + 1}: ${lesson.title}`);
        const originalExpl = lesson.explanation || '';
        const hasVisualNoise = originalExpl.includes('[Visual Content') || originalExpl.includes('Visual Content on:') || /([A-Za-z0-9_]{3,})\s+\1/.test(originalExpl) || originalExpl.includes('NatSteel NatSteel');
        
        console.log(`    Has visual/repetition noise: ${hasVisualNoise}, Length: ${originalExpl.length}`);
        if (hasVisualNoise || originalExpl.length < 50) {
          console.log(`    Cleaning lesson ${i + 1}...`);
          let cleaned = stripSlidePlaceholders(originalExpl);
          cleaned = cleanUnsupportedWords(cleaned);
          
          lesson.explanation = cleaned;
          modified = true;
          console.log(`    Cleaned explanation preview: ${cleaned.substring(0, 120)}...`);
        }
      }

      if (modified) {
        await tenantClient.course.update({
          where: { id: c.id },
          data: { curriculum: c.curriculum }
        });
        console.log(`[NatSteel Clean] Updated curriculum for course: ${c.title} (${c.id})`);
      } else {
        console.log(`[NatSteel Clean] No modifications needed for course: ${c.title}`);
      }
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[NatSteel Clean] Error:', err);
  process.exit(1);
});
