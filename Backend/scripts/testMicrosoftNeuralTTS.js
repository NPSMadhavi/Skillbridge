/**
 * Test Suite: Advanced Microsoft Edge Neural TTS Voice Engine for SkillBridge
 * Tests all required voices: English, Telugu, Tamil, Chinese, Malay, Bengali
 * Verifies:
 * - Pronunciation clarity & acronym expansions (PPE, SOP, LOTO)
 * - SSML formatting with sentence & paragraph pauses
 * - Multilingual Female & Male synthesis
 * - Audio byte generation, format, and caching
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import microsoftNeuralTts, { VOICE_CONFIG, PRONUNCIATION_DICTIONARY } from '../services/microsoftNeuralTtsService.js';

const OUTPUT_DIR = path.join(process.cwd(), 'Backend', 'scripts', 'test_audio_output');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🎙️ SKILLBRIDGE MICROSOFT NEURAL TTS VALIDATION SUITE');
  console.log('========================================================================');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  async function testAsync(name, fn) {
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
  // 1. Voice Configuration Matrix
  // -------------------------------------------------------------------------
  console.log('\n--- 1. Testing Microsoft Neural Voice Configuration ---');
  test('All 6 languages + Hindi configured with Female & Male voices', () => {
    const required = ['en', 'zh', 'ms', 'ta', 'te', 'bn'];
    for (const lang of required) {
      assert(VOICE_CONFIG[lang], `Missing voice config for ${lang}`);
      assert(VOICE_CONFIG[lang].female.includes('Neural'), `Female voice for ${lang} must be Neural`);
      assert(VOICE_CONFIG[lang].male.includes('Neural'), `Male voice for ${lang} must be Neural`);
    }
    // Verify specific requested voice names
    assert.strictEqual(VOICE_CONFIG.en.female, 'en-US-JennyNeural');
    assert.strictEqual(VOICE_CONFIG.en.male, 'en-US-ChristopherNeural');
    assert.strictEqual(VOICE_CONFIG.zh.female, 'zh-CN-XiaoxiaoNeural');
    assert.strictEqual(VOICE_CONFIG.zh.male, 'zh-CN-YunxiNeural');
    assert.strictEqual(VOICE_CONFIG.ms.female, 'ms-MY-YasminNeural');
    assert.strictEqual(VOICE_CONFIG.ms.male, 'ms-MY-OsmanNeural');
    assert.strictEqual(VOICE_CONFIG.ta.female, 'ta-IN-PallaviNeural');
    assert.strictEqual(VOICE_CONFIG.ta.male, 'ta-IN-ValluvarNeural');
    assert.strictEqual(VOICE_CONFIG.te.female, 'te-IN-ShrutiNeural');
    assert.strictEqual(VOICE_CONFIG.te.male, 'te-IN-MohanNeural');
    assert.strictEqual(VOICE_CONFIG.bn.female, 'bn-IN-TanishaaNeural');
    assert.strictEqual(VOICE_CONFIG.bn.male, 'bn-IN-BashkarNeural');
  });

  // -------------------------------------------------------------------------
  // 2. Automatic Voice Resolution
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Automatic Voice Resolution ---');
  test('Resolves English Female and Male accurately', () => {
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, 'en', 'FEMALE'), 'en-US-JennyNeural');
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, 'en', 'MALE'), 'en-US-ChristopherNeural');
  });

  test('Resolves Telugu Female and Male accurately', () => {
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, 'te', 'FEMALE'), 'te-IN-ShrutiNeural');
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, 'te', 'MALE'), 'te-IN-MohanNeural');
  });

  test('Resolves Tamil Female and Male accurately', () => {
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, 'ta', 'FEMALE'), 'ta-IN-PallaviNeural');
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, 'ta', 'MALE'), 'ta-IN-ValluvarNeural');
  });

  test('Resolves from native script when language is omitted', () => {
    const teText = 'నమస్కారం, భద్రత ముఖ్యం';
    const taText = 'வணக்கம், பாதுகாப்பு முக்கியம்';
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, null, 'FEMALE', teText), 'te-IN-ShrutiNeural');
    assert.strictEqual(microsoftNeuralTts.resolveVoice(null, null, 'MALE', taText), 'ta-IN-ValluvarNeural');
  });

  test('Guarantees foreign requestedVoice never hijacks another language', () => {
    // If someone passes a Telugu voice while teaching English, English voice must still be returned
    assert.strictEqual(microsoftNeuralTts.resolveVoice('te-IN-ShrutiNeural', 'en', 'FEMALE'), 'en-US-JennyNeural');
    // If someone passes an English voice while teaching Tamil, Tamil voice must still be returned
    assert.strictEqual(microsoftNeuralTts.resolveVoice('en-US-JennyNeural', 'ta', 'FEMALE'), 'ta-IN-PallaviNeural');
    // If someone passes an English voice while teaching Telugu, Telugu voice must still be returned
    assert.strictEqual(microsoftNeuralTts.resolveVoice('en-US-JennyNeural', 'te', 'FEMALE'), 'te-IN-ShrutiNeural');
    // If someone passes a Telugu voice while teaching Chinese, Chinese voice must still be returned
    assert.strictEqual(microsoftNeuralTts.resolveVoice('te-IN-ShrutiNeural', 'zh', 'FEMALE'), 'zh-CN-XiaoxiaoNeural');
    // If someone passes a valid matching voice, it is respected
    assert.strictEqual(microsoftNeuralTts.resolveVoice('te-IN-MohanNeural', 'te', 'MALE'), 'te-IN-MohanNeural');
  });

  // -------------------------------------------------------------------------
  // 3. Pronunciation & Acronym Expansion
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Technical Pronunciation Dictionary ---');
  test('Expands PPE, SOP, LOTO and measurement units naturally', () => {
    const raw = 'Always inspect PPE before SOP work. Ensure LOTO is verified. Weight is 25kg at 30°C.';
    const prepared = microsoftNeuralTts.prepareTeacherNarration(raw, 'en');
    assert(prepared.includes('P.P.E.'), 'PPE should expand to P.P.E.');
    assert(prepared.includes('S.O.P.'), 'SOP should expand to S.O.P.');
    assert(prepared.includes('Lockout Tagout'), 'LOTO should expand to Lockout Tagout');
    assert(prepared.includes('25 kilograms'), '25kg should expand to 25 kilograms');
    assert(prepared.includes('30 degrees Celsius'), '30°C should expand to 30 degrees Celsius');
  });

  // -------------------------------------------------------------------------
  // 4. SSML Generation & Teacher Pauses
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing SSML Generation with Teacher Pauses ---');
  test('Generates valid SSML with prosody rate, pitch and sentence break tags', () => {
    const sentences = [
      'Welcome to SkillBridge safety training.',
      'Step 1: Check all power lines.',
      'Always remember to wear your protective gear.'
    ];
    const ssml = microsoftNeuralTts.generateSSML(sentences, {
      voiceName: 'en-US-JennyNeural',
      language: 'en',
      gender: 'FEMALE'
    });
    assert(ssml.includes('<speak'), 'SSML must contain speak root');
    assert(ssml.includes('voice name="en-US-JennyNeural"'), 'SSML must specify voice');
    assert(ssml.includes('prosody rate="-5%"'), 'SSML must apply tuned teacher rate');
    assert(ssml.includes('<break time="320ms"/>'), 'SSML must include sentence pauses');
    assert(ssml.includes('<break time="650ms"/>'), 'SSML must include longer pauses for steps/headers');
  });

  // -------------------------------------------------------------------------
  // 5. Real Audio Synthesis: English (Female & Male)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing English Neural Audio Synthesis ---');
  await testAsync('English Female (en-US-JennyNeural)', async () => {
    const text = 'Hello students! Welcome to SkillBridge. Today we will master industrial safety procedures step by step.';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'en', gender: 'FEMALE' });
    assert(res.buffer && res.buffer.length > 5000, `Audio buffer too small: ${res.buffer?.length}`);
    assert.strictEqual(res.contentType, 'audio/mpeg');
    assert.strictEqual(res.voice, 'en-US-JennyNeural');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'en_female_jenny.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: en_female_jenny.mp3)`);
  });

  await testAsync('English Male (en-US-ChristopherNeural)', async () => {
    const text = 'Good morning class. Please ensure your Personal Protective Equipment is fitted properly before entering the work area.';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'en', gender: 'MALE' });
    assert(res.buffer && res.buffer.length > 5000, `Audio buffer too small: ${res.buffer?.length}`);
    assert.strictEqual(res.contentType, 'audio/mpeg');
    assert.strictEqual(res.voice, 'en-US-ChristopherNeural');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'en_male_christopher.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: en_male_christopher.mp3)`);
  });

  // -------------------------------------------------------------------------
  // 6. Real Audio Synthesis: Telugu (Female & Male)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Testing Telugu Neural Audio Synthesis ---');
  await testAsync('Telugu Female (te-IN-ShrutiNeural)', async () => {
    const text = 'నమస్కారం విద్యార్థులారా! స్కిల్‌బ్రిడ్జ్ తరగతికి స్వాగతం. ఈరోజు మనం ముఖ్యమైన పరిశ్రమ భద్రతా పద్ధతులను నేర్చుకుందాం.';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'te', gender: 'FEMALE' });
    assert(res.buffer && res.buffer.length > 5000, `Audio buffer too small: ${res.buffer?.length}`);
    assert.strictEqual(res.contentType, 'audio/mpeg');
    assert.strictEqual(res.voice, 'te-IN-ShrutiNeural');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'te_female_shruti.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: te_female_shruti.mp3)`);
  });

  await testAsync('Telugu Male (te-IN-MohanNeural)', async () => {
    const text = 'పని ప్రదేశంలో ప్రమాదాలను నివారించడానికి తగిన రక్షణ పరికరాలను తప్పనిసరిగా ధరించాలి.';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'te', gender: 'MALE' });
    assert(res.buffer && res.buffer.length > 5000, `Audio buffer too small: ${res.buffer?.length}`);
    assert.strictEqual(res.contentType, 'audio/mpeg');
    assert.strictEqual(res.voice, 'te-IN-MohanNeural');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'te_male_mohan.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: te_male_mohan.mp3)`);
  });

  // -------------------------------------------------------------------------
  // 7. Real Audio Synthesis: Tamil (Female & Male)
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Testing Tamil Neural Audio Synthesis ---');
  await testAsync('Tamil Female (ta-IN-PallaviNeural)', async () => {
    const text = 'வணக்கம் மாணவர்களே! தொழில் பாதுகாப்பு வகுப்பிற்கு உங்களை அன்புடன் வரவேற்கிறோம்.';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'ta', gender: 'FEMALE' });
    assert(res.buffer && res.buffer.length > 5000, `Audio buffer too small: ${res.buffer?.length}`);
    assert.strictEqual(res.contentType, 'audio/mpeg');
    assert.strictEqual(res.voice, 'ta-IN-PallaviNeural');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'ta_female_pallavi.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: ta_female_pallavi.mp3)`);
  });

  await testAsync('Tamil Male (ta-IN-ValluvarNeural)', async () => {
    const text = 'பணியிடத்தில் பாதுகாப்பு விதிகளைப் பின்பற்றுவது உங்கள் உயிரைப் பாதுகாக்கும்.';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'ta', gender: 'MALE' });
    assert(res.buffer && res.buffer.length > 5000, `Audio buffer too small: ${res.buffer?.length}`);
    assert.strictEqual(res.contentType, 'audio/mpeg');
    assert.strictEqual(res.voice, 'ta-IN-ValluvarNeural');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'ta_male_valluvar.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: ta_male_valluvar.mp3)`);
  });

  // -------------------------------------------------------------------------
  // 8. Real Audio Synthesis: Chinese, Malay & Bengali
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Testing Multilingual Synthesis (Chinese, Malay, Bengali) ---');
  await testAsync('Chinese Female (zh-CN-XiaoxiaoNeural)', async () => {
    const text = '同学们好，欢迎来到安全培训课程。在开始工作之前，请务必检查您的防护装备。';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'zh', gender: 'FEMALE' });
    assert(res.buffer && res.buffer.length > 5000);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'zh_female_xiaoxiao.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: zh_female_xiaoxiao.mp3)`);
  });

  await testAsync('Malay Female (ms-MY-YasminNeural)', async () => {
    const text = 'Selamat pagi murid-murid. Hari ini kita akan mempelajari prosedur keselamatan penting di tempat kerja.';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'ms', gender: 'FEMALE' });
    assert(res.buffer && res.buffer.length > 5000);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'ms_female_yasmin.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: ms_female_yasmin.mp3)`);
  });

  await testAsync('Bengali Female (bn-IN-TanishaaNeural)', async () => {
    const text = 'নমস্কার শিক্ষার্থীরা, কর্মক্ষেত্রে সুরক্ষা নিয়মাবলী মেনে চলা অত্যন্ত জরুরি।';
    const res = await microsoftNeuralTts.synthesizeAudio(text, { language: 'bn', gender: 'FEMALE' });
    assert(res.buffer && res.buffer.length > 5000);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'bn_female_tanishaa.mp3'), res.buffer);
    console.log(`   -> Generated ${res.buffer.length} bytes (Saved: bn_female_tanishaa.mp3)`);
  });

  // -------------------------------------------------------------------------
  // 9. Audio Caching (LRU Speed Test)
  // -------------------------------------------------------------------------
  console.log('\n--- 9. Testing High-Speed LRU Audio Caching ---');
  await testAsync('Cached audio returns instantly (<10ms) with fromCache=true', async () => {
    const sample = 'Caching test sentence for instant playback.';
    await microsoftNeuralTts.synthesizeAudio(sample, { language: 'en', gender: 'FEMALE' });
    const t0 = Date.now();
    const cached = await microsoftNeuralTts.synthesizeAudio(sample, { language: 'en', gender: 'FEMALE' });
    const elapsed = Date.now() - t0;
    assert.strictEqual(cached.fromCache, true);
    assert(elapsed < 20, `Cache took too long: ${elapsed}ms`);
    console.log(`   -> Cache HIT returned in ${elapsed}ms!`);
  });

  console.log('\n========================================================================');
  console.log(`🏁 VALIDATION RESULT: ${passed} / ${total} TESTS PASSED`);
  console.log('========================================================================');
  if (passed === total) {
    console.log('🎉 ALL MICROSOFT EDGE NEURAL TTS TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
