/**
 * SkillBridge Voice Tutor Interaction Manager
 * Modeled after Whisper Flow (https://github.com/dimastatz/whisper-flow.git)
 *
 * Implements a strict Two-Stage Voice State Machine:
 * 1. SLEEPING / IDLE: Microphone stream continuously ACTIVE, monitoring solely for wake-word ("Hey ARIA").
 * 2. ACTIVE_LISTENING: Real-time high-fidelity transcription + VAD silence completion + Whisper.
 * 3. AI_THINKING: LLM / RAG processing lock.
 * 4. AI_SPEAKING: TTS playback with 100% microphone transcription suppression to prevent self-echo.
 * 5. POST_SPEECH_COOLDOWN: 500ms buffer purge before returning to SLEEPING.
 */

export const TutorState = {
  SLEEPING: 'SLEEPING',
  IDLE: 'SLEEPING', // Backward-compatibility alias
  WAKE_DETECTED: 'WAKE_DETECTED',
  ACTIVE_LISTENING: 'ACTIVE_LISTENING',
  LISTENING: 'ACTIVE_LISTENING', // Alias
  USER_SPEAKING: 'USER_SPEAKING',
  AI_THINKING: 'AI_THINKING',
  PROCESSING: 'AI_THINKING', // Alias
  AI_SPEAKING: 'AI_SPEAKING',
  TUTOR_SPEAKING: 'AI_SPEAKING', // Alias
  POST_SPEECH_COOLDOWN: 'POST_SPEECH_COOLDOWN',
  ERROR: 'ERROR'
};

// Tolerant wake words & phonetic variants for ARIA (including Whisper ASR phonetics)
const WAKE_WORD_PATTERNS = [
  // Common prefixes + phonetic ARIA variants
  /\b(?:hey|hi|hello|ok|okay|ask|hay|heya|yo|dear|here|hear)?\s*(?:aria|arya|area|aarya|ariya|auria|oria|arria)\b/i,
  // Whisper phonetic captures for "Hey Aria" / "Hey Arya"
  /\b(?:here\s+ya|hear\s+ya|hey\s+ya|heya|hiya|hi\s+ya|hariya|harya|haria)\b/i,
  // Single-word direct wake names
  /\b(?:aria|arya|area|aarya|ariya|auria|oria|arria)\b/i,
  // Chinese
  /(?:你好|嗨|请问|问一下)?\s*(?:aria|arya|area)/i,
  // Malay
  /\b(?:hai|halo|helo|tanya)\s+(?:aria|arya|area)\b/i,
  // Tamil
  /(?:வணக்கம்|ஹாய்)?\s*(?:aria|ஆரியா)/i,
  // Bangla
  /(?:হ্যালো|নমস্কার)?\s*(?:aria|আরিয়া)/i
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

  // Direct regex pattern match
  if (WAKE_WORD_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // Token-level fuzzy match: check if any word in the transcript is an ARIA variation
  const tokens = normalized.split(' ');
  return tokens.some((token) => ARIA_VARIANTS_SET.has(token));
};

export const extractQuestionFromWakeWord = (text) => {
  if (!text) return '';
  let clean = text.trim();
  // Strip leading wake phrases (including "Here ya", "Hear ya", "Hey ya")
  clean = clean.replace(
    /^(?:hey|hi|hello|ok|okay|ask|hay|heya|yo|dear|here|hear|excuse\s+me|你好|嗨|hai|halo|வணக்கம்|ஹாய்|হ্যালো)?\s*(?:aria|area|arya|aarya|ariya|auria|oria|arria|ya|ia|ஆரியா|আরিয়া)[\s,.:!?-]*/i,
    ''
  ).trim();
  // Strip trailing wake phrases: e.g. "What is ANN, Aria?"
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
    'translated by', 'you', 'so', 'bye', 'goodbye'
  ];
  return noisePhrases.some((p) => t === p || t.includes(p));
};

export class VoiceTutorManager {
  constructor(options = {}) {
    this.options = options;
    this.state = TutorState.SLEEPING;
    this.stateListeners = new Set();

    // Audio & Pipeline handles (kept continuously active)
    this.micStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.vadInterval = null;
    this.recognition = null;

    // State & Suppression Flags
    this.isMounted = false;
    this.isTutorSpeaking = false;
    this.isLecturePlaying = false;
    this.isAwake = false;
    this.inConversationMode = false;
    this.ttsMutedUntil = 0;
    this.wakeTimeoutId = null;
    this.cooldownTimeoutId = null;
    this.currentUtteranceId = null;

    // VAD & Energy parameters
    this.SPEECH_RMS_THRESHOLD = 14;
    this.SILENCE_RMS_THRESHOLD = 8;
    this.SILENCE_DURATION_MS = 1200;
    this.MAX_RECORDING_MS = 15000;
    this.speechFramesCount = 0;
    this.lastSpeechTime = 0;
    this.recordingStartTime = 0;
    this.lastEnergyLogTime = 0;

    // Deduplication tracking
    this.lastProcessedText = '';
    this.lastProcessedTime = 0;
    this.isRestarting = false;
  }

  onStateChange(listener) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    console.log(`[VOICE] State: ${newState}`);
    this.stateListeners.forEach((listener) => {
      try {
        listener(newState);
      } catch (e) {
        console.error(e);
      }
    });
  }

  setLecturePlaying(isPlaying) {
    this.isLecturePlaying = isPlaying;
    if (isPlaying && this.isRecording && this.isRecordingWakeSlice) {
      this.isRecording = false;
      this.isRecordingWakeSlice = false;
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        try { this.mediaRecorder.stop(); } catch (e) {}
      }
      this.audioChunks = [];
    }
  }

  setAwake(awake) {
    this.isAwake = awake;
    if (awake) {
      if (this.state === TutorState.SLEEPING || this.state === TutorState.IDLE) {
        this.setState(TutorState.ACTIVE_LISTENING);
      }
      this.resetWakeTimeout();
    } else if (!this.inConversationMode && !this.isTutorSpeaking) {
      this.setState(TutorState.SLEEPING);
    }
  }

  setConversationMode(inConv) {
    this.inConversationMode = inConv;
    this.isAwake = inConv;
    if (inConv) {
      if (this.state === TutorState.SLEEPING || this.state === TutorState.IDLE) {
        this.setState(TutorState.ACTIVE_LISTENING);
      }
    } else if (!this.isTutorSpeaking) {
      this.setState(TutorState.SLEEPING);
    }
  }

  resetWakeTimeout() {
    if (this.wakeTimeoutId) {
      clearTimeout(this.wakeTimeoutId);
    }
    // Return to SLEEPING if no user input within 8 seconds of waking
    this.wakeTimeoutId = setTimeout(() => {
      if (
        this.state === TutorState.ACTIVE_LISTENING &&
        !this.isTutorSpeaking &&
        !this.inConversationMode
      ) {
        console.log('[VOICE] Active listening window timeout. Returning to SLEEPING.');
        this.isAwake = false;
        this.setState(TutorState.SLEEPING);
      }
    }, 8000);
  }

  async start(langCode = 'en-US') {
    if (this.isMounted) return;
    this.isMounted = true;
    this.langCode = langCode;
    console.log(`[VOICE] Initializing Always-On Voice Manager (Lang: ${langCode})...`);

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
      console.log('[VOICE] Permission state: GRANTED (Continuous microphone stream active)');

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

      // Continuous VAD & Audio Presence Loop (~40ms tick)
      if (this.vadInterval) clearInterval(this.vadInterval);
      this.vadInterval = setInterval(() => {
        if (!this.isMounted || !this.analyser) return;

        // Keep audio context alive
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }

        // Suppress VAD completely while ARIA is speaking or in post-TTS cooldown
        if (
          this.isTutorSpeaking ||
          Date.now() < this.ttsMutedUntil ||
          this.state === TutorState.AI_SPEAKING ||
          this.state === TutorState.POST_SPEECH_COOLDOWN ||
          this.state === TutorState.AI_THINKING
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

        // Periodic diagnostic log confirming mic audio reaches detector
        const now = Date.now();
        if (rms > this.SPEECH_RMS_THRESHOLD && now - this.lastEnergyLogTime > 4000) {
          this.lastEnergyLogTime = now;
          console.log(`[VOICE] Mic audio reaching detector (RMS: ${rms.toFixed(1)}, State: ${this.state})`);
        }

        // If already recording, check silence completion
        if (this.isRecording) {
          if (rms >= this.SILENCE_RMS_THRESHOLD) {
            this.lastSpeechTime = now;
          }

          const silenceDuration = now - this.lastSpeechTime;
          const totalDuration = now - this.recordingStartTime;
          const silenceLimit = this.isRecordingWakeSlice ? 600 : this.SILENCE_DURATION_MS;
          const minDuration = this.isRecordingWakeSlice ? 700 : 1000;
          const maxDuration = this.isRecordingWakeSlice ? 3000 : this.MAX_RECORDING_MS;

          if (
            (silenceDuration >= silenceLimit && totalDuration >= minDuration) ||
            totalDuration >= maxDuration
          ) {
            this.stopMediaRecording();
          }
          return;
        }

        // If NOT recording: check for speech onset in SLEEPING (wake check) or ACTIVE_LISTENING (question)
        if (rms >= this.SPEECH_RMS_THRESHOLD) {
          this.speechFramesCount += 1;
          if (this.speechFramesCount >= 2) {
            // ~80ms sustained energy: begin capturing speech slice
            this.speechFramesCount = 0;
            this.isRecordingWakeSlice = (this.state === TutorState.SLEEPING || this.state === TutorState.IDLE);
            if (this.state === TutorState.ACTIVE_LISTENING) {
              this.setState(TutorState.USER_SPEAKING);
            }
            this.startMediaRecording();
          }
        } else {
          this.speechFramesCount = 0;
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
        try {
          this.mediaRecorder.stop();
        } catch (e) {}
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
        const wasWakeSlice = this.isRecordingWakeSlice;
        this.isRecordingWakeSlice = false;

        // Strict guard: ignore recordings that finished during speech/cooldown
        if (this.isTutorSpeaking || Date.now() < this.ttsMutedUntil) {
          this.audioChunks = [];
          return;
        }

        const audioBlob = new Blob(this.audioChunks, {
          type: recorder.mimeType || 'audio/webm'
        });
        this.audioChunks = [];

        if (audioBlob.size < 2000) {
          if (this.isAwake || this.inConversationMode) {
            this.setState(TutorState.ACTIVE_LISTENING);
          } else {
            this.setState(TutorState.SLEEPING);
          }
          return;
        }

        if (this.options.onAudioChunkReady) {
          if (!wasWakeSlice) {
            this.setState(TutorState.AI_THINKING);
          }
          this.options.onAudioChunkReady(audioBlob, wasWakeSlice);
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
      this.isRecordingWakeSlice = false;
      this.setState(TutorState.ACTIVE_LISTENING);
    }
  }

  stopMediaRecording() {
    this.isRecording = false;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn('[VOICE] Error stopping recorder:', e);
        this.setState(TutorState.ACTIVE_LISTENING);
      }
    } else if (this.isAwake || this.inConversationMode) {
      this.setState(TutorState.ACTIVE_LISTENING);
    } else {
      this.setState(TutorState.SLEEPING);
    }
  }

  initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('[VOICE] SpeechRecognition API not supported in browser. Relying on VAD + Whisper.');
      return;
    }

    try {
      if (this.recognition) {
        try {
          this.recognition.abort();
        } catch (e) {}
      }

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.lang = this.langCode || 'en-US';

      rec.onstart = () => {
        console.log(`[VOICE] Wake-word detector active and listening (${rec.lang})`);
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
        if (!isFinal) {
          this.handleInterimTranscript(transcript);
        } else {
          this.handleFinalTranscript(transcript);
        }
      };

      rec.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[VOICE] SpeechRecognition notice:', e.error);
        }
      };

      rec.onend = () => {
        if (this.isMounted && !this.isRestarting) {
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
    this.isRestarting = true;
    setTimeout(() => {
      if (!this.isMounted) return;
      try {
        if (this.recognition) {
          this.recognition.start();
        } else {
          this.initSpeechRecognition();
        }
      } catch (err) {
        try {
          this.initSpeechRecognition();
        } catch (e) {}
      }
      this.isRestarting = false;
    }, 150);
  }

  handleInterimTranscript(transcript) {
    // 1. Check for barge-in interruption if ARIA is speaking
    if (this.isTutorSpeaking) {
      if (containsWakeWord(transcript)) {
        console.log('[VOICE] User barge-in interrupt detected during speech (interim)');
        if (this.options.onUserInterrupt) {
          this.options.onUserInterrupt();
        }
      }
      return;
    }

    if (
      Date.now() < this.ttsMutedUntil ||
      this.state === TutorState.AI_SPEAKING ||
      this.state === TutorState.POST_SPEECH_COOLDOWN ||
      this.state === TutorState.AI_THINKING
    ) {
      return;
    }

    // 2. In SLEEPING state, monitor for wake phrase in real-time interim results
    if (this.state === TutorState.SLEEPING || this.state === TutorState.IDLE) {
      if (containsWakeWord(transcript)) {
        console.log(`[VOICE] Wake word detected: ${transcript}`);
        this.setState(TutorState.WAKE_DETECTED);
        this.isAwake = true;
        this.resetWakeTimeout();
        this.setState(TutorState.ACTIVE_LISTENING);
        if (this.options.onWakeWordDetected) {
          this.options.onWakeWordDetected(transcript);
        }
      }
      return;
    }

    // 3. In ACTIVE_LISTENING, deliver interim preview
    if (this.options.onInterimTranscript) {
      this.options.onInterimTranscript(transcript);
    }
  }

  handleFinalTranscript(rawTranscript) {
    if (!rawTranscript || isNoiseOrHallucination(rawTranscript)) return;

    // 1. Check for barge-in interruption if ARIA is speaking
    if (this.isTutorSpeaking) {
      if (containsWakeWord(rawTranscript)) {
        console.log('[VOICE] User barge-in interrupt detected during speech (final)');
        if (this.options.onUserInterrupt) {
          this.options.onUserInterrupt();
        }
      } else {
        console.log('[VOICE] ASR blocked because ARIA is speaking');
      }
      return;
    }

    if (
      Date.now() < this.ttsMutedUntil ||
      this.state === TutorState.AI_SPEAKING ||
      this.state === TutorState.POST_SPEECH_COOLDOWN ||
      this.state === TutorState.AI_THINKING
    ) {
      return;
    }

    const hasWake = containsWakeWord(rawTranscript);

    // 2. If in SLEEPING state, only wake word can activate the system
    if (this.state === TutorState.SLEEPING || this.state === TutorState.IDLE) {
      if (hasWake) {
        console.log(`[VOICE] Wake word detected: ${rawTranscript}`);
        this.setState(TutorState.WAKE_DETECTED);
        this.isAwake = true;
        this.resetWakeTimeout();
        this.setState(TutorState.ACTIVE_LISTENING);

        const extractedQuestion = extractQuestionFromWakeWord(rawTranscript);
        if (extractedQuestion && extractedQuestion.length >= 2) {
          // Combined wake + command: "Hey Aria, what is a vector database?"
          this.processFinalizedUtterance(extractedQuestion);
        } else if (this.options.onWakeWordDetected) {
          // Wake-word only: "Hey Aria"
          this.options.onWakeWordDetected(rawTranscript);
        }
      } else {
        // Normal background conversation while SLEEPING: discard silently
        return;
      }
      return;
    }

    // 3. In ACTIVE_LISTENING / USER_SPEAKING state
    const cleanQuestion = hasWake ? extractQuestionFromWakeWord(rawTranscript) : rawTranscript.trim();
    if (!cleanQuestion || cleanQuestion.length < 2) return;

    this.processFinalizedUtterance(cleanQuestion);
  }

  processFinalizedUtterance(questionText) {
    const normalized = normalizeTranscript(questionText);
    const now = Date.now();

    // Deduplication check: prevent duplicate submissions within 2.5s
    if (this.lastProcessedText === normalized && now - this.lastProcessedTime < 2500) {
      return;
    }

    this.lastProcessedText = normalized;
    this.lastProcessedTime = now;
    this.currentUtteranceId = `utt_${now}_${Math.random().toString(36).substring(2, 7)}`;

    console.log(`[VOICE] User transcript: ${questionText}`);
    this.setState(TutorState.AI_THINKING);

    if (this.options.onFinalTranscript) {
      this.options.onFinalTranscript(questionText, this.currentUtteranceId);
    }
  }

  setTutorSpeaking(speaking) {
    this.isTutorSpeaking = speaking;
    if (speaking) {
      if (this.cooldownTimeoutId) {
        clearTimeout(this.cooldownTimeoutId);
        this.cooldownTimeoutId = null;
      }
      this.setState(TutorState.AI_SPEAKING);
    } else {
      console.log('[VOICE] TTS finished');
      this.setState(TutorState.POST_SPEECH_COOLDOWN);
      // Strict 500ms cooldown after speech
      this.ttsMutedUntil = Date.now() + 500;
      this.clearBuffers();

      if (this.cooldownTimeoutId) clearTimeout(this.cooldownTimeoutId);
      this.cooldownTimeoutId = setTimeout(() => {
        this.clearBuffers();
        if (this.inConversationMode || this.isAwake) {
          this.setState(TutorState.ACTIVE_LISTENING);
        } else {
          this.setState(TutorState.SLEEPING);
        }
      }, 500);
    }
  }

  clearBuffers() {
    this.audioChunks = [];
    this.speechFramesCount = 0;
    this.lastSpeechTime = 0;
    console.log('[VOICE] Microphone buffers cleared');
  }

  destroy() {
    console.log('[VOICE] Destroying Voice Tutor Manager & releasing handles...');
    this.isMounted = false;
    this.stateListeners.clear();

    if (this.wakeTimeoutId) {
      clearTimeout(this.wakeTimeoutId);
      this.wakeTimeoutId = null;
    }

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
        this.recognition.stop();
      } catch (e) {}
      this.recognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
      this.mediaRecorder = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }

    if (this.micStream) {
      try {
        this.micStream.getTracks().forEach((t) => t.stop());
      } catch (e) {}
      this.micStream = null;
    }

    this.setState(TutorState.SLEEPING);
  }
}

export default VoiceTutorManager;

