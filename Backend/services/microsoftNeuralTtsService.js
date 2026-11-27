/**
 * Microsoft Edge Neural TTS Voice Service for SkillBridge
 * Provides broadcast-grade, human-like neural teacher speech synthesis.
 *
 * Implements:
 * 1. Exact Multilingual Microsoft Neural Voice Matrix (en, zh, ms, ta, te, bn, hi)
 * 2. Natural Classroom Teacher Cadence (125-135 WPM, natural baseline pitch, expressive flow)
 * 3. Pedagogical Text Preparation (Sequential bullet healing, heading transitions, unit/acronym expansion)
 * 4. Technical Pronunciation Normalization (PPE, SOP, OSHA, LOTO, dB, kPa, ISO 45001)
 * 5. Intelligent Long-Text Chunking & Concatenation (zero audio truncation or clipping)
 * 6. High-Performance LRU Audio Cache
 */

import crypto from 'crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { detectDominantScript } from '../utils/language.js';
import axios from 'axios';
import { getPythonServiceUrl, getGatewayApiKey } from '../config/gateway.js';
import { formatGatewayError } from '../utils/gatewayError.js';

// ---------------------------------------------------------------------------
// 1. Exact Multilingual Microsoft Neural Voice Matrix
// ---------------------------------------------------------------------------
export const VOICE_CONFIG = {
  en: {
    language: 'English',
    female: 'en-US-JennyNeural',
    male: 'en-US-ChristopherNeural',
    defaultGender: 'FEMALE',
    langTag: 'en-US',
    targetWpm: 132,
    defaultRate: '-5%',
    defaultPitch: '0%',
    defaultVolume: '+0%',
    sentencePauseMs: 300,
    headingPauseMs: 500,
    paragraphPauseMs: 600
  },
  zh: {
    language: 'Chinese',
    female: 'zh-CN-XiaoxiaoNeural',
    male: 'zh-CN-YunxiNeural',
    defaultGender: 'FEMALE',
    langTag: 'zh-CN',
    targetWpm: 128,
    defaultRate: '-6%',
    defaultPitch: '0%',
    defaultVolume: '+0%',
    sentencePauseMs: 320,
    headingPauseMs: 520,
    paragraphPauseMs: 650
  },
  ms: {
    language: 'Malay',
    female: 'ms-MY-YasminNeural',
    male: 'ms-MY-OsmanNeural',
    defaultGender: 'FEMALE',
    langTag: 'ms-MY',
    targetWpm: 130,
    defaultRate: '-4%',
    defaultPitch: '0%',
    defaultVolume: '+0%',
    sentencePauseMs: 300,
    headingPauseMs: 500,
    paragraphPauseMs: 620
  },
  ta: {
    language: 'Tamil',
    female: 'ta-IN-PallaviNeural',
    male: 'ta-IN-ValluvarNeural',
    defaultGender: 'FEMALE',
    langTag: 'ta-IN',
    targetWpm: 126,
    defaultRate: '-5%',
    defaultPitch: '0%',
    defaultVolume: '+0%',
    sentencePauseMs: 340,
    headingPauseMs: 550,
    paragraphPauseMs: 680
  },
  te: {
    language: 'Telugu',
    female: 'te-IN-ShrutiNeural',
    male: 'te-IN-MohanNeural',
    defaultGender: 'FEMALE',
    langTag: 'te-IN',
    targetWpm: 126,
    defaultRate: '-5%',
    defaultPitch: '0%',
    defaultVolume: '+0%',
    sentencePauseMs: 340,
    headingPauseMs: 550,
    paragraphPauseMs: 680
  },
  bn: {
    language: 'Bangla',
    female: 'bn-IN-TanishaaNeural',
    male: 'bn-IN-BashkarNeural',
    defaultGender: 'FEMALE',
    langTag: 'bn-IN',
    targetWpm: 128,
    defaultRate: '-4%',
    defaultPitch: '0%',
    defaultVolume: '+0%',
    sentencePauseMs: 320,
    headingPauseMs: 520,
    paragraphPauseMs: 650
  },
  hi: {
    language: 'Hindi',
    female: 'hi-IN-SwaraNeural',
    male: 'hi-IN-MadhurNeural',
    defaultGender: 'FEMALE',
    langTag: 'hi-IN',
    targetWpm: 128,
    defaultRate: '-4%',
    defaultPitch: '0%',
    defaultVolume: '+0%',
    sentencePauseMs: 320,
    headingPauseMs: 520,
    paragraphPauseMs: 650
  }
};

// ---------------------------------------------------------------------------
// 2. Technical Pronunciation & Acronym Expansion Dictionary
// Spoken naturally without robotic parentheses or unnatural punctuation
// ---------------------------------------------------------------------------
export const PRONUNCIATION_DICTIONARY = {
  // Industrial Safety & Operations
  PPE: 'Personal Protective Equipment',
  SOP: 'Standard Operating Procedure',
  LOTO: 'Lockout Tagout',
  OSHA: 'O-SHA',
  JSA: 'Job Safety Analysis',
  JHA: 'Job Hazard Analysis',
  SWP: 'Safe Work Procedure',
  PTW: 'Permit to Work',
  MSDS: 'Safety Data Sheet',
  SDS: 'Safety Data Sheet',
  EHS: 'Environmental Health and Safety',
  HSE: 'Health, Safety, and Environment',
  GFCI: 'Ground Fault Circuit Interrupter',
  HAZMAT: 'Hazardous Materials',
  COSHH: 'Control of Substances Hazardous to Health',
  RAMS: 'Risk Assessment Method Statement',
  SCBA: 'Self Contained Breathing Apparatus',
  WSH: 'Workplace Safety and Health',
  MOC: 'Management of Change',
  ALARP: 'As Low As Reasonably Practicable',
  // Certifications & Standards
  'ISO 45001': 'I-S-O forty-five thousand and one',
  'ISO 9001': 'I-S-O nine thousand and one',
  'ISO 14001': 'I-S-O fourteen thousand and one',
  bizSAFE: 'business SAFE',
  // Medical & First Aid
  CPR: 'Cardiopulmonary Resuscitation',
  AED: 'Automated External Defibrillator',
  // Technology & Digital
  API: 'A-P-I',
  CPU: 'C-P-U',
  GPU: 'G-P-U',
  RAM: 'R-A-M',
  SQL: 'S-Q-L',
  UI: 'User Interface',
  UX: 'User Experience',
  PDF: 'P-D-F',
  URL: 'U-R-L'
};

// Precise measurement and unit expansions for smooth teacher delivery
const UNIT_EXPANSIONS = [
  { regex: /\b(\d+(?:\.\d+)?)\s*kPa\b/gi, repl: '$1 kilopascals' },
  { regex: /\b(\d+(?:\.\d+)?)\s*MPa\b/gi, repl: '$1 megapascals' },
  { regex: /\b(\d+(?:\.\d+)?)\s*dB\b/gi, repl: '$1 decibels' },
  { regex: /\b(\d+(?:\.\d+)?)\s*psi\b/gi, repl: '$1 pounds per square inch' },
  { regex: /\b(\d+(?:\.\d+)?)\s*kg\b/gi, repl: '$1 kilograms' },
  { regex: /\b(\d+(?:\.\d+)?)\s*km\/h\b/gi, repl: '$1 kilometers per hour' },
  { regex: /\b(\d+(?:\.\d+)?)\s*m\/s\b/gi, repl: '$1 meters per second' },
  { regex: /\b(\d+(?:\.\d+)?)\s*mm\b/gi, repl: '$1 millimeters' },
  { regex: /\b(\d+(?:\.\d+)?)\s*cm\b/gi, repl: '$1 centimeters' },
  { regex: /\b(\d+(?:\.\d+)?)\s*°C\b/gi, repl: '$1 degrees Celsius' },
  { regex: /\b(\d+(?:\.\d+)?)\s*°F\b/gi, repl: '$1 degrees Fahrenheit' },
  { regex: /\b(\d+(?:\.\d+)?)\s*%\b/gi, repl: '$1 percent' },
  { regex: /\b(\d+(?:\.\d+)?)\s*kV\b/gi, repl: '$1 kilovolts' },
  { regex: /\b(\d+(?:\.\d+)?)\s*V\b/gi, repl: '$1 volts' },
  { regex: /\b(\d+(?:\.\d+)?)\s*A\b/gi, repl: '$1 amperes' },
  { regex: /\b(\d+(?:\.\d+)?)\s*Hz\b/gi, repl: '$1 hertz' },
  { regex: /\b(\d+(?:\.\d+)?)\s*bar\b/gi, repl: '$1 bar' }
];

// Sequential transition phrases for bullet points to prevent repetitive robotic delivery
const BULLET_TRANSITIONS = [
  'First, ',
  'Next, ',
  'Additionally, ',
  'Furthermore, ',
  'Finally, '
];

// ---------------------------------------------------------------------------
// 3. Audio Cache Store (500 Entries LRU)
// ---------------------------------------------------------------------------
const audioCache = new Map();
const MAX_CACHE_ENTRIES = 500;

export class MicrosoftNeuralTtsService {
  /**
   * Automatically resolve the authentic Microsoft Neural voice based on language and gender preference.
   * Language strictly governs the voice family so non-matching foreign voices cannot hijack pronunciation.
   */
  resolveVoice(requestedVoice, language = 'en', gender = 'FEMALE', text = '') {
    let normLang = String(language || '').toLowerCase().trim().split('-')[0].split('_')[0];

    // If language is omitted, default, or auto, detect from dominant script in text
    if (!normLang || normLang === 'auto' || normLang === 'default') {
      const detected = detectDominantScript(text);
      if (detected && VOICE_CONFIG[detected]) {
        normLang = detected;
      } else {
        normLang = 'en';
      }
    }

    if (!VOICE_CONFIG[normLang]) {
      normLang = 'en';
    }

    const config = VOICE_CONFIG[normLang];
    const isMale = String(gender || config.defaultGender).toUpperCase() === 'MALE';

    // If caller explicitly requested a voice, check if it matches either the female or male neural voice for this language
    if (requestedVoice && typeof requestedVoice === 'string') {
      const vClean = requestedVoice.trim().toLowerCase();
      if (config.female.toLowerCase() === vClean) return config.female;
      if (config.male.toLowerCase() === vClean) return config.male;
    }

    // Strictly return the authentic Microsoft Neural voice for this language and gender
    return isMale ? config.male : config.female;
  }

  /**
   * Intelligent speech-text preparation:
   * - Converts headings into natural teacher introductions
   * - Converts sequential bullet points into smooth, progressive spoken sentences
   * - Expands technical acronyms (PPE, SOP, OSHA, LOTO, ISO 45001)
   * - Expands units of measurement and percentages
   * - Removes Markdown formatting, citations, code blocks, and symbols
   */
  prepareTeacherNarration(text, language = 'en') {
    if (!text || typeof text !== 'string') return '';

    let clean = text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1')     // Remove inline code ticks
      .replace(/<[^>]+>/g, ' ')        // Remove HTML tags
      .replace(/\{[\s\S]*?\}/g, '')   // Remove stray JSON blocks
      .replace(/\[\d+\]/g, '')        // Remove footnote citations [1], [2]
      .replace(/\[slide\s*\d+\]/gi, '') // Remove [slide 1] tags
      .replace(/---+/g, ' ')          // Remove divider lines
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
      .trim();

    // 1. Convert Markdown headings into natural spoken introductions
    clean = clean.replace(/^#{1,4}\s+(.+)$/gm, (match, headingText) => {
      const cleanHeading = headingText.replace(/[#*_~`]/g, '').trim();
      return cleanHeading ? `Now, let's explore: ${cleanHeading}.` : '';
    });

    // 2. Remove inline bold and italics formatting
    clean = clean
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1');

    // 3. Remove non-vocal presentation symbols and icons, converting section markers to clean sentence pauses
    clean = clean
      .replace(/[💡🎯📋⚠️📌🔍🌐⚡⚙️✓✔❌✕■□]\s*/g, '. ')
      .replace(/\s*([=]{1,}|[-]{3,})\s*/g, '. ')
      .replace(/&/g, ' and ')
      .replace(/[“"]/g, '')
      .replace(/[‘']/g, "'")
      .replace(/\.{2,}/g, '. ');

    // 4. Sequential Bullet Point Healing:
    // Replace sequential bullet points with natural progressive speech transitions
    let bulletIdx = 0;
    clean = clean.replace(/^[ \t]*[-*•➔►→]\s+/gm, () => {
      const transition = BULLET_TRANSITIONS[Math.min(bulletIdx, BULLET_TRANSITIONS.length - 1)];
      bulletIdx++;
      return transition;
    });

    // 5. Expand measurement units and percentages
    for (const { regex, repl } of UNIT_EXPANSIONS) {
      clean = clean.replace(regex, repl);
    }

    // 6. Expand technical acronyms (multi-word exact match first)
    // First handle multi-word terms like "ISO 45001"
    clean = clean.replace(/\bISO\s*45001\b/gi, PRONUNCIATION_DICTIONARY['ISO 45001']);
    clean = clean.replace(/\bISO\s*9001\b/gi, PRONUNCIATION_DICTIONARY['ISO 9001']);
    clean = clean.replace(/\bISO\s*14001\b/gi, PRONUNCIATION_DICTIONARY['ISO 14001']);
    clean = clean.replace(/\bbizSAFE\b/gi, PRONUNCIATION_DICTIONARY.bizSAFE);

    // Then single-word acronyms
    for (const [acronym, expansion] of Object.entries(PRONUNCIATION_DICTIONARY)) {
      if (acronym.includes(' ')) continue;
      const regex = new RegExp(`\\b${acronym}\\b`, 'g');
      clean = clean.replace(regex, expansion);
    }

    // Normalize whitespace
    clean = clean.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

    return clean;
  }

  /**
   * Segment long explanations into clean, individual teacher sentences
   * Handles Western punctuation (. ! ?) and Indic / Asian punctuation (। 。 ！？)
   */
  segmentSentences(text) {
    if (!text) return [];

    // Pre-split on newlines or sentence-ending punctuation
    const normalized = text
      .replace(/[\r\n]+/g, '|SPLIT|')
      .replace(/([.!?।。！？])\s+(?=[A-Z0-9\u0C00-\u0C7F\u0B80-\u0BFF\u0980-\u09FF\u4E00-\u9FFF])/g, '$1|SPLIT|');

    const raw = normalized.split('|SPLIT|').map(s => s.trim()).filter(s => s.length > 2);

    // If any segment is excessively long (> 350 chars), break it at natural clause boundaries
    const result = [];
    for (const chunk of raw) {
      if (chunk.length <= 350) {
        result.push(chunk);
      } else {
        const sub = chunk.replace(/([,;:—–])\s+/g, '$1|SUBSPLIT|').split('|SUBSPLIT|');
        let current = '';
        for (const part of sub) {
          if ((current + ' ' + part).length > 350) {
            if (current) result.push(current.trim());
            current = part;
          } else {
            current = current ? `${current} ${part}` : part;
          }
        }
        if (current) result.push(current.trim());
      }
    }
    return result.filter(s => s.length > 2);
  }

  /**
   * Calculate language-specific prosody parameters for steady, patient classroom cadence
   */
  calculateProsody(options = {}) {
    const {
      language = 'en',
      gender = 'FEMALE',
      rate,
      pitch,
      volume = '+0%'
    } = options;

    const normLang = String(language).toLowerCase().split('-')[0];
    const conf = VOICE_CONFIG[normLang] || VOICE_CONFIG.en;

    // Rate: Target 125-135 WPM (natural patient instructional pacing: -4% to -6%)
    let effRate = conf.defaultRate || '-5%';
    if (rate !== undefined && rate !== null) {
      const numRate = parseFloat(rate);
      if (!isNaN(numRate) && numRate > 0) {
        const pct = Math.max(-10, Math.min(5, Math.round((numRate - 1.0) * 100)));
        effRate = `${pct >= 0 ? '+' : ''}${pct}%`;
      } else if (typeof rate === 'string' && (rate.endsWith('%') || rate.endsWith('st'))) {
        effRate = rate;
      }
    }

    // Pitch: Preserve natural voice baseline (0%) to eliminate robotic frequency shifting
    let effPitch = '0%';
    if (pitch !== undefined && pitch !== null) {
      const numPitch = parseFloat(pitch);
      if (!isNaN(numPitch) && numPitch > 0) {
        // Only offset if caller explicitly deviates significantly from natural 1.0 baseline
        if (Math.abs(numPitch - 1.0) >= 0.15) {
          const userOffsetHz = Math.round((numPitch - 1.0) * 15);
          effPitch = `${userOffsetHz >= 0 ? '+' : ''}${userOffsetHz}Hz`;
        }
      } else if (typeof pitch === 'string' && (pitch.endsWith('Hz') || pitch.endsWith('%'))) {
        effPitch = pitch;
      }
    }

    return {
      rate: effRate,
      pitch: effPitch,
      volume: volume || '+0%',
      sentencePauseMs: conf.sentencePauseMs,
      headingPauseMs: conf.headingPauseMs,
      paragraphPauseMs: conf.paragraphPauseMs,
      langTag: conf.langTag
    };
  }

  /**
   * Generate standards-compliant SSML with teacher pauses
   */
  generateSSML(textOrSentences, options = {}) {
    const {
      voiceName = 'en-US-JennyNeural',
      language = 'en',
      gender = 'FEMALE',
      rate,
      pitch,
      volume
    } = options;

    const sentences = Array.isArray(textOrSentences)
      ? textOrSentences
      : this.segmentSentences(this.prepareTeacherNarration(textOrSentences, language));

    const prosody = this.calculateProsody({ language, gender, rate, pitch, volume });

    let ssmlBody = '';
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const isHeader = /^Now, let's explore:/i.test(s) || s.endsWith(':') || /^Step\s+\d+/i.test(s);
      const pauseDuration = isHeader ? prosody.headingPauseMs : prosody.sentencePauseMs;

      // Escape XML characters
      const escapedSentence = s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

      ssmlBody += `      <s>${escapedSentence}</s>\n      <break time="${pauseDuration}ms"/>\n`;
    }

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${prosody.langTag}">
  <voice name="${voiceName}">
    <prosody rate="${prosody.rate}" pitch="${prosody.pitch}" volume="${prosody.volume}">
${ssmlBody}    </prosody>
  </voice>
</speak>`;
  }

  /**
   * Internal synthesis for a single text chunk using Microsoft Edge Neural TTS
   * Includes 2-attempt retry with backoff for transient WebSocket interruptions
   */
  async _synthesizeChunk(text, targetVoice, prosody, retries = 2) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const tts = new MsEdgeTTS({
          connectionTimeoutMs: 15000,
          synthesisTimeoutMs: 30000
        });

        // Configure 24kHz 48kbps Mono MP3 for crisp broadcast teacher speech
        await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const safeText = text
          .replace(/&/g, ' and ')
          .replace(/</g, ' ')
          .replace(/>/g, ' ')
          .replace(/["“”]/g, '')
          .replace(/['‘’]/g, "'")
          .trim();

        const { audioStream } = tts.toStream(safeText, {
          rate: prosody.rate,
          pitch: prosody.pitch
        });

        const chunks = [];
        await new Promise((resolve, reject) => {
          audioStream.on('data', chunk => chunks.push(chunk));
          audioStream.on('close', resolve);
          audioStream.on('error', reject);
        });

        const audioBuffer = Buffer.concat(chunks);
        if (!audioBuffer || audioBuffer.length < 500) {
          throw new Error('Synthesized audio buffer is empty or truncated.');
        }
        return audioBuffer;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Generate cache key
   */
  _getCacheKey(voice, text, rate, pitch, sourceChunkId = null, version = 1) {
    const TTS_ENGINE_VERSION = 'v2';
    const prefix = sourceChunkId ? `chunk:${sourceChunkId}:v${version}|` : '';
    return crypto.createHash('sha256').update(`${TTS_ENGINE_VERSION}|${prefix}${voice}|${text.trim()}|${rate}|${pitch}`).digest('hex');
  }

  hasCachedAudio(text, options = {}) {
    const { language = 'en', gender = 'FEMALE', voice = null, rate = null, pitch = null, sourceChunkId = null, version = 1 } = options;
    const cleanSpoken = this.prepareTeacherNarration(text, language);
    const targetVoice = this.resolveVoice(voice, language, gender, cleanSpoken);
    const prosody = this.calculateProsody({ language, gender, rate, pitch });
    const cacheKey = this._getCacheKey(targetVoice, cleanSpoken, prosody.rate, prosody.pitch, sourceChunkId, version);
    return { hit: audioCache.has(cacheKey), cacheKey, voice: targetVoice };
  }

  /**
   * Primary Audio Synthesis: Generates studio-grade MP3 using Microsoft Edge Neural TTS
   */
  async synthesizeAudio(text, options = {}) {
    const {
      language = 'en',
      gender = 'FEMALE',
      voice = null,
      rate = null,
      pitch = null,
      sourceChunkId = null,
      version = 1
    } = options;

    if (!text || !text.trim()) {
      throw new Error('Text to synthesize cannot be empty.');
    }

    // 1. Prepare narration for articulate classroom teacher speech
    const cleanSpoken = this.prepareTeacherNarration(text, language);
    const targetVoice = this.resolveVoice(voice, language, gender, cleanSpoken);
    const prosody = this.calculateProsody({ language, gender, rate, pitch });
    const segments = this.segmentSentences(cleanSpoken);

    console.log(`[TTS Synthesis] Voice: ${targetVoice} | Lang: ${language} | Gender: ${gender} | Rate: ${prosody.rate} | Pitch: ${prosody.pitch} | Segments: ${segments.length}`);
    console.log(`[TTS Synthesis] Original Text Preview: "${text.slice(0, 100).replace(/\s+/g, ' ')}${text.length > 100 ? '...' : ''}"`);
    console.log(`[TTS Synthesis] Cleaned Narration Preview: "${cleanSpoken.slice(0, 100).replace(/\s+/g, ' ')}${cleanSpoken.length > 100 ? '...' : ''}"`);

    // 2. Check LRU memory cache & in-flight request deduplication
    const cacheKey = this._getCacheKey(targetVoice, cleanSpoken, prosody.rate, prosody.pitch, sourceChunkId, version);
    if (audioCache.has(cacheKey)) {
      const cached = audioCache.get(cacheKey);
      console.log(`[TTS Synthesis Cache HIT] Voice: ${targetVoice} | Buffer: ${cached.buffer.length} bytes`);
      return {
        buffer: cached.buffer,
        contentType: cached.contentType,
        voice: targetVoice,
        cacheKey,
        fromCache: true
      };
    }

    if (this._inFlight?.has(cacheKey)) {
      console.log(`[TTS Synthesis Coalesced] Waiting on in-flight synthesis for ${cacheKey.slice(0, 12)}`);
      const shared = await this._inFlight.get(cacheKey);
      return { ...shared, fromCache: true };
    }

    if (!this._inFlight) this._inFlight = new Map();

    // 3. Synthesize via Microsoft Edge Neural TTS with intelligent chunking
    const synthPromise = (async () => {
      try {
        let finalBuffer;

        // For long speech text (> 400 characters), segment at sentence boundaries and concatenate
        if (cleanSpoken.length > 400) {
          const sentences = this.segmentSentences(cleanSpoken);
          const chunkGroups = [];
          let currentChunk = '';

          for (const s of sentences) {
            if ((currentChunk + ' ' + s).length > 350) {
              if (currentChunk) chunkGroups.push(currentChunk.trim());
              currentChunk = s;
            } else {
              currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
            }
          }
          if (currentChunk) chunkGroups.push(currentChunk.trim());

          const audioBuffers = [];
          for (const group of chunkGroups) {
            const buf = await this._synthesizeChunk(group, targetVoice, prosody);
            audioBuffers.push(buf);
          }
          finalBuffer = Buffer.concat(audioBuffers);
        } else {
          finalBuffer = await this._synthesizeChunk(cleanSpoken, targetVoice, prosody);
        }

        // Store in LRU cache
        if (audioCache.size >= MAX_CACHE_ENTRIES) {
          const oldestKey = audioCache.keys().next().value;
          audioCache.delete(oldestKey);
        }
        audioCache.set(cacheKey, {
          buffer: finalBuffer,
          contentType: 'audio/mpeg'
        });

        console.log(`[TTS Synthesis Success] Voice: ${targetVoice} | Buffer: ${finalBuffer.length} bytes | Cached: false`);

        return {
          buffer: finalBuffer,
          contentType: 'audio/mpeg',
          voice: targetVoice,
          cacheKey,
          fromCache: false
        };
      } catch (primaryErr) {
        console.warn(`[Microsoft Neural TTS] Primary synthesis notice (${targetVoice}):`, primaryErr.message);

        // Graceful fallback to Central AI Gateway if available
        try {
          const gatewayUrl = getPythonServiceUrl();
          const gatewayKey = getGatewayApiKey();

          const fallbackRes = await axios.post(`${gatewayUrl}/api/v1/tts/synthesize`, {
            text: cleanSpoken,
            voice: targetVoice,
            gender: gender === 'MALE' ? 'MALE' : 'FEMALE',
            rate: 0.95,
            pitch: 0.95
          }, {
            headers: {
              ...(gatewayKey ? { 'X-API-Key': gatewayKey } : {})
            },
            responseType: 'arraybuffer',
            timeout: 8000
          });

          if (fallbackRes.status === 200 && fallbackRes.data) {
            const fbBuffer = Buffer.from(fallbackRes.data);
            return {
              buffer: fbBuffer,
              contentType: fallbackRes.headers['content-type'] || 'audio/mpeg',
              voice: targetVoice,
              cacheKey,
              fromCache: false
            };
          }
        } catch (fbErr) {
          const mapped = formatGatewayError(fbErr);
          console.warn('[Microsoft Neural TTS] Central AI Gateway fallback notice:', mapped);
        }

        throw primaryErr;
      }
    })();

    this._inFlight.set(cacheKey, synthPromise);
    try {
      return await synthPromise;
    } finally {
      this._inFlight.delete(cacheKey);
    }
  }
}

export const microsoftNeuralTts = new MicrosoftNeuralTtsService();
export default microsoftNeuralTts;
