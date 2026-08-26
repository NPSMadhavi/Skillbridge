/**
 * SkillBridge Voice Tutor Interaction Manager
 * Strict 8-State Voice State Machine with Hardware/Software Echo Prevention,
 * Robust Wake-Word Detection, Web Audio VAD, and Multilingual Support.
 *
 * States:
 * 1. SLEEPING           - Passive mic monitoring, evaluating SOLELY for wake-word ("Hey ARIA").
 * 2. WAKE_DETECTED       - Wake-word confirmed, buffers purged, wake detection paused.
 * 3. ARIA_GREETING       - ARIA speaks short acknowledgement ("Yes? Tell me.") with 100% mic gating.
 * 4. ACTIVE_LISTENING    - VAD active, capturing user's question until natural silence.
 * 5. PROCESSING          - User speech finished, Whisper + RAG + LLM execution lock.
 * 6. ARIA_SPEAKING       - TTS playback of answer with complete mic/ASR suppression.
 * 7. FOLLOW_UP_LISTENING - Post-speech window allowing natural follow-up without wake-word.
 * 8. RETURN_TO_SLEEP     - Timeout / user dismiss, returning to SLEEPING.
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

// Tolerant wake word patterns across supported languages
const WAKE_WORD_PATTERNS = [
  /\b(?:hey|hi|hello|ok|okay|ask|hay|heya|yo|dear|here|hear|hallo)?\s*(?:aria|arya|area|aarya|ariya|auria|oria|arria)\b/i,
  /\b(?:here\s+ya|hear\s+ya|hey\s+ya|heya|hiya|hi\s+ya|hariya|harya|haria)\b/i,
  /\b(?:aria|arya|area|aarya|ariya|auria|oria|arria)\b/i,
  /(?:你好|嗨|请问|问一下)?\s*(?:aria|arya|area)/i,
  /\b(?:hai|halo|helo|tanya)\s+(?:aria|arya|area)\b/i,
  /(?:வணக்கம்|ஹாய்)?\s*(?:aria|ஆரியா)/i,
  /(?:হ্যালো|নমস্কার)?\s*(?:aria|আরিয়া)/i
];

// ARIA's own acknowledgment and greeting phrases across all languages that must NEVER be processed as user questions
export const KNOWN_SELF_ECHO_PATTERNS = [
  /\b(?:yes|yeah|ya)?\s*(?:tell\s+me|im\s+listening|i\s+am\s+listening|listening|please\s+tell\s+me)\b/i,
  /\b(?:yes\s*\??\s*tell\s+me|i'm\s+listening|im\s+listening|i\s+am\s+listening|yes\s+tell\s+me\s+i'm\s+listening)\b/i,
  /\b(?:yes\s*\??\s*tell\s+me|yes\s+tell\s+me|tell\s+me\s+i'm\s+listening)\b/i,
  /\b(?:hello\s+i\s+am\s+aria|i\s+am\s+aria|your\s+personal\s+ai\s+tutor)\b/i,
  /(?:我在听|请问有什么可以帮您|我在听请问|请问有什么)/i,
  /\b(?:ya\s*\??\s*saya\s+mendengar|sila\s+beritahu\s+saya|saya\s+mendengar|sila\s+beritahu)\b/i,
  /(?:சொல்லுங்கள்|நான்\s*கேட்கிறேன்|சொல்லுங்கள்\s*நான்\s*கேட்கிறேன்)/i,
  /(?:হ্যাঁ\s*বলুন|আমি\s*শুনছি|বলুন\s*আমি\s*শুনছি|আমি\s*শুনছি)/i
];

const ARIA_VARIANTS_SET = new Set([
  'aria', 'arya', 'area', 'aarya', 'ariya', 'auria', 'oria', 'arria', 'heya', 'hiya', 'harya', 'haria', 'ஆரியா', 'আরিয়া'
]);

export const normalizeTranscript = (text) => {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?'"“”‘’[\]\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const containsWakeWord = (text) => {
  if (!text) return false;
  const normalized = normalizeTranscript(text);
  if (!normalized) return false;

  // If text is purely an echo of ARIA's own greeting, do not treat as wake word
  if (KNOWN_SELF_ECHO_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (WAKE_WORD_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const tokens = normalized.split(' ');
  return tokens.some((token) => ARIA_VARIANTS_SET.has(token));
};

export const extractQuestionFromWakeWord = (text) => {
  if (!text) return '';
  let clean = text.trim();
  clean = clean.replace(
    /^(?:hey|hi|hello|ok|okay|ask|hay|heya|yo|dear|here|hear|excuse\s+me|你好|嗨|hai|halo|வணக்கம்|ஹாய்|হ্যালো)?\s*(?:aria|area|arya|aarya|ariya|auria|oria|arria|ya|ia|ஆரியா|আরিয়া)[\s,.:!?-]*/i,
    ''
  ).trim();
  clean = clean.replace(
    /[\s,.:!?-]*(?:aria|area|arya|aarya|ariya|auria|oria|arria|ya|ஆரியா|আরিয়া)$/i,
    ''
  ).trim();
  return clean;
};

export const isNoiseOrHallucination = (text) => {
  if (!text) return true;
  const t = text.trim().toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?'"“”‘’]/g, '').trim();
  if (t.length < 2) return true;
  const noisePhrases = [
    'blank_audio', 'silence', 'music', 'i am sorry', 'im sorry', 'sorry',
    'thank you', 'thank you for watching', 'thanks for watching', 'thanks',
    'see you in the next video', 'see you in the next one', 'see you next time',
    'see you later', 'i will see you in the next', 'i will see you',
    'subtitles by', 'subscribe to', 'subscribe', 'like and subscribe',
    'translated by', 'you', 'so', 'bye', 'goodbye', 'okay bye',
    'yes', 'yeah', 'ok', 'okay', 'tell me', 'listening', 'im listening', 'i am listening'
  ];
  return noisePhrases.some((p) => t === p || (t.length < 20 && t.includes(p)));
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
    this.recentAriaUtterances = []; // For transcript echo rejection
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
    this.log(LogCategory.VOICE_STATE, `${oldState} -> ${newState}`);

    this.stateListeners.forEach((listener) => {
      try {
        listener(newState);
      } catch (e) {
        console.error('[VOICE] Error in state listener:', e);
      }
    });
  }

  setLecturePlaying(isPlaying) {
    this.isLecturePlaying = isPlaying;
    if (isPlaying && this.isRecording) {
      this.stopMediaRecording();
      this.clearBuffers();
    }
  }

  setAwake(awake) {
    if (awake) {
      if (this.state === TutorState.SLEEPING) {
        this.setState(TutorState.ACTIVE_LISTENING);
      }
      this.resetFollowUpTimeout();
    } else if (!this.isTutorSpeaking) {
      this.returnToSleep();
    }
  }

  setConversationMode(inConv) {
    this.inConversationMode = inConv;
    if (inConv) {
      if (this.state === TutorState.SLEEPING) {
        this.setState(TutorState.ACTIVE_LISTENING);
      }
      this.resetFollowUpTimeout();
    } else if (!this.isTutorSpeaking) {
      this.returnToSleep();
    }
  }

  /**
   * Initializes the microphone stream with hardware echo cancellation and begins passive wake-word monitoring.
   */
  async start(langCode = 'en-US') {
    if (this.isMounted) return;
    this.isMounted = true;
    this.langCode = langCode;
    this.log(LogCategory.VOICE_STATE, `Initializing Voice Tutor Manager (Lang: ${langCode})...`);

    try {
      await this.initMicrophonePipeline();
      this.initSpeechRecognition();
      this.setState(TutorState.SLEEPING);
    } catch (err) {
      console.error('[VOICE] Initialization error:', err);
      this.setState(TutorState.ERROR);
    }
  }

  async initMicrophonePipeline() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (!this.isMounted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.micStream = stream;
      this.log(LogCategory.VOICE_STATE, 'Microphone stream initialized with Echo Cancellation + Noise Suppression.');

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      this.audioContext = audioCtx;
      this.analyser = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      // Continuous VAD loop (~40ms tick)
      if (this.vadInterval) clearInterval(this.vadInterval);
      this.vadInterval = setInterval(() => {
        if (!this.isMounted || !this.analyser) return;

        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => { });
        }

        // 1. STRICT ECHO SUPPRESSION: Gated during ARIA_GREETING, ARIA_SPEAKING, PROCESSING, or Cooldown
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

        this.analyser.getByteFrequencyData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        const now = Date.now();

        // 2. If actively recording user speech: evaluate silence completion
        if (this.isRecording) {
          if (rms >= this.options.silenceRmsThreshold) {
            this.lastSpeechTime = now;
          }

          const silenceDuration = now - this.lastSpeechTime;
          const totalDuration = now - this.recordingStartTime;

          if (
            (silenceDuration >= this.options.silenceDurationMs && totalDuration >= 800) ||
            totalDuration >= this.options.maxRecordingMs
          ) {
            this.log(LogCategory.VAD_END, `Speech ended (Silence: ${silenceDuration}ms, Duration: ${totalDuration}ms)`);
            this.stopMediaRecording();
          }
          return;
        }

        // 3. If in ACTIVE_LISTENING or FOLLOW_UP_LISTENING: check for speech onset
        if (
          this.state === TutorState.ACTIVE_LISTENING ||
          this.state === TutorState.FOLLOW_UP_LISTENING
        ) {
          if (rms >= this.options.speechRmsThreshold) {
            this.speechFramesCount += 1;
            if (this.speechFramesCount >= 2) {
              // Confirmed speech onset (~80ms sustained energy)
              this.speechFramesCount = 0;
              this.log(LogCategory.VAD_START, `User speech detected (RMS: ${rms.toFixed(1)})`);
              this.clearFollowUpTimeout();
              this.startMediaRecording();
            }
          } else {
            this.speechFramesCount = 0;
          }
        }
      }, 40);
    } catch (err) {
      console.error('[VOICE] Microphone permission error or device unavailable:', err);
      this.setState(TutorState.ERROR);
      throw err;
    }
  }

  startMediaRecording() {
    if (!this.micStream || this.isRecording) return;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        try { this.mediaRecorder.stop(); } catch (e) { }
      }

      this.audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recorder = mimeType
        ? new MediaRecorder(this.micStream, { mimeType })
        : new MediaRecorder(this.micStream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        this.isRecording = false;

        // Strict guard: Discard recordings finalized during TTS
        if (this.isTutorSpeaking || Date.now() < this.ttsMutedUntil) {
          this.log(LogCategory.ECHO_REJECTED, 'Audio chunk discarded because TTS was active');
          this.audioChunks = [];
          return;
        }

        const audioBlob = new Blob(this.audioChunks, {
          type: recorder.mimeType || 'audio/webm'
        });
        this.audioChunks = [];

        const duration = Date.now() - this.recordingStartTime;
        this.log(LogCategory.AUDIO_DURATION, `Captured audio blob (${audioBlob.size}B, ${duration}ms)`);

        if (audioBlob.size < 2500 || duration < 600) {
          this.log(LogCategory.TRANSCRIPTION, 'Audio slice too short / noise-only. Resetting to active listening.');
          if (this.state === TutorState.ACTIVE_LISTENING || this.state === TutorState.FOLLOW_UP_LISTENING) {
            this.resetFollowUpTimeout();
          }
          return;
        }

        if (this.options.onAudioCaptured) {
          this.setState(TutorState.PROCESSING);
          this.options.onAudioCaptured(audioBlob);
        }
      };

      recorder.start(250);
      this.mediaRecorder = recorder;
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      this.lastSpeechTime = Date.now();
    } catch (err) {
      console.error('[VOICE] Failed to start MediaRecorder:', err);
      this.isRecording = false;
    }
  }

  stopMediaRecording() {
    this.isRecording = false;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn('[VOICE] Error stopping recorder:', e);
      }
    }
  }

  /**
   * Initializes lightweight browser SpeechRecognition solely for fast wake-phrase recognition.
   */
  initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      this.log(LogCategory.WAKE_DETECTION, 'Browser SpeechRecognition API not supported. Relying on VAD + Whisper backend.');
      return;
    }

    try {
      if (this.recognition) {
        try { this.recognition.abort(); } catch (e) { }
      }

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.lang = this.langCode || 'en-US';

      rec.onstart = () => {
        this.log(LogCategory.WAKE_DETECTION, `SpeechRecognition wake detector active (${rec.lang})`);
        this.isRestarting = false;
      };

      rec.onresult = (event) => {
        if (!this.isMounted) return;

        const lastIdx = event.results.length - 1;
        const result = event.results[lastIdx];
        if (!result || !result[0]) return;

        const transcript = result[0].transcript.trim();
        if (!transcript) return;

        const isFinal = result.isFinal;
        this.handleTranscriptEvent(transcript, isFinal);
      };

      rec.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[VOICE] SpeechRecognition notice:', e.error);
        }
      };

      rec.onend = () => {
        if (this.isMounted && !this.isRestarting && !this.isTutorSpeaking && Date.now() >= this.ttsMutedUntil) {
          this.scheduleRestart();
        }
      };

      rec.start();
      this.recognition = rec;
    } catch (err) {
      console.warn('[VOICE] SpeechRecognition init notice:', err);
    }
  }

  scheduleRestart() {
    if (!this.isMounted) return;
    this.isRestarting = true;
    setTimeout(() => {
      if (!this.isMounted || this.isTutorSpeaking || Date.now() < this.ttsMutedUntil) {
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
          try { this.initSpeechRecognition(); } catch (e) { }
        }
      }
      this.isRestarting = false;
    }, 150);
  }

  handleTranscriptEvent(transcript, isFinal) {
    // 1. Strict Gating: Completely discard transcriptions during ARIA speech or post-speech cooldown
    if (
      this.isTutorSpeaking ||
      Date.now() < this.ttsMutedUntil ||
      this.state === TutorState.ARIA_GREETING ||
      this.state === TutorState.ARIA_SPEAKING ||
      this.state === TutorState.PROCESSING
    ) {
      this.log(LogCategory.ECHO_REJECTED, `Rejected transcript during speaking/cooldown/processing: "${transcript}"`);
      return;
    }

    // 2. Transcript Echo Rejection: Check if transcript matches recent ARIA utterances or greeting phrases
    if (this.isTranscriptSelfEcho(transcript)) {
      this.log(LogCategory.ECHO_REJECTED, `Rejected self-echo matching ARIA utterance: "${transcript}"`);
      return;
    }

    // 3. In SLEEPING state: ARIA ONLY evaluates for wake-word. Discard all other speech.
    if (this.state === TutorState.SLEEPING) {
      if (containsWakeWord(transcript)) {
        this.log(LogCategory.WAKE_MATCH, `Wake phrase detected: "${transcript}"`);
        this.triggerWakeSequence(transcript);
      }
      return;
    }

    // 4. In ACTIVE_LISTENING or FOLLOW_UP_LISTENING:
    if (
      this.state === TutorState.ACTIVE_LISTENING ||
      this.state === TutorState.FOLLOW_UP_LISTENING
    ) {
      if (isFinal) {
        const clean = extractQuestionFromWakeWord(transcript);
        const finalQuestion = clean || transcript;

        if (finalQuestion && finalQuestion.length >= 2 && !isNoiseOrHallucination(finalQuestion) && !this.isTranscriptSelfEcho(finalQuestion)) {
          this.log(LogCategory.TRANSCRIPTION, `User question captured: "${finalQuestion}"`);
          this.processUserQuestion(finalQuestion);
        }
      }
    }
  }

  /**
   * Compares transcript against recent ARIA utterances and known greeting patterns to reject acoustic self-echo.
   */
  isTranscriptSelfEcho(transcript) {
    if (!transcript) return false;
    const cleanTrans = normalizeTranscript(transcript);
    if (!cleanTrans || cleanTrans.length < 2) return true;

    // Check against known acknowledgment and greeting echo patterns
    if (KNOWN_SELF_ECHO_PATTERNS.some((p) => p.test(transcript) || p.test(cleanTrans))) {
      return true;
    }

    // Check short generic acknowledgment words
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

    for (const phrase of this.recentAriaUtterances) {
      const cleanPhrase = normalizeTranscript(phrase);
      if (!cleanPhrase) continue;
      if (cleanPhrase.includes(cleanTrans) || cleanTrans.includes(cleanPhrase)) {
        return true;
      }
      const phraseWords = cleanPhrase.split(' ').filter((w) => w.length > 2);
      const transWords = cleanTrans.split(' ').filter((w) => w.length > 2);
      if (transWords.length > 0 && transWords.every((w) => phraseWords.includes(w))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Triggers the Wake Sequence:
   * SLEEPING -> WAKE_DETECTED -> triggers greeting callback.
   */
  triggerWakeSequence(wakeTranscript) {
    this.setState(TutorState.WAKE_DETECTED);
    this.clearBuffers();
    this.clearFollowUpTimeout();

    if (this.options.onWakeWordDetected) {
      this.options.onWakeWordDetected(wakeTranscript);
    }
  }

  /**
   * Called when user question text is finalized (via Whisper or ASR).
   */
  processUserQuestion(questionText) {
    const normalized = normalizeTranscript(questionText);
    const now = Date.now();

    // Guard against self-echo
    if (this.isTranscriptSelfEcho(questionText) || isNoiseOrHallucination(questionText)) {
      this.log(LogCategory.ECHO_REJECTED, `Dropped question as self-echo/noise: "${questionText}"`);
      return;
    }

    // Deduplication check: prevent duplicate triggers within 2.5s
    if (this.lastProcessedText === normalized && now - this.lastProcessedTime < 2500) {
      return;
    }

    this.lastProcessedText = normalized;
    this.lastProcessedTime = now;
    this.clearFollowUpTimeout();
    this.setState(TutorState.PROCESSING);

    if (this.options.onQuestionReady) {
      this.options.onQuestionReady(questionText);
    }
  }

  /**
   * Sets ARIA speaking state with complete microphone suppression and echo prevention.
   */
  setTutorSpeaking(speaking, spokenText = '') {
    this.isTutorSpeaking = speaking;
    if (speaking) {
      if (this.cooldownTimeoutId) {
        clearTimeout(this.cooldownTimeoutId);
        this.cooldownTimeoutId = null;
      }
      this.clearFollowUpTimeout();
      this.clearBuffers();

      // PAUSE & ABORT speech recognition so the microphone buffer does not accumulate speaker audio
      if (this.recognition) {
        try {
          this.recognition.abort();
        } catch (e) { }
      }

      // Record spoken text for echo rejection
      if (spokenText) {
        this.recentAriaUtterances.push(spokenText);
        if (this.recentAriaUtterances.length > 8) {
          this.recentAriaUtterances.shift();
        }
      }

      // Set mute window far into the future until TTS ends
      this.ttsMutedUntil = Date.now() + 60000;
      this.log(LogCategory.TTS_START, 'ARIA speaking started. Mic recognition aborted & 100% gated.');
    } else {
      this.log(LogCategory.TTS_END, 'ARIA speaking ended. Entering 1000ms acoustic cooldown.');
      // Enforce strict 1000ms cooldown after speech
      this.ttsMutedUntil = Date.now() + 1000;
      this.clearBuffers();

      if (this.cooldownTimeoutId) clearTimeout(this.cooldownTimeoutId);
      this.cooldownTimeoutId = setTimeout(() => {
        this.clearBuffers();
        const nextState = (this.state === TutorState.ARIA_GREETING) ? TutorState.ACTIVE_LISTENING : TutorState.FOLLOW_UP_LISTENING;
        this.setState(nextState);
        this.resetFollowUpTimeout();

        // Fresh restart of SpeechRecognition with an empty buffer
        if (this.isMounted && !this.isTutorSpeaking) {
          try {
            if (this.recognition) {
              this.recognition.start();
            } else {
              this.initSpeechRecognition();
            }
          } catch (e) {
            try { this.initSpeechRecognition(); } catch (err) { }
          }
        }
      }, 1000);
    }
  }

  /**
   * Manages the follow-up conversational window.
   * If silence exceeds followUpTimeoutMs, returns to SLEEPING.
   */
  resetFollowUpTimeout() {
    this.clearFollowUpTimeout();
    this.followUpTimeoutId = setTimeout(() => {
      if (this.state === TutorState.FOLLOW_UP_LISTENING && !this.isTutorSpeaking) {
        this.log(LogCategory.RETURN_TO_SLEEP, 'Follow-up listening timeout. Returning to SLEEPING.');
        this.setState(TutorState.RETURN_TO_SLEEP);
        setTimeout(() => {
          if (this.state === TutorState.RETURN_TO_SLEEP) {
            this.setState(TutorState.SLEEPING);
            if (this.options.onReturnToSleep) {
              this.options.onReturnToSleep();
            }
          }
        }, 300);
      }
    }, this.options.followUpTimeoutMs);
  }

  clearFollowUpTimeout() {
    if (this.followUpTimeoutId) {
      clearTimeout(this.followUpTimeoutId);
      this.followUpTimeoutId = null;
    }
  }

  clearBuffers() {
    this.audioChunks = [];
    this.speechFramesCount = 0;
    this.lastSpeechTime = 0;
  }

  /**
   * Explicitly returns to SLEEPING mode (e.g. user voice dismissal or exit).
   */
  returnToSleep() {
    this.clearFollowUpTimeout();
    this.clearBuffers();
    this.setState(TutorState.RETURN_TO_SLEEP);
    setTimeout(() => {
      this.setState(TutorState.SLEEPING);
    }, 200);
  }

  destroy() {
    this.log(LogCategory.VOICE_STATE, 'Releasing voice manager resources...');
    this.isMounted = false;
    this.stateListeners.clear();
    this.clearFollowUpTimeout();

    if (this.cooldownTimeoutId) {
      clearTimeout(this.cooldownTimeoutId);
      this.cooldownTimeoutId = null;
    }

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.abort();
      } catch (e) { }
      try { this.recognition.stop(); } catch (e) { }
      this.recognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (e) { }
      this.mediaRecorder = null;
    }

    if (this.audioContext) {
      try { this.audioContext.close(); } catch (e) { }
      this.audioContext = null;
    }

    if (this.micStream) {
      try { this.micStream.getTracks().forEach((t) => t.stop()); } catch (e) { }
      this.micStream = null;
    }

    this.setState(TutorState.SLEEPING);
  }
}

export default VoiceTutorManager;


