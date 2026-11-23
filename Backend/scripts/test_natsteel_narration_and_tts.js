import tenantService from '../services/tenantService.js';
import interactiveCourseService from '../services/interactiveCourseService.js';
import microsoftNeuralTts from '../services/microsoftNeuralTtsService.js';
import assert from 'assert';

async function testNatSteel() {
  console.log('--- Testing NatSteel Lesson Narration & TTS ---');
  const tenantClient = await tenantService.getTenantClient('premsai_p4p8');
  const course = await tenantClient.course.findFirst({
    where: { title: { contains: 'Safety' } },
    select: { id: true, title: true, curriculum: true }
  });

  assert(course, 'Course must exist');
  console.log(`Found Course: ${course.title} (${course.id})`);
  
  const lesson = course.curriculum.lessons[0];
  console.log(`Testing Lesson 1: "${lesson.title}"`);
  console.log(`Explanation length: ${lesson.explanation.length}`);

  // 1. Verify no visual noise or repeated slide titles
  assert(!lesson.explanation.includes('[Visual Content'), 'Must not contain [Visual Content');
  assert(!lesson.explanation.includes('Visual Content on:'), 'Must not contain Visual Content on:');
  assert(!/NatSteel\s+NatSteel/i.test(lesson.explanation), 'Must not contain repeated tokens "NatSteel NatSteel"');
  console.log('✅ Content verification passed: Clean of visual metadata and repeated titles.');

  // 2. Intelligent Teaching Paragraph Segmentation
  const segments = interactiveCourseService.segmentIntoTeachingSentences(lesson.explanation, 'en');
  console.log(`Total teaching segments: ${segments.length}`);
  assert(segments.length > 0, 'Must have at least one teaching segment');
  
  for (let i = 0; i < Math.min(3, segments.length); i++) {
    console.log(`  Segment ${i + 1}: "${segments[i]}"`);
    assert(segments[i].length > 10, 'Segment must not be a tiny fragment');
    assert(!segments[i].startsWith(','), 'Segment must not start with comma');
  }
  console.log('✅ Intelligent teaching segmentation passed.');

  // 3. Microsoft Neural TTS Synthesis
  console.log('Testing TTS synthesis on Segment 1...');
  const result = await microsoftNeuralTts.synthesizeAudio(segments[0], {
    language: 'en',
    gender: 'FEMALE',
    rate: 0.95,
    pitch: 1.0
  });

  assert(result && result.buffer, 'Audio buffer must be returned');
  assert(result.buffer.length > 1000, 'Audio buffer must have valid size');
  assert.strictEqual(result.voice, 'en-US-JennyNeural', 'Voice must be en-US-JennyNeural');
  console.log(`✅ Neural TTS synthesis passed: ${result.buffer.length} bytes using ${result.voice}`);

  console.log('\n🎉 ALL NATSTEEL CHECKS COMPLETED SUCCESSFULLY!');
  process.exit(0);
}

testNatSteel().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
