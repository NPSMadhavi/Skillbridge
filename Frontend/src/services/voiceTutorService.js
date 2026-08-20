/**
 * SkillBridge Voice Tutor Interaction Manager
 * Modeled after Whisper Flow (https://github.com/dimastatz/whisper-flow.git)
 *
 * Provides a single, centralized source of truth for:
 * - Always-On persistent microphone lifecycle
 * - Real-time Voice Activity Detection (RMS energy framing)
 * - Echo cancellation and self-voice TTS suppression
 * - Seamless natural barge-in / lecture interruption
 * - Transcript deduplication and auto-recovery
 */

export const TutorState = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  USER_SPEAKING: 'USER_SPEAKING',
  PROCESSING: 'PROCESSING',
  TUTOR_SPEAKING: 'TUTOR_SPEAKING',
  INTERRUPTED: 'INTERRUPTED',
  RESUMING: 'RESUMING',
  ERROR: 'ERROR'
};

const WAKE_WORDS = [
  // English phonetic variations for ARIA & common vocal greetings
  'hey aria', 'hi aria', 'hello aria', 'ok aria', 'okay aria', 'ask aria', 'aria',
  'hey area', 'hi area', 'hello area', 'ok area', 'okay area', 'ask area', 'area',
  'hey arya', 'hi arya', 'hello arya', 'ok arya', 'okay arya', 'ask arya', 'arya',
  'hey aarya', 'hi aarya', 'hello aarya', 'aarya', 'ariya', 'hey ariya', 'hi ariya',
  'hey', 'hi', 'hello', 'wait', 'excuse me',

  // Common Question Openers in English
  'what is', 'what are', 'what does', 'can you', 'could you', 'explain', 'tell me',
  'how do', 'how does', 'how to', 'why is', 'why does', 'why do', 'give me', 'help me',
  'i have a question', 'question', 'define', 'meaning of', 'difference between',

  // Chinese
  '你好 aria', '你好aria', '嗨 aria', '嗨aria', 'aria 你好', '问一下 aria', '什么是', '解释一下', '请问',
  // Malay
  'hai aria', 'halo aria', 'helo aria', 'tanya aria', 'apa itu', 'boleh terangkan', 'tolong',
  // Tamil
  'வணக்கம் aria', 'ஹாய் aria', 'வணக்கம் ஆரியா', 'ஆரியா', 'என்ன', 'விளக்குங்கள்',
  // Bangla
  'হ্যালো aria', 'নমস্কার aria', 'আরিয়া', 'কী', 'বলুন', 'ব্যাখ্যা'
];

export const containsWakeWord = (text) => {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  
  // Direct match in wake word list
  if (WAKE_WORDS.some(w => lower.includes(w))) return true;

  // Regex matching ARIA phonetic variants or question openers
  return /(?:^|\b)(?:hey|hi|hello|ok|okay|ask|tell|question|wait|can you|could you|explain|what|how|why|你好|嗨|hai|halo|வணக்கம்|ஹாய்|হ্যালো)?\s*(?:aria|area|arya|aarya|ariya|auria|ஆரியா|আরিয়া)?(?:$|\b)/i.test(lower);
};

export const extractQuestionFromWakeWord = (text) => {
  if (!text) return '';
  let clean = text.trim();
  clean = clean.replace(/^(?:hey|hi|hello|ok|okay|ask|tell|wait|excuse me|can you explain|explain|你好|嗨|hai|halo|வணக்கம்|ஹாய்|হ্যালো)?\s*(?:aria|area|arya|aarya|ariya|auria|ஆரியா|আরিয়া)[\s,.:!?-]*/i, '').trim();
  return clean || text.trim();
};

export const normalizeTranscript = (text) => {
  if (!text) return '';
  return text.trim().toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?'"]/g, '').replace(/\s+/g, ' ');
};

export const isNoiseOrHallucination = (text) => {
  if (!text) return true;
  const t = text.trim().toLowerCase();
  if (t.length < 2) return true;
  const noisePhrases = [
    '[blank_audio]', '[silence]', '(silence)', '[music]', '(music)',
    'thank you.', 'thank you for watching', 'thanks for watching',
    'subtitles by', 'subscribe to', 'translated by'
  ];
  return noisePhrases.some(p => t === p || t.startsWith(p));
};

export class VoiceTutorManager {
  constructor(options = {}) {
    this.options = options;
    this.state = TutorState.IDLE;
    this.stateListeners = new Set();

    // Audio & Pipeline handles
    this.micStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.vadInterval = null;
    this.recognition = null;

    // State & Suppression Flags
    this.isMounted = false;
    this.isMuted = false;
    this.isTutorSpeaking = false;
    this.isAwake = false;
    this.inConversationMode = false;
    this.ttsMutedUntil = 0;
    this.followUpTimer = null;

    // VAD & Energy parameters
    this.SPEECH_RMS_THRESHOLD = 14;
    this.SILENCE_RMS_THRESHOLD = 8;
    this.SILENCE_DURATION_MS = 1200;
    this.MAX_RECORDING_MS = 15000;
    this.speechFramesCount = 0;
    this.lastSpeechTime = 0;
    this.recordingStartTime = 0;

    // Deduplication tracking
    this.lastProcessedText = '';
    this.lastProcessedTime = 0;
    this.lastTranscriptTime = 0;
    this.restartRetryCount = 0;
    this.isRestarting = false;
  }

  onStateChange(listener) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  setState(newState) {
    if (this.state === newState) return;
    console.log(`[TUTOR] State Transition: ${this.state} ➔ ${newState}`);
    this.state = newState;
    this.stateListeners.forEach(listener => {
      try { listener(newState); } catch (e) { console.error(e); }
    });
  }

  setAwake(awake) {
    this.isAwake = awake;
    if (!awake && !this.inConversationMode) {
      this.setState(TutorState.IDLE);
    }
  }

  setConversationMode(inConv) {
    this.inConversationMode = inConv;
    this.isAwake = inConv;
    if (!inConv) {
      this.setState(TutorState.IDLE);
    }
  }

  async start(langCode = 'en-US') {
    if (this.isMounted) return;
    this.isMounted = true;
    this.langCode = langCode;
    console.log(`[MIC] Initializing Always-On Voice Manager (Lang: ${langCode})...`);

    try {
      await this.initMicrophonePipeline();
      this.initSpeechRecognition();
      this.setState(TutorState.IDLE);
    } catch (err) {
      console.error('[MIC] Initialization error:', err);
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
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      this.micStream = stream;
      console.log('[MIC] Permission state: GRANTED (Microphone stream active)');

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

      // Continuous VAD Energy Loop (~40ms tick)
      if (this.vadInterval) clearInterval(this.vadInterval);
      this.vadInterval = setInterval(() => {
        if (!this.isMounted || !this.analyser) return;

        // Suppress VAD while ARIA is outputting speech to prevent echo
        if (this.isTutorSpeaking || Date.now() < this.ttsMutedUntil) {
          this.speechFramesCount = 0;
          return;
        }

        // Only run VAD energy recording when ARIA is awakened or in follow-up mode
        if (!this.isAwake && !this.inConversationMode) {
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        // VAD State Machine
        if (this.state === TutorState.LISTENING || this.state === TutorState.IDLE) {
          if (rms >= this.SPEECH_RMS_THRESHOLD) {
            this.speechFramesCount += 1;
            if (this.speechFramesCount >= 2) { // ~80ms sustained energy
              console.log(`[VAD] User speech started (RMS: ${rms.toFixed(1)})`);
              this.speechFramesCount = 0;
              this.setState(TutorState.USER_SPEAKING);
              this.startMediaRecording();
            }
          } else {
            this.speechFramesCount = 0;
          }
        } else if (this.state === TutorState.USER_SPEAKING) {
          const now = Date.now();
          if (rms >= this.SILENCE_RMS_THRESHOLD) {
            this.lastSpeechTime = now;
          }

          const silenceDuration = now - this.lastSpeechTime;
          const totalDuration = now - this.recordingStartTime;

          // 1.2s silence after speech or 15s max duration reached
          if ((silenceDuration >= this.SILENCE_DURATION_MS && totalDuration >= 500) || totalDuration >= this.MAX_RECORDING_MS) {
            console.log(`[VAD] User speech ended: Silence detected (${silenceDuration}ms)`);
            this.stopMediaRecording();
          }
        }
      }, 40);

    } catch (err) {
      console.error('[MIC] Microphone permission error or device unavailable:', err);
      this.setState(TutorState.ERROR);
      throw err;
    }
  }

  startMediaRecording() {
    if (!this.micStream) return;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        try { this.mediaRecorder.stop(); } catch (e) { }
      }

      this.audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');

      const recorder = mimeType ? new MediaRecorder(this.micStream, { mimeType }) : new MediaRecorder(this.micStream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: recorder.mimeType || 'audio/webm' });
        this.audioChunks = [];
        console.log(`[MIC] Audio slice finalized (${audioBlob.size} bytes)`);

        if (audioBlob.size < 1000) {
          this.setState(TutorState.LISTENING);
          return;
        }

        if (this.options.onAudioChunkReady) {
          this.setState(TutorState.PROCESSING);
          this.options.onAudioChunkReady(audioBlob);
        }
      };

      recorder.start(250);
      this.mediaRecorder = recorder;
      this.recordingStartTime = Date.now();
      this.lastSpeechTime = Date.now();
    } catch (err) {
      console.error('[MIC] Failed to start MediaRecorder:', err);
      this.setState(TutorState.LISTENING);
    }
  }

  stopMediaRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn('[MIC] Error stopping recorder:', e);
        this.setState(TutorState.LISTENING);
      }
    } else {
      this.setState(TutorState.LISTENING);
    }
  }

  initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('[MIC] SpeechRecognition API not supported in browser. Relying on VAD + Whisper.');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = this.langCode || 'en-US';

      rec.onstart = () => {
        console.log(`[MIC] Recognition started (${rec.lang})`);
        this.restartRetryCount = 0;
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
          console.log(`[MIC] Interim transcript: "${transcript}"`);
          if (this.options.onInterimTranscript) {
            this.options.onInterimTranscript(transcript);
          }
        } else {
          console.log(`[MIC] Final transcript: "${transcript}"`);
          this.handleTranscriptEvent(transcript);
        }
      };

      rec.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[MIC] Recognition error:', e.error);
        }
      };

      rec.onend = () => {
        console.log('[MIC] Recognition ended.');
        if (this.isMounted && !this.isRestarting) {
          this.scheduleRestart();
        }
      };

      rec.start();
      this.recognition = rec;
    } catch (err) {
      console.warn('[MIC] SpeechRecognition init notice:', err);
    }
  }

  scheduleRestart() {
    this.isRestarting = true;
    const delay = Math.min(2000, 200 * Math.pow(1.5, this.restartRetryCount));
    this.restartRetryCount += 1;

    setTimeout(() => {
      if (!this.isMounted) return;
      try {
        if (this.recognition) {
          this.recognition.start();
        } else {
          this.initSpeechRecognition();
        }
      } catch (err) {
        // Recognition already active or retrying
      }
      this.isRestarting = false;
    }, delay);
  }

  handleTranscriptEvent(rawTranscript) {
    if (!rawTranscript || isNoiseOrHallucination(rawTranscript)) return;

    // Suppress transcript if ARIA is outputting speech or during post-TTS echo window
    if (this.isTutorSpeaking || Date.now() < this.ttsMutedUntil) {
      // Check if user is saying "Hey ARIA" to barge-in interrupt
      if (containsWakeWord(rawTranscript)) {
        console.log('[TUTOR] User interrupted ARIA speaking via wake word');
        if (this.options.onUserInterrupt) {
          this.options.onUserInterrupt();
        }
      } else {
        console.log('[MIC] ARIA audio detected/suppressed:', rawTranscript);
      }
      return;
    }

    const normalized = normalizeTranscript(rawTranscript);
    const now = Date.now();

    // Transcript deduplication (2.5s window)
    if (this.lastProcessedText === normalized && (now - this.lastProcessedTime < 2500)) {
      console.log(`[MIC] Duplicate transcript ignored: "${rawTranscript}"`);
      return;
    }

    this.lastProcessedText = normalized;
    this.lastProcessedTime = now;

    if (this.options.onFinalTranscript) {
      this.options.onFinalTranscript(rawTranscript);
    }
  }

  setTutorSpeaking(speaking) {
    this.isTutorSpeaking = speaking;
    if (speaking) {
      this.setState(TutorState.TUTOR_SPEAKING);
    } else {
      // 1.2s post-TTS echo lockout
      this.ttsMutedUntil = Date.now() + 1200;
      this.setState(TutorState.LISTENING);
    }
  }

  destroy() {
    console.log('[MIC] Destroying Voice Tutor Manager & releasing handles...');
    this.isMounted = false;
    this.stateListeners.clear();

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.recognition) {
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
      try { this.micStream.getTracks().forEach(t => t.stop()); } catch (e) { }
      this.micStream = null;
    }

    this.setState(TutorState.IDLE);
  }
}

export default VoiceTutorManager;
