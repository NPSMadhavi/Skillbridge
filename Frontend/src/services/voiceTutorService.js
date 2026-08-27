/**
 * SkillBridge Voice Tutor Interaction Manager
 * Strict 8-State Voice State Machine with Hardware/Software Echo Prevention,
 * Robust Wake-Word Detection, Web Audio VAD, and Multilingual Support.
 *
 * Supported Teaching Languages:
 * - English
 * - Chinese (中文)
 * - Malay (Bahasa Melayu)
 * - Tamil (தமிழ்)
 * - Bangla (বাংলা)
 *
 * Wake examples:
 * - Hey Aria
 * - Aria
 * - Hey Arya
 * - Native-language ASR variants of Aria
 *
 * States:
 * 1. SLEEPING           - Passive mic monitoring, evaluating SOLELY for wake-word
 * 2. WAKE_DETECTED      - Wake-word confirmed, buffers purged, wake detection paused
 * 3. ARIA_GREETING      - ARIA speaks short acknowledgement
 * 4. ACTIVE_LISTENING   - VAD active, capturing user's question
 * 5. PROCESSING         - User speech finished, Whisper + RAG + LLM execution lock
 * 6. ARIA_SPEAKING      - TTS playback with complete mic/ASR suppression
 * 7. FOLLOW_UP_LISTENING - Post-speech window allowing natural follow-up
 * 8. RETURN_TO_SLEEP    - Timeout / user dismiss, returning to SLEEPING
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

// Configurable diagnostic logging categories
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

/**
 * Supported teaching-language -> browser SpeechRecognition language.
 */
export const VOICE_LANGUAGE_CODES = {
  English: 'en-US',
  Chinese: 'zh-CN',
  Malay: 'ms-MY',
  Tamil: 'ta-IN',
  Bangla: 'bn-BD',

  // Also support common values that may be passed directly
  'English (US)': 'en-US',
  'English (UK)': 'en-GB',
  'Chinese (中文)': 'zh-CN',
  'Malay (Bahasa Melayu)': 'ms-MY',
  'Tamil (தமிழ்)': 'ta-IN',
  'Bangla (বাংলা)': 'bn-BD'
};

/**
 * Convert a UI teaching-language value to SpeechRecognition language code.
 *
 * Examples:
 * getSpeechLanguageCode('Tamil (தமிழ்)') -> 'ta-IN'
 * getSpeechLanguageCode('Bangla (বাংলা)') -> 'bn-BD'
 * getSpeechLanguageCode('en-US') -> 'en-US'
 */
export const getSpeechLanguageCode = (language) => {
  if (!language) return 'en-US';

  if (VOICE_LANGUAGE_CODES[language]) {
    return VOICE_LANGUAGE_CODES[language];
  }

  const normalized = String(language).trim().toLowerCase();

  if (
    normalized === 'english' ||
    normalized.startsWith('english ')
  ) {
    return 'en-US';
  }

  if (
    normalized === 'chinese' ||
    normalized.includes('中文')
  ) {
    return 'zh-CN';
  }

  if (
    normalized === 'malay' ||
    normalized.includes('bahasa melayu')
  ) {
    return 'ms-MY';
  }

  if (
    normalized === 'tamil' ||
    normalized.includes('தமிழ்')
  ) {
    return 'ta-IN';
  }

  if (
    normalized === 'bangla' ||
    normalized === 'bengali' ||
    normalized.includes('বাংলা')
  ) {
    return 'bn-BD';
  }

  // If caller already provides a BCP-47 code
  if (/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(String(language))) {
    return String(language);
  }

  return 'en-US';
};

/**
 * Multilingual wake-word patterns.
 *
 * IMPORTANT:
 * We are intentionally looking for ARIA/name variants only.
 * We do not wake for arbitrary user speech.
 */
const WAKE_WORD_PATTERNS = [

  // ============================================================
  // ENGLISH
  // ============================================================

  /\b(?:hey|hi|hello|ok|okay|ask|hay|heya|yo|dear|here|hear|hallo)?\s*(?:aria|arya|area|aarya|ariya|auria|oria|arria)\b/i,

  /\b(?:here\s+ya|hear\s+ya|hey\s+ya|heya|hiya|hi\s+ya|hariya|harya|haria)\b/i,

  /\b(?:aria|arya|area|aarya|ariya|auria|oria|arria)\b/i,


  // ============================================================
  // CHINESE
  // ============================================================

  /(?:嘿|嗨|你好|喂|请问|问一下)?\s*(?:阿莉娅|阿丽娅|阿里亚|艾莉亚|艾丽娅)/iu,

  /(?:嘿|嗨|你好)?\s*(?:aria|arya|ariya)/iu,


  // ============================================================
  // MALAY
  // ============================================================

  /\b(?:hai|helo|hello|hey|haya|hei|tolong|boleh)?\s*(?:aria|arya|area|aarya|ariya|auria|oria|arria)\b/i,

  /\b(?:hai|helo|hello|hey)\s+(?:aria|arya|area|ariya)\b/i,


  // ============================================================
  // TAMIL
  // ============================================================

  /(?:ஹே|ஹாய்|ஹலோ|வணக்கம்|ஏய்)?\s*(?:ஆரியா|ஆர்யா|அரியா|ஏரியா)/iu,

  /(?:ஹே|ஹாய்|ஹலோ)?\s*(?:aria|arya|ariya)/iu,


  // ============================================================
  // BANGLA
  // ============================================================

  /(?:হে|হেই|হাই|হ্যালো|নমস্কার|ওহে)?\s*(?:আরিয়া|আরিয়া|আর্য|এরিয়া|এরিয়া)/iu,

  /(?:হে|হাই|হ্যালো)?\s*(?:aria|arya|ariya)/iu,


  // ============================================================
  // GENERIC NATIVE-SCRIPT ARIA VARIANTS
  // ============================================================

  /(?:एरिया|आरिया|आर्या|ఆరియా|ఆర్య|ஏரியா|ஆரியா|ஆர்யா|அரியா|আরিয়া|আরিয়া|এরিয়া|এরিয়া|阿丽娅|阿莉娅|阿里亚|艾莉亚|艾丽娅)/iu
];


/**
 * ARIA's own acknowledgment and greeting phrases.
 *
 * These must NEVER be processed as user questions.
 */
export const KNOWN_SELF_ECHO_PATTERNS = [

  // English
  /\b(?:yes|yeah|ya)?\s*(?:tell\s+me|im\s+listening|i\s+am\s+listening|listening|please\s+tell\s+me)\b/i,

  /\b(?:yes\s*\??\s*tell\s+me|i'm\s+listening|im\s+listening|i\s+am\s+listening|yes\s+tell\s+me\s+i'm\s+listening)\b/i,

  /\b(?:yes\s*\??\s*tell\s+me|yes\s+tell\s+me|tell\s+me\s+i'm\s+listening)\b/i,

  /\b(?:hello\s+i\s+am\s+aria|i\s+am\s+aria|your\s+personal\s+ai\s+tutor)\b/i,


  // Chinese
  /(?:我在听|请问有什么可以帮您|我在听请问|请问有什么)/i,


  // Malay
  /\b(?:ya\s*\??\s*saya\s+mendengar|sila\s+beritahu\s+saya|saya\s+mendengar|sila\s+beritahu)\b/i,


  // Tamil
  /(?:சொல்லுங்கள்|நான்\s*கேட்கிறேன்|சொல்லுங்கள்\s*நான்\s*கேட்கிறேன்)/i,


  // Bangla
  /(?:হ্যাঁ\s*বলুন|আমি\s*শুনছি|বলুন\s*আমি\s*শুনছি|আমি\s*শুনছি)/i
];


/**
 * All known ASR spellings / native-script spellings of ARIA.
 */
const ARIA_VARIANTS_SET = new Set([

  // English / Malay
  'aria',
  'arya',
  'area',
  'aarya',
  'ariya',
  'auria',
  'oria',
  'arria',
  'heya',
  'hiya',
  'harya',
  'haria',

  // Chinese
  '阿莉娅',
  '阿丽娅',
  '阿里亚',
  '艾莉亚',
  '艾丽娅',

  // Tamil
  'ஆரியா',
  'ஆர்யா',
  'அரியா',
  'ஏரியா',

  // Bangla
  'আরিয়া',
  'আরিয়া',
  'আর্য',
  'এরিয়া',
  'এরিয়া'
]);


/**
 * Normalize ASR transcript without destroying Unicode characters.
 */
export const normalizeTranscript = (text) => {
  if (!text) return '';

  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"“”‘’[\]\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};


/**
 * Check whether transcript contains an ARIA wake word.
 */
export const containsWakeWord = (text) => {
  if (!text) return false;

  const normalized = normalizeTranscript(text);

  if (!normalized) return false;


  // Never wake from ARIA's own greeting.
  if (
    KNOWN_SELF_ECHO_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  ) {
    return false;
  }


  // First check complete multilingual patterns.
  if (
    WAKE_WORD_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  ) {
    return true;
  }


  // Then check individual tokens.
  const tokens = normalized.split(/\s+/);

  return tokens.some((token) =>
    ARIA_VARIANTS_SET.has(token)
  );
};


/**
 * Remove wake phrase from a transcript before sending the question.
 */
export const extractQuestionFromWakeWord = (text) => {
  if (!text) return '';

  let clean = text.trim();


  // Remove wake phrase from beginning.
  clean = clean.replace(
    /^(?:hey|hi|hello|ok|okay|ask|hay|heya|yo|dear|here|hear|excuse\s+me|你好|嗨|hai|helo|halo|வணக்கம்|ஹாய்|ஹே|হ্যালো|হাই)?\s*(?:aria|area|arya|aarya|ariya|auria|oria|arria|ya|ia|ஆரியா|ஆர்யா|அரியா|ஏரியா|আরিয়া|আরিয়া|এরিয়া|এরিয়া|阿莉娅|阿丽娅|阿里亚)[\s,.:!?-]*/iu,
    ''
  ).trim();


  // Remove wake name from end.
  clean = clean.replace(
    /[\s,.:!?-]*(?:aria|area|arya|aarya|ariya|auria|oria|arria|ya|ஆரியா|ஆர்யா|அரியா|ஏரியா|আরিয়া|আরিয়া|এরিয়া|এরিয়া|阿莉娅|阿丽娅|阿里亚)$/iu,
    ''
  ).trim();


  return clean;
};


/**
 * Detect noise / hallucinated ASR.
 */
export const isNoiseOrHallucination = (text) => {
  if (!text) return true;

  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"“”‘’]/g, '')
    .trim();

  if (t.length < 2) return true;


  const noisePhrases = [
    'blank_audio',
    'silence',
    'music',
    'i am sorry',
    'im sorry',
    'sorry',
    'thank you',
    'thank you for watching',
    'thanks for watching',
    'thanks',
    'see you in the next video',
    'see you in the next one',
    'see you next time',
    'see you later',
    'i will see you in the next',
    'i will see you',
    'subtitles by',
    'subscribe to',
    'subscribe',
    'like and subscribe',
    'translated by',
    'you',
    'so',
    'bye',
    'goodbye',
    'okay bye',
    'yes',
    'yeah',
    'ok',
    'okay',
    'tell me',
    'listening',
    'im listening',
    'i am listening'
  ];


  return noisePhrases.some(
    (p) => t === p || (t.length < 20 && t.includes(p))
  );
};


export class VoiceTutorManager {

  constructor(options = {}) {

    this.options = {
      debug: true,

      followUpTimeoutMs: 7000,

      speechRmsThreshold: 14,

      silenceRmsThreshold: 8,

      silenceDurationMs: 1200,

      maxRecordingMs: 15000,

      ...options
    };


    this.state = TutorState.SLEEPING;

    this.stateListeners = new Set();


    // Audio & Pipeline handles
    this.micStream = null;

    this.audioContext = null;

    this.analyser = null;

    this.mediaRecorder = null;

    this.audioChunks = [];

    this.vadInterval = null;

    this.recognition = null;


    // Gating & Lifecycle flags
    this.isMounted = false;

    this.isTutorSpeaking = false;

    this.ttsMutedUntil = 0;

    this.recentAriaUtterances = [];

    this.followUpTimeoutId = null;

    this.cooldownTimeoutId = null;


    // VAD state variables
    this.speechFramesCount = 0;

    this.lastSpeechTime = 0;

    this.recordingStartTime = 0;

    this.isRecording = false;


    // Deduplication tracking
    this.lastProcessedText = '';

    this.lastProcessedTime = 0;

    this.isRestarting = false;


    // Current speech language
    this.langCode = 'en-US';
  }


  log(category, message, data = null) {

    if (!this.options.debug) return;

    const prefix = `[VOICE:${category}]`;

    if (data !== null && data !== undefined) {

      console.log(`${prefix} ${message}`, data);

    } else {

      console.log(`${prefix} ${message}`);

    }
  }


  onStateChange(listener) {

    this.stateListeners.add(listener);

    return () => this.stateListeners.delete(listener);
  }


  setState(newState) {

    if (this.state === newState) return;

    const oldState = this.state;

    this.state = newState;

    this.log(
      LogCategory.VOICE_STATE,
      `${oldState} -> ${newState}`
    );


    this.stateListeners.forEach((listener) => {

      try {

        listener(newState);

      } catch (e) {

        console.error(
          '[VOICE] Error in state listener:',
          e
        );

      }

    });
  }


  /**
   * Set lecture playback state.
   */
  setLecturePlaying(isPlaying) {

    this.isLecturePlaying = isPlaying;

    if (isPlaying && this.isRecording) {

      this.stopMediaRecording();

      this.clearBuffers();

    }
  }


  /**
   * Manually set awake state.
   */
  setAwake(awake) {

    if (awake) {

      if (this.state === TutorState.SLEEPING) {

        this.setState(
          TutorState.ACTIVE_LISTENING
        );

      }

      this.resetFollowUpTimeout();

    } else if (!this.isTutorSpeaking) {

      this.returnToSleep();

    }
  }


  /**
   * Set conversation mode.
   */
  setConversationMode(inConv) {

    this.inConversationMode = inConv;

    if (inConv) {

      if (this.state === TutorState.SLEEPING) {

        this.setState(
          TutorState.ACTIVE_LISTENING
        );

      }

      this.resetFollowUpTimeout();

    } else if (!this.isTutorSpeaking) {

      this.returnToSleep();

    }
  }


  /**
   * Start voice manager.
   *
   * Important:
   * If the language changes while the manager is already mounted,
   * SpeechRecognition is recreated using the new language.
   */
  async start(langCode = 'en-US') {

    this.langCode = getSpeechLanguageCode(langCode);


    // Already mounted:
    // update only SpeechRecognition language.
    if (this.isMounted) {

      this.log(
        LogCategory.WAKE_DETECTION,
        `Updating SpeechRecognition language to ${this.langCode}`
      );


      if (this.recognition) {

        try {

          this.recognition.onend = null;

          this.recognition.onresult = null;

          this.recognition.onerror = null;

          this.recognition.abort();

        } catch (e) { }

        this.recognition = null;
      }


      this.isRestarting = false;


      if (
        !this.isTutorSpeaking &&
        Date.now() >= this.ttsMutedUntil
      ) {

        this.initSpeechRecognition();

      }


      return;
    }


    this.isMounted = true;


    this.log(
      LogCategory.VOICE_STATE,
      `Initializing Voice Tutor Manager (Lang: ${this.langCode})...`
    );


    try {

      await this.initMicrophonePipeline();

      this.initSpeechRecognition();

      this.setState(TutorState.SLEEPING);

    } catch (err) {

      console.error(
        '[VOICE] Initialization error:',
        err
      );

      this.setState(TutorState.ERROR);

    }
  }


  /**
   * Change language without recreating microphone/VAD.
   */
  setLanguage(language) {

    const newLangCode =
      getSpeechLanguageCode(language);


    if (newLangCode === this.langCode) {

      return;

    }


    this.log(
      LogCategory.WAKE_DETECTION,
      `Changing voice language: ${this.langCode} -> ${newLangCode}`
    );


    this.langCode = newLangCode;


    if (this.recognition) {

      try {

        this.recognition.onend = null;

        this.recognition.onresult = null;

        this.recognition.onerror = null;

        this.recognition.abort();

      } catch (e) { }

      this.recognition = null;

    }


    this.isRestarting = false;


    if (
      this.isMounted &&
      !this.isTutorSpeaking &&
      Date.now() >= this.ttsMutedUntil
    ) {

      this.initSpeechRecognition();

    }
  }


  /**
   * Initializes microphone stream with hardware echo cancellation.
   */
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
          .forEach((t) => t.stop());

        return;

      }


      this.micStream = stream;


      this.log(
        LogCategory.VOICE_STATE,
        'Microphone stream initialized with Echo Cancellation + Noise Suppression.'
      );


      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;


      const audioCtx = new AudioCtx();


      if (audioCtx.state === 'suspended') {

        await audioCtx.resume();

      }


      const source =
        audioCtx.createMediaStreamSource(stream);


      const analyser =
        audioCtx.createAnalyser();


      analyser.fftSize = 512;

      analyser.smoothingTimeConstant = 0.3;


      source.connect(analyser);


      this.audioContext = audioCtx;

      this.analyser = analyser;


      const bufferLength =
        analyser.frequencyBinCount;


      const dataArray =
        new Uint8Array(bufferLength);


      // Continuous VAD loop (~40ms tick)
      if (this.vadInterval) {

        clearInterval(this.vadInterval);

      }


      this.vadInterval = setInterval(() => {

        if (
          !this.isMounted ||
          !this.analyser
        ) {

          return;

        }


        if (
          this.audioContext &&
          this.audioContext.state === 'suspended'
        ) {

          this.audioContext
            .resume()
            .catch(() => { });

        }


        // Strict echo suppression
        if (

          this.isTutorSpeaking ||

          Date.now() < this.ttsMutedUntil ||

          this.state === TutorState.ARIA_GREETING ||

          this.state === TutorState.ARIA_SPEAKING ||

          this.state === TutorState.PROCESSING

        ) {

          this.speechFramesCount = 0;

          return;

        }


        this.analyser.getByteFrequencyData(
          dataArray
        );


        let sumSquares = 0;


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
            sumSquares / bufferLength
          );


        const now = Date.now();


        // Active recording:
        // evaluate silence completion.
        if (this.isRecording) {

          if (
            rms >=
            this.options.silenceRmsThreshold
          ) {

            this.lastSpeechTime = now;

          }


          const silenceDuration =
            now - this.lastSpeechTime;


          const totalDuration =
            now - this.recordingStartTime;


          if (

            (
              silenceDuration >=
              this.options.silenceDurationMs &&
              totalDuration >= 800
            ) ||

            totalDuration >=
            this.options.maxRecordingMs

          ) {

            this.log(
              LogCategory.VAD_END,
              `Speech ended (Silence: ${silenceDuration}ms, Duration: ${totalDuration}ms)`
            );


            this.stopMediaRecording();

          }


          return;

        }


        // Active listening / follow-up listening
        if (

          this.state === TutorState.ACTIVE_LISTENING ||

          this.state === TutorState.FOLLOW_UP_LISTENING

        ) {

          if (
            rms >=
            this.options.speechRmsThreshold
          ) {

            this.speechFramesCount += 1;


            if (
              this.speechFramesCount >= 2
            ) {

              this.speechFramesCount = 0;


              this.log(
                LogCategory.VAD_START,
                `User speech detected (RMS: ${rms.toFixed(1)})`
              );


              this.clearFollowUpTimeout();


              this.startMediaRecording();

            }

          } else {

            this.speechFramesCount = 0;

          }

        }

      }, 40);


    } catch (err) {

      console.error(
        '[VOICE] Microphone permission error or device unavailable:',
        err
      );


      this.setState(
        TutorState.ERROR
      );


      throw err;

    }
  }


  /**
   * Start user speech recording.
   */
  startMediaRecording() {

    if (
      !this.micStream ||
      this.isRecording
    ) {

      return;

    }


    try {

      if (
        this.mediaRecorder &&
        this.mediaRecorder.state !== 'inactive'
      ) {

        try {

          this.mediaRecorder.stop();

        } catch (e) { }

      }


      this.audioChunks = [];


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


      const recorder = mimeType

        ? new MediaRecorder(
          this.micStream,
          { mimeType }
        )

        : new MediaRecorder(
          this.micStream
        );


      recorder.ondataavailable = (e) => {

        if (
          e.data &&
          e.data.size > 0
        ) {

          this.audioChunks.push(
            e.data
          );

        }

      };


      recorder.onstop = async () => {

        this.isRecording = false;


        // Strict TTS guard
        if (

          this.isTutorSpeaking ||

          Date.now() < this.ttsMutedUntil

        ) {

          this.log(
            LogCategory.ECHO_REJECTED,
            'Audio chunk discarded because TTS was active'
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


        this.audioChunks = [];


        const duration =
          Date.now() -
          this.recordingStartTime;


        this.log(
          LogCategory.AUDIO_DURATION,
          `Captured audio blob (${audioBlob.size}B, ${duration}ms)`
        );


        if (
          audioBlob.size < 2500 ||
          duration < 600
        ) {

          this.log(
            LogCategory.TRANSCRIPTION,
            'Audio slice too short / noise-only. Resetting to active listening.'
          );


          if (

            this.state === TutorState.ACTIVE_LISTENING ||

            this.state === TutorState.FOLLOW_UP_LISTENING

          ) {

            this.resetFollowUpTimeout();

          }


          return;

        }


        if (
          this.options.onAudioCaptured
        ) {

          this.setState(
            TutorState.PROCESSING
          );


          this.options.onAudioCaptured(
            audioBlob
          );

        }

      };


      recorder.start(250);


      this.mediaRecorder =
        recorder;


      this.isRecording = true;


      this.recordingStartTime =
        Date.now();


      this.lastSpeechTime =
        Date.now();


    } catch (err) {

      console.error(
        '[VOICE] Failed to start MediaRecorder:',
        err
      );


      this.isRecording = false;

    }

  }


  /**
   * Stop user speech recording.
   */
  stopMediaRecording() {

    this.isRecording = false;


    if (
      this.mediaRecorder &&
      this.mediaRecorder.state === 'recording'
    ) {

      try {

        this.mediaRecorder.stop();

      } catch (e) {

        console.warn(
          '[VOICE] Error stopping recorder:',
          e
        );

      }

    }

  }


  /**
   * Initializes lightweight browser SpeechRecognition
   * solely for fast wake-phrase recognition.
   *
   * The language follows the selected teaching language.
   */
  initSpeechRecognition() {

    const SpeechRec =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;


    if (!SpeechRec) {

      this.log(
        LogCategory.WAKE_DETECTION,
        'Browser SpeechRecognition API not supported. Relying on VAD + Whisper backend.'
      );


      return;

    }


    try {

      if (this.recognition) {

        try {

          this.recognition.abort();

        } catch (e) { }

      }


      const rec =
        new SpeechRec();


      rec.continuous = true;

      rec.interimResults = true;

      rec.maxAlternatives = 5;


      // IMPORTANT:
      // Uses current teaching language.
      rec.lang =
        this.langCode ||
        'en-US';


      rec.onstart = () => {

        this.log(
          LogCategory.WAKE_DETECTION,
          `SpeechRecognition wake detector active (${rec.lang})`
        );


        this.isRestarting = false;

      };


      rec.onresult = (event) => {

        if (!this.isMounted) {

          return;

        }


        const lastIdx =
          event.results.length - 1;


        const result =
          event.results[lastIdx];


        if (
          !result ||
          !result[0]
        ) {

          return;

        }


        const transcript =
          result[0]
            .transcript
            .trim();


        if (!transcript) {

          return;

        }


        const isFinal =
          result.isFinal;


        this.log(
          LogCategory.TRANSCRIPTION,
          `ASR (${rec.lang})${isFinal ? ' final' : ' interim'}: "${transcript}"`
        );


        this.handleTranscriptEvent(
          transcript,
          isFinal
        );

      };


      rec.onerror = (e) => {

        if (
          e.error !== 'no-speech' &&
          e.error !== 'aborted'
        ) {

          console.warn(
            '[VOICE] SpeechRecognition notice:',
            e.error
          );

        }

      };


      rec.onend = () => {

        if (

          this.isMounted &&

          !this.isRestarting &&

          !this.isTutorSpeaking &&

          Date.now() >=
          this.ttsMutedUntil

        ) {

          this.scheduleRestart();

        }

      };


      rec.start();


      this.recognition =
        rec;


    } catch (err) {

      console.warn(
        '[VOICE] SpeechRecognition init notice:',
        err
      );

    }

  }


  /**
   * Restart browser SpeechRecognition.
   */
  scheduleRestart() {

    if (!this.isMounted) {

      return;

    }


    if (this.isRestarting) {

      return;

    }


    this.isRestarting = true;


    setTimeout(() => {

      if (

        !this.isMounted ||

        this.isTutorSpeaking ||

        Date.now() <
        this.ttsMutedUntil

      ) {

        this.isRestarting = false;

        return;

      }


      try {

        if (this.recognition) {

          this.recognition.start();

        } else if (this.isMounted) {

          this.initSpeechRecognition();

        }

      } catch (err) {

        if (this.isMounted) {

          try {

            this.initSpeechRecognition();

          } catch (e) { }

        }

      }


      this.isRestarting = false;

    }, 150);

  }


  /**
   * Handle every browser SpeechRecognition transcript.
   */
  handleTranscriptEvent(
    transcript,
    isFinal
  ) {

    // ============================================================
    // 1. STRICT TTS / PROCESSING GATING
    // ============================================================

    if (

      this.isTutorSpeaking ||

      Date.now() <
      this.ttsMutedUntil ||

      this.state === TutorState.ARIA_GREETING ||

      this.state === TutorState.ARIA_SPEAKING ||

      this.state === TutorState.PROCESSING

    ) {

      this.log(
        LogCategory.ECHO_REJECTED,
        `Rejected transcript during speaking/cooldown/processing: "${transcript}"`
      );


      return;

    }


    // ============================================================
    // 2. SELF-ECHO REJECTION
    // ============================================================

    if (
      this.isTranscriptSelfEcho(
        transcript
      )
    ) {

      this.log(
        LogCategory.ECHO_REJECTED,
        `Rejected self-echo matching ARIA utterance: "${transcript}"`
      );


      return;

    }


    // ============================================================
    // 3. SLEEPING = WAKE WORD ONLY
    // ============================================================

    if (
      this.state === TutorState.SLEEPING
    ) {

      if (
        containsWakeWord(
          transcript
        )
      ) {

        this.log(
          LogCategory.WAKE_MATCH,
          `Wake phrase detected (${this.langCode}): "${transcript}"`
        );


        this.triggerWakeSequence(
          transcript
        );

      }


      // Never process normal speech while sleeping.
      return;

    }


    // ============================================================
    // 4. ACTIVE / FOLLOW-UP LISTENING
    // ============================================================

    if (

      this.state === TutorState.ACTIVE_LISTENING ||

      this.state === TutorState.FOLLOW_UP_LISTENING

    ) {

      if (isFinal) {

        const clean =
          extractQuestionFromWakeWord(
            transcript
          );


        const finalQuestion =
          clean ||
          transcript;


        if (

          finalQuestion &&

          finalQuestion.length >= 2 &&

          !isNoiseOrHallucination(
            finalQuestion
          ) &&

          !this.isTranscriptSelfEcho(
            finalQuestion
          )

        ) {

          this.log(
            LogCategory.TRANSCRIPTION,
            `User question captured: "${finalQuestion}"`
          );


          this.processUserQuestion(
            finalQuestion
          );

        }

      }

    }

  }


  /**
   * Compares transcript against recent ARIA utterances
   * and known greeting patterns.
   */
  isTranscriptSelfEcho(
    transcript
  ) {

    if (!transcript) {

      return false;

    }


    const cleanTrans =
      normalizeTranscript(
        transcript
      );


    if (
      !cleanTrans ||
      cleanTrans.length < 2
    ) {

      return true;

    }


    // Known acknowledgment patterns
    if (
      KNOWN_SELF_ECHO_PATTERNS.some(
        (p) =>
          p.test(transcript) ||
          p.test(cleanTrans)
      )
    ) {

      return true;

    }


    // Generic acknowledgment words
    if (

      cleanTrans === 'yes' ||

      cleanTrans === 'yeah' ||

      cleanTrans === 'listening' ||

      cleanTrans === 'im listening' ||

      cleanTrans === 'i am listening' ||

      cleanTrans === 'tell me' ||

      cleanTrans === 'yes tell me'

    ) {

      return true;

    }


    // Compare with recent ARIA utterances.
    for (
      const phrase of
      this.recentAriaUtterances
    ) {

      const cleanPhrase =
        normalizeTranscript(
          phrase
        );


      if (!cleanPhrase) {

        continue;

      }


      if (

        cleanPhrase.includes(
          cleanTrans
        ) ||

        cleanTrans.includes(
          cleanPhrase
        )

      ) {

        return true;

      }


      const phraseWords =
        cleanPhrase
          .split(' ')
          .filter(
            (w) => w.length > 2
          );


      const transWords =
        cleanTrans
          .split(' ')
          .filter(
            (w) => w.length > 2
          );


      if (

        transWords.length > 0 &&

        transWords.every(
          (w) =>
            phraseWords.includes(w)
        )

      ) {

        return true;

      }

    }


    return false;

  }


  /**
   * Trigger wake sequence:
   *
   * SLEEPING
   *    ->
   * WAKE_DETECTED
   */
  triggerWakeSequence(
    wakeTranscript
  ) {

    this.setState(
      TutorState.WAKE_DETECTED
    );


    this.clearBuffers();


    this.clearFollowUpTimeout();


    // Stop current recognition immediately.
    if (this.recognition) {

      try {

        this.recognition.abort();

      } catch (e) { }

    }


    if (
      this.options.onWakeWordDetected
    ) {

      this.options.onWakeWordDetected(
        wakeTranscript
      );

    }

  }


  /**
   * Process finalized user question.
   */
  processUserQuestion(
    questionText
  ) {

    const normalized =
      normalizeTranscript(
        questionText
      );


    const now =
      Date.now();


    // Guard against self echo.
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
        `Dropped question as self-echo/noise: "${questionText}"`
      );


      return;

    }


    // Deduplicate within 2.5 seconds.
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


    this.setState(
      TutorState.PROCESSING
    );


    if (
      this.options.onQuestionReady
    ) {

      this.options.onQuestionReady(
        questionText
      );

    }

  }


  /**
   * Set ARIA speaking state.
   */
  setTutorSpeaking(
    speaking,
    spokenText = ''
  ) {

    this.isTutorSpeaking =
      speaking;


    if (speaking) {

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


      // Pause browser recognition
      // while ARIA is speaking.
      if (this.recognition) {

        try {

          this.recognition.abort();

        } catch (e) { }

      }


      // Store TTS text for echo rejection.
      if (spokenText) {

        this.recentAriaUtterances.push(
          spokenText
        );


        if (
          this.recentAriaUtterances.length > 8
        ) {

          this.recentAriaUtterances.shift();

        }

      }


      // Mute until TTS finishes.
      this.ttsMutedUntil =
        Date.now() + 60000;


      this.log(
        LogCategory.TTS_START,
        'ARIA speaking started. Mic recognition aborted & 100% gated.'
      );

    } else {

      this.log(
        LogCategory.TTS_END,
        'ARIA speaking ended. Entering 1000ms acoustic cooldown.'
      );


      // 1000ms acoustic cooldown.
      this.ttsMutedUntil =
        Date.now() + 1000;


      this.clearBuffers();


      if (
        this.cooldownTimeoutId
      ) {

        clearTimeout(
          this.cooldownTimeoutId
        );

      }


      this.cooldownTimeoutId =
        setTimeout(() => {

          this.clearBuffers();


          const nextState =
            this.state ===
              TutorState.ARIA_GREETING

              ? TutorState.ACTIVE_LISTENING

              : TutorState.FOLLOW_UP_LISTENING;


          this.setState(
            nextState
          );


          this.resetFollowUpTimeout();


          // Fresh SpeechRecognition restart.
          if (

            this.isMounted &&

            !this.isTutorSpeaking

          ) {

            try {

              if (
                this.recognition
              ) {

                this.recognition.start();

              } else {

                this.initSpeechRecognition();

              }

            } catch (e) {

              try {

                this.initSpeechRecognition();

              } catch (err) { }

            }

          }

        }, 1000);

    }

  }


  /**
   * Follow-up conversational window.
   */
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
            'Follow-up listening timeout. Returning to SLEEPING.'
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


              if (
                this.options.onReturnToSleep
              ) {

                this.options.onReturnToSleep();

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


  /**
   * Clear audio buffers.
   */
  clearBuffers() {

    this.audioChunks = [];

    this.speechFramesCount = 0;

    this.lastSpeechTime = 0;

  }


  /**
   * Explicitly return to sleeping.
   */
  returnToSleep() {

    this.clearFollowUpTimeout();


    this.clearBuffers();


    this.setState(
      TutorState.RETURN_TO_SLEEP
    );


    setTimeout(() => {

      this.setState(
        TutorState.SLEEPING
      );

    }, 200);

  }


  /**
   * Destroy all voice resources.
   */
  destroy() {

    this.log(
      LogCategory.VOICE_STATE,
      'Releasing voice manager resources...'
    );


    this.isMounted = false;


    this.stateListeners.clear();


    this.clearFollowUpTimeout();


    if (
      this.cooldownTimeoutId
    ) {

      clearTimeout(
        this.cooldownTimeoutId
      );


      this.cooldownTimeoutId =
        null;

    }


    if (this.vadInterval) {

      clearInterval(
        this.vadInterval
      );


      this.vadInterval =
        null;

    }


    if (this.recognition) {

      try {

        this.recognition.onend =
          null;

        this.recognition.onresult =
          null;

        this.recognition.onerror =
          null;

        this.recognition.abort();

      } catch (e) { }


      try {

        this.recognition.stop();

      } catch (e) { }


      this.recognition =
        null;

    }


    if (
      this.mediaRecorder &&
      this.mediaRecorder.state !== 'inactive'
    ) {

      try {

        this.mediaRecorder.stop();

      } catch (e) { }


      this.mediaRecorder =
        null;

    }


    if (this.audioContext) {

      try {

        this.audioContext.close();

      } catch (e) { }


      this.audioContext =
        null;

    }


    if (this.micStream) {

      try {

        this.micStream
          .getTracks()
          .forEach(
            (t) => t.stop()
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