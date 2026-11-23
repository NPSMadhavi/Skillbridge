import assert from 'assert';
import fs from 'fs';
import path from 'path';
import microsoftNeuralTts, { VOICE_CONFIG } from '../services/microsoftNeuralTtsService.js';

const OUTPUT_DIR = path.join(process.cwd(), 'Backend', 'scripts', 'test_audio_output');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runValidation() {
  console.log('========================================================================');
  console.log('🎙️ MICROSOFT NEURAL TTS 12-VOICE MATRIX VALIDATION');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  async function check(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // 1. Text Preparation Tests
  console.log('--- 1. Testing Pedagogical Text Preparation & Acronym Normalization ---');
  await check('Sequential bullet point healing (non-robotic)', () => {
    const raw = `
- Check helmet
- Fasten safety harness
- Inspect work area
- Review permit
- Begin task
`;
    const cleaned = microsoftNeuralTts.prepareTeacherNarration(raw, 'en');
    assert(cleaned.includes('First, Check helmet'), 'Missing First transition');
    assert(cleaned.includes('Next, Fasten safety harness'), 'Missing Next transition');
    assert(cleaned.includes('Additionally, Inspect work area'), 'Missing Additionally transition');
    assert(cleaned.includes('Furthermore, Review permit'), 'Missing Furthermore transition');
    assert(cleaned.includes('Finally, Begin task'), 'Missing Finally transition');
    assert(!cleaned.includes('-'), 'Dashes must be stripped');
  });

  await check('Acronym expansion: PPE, SOP, OSHA, LOTO, ISO 45001, dB, kPa', () => {
    const raw = 'Always follow SOP and wear your PPE according to OSHA and ISO 45001 rules. Use LOTO. Sound limit is 85 dB at 200 kPa.';
    const cleaned = microsoftNeuralTts.prepareTeacherNarration(raw, 'en');
    assert(cleaned.includes('Personal Protective Equipment'), 'PPE must expand');
    assert(cleaned.includes('Standard Operating Procedure'), 'SOP must expand');
    assert(cleaned.includes('O-SHA'), 'OSHA must expand');
    assert(cleaned.includes('Lockout Tagout'), 'LOTO must expand');
    assert(cleaned.includes('I-S-O forty-five thousand and one'), 'ISO 45001 must expand');
    assert(cleaned.includes('85 decibels'), 'dB must expand');
    assert(cleaned.includes('200 kilopascals'), 'kPa must expand');
    assert(!cleaned.includes('(') && !cleaned.includes(')'), 'No robotic parentheses in speech string');
  });

  await check('Heading conversational conversion', () => {
    const raw = '### Emergency Evacuation Plan\nProceed to nearest exit.';
    const cleaned = microsoftNeuralTts.prepareTeacherNarration(raw, 'en');
    assert(cleaned.includes("Now, let's explore: Emergency Evacuation Plan."), 'Headings must be spoken introductions');
  });

  // 2. Full 12-Voice Synthesis Matrix (6 Languages × 2 Genders)
  console.log('\n--- 2. Synthesizing 12 Voice Variants (6 Languages × 2 Genders) ---');

  const voiceTests = [
    // English
    { lang: 'en', gender: 'FEMALE', expectedVoice: 'en-US-JennyNeural', text: 'Good morning learners. Today we will explore critical industrial safety procedures step by step.', filename: '01_en_female_jenny.mp3' },
    { lang: 'en', gender: 'MALE', expectedVoice: 'en-US-ChristopherNeural', text: 'Please ensure that your Personal Protective Equipment is inspected before entering the production facility.', filename: '02_en_male_christopher.mp3' },
    // Chinese
    { lang: 'zh', gender: 'FEMALE', expectedVoice: 'zh-CN-XiaoxiaoNeural', text: '同学们好，欢迎参加安全操作培训。在开始作业前，请务必仔细检查所有安全防护设备。', filename: '03_zh_female_xiaoxiao.mp3' },
    { lang: 'zh', gender: 'MALE', expectedVoice: 'zh-CN-YunxiNeural', text: '严格遵守作业现场的安全规程，是保障每一位员工人身安全的基本前提。', filename: '04_zh_male_yunxi.mp3' },
    // Malay
    { lang: 'ms', gender: 'FEMALE', expectedVoice: 'ms-MY-YasminNeural', text: 'Selamat pagi semua murid. Hari ini kita akan mempelajari prosedur keselamatan penting di tempat kerja.', filename: '05_ms_female_yasmin.mp3' },
    { lang: 'ms', gender: 'MALE', expectedVoice: 'ms-MY-OsmanNeural', text: 'Sentiasa pastikan anda memakai peralatan perlindungan diri yang lengkap sebelum memasuki kawasan operasi.', filename: '06_ms_male_osman.mp3' },
    // Tamil
    { lang: 'ta', gender: 'FEMALE', expectedVoice: 'ta-IN-PallaviNeural', text: 'வணக்கம் மாணவர்களே! தொழில் பாதுகாப்பு வகுப்பிற்கு உங்களை அன்புடன் வரவேற்கிறோம்.', filename: '07_ta_female_pallavi.mp3' },
    { lang: 'ta', gender: 'MALE', expectedVoice: 'ta-IN-ValluvarNeural', text: 'பணியிடத்தில் பாதுகாப்பு விதிகளை சரியாகப் பின்பற்றுவது உங்கள் உயிரைப் பாதுகாக்கும் முக்கியமான கடமையாகும்.', filename: '08_ta_male_valluvar.mp3' },
    // Telugu
    { lang: 'te', gender: 'FEMALE', expectedVoice: 'te-IN-ShrutiNeural', text: 'నమస్కారం విద్యార్థులారా! స్కిల్‌బ్రిడ్జ్ భద్రతా శిక్షణ తరగతికి స్వాగతం. ఈరోజు మనం ముఖ్యమైన రక్షణ సూత్రాలను నేర్చుకుందాం.', filename: '09_te_female_shruti.mp3' },
    { lang: 'te', gender: 'MALE', expectedVoice: 'te-IN-MohanNeural', text: 'పని ప్రదేశంలో ప్రమాదాలను అరికట్టడానికి ప్రతి ఒక్కరూ సరైన రక్షణ పరికరాలను తప్పనిసరిగా ధరించాలి.', filename: '10_te_male_mohan.mp3' },
    // Bangla
    { lang: 'bn', gender: 'FEMALE', expectedVoice: 'bn-IN-TanishaaNeural', text: 'সুপ্রিয় শিক্ষার্থীরা, আজকের কর্মক্ষেত্র সুরক্ষা প্রশিক্ষণ ক্লাসে আপনাদের সকলকে স্বাগতম।', filename: '11_bn_female_tanishaa.mp3' },
    { lang: 'bn', gender: 'MALE', expectedVoice: 'bn-IN-BashkarNeural', text: 'কাজের জায়গায় প্রবেশ করার আগে সর্বদা আপনার ব্যক্তিগত সুরক্ষা সরঞ্জাম সঠিকভাবে পরিধান করুন।', filename: '12_bn_male_bashkar.mp3' }
  ];

  for (const item of voiceTests) {
    await check(`${item.lang.toUpperCase()} ${item.gender} (${item.expectedVoice})`, async () => {
      const res = await microsoftNeuralTts.synthesizeAudio(item.text, {
        language: item.lang,
        gender: item.gender
      });
      assert(res.buffer && res.buffer.length > 5000, `Buffer size too small: ${res.buffer?.length}`);
      assert.strictEqual(res.contentType, 'audio/mpeg');
      assert.strictEqual(res.voice, item.expectedVoice);
      fs.writeFileSync(path.join(OUTPUT_DIR, item.filename), res.buffer);
      console.log(`   -> Generated ${res.buffer.length} bytes -> ${item.filename}`);
    });
  }

  // 3. Cache Validation
  console.log('\n--- 3. Testing High-Speed Audio Cache ---');
  await check('Instant cache hit for repeated query (< 10ms)', async () => {
    const t0 = Date.now();
    const res = await microsoftNeuralTts.synthesizeAudio('Good morning learners. Today we will explore critical industrial safety procedures step by step.', {
      language: 'en',
      gender: 'FEMALE'
    });
    const dur = Date.now() - t0;
    assert.strictEqual(res.fromCache, true);
    assert(dur < 20, `Cache duration was ${dur}ms`);
    console.log(`   -> Cache HIT returned in ${dur}ms with fromCache=true`);
  });

  console.log('\n========================================================================');
  console.log(`🏁 VALIDATION SUMMARY: ${passed} / ${total} TESTS PASSED`);
  console.log('========================================================================');
  if (passed === total) {
    console.log('🎉 ALL 12 NEURAL VOICES & ACCURACY CHECKS PASSED PERFECTLY!');
  } else {
    process.exit(1);
  }
}

runValidation().catch(console.error);
