/**
 * SkillBridge Voice Tutor Interaction Manager
 *
 * Features:
 * - Always-on microphone
 * - Multilingual wake-word detection
 * - English
 * - Chinese
 * - Malay
 * - Tamil
 * - Bangla
 * - Course lecture interruption
 * - Wake detection while course is playing
 * - User question recording
 * - Whisper/RAG/LLM pipeline callback
 * - ARIA echo prevention
 * - Automatic follow-up listening
 * - Automatic course resume
 */

export const TutorState = {
  SLEEPING: 'SLEEPING',
  WAKE_DETECTED: 'WAKE_DETECTED',
  ARIA_GREETING: 'ARIA_GREETING',
  ACTIVE_LISTENING: 'ACTIVE_LISTENING',
  PROCESSING: 'PROCESSING',
  ARIA_SPEAKING: 'ARIA_SPEAKING',
  FOLLOW_UP_LISTENING: 'FOLLOW_UP_LISTENING',
  RETURN_TO_SLEEP: 'RETURN_TO_SLEEP',
  ERROR: 'ERROR'
};

export const LogCategory = {
  VOICE_STATE: 'VOICE_STATE',
  WAKE_DETECTION: 'WAKE_DETECTION',
  WAKE_MATCH: 'WAKE_MATCH',
  VAD_START: 'VAD_START',
  VAD_END: 'VAD_END',
  AUDIO_DURATION: 'AUDIO_DURATION',
  TRANSCRIPTION: 'TRANSCRIPTION',
  TRANSCRIPTION_CONFIDENCE: 'TRANSCRIPTION_CONFIDENCE',
  RAG_REQUEST: 'RAG_REQUEST',
  LLM_REQUEST: 'LLM_REQUEST',
  TTS_START: 'TTS_START',
  TTS_END: 'TTS_END',
  ECHO_REJECTED: 'ECHO_REJECTED',
  RETURN_TO_SLEEP: 'RETURN_TO_SLEEP'
};


/* ============================================================
   SUPPORTED LANGUAGES
============================================================ */

export const VOICE_LANGUAGE_CODES = {
  English: 'en-US',
  'English (US)': 'en-US',
  'English (UK)': 'en-GB',

  Chinese: 'zh-CN',
  'Chinese (中文)': 'zh-CN',

  Malay: 'ms-MY',
  'Malay (Bahasa Melayu)': 'ms-MY',

  Tamil: 'ta-IN',
  'Tamil (தமிழ்)': 'ta-IN',

  Bangla: 'bn-BD',
  'Bangla (বাংলা)': 'bn-BD',
  Bengali: 'bn-BD',

  Telugu: 'te-IN',
  'Telugu (తెలుగు)': 'te-IN'
};


export const normalizeTranscript = (text) => {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_~`()?'"“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getSpeechLanguageCode = (language) => {
  if (!language) {
    return 'en-US';
  }

  if (VOICE_LANGUAGE_CODES[language]) {
    return VOICE_LANGUAGE_CODES[language];
  }

  const value = String(language)
    .trim()
    .toLowerCase();

  if (value.includes('english')) {
    return 'en-US';
  }

  if (
    value.includes('chinese') ||
    value.includes('中文')
  ) {
    return 'zh-CN';
  }

  if (
    value.includes('malay') ||
    value.includes('bahasa melayu')
  ) {
    return 'ms-MY';
  }

  if (
    value.includes('tamil') ||
    value.includes('தமிழ்')
  ) {
    return 'ta-IN';
  }

  if (
    value.includes('bangla') ||
    value.includes('bengali') ||
    value.includes('বাংলা')
  ) {
    return 'bn-BD';
  }

  if (
    value.includes('telugu') ||
    value.includes('తెలుగు')
  ) {
    return 'te-IN';
  }

  // Already a BCP-47 language code
  if (
    /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(
      String(language)
    )
  ) {
    return String(language);
  }

  return 'en-US';
};


/* ============================================================
   WAKE WORDS
============================================================ */

/**
 * Greeting-only utterances must NEVER wake the tutor.
 * ASR often returns "hey" alone, or mishears "hey" as heria/haria.
 */
const GREETING_ONLY_SET = new Set([
  'hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'hai', 'helo', 'halo',
  'hay', 'heya', 'hiya', 'he', 'ha', 'ah', 'oh', 'um', 'uh',
  'excuse me', 'tolong', 'boleh',
  '嘿', '嗨', '你好', '喂',
  'ஹே', 'ஹாய்', 'ஹலோ', 'வணக்கம்', 'ஏய்',
  'হে', 'হেই', 'হাই', 'হ্যালো', 'নমস্কার', 'ওহে',
  'హే', 'హాయ్', 'హలో', 'నమస్కారం', 'ఏయ్'
]);

export const ARIA_VARIANTS_SET = new Set([
  'aria', 'area', 'arya', 'aarya', 'ariya', 'auria', 'oria', 'arria', 'avatar',
  'आरिया', 'आर्या', 'ஆரியா', 'ஆர்யா', 'அரியா', 'আরিয়া', 'আরিয়া', 'আর্য', 'ఆరియా', 'ఆర్యా', 'అరియా',
  '阿莉娅', '阿丽娅', '阿里亚', '艾莉亚', '艾丽娅'
]);

const WAKE_WORD_PATTERNS = [

  // ENGLISH — greeting / call + name (greeting alone is NOT enough)
  // "area" is a common browser-ASR mishear of "ARIA"
  /\b(?:hey|hi|hello|ok|okay|ask|yo|hay|heya|hiya|call|calling|wake\s+up|tell|listen)\s+(?:aria|arya|aarya|ariya|auria|oria|arria|area|avatar)\b/i,

  // ENGLISH — direct calling of avatar / assistant / AI
  /\b(?:hey|hi|hello|call|calling)\s+(?:avatar|ai\s+avatar|ai\s+tutor|assistant)\b/i,
  /\b(?:wake\s+up)\b/i,

  // ENGLISH — name alone (Siri-style), never greeting alone
  /\b(?:aria|arya|aarya|ariya|auria|oria|arria|area)\b/i,

  // CHINESE — name required
  /(?:嘿|嗨|你好|喂|请问|问一下)?\s*(?:阿莉娅|阿丽娅|阿里亚|艾莉亚|艾丽娅)/iu,
  /(?:嘿|嗨|你好)\s+(?:aria|arya|ariya)\b/iu,

  // MALAY — greeting + name
  /\b(?:hai|helo|hello|hey)\s+(?:aria|arya|ariya)\b/i,

  // TAMIL — name required
  /(?:ஹே|ஹாய்|ஹலோ|வணக்கம்|ஏய்)\s*(?:ஆரியா|ஆர்யா|அரியா)/iu,
  /(?:ஆரியா|ஆர்யா|அரியா)/iu,
  /(?:ஹே|ஹாய்|ஹலோ)\s+(?:aria|arya|ariya)\b/iu,

  // BANGLA — name required
  /(?:হে|হেই|হাই|হ্যালো|নমস্কার|ওহে)\s*(?:আরিয়া|আরিয়া|আর্য)/iu,
  /(?:আরিয়া|আরিয়া|আর্য)/iu,
  /(?:হে|হাই|হ্যালো)\s+(?:aria|arya|ariya)\b/iu,

  // TELUGU — name required
  /(?:హే|హాయ్|హలో|నమస్కారం|ఏయ్)\s*(?:ఆరియా|ఆర్యా|అరియా)/iu,
  /(?:ఆరియా|ఆర్యా|అరియా)/iu,
  /(?:హే|హాయ్|హలో)\s+(?:aria|arya|ariya)\b/iu,

  // GENERIC native-script name alone
  /(?:आरिया|आर्या|ஆரியா|ஆர்யா|அரியா|আরিয়া|আরিয়া|আর্য|ఆరియా|ఆర్యా|అరియా|阿莉娅|阿丽娅|阿里亚|艾莉亚|艾丽娅)/iu
];


/* ============================================================
   ARIA SELF-ECHO PHRASES
============================================================ */

export const KNOWN_SELF_ECHO_PATTERNS = [

  // English greetings & acknowledgments
  /\b(?:yes|yeah|ya)?\s*(?:tell\s+me|im\s+listening|i\s+am\s+listening|listening|please\s+tell\s+me)\b/i,

  /\b(?:yes\s+tell\s+me|tell\s+me\s+i'm\s+listening|tell\s+me\s+im\s+listening|yes\s+i'm\s+listening|yes\s+im\s+listening)\b/i,

  /\b(?:continuing\s+to\s+(?:the\s+)?course|resuming\s+(?:the\s+)?course|resuming\s+(?:the\s+)?lecture|back\s+to\s+(?:the\s+)?lecture)\b/i,

  /\b(?:hello\s+i\s+am\s+aria|i\s+am\s+aria|your\s+personal\s+ai\s+tutor)\b/i,

  // ARIA fallback & prompt echoes (CRITICAL - prevents self-talking loop!)
  /\b(?:i\s+didn'?t\s+catch\s+(?:your\s+)?question|didn'?t\s+catch\s+(?:your\s+)?question|can\s+you\s+ask\s+again|could\s+you\s+(?:please\s+)?ask\s+again|please\s+ask\s+again|ask\s+(?:your\s+question\s+)?again)\b/i,

  /\b(?:i\s+did\s+not\s+catch|did\s+not\s+catch\s+a\s+question|please\s+ask\s+me\s+something|ask\s+me\s+something\s+about\s+this\s+lesson)\b/i,

  /\b(?:i'?m\s+ready\s+to\s+help\s+with\s+your\s+course\s+questions|how\s+can\s+i\s+help\s+you|what\s+would\s+you\s+like\s+to\s+know)\b/i,

  /\b(?:i'?ll\s+check\s+check\s+check|check\s+check\s+check|hello\s+dear)\b/i,

  // Chinese
  /(?:我在听|请问有什么可以帮您|我在听请问|请问有什么|正在继续课程|继续课程|我没有听清您的提问|请再问一次|请重新提问)/iu,

  // Malay
  /\b(?:ya\s+saya\s+mendengar|sila\s+beritahu\s+saya|saya\s+mendengar|sila\s+beritahu|menyambung\s+semula\s+kursus|menyambung\s+ke\s+kursus|saya\s+tidak\s+dapat\s+menangkap\s+soalan|sila\s+tanya\s+semula)\b/i,

  // Tamil
  /(?:சொல்லுங்கள்|நான்\s*கேட்கிறேன்|சொல்லுங்கள்\s*நான்\s*கேட்கிறேன்|பாடத்தைத்\s*தொடர்கிறேன்|பாடத்தைத்\s*தொடர்கிறது|உங்கள்\s*கேள்வி\s*புரியவில்லை|மீண்டும்\s*கேளுங்கள்)/iu,

  // Bangla
  /(?:হ্যাঁ\\s*বলুন|আমি\\s*শুনছি|বলুন\\s*আমি\\s*শুনছি|আমি\\s*শুনছি|কোর্সে\\s*ফিরে\\s*যাচ্ছি|ক্লাস\\s*চালু\\s*করছি|প্রশ্নটি\\s*বুঝতে\\s*পারিনি|আবার\\s*জিজ্ঞাসা\\s*করুন)/iu
];

// Phonetic misrecognition dictionary for popular voice assistant names
const NAME_PHONETIC_VARIANTS = {
  veda: ['veda', 'vedha', 'vaida', 'veeda', 'weda'],
  maya: ['maya', 'maia', 'mya', 'maiya'],
  aria: ['aria', 'area', 'arya', 'aarya', 'ariya', 'auria', 'oria', 'arria'],
  jarvis: ['jarvis', 'jarves', 'javis'],
  sophia: ['sophia', 'sofia', 'sofiya'],
  alex: ['alex', 'alec', 'alix'],
  elena: ['elena', 'alena', 'helena']
};

export const containsWakeWord = (text, customWakeWord = null, aiName = null) => {
  if (!text) {
    return false;
  }

  const normalized = normalizeTranscript(text);
  if (!normalized) {
    return false;
  }

  // Never wake on greeting-only speech ("hey", "hi", "hello", …)
  if (GREETING_ONLY_SET.has(normalized)) {
    return false;
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => GREETING_ONLY_SET.has(t))) {
    return false;
  }

  // Never wake from self-echo speech
  if (
    KNOWN_SELF_ECHO_PATTERNS.some(
      (pattern) => pattern.test(normalized)
    )
  ) {
    return false;
  }

  // Check custom AI Name and Wake Word if configured by Company Admin
  const cleanAiName = (aiName || '').trim();
  const cleanWakeWord = (customWakeWord || '').trim();
  const nameLower = cleanAiName.toLowerCase();

  if (cleanAiName) {
    const escapedName = cleanAiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const customPatterns = [
      new RegExp(`(?:^|\\b)(?:hey|hi|hello|ok|okay|ask|yo|hay|heya|hiya|dear|call|calling)\\s+${escapedName}\\b`, 'i'),
      new RegExp(`\\b${escapedName}\\b`, 'i'),
    ];

    if (cleanWakeWord) {
      const escapedWake = cleanWakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      customPatterns.push(new RegExp(`(?:^|\\b)${escapedWake}\\b`, 'i'));
    }

    const phoneticList = NAME_PHONETIC_VARIANTS[nameLower] || [nameLower];
    for (const variant of phoneticList) {
      if (variant !== nameLower) {
        const escapedVar = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        customPatterns.push(new RegExp(`(?:^|\\b)(?:hey|hi|hello|ok|okay|ask|yo|hay|heya|hiya|dear|call|calling)?\\s*${escapedVar}\\b`, 'i'));
      }
    }

    if (customPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    if (tokens.some((token) => phoneticList.includes(token.toLowerCase()))) {
      return true;
    }
  }

  // Full configured wake phrase (e.g. "Hey ARIA")
  if (cleanWakeWord) {
    const wakeNorm = normalizeTranscript(cleanWakeWord);
    if (wakeNorm && !GREETING_ONLY_SET.has(wakeNorm) && normalized.includes(wakeNorm)) {
      return true;
    }
  }

  // Complete phrase matching for default ARIA wake words
  if (
    WAKE_WORD_PATTERNS.some(
      (pattern) => pattern.test(normalized)
    )
  ) {
    return true;
  }

  // Name-token matching only (never greeting tokens)
  return tokens.some(
    (token) => ARIA_VARIANTS_SET.has(token) && !GREETING_ONLY_SET.has(token)
  );
};


/* ============================================================
   REMOVE WAKE WORD FROM QUESTION
============================================================ */

export const extractQuestionFromWakeWord = (
  text,
  customWakeWord = null,
  aiName = null
) => {
  if (!text) {
    return '';
  }

  let clean = String(text).trim();
  const cleanAiName = (aiName || '').trim();
  const cleanWakeWord = (customWakeWord || '').trim();
  const nameLower = cleanAiName.toLowerCase();

  // Strip custom wake word first if provided
  if (cleanWakeWord) {
    const escapedWake = cleanWakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`^(?:hey|hi|hello|ok|okay|ask|hay|heya|hiya|yo|dear)?\\s*${escapedWake}\\s*[,.:!?-]*`, 'iu'), '');
  }

  // If a custom company AI name is configured, strip it from the start of the question
  if (cleanAiName) {
    const escapedName = cleanAiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(
      new RegExp(`^(?:hey|hi|hello|ok|okay|ask|hay|heya|hiya|yo|dear|here|hear|excuse\\s+me|hai|helo|halo|tolong|boleh)?\\s*(?:${escapedName})\\s*[,.:!?-]*`, 'iu'),
      ''
    );

    const phoneticList = NAME_PHONETIC_VARIANTS[nameLower];
    if (phoneticList) {
      for (const variant of phoneticList) {
        const escapedVar = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        clean = clean.replace(
          new RegExp(`^(?:hey|hi|hello|ok|okay|ask|hay|heya|hiya|yo|dear|here|hear|excuse\\s+me)?\\s*(?:${escapedVar})\\s*[,.:!?-]*`, 'iu'),
          ''
        );
      }
    }
  }

  // English / Malay ARIA variants (include "area" ASR mishear; exclude heria/haria)
  clean = clean.replace(
    /^(?:hey|hi|hello|ok|okay|ask|hay|heya|hiya|yo|dear|here|hear|excuse\s+me|hai|helo|halo|tolong|boleh|call|calling)?\s*(?:aria|area|arya|aarya|ariya|auria|oria|arria|avatar)\s*[,.:!?-]*/iu,
    ''
  );

  // Chinese
  clean = clean.replace(
    /^(?:嘿|嗨|你好|喂|请问|问一下)?\s*(?:阿莉娅|阿丽娅|阿里亚|艾莉亚|艾丽娅)\s*[,.:!?-]*/iu,
    ''
  );

  // Tamil
  clean = clean.replace(
    /^(?:ஹே|ஹாய்|ஹலோ|வணக்கம்|ஏய்)?\s*(?:ஆரியா|ஆர்யா|அரியா|ஏரியா)\s*[,.:!?-]*/iu,
    ''
  );

  // Bangla
  clean = clean.replace(
    /^(?:হে|হেই|হাই|হ্যালো|নমস্কার)?\s*(?:আরিয়া|আরিয়া|আর্য|এরিয়া|এরিয়া)\s*[,.:!?-]*/iu,
    ''
  );

  // Telugu
  clean = clean.replace(
    /^(?:హే|హాయ్|హలో|నమస్కారం|ఏయ్)?\s*(?:ఆరియా|ఆర్యా|అరియా|ఏరియా)\s*[,.:!?-]*/iu,
    ''
  );

  return clean.trim();
};






/* ============================================================
   NOISE / HALLUCINATION DETECTION
============================================================ */

export const isNoiseOrHallucination = (text) => {
  if (!text) {
    return true;
  }

  const t = normalizeTranscript(text);

  if (!t || t.length < 3) {
    return true;
  }

  // 1. Repeated character babble (e.g. "aaaaa", ".....", "hehehehe")
  if (/(.)\1{4,}/.test(t)) {
    return true;
  }

  // 2. Tokenize into words
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }

  // 3. Consecutive word repetition (e.g. "check check check", "hello hello hello")
  let maxConsecutive = 1;
  let currentConsecutive = 1;
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) {
      currentConsecutive++;
      if (currentConsecutive > maxConsecutive) {
        maxConsecutive = currentConsecutive;
      }
    } else {
      currentConsecutive = 1;
    }
  }
  if (maxConsecutive >= 3) {
    return true;
  }

  // 4. Low vocabulary variety / Whisper repetition loops (e.g. "hello dear hello dear hello hello hello")
  const uniqueWords = new Set(words);
  if (words.length >= 3 && uniqueWords.size <= 1) {
    return true;
  }
  if (words.length >= 4 && uniqueWords.size <= 2) {
    return true;
  }
  if (words.length >= 6 && uniqueWords.size <= 3) {
    return true;
  }

  // 5. 2-word / sentence repetition loops (Whisper ambient hallucinations)
  if (words.length >= 4 && words.length % 2 === 0) {
    const half = words.length / 2;
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    if (firstHalf === secondHalf) {
      return true;
    }
  }

  // Detect repeated phrase loops after punctuation was stripped
  // e.g. "im going to put it on the back im going to put it on the back"
  if (words.length >= 8) {
    for (let len = 4; len <= Math.floor(words.length / 2); len++) {
      const phraseWords = words.slice(0, len);
      let repeats = 1;
      for (let i = len; i + len <= words.length; i += len) {
        const chunk = words.slice(i, i + len);
        if (chunk.every((w, idx) => w === phraseWords[idx])) repeats += 1;
        else break;
      }
      if (repeats >= 2) return true;
    }
  }

  // 6. Common noise, hallucination, and echo prompts
  const singleWordNoise = new Set([
    'you', 'so', 'bye', 'goodbye', 'okay bye', 'yes', 'yeah', 'ok', 'okay',
    'hey', 'hi', 'hello', 'hai', 'helo', 'yo', 'hay', 'heya', 'hiya',
    'tell me', 'listening', 'im listening', 'i am listening', 'check', 'testing',
    'indian', 'close', 'thank you', 'thanks'
  ]);

  if (singleWordNoise.has(t)) {
    return true;
  }

  const exactHallucinations = new Set([
    'blank audio', 'blank_audio', 'silence', 'music', 'applause',
    'thank you', 'thank you for watching', 'thanks for watching', 'thanks',
    'thank you very much', 'you are very welcome', 'youre very welcome',
    'see you in the next video', 'see you in the next one', 'see you next time', 'see you later',
    'i will see you', 'i will see you in the next', 'subtitles by', 'subscribe to',
    'subscribe', 'like and subscribe', 'translated by',
    'check check', 'check check check', 'testing testing', 'testing 1 2 3',
    'one two three', 'hello dear hello dear', 'hello hello',
    'i hope you have a nice day', 'i hope you have a nice days good good job'
  ]);

  if (exactHallucinations.has(t)) {
    return true;
  }

  // Ambient Whisper fluff that is not a course question
  if (
    /^(?:you are very welcome|i'?m going to put it on the (?:back|table)|i hope you have a nice day)/i.test(t) &&
    !/\b(?:what|why|how|when|where|who|explain|mean|ppe|safety|driver|course|lesson)\b/i.test(t)
  ) {
    return true;
  }

  return false;
};

/**
 * Detects if a partial speech segment is an incomplete / dangling fragment.
 * e.g. "what is P", "what is", "tell me about", "can you explain the"
 * Prevents premature submission when the speaker pauses mid-sentence.
 */
export const isDanglingFragment = (text) => {
  if (!text) return true;
  const t = String(text).trim();
  if (t.length < 2) return true;

  // Single trailing latin letter after space (e.g. 'what is P', 'define a')
  // Complete acronyms like "PPE" or "AI" have length >= 2 and won't match /\s[a-zA-Z]$/
  if (/\s[a-zA-Z]$/.test(t)) {
    return true;
  }

  // Non-Latin scripts without spaces (e.g. Chinese characters: \u4e00-\u9fa5)
  if (/[\u4e00-\u9fa5]/.test(t) && t.length >= 4) {
    return false;
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    const standaloneAllowed = /^(help|stop|pause|resume|repeat|continue|explain|quit)$/i.test(t);
    return !standaloneAllowed;
  }

  // If ends in open preposition, article, auxiliary verb, conjunction, or question starter:
  const danglingEndPattern = /\b(is|are|am|was|were|the|a|an|to|of|in|for|and|with|at|from|or|about|that|which|by|can|could|would|should|do|does|did|will|what|why|how|who|when|where|please|as|if|then|than|into|onto|under|over)\s*$/i;
  if (danglingEndPattern.test(t)) {
    return true;
  }

  // If only 2 words and starts with interrogative / auxiliary verb (e.g. "what is", "can you", "how to")
  if (words.length <= 2 && /^(what|why|how|who|when|where|can|could|would|should|is|are|do|does|did)\b/i.test(t)) {
    return true;
  }

  return false;
};


/* ============================================================
   VOICE TUTOR MANAGER
============================================================ */

export class VoiceTutorManager {

  constructor(options = {}) {

    this.options = {

      debug: true,

      followUpTimeoutMs: 12000,

      speechRmsThreshold: 18,

      silenceRmsThreshold: 10,

      silenceDurationMs: 2000,

      maxRecordingMs: 15000,

      ...options
    };

    this.aiName = (this.options.aiName || 'ARIA').trim();
    this.wakeWord = (this.options.wakeWord || `Hey ${this.aiName}`).trim();

    this.state =
      TutorState.SLEEPING;



    this.stateListeners =
      new Set();


    /* ----------------------------------------------------------
       AUDIO
    ---------------------------------------------------------- */

    this.micStream = null;

    this.audioContext = null;

    this.analyser = null;

    this.mediaRecorder = null;

    this.audioChunks = [];

    this.vadInterval = null;

    this.recognition = null;


    /* ----------------------------------------------------------
       FLAGS
    ---------------------------------------------------------- */

    this.isMounted = false;

    this.isTutorSpeaking = false;

    this._tutorSpeechSessionActive = false;

    this.isLecturePlaying = false;

    this.ttsMutedUntil = 0;

    this.recentAriaUtterances = [];

    this.followUpTimeoutId = null;

    this.cooldownTimeoutId = null;


    /* ----------------------------------------------------------
       VAD
    ---------------------------------------------------------- */

    this.speechFramesCount = 0;

    this.lastSpeechTime = 0;

    this.recordingStartTime = 0;

    this.isRecording = false;

    this._accumulatedTranscript = '';
    this._latestInterimText = '';
    this._interimDebounceTimer = null;
    this._finalDebounceTimer = null;


    /* ----------------------------------------------------------
       DEDUP
    ---------------------------------------------------------- */

    this.lastProcessedText = '';

    this.lastProcessedTime = 0;


    /* ----------------------------------------------------------
       RESTART
    ---------------------------------------------------------- */

    this.isRestarting = false;

    this.restartTimer = null;


    /* ----------------------------------------------------------
       LANGUAGE
    ---------------------------------------------------------- */

    this.langCode = 'en-US';
  }


  /* ==========================================================
     LOGGING
  ========================================================== */

  log(
    category,
    message,
    data = null
  ) {

    if (!this.options.debug) {
      return;
    }

    const prefix =
      `[VOICE:${category}]`;

    if (
      data !== null &&
      data !== undefined
    ) {

      console.log(
        `${prefix} ${message}`,
        data
      );

    } else {

      console.log(
        `${prefix} ${message}`
      );
    }
  }


  /* ==========================================================
     STATE LISTENER
  ========================================================== */

  onStateChange(listener) {

    this.stateListeners.add(
      listener
    );

    return () =>
      this.stateListeners.delete(
        listener
      );
  }


  setState(newState) {

    if (
      this.state === newState
    ) {
      return;
    }

    const oldState =
      this.state;

    this.state =
      newState;

    // Watchdog: LLM + Whisper can take well over 6s. Only recover if truly stuck.
    if (this._processingWatchdog) {
      clearTimeout(this._processingWatchdog);
      this._processingWatchdog = null;
    }
    if (newState === TutorState.PROCESSING) {
      this._processingWatchdog = setTimeout(() => {
        if (this.state === TutorState.PROCESSING && !this.isTutorSpeaking) {
          console.warn('[VOICE] Processing state watchdog timeout (45s). Auto-recovering to SLEEPING.');
          this.returnToSleep();
        }
      }, 45000);
    }

    this.log(
      LogCategory.VOICE_STATE,
      `${oldState} -> ${newState}`
    );


    this.stateListeners.forEach(
      (listener) => {

        try {

          listener(newState);

        } catch (error) {

          console.error(
            '[VOICE] State listener error:',
            error
          );

        }

      }
    );
  }


  /* ==========================================================
     COURSE PLAYBACK STATE
  ========================================================== */

  setLecturePlaying(isPlaying) {

    this.isLecturePlaying =
      Boolean(isPlaying);


    this.log(
      LogCategory.VOICE_STATE,
      `Course lecture playing: ${this.isLecturePlaying}`
    );


    /*
     * IMPORTANT:
     *
     * Do NOT stop SpeechRecognition here.
     *
     * During course playback:
     *
     *     microphone = ON
     *     wake recognition = ON
     *
     * The user can say:
     *
     *     "Hey Aria"
     *     "Aria"
     *
     * and interrupt the lesson.
     */


    if (isPlaying) {
      if (this.isRecording) {
        this.stopMediaRecording();
        this.clearBuffers();
      }
      // Lecture audio must not be treated as a follow-up question.
      if (
        this.state === TutorState.FOLLOW_UP_LISTENING ||
        this.state === TutorState.ACTIVE_LISTENING
      ) {
        this.setState(TutorState.SLEEPING);
      }
    }
  }

  noteSpokenText(spokenText = '') {
    if (!spokenText) return;
    this.recentAriaUtterances.push(spokenText);
    if (this.recentAriaUtterances.length > 12) {
      this.recentAriaUtterances.shift();
    }
  }


  /* ==========================================================
     AWAKE
  ========================================================== */

  setAwake(awake) {

    if (awake) {

      if (
        this.state ===
        TutorState.SLEEPING
      ) {

        this.setState(
          TutorState.ACTIVE_LISTENING
        );

      }

      this.resetFollowUpTimeout();

    } else {

      if (
        !this.isTutorSpeaking
      ) {

        this.returnToSleep();

      }
    }
  }


  /* ==========================================================
     CONVERSATION MODE
  ========================================================== */

  setConversationMode(
    inConversation
  ) {

    this.inConversationMode =
      inConversation;


    if (inConversation) {

      if (
        this.state ===
        TutorState.SLEEPING
      ) {

        this.setState(
          TutorState.ACTIVE_LISTENING
        );

      }

      this.resetFollowUpTimeout();

    } else {

      if (
        !this.isTutorSpeaking
      ) {

        this.returnToSleep();

      }
    }
  }


  /* ==========================================================
     START
  ========================================================== */

  async start(
    langCode = 'en-US'
  ) {

    const newLang =
      getSpeechLanguageCode(
        langCode
      );


    this.langCode =
      newLang;


    if (this.isMounted) {

      this.log(
        LogCategory.WAKE_DETECTION,
        `Updating wake language to ${newLang}`
      );


      this.restartSpeechRecognition(
        true
      );

      return;
    }


    this.isMounted =
      true;


    this.log(
      LogCategory.VOICE_STATE,
      `Initializing Voice Tutor Manager (${newLang})`
    );


    try {

      try {
        await this.initMicrophonePipeline();
      } catch (micErr) {
        console.warn('[VOICE] Microphone pipeline initialization notice (SpeechRecognition will handle wake word):', micErr);
      }

      this.initSpeechRecognition();

      this.setState(
        TutorState.SLEEPING
      );

    } catch (error) {

      console.error(
        '[VOICE] Initialization error:',
        error
      );

      this.setState(
        TutorState.ERROR
      );
    }
  }


  /* ==========================================================
     CHANGE LANGUAGE
  ========================================================== */

  setLanguage(language) {

    const newLang =
      getSpeechLanguageCode(
        language
      );


    if (
      newLang ===
      this.langCode
    ) {

      return;
    }


    this.log(
      LogCategory.WAKE_DETECTION,
      `Language changed: ${this.langCode} -> ${newLang}`
    );


    this.langCode =
      newLang;


    if (
      this.isMounted
    ) {

      this.restartSpeechRecognition(
        true
      );
    }
  }


  /* ==========================================================
     MICROPHONE PIPELINE
  ========================================================== */

  async initMicrophonePipeline() {

    try {

      const stream =
        await navigator.mediaDevices.getUserMedia({

          audio: {

            echoCancellation: true,

            noiseSuppression: true,

            autoGainControl: true
          }

        });


      if (!this.isMounted) {

        stream
          .getTracks()
          .forEach(
            (track) =>
              track.stop()
          );

        return;
      }


      this.micStream =
        stream;


      this.log(
        LogCategory.VOICE_STATE,
        'Microphone initialized with echo cancellation'
      );


      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;


      if (!AudioCtx) {

        throw new Error(
          'Web Audio API not supported'
        );
      }


      const audioContext =
        new AudioCtx();


      if (
        audioContext.state ===
        'suspended'
      ) {

        await audioContext.resume().catch(() => {});

      }


      const source =
        audioContext.createMediaStreamSource(
          stream
        );


      const analyser =
        audioContext.createAnalyser();


      analyser.fftSize =
        512;


      analyser.smoothingTimeConstant =
        0.3;


      source.connect(
        analyser
      );


      this.audioContext =
        audioContext;


      this.analyser =
        analyser;


      const bufferLength =
        analyser.frequencyBinCount;


      const dataArray =
        new Uint8Array(
          bufferLength
        );


      if (
        this.vadInterval
      ) {

        clearInterval(
          this.vadInterval
        );
      }


      this.vadInterval =
        setInterval(() => {

          if (
            !this.isMounted ||
            !this.analyser
          ) {

            return;
          }


          if (
            this.audioContext &&
            this.audioContext.state ===
            'suspended'
          ) {

            this.audioContext
              .resume()
              .catch(() => { });

          }


          /*
           * ARIA answer / greeting.
           *
           * Do not record user audio.
           */

          if (

            this.isTutorSpeaking ||

            Date.now() <
            this.ttsMutedUntil ||

            this.state ===
            TutorState.ARIA_GREETING ||

            this.state ===
            TutorState.ARIA_SPEAKING ||

            this.state ===
            TutorState.PROCESSING

          ) {

            this.speechFramesCount =
              0;

            return;
          }


          this.analyser.getByteFrequencyData(
            dataArray
          );


          let sumSquares =
            0;


          for (
            let i = 0;
            i < bufferLength;
            i++
          ) {

            sumSquares +=
              dataArray[i] *
              dataArray[i];

          }


          const rms =
            Math.sqrt(
              sumSquares /
              bufferLength
            );


          const now =
            Date.now();


          /*
           * Recording user question.
           */

          if (
            this.isRecording
          ) {
            if (!this._recordPeakRms) this._recordPeakRms = rms;
            if (rms > this._recordPeakRms) this._recordPeakRms = rms;

            // Treat as speech if above absolute floor OR above 15% of peak (leaves room for natural trailing syllables)
            const speechFloor = Math.max(
              this.options.silenceRmsThreshold,
              (this._recordPeakRms || 0) * 0.15
            );

            if (rms >= speechFloor) {
              this.lastSpeechTime = now;
            }

            const silenceDuration = now - this.lastSpeechTime;
            const totalDuration = now - this.recordingStartTime;
            const maxMs = (this.recordingStateAtStart === TutorState.SLEEPING)
              ? this.options.maxRecordingMs
              : Math.min(this.options.maxRecordingMs, 15000);

            if (
              (silenceDuration >= this.options.silenceDurationMs && totalDuration >= 800) ||
              totalDuration >= maxMs
            ) {
              this.log(
                LogCategory.VAD_END,
                `User speech ended (${totalDuration}ms)`
              );
              this.stopMediaRecording();
            }

            return;
          }


          /*
           * VAD Speech Detection:
           * - In ACTIVE_LISTENING / FOLLOW_UP_LISTENING: records user question.
           * - In SLEEPING: records speech candidates for Whisper wake-word / interruption detection.
           */
          if (this.isTutorSpeaking || Date.now() < this.ttsMutedUntil) {
            this.speechFramesCount = 0;
            return;
          }

          if (
            this.state === TutorState.ACTIVE_LISTENING ||
            this.state === TutorState.FOLLOW_UP_LISTENING ||
            this.state === TutorState.SLEEPING
          ) {
            if (this.isLecturePlaying && this.state !== TutorState.SLEEPING) {
              this.speechFramesCount = 0;
              return;
            }
            if (rms >= this.options.speechRmsThreshold) {
              this.speechFramesCount += 1;
              // Sleeping (wake) needs stronger sustained speech to avoid ambient triggers
              const framesNeeded = this.state === TutorState.SLEEPING ? 5 : 3;

              if (this.speechFramesCount >= framesNeeded) {
                this.speechFramesCount = 0;
                this.log(
                  LogCategory.VAD_START,
                  `User speech detected (State: ${this.state}, LecturePlaying: ${this.isLecturePlaying}) RMS=${rms.toFixed(1)}`
                );

                this.clearFollowUpTimeout();
                this.startMediaRecording();
              }
            } else {
              this.speechFramesCount = 0;
            }
          }
        }, 40);

    } catch (error) {
      console.error(
        '[VOICE] Microphone initialization failed:',
        error
      );

      this.setState(
        TutorState.ERROR
      );

      throw error;
    }
  }

  /* ==========================================================
     START RECORDING
  ========================================================== */

  startMediaRecording() {
    if (!this.micStream || this.isRecording) {
      return;
    }

    this.recordingStateAtStart = this.state;
    this._recordPeakRms = 0;

    try {

      if (
        this.mediaRecorder &&
        this.mediaRecorder.state !==
        'inactive'
      ) {

        try {

          this.mediaRecorder.stop();

        } catch (e) { }
      }


      this.audioChunks =
        [];


      const mimeType =
        MediaRecorder.isTypeSupported(
          'audio/webm;codecs=opus'
        )

          ? 'audio/webm;codecs=opus'

          : MediaRecorder.isTypeSupported(
            'audio/webm'
          )

            ? 'audio/webm'

            : '';


      const recorder =
        mimeType

          ? new MediaRecorder(
            this.micStream,
            {
              mimeType
            }
          )

          : new MediaRecorder(
            this.micStream
          );


      recorder.ondataavailable =
        (event) => {

          if (
            event.data &&
            event.data.size > 0
          ) {

            this.audioChunks.push(
              event.data
            );
          }
        };


      recorder.onstop =
        async () => {

          this.isRecording =
            false;

          if (this._skipNextAudioCapture) {
            this._skipNextAudioCapture = false;
            this.audioChunks = [];
            return;
          }

          /*
           * Never submit audio recorded
           * during ARIA speech.
           */

          // Only discard if tutor is still speaking. Do NOT use ttsMutedUntil here —
          // that gate was dropping the user's first question right after "Yes, I'm listening."
          if (this.isTutorSpeaking) {
            this.log(
              LogCategory.ECHO_REJECTED,
              'Discarding recording because ARIA is speaking'
            );
            this.audioChunks = [];
            return;
          }


          const audioBlob =
            new Blob(
              this.audioChunks,
              {
                type:
                  recorder.mimeType ||
                  'audio/webm'
              }
            );


          this.audioChunks =
            [];


          const duration =
            Date.now() -
            this.recordingStartTime;


          this.log(
            LogCategory.AUDIO_DURATION,
            `Audio captured: ${audioBlob.size} bytes / ${duration}ms`
          );


          if (

            audioBlob.size <
            2500 ||

            duration < 600

          ) {

            this.log(
              LogCategory.TRANSCRIPTION,
              'Audio too short; ignored'
            );


            if (

              this.state ===
              TutorState.ACTIVE_LISTENING ||

              this.state ===
              TutorState.FOLLOW_UP_LISTENING

            ) {

              this.resetFollowUpTimeout();

            }


            return;
          }


          if (this.options.onAudioCaptured) {
            const recordedState = this.recordingStateAtStart || this.state;
            const wasSleeping = (recordedState === TutorState.SLEEPING);

            if (!wasSleeping) {
              this.setState(TutorState.PROCESSING);
            }

            try {
              await this.options.onAudioCaptured(audioBlob, {
                state: recordedState,
                isWakeDetection: wasSleeping,
                isLecturePlaying: this.isLecturePlaying
              });
            } catch (error) {
              console.error(
                '[VOICE] onAudioCaptured failed:',
                error
              );

              if (this.state === TutorState.PROCESSING) {
                this.setState(
                  TutorState.FOLLOW_UP_LISTENING
                );

                this.resetFollowUpTimeout();
              }
            }
          }

        };


      recorder.start(250);


      this.mediaRecorder =
        recorder;


      this.isRecording =
        true;


      this.recordingStartTime =
        Date.now();


      this.lastSpeechTime =
        Date.now();


    } catch (error) {

      console.error(
        '[VOICE] MediaRecorder error:',
        error
      );


      this.isRecording =
        false;
    }
  }


  /* ==========================================================
     STOP RECORDING
  ========================================================== */

  stopMediaRecording(options = {}) {
    if (options.skipCapture) {
      this._skipNextAudioCapture = true;
      this.audioChunks = [];
    }

    this.isRecording = false;

    if (
      this.mediaRecorder &&
      this.mediaRecorder.state ===
      'recording'
    ) {
      try {
        this.mediaRecorder.stop();
      } catch (error) {
        console.warn(
          '[VOICE] Error stopping recorder:',
          error
        );
      }
    }
  }


  /* ==========================================================
     SPEECH RECOGNITION
  ========================================================== */

  initSpeechRecognition() {

    const SpeechRec =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;


    if (!SpeechRec) {

      this.log(
        LogCategory.WAKE_DETECTION,
        'SpeechRecognition unavailable. Wake detection requires Whisper/backend fallback.'
      );


      return;
    }


    try {

      if (
        this.recognition
      ) {

        try {

          this.recognition.abort();

        } catch (e) { }

      }


      const rec =
        new SpeechRec();


      rec.continuous =
        true;


      rec.interimResults =
        true;


      rec.maxAlternatives =
        5;


      rec.lang =
        this.langCode ||
        'en-US';


      rec.onstart =
        () => {

          this.isRestarting =
            false;


          this.log(
            LogCategory.WAKE_DETECTION,
            `Wake listener active: ${rec.lang}`
          );
        };


      rec.onresult =
        (event) => {

          if (
            !this.isMounted
          ) {

            return;
          }


          /*
           * Process ALL new recognition results.
           *
           * This is important for:
           *
           * "Hey"
           *
           * followed by:
           *
           * "Aria"
           */

          for (
            let i = event.resultIndex;
            i < event.results.length;
            i++
          ) {

            const result =
              event.results[i];


            if (
              !result ||
              !result[0]
            ) {

              continue;
            }


            let transcript =
              result[0]
                .transcript
                .trim();

            for (let alt = 0; alt < result.length; alt++) {
              const cand = result[alt]?.transcript?.trim();
              if (cand && containsWakeWord(cand, this.wakeWord, this.aiName)) {
                transcript = cand;
                break;
              }
            }


            if (!transcript) {
              continue;
            }

            const isFinal =
              result.isFinal;

            this.log(
              LogCategory.TRANSCRIPTION,
              `Wake ASR ${isFinal ? 'FINAL' : 'INTERIM'} (${rec.lang}): "${transcript}"`
            );

            this.handleTranscriptEvent(
              transcript,
              isFinal
            );
          }
        };


      rec.onerror =
        (event) => {

          if (
            event.error !==
            'no-speech' &&

            event.error !==
            'aborted'
          ) {

            console.warn(
              '[VOICE] SpeechRecognition:',
              event.error
            );
          }


          if (
            this.isMounted &&
            !this.isTutorSpeaking
          ) {

            if (
              event.error ===
              'network' ||

              event.error ===
              'service-not-allowed' ||

              event.error ===
              'audio-capture'
            ) {

              this.scheduleRestart();
            }
          }
        };


      rec.onend =
        () => {

          this.log(
            LogCategory.WAKE_DETECTION,
            `Wake listener ended | Lecture=${this.isLecturePlaying} | TutorSpeaking=${this.isTutorSpeaking}`
          );


          /*
           * Course playback is NOT a reason
           * to stop wake recognition.
           */

          if (

            this.isMounted &&

            !this.isTutorSpeaking &&

            Date.now() >=
            this.ttsMutedUntil

          ) {

            this.scheduleRestart();
          }
        };


      this.recognition =
        rec;


      rec.start();


    } catch (error) {

      console.warn(
        '[VOICE] SpeechRecognition initialization:',
        error
      );


      this.recognition =
        null;


      if (
        this.isMounted
      ) {

        this.scheduleRestart();
      }
    }
  }


  /* ==========================================================
     RESTART SPEECH RECOGNITION
  ========================================================== */

  restartSpeechRecognition(
    force = false
  ) {

    if (
      !this.isMounted
    ) {

      return;
    }


    if (
      this.isRestarting &&
      !force
    ) {

      return;
    }


    this.isRestarting =
      true;


    if (
      this.restartTimer
    ) {

      clearTimeout(
        this.restartTimer
      );
    }


    if (
      this.recognition
    ) {

      try {

        this.recognition.onend =
          null;

        this.recognition.onerror =
          null;

        this.recognition.onresult =
          null;

        this.recognition.abort();

      } catch (e) { }


      this.recognition =
        null;
    }


    this.restartTimer =
      setTimeout(() => {

        this.restartTimer =
          null;


        if (
          !this.isMounted
        ) {

          this.isRestarting =
            false;

          return;
        }


        /*
         * If ARIA is speaking,
         * don't start recognition yet.
         */

        if (
          this.isTutorSpeaking ||
          Date.now() <
          this.ttsMutedUntil
        ) {

          this.isRestarting =
            false;

          return;
        }


        try {

          this.initSpeechRecognition();

        } catch (error) {

          console.warn(
            '[VOICE] Recognition restart failed:',
            error
          );

        }


        this.isRestarting =
          false;

      }, force ? 100 : 250);
  }


  scheduleRestart() {

    if (
      !this.isMounted
    ) {

      return;
    }


    if (
      this.isRestarting
    ) {

      return;
    }


    this.isRestarting =
      true;


    setTimeout(() => {

      if (
        !this.isMounted
      ) {

        this.isRestarting =
          false;

        return;
      }


      if (
        this.isTutorSpeaking ||
        Date.now() <
        this.ttsMutedUntil
      ) {

        this.isRestarting =
          false;

        return;
      }


      try {

        if (
          this.recognition
        ) {

          try {

            this.recognition.start();

          } catch (error) {

            if (
              error?.name !==
              'InvalidStateError'
            ) {

              this.initSpeechRecognition();

            }

          }

        } else {

          this.initSpeechRecognition();

        }

      } catch (error) {

        console.warn(
          '[VOICE] Recognition restart failed:',
          error
        );

        this.recognition =
          null;

      }


      this.isRestarting =
        false;

    }, 200);
  }


  /* ==========================================================
     HANDLE TRANSCRIPT
  ========================================================== */
  handleTranscriptEvent(transcript, isFinal) {
    if (!transcript) {
      return;
    }

    const text = transcript.trim();

    if (!text) {
      return;
    }

    this.log(
      LogCategory.TRANSCRIPTION,
      `Heard: "${text}" | State: ${this.state} | Lecture: ${this.isLecturePlaying}`
    );

    /*
     * ==========================================================
     * COURSE PLAYING / SLEEPING
     *
     * Siri-style interruption mode.
     *
     * While course is teaching:
     * - microphone remains ON
     * - SpeechRecognition remains ON
     * - normal speech is ignored
     * - only multilingual ARIA wake words are accepted
     * ==========================================================
     */

    if (
      this.isLecturePlaying &&
      this.state === TutorState.SLEEPING
    ) {
      if (containsWakeWord(text, this.wakeWord, this.aiName)) {
        if (this.isEchoOfRecentAria(text)) {
          this.log(
            LogCategory.ECHO_REJECT,
            `Suppressed wake from lecture echo: "${text}"`
          );
          return;
        }

        this.log(
          LogCategory.WAKE_MATCH,
          `🔥 COURSE INTERRUPTION WAKE (${this.langCode}): "${text}"`
        );

        this.triggerWakeSequence(text);
      }

      return;
    }

    /*
     * Normal sleeping mode.
     *
     * Course is NOT playing.
     *
     * Still listen for wake word.
     */

    if (
      this.state === TutorState.SLEEPING
    ) {
      if (containsWakeWord(text, this.wakeWord, this.aiName)) {
        this.log(
          LogCategory.WAKE_MATCH,
          ` WAKE DETECTED (${this.langCode}): "${text}"`
        );

        this.triggerWakeSequence(text);
      }

      return;
    }


    /*
     * ==========================================================
     * ARIA GREETING / SPEAKING / PROCESSING
     * ==========================================================
     */

    if (
      this.isTutorSpeaking ||
      Date.now() < this.ttsMutedUntil ||
      this.state === TutorState.ARIA_GREETING ||
      this.state === TutorState.ARIA_SPEAKING ||
      this.state === TutorState.PROCESSING
    ) {
      // If we are in PROCESSING, but tutor is not actively speaking, and a wake word is heard, recover immediately!
      if (
        this.state === TutorState.PROCESSING &&
        !this.isTutorSpeaking &&
        Date.now() >= this.ttsMutedUntil &&
        containsWakeWord(text, this.wakeWord, this.aiName)
      ) {
        this.log(
          LogCategory.WAKE_MATCH,
          `Wake word heard during PROCESSING state recovery: "${text}". Re-waking ARIA!`
        );
        this.triggerWakeSequence(text);
        return;
      }

      this.log(
        LogCategory.ECHO_REJECTED,
        `Ignoring while ARIA is speaking/processing: "${text}"`
      );

      return;
    }

    /*
     * ==========================================================
     * SELF ECHO
     * ==========================================================
     */

    if (
      this.isTranscriptSelfEcho(text)
    ) {
      this.log(
        LogCategory.ECHO_REJECTED,
        `Self echo rejected: "${text}"`
      );

      return;
    }

    /*
     * ==========================================================
     * ACTIVE / FOLLOW-UP LISTENING
     * ==========================================================
     */

    if (
      this.state === TutorState.ACTIVE_LISTENING ||
      this.state === TutorState.FOLLOW_UP_LISTENING
    ) {
      if (!isFinal) {
        // Buffer latest interim text with a debounce timer so user speech is processed even if isFinal is delayed
        this._latestInterimText = text;
        if (this._interimDebounceTimer) {
          clearTimeout(this._interimDebounceTimer);
        }
        this._interimDebounceTimer = setTimeout(() => {
          if (
            (this.state === TutorState.ACTIVE_LISTENING || this.state === TutorState.FOLLOW_UP_LISTENING) &&
            this._latestInterimText &&
            this._latestInterimText.length >= 2
          ) {
            const pending = this._latestInterimText;
            this._latestInterimText = '';
            const combined = (this._accumulatedTranscript ? (this._accumulatedTranscript + ' ' + pending) : pending).trim();
            const cleanPending = extractQuestionFromWakeWord(combined, this.wakeWord, this.aiName) || combined;
            if (
              cleanPending &&
              cleanPending.length >= 2 &&
              !isDanglingFragment(cleanPending) &&
              !this.isTranscriptSelfEcho(cleanPending) &&
              !isNoiseOrHallucination(cleanPending)
            ) {
              this.log(LogCategory.TRANSCRIPTION, `Interim speech finalized via debounce: "${cleanPending}"`);
              this.processUserQuestion(cleanPending);
            }
          }
        }, 2500);
        return;
      }

      if (this._interimDebounceTimer) {
        clearTimeout(this._interimDebounceTimer);
        this._interimDebounceTimer = null;
      }
      this._latestInterimText = '';

      // Accumulate text across isFinal events to avoid chopping multi-part sentences
      if (this._accumulatedTranscript) {
        if (!text.toLowerCase().startsWith(this._accumulatedTranscript.toLowerCase())) {
          this._accumulatedTranscript = (this._accumulatedTranscript + ' ' + text).trim();
        } else {
          this._accumulatedTranscript = text.trim();
        }
      } else {
        this._accumulatedTranscript = text.trim();
      }

      const accumulated = this._accumulatedTranscript;
      const clean = extractQuestionFromWakeWord(accumulated, this.wakeWord, this.aiName);
      const question = clean || accumulated;

      if (!question || question.length < 2) {
        return;
      }

      if (isNoiseOrHallucination(question) || this.isTranscriptSelfEcho(question)) {
        return;
      }

      if (isDanglingFragment(question)) {
        this.log(
          LogCategory.TRANSCRIPTION,
          `Speech segment is incomplete fragment: "${question}". Waiting for continuation...`
        );
        if (this._finalDebounceTimer) {
          clearTimeout(this._finalDebounceTimer);
        }
        this._finalDebounceTimer = setTimeout(() => {
          const finalCandidate = extractQuestionFromWakeWord(this._accumulatedTranscript, this.wakeWord, this.aiName) || this._accumulatedTranscript;
          if (
            finalCandidate &&
            !isDanglingFragment(finalCandidate) &&
            !this.isTranscriptSelfEcho(finalCandidate) &&
            !isNoiseOrHallucination(finalCandidate)
          ) {
            this.processUserQuestion(finalCandidate);
          }
        }, 3000);
        return;
      }

      // If sentence appears complete, debounce slightly (1200ms) to allow multi-clause continuation
      if (this._finalDebounceTimer) {
        clearTimeout(this._finalDebounceTimer);
      }
      this._finalDebounceTimer = setTimeout(() => {
        const finalQuestion = extractQuestionFromWakeWord(this._accumulatedTranscript, this.wakeWord, this.aiName) || this._accumulatedTranscript;
        if (
          !finalQuestion ||
          finalQuestion.length < 2 ||
          isNoiseOrHallucination(finalQuestion) ||
          this.isTranscriptSelfEcho(finalQuestion) ||
          isDanglingFragment(finalQuestion)
        ) {
          return;
        }
        this.log(
          LogCategory.TRANSCRIPTION,
          `User question finalized: "${finalQuestion}"`
        );
        this.processUserQuestion(finalQuestion);
      }, 1200);
    }
  }


  /* ==========================================================
     SELF ECHO
  ========================================================== */

  isTranscriptSelfEcho(
    transcript
  ) {

    if (!transcript) {
      return false;
    }


    const normalized =
      normalizeTranscript(
        transcript
      );


    if (
      !normalized ||
      normalized.length < 2
    ) {

      return true;
    }


    /*
     * Known ARIA phrases.
     */

    if (
      KNOWN_SELF_ECHO_PATTERNS.some(
        (pattern) =>
          pattern.test(
            normalized
          )
      )
    ) {

      return true;
    }


    /*
     * Generic short acknowledgements.
     */

    if (

      normalized === 'yes' ||

      normalized === 'yeah' ||

      normalized === 'ok' ||

      normalized === 'okay' ||

      normalized === 'listening' ||

      normalized === 'im listening' ||

      normalized === 'i am listening' ||

      normalized === 'tell me' ||

      normalized === 'yes tell me'

    ) {

      return true;
    }


    /*
     * Compare with recent ARIA speech.
     */

    for (
      const phrase of
      this.recentAriaUtterances
    ) {

      const normalizedPhrase =
        normalizeTranscript(
          phrase
        );


      if (
        !normalizedPhrase
      ) {

        continue;
      }


      if (

        normalizedPhrase.includes(
          normalized
        ) ||

        normalized.includes(
          normalizedPhrase
        )

      ) {

        return true;
      }


      const phraseWords =
        normalizedPhrase
          .split(/\s+/)
          .filter(
            (word) =>
              word.length > 2
          );


      const transcriptWords =
        normalized
          .split(/\s+/)
          .filter(
            (word) =>
              word.length > 2
          );


      if (
        transcriptWords.length > 0 &&
        transcriptWords.every(
          (word) =>
            phraseWords.includes(
              word
            )
        )
      ) {

        return true;
      }
    }


    return false;
  }


  /* ==========================================================
     WAKE SEQUENCE
  ========================================================== */

  triggerWakeSequence(wakeTranscript) {
    const now = Date.now();
    if (this._lastWakeTriggerTime && (now - this._lastWakeTriggerTime) < 1500) {
      return;
    }
    this._lastWakeTriggerTime = now;
    /*
     * Prevent duplicate wake triggers.
     */
    if (
      this.state === TutorState.WAKE_DETECTED ||
      this.state === TutorState.ARIA_GREETING ||
      this.state === TutorState.ACTIVE_LISTENING ||
      this.state === TutorState.PROCESSING ||
      this.state === TutorState.ARIA_SPEAKING
    ) {
      return;
    }

    this.log(
      LogCategory.WAKE_MATCH,
      `Wake sequence started (${this.langCode}): "${wakeTranscript}"`
    );

    /*
     * ----------------------------------------------------------
     * IMPORTANT
     *
     * SLEEPING + lecture playing is VALID.
     *
     * This is the Siri-style interruption mode.
     *
     * We must NOT return here.
     * ----------------------------------------------------------
     */

    const wasLecturePlaying = this.isLecturePlaying;

    /*
     * Tell React/CoursePlayer immediately.
     *
     * CoursePlayer will:
     * - save exact position
     * - cancel course TTS
     * - pause playing
     * - show ARIA greeting
     */
    this.setState(
      TutorState.WAKE_DETECTED
    );

    /*
     * Stop any stale question recording.
     */
    this.stopMediaRecording();
    this.clearBuffers();

    this.clearFollowUpTimeout();

    /*
     * Notify CoursePlayer.
     */
    if (this.options.onWakeWordDetected) {
      try {
        this.options.onWakeWordDetected(
          wakeTranscript,
          {
            lectureInterrupted: wasLecturePlaying,
            language: this.langCode
          }
        );
      } catch (error) {
        console.error(
          '[VOICE] Wake callback failed:',
          error
        );

        this.setState(
          TutorState.ACTIVE_LISTENING
        );
      }
    }
  }


  /* ==========================================================
     USER QUESTION
  ========================================================== */

  processUserQuestion(
    questionText
  ) {

    if (!questionText) {
      return;
    }


    const normalized =
      normalizeTranscript(
        questionText
      );


    const now =
      Date.now();


    /*
     * Echo/noise protection.
     */

    if (
      this.isTranscriptSelfEcho(
        questionText
      ) ||
      isNoiseOrHallucination(
        questionText
      )
    ) {

      this.log(
        LogCategory.ECHO_REJECTED,
        `Question rejected: "${questionText}"`
      );


      return;
    }


    /*
     * Duplicate protection.
     */

    if (

      this.lastProcessedText ===
      normalized &&

      now -
      this.lastProcessedTime <
      2500

    ) {

      return;
    }


    this.lastProcessedText =
      normalized;


    this.lastProcessedTime =
      now;


    this.clearFollowUpTimeout();

    if (this._finalDebounceTimer) {
      clearTimeout(this._finalDebounceTimer);
      this._finalDebounceTimer = null;
    }
    if (this._interimDebounceTimer) {
      clearTimeout(this._interimDebounceTimer);
      this._interimDebounceTimer = null;
    }
    this._accumulatedTranscript = '';
    this._latestInterimText = '';

    // Browser ASR got the question — stop Whisper recording so empty
    // whisper results cannot force us back to sleep.
    if (this.isRecording) {
      try {
        this.stopMediaRecording({ skipCapture: true });
      } catch (e) { }
    }

    this.setState(
      TutorState.PROCESSING
    );


    if (
      this.options.onQuestionReady
    ) {

      try {

        this.options.onQuestionReady(
          questionText
        );

      } catch (error) {

        console.error(
          '[VOICE] Question callback failed:',
          error
        );


        this.setState(
          TutorState.FOLLOW_UP_LISTENING
        );


        this.resetFollowUpTimeout();
      }
    }
  }


  /* ==========================================================
     ARIA SPEAKING
  ========================================================== */

  setTutorSpeaking(
    speaking,
    spokenText = ''
  ) {

    this.isTutorSpeaking =
      Boolean(speaking);


    if (speaking) {
      // Mark a real tutor speech session so TTS_END can open follow-up safely
      this._tutorSpeechSessionActive = true;

      if (
        this.cooldownTimeoutId
      ) {

        clearTimeout(
          this.cooldownTimeoutId
        );

        this.cooldownTimeoutId =
          null;
      }


      this.clearFollowUpTimeout();

      this.clearBuffers();

      if (
        this.state !== TutorState.ARIA_GREETING &&
        this.state !== TutorState.ARIA_SPEAKING
      ) {
        this.setState(TutorState.ARIA_SPEAKING);
      }

      /*
       * STOP wake recognition while ARIA is answering.
       * Course lecture should use setLecturePlaying() instead.
       */

      if (
        this.recognition
      ) {

        try {

          this.recognition.onend =
            null;

          this.recognition.abort();

        } catch (e) { }
      }


      if (
        spokenText
      ) {

        this.recentAriaUtterances.push(
          spokenText
        );


        if (
          this.recentAriaUtterances.length >
          10
        ) {

          this.recentAriaUtterances.shift();

        }
      }


      this.ttsMutedUntil =
        Date.now() +
        60000;


      this.log(
        LogCategory.TTS_START,
        'ARIA speaking: microphone gated'
      );


    } else {

      this.log(
        LogCategory.TTS_END,
        'ARIA speaking ended'
      );

      const hadSpeechSession = Boolean(this._tutorSpeechSessionActive);
      this._tutorSpeechSessionActive = false;

      this.ttsMutedUntil =
        Date.now() +
        1800;


      this.clearBuffers();


      if (
        this.cooldownTimeoutId
      ) {

        clearTimeout(
          this.cooldownTimeoutId
        );
      }

      // Stray TTS_END without a matching speak() must NOT open follow-up
      // (that was the SLEEPING -> FOLLOW_UP ambient-noise bug).
      if (!hadSpeechSession) {
        return;
      }


      this.cooldownTimeoutId =
        setTimeout(() => {

          this.clearBuffers();

          if (
            this.state === TutorState.SLEEPING ||
            this.state === TutorState.RETURN_TO_SLEEP ||
            this.state === TutorState.ERROR
          ) {
            return;
          }

          // Clear post-TTS mute so the first question is not discarded
          this.ttsMutedUntil = 0;

          if (this.state === TutorState.ARIA_GREETING) {
            this.setState(TutorState.ACTIVE_LISTENING);
          } else {
            this.setState(TutorState.FOLLOW_UP_LISTENING);
          }
          this.resetFollowUpTimeout();

          if (
            this.isMounted &&
            !this.isTutorSpeaking
          ) {
            this.restartSpeechRecognition(true);
          }

        }, 600);
    }
  }


  /* ==========================================================
     FOLLOW-UP TIMER
  ========================================================== */

  resetFollowUpTimeout() {

    this.clearFollowUpTimeout();


    this.followUpTimeoutId =
      setTimeout(() => {

        if (

          this.state ===
          TutorState.FOLLOW_UP_LISTENING &&

          !this.isTutorSpeaking

        ) {

          this.log(
            LogCategory.RETURN_TO_SLEEP,
            'Follow-up timeout'
          );


          this.setState(
            TutorState.RETURN_TO_SLEEP
          );


          setTimeout(() => {

            if (
              this.state ===
              TutorState.RETURN_TO_SLEEP
            ) {

              this.setState(
                TutorState.SLEEPING
              );


              /*
               * CoursePlayer receives this callback
               * and resumes the saved course position.
               */

              if (
                this.options.onReturnToSleep
              ) {

                try {

                  this.options.onReturnToSleep();

                } catch (error) {

                  console.error(
                    '[VOICE] onReturnToSleep failed:',
                    error
                  );

                }
              }
            }

          }, 300);
        }

      }, this.options.followUpTimeoutMs);
  }


  clearFollowUpTimeout() {

    if (
      this.followUpTimeoutId
    ) {

      clearTimeout(
        this.followUpTimeoutId
      );


      this.followUpTimeoutId =
        null;
    }
  }


  /* ==========================================================
     CLEAR AUDIO
  ========================================================== */

  clearBuffers() {

    this.audioChunks =
      [];

    this.speechFramesCount =
      0;

    this.lastSpeechTime =
      0;

    this._accumulatedTranscript = '';
    this._latestInterimText = '';
    if (this._interimDebounceTimer) {
      clearTimeout(this._interimDebounceTimer);
      this._interimDebounceTimer = null;
    }
    if (this._finalDebounceTimer) {
      clearTimeout(this._finalDebounceTimer);
      this._finalDebounceTimer = null;
    }
  }


  /* ==========================================================
     RETURN TO SLEEP
  ========================================================== */

  returnToSleep() {

    this.clearFollowUpTimeout();

    this.clearBuffers();


    this.setState(
      TutorState.RETURN_TO_SLEEP
    );


    setTimeout(() => {

      if (
        this.state ===
        TutorState.RETURN_TO_SLEEP
      ) {

        this.setState(
          TutorState.SLEEPING
        );


        if (
          this.options.onReturnToSleep
        ) {

          try {

            this.options.onReturnToSleep();

          } catch (error) {

            console.error(
              '[VOICE] Return-to-sleep callback failed:',
              error
            );

          }
        }
      }

    }, 200);
  }


  /* ==========================================================
     DESTROY
  ========================================================== */

  destroy() {

    this.log(
      LogCategory.VOICE_STATE,
      'Destroying VoiceTutorManager'
    );


    this.isMounted =
      false;


    this.stateListeners.clear();


    this.clearFollowUpTimeout();


    if (
      this.restartTimer
    ) {

      clearTimeout(
        this.restartTimer
      );

      this.restartTimer =
        null;
    }


    if (
      this.cooldownTimeoutId
    ) {

      clearTimeout(
        this.cooldownTimeoutId
      );

      this.cooldownTimeoutId =
        null;
    }


    if (
      this.vadInterval
    ) {

      clearInterval(
        this.vadInterval
      );

      this.vadInterval =
        null;
    }


    /*
     * Destroy SpeechRecognition.
     */

    if (
      this.recognition
    ) {

      try {

        this.recognition.onend =
          null;

        this.recognition.onerror =
          null;

        this.recognition.onresult =
          null;

        this.recognition.abort();

      } catch (e) { }


      try {

        this.recognition.stop();

      } catch (e) { }


      this.recognition =
        null;
    }


    /*
     * Destroy MediaRecorder.
     */

    if (
      this.mediaRecorder &&
      this.mediaRecorder.state !==
      'inactive'
    ) {

      try {

        this.mediaRecorder.stop();

      } catch (e) { }
    }


    this.mediaRecorder =
      null;


    /*
     * Destroy AudioContext.
     */

    if (
      this.audioContext
    ) {

      try {

        this.audioContext.close();

      } catch (e) { }


      this.audioContext =
        null;
    }


    /*
     * Stop microphone tracks.
     */

    if (
      this.micStream
    ) {

      try {

        this.micStream
          .getTracks()
          .forEach(
            (track) =>
              track.stop()
          );

      } catch (e) { }


      this.micStream =
        null;
    }


    this.setState(
      TutorState.SLEEPING
    );
  }
}


export default VoiceTutorManager;