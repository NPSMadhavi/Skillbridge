import { useState, useEffect, useRef } from 'react';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { api } from '../../services/api';
import { containsWakeWord } from '../../services/voiceTutorService';

const SUGGESTED_NAMES = ['ARIA', 'VEDA', 'ALEX', 'JARVIS', 'ATHENA', 'SARA', 'NEXA'];

export default function AdminAiSettings() {
  const [aiName, setAiName] = useState('ARIA');
  const [wakeWord, setWakeWord] = useState('Hey ARIA');
  const [voiceGender, setVoiceGender] = useState('FEMALE');
  const [voiceRate, setVoiceRate] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(1.0);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Live Wake Word Tester states
  const [testingMic, setTestingMic] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState('');
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
          setVoiceRate(data.aiVoiceRate || 1.0);
          setVoicePitch(data.aiVoicePitch || 1.0);
          setCompanyName(data.companyName || '');
        }
      })
      .catch((err) => {
        console.error('Failed to load AI settings:', err);
        toast.error('Failed to load company AI settings.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      stopMicTest();
    };
  }, []);

  // Update wakeWord suggestion when aiName changes if user hasn't typed custom
  const handleAiNameChange = (val) => {
    setAiName(val);
    const trimmed = val.trim();
    if (trimmed) {
      setWakeWord(`Hey ${trimmed}`);
    } else {
      setWakeWord('Hey ARIA');
    }
  };

  const handleSelectSuggested = (name) => {
    setAiName(name);
    setWakeWord(`Hey ${name}`);
  };

  // Test Web Speech Sample
  const playVoiceSample = () => {
    try {
      window.speechSynthesis.cancel();
      const currentName = aiName.trim() || 'ARIA';
      const sampleText = `Hello! I am ${currentName}, your company's personal AI tutor. Say "${wakeWord || `Hey ${currentName}`}" anytime during your course to ask me questions!`;

      const utter = new SpeechSynthesisUtterance(sampleText);
      utter.rate = voiceRate;
      utter.pitch = voicePitch;

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        if (voiceGender === 'MALE') {
          const maleVoice = voices.find(v =>
            v.lang.startsWith('en') &&
            (v.name.toLowerCase().includes('male') ||
             v.name.toLowerCase().includes('guy') ||
             v.name.toLowerCase().includes('george') ||
             v.name.toLowerCase().includes('james'))
          );
          if (maleVoice) utter.voice = maleVoice;
        } else {
          const femaleVoice = voices.find(v =>
            v.lang.startsWith('en') &&
            (v.name.toLowerCase().includes('female') ||
             v.name.toLowerCase().includes('zira') ||
             v.name.toLowerCase().includes('samantha') ||
             v.name.toLowerCase().includes('jenny'))
          );
          if (femaleVoice) utter.voice = femaleVoice;
        }
      }

      window.speechSynthesis.speak(utter);
      toast.info(`Playing sample greeting for ${currentName}...`);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
      toast.error('Unable to play browser speech sample.');
    }
  };

  // Interactive Live Wake Word Mic Test
  const startMicTest = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.warning('Browser SpeechRecognition is not supported in this browser. Please use Chrome/Edge for live mic testing.');
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
            timestamp: new Date().toLocaleTimeString()
          });
          toast.success(`🎉 Wake word recognized: "${transcript}"!`);
        }
      };

      rec.onerror = (e) => {
        if (e.error !== 'no-speech') {
          console.warn('Mic test error:', e.error);
        }
      };

      rec.onend = () => {
        if (testingMic) {
          try { rec.start(); } catch {}
        }
      };

      rec.start();
      recognitionRef.current = rec;
      toast.info(`🎙️ Mic active! Try saying "${wakeWord}" aloud.`);
    } catch (err) {
      console.error('Failed to start speech recognition test:', err);
      toast.error('Failed to access microphone for wake testing.');
      setTestingMic(false);
    }
  };

  const stopMicTest = () => {
    setTestingMic(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
  };

  // Save Settings
  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    const cleanName = aiName.trim() || 'ARIA';
    const cleanWake = wakeWord.trim() || `Hey ${cleanName}`;

    try {
      const res = await api.updateAiSettings({
        aiName: cleanName,
        wakeWord: cleanWake,
        aiVoiceGender: voiceGender,
        aiVoiceName: voiceGender === 'MALE' ? 'Alex' : 'Veda',
        aiVoiceRate: parseFloat(voiceRate),
        aiVoicePitch: parseFloat(voicePitch)
      });

      toast.success(res.message || 'AI setup saved successfully!');

      // Update session storage so immediate UI elements adapt
      const currentSession = JSON.parse(sessionStorage.getItem('skillbridge_admin') || '{}');
      sessionStorage.setItem('skillbridge_admin', JSON.stringify({
        ...currentSession,
        aiName: cleanName,
        wakeWord: cleanWake
      }));
    } catch (err) {
      console.error('Save AI settings error:', err);
      toast.error(err.message || 'Failed to save AI settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center space-x-3 text-slate-500">
          <svg className="animate-spin h-5 w-5 text-[#f06400]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-sm font-medium">Loading AI Tutor configuration…</span>
        </div>
      </div>
    );
  }

  const effectiveName = aiName.trim() || 'ARIA';

  return (
    <div className="animate-rise-in space-y-6 sm:space-y-8 max-w-5xl pb-12 font-sans">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-2 w-fit rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-bold tracking-wider text-[#e05800] uppercase">
          AI ASSISTANT & WAKE WORD SETUP
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f172a]">
          Company AI Tutor Setup
        </h1>
        <p className="text-sm text-slate-500">
          Configure the AI identity and custom wake word for <strong className="text-slate-800">{companyName || 'your organization'}</strong>. Learners will address your AI tutor by this custom name.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Card 1: AI Identity & Wake Word */}
        <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex items-center space-x-3 border-b border-slate-100 pb-5 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-lg">
              🤖
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">
                AI Identity & Activation Word
              </h2>
              <p className="text-xs text-slate-500">
                Default name is ARIA. You can set any custom name your learners will love.
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* AI Name Input */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>AI Tutor Name</span>
                <span className="text-[11px] font-normal text-slate-400">Default: ARIA</span>
              </label>
              <div className="relative rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <input
                  type="text"
                  required
                  placeholder="e.g. ARIA, VEDA, ALEX, JARVIS"
                  value={aiName}
                  onChange={(e) => handleAiNameChange(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[15px] font-semibold text-slate-900 placeholder-slate-400 focus:outline-none"
                />
              </div>
              <p className="text-[11.5px] text-slate-500">
                Learners will see: <strong className="text-blue-600">"{effectiveName} AI Tutor"</strong> across all course lectures.
              </p>

              {/* Quick Select Chips */}
              <div className="pt-2">
                <span className="text-[11px] font-semibold text-slate-400 block mb-1.5 uppercase tracking-wider">
                  Quick Suggestions:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_NAMES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleSelectSuggested(name)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        aiName.toUpperCase() === name
                          ? 'bg-[#f06400] text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Primary Wake Word */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Primary Wake Phrase</span>
                <span className="text-[11px] font-normal text-slate-400">Voice Trigger</span>
              </label>
              <div className="relative rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <input
                  type="text"
                  required
                  placeholder={`e.g. Hey ${effectiveName}`}
                  value={wakeWord}
                  onChange={(e) => setWakeWord(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[15px] font-semibold text-slate-900 placeholder-slate-400 focus:outline-none"
                />
              </div>
              <p className="text-[11.5px] text-slate-500">
                Learners say this during slide playback to pause the lecture and ask questions hands-free.
              </p>

              {/* Multilingual Trigger Preview */}
              <div className="mt-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <span className="text-[11px] font-bold text-slate-600 block mb-1 uppercase tracking-wider">
                  Supported Wake Phrases in All Languages:
                </span>
                <ul className="text-[11.5px] text-slate-600 space-y-1">
                  <li>🇬🇧 <strong>English:</strong> "Hey {effectiveName}", "{effectiveName}", "Hi {effectiveName}", "Hello {effectiveName}"</li>
                  <li>🇨🇳 <strong>Chinese:</strong> "你好 {effectiveName}", "嘿 {effectiveName}"</li>
                  <li>🇲🇾 <strong>Malay:</strong> "Hai {effectiveName}", "Helo {effectiveName}"</li>
                  <li>🇮🇳 <strong>Tamil:</strong> "வணக்கம் {effectiveName}", "ஹாய் {effectiveName}"</li>
                  <li>🇧🇩 <strong>Bangla:</strong> "হ্যালো {effectiveName}", "নমস্কার {effectiveName}"</li>
                  <li>🇮🇳 <strong>Telugu:</strong> "హలో {effectiveName}", "నమస్కారం {effectiveName}", "హే {effectiveName}"</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Card 2: Interactive Live Mic Tester */}
        <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-5 mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-lg">
                🎙️
              </div>
              <div>
                <h2 className="text-base font-bold text-[#0f172a]">
                  Interactive Wake Word Tester
                </h2>
                <p className="text-xs text-slate-500">
                  Test your microphone in real-time to verify wake word recognition for <strong>"{wakeWord}"</strong>.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={testingMic ? stopMicTest : startMicTest}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
                testingMic
                  ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                  : 'bg-blue-600 text-white shadow-[0_4px_12px_rgba(37,99,235,0.25)] hover:bg-blue-700'
              }`}
            >
              <span>{testingMic ? '⏹ Stop Mic Test' : '🎙️ Start Mic Test'}</span>
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 flex flex-col items-center justify-center text-center">
            {testingMic ? (
              <div className="space-y-3">
                <div className="relative mx-auto w-12 h-12 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-30" />
                  <div className="relative w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md">
                    🎙️
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-800">
                  Listening… Speak into your mic: <span className="text-[#f06400]">"{wakeWord}"</span>
                </p>
                {interimTranscript && (
                  <p className="text-xs font-mono bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 max-w-md mx-auto">
                    Live speech: "{interimTranscript}"
                  </p>
                )}
              </div>
            ) : (
              <div className="text-slate-400 text-xs py-2">
                Click <strong>"Start Mic Test"</strong> above and speak your wake phrase to test detection accuracy.
              </div>
            )}

            {testResult && (
              <div className="mt-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2 animate-rise-in">
                <span>✅</span>
                <span>
                  <strong>Wake Word Detected!</strong> Successfully matched "{testResult.recognized}" at {testResult.timestamp}.
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Card 3: Voice Persona & Speech Synthesis */}
        <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex items-center space-x-3 border-b border-slate-100 pb-5 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 border border-purple-200/60 flex items-center justify-center text-lg">
              🔊
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">
                Voice Persona & Delivery
              </h2>
              <p className="text-xs text-slate-500">
                Choose the voice gender and speech characteristics for {effectiveName}.
              </p>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Voice Gender Selection */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                AI Voice Persona
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setVoiceGender('FEMALE')}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                    voiceGender === 'FEMALE'
                      ? 'border-[#f06400] bg-orange-50/60 ring-2 ring-[#f06400]/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-xl mb-1">👩</div>
                  <div className="text-sm font-bold text-slate-900">Female Voice</div>
                  <div className="text-[11px] text-slate-500">Warm, natural, clear tone (e.g. Veda)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setVoiceGender('MALE')}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                    voiceGender === 'MALE'
                      ? 'border-[#f06400] bg-orange-50/60 ring-2 ring-[#f06400]/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-xl mb-1">👨</div>
                  <div className="text-sm font-bold text-slate-900">Male Voice</div>
                  <div className="text-[11px] text-slate-500">Deep, articulate, authoritative tone</div>
                </button>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={playVoiceSample}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors flex items-center space-x-2 cursor-pointer"
                >
                  <span>🔊 Play Greeting Sample</span>
                </button>
              </div>
            </div>

            {/* Speech Rate & Pitch Sliders */}
            <div className="space-y-4 bg-slate-50/70 p-5 rounded-2xl border border-slate-200/80">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold text-slate-700 uppercase tracking-wider">
                  <span>Speech Rate</span>
                  <span className="font-mono text-[#f06400]">{voiceRate}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  value={voiceRate}
                  onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                  className="w-full accent-[#f06400] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>0.8x (Deliberate)</span>
                  <span>1.0x (Normal)</span>
                  <span>1.3x (Brisk)</span>
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-200">
                <div className="flex justify-between text-xs font-bold text-slate-700 uppercase tracking-wider">
                  <span>Voice Pitch</span>
                  <span className="font-mono text-[#f06400]">{voicePitch}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  value={voicePitch}
                  onChange={(e) => setVoicePitch(parseFloat(e.target.value))}
                  className="w-full accent-[#f06400] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>0.8x (Deeper)</span>
                  <span>1.0x (Natural)</span>
                  <span>1.2x (Higher)</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Submit Actions */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="py-3.5 px-6 rounded-2xl bg-[#f06400] hover:bg-[#e05800] active:scale-[0.99] text-white font-semibold text-[14.5px] shadow-[0_8px_20px_rgba(240,100,0,0.28)] transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? (
              <span className="flex items-center space-x-2">
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Saving Setup…</span>
              </span>
            ) : (
              <span>Save AI & Wake Word Setup →</span>
            )}
          </button>
        </div>
      </form>

      <ToastContainer
        position="top-right"
        autoClose={3500}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable
        pauseOnHover
        theme="colored"
      />
    </div>
  );
}
