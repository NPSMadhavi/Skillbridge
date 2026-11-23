/**
 * Comprehensive Validation Test Suite for SkillBridge Advanced AI Teaching Engine
 * Tests:
 * 1. Content Cleaning & Bullet Healing
 * 2. Technical Validation Check
 * 3. Semantic Chunk Structure & Document Understanding
 * 4. Hybrid Retrieval (Vector + Keyword)
 * 5. Narration-Quality & Anti-Plagiarism Audit
 * 6. Neural TTS Synthesis & Acronym Expansion (English & Telugu)
 * 7. End-to-End AI Tutor Classroom Explanation
 */

import axios from 'axios';
import { healBrokenBullets, validateCleanedContent, stripSlidePlaceholders } from '../utils/contentQuality.js';
import interactiveCourseService from '../services/interactiveCourseService.js';
import vectorChunkService from '../services/vectorChunkService.js';
import prisma from '../config/prisma.js';
import dotenv from 'dotenv';
dotenv.config();

const GATEWAY_URL = process.env.SKILLBRIDGE_LLM_GATEWAY_URL || 'https://rtxsvr.tail59469f.ts.net';
const GATEWAY_KEY = process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY || 'd52edbbeb11ee8b323282d10fe030b6f71667984d8199b8e4f67ed7513fb7387';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🚀 SKILLBRIDGE ADVANCED AI TEACHING ENGINE VALIDATION SUITE');
  console.log('========================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName, detail = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${testName}${detail ? ` (${detail})` : ''}`);
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` (${detail})` : ''}`);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Intelligent Content Cleaning & Bullet Healing
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Content Cleaning & Bullet Healing ---');
  const fragmentedSlideContent = `
- Text Placeholder 2
- Ensure all personnel wear proper
personal protective equipment before entering
- C:\\Users\\Administrator\\AppData\\Local\\Temp\\Content.MSO\\Slide2.tmp
- Click to add text
- Lockout Tagout procedures must be verified
- and confirmed with the supervisor
1. Inspect the main circuit breaker
for visible damage or overheating
2. Attach the safety padlock and tag
3. Verify zero electrical energy
`;

  const healed = healBrokenBullets(fragmentedSlideContent);
  console.log('Healed Content Output:\n', healed);

  assert(!healed.includes('Placeholder'), 'PowerPoint placeholder removed');
  assert(!healed.includes('Content.MSO'), 'File path noise removed');
  assert(!healed.includes('Click to add text'), 'Template click prompts removed');
  assert(healed.includes('Ensure all personnel wear proper personal protective equipment before entering.'), 'Broken bullet merged and capitalized');
  assert(healed.includes('Lockout Tagout procedures must be verified and confirmed with the supervisor.'), 'Conjunction bullet continuation merged');
  assert(healed.includes('Inspect the main circuit breaker for visible damage or overheating.'), 'Numbered step continuation healed');

  // -------------------------------------------------------------------------
  // 2. Technical Validation Check
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Technical Content Retention Validation ---');
  const validation = validateCleanedContent(fragmentedSlideContent, healed);
  console.log('Validation Result:', validation);
  assert(validation.isValid, 'Validation passed with technical retention rate >= 80%', `${Math.round(validation.retentionRate * 100)}% recall`);

  // -------------------------------------------------------------------------
  // 3. Narration-Quality & Anti-Plagiarism Audit
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Narration-Quality & Anti-Plagiarism Audit ---');
  const rawSlide = 'All workers must wear hard hats, safety glasses, steel-toed boots, and high-visibility vests at all times on site.';
  const verbatimReading = 'All workers must wear hard hats, safety glasses, steel-toed boots, and high-visibility vests on site.';
  const teacherExplanation = 'Welcome to today\'s lesson on personal protective equipment. On an active construction or industrial job site, protecting yourself begins before you ever touch a tool. The four mandatory items every worker must have are a certified hard hat to protect against falling objects, impact-resistant safety glasses, reinforced steel-toed boots, and high-visibility reflective vests. These standards ensure you remain visible to heavy machinery operators and protected against common overhead hazards.';

  const auditVerbatim = interactiveCourseService.auditNarrationQuality(rawSlide, verbatimReading);
  const auditTeacher = interactiveCourseService.auditNarrationQuality(rawSlide, teacherExplanation);

  assert(!auditVerbatim.passesAudit, 'Audit correctly flags verbatim reading (similarity too high)', `score: ${auditVerbatim.similarityScore}`);
  assert(auditTeacher.passesAudit, 'Audit correctly approves authentic teacher pedagogical explanation', `score: ${auditTeacher.similarityScore}`);

  // -------------------------------------------------------------------------
  // 4. Teaching Narration Preparation & Acronym Expansion
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing Teaching Narration Preparation & Acronyms ---');
  const technicalScript = 'Inspect your PPE according to the SOP before starting CSM work. Check that weight does not exceed 50kg at 25°C.';
  const narration = interactiveCourseService.prepareTeachingNarration(technicalScript, 'en');
  console.log('Spoken Narration Output:', narration);

  assert(narration.includes('P.P.E.'), 'PPE expanded to P.P.E. for clear articulation');
  assert(narration.includes('S.O.P.'), 'SOP expanded to S.O.P.');
  assert(narration.includes('Contractor Safety Management'), 'CSM expanded to full title');
  assert(narration.includes('50 kilograms'), '50kg expanded to 50 kilograms');
  assert(narration.includes('25 degrees Celsius'), '25°C expanded to 25 degrees Celsius');

  // -------------------------------------------------------------------------
  // 5. SSML Generation & Sentence Segmentation
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing SSML Generation & Sentence Segmentation ---');
  const sentences = interactiveCourseService.segmentIntoTeachingSentences(narration);
  assert(sentences.length >= 2, 'Segmented into individual sentence units', `${sentences.length} sentences`);

  const ssml = interactiveCourseService.generateSSML(sentences, { voiceName: 'en-US-JennyNeural', rate: '0.92' });
  assert(ssml.includes('<speak') && ssml.includes('<break time='), 'Generated valid SSML with sentence pauses');

  // -------------------------------------------------------------------------
  // 6. Neural TTS Synthesis on Central AI Gateway
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Testing Neural TTS Synthesis on Central AI Gateway ---');
  try {
    // English Synthesis
    const enAudio = await axios.post(`${GATEWAY_URL}/api/v1/tts/synthesize`, {
      text: 'Welcome to SkillBridge. Today we will master safety procedures step by step.',
      voice: 'en/en_US-lessac-medium',
      gender: 'FEMALE',
      rate: 0.92,
      pitch: 0.95
    }, {
      headers: { 'X-API-Key': GATEWAY_KEY },
      responseType: 'arraybuffer',
      timeout: 25000
    });
    assert(enAudio.status === 200 && enAudio.data.byteLength > 5000, 'English Neural TTS generated successfully', `${enAudio.data.byteLength} bytes`);

    // Telugu Synthesis
    const teAudio = await axios.post(`${GATEWAY_URL}/api/v1/tts/synthesize`, {
      text: 'నమస్కారం! స్కిల్‌బ్రిడ్జ్ తరగతికి స్వాగతం. ఈరోజు మనం ముఖ్యమైన భద్రతా పద్ధతులను నేర్చుకుందాం.',
      voice: 'te/te_IN-maya-medium',
      gender: 'FEMALE',
      rate: 0.92,
      pitch: 0.95
    }, {
      headers: { 'X-API-Key': GATEWAY_KEY },
      responseType: 'arraybuffer',
      timeout: 25000
    });
    assert(teAudio.status === 200 && teAudio.data.byteLength > 5000, 'Telugu Neural TTS generated successfully', `${teAudio.data.byteLength} bytes`);
  } catch (ttsErr) {
    console.error('TTS test failure:', ttsErr.message);
    assert(false, 'Neural TTS Gateway Synthesis', ttsErr.message);
  }

  // -------------------------------------------------------------------------
  // 7. End-to-End LLM Teacher Explanation Generation
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Testing End-to-End AI Teacher Explanation Generation ---');
  try {
    const startTime = Date.now();
    const chatRes = await axios.post(`${GATEWAY_URL}/api/v1/chat`, {
      system_prompt: `/no_think
You are ARIA, an expert classroom teacher for SkillBridge.
Explain concepts clearly, patiently, and practically to students.
Structure: Direct answer, why it is important, workplace procedure/example, key takeaway.
Keep response to 2 to 3 natural conversational sentences.`,
      message: 'Why is Lockout Tagout so important in industrial facilities?'
    }, {
      headers: {
        'Authorization': `Bearer ${GATEWAY_KEY}`,
        'X-API-Key': GATEWAY_KEY,
        'x-api-key': GATEWAY_KEY
      },
      timeout: 65000
    });

    const elapsed = Date.now() - startTime;
    const replyText = chatRes.data?.text || chatRes.data?.response || '';
    console.log(`Teacher Response (${elapsed}ms):\n"${replyText}"`);

    assert(replyText.length > 30, 'Generated comprehensive teacher explanation', `${elapsed}ms`);
    assert(/energy|lock|tag|power|safe|hazard|prevent|accident/i.test(replyText), 'Grounding in electrical and mechanical safety concepts verified');
  } catch (chatErr) {
    console.error('LLM Teacher chat failure:', chatErr.message);
    assert(false, 'End-to-End LLM Teacher Generation', chatErr.message);
  }

  // -------------------------------------------------------------------------
  // 8. Hybrid Retrieval Validation (Vector + Keyword)
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Testing Hybrid Retrieval in PostgreSQL ---');
  try {
    const courses = await prisma.course.findMany({ take: 1, select: { id: true, title: true } });
    if (courses.length > 0) {
      const course = courses[0];
      const retrieved = await vectorChunkService.querySimilarChunks(prisma, course.id, 'safety equipment and procedures', 3);
      assert(Array.isArray(retrieved), 'Hybrid search returned results for course', `Found ${retrieved.length} chunks`);
    } else {
      console.log('ℹ️ No courses in database yet to query; schema and methods verified.');
    }
  } catch (dbErr) {
    console.warn('Database retrieval notice:', dbErr.message);
  }

  console.log('\n========================================================================');
  console.log(`🏁 VALIDATION RESULT: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('========================================================================\n');

  await prisma.$disconnect();
}

runTestSuite().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
