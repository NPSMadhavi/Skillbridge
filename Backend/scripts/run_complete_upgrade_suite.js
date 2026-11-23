import assert from 'assert';
import fs from 'fs';
import path from 'path';
import microsoftNeuralTts, { VOICE_CONFIG, PRONUNCIATION_DICTIONARY } from '../services/microsoftNeuralTtsService.js';
import interactiveCourseService from '../services/interactiveCourseService.js';
import { stripSlidePlaceholders, healBrokenBullets, validateCleanedContent, cleanUnsupportedWords } from '../utils/contentQuality.js';

const OUTPUT_DIR = path.join(process.cwd(), 'Backend', 'scripts', 'test_audio_output');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runFullUpgradeSuite() {
  console.log('========================================================================');
  console.log('🚀 SKILLBRIDGE COMPLETE AI TUTOR & VOICE ENGINE UPGRADE VALIDATION');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Content Cleaning & Placeholder Removal Tests
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing OCR & PowerPoint Placeholder Removal ---');
  await test('Strips PowerPoint placeholders, font metadata, and Content.MSO paths', () => {
    const raw = `
- Text Placeholder 2
- Date Placeholder
- Slide Number Placeholder 5
Click to add title
C:\\Users\\Administrator\\AppData\\Local\\Temp\\Content.MSO\\image001.png
MS PGothic Times New Roman DocumentSummaryInformation
- Ensure all workers wear safety helmets on the shop floor.
`;
    const cleaned = stripSlidePlaceholders(raw);
    assert(!cleaned.includes('Placeholder'), 'Must not contain Placeholder');
    assert(!cleaned.includes('Click to add'), 'Must not contain Click to add');
    assert(!cleaned.includes('Content.MSO'), 'Must not contain Content.MSO');
    assert(!cleaned.includes('MS PGothic'), 'Must not contain font metadata');
    assert(!cleaned.includes('DocumentSummaryInformation'), 'Must not contain DocumentSummaryInformation');
    assert(cleaned.includes('Ensure all workers wear safety helmets on the shop floor'), 'Must preserve educational content');
  });

  // -------------------------------------------------------------------------
  // 2. Intelligent Bullet Healing Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Intelligent Bullet Healing ---');
  await test('Heals sentences split across multiple visual lines and lowercase continuations', () => {
    const broken = `
- Inspect all electrical cables
and verify insulation integrity before powering on.
- Always apply LOTO procedures
in order to prevent unexpected energization.
- Do not bypass safety interlocks.
`;
    const healed = healBrokenBullets(broken);
    // Should merge first 2 lines into one complete sentence
    assert(healed.includes('Inspect all electrical cables and verify insulation integrity before powering on.'), 'Should heal line broken by "and"');
    assert(healed.includes('Always apply LOTO procedures in order to prevent unexpected energization.'), 'Should heal line broken by "in order to"');
    assert(healed.includes('Do not bypass safety interlocks.'), 'Independent bullet must be preserved');
  });

  await test('Preserves tables, headings, and numbered procedures during healing', () => {
    const content = `
### Core Safety Guidelines
| Hazard | Risk Level | Control Measure |
| Shock | High | GFCI breaker |
1. Isolate the main power source.
2. Lock and tag out the breaker.
`;
    const healed = healBrokenBullets(content);
    assert(healed.includes('### Core Safety Guidelines'), 'Must preserve markdown headings');
    assert(healed.includes('| Hazard | Risk Level | Control Measure |'), 'Must preserve table rows');
    assert(healed.includes('1. Isolate the main power source.'), 'Must preserve numbered step 1');
    assert(healed.includes('2. Lock and tag out the breaker.'), 'Must preserve numbered step 2');
  });

  await test('Multilingual Indic bullet healing with danda terminal punctuation', () => {
    const hindiBroken = `
- कार्यस्थल पर सुरक्षा उपकरण पहनना अनिवार्य है
तथा आपातकालीन निकास को हमेशा खुला रखें
`;
    const healed = healBrokenBullets(hindiBroken);
    assert(healed.includes('तथा'), 'Should retain Hindi connector');
    assert(healed.endsWith('।'), 'Should append Hindi danda punctuation');
  });

  // -------------------------------------------------------------------------
  // 3. Technical Acronym & Measurement Unit Expansions
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Technical Acronym & Unit Expansions ---');
  await test('Expands PPE, SOP, OSHA, LOTO, ISO 45001, dB, and kPa naturally', () => {
    const raw = 'Strictly follow SOP and ensure PPE is worn under OSHA guidelines and ISO 45001. Always apply LOTO procedures. Sound level must not exceed 85 dB at 150 kPa.';
    const speech = interactiveCourseService.prepareTeachingNarration(raw, 'en');
    assert(speech.includes('Personal Protective Equipment'), 'PPE must expand');
    assert(speech.includes('Standard Operating Procedure'), 'SOP must expand');
    assert(speech.includes('O-SHA'), 'OSHA must expand');
    assert(speech.includes('Lockout Tagout'), 'LOTO must expand');
    assert(speech.includes('I-S-O forty-five thousand and one'), 'ISO 45001 must expand');
    assert(speech.includes('85 decibels'), 'dB must expand');
    assert(speech.includes('150 kilopascals'), 'kPa must expand');
    assert(!speech.includes('(') && !speech.includes(')'), 'Must not have robotic parentheses');
  });

  // -------------------------------------------------------------------------
  // 4. Narration Quality Audit Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing Narration Quality Audit ---');
  await test('Flags verbatim slide repetition (> 70% overlap)', () => {
    const slide = 'Wear helmet and safety boots on site at all times';
    const verbatimNarration = 'Wear helmet and safety boots on site at all times';
    const audit = interactiveCourseService.auditNarrationQuality(slide, verbatimNarration);
    assert.strictEqual(audit.passesAudit, false, 'Verbatim recitation must fail audit');
    assert(audit.similarityScore >= 0.70, 'Similarity score must be >= 70%');
  });

  await test('Passes explanatory teacher narration (< 70% overlap)', () => {
    const slide = 'Wear helmet and safety boots on site at all times';
    const teacherNarration = 'When stepping onto the construction floor, protecting yourself against falling debris and sharp objects is our highest priority. Therefore, every single worker must securely fasten their protective hard hat and steel-toed footwear before beginning daily operations.';
    const audit = interactiveCourseService.auditNarrationQuality(slide, teacherNarration);
    assert.strictEqual(audit.passesAudit, true, 'Explanatory teacher narration must pass audit');
    assert(audit.similarityScore < 0.70, 'Similarity score must be under threshold');
  });

  // -------------------------------------------------------------------------
  // 5. Microsoft Edge Neural Voice Matrix (12 Voices: 6 Languages × 2 Genders)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing Microsoft Edge Neural 12-Voice Synthesis Matrix ---');
  const voiceSuite = [
    { lang: 'en', gender: 'FEMALE', voice: 'en-US-JennyNeural', text: 'Welcome to SkillBridge safety training. Today we will master standard operating procedures.', file: 'test_en_female.mp3' },
    { lang: 'en', gender: 'MALE', voice: 'en-US-ChristopherNeural', text: 'Please ensure your personal protective equipment is inspected before entering the manufacturing zone.', file: 'test_en_male.mp3' },
    { lang: 'zh', gender: 'FEMALE', voice: 'zh-CN-XiaoxiaoNeural', text: '欢迎来到安全培训课堂。在开始高空作业前，必须系好安全带。', file: 'test_zh_female.mp3' },
    { lang: 'zh', gender: 'MALE', voice: 'zh-CN-YunxiNeural', text: '遵守操作规程是每一位施工人员保障自身安全的第一准则。', file: 'test_zh_male.mp3' },
    { lang: 'ms', gender: 'FEMALE', voice: 'ms-MY-YasminNeural', text: 'Selamat datang ke sesi pembelajaran keselamatan industri SkillBridge.', file: 'test_ms_female.mp3' },
    { lang: 'ms', gender: 'MALE', voice: 'ms-MY-OsmanNeural', text: 'Pematuhan kepada prosedur keselamatan adalah tanggungjawab bersama di tempat kerja.', file: 'test_ms_male.mp3' },
    { lang: 'ta', gender: 'FEMALE', voice: 'ta-IN-PallaviNeural', text: 'வணக்கம் மாணவர்களே! தொழில் பாதுகாப்பு பயிற்சி வகுப்பிற்கு உங்களை வரவேற்கிறோம்.', file: 'test_ta_female.mp3' },
    { lang: 'ta', gender: 'MALE', voice: 'ta-IN-ValluvarNeural', text: 'பணியிடத்தில் பாதுகாப்பு விதிமுறைகளை முழுமையாகப் பின்பற்றுவது மிக அவசியமாகும்.', file: 'test_ta_male.mp3' },
    { lang: 'te', gender: 'FEMALE', voice: 'te-IN-ShrutiNeural', text: 'నమస్కారం! స్కిల్‌బ్రిడ్జ్ పారిశ్రామిక భద్రతా శిక్షణ తరగతికి స్వాగతం.', file: 'test_te_female.mp3' },
    { lang: 'te', gender: 'MALE', voice: 'te-IN-MohanNeural', text: 'పని ప్రదేశంలో ప్రమాదాలు జరగకుండా ప్రతి ఒక్కరూ భద్రతా నియమాలను పాటించాలి.', file: 'test_te_male.mp3' },
    { lang: 'bn', gender: 'FEMALE', voice: 'bn-IN-TanishaaNeural', text: 'দক্ষতা বৃদ্ধি ও কর্মক্ষেত্র সুরক্ষা প্রশিক্ষণ ক্লাসে আপনাদের সকলকে স্বাগতম।', file: 'test_bn_female.mp3' },
    { lang: 'bn', gender: 'MALE', voice: 'bn-IN-BashkarNeural', text: 'কর্মক্ষেত্রে সর্বদা সুরক্ষা সরঞ্জাম এবং স্বাস্থ্য নির্দেশিকা যথাযথভাবে মেনে চলুন।', file: 'test_bn_male.mp3' }
  ];

  for (const item of voiceSuite) {
    await test(`${item.lang.toUpperCase()} ${item.gender} -> ${item.voice}`, async () => {
      const res = await microsoftNeuralTts.synthesizeAudio(item.text, {
        language: item.lang,
        gender: item.gender
      });
      assert(res.buffer && res.buffer.length > 5000, `Buffer too small: ${res.buffer?.length}`);
      assert.strictEqual(res.contentType, 'audio/mpeg');
      assert.strictEqual(res.voice, item.voice);
      fs.writeFileSync(path.join(OUTPUT_DIR, item.file), res.buffer);
      console.log(`   -> Generated ${res.buffer.length} bytes MP3 (${item.file})`);
    });
  }

  // -------------------------------------------------------------------------
  // 6. Audio Cache & Long Lesson Chunking Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Testing Cache & Long Lecture Chunking ---');
  await test('Instant sub-10ms cache retrieval for repeated query', async () => {
    const t0 = Date.now();
    const res = await microsoftNeuralTts.synthesizeAudio('Welcome to SkillBridge safety training. Today we will master standard operating procedures.', {
      language: 'en',
      gender: 'FEMALE'
    });
    const dur = Date.now() - t0;
    assert.strictEqual(res.fromCache, true);
    assert(dur < 15, `Expected < 15ms cache response, got ${dur}ms`);
    console.log(`   -> Cache HIT returned in ${dur}ms (fromCache=true)`);
  });

  await test('Seamless long lecture chunking (> 1100 characters)', async () => {
    const longLecture = `
In today's comprehensive industrial operations module, we will thoroughly examine the foundational elements of machine maintenance, electrical isolation, and hazardous substance management.
First, whenever performing maintenance on high-voltage machinery, every single technician must strictly execute the Lockout Tagout protocol. This ensures that electrical, pneumatic, and hydraulic energy sources are completely dissipated before any hands touch mechanical parts.
Next, all personnel entering the operating perimeter must be fully equipped with approved Personal Protective Equipment. This includes hard hats tested to impact standards, high-visibility reflective vests, safety glasses with side shields, and steel-toed puncture-resistant boots.
Furthermore, routine daily inspections must be logged accurately in the station maintenance ledger. If any component exhibits abnormal vibration, temperature spikes above 65 degrees Celsius, or unusual decibel emissions exceeding 85 decibels, immediate shutdown and notification of the floor supervisor is mandatory.
Finally, regular emergency drills ensure that every team member knows the primary and secondary evacuation corridors, the location of automated external defibrillators, and the nearest eyewash stations.
`;
    const res = await microsoftNeuralTts.synthesizeAudio(longLecture, {
      language: 'en',
      gender: 'FEMALE'
    });
    assert(res.buffer && res.buffer.length > 50000, `Long audio buffer expected > 50000 bytes, got ${res.buffer?.length}`);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'test_long_lecture.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes for multi-chunk lecture (Saved: test_long_lecture.mp3)`);
  });

  console.log('\n========================================================================');
  console.log(`🏁 UPGRADE TEST SUITE SUMMARY: ${passed} / ${total} TESTS PASSED`);
  console.log('========================================================================');
  if (passed === total) {
    console.log('🎉 ALL SUITE VALIDATIONS PASSED WITH ZERO ERRORS!');
  } else {
    process.exit(1);
  }
}

runFullUpgradeSuite().catch(console.error);
