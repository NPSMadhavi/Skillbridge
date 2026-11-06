import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TutorState } from '../../services/voiceTutorService';

/**
 * Phoneme-to-Viseme mapping:
 * Analyzes word characters / syllables to select realistic mouth shapes.
 * Supported visemes:
 * - 'rest'       : neutral closed/relaxed mouth
 * - 'open_ah'    : wide open jaw (a, ah, aw, o, open vowels)
 * - 'wide_ee'    : spread smiling lips (e, ee, i, y)
 * - 'round_oo'   : rounded circular lips (o, oo, u, w)
 * - 'closed_mbp' : bilabial lip closure (m, b, p)
 * - 'f_v'        : labiodental lower lip against teeth (f, v)
 * - 'th_s'       : teeth slightly open (th, s, z, t, d, c)
 */
function getVisemeForWord(word, charOffset = 0) {
  if (!word || typeof word !== 'string') return 'rest';
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 'rest';

  const char = clean[Math.min(charOffset, clean.length - 1)] || clean[0];

  if ('mbp'.includes(char)) return 'closed_mbp';
  if ('fv'.includes(char)) return 'f_v';
  if ('sztdcj'.includes(char)) return 'th_s';
  if ('oou'.includes(char) || clean.includes('oo') || clean.includes('ou')) return 'round_oo';
  if ('eiy'.includes(char) || clean.includes('ee') || clean.includes('ea')) return 'wide_ee';
  if ('ah'.includes(char)) return 'open_ah';

  return 'open_ah';
}

/**
 * HumanTutorAvatar:
 * High-fidelity, animated human AI tutor avatar replacing the static robot emoji.
 * Features:
 * 1. Lifelike dynamic viseme lip-sync matching active spoken words.
 * 2. Spontaneous randomized blinking (every 3.2-5.5s).
 * 3. Micro-saccades (natural eye gaze shifts).
 * 4. Micro-breathing oscillation (subtle sine-wave floating motion).
 * 5. Dynamic expressions based on state (Speaking, Listening, Thinking, Idle).
 * 6. Responsive voice halo and audio waveform ripples.
 */
export default function HumanTutorAvatar({
  tutorVoiceState = TutorState.IDLE,
  isSpeaking = false,
  currentWord = '',
  charIndex = 0,
  tutorName = 'ARIA',
  wakeWord = 'Hey Aria',
  onAvatarClick = () => {},
  persona = 'aria', // 'aria' (female) or 'alex' (male)
  className = ''
}) {
  const [viseme, setViseme] = useState('rest');
  const [isBlinking, setIsBlinking] = useState(false);
  const [eyeGaze, setEyeGaze] = useState({ x: 0, y: 0 });
  const [audioPulse, setAudioPulse] = useState(0);

  const visemeTimerRef = useRef(null);
  const blinkTimerRef = useRef(null);
  const gazeTimerRef = useRef(null);
  const speechLoopRef = useRef(null);

  // Active state booleans
  const isCurrentlySpeaking = isSpeaking ||
    tutorVoiceState === TutorState.ARIA_SPEAKING ||
    tutorVoiceState === TutorState.ARIA_GREETING;

  const isListening = tutorVoiceState === TutorState.ACTIVE_LISTENING ||
    tutorVoiceState === TutorState.FOLLOW_UP_LISTENING;

  const isThinking = tutorVoiceState === TutorState.THINKING ||
    tutorVoiceState === TutorState.PROCESSING_QUESTION;

  // 1. DYNAMIC VISEME LIP-SYNC
  useEffect(() => {
    if (!isCurrentlySpeaking) {
      setViseme('rest');
      setAudioPulse(0);
      if (speechLoopRef.current) {
        clearInterval(speechLoopRef.current);
        speechLoopRef.current = null;
      }
      if (visemeTimerRef.current) {
        clearTimeout(visemeTimerRef.current);
        visemeTimerRef.current = null;
      }
      return;
    }

    // If word is provided by SpeechSynthesisUtterance.onboundary
    if (currentWord) {
      if (speechLoopRef.current) {
        clearInterval(speechLoopRef.current);
        speechLoopRef.current = null;
      }
      const v = getVisemeForWord(currentWord, charIndex);
      setViseme(v);
      setAudioPulse(1);

      // Animate secondary syllable transition after 110ms
      if (visemeTimerRef.current) clearTimeout(visemeTimerRef.current);
      visemeTimerRef.current = setTimeout(() => {
        if (currentWord.length > 2) {
          const nextV = getVisemeForWord(currentWord, Math.floor(currentWord.length / 2));
          setViseme(nextV);
        }
      }, 110);
    } else {
      // Gentle natural speech cadence simulation only while actively speaking
      const cadenceVisemes = ['open_ah', 'wide_ee', 'round_oo', 'th_s', 'open_ah', 'rest'];
      let idx = 0;
      if (!speechLoopRef.current) {
        speechLoopRef.current = setInterval(() => {
          setViseme(cadenceVisemes[idx % cadenceVisemes.length]);
          setAudioPulse(idx % 2 === 0 ? 1 : 0.6);
          idx++;
        }, 150);
      }
    }

    return () => {
      if (visemeTimerRef.current) clearTimeout(visemeTimerRef.current);
      if (speechLoopRef.current) {
        clearInterval(speechLoopRef.current);
        speechLoopRef.current = null;
      }
    };
  }, [isCurrentlySpeaking, currentWord, charIndex]);

  // 2. NATURAL RANDOMIZED BLINKING CYCLE (every 3.2s to 5.5s, blink lasts ~150ms)
  useEffect(() => {
    const scheduleNextBlink = () => {
      const delay = Math.random() * 2300 + 3200;
      blinkTimerRef.current = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          scheduleNextBlink();
        }, 150);
      }, delay);
    };

    scheduleNextBlink();
    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    };
  }, []);

  // 3. EYE SACCADES & GAZE SHIFTS (Mimics natural human eye focus)
  useEffect(() => {
    const scheduleNextGazeShift = () => {
      const delay = Math.random() * 2500 + 2000;
      gazeTimerRef.current = setTimeout(() => {
        if (isThinking) {
          // Look up thoughtfully
          setEyeGaze({ x: -1.5, y: -2.5 });
        } else if (isListening) {
          // Direct attentive focus towards learner
          setEyeGaze({ x: 0, y: 0.5 });
        } else if (isCurrentlySpeaking) {
          // Subtle natural eye shift between learner and slide
          const targetX = (Math.random() - 0.5) * 2.5;
          const targetY = (Math.random() - 0.4) * 1.5;
          setEyeGaze({ x: targetX, y: targetY });
        } else {
          // Idle ambient shifts
          const targetX = (Math.random() - 0.5) * 1.8;
          const targetY = (Math.random() - 0.5) * 1.2;
          setEyeGaze({ x: targetX, y: targetY });
        }
        scheduleNextGazeShift();
      }, delay);
    };

    scheduleNextGazeShift();
    return () => {
      if (gazeTimerRef.current) clearTimeout(gazeTimerRef.current);
    };
  }, [isCurrentlySpeaking, isListening, isThinking]);

  // SVG Paths for realistic viseme mouth shapes
  const mouthPaths = useMemo(() => {
    switch (viseme) {
      case 'open_ah':
        // Wide open vertical mouth with visible teeth and dark oral cavity
        return {
          outer: 'M 40 76 Q 50 71 60 76 Q 60 85 50 87 Q 40 85 40 76 Z',
          inner: 'M 43 77 Q 50 74 57 77 Q 57 83 50 84 Q 43 83 43 77 Z',
          teethUpper: 'M 44 77 Q 50 75 56 77 L 56 79 Q 50 78 44 79 Z',
          teethLower: 'M 45 83 Q 50 82 55 83 L 55 84 Q 50 84.5 45 84 Z'
        };
      case 'wide_ee':
        // Stretched horizontal smile with visible teeth line
        return {
          outer: 'M 37 77 Q 50 73 63 77 Q 63 81 50 82 Q 37 81 37 77 Z',
          inner: 'M 40 77.5 Q 50 75 60 77.5 Q 60 80 50 80.5 Q 40 80 40 77.5 Z',
          teethUpper: 'M 41 77.5 Q 50 76 59 77.5 L 59 79 Q 50 78 41 79 Z',
          teethLower: 'M 42 79.5 Q 50 79 58 79.5 L 58 80.5 Q 50 80.5 42 80.5 Z'
        };
      case 'round_oo':
        // Rounded circular lips (whistling / "oo" / "who")
        return {
          outer: 'M 44 75 Q 50 72 56 75 Q 57 84 50 85 Q 43 84 44 75 Z',
          inner: 'M 46 76 Q 50 74 54 76 Q 55 82 50 83 Q 45 82 46 76 Z',
          teethUpper: 'M 47 76.5 Q 50 75.5 53 76.5 L 53 77.5 Q 50 77 47 77.5 Z',
          teethLower: null
        };
      case 'closed_mbp':
        // Closed pressed lips (m, b, p)
        return {
          outer: 'M 40 78 Q 50 77 60 78 Q 50 80 40 78 Z',
          inner: null,
          teethUpper: null,
          teethLower: null
        };
      case 'f_v':
        // Upper teeth touching lower lip
        return {
          outer: 'M 39 77 Q 50 74 61 77 Q 61 81 50 82 Q 39 81 39 77 Z',
          inner: 'M 42 77.5 Q 50 75.5 58 77.5 Q 58 79.5 50 80 Q 42 79.5 42 77.5 Z',
          teethUpper: 'M 43 77.5 Q 50 76 57 77.5 L 57 79.5 Q 50 78.5 43 79.5 Z',
          teethLower: null
        };
      case 'th_s':
        // Sibilant: teeth visible with subtle tongue tip
        return {
          outer: 'M 39 77 Q 50 74 61 77 Q 61 82 50 83 Q 39 82 39 77 Z',
          inner: 'M 41 77.5 Q 50 75.5 59 77.5 Q 59 81 50 81.5 Q 41 81 41 77.5 Z',
          teethUpper: 'M 42 77.5 Q 50 76 58 77.5 L 58 79 Q 50 78 42 79 Z',
          teethLower: 'M 43 80 Q 50 79.5 57 80 L 57 81 Q 50 81 43 81 Z'
        };
      case 'rest':
      default:
        // Gentle relaxed natural micro-smile
        return {
          outer: 'M 40 78 Q 50 76.5 60 78 Q 50 80.5 40 78 Z',
          inner: null,
          teethUpper: null,
          teethLower: null
        };
    }
  }, [viseme]);

  // Eyebrow vertical shifts based on expression
  const eyebrowTransform = useMemo(() => {
    if (isThinking) return 'translate(0, -1.8) rotate(-2 50 40)';
    if (isListening) return 'translate(0, -1.2)';
    if (isCurrentlySpeaking && viseme === 'open_ah') return 'translate(0, -1.5)';
    return 'translate(0, 0)';
  }, [isThinking, isListening, isCurrentlySpeaking, viseme]);

  // Head tilt for active listening / thinking
  const headRotation = useMemo(() => {
    if (isListening) return 'rotate(2.5 50 50)';
    if (isThinking) return 'rotate(-2.5 50 50)';
    return 'rotate(0 50 50)';
  }, [isListening, isThinking]);

  return (
    <div className={`relative flex flex-col items-center justify-center select-none ${className}`}>
      {/* Outer Glow / Halo Rings */}
      <div className="relative group">
        {/* Pulsing Acoustic Glow Ring */}
        {isCurrentlySpeaking && (
          <>
            <span className="absolute -inset-2.5 rounded-full bg-gradient-to-tr from-[#ff8c21]/40 via-amber-400/30 to-orange-500/40 blur-md animate-pulse pointer-events-none" />
            <span className="absolute -inset-4 rounded-full border-2 border-[#ff8c21]/30 animate-ping opacity-40 pointer-events-none" />
          </>
        )}

        {/* Listening Ring */}
        {isListening && (
          <>
            <span className="absolute -inset-2.5 rounded-full bg-emerald-500/30 blur-md animate-pulse pointer-events-none" />
            <span className="absolute -inset-4 rounded-full border-2 border-emerald-400/50 animate-ping opacity-60 pointer-events-none" />
          </>
        )}

        {/* Thinking Ring */}
        {isThinking && (
          <span className="absolute -inset-2 rounded-full border-2 border-indigo-400/60 animate-spin border-dashed pointer-events-none" />
        )}

        {/* Circular Avatar Frame Button */}
        <button
          type="button"
          onClick={onAvatarClick}
          title={`Click to interact with ${tutorName} (or say "${wakeWord}")`}
          className={`relative overflow-hidden flex items-center justify-center h-28 w-28 sm:h-36 sm:w-36 md:h-40 md:w-40 lg:h-44 lg:w-44 rounded-full bg-gradient-to-b from-[#1c293e] to-[#0f172a] border-2 sm:border-[2.5px] cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95 shadow-2xl focus:outline-none ${
            isCurrentlySpeaking
              ? 'border-[#ff8c21] ring-4 ring-[#ff8c21]/20 shadow-[0_0_35px_rgba(255,140,33,0.45)]'
              : isListening
                ? 'border-emerald-400 ring-4 ring-emerald-500/20 shadow-[0_0_35px_rgba(16,185,129,0.4)]'
                : isThinking
                  ? 'border-indigo-400 ring-4 ring-indigo-500/20 shadow-[0_0_30px_rgba(99,102,241,0.35)]'
                  : 'border-[#2d3f5e] hover:border-[#ff8c21]/70'
          }`}
        >
          {/* Subtle Studio Backdrop Lighting */}
          <div className="absolute inset-0 bg-radial from-blue-500/10 via-transparent to-transparent pointer-events-none" />

          {/* SVG Vector Human Tutor with Micro-Breathing Float */}
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full transform transition-transform duration-500 ease-out"
            style={{
              transform: `${headRotation} translateY(${isCurrentlySpeaking ? Math.sin(Date.now() / 300) * 0.8 : 0}px)`
            }}
          >
            <defs>
              {/* Natural Skin Gradient */}
              <linearGradient id="skinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f8d5b8" />
                <stop offset="65%" stopColor="#efc19c" />
                <stop offset="100%" stopColor="#dda57f" />
              </linearGradient>

              {/* Cheeks Warmth */}
              <radialGradient id="blushGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
              </radialGradient>

              {/* Hair Gradient */}
              <linearGradient id="hairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2c1e19" />
                <stop offset="50%" stopColor="#1e130f" />
                <stop offset="100%" stopColor="#150d0a" />
              </linearGradient>

              {/* Eye Iris Gradient */}
              <radialGradient id="irisGrad" cx="40%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#4f759b" />
                <stop offset="60%" stopColor="#1d3557" />
                <stop offset="100%" stopColor="#0b1b2d" />
              </radialGradient>

              {/* Shirt / Blazer Gradient */}
              <linearGradient id="blazerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="50%" stopColor="#0f172a" />
                <stop offset="100%" stopColor="#090d16" />
              </linearGradient>
            </defs>

            {/* Shoulders & Professional Shirt / Collar */}
            <g id="body">
              {/* Suit / Blazer */}
              <path d="M 12 100 C 14 86 28 84 36 82 L 44 87 L 50 93 L 56 87 L 64 82 C 72 84 86 86 88 100 Z" fill="url(#blazerGrad)" />
              {/* Shirt V-Neck */}
              <path d="M 43 83 L 50 94 L 57 83 L 54 78 L 46 78 Z" fill="#ffffff" />
              {/* Neck */}
              <path d="M 45 68 L 45 81 C 47 83 53 83 55 81 L 55 68 Z" fill="#dda57f" />
              {/* Neck Shadow under chin */}
              <path d="M 45 68 Q 50 73 55 68 L 55 72 Q 50 75 45 72 Z" fill="#c48a66" opacity="0.6" />
            </g>

            {/* Head & Face Contour */}
            <g id="head">
              {/* Ears */}
              <ellipse cx="28" cy="51" rx="4" ry="6.5" fill="#efc19c" />
              <ellipse cx="72" cy="51" rx="4" ry="6.5" fill="#efc19c" />
              <ellipse cx="28.5" cy="51" rx="2" ry="4" fill="#dda57f" opacity="0.6" />
              <ellipse cx="71.5" cy="51" rx="2" ry="4" fill="#dda57f" opacity="0.6" />

              {/* Face Shape */}
              <path
                d="M 31 43 C 30 58 35 73 50 73 C 65 73 70 58 69 43 C 69 31 63 26 50 26 C 37 26 31 31 31 43 Z"
                fill="url(#skinGrad)"
              />

              {/* Soft Warm Blush on Cheeks */}
              <circle cx="37" cy="56" r="6" fill="url(#blushGrad)" />
              <circle cx="63" cy="56" r="6" fill="url(#blushGrad)" />

              {/* Eyebrows with State Transformation */}
              <g id="eyebrows" style={{ transform: eyebrowTransform, transition: 'transform 0.25s ease' }}>
                {/* Left Eyebrow */}
                <path d="M 36 41 Q 42 38 47 41" stroke="#2c1e19" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                {/* Right Eyebrow */}
                <path d="M 53 41 Q 58 38 64 41" stroke="#2c1e19" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              </g>

              {/* Eyes with Realistic Blinking and Gaze Saccades */}
              <g id="eyes">
                {isBlinking ? (
                  // Closed Eyelid during blink
                  <>
                    <path d="M 35 48 Q 41 51 47 48" stroke="#331e17" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                    <path d="M 53 48 Q 59 51 65 48" stroke="#331e17" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                  </>
                ) : (
                  // Open Eyes with Saccade Gaze
                  <>
                    {/* Left Eye White & Contour */}
                    <path d="M 35 48 Q 41 43 47 48 Q 41 52.5 35 48 Z" fill="#ffffff" />
                    <path d="M 35 48 Q 41 43 47 48" stroke="#2b1a13" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                    {/* Left Pupil + Iris */}
                    <circle cx={41 + eyeGaze.x} cy={48 + eyeGaze.y} r="3.2" fill="url(#irisGrad)" />
                    <circle cx={41 + eyeGaze.x} cy={48 + eyeGaze.y} r="1.6" fill="#05070a" />
                    {/* Eye Catchlight Reflection */}
                    <circle cx={40 + eyeGaze.x} cy={47 + eyeGaze.y} r="0.9" fill="#ffffff" opacity="0.9" />

                    {/* Right Eye White & Contour */}
                    <path d="M 53 48 Q 59 43 65 48 Q 59 52.5 53 48 Z" fill="#ffffff" />
                    <path d="M 53 48 Q 59 43 65 48" stroke="#2b1a13" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                    {/* Right Pupil + Iris */}
                    <circle cx={59 + eyeGaze.x} cy={48 + eyeGaze.y} r="3.2" fill="url(#irisGrad)" />
                    <circle cx={59 + eyeGaze.x} cy={48 + eyeGaze.y} r="1.6" fill="#05070a" />
                    {/* Eye Catchlight Reflection */}
                    <circle cx={58 + eyeGaze.x} cy={47 + eyeGaze.y} r="0.9" fill="#ffffff" opacity="0.9" />
                  </>
                )}
              </g>

              {/* Nose Contour */}
              <g id="nose">
                <path d="M 49 46 L 48.5 56 Q 50 58.5 51.5 56" stroke="#c98a65" strokeWidth="1.1" strokeLinecap="round" fill="none" />
                <ellipse cx="47.5" cy="56.5" rx="0.8" ry="0.6" fill="#b37855" opacity="0.7" />
                <ellipse cx="52.5" cy="56.5" rx="0.8" ry="0.6" fill="#b37855" opacity="0.7" />
              </g>

              {/* DYNAMIC VISEME MOUTH (LIP-SYNC) */}
              <g id="mouth" className="transition-all duration-100 ease-out">
                {/* Lip Contour / Base */}
                <path d={mouthPaths.outer} fill="#be5349" />

                {/* Oral Cavity Interior */}
                {mouthPaths.inner && (
                  <path d={mouthPaths.inner} fill="#450d11" />
                )}

                {/* Upper Teeth */}
                {mouthPaths.teethUpper && (
                  <path d={mouthPaths.teethUpper} fill="#ffffff" opacity="0.92" />
                )}

                {/* Lower Teeth */}
                {mouthPaths.teethLower && (
                  <path d={mouthPaths.teethLower} fill="#ffffff" opacity="0.88" />
                )}

                {/* Natural Lip Gloss Highlight */}
                <path d="M 43 78.5 Q 50 80 57 78.5" stroke="#fca5a5" strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.6" />
              </g>

              {/* Styled Professional Hair */}
              <g id="hair">
                <path
                  d="M 31 38 C 29 23 40 18 50 18 C 61 18 71 23 69 38 C 72 35 73 44 71 49 C 68 37 66 31 59 29 C 52 27 41 29 38 34 C 36 36 33 45 29 49 C 27 44 28 35 31 38 Z"
                  fill="url(#hairGrad)"
                />
                {/* Hair strands shine */}
                <path d="M 40 22 Q 50 20 58 24" stroke="#4a352c" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
              </g>
            </g>
          </svg>

          {/* Audio Waveform overlay at bottom of avatar during speech */}
          {isCurrentlySpeaking && (
            <div className="absolute bottom-2 inset-x-0 flex items-center justify-center gap-1 pointer-events-none">
              <span className="w-1 bg-[#ff8c21] rounded-full animate-bounce h-3" style={{ animationDelay: '0ms' }} />
              <span className="w-1 bg-amber-300 rounded-full animate-bounce h-5" style={{ animationDelay: '150ms' }} />
              <span className="w-1 bg-[#ff8c21] rounded-full animate-bounce h-4" style={{ animationDelay: '300ms' }} />
              <span className="w-1 bg-amber-400 rounded-full animate-bounce h-2" style={{ animationDelay: '450ms' }} />
            </div>
          )}

          {/* Quick Call / Status Badge */}
          <span
            className={`absolute bottom-1 right-1 h-7 w-7 rounded-full text-white flex items-center justify-center text-xs shadow-md border-2 border-[#182337] group-hover:scale-110 transition-transform ${
              isCurrentlySpeaking
                ? 'bg-[#ff8c21] text-white animate-pulse'
                : isListening
                  ? 'bg-emerald-500 text-white animate-ping'
                  : isThinking
                    ? 'bg-indigo-500 text-white'
                    : 'bg-[#ff8c21]'
            }`}
            title="Interactive Voice Avatar"
          >
            {isCurrentlySpeaking ? '🔊' : isListening ? '🎙️' : isThinking ? '⚡' : '🎙️'}
          </span>
        </button>
      </div>

      {/* ARIA AI TUTOR Pill Badge & Call Hint */}
      <div className="mt-3 sm:mt-4 flex flex-col items-center gap-1.5 select-none">
        <button
          type="button"
          onClick={onAvatarClick}
          className={`px-4 py-1 rounded-full border shadow-sm cursor-pointer transition flex items-center gap-1.5 ${
            isCurrentlySpeaking
              ? 'bg-[#ff8c21]/15 border-[#ff8c21]/70'
              : isListening
                ? 'bg-emerald-500/15 border-emerald-500/70'
                : isThinking
                  ? 'bg-indigo-500/15 border-indigo-500/70'
                  : 'bg-[#131d2e] border-[#2a3952] hover:border-[#ff8c21]/60'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isCurrentlySpeaking
                ? 'bg-[#ff8c21] animate-pulse'
                : isListening
                  ? 'bg-emerald-400 animate-ping'
                  : isThinking
                    ? 'bg-indigo-400 animate-spin'
                    : 'bg-[#ff8c21]'
            }`}
          />
          <span
            className={`text-xs sm:text-[13px] font-extrabold tracking-wider uppercase ${
              isCurrentlySpeaking
                ? 'text-[#ff8c21]'
                : isListening
                  ? 'text-emerald-400'
                  : isThinking
                    ? 'text-indigo-400'
                    : 'text-[#ff8c21]'
            }`}
          >
            {isCurrentlySpeaking ? `${tutorName} SPEAKING` : isListening ? 'LISTENING TO YOU...' : isThinking ? 'THINKING...' : `${tutorName} AI TUTOR`}
          </span>
        </button>
        <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium">
          {isListening ? (
            <span className="text-emerald-300 font-semibold animate-pulse">Speak your question now...</span>
          ) : (
            <>
              Click avatar or say <strong className="text-slate-200">"{wakeWord}"</strong> to interrupt
            </>
          )}
        </span>
      </div>
    </div>
  );
}
