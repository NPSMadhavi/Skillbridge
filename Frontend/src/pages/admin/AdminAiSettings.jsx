import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { containsWakeWord } from '../../services/voiceTutorService';

export default function AdminAiSettings() {
  const [aiName, setAiName] = useState('ARIA');
  const [wakeWord, setWakeWord] = useState('Hey ARIA');
  const [voiceGender, setVoiceGender] = useState('FEMALE');
  const [voiceRate, setVoiceRate] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(1.0);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Live Wake Word Tester states
  const [testingMic, setTestingMic] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isPlayingSample, setIsPlayingSample] = useState(false);
  const [playingGender, setPlayingGender] = useState(null);
  const recognitionRef = useRef(null);

  // Load existing settings
  useEffect(() => {
    let isMounted = true;
    api.getAiSettings()
      .then((data) => {
        if (isMounted && data) {
          setAiName(data.aiName || 'ARIA');
          setWakeWord(data.wakeWord || `Hey ${data.aiName || 'ARIA'}`);
          setVoiceGender(data.aiVoiceGender || 'FEMALE');
          setVoiceRate(data.aiVoiceRate ?? 1.0);
          setVoicePitch(data.aiVoicePitch ?? 1.0);
          setCompanyName(data.companyName || '');
        }
      })
      .catch((err) => {
        console.error('Failed to load AI settings:', err);
        if (isMounted) {
          setStatusMessage({ type: 'error', text: 'Failed to load company AI settings.' });
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      stopMicTest();
      stopAllAudio();
    };
  }, []);

  const audioRef = useRef(null);

  const stopAllAudio = () => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch (_) { }
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) { }
    }
  };

  // Auto-dismiss success notification
  useEffect(() => {
    if (statusMessage?.type === 'success') {
      const timer = setTimeout(() => setStatusMessage(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const handleAiNameChange = (val) => {
    setAiName(val);
    const trimmed = val.trim();
    setWakeWord(trimmed ? `Hey ${trimmed}` : 'Hey ARIA');
  };

  const handleSelectSuggested = (name) => {
    setAiName(name);
    setWakeWord(`Hey ${name}`);
  };

  // Helper to select the highest quality natural/neural browser voice
  const getBestNaturalVoice = (voices, gender) => {
    if (!voices || voices.length === 0) return null;
    const enVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const isMale = String(gender).toUpperCase() === 'MALE';

    if (isMale) {
      return (
        enVoices.find((v) => {
          const n = v.name.toLowerCase();
          return (n.includes('natural') || n.includes('neural') || n.includes('online')) &&
            (n.includes('guy') || n.includes('christopher') || n.includes('ryan') || n.includes('andrew') || n.includes('brian'));
        }) ||
        enVoices.find((v) => v.name.toLowerCase().includes('google') && v.name.toLowerCase().includes('male')) ||
        enVoices.find((v) => v.name.toLowerCase().includes('natural') && !v.name.toLowerCase().includes('female')) ||
        enVoices.find((v) => (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('george')) && !v.name.toLowerCase().includes('david')) ||
        enVoices.find((v) => v.name.toLowerCase().includes('david')) ||
        enVoices[0]
      );
    } else {
      return (
        enVoices.find((v) => {
          const n = v.name.toLowerCase();
          return (n.includes('natural') || n.includes('neural') || n.includes('online')) &&
            (n.includes('jenny') || n.includes('ava') || n.includes('emma') || n.includes('aria') || n.includes('sonia'));
        }) ||
        enVoices.find((v) => v.name.toLowerCase().includes('google us english') || v.name.toLowerCase().includes('google uk english female')) ||
        enVoices.find((v) => v.name.toLowerCase().includes('google') && !v.name.toLowerCase().includes('male')) ||
        enVoices.find((v) => (v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('neural')) && !v.name.toLowerCase().includes('guy') && !v.name.toLowerCase().includes('male')) ||
        enVoices.find((v) => (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('samantha')) && !v.name.toLowerCase().includes('zira')) ||
        enVoices.find((v) => v.name.toLowerCase().includes('zira')) ||
        enVoices[0]
      );
    }
  };

  const playBrowserNaturalVoice = (text, gender, onEnd) => {
    try {
      if (!window.speechSynthesis) {
        onEnd();
        return;
      }

      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = voiceRate;
      utter.pitch = voicePitch;

      const voices = window.speechSynthesis.getVoices() || [];
      if (voices.length > 0) {
        const bestVoice = getBestNaturalVoice(voices, gender);
        if (bestVoice) {
          utter.voice = bestVoice;
        }
      }

      utter.onend = onEnd;
      utter.onerror = onEnd;

      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('Browser speech error:', e);
      onEnd();
    }
  };

  // Play realistic AI Voice Sample (Studio Neural Audio with Browser Natural Fallback)
  const playVoiceSample = async (targetGender = null) => {
    stopAllAudio();

    const effectiveGender = targetGender || voiceGender;
    const currentName = aiName.trim() || 'ARIA';
    const sampleText = `Hello! I am ${currentName}, your personal AI tutor. Say "${wakeWord || `Hey ${currentName}`}" anytime to ask me questions!`;

    setIsPlayingSample(true);
    setPlayingGender(effectiveGender);

    const onPlayFinish = () => {
      setIsPlayingSample(false);
      setPlayingGender(null);
    };

    // 1. Primary Engine: Studio Neural AI Voice (Edge/Azure Neural Audio)
    try {
      const audioUrl = api.getTtsAudioUrl(sampleText, {
        gender: effectiveGender,
        rate: voiceRate,
        pitch: voicePitch,
      });

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = onPlayFinish;
      audio.onerror = () => {
        console.warn('Neural audio stream unavailable, using browser natural voice fallback');
        playBrowserNaturalVoice(sampleText, effectiveGender, onPlayFinish);
      };

      await audio.play();
      return;
    } catch (err) {
      console.warn('Neural audio error, falling back:', err);
    }

    // 2. Fallback Engine: Browser Natural Neural Voice
    playBrowserNaturalVoice(sampleText, effectiveGender, onPlayFinish);
  };

  const handleSelectVoiceGender = (gender) => {
    setVoiceGender(gender);
    playVoiceSample(gender);
  };

  // Interactive Live Wake Word Mic Test
  const startMicTest = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatusMessage({
        type: 'error',
        text: 'Microphone recognition is not supported in this browser. Please use Chrome or Edge.',
      });
      return;
    }

    try {
      stopMicTest();
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      setTestingMic(true);
      setTestResult(null);
      setInterimTranscript('');

      rec.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        setInterimTranscript(transcript);

        const currentName = aiName.trim() || 'ARIA';
        const currentWake = wakeWord.trim() || `Hey ${currentName}`;

        if (containsWakeWord(transcript, currentWake, currentName)) {
          setTestResult({
            success: true,
            recognized: transcript,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          });
        }
      };

      rec.onerror = (e) => {
        if (e.error !== 'no-speech') {
          console.warn('Mic test error:', e.error);
        }
      };

      rec.onend = () => {
        if (testingMic) {
          try { rec.start(); } catch { }
        }
      };

      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      console.error('Failed to start speech recognition test:', err);
      setStatusMessage({ type: 'error', text: 'Failed to access microphone for testing.' });
      setTestingMic(false);
    }
  };

  const stopMicTest = () => {
    setTestingMic(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch { }
      recognitionRef.current = null;
    }
  };

  // Save Settings
  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    const cleanName = aiName.trim() || 'ARIA';
    const cleanWake = wakeWord.trim() || `Hey ${cleanName}`;

    try {
      const res = await api.updateAiSettings({
        aiName: cleanName,
        wakeWord: cleanWake,
        aiVoiceGender: voiceGender,
        aiVoiceName: voiceGender === 'MALE' ? 'en-US-GuyNeural' : 'en-US-JennyNeural',
        aiVoiceRate: parseFloat(voiceRate),
        aiVoicePitch: parseFloat(voicePitch),
      });

      setStatusMessage({
        type: 'success',
        text: res.message || 'AI settings updated successfully.',
      });

      const currentSession = JSON.parse(sessionStorage.getItem('skillbridge_admin') || '{}');
      sessionStorage.setItem('skillbridge_admin', JSON.stringify({
        ...currentSession,
        aiName: cleanName,
        wakeWord: cleanWake,
      }));
    } catch (err) {
      console.error('Save AI settings error:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to save AI settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <svg className="animate-spin h-5 w-5 text-orange" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-sm font-medium">Loading settings…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise-in space-y-4 w-full pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-fg sm:text-2xl">
            AI Tutor Settings
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            Configure the AI tutor name, activation phrase, and voice delivery{companyName ? ` for ${companyName}` : ''}.
          </p>
        </div>
      </div>

      {/* In-page Feedback Banner */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-medium transition-all ${statusMessage.type === 'success'
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border border-rose-200 bg-rose-50 text-rose-800'
            }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-xs text-muted hover:text-fg transition-colors cursor-pointer px-1 py-0.5 rounded"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* Section 1: AI Tutor Identity & Wake Phrase */}
        <section className="rounded-xl border border-line bg-panel p-4 shadow-xs">
          <div className="mb-3.5 pb-2.5 border-b border-line/60">
            <h2 className="font-display text-xs font-bold text-fg uppercase tracking-wider">
              Identity & Activation
            </h2>
          </div>

          <div className="grid gap-3.5 md:grid-cols-2">
            {/* AI Name Input */}
            <div className="space-y-1.5">
              <label htmlFor="aiTutorName" className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                AI Tutor Name
              </label>
              <input
                id="aiTutorName"
                type="text"
                required
                placeholder="e.g. ARIA"
                value={aiName}
                onChange={(e) => handleAiNameChange(e.target.value)}
                className="w-full rounded-lg border border-line bg-ink/50 px-3 py-2 text-xs font-medium text-fg outline-none transition placeholder:text-muted/60 focus:bg-panel focus:border-navy focus:shadow-[0_0_0_2px_rgba(14,47,92,0.08)]"
              />
            </div>

            {/* Wake Word Input & Live Mic Action */}
            <div className="space-y-1.5">
              <label htmlFor="wakePhrase" className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Wake Phrase
              </label>
              <input
                id="wakePhrase"
                type="text"
                required
                placeholder={`e.g. Hey ${aiName.trim() || 'ARIA'}`}
                value={wakeWord}
                onChange={(e) => setWakeWord(e.target.value)}
                className="w-full rounded-lg border border-line bg-ink/50 px-3 py-2 text-xs font-medium text-fg outline-none transition placeholder:text-muted/60 focus:bg-panel focus:border-navy focus:shadow-[0_0_0_2px_rgba(14,47,92,0.08)]"
              />

              {/* Mic Test Controls */}
              <div className="pt-0.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={testingMic ? stopMicTest : startMicTest}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${testingMic
                    ? 'bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100'
                    : 'border border-line bg-ink hover:bg-slate-200 text-fg'
                    }`}
                >
                  <svg className={`w-3 h-3 ${testingMic ? 'text-rose-600 animate-pulse' : 'text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <span>{testingMic ? 'Stop Test' : 'Test Mic'}</span>
                </button>

                {testingMic && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-navy font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    Listening for &ldquo;{wakeWord}&rdquo;
                  </span>
                )}

                {testResult && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-medium text-emerald-800">
                    <svg className="w-2.5 h-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Recognized: &ldquo;{testResult.recognized}&rdquo;
                  </span>
                )}
              </div>

              {testingMic && interimTranscript && (
                <p className="text-[10px] font-mono text-muted truncate">
                  Heard: &ldquo;{interimTranscript}&rdquo;
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Voice Persona & Characteristics */}
        <section className="rounded-xl border border-line bg-panel p-4 shadow-xs">
          <div className="mb-3.5 pb-2.5 border-b border-line/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xs font-bold text-fg uppercase tracking-wider">
                Voice & Delivery
              </h2>
            </div>
            <button
              type="button"
              onClick={playVoiceSample}
              disabled={isPlayingSample}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line bg-ink hover:bg-slate-200 text-[11px] font-medium text-fg transition cursor-pointer disabled:opacity-50"
            >
              <svg className={`w-3 h-3 text-orange ${isPlayingSample ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              <span>{isPlayingSample ? 'Playing sample…' : 'Play Greeting Sample'}</span>
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Voice Gender Selection */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted block">
                Voice Tone
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSelectVoiceGender('FEMALE')}
                  className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${voiceGender === 'FEMALE'
                    ? 'border-orange bg-orange/5 ring-1 ring-orange/30'
                    : 'border-line bg-ink/30 hover:border-sky/40'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-xs text-fg">Female</div>
                    {playingGender === 'FEMALE' && (
                      <span className="flex items-center gap-0.5 text-[10px] text-orange font-semibold animate-pulse">
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        Playing
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted mt-0.5">Warm, lifelike &amp; natural</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectVoiceGender('MALE')}
                  className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${voiceGender === 'MALE'
                    ? 'border-orange bg-orange/5 ring-1 ring-orange/30'
                    : 'border-line bg-ink/30 hover:border-sky/40'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-xs text-fg">Male</div>
                    {playingGender === 'MALE' && (
                      <span className="flex items-center gap-0.5 text-[10px] text-orange font-semibold animate-pulse">
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        Playing
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted mt-0.5">Articulate, human &amp; grounded</div>
                </button>
              </div>
            </div>

            {/* Sliders */}
            <div className="space-y-3">
              {/* Speech Rate */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-muted">
                  <span className="uppercase tracking-wider">Speech Rate</span>
                  <span className="font-mono text-fg font-bold">{voiceRate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  value={voiceRate}
                  onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                  className="w-full accent-orange cursor-pointer h-1.5"
                />
                <div className="flex justify-between text-[9px] text-muted">
                  <span>0.8x (Slower)</span>
                  <span>1.0x (Normal)</span>
                  <span>1.3x (Faster)</span>
                </div>
              </div>

              {/* Voice Pitch */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-muted">
                  <span className="uppercase tracking-wider">Voice Pitch</span>
                  <span className="font-mono text-fg font-bold">{voicePitch.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  value={voicePitch}
                  onChange={(e) => setVoicePitch(parseFloat(e.target.value))}
                  className="w-full accent-orange cursor-pointer h-1.5"
                />
                <div className="flex justify-between text-[9px] text-muted">
                  <span>0.8x (Lower)</span>
                  <span>1.0x (Natural)</span>
                  <span>1.2x (Higher)</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Submit Button */}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-orange px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-orange/25 transition hover:brightness-105 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Saving…</span>
              </>
            ) : (
              <span>Save AI Settings</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
