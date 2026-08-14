import { useMemo, useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import logo from '../assets/SkillBridge_AI.png'

const PythonLogo = ({ className = "h-5 w-5" }) => (
  <svg className={className} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M63.35 4C35.03 4 36.43 16.3 36.43 16.3L36.48 29.07H64.08V32.96H24.79C24.79 32.96 4 30.64 4 58.91C4 87.18 22.09 85.8 22.09 85.8L32.86 85.8V70.66C32.86 70.66 32.35 52.48 50.84 52.48H77.94C77.94 52.48 91.73 52.92 91.73 39.19V16.3C91.73 16.3 94.61 4 63.35 4ZM48.65 13.06C51.5 13.06 53.82 15.38 53.82 18.23C53.82 21.08 51.5 23.4 48.65 23.4C45.8 23.4 43.48 21.08 43.48 18.23C43.48 15.38 45.8 13.06 48.65 13.06Z" fill="white" />
    <path d="M64.65 124C92.97 124 91.57 111.7 91.57 111.7L91.52 98.93H63.92V95.04H103.21C103.21 95.04 124 97.36 124 69.09C124 40.82 105.91 42.2 105.91 42.2L95.14 42.2V57.34C95.14 57.34 95.65 75.52 77.16 75.52H50.06C50.06 75.52 36.27 75.08 36.27 88.81V111.7C36.27 111.7 33.39 124 64.65 124ZM79.35 114.94C76.5 114.94 74.18 112.62 74.18 109.77C74.18 106.92 76.5 104.6 79.35 104.6C82.2 104.6 84.52 106.92 84.52 109.77C84.52 112.62 82.2 114.94 79.35 114.94Z" fill="white" opacity="0.9" />
  </svg>
)

const CoursePlayer = ({
  course,
  initialCompletedLessonId,
  initialAutoPlayNext,
  initialNextLessonId,
  onExit,
  onAssessment
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Retrieve user details from sessionStorage
  const user = useMemo(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James Lee', email: 'user@skillbridge.com' }
    } catch {
      return { fullName: 'James Lee', email: 'user@skillbridge.com' }
    }
  }, [])

  // Save last played course ID
  useEffect(() => {
    if (course?.id) {
      try {
        const userId = user?.id || user?.finNumber || user?.email || 'guest';
        localStorage.setItem(`skillbridge_last_played_${userId}`, String(course.id));
        localStorage.setItem('skillbridge_last_played', String(course.id));
      } catch (e) { }
    }
  }, [course?.id, user]);

  const userInitials = useMemo(() => {
    if (!user.fullName) return 'JL'
    const parts = user.fullName.trim().split(' ')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return user.fullName.substring(0, 2).toUpperCase()
  }, [user])

  const userId = useMemo(() => {
    return user?.id || user?.finNumber || user?.email || 'guest';
  }, [user]);

  const storageKey = useMemo(() => {
    return `skillbridge_progress_${userId}_${course?.id}`
  }, [course?.id, userId])

  const [completedLessons, setCompletedLessons] = useState(() => {
    const init = {}
    if (initialCompletedLessonId) {
      init[initialCompletedLessonId] = true
    }
    if (course?.lessons) {
      course.lessons.forEach(l => {
        if (l.status === 'done') init[l.id] = true
      })
    }
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          parsed.forEach(id => { init[id] = true })
        }
      }
    } catch (e) {
      console.warn('Failed to parse localStorage course progress:', e)
    }
    return init
  })

  const markLessonCompleted = (lessonId) => {
    setCompletedLessons(prev => {
      const updated = { ...prev, [lessonId]: true }
      const completedArray = Object.keys(updated).map(id => isNaN(id) ? id : Number(id))
      try {
        localStorage.setItem(storageKey, JSON.stringify(completedArray))
      } catch (e) { }

      if (course?.id) {
        const lessonsCount = course.lessons?.length || 5;
        const calcPct = Math.round((completedArray.length / lessonsCount) * 100);
        const isDone = completedArray.length >= lessonsCount;
        api.saveCourseProgress(course.id, {
          completedLessonId: lessonId,
          completedLessonIds: completedArray,
          progress: calcPct,
          completed: isDone
        }).catch(err => console.warn('Failed to save course progress to DB:', err.message))
      }
      return updated
    })
  }

  // Fetch DB progress on mount and sync with local state
  useEffect(() => {
    if (course?.id) {
      api.getCourseProgress(course.id)
        .then(res => {
          if (res.completedLessonIds && Array.isArray(res.completedLessonIds)) {
            setCompletedLessons(prev => {
              const updated = { ...prev }
              res.completedLessonIds.forEach(id => { updated[id] = true })
              try {
                localStorage.setItem(storageKey, JSON.stringify(Object.keys(updated).map(Number)))
              } catch (e) { }
              return updated
            })
          }
        })
        .catch(err => {
          console.warn('Failed to fetch user course progress from DB:', err.message)
        })
    }
  }, [course?.id, storageKey])

  const [activeLessonId, setActiveLessonId] = useState(() => {
    if (initialAutoPlayNext && initialNextLessonId) {
      return initialNextLessonId
    }
    return course?.lessons.find((lesson) => lesson.status === 'active')?.id || course?.lessons[0]?.id
  })

  const [playing, setPlaying] = useState(Boolean(initialAutoPlayNext))
  const [explanation, setExplanation] = useState('')
  const [loadingExplanation, setLoadingExplanation] = useState(false)
  const [loadingQuiz, setLoadingQuiz] = useState(false)

  // Teaching slide states
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState(0)

  // Chat states (English initial message)
  const [chatMessages, setChatMessages] = useState([
    { sender: 'aria', text: "Hello! I am ARIA, your personal AI tutor. Ask me any question about this lesson and I will explain it for you!" }
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Video / Slide player controls states
  const playerRef = useRef(null)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1.25)
  const [showCC, setShowCC] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = () => {
    if (!playerRef.current) return
    if (!document.fullscreenElement) {
      playerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(console.warn)
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(console.warn)
    }
  }

  // Voice recording & Continuous Always-On Hands-Free states
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [handsFreeVoice, setHandsFreeVoice] = useState(true)
  const [voiceStatusText, setVoiceStatusText] = useState('')
  const [isAriaSpeaking, setIsAriaSpeaking] = useState(false)

  const wasPlayingRef = useRef(false)
  const isAnsweringRef = useRef(false)
  const recognitionRef = useRef(null)

  // Effect to handle auto-play next lesson when coming back from assessment
  useEffect(() => {
    if (initialCompletedLessonId) {
      markLessonCompleted(initialCompletedLessonId)
    }
    if (initialAutoPlayNext && initialNextLessonId) {
      setActiveLessonId(initialNextLessonId)
      setPlaying(true)
    }
  }, [initialCompletedLessonId, initialAutoPlayNext, initialNextLessonId])

  const preferredLanguage = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('skillbridge_language')
      if (raw) {
        const parsed = JSON.parse(raw)
        const code = (parsed?.code || '').toUpperCase()
        if (code === 'ZH') return 'Chinese (中文)'
        if (code === 'MS') return 'Malay (Bahasa Melayu)'
        if (code === 'TA') return 'Tamil (தமிழ்)'
        if (code === 'BN') return 'Bangla (বাংলা)'
        if (code === 'EN') return 'English'
        if (parsed?.name) return parsed.name
      }
      const userRaw = sessionStorage.getItem('skillbridge_user')
      if (userRaw) {
        const u = JSON.parse(userRaw)?.user
        const lang = (u?.preferredLanguage || '').toLowerCase()
        if (lang === 'zh') return 'Chinese (中文)'
        if (lang === 'ms') return 'Malay (Bahasa Melayu)'
        if (lang === 'ta') return 'Tamil (தமிழ்)'
        if (lang === 'bn') return 'Bangla (বাংলা)'
        if (lang === 'en') return 'English'
      }
    } catch (e) { }
    return 'English'
  }, [])

  const preferredVoiceLangCode = useMemo(() => {
    const l = preferredLanguage.toLowerCase()
    if (l.includes('chinese') || l.includes('zh') || l.includes('中文')) return 'zh'
    if (l.includes('malay') || l.includes('ms') || l.includes('melayu')) return 'ms'
    if (l.includes('tamil') || l.includes('ta') || l.includes('தமிழ்')) return 'ta'
    if (l.includes('bangla') || l.includes('bn') || l.includes('বাংলা') || l.includes('bengali')) return 'bn'
    return 'en'
  }, [preferredLanguage])

  const selectVoiceForLanguage = (voices, langPrefix) => {
    if (!voices || voices.length === 0) return null
    let match = voices.find(v => v.lang.toLowerCase().startsWith(langPrefix))
    if (!match && langPrefix === 'ms') {
      match = voices.find(v => v.lang.toLowerCase().startsWith('id'))
    }
    return match || voices.find(v => v.lang.startsWith('en')) || voices[0]
  }

  const speakAriaAnswer = (text, onEndCallback) => {
    if (!text) {
      setIsAriaSpeaking(false)
      onEndCallback?.()
      return
    }
    try {
      window.speechSynthesis.cancel()
      setIsAriaSpeaking(true)
      const cleanText = text
        .replace(/###/g, '')
        .replace(/####/g, '')
        .replace(/\*\*/g, '')
        .replace(/- /g, '')
        .replace(/---/g, '')
      const utterance = new SpeechSynthesisUtterance(cleanText)
      const voices = window.speechSynthesis.getVoices()
      const matchedVoice = selectVoiceForLanguage(voices, preferredVoiceLangCode)
      if (matchedVoice) utterance.voice = matchedVoice
      utterance.rate = 0.95
      utterance.pitch = 1.05

      utterance.onend = () => {
        setIsAriaSpeaking(false)
        onEndCallback?.()
      }
      utterance.onerror = () => {
        setIsAriaSpeaking(false)
        onEndCallback?.()
      }

      window.speechSynthesis.speak(utterance)
    } catch (e) {
      console.warn('Speech synthesis failed:', e)
      setIsAriaSpeaking(false)
      onEndCallback?.()
    }
  }

  const WAKE_WORDS = ['aria', 'hey aria', 'hi aria', 'ok aria', 'arya', 'area', 'ariya', 'ask aria']

  const containsWakeWord = (text) => {
    if (!text) return false
    const lower = text.toLowerCase()
    return WAKE_WORDS.some(w => lower.includes(w))
  }

  const extractQuestionFromWakeWord = (text) => {
    let clean = text.trim()
    const regex = /^(hey|hi|ok|hello|ask)?\s*(aria|arya|area|ariya)[\s,.:!?-]*/i
    clean = clean.replace(regex, '').trim()
    if (!clean || clean.length < 2) {
      clean = text.replace(/aria|arya|area|ariya/gi, '').trim()
    }
    return clean || text
  }

  const handleVoiceQuestion = async (userSpeech, isManual = false) => {
    if (!userSpeech || isAnsweringRef.current) return
    const rawSpeech = userSpeech.trim()
    if (rawSpeech.length < 2) return

    // For automated continuous mic listening, require the wake word "Aria"!
    if (!isManual && !containsWakeWord(rawSpeech)) {
      console.log(`[Hands-Free Listener] Speech ignored (no "Aria" wake word): "${rawSpeech}"`)
      return
    }

    // Extract actual question removing "Aria" wake word prefix
    const cleanQuestion = isManual ? rawSpeech : extractQuestionFromWakeWord(rawSpeech)
    if (!cleanQuestion || cleanQuestion.length < 2) return

    isAnsweringRef.current = true

    // Remember whether course lecture was playing before question
    const wasPlaying = playing || wasPlayingRef.current
    wasPlayingRef.current = wasPlaying

    // 1. Immediately pause course lecture & cancel lecture speech synthesis
    window.speechSynthesis.cancel()
    setPlaying(false)
    setVoiceStatusText(`✨ "Aria" Detected! Pausing lecture to answer: "${cleanQuestion}"`)

    // Quick voice navigation commands
    const lower = cleanQuestion.toLowerCase()
    if (lower === 'pause' || lower === 'pause lecture' || lower === 'stop') {
      setVoiceStatusText('⏸️ Lecture paused by voice command.')
      isAnsweringRef.current = false
      return
    }
    if (lower === 'resume' || lower === 'continue' || lower === 'play') {
      setPlaying(true)
      setVoiceStatusText('▶️ Lecture resumed by voice command.')
      isAnsweringRef.current = false
      setTimeout(() => setVoiceStatusText(''), 2000)
      return
    }

    // 2. Add user question to ARIA Chat feed
    setChatMessages((prev) => [...prev, { sender: 'user', text: cleanQuestion }])
    setChatLoading(true)

    try {
      // Get answer from ARIA AI Tutor in preferred language
      const chatRes = await api.chatWithTutor(course.id, {
        message: cleanQuestion,
        lessonTitle: activeLesson?.title,
        language: preferredLanguage
      })
      const ariaAnswer = chatRes.text || chatRes.reply
      setChatMessages((prev) => [...prev, { sender: 'aria', text: ariaAnswer }])
      setVoiceStatusText('🤖 ARIA is answering your question...')

      // 4. Speak ARIA answer aloud and auto-resume course lecture when done!
      speakAriaAnswer(ariaAnswer, () => {
        isAnsweringRef.current = false
        if (wasPlaying) {
          setVoiceStatusText('▶️ Resuming course lecture...')
          setTimeout(() => {
            setPlaying(true)
            setVoiceStatusText('')
          }, 800)
        } else {
          setVoiceStatusText('')
        }
      })
    } catch (err) {
      console.error('Hands-free chat error:', err)
      setChatMessages((prev) => [...prev, { sender: 'aria', text: '⚠️ Failed to answer question via AI Tutor.' }])
      isAnsweringRef.current = false
      if (wasPlaying) {
        setPlaying(true)
      }
      setVoiceStatusText('')
    } finally {
      setChatLoading(false)
    }
  }

  // Continuous Always-On Microphone Effect
  useEffect(() => {
    if (!handsFreeVoice) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch (e) { }
        recognitionRef.current = null
      }
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    let rec
    try {
      rec = new SpeechRecognition()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = 'en-US'

      rec.onresult = (event) => {
        const lastIndex = event.results.length - 1
        const result = event.results[lastIndex]
        if (result && result.isFinal) {
          const transcript = result[0].transcript.trim()
          if (transcript && !isAnsweringRef.current) {
            handleVoiceQuestion(transcript, false)
          }
        }
      }

      rec.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('Hands-free speech recognition notice:', event.error)
        }
      }

      rec.onend = () => {
        if (handsFreeVoice && recognitionRef.current === rec) {
          setTimeout(() => {
            try { rec.start() } catch (e) { }
          }, 400)
        }
      }

      rec.start()
      recognitionRef.current = rec
    } catch (e) {
      console.warn('Continuous SpeechRecognition initialization notice:', e)
    }

    return () => {
      if (rec) {
        try { rec.stop() } catch (e) { }
      }
    }
  }, [handsFreeVoice, activeLessonId])

  const startMediaRecorderFallback = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' })
        stream.getTracks().forEach((track) => track.stop())

        setChatLoading(true)
        try {
          const res = await api.transcribeSpeech(audioBlob)
          if (res.text && res.text.trim()) {
            handleVoiceQuestion(res.text.trim(), true)
          } else {
            setChatMessages((prev) => [...prev, {
              sender: 'aria',
              text: '⚠️ Could not transcribe audio speech. Please check microphone or type your question below.'
            }])
          }
        } catch (err) {
          console.error('Voice input error:', err)
        } finally {
          setChatLoading(false)
        }
      }

      recorder.start()
      setMediaRecorder(recorder)
      setRecording(true)
    } catch (err) {
      console.error('Failed to access microphone:', err)
      alert('Microphone access is required to use voice input.')
    }
  }

  const toggleRecording = async () => {
    if (recording) {
      if (mediaRecorder) {
        if (typeof mediaRecorder.stop === 'function') {
          mediaRecorder.stop()
        }
        setRecording(false)
      }
      return
    }

    // Instantly pause lecture playback and stop speech synthesis so microphone records clearly!
    wasPlayingRef.current = playing
    window.speechSynthesis.cancel()
    setPlaying(false)
    setVoiceStatusText('🎙️ Listening... Speak your question to ARIA')

    // Stop continuous recognition if active to avoid collision
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch (e) { }
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition()
        recognition.continuous = false
        recognition.interimResults = false
        recognition.lang = 'en-US'

        recognition.onstart = () => {
          setRecording(true)
        }

        recognition.onresult = async (event) => {
          setRecording(false)
          const transcript = event.results[0][0].transcript
          if (transcript && transcript.trim()) {
            handleVoiceQuestion(transcript.trim(), true)
          }
        }

        recognition.onerror = (event) => {
          setRecording(false)
          startMediaRecorderFallback()
        }

        recognition.onend = () => {
          setRecording(false)
        }

        recognition.start()
        setMediaRecorder(recognition)
        return
      } catch (e) {
        console.warn('SpeechRecognition failed to start, using MediaRecorder fallback:', e)
      }
    }

    startMediaRecorderFallback()
  }




  const activeLesson = useMemo(
    () => course?.lessons.find((lesson) => lesson.id === activeLessonId) || course?.lessons[0],
    [course, activeLessonId],
  )

  useEffect(() => {
    if (course && activeLesson) {
      setLoadingExplanation(true)
      setExplanation('')
      api.getLessonExplanation(course.id, activeLesson.id, activeLesson.title, preferredLanguage)
        .then(res => {
          setExplanation(res.explanation)
          setLoadingExplanation(false)
        })
        .catch(err => {
          console.error('Failed to load dynamic lesson explanation:', err)
          setExplanation('Frontend: Client-side logic (React, HTML/CSS, JavaScript)\nBackend: Server-side logic (Node.js, Express, API routes)\nDatabase: Storing data (SQL vs NoSQL, schema design)')
          setLoadingExplanation(false)
        })
    }
  }, [course, activeLessonId, preferredLanguage])

  // Helper to clean raw text for Speech TTS (removes hashtags, markdown symbols, and emojis that TTS speaks out loud)
  const cleanForSpeech = (text) => {
    if (!text) return ''
    return text
      .replace(/#+/g, '')
      .replace(/[\*_~`]+/g, '')
      .replace(/^[-\*•➔>+:\s]+/, '')
      .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Helper to clean raw text for Chalkboard Display (removes #, ###, markdown symbols)
  const cleanForBoard = (text) => {
    if (!text) return ''
    return text
      .replace(/^[#*•➔>+-\s]+/, '')
      .replace(/#+/g, '')
      .replace(/[\*_~`]+/g, '')
      .trim()
  }

  const sentences = useMemo(() => {
    if (!explanation) return ['Welcome to this lecture. We will explore key concepts step by step.']
    const lines = explanation
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => cleanForBoard(s))
      .filter(s => s.length > 3)

    return lines.length > 0 ? lines : ['Welcome to this lecture.']
  }, [explanation])

  const REAL_PLAY_DURATIONS = ['01:45', '02:10', '01:50', '02:15', '01:30'];

  const getRealLessonDurationStr = (lesson, expText, idx = 0) => {
    if (expText && expText.length > 40) {
      const words = expText.split(/\s+/).length;
      const secs = Math.max(60, Math.min(240, Math.round(words / 2.2)));
      const m = Math.floor(secs / 60).toString().padStart(2, '0');
      const s = Math.floor(secs % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    }

    if (lesson?.duration) {
      const str = String(lesson.duration).trim();
      if (str.includes(':')) {
        const parts = str.split(':').map(p => parseInt(p, 10) || 0);
        const totalSecs = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (totalSecs > 0 && totalSecs <= 300) {
          const m = Math.floor(totalSecs / 60).toString().padStart(2, '0');
          const s = Math.floor(totalSecs % 60).toString().padStart(2, '0');
          return `${m}:${s}`;
        }
      }
    }

    return REAL_PLAY_DURATIONS[idx % REAL_PLAY_DURATIONS.length];
  };

  const parseDurationSeconds = (durationStr) => {
    if (!durationStr) return 105;
    if (typeof durationStr === 'number') return durationStr;

    const str = String(durationStr).trim();
    if (str.includes(':')) {
      const parts = str.split(':').map(p => parseInt(p, 10) || 0);
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    } else if (str.toLowerCase().includes('m')) {
      const num = parseInt(str, 10);
      if (!isNaN(num)) return num * 60;
    }
    const parsed = parseInt(str, 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : 105;
  };

  const activeRealDurationStr = useMemo(() => {
    const idx = course?.lessons?.findIndex(l => l.id === activeLesson?.id) ?? 0;
    return getRealLessonDurationStr(activeLesson, explanation, idx >= 0 ? idx : 0);
  }, [activeLesson, explanation, course?.lessons]);

  const totalSeconds = useMemo(() => {
    return parseDurationSeconds(activeRealDurationStr);
  }, [activeRealDurationStr]);

  const formattedTimeString = useMemo(() => {
    let currentSeconds = 0;
    if (sentences.length > 0) {
      currentSeconds = Math.min(
        totalSeconds,
        Math.round(((currentSentenceIdx) / Math.max(1, sentences.length)) * totalSeconds)
      );
    }
    const fmt = (s) => {
      const mins = Math.floor(s / 60).toString().padStart(2, '0');
      const secs = Math.floor(s % 60).toString().padStart(2, '0');
      return `${mins}:${secs}`;
    };
    return `${fmt(currentSeconds)} / ${fmt(totalSeconds)}`;
  }, [currentSentenceIdx, sentences.length, totalSeconds]);

  const utteranceRef = useRef(null);

  const handleTogglePlay = () => {
    if (!playing) {
      if (currentSentenceIdx >= sentences.length - 1 || currentSentenceIdx >= sentences.length) {
        setCurrentSentenceIdx(0);
      }
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      } catch (e) { }
      setPlaying(true);
    } else {
      try {
        window.speechSynthesis.cancel();
      } catch (e) { }
      setPlaying(false);
    }
  };

  // Key takeaways bullet points for Transcript Box
  const lectureNotesList = useMemo(() => {
    if (!explanation) {
      return [
        'Frontend: Client-side logic (React, HTML/CSS, JavaScript)',
        'Backend: Server-side logic (Node.js, Express, API routes)',
        'Database: Storing data (SQL vs NoSQL, schema design)'
      ]
    }
    const lines = explanation.split('\n').map(l => cleanForBoard(l)).filter(l => l.length > 5)
    if (lines.length >= 3) return lines.slice(0, 4)
    return [
      'Frontend: Client-side logic (React, HTML/CSS, JavaScript)',
      'Backend: Server-side logic (Node.js, Express, API routes)',
      'Database: Storing data (SQL vs NoSQL, schema design)'
    ]
  }, [explanation])

  // Reset indices when lesson changes
  useEffect(() => {
    window.speechSynthesis.cancel()
    setCurrentSentenceIdx(0)
  }, [activeLessonId])

  // Speech TTS handler with clean speech text
  useEffect(() => {
    if (playing && !muted && sentences.length > 0) {
      let isCancelled = false;

      const speak = (idx) => {
        if (isCancelled) return;
        if (idx >= sentences.length) {
          setPlaying(false);
          setCurrentSentenceIdx(0);
          if (activeLesson?.id) {
            markLessonCompleted(activeLesson.id);
          }
          return;
        }

        const spokenText = cleanForSpeech(sentences[idx]);
        if (!spokenText) {
          if (idx + 1 < sentences.length) {
            setCurrentSentenceIdx(idx + 1);
            speak(idx + 1);
          }
          return;
        }

        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.resume();
          const utterance = new SpeechSynthesisUtterance(spokenText);
          utteranceRef.current = utterance; // Prevent GC cancellation bug

          const voices = window.speechSynthesis.getVoices();
          const matchedVoice = selectVoiceForLanguage(voices, preferredVoiceLangCode);
          if (matchedVoice) utterance.voice = matchedVoice;
          utterance.rate = 0.95 * (playbackRate || 1.0);
          utterance.pitch = 1.05;

          utterance.onend = () => {
            if (isCancelled) return;
            setCurrentSentenceIdx((prev) => {
              const next = prev + 1;
              speak(next);
              return next;
            });
          };

          utterance.onerror = (e) => {
            if (e?.error === 'canceled' || e?.error === 'interrupted') return;
            console.warn('Speech synthesis error:', e);
            if (isCancelled) return;
            setTimeout(() => {
              setCurrentSentenceIdx((prev) => {
                const next = prev + 1;
                speak(next);
                return next;
              });
            }, 400);
          };

          window.speechSynthesis.speak(utterance);
        } catch (e) {
          console.warn('Speech synthesis failed:', e);
        }
      };

      speak(currentSentenceIdx);

      return () => {
        isCancelled = true;
        try { window.speechSynthesis.cancel(); } catch (e) { }
      };
    } else {
      try { window.speechSynthesis.cancel(); } catch (e) { }
    }
  }, [playing, muted, playbackRate, sentences, currentSentenceIdx]);

  const overallProgressPercentage = useMemo(() => {
    if (!course?.lessons || course.lessons.length === 0) return 0
    const completedCount = Object.keys(completedLessons).length
    return Math.min(100, Math.round((completedCount / course.lessons.length) * 100)) || 50
  }, [completedLessons, course?.lessons])

  if (!course) return null

  const handleTakeChapterAssessment = async () => {
    setLoadingQuiz(true)
    markLessonCompleted(activeLesson.id)

    const currentIdx = course.lessons.findIndex(l => l.id === activeLesson.id)
    const nextLesson = course.lessons[currentIdx + 1]
    const nextLessonId = nextLesson ? nextLesson.id : null

    try {
      const quizRes = await api.getLessonQuiz(course.id, activeLesson.id, activeLesson.title, preferredLanguage)
      setLoadingQuiz(false)
      onAssessment?.(course, activeLesson, quizRes.quiz, nextLessonId)
    } catch (err) {
      console.warn('RAG quiz generation fallback:', err)
      setLoadingQuiz(false)
      onAssessment?.(course, activeLesson, null, nextLessonId)
    }
  }

  const handleSendChat = (e) => {
    e.preventDefault()
    if (!chatInput.trim() || chatLoading) return

    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { sender: 'user', text: userMsg }])
    setChatLoading(true)

    api.chatWithTutor(course.id, { message: userMsg, lessonTitle: activeLesson?.title, language: preferredLanguage })
      .then(res => {
        const ariaAnswer = res.text || res.reply
        setChatMessages(prev => [...prev, { sender: 'aria', text: ariaAnswer }])
        speakAriaAnswer(ariaAnswer)
        setChatLoading(false)
      })
      .catch(err => {
        console.error('Chat tutor error:', err)
        setChatMessages(prev => [...prev, { sender: 'aria', text: '⚠️ Sorry, I failed to process that request. Is the AI endpoint online?' }])
        setChatLoading(false)
      })
  }

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-[#f4f7fc] text-[#0f172a] select-none flex flex-col font-sans">
      {/* Top Navbar Header (Commented out as requested)
      <header className="shrink-0 z-40 w-full border-b border-[#e5eaf2] bg-white px-6 py-2.5 shadow-xs">
        <div className="flex h-12 w-full items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onExit}
              className="flex items-center border-0 bg-transparent p-0 transition hover:opacity-90 cursor-pointer"
            >
              <img src={logo} alt="SkillBridge" className="h-8 w-auto object-contain" />
            </button>
          </div>

          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex cursor-pointer items-center justify-center h-9 w-9 rounded-full bg-[#1b253b] text-white font-bold text-xs shadow-sm transition hover:brightness-110"
            >
              {userInitials}
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-52 origin-top-right rounded-xl border border-slate-200 bg-white p-2 shadow-lg ring-1 ring-black/5 z-50">
                <div className="px-3 py-2 border-b border-slate-100 text-xs text-slate-500">
                  Signed in as <br />
                  <strong className="text-slate-800 truncate block font-semibold">{user.email || user.fullName}</strong>
                </div>
                <button
                  type="button"
                  onClick={onExit}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50 border-0 bg-transparent mt-1"
                >
                  Exit Course
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      */}

      {/* Sub-header Navigation */}
      <div className="shrink-0 w-full px-4 pt-2 pb-1">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 transition border-0 bg-transparent p-0 cursor-pointer"
        >
          <span className="text-base">←</span> Back
        </button>
      </div>

      {/* Main 3-Column Grid Layout - Enlarged Center Player, Narrowed Left & Right */}
      <main className="w-full px-4 pb-3 grid grid-cols-1 lg:grid-cols-[240px_1fr_260px] gap-3 flex-1 min-h-0 overflow-hidden">

        {/* LEFT COLUMN: Course Card & Modules List (Narrow 240px) */}
        <section className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs flex flex-col h-full min-h-0 overflow-hidden">
          {/* Course Info Header Box */}
          <div className="shrink-0 space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-[#2563eb] text-white flex items-center justify-center shadow-xs">
                <PythonLogo className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xs font-bold text-slate-900 leading-snug truncate">{course.title}</h1>
                <p className="text-[11px] text-slate-400 font-medium">{course.lessons?.length || 5} Modules</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="flex items-center gap-2 pt-0.5">
              <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#ff8c21] transition-all duration-300"
                  style={{ width: `${overallProgressPercentage}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-slate-500">{overallProgressPercentage}%</span>
            </div>
          </div>

          <hr className="shrink-0 border-slate-100 my-2.5" />

          {/* Course Content Section */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <h2 className="shrink-0 text-xs font-bold text-slate-900 mb-2">Course Content</h2>

            <ul className="space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-0.5">
              {course.lessons.map((lesson, index) => {
                const isActive = lesson.id === activeLesson?.id
                const isCompleted = Boolean(completedLessons[lesson.id] || lesson.status === 'done')
                const isUnlocked = index === 0 || isCompleted || Boolean(completedLessons[course.lessons[index - 1]?.id])

                return (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      disabled={!isUnlocked}
                      onClick={() => isUnlocked && setActiveLessonId(lesson.id)}
                      className={`w-full flex items-center gap-2 p-2.5 rounded-xl border text-left transition cursor-pointer ${isActive
                        ? 'bg-[#eff6ff] border-slate-200 shadow-2xs font-semibold'
                        : isCompleted
                          ? 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                          : 'bg-slate-50/60 border-slate-100 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed'
                        }`}
                    >
                      {/* Left Icon Badge */}
                      <span
                        className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${isActive
                          ? 'bg-[#2563eb] text-white shadow-xs'
                          : isCompleted
                            ? 'bg-[#22c55e] text-white'
                            : 'bg-slate-200 text-slate-400'
                          }`}
                      >
                        {isActive ? '▶' : isCompleted ? '✓' : '🔒'}
                      </span>

                      {/* Lesson Details */}
                      <div className="min-w-0 flex-1">
                        <p className={`text-[11px] leading-snug truncate ${isActive ? 'font-bold text-slate-900' : 'font-medium text-slate-800'}`}>
                          {lesson.title}
                        </p>
                        <p className="text-[10px] text-slate-400 font-normal mt-0.5">
                          {getRealLessonDurationStr(lesson, lesson.id === activeLesson?.id ? explanation : null, index)}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        {/* CENTER COLUMN: ENLARGED Video/Slide Play Screen */}
        <section className="flex flex-col h-full min-h-0 overflow-hidden gap-2">
          {/* Active Lesson Header & Hands-Free Status Banner */}
          <div className="shrink-0 flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900 leading-snug truncate">
              {activeLesson?.title || 'Introduction to Full stack web development'}
            </h2>
            {voiceStatusText && (
              <div className="shrink-0 bg-[#0ea5e9]/10 border border-[#0ea5e9]/30 text-[#0284c7] rounded-xl px-3 py-1 text-xs font-bold flex items-center gap-2 animate-pulse">
                <span>{voiceStatusText}</span>
                <button
                  type="button"
                  onClick={() => setVoiceStatusText('')}
                  className="text-slate-400 hover:text-slate-700 text-xs font-bold border-0 bg-transparent cursor-pointer p-0"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* ENLARGED CENTER LECTURE SLIDE VIDEO PLAYER UI WITH Sleek CONTROL BAR */}
          <div ref={playerRef} className="flex-1 min-h-0 bg-[#0f172a] text-white rounded-2xl border border-slate-800 shadow-md relative overflow-hidden flex flex-col justify-between">
            <style>{`
              @keyframes pulse-glow {
                0%, 100% { transform: scale(1); filter: drop-shadow(0 0 16px rgba(245,130,32,0.35)); }
                50% { transform: scale(1.04); filter: drop-shadow(0 0 28px rgba(245,130,32,0.60)); }
              }
              @keyframes wave-bar {
                0%, 100% { height: 8px; }
                50% { height: 30px; }
              }
              .avatar-active {
                animation: pulse-glow 2s infinite ease-in-out;
              }
              .wave-line {
                animation: wave-bar 1.2s ease-in-out infinite;
              }
              .wave-line:nth-child(2) { animation-delay: 0.15s; }
              .wave-line:nth-child(3) { animation-delay: 0.3s; }
              .wave-line:nth-child(4) { animation-delay: 0.1s; }
              .wave-line:nth-child(5) { animation-delay: 0.25s; }
            `}</style>

            <div className="p-5 flex flex-col flex-1 min-h-0 justify-between">
              {/* Slide Top Header Bar */}
              <div className="shrink-0 flex items-center justify-between border-b border-white/10 pb-2.5 mb-2 text-xs tracking-widest text-slate-400 uppercase font-bold">
                <span>🎓 LECTURE SLIDE</span>
                <span className="text-[#ff8c21]">
                  {sentences.length > 0 ? `CONCEPT ${currentSentenceIdx + 1} OF ${sentences.length}` : 'CONCEPT 1 OF 15'}
                </span>
              </div>

              {/* Split Content: Presentation Slide (Left) & ARIA Tutor Avatar (Right) */}
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-5 items-center my-1">
                {/* Left Presentation Chalkboard Container */}
                <div className="md:col-span-7 bg-[#0b1329] rounded-2xl border-2 border-slate-700/80 p-4 sm:p-5 h-full flex flex-col justify-between overflow-hidden shadow-2xl relative">
                  {/* Blackboard Top Header */}
                  <div className="shrink-0 flex items-center justify-between border-b border-slate-700/80 pb-2 mb-2">
                    <span className="text-[11px] font-bold text-[#ff8c21] tracking-wider uppercase flex items-center gap-1.5 truncate max-w-[70%]">
                      <span>📌</span> {activeLesson?.title || 'Lecture Concepts'}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                      NOTE {currentSentenceIdx + 1} / {sentences.length}
                    </span>
                  </div>

                  {/* Interactive Board Notes List (Teacher explaining concept by concept) */}
                  <div className="flex-1 min-h-0 space-y-2.5 overflow-y-auto pr-1 text-left my-1">
                    {sentences.slice(0, currentSentenceIdx + 1).map((sentenceText, sIdx) => {
                      const isCurrent = sIdx === currentSentenceIdx
                      const cleanedText = cleanForBoard(sentenceText)

                      return (
                        <div
                          key={sIdx}
                          className={`p-3 rounded-xl transition-all duration-300 ${isCurrent
                            ? 'bg-[#ff8c21]/15 border-l-4 border-[#ff8c21] shadow-xs text-white'
                            : 'bg-slate-800/40 border-l-2 border-slate-600/50 text-slate-300 opacity-75'
                            }`}
                        >
                          <p className="text-xs sm:text-sm leading-relaxed font-medium flex items-start gap-2">
                            <span className={`text-xs mt-0.5 shrink-0 ${isCurrent ? 'text-[#ff8c21] font-bold' : 'text-slate-500'}`}>
                              {isCurrent ? '▶' : '•'}
                            </span>
                            <span>{cleanedText}</span>
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Right ARIA Tutor Circle Avatar */}
                <div className="md:col-span-5 h-full flex flex-col items-center justify-center text-center border-t md:border-t-0 md:border-l border-white/10 pt-3 md:pt-0 md:pl-3">
                  <div className={`relative flex items-center justify-center h-32 w-32 sm:h-36 sm:w-36 rounded-full border-4 ${playing ? 'border-[#ff8c21] bg-[#ff8c21]/10 avatar-active' : 'border-slate-700 bg-slate-800/80'} transition-all duration-300 shadow-xl`}>
                    <span className="text-6xl">🤖</span>
                    {playing && (
                      <span className="absolute -inset-1.5 rounded-full border border-[#ff8c21]/50 animate-ping opacity-40" />
                    )}
                  </div>

                  <span className="mt-3.5 inline-flex rounded-full bg-slate-800/90 border border-slate-700 px-3.5 py-1 text-[11px] font-bold text-[#ff8c21] uppercase tracking-wider">
                    ARIA AI TUTOR
                  </span>

                  {playing ? (
                    <div className="flex items-end gap-1.5 h-6 mt-3">
                      <span className="w-1.5 bg-[#ff8c21] rounded-full wave-line h-2" />
                      <span className="w-1.5 bg-[#ff8c21] rounded-full wave-line h-5" />
                      <span className="w-1.5 bg-[#ff8c21] rounded-full wave-line h-2" />
                      <span className="w-1.5 bg-[#ff8c21] rounded-full wave-line h-4" />
                      <span className="w-1.5 bg-[#ff8c21] rounded-full wave-line h-2" />
                    </div>
                  ) : (
                    <p className="mt-2.5 text-xs text-slate-400 font-medium">Click play to start lecture</p>
                  )}
                </div>
              </div>

              {/* Subtitle Caption Overlay */}
              {showCC && (
                <div className="shrink-0 bg-[#040814]/90 backdrop-blur-md rounded-lg py-2 px-4 border border-white/10 mt-2 text-center">
                  <p className="text-xs sm:text-sm text-white font-medium leading-relaxed italic truncate">
                    {playing ? `ARIA: "${cleanForBoard(sentences[currentSentenceIdx])}"` : 'Lecture paused.'}
                  </p>
                </div>
              )}
            </div>

            {/* SLEEK DARK BLUE VIDEO PLAYER CONTROL BAR (ATTACHED IMAGE STYLE) */}
            <div className="shrink-0 bg-[#081a38] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 select-none">
              {/* Left Controls: Play/Pause, Volume/Mute, Timestamp */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="text-white hover:text-[#ff8c21] transition cursor-pointer border-0 bg-transparent p-0 flex items-center justify-center"
                  title={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMuted(v => !v)
                    if (!muted) window.speechSynthesis.cancel()
                  }}
                  className="text-white hover:text-[#ff8c21] transition cursor-pointer border-0 bg-transparent p-0 flex items-center justify-center ml-1"
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted ? (
                    <svg className="h-5 w-5 fill-current text-slate-400" viewBox="0 0 24 24">
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                </button>

                <span className="text-xs font-mono font-medium text-slate-200 tracking-wider select-none ml-1">
                  {formattedTimeString}
                </span>
              </div>

              {/* Center Timeline Scrubber */}
              <div
                className="flex-1 min-w-[100px] max-w-md mx-2 h-1.5 bg-slate-700/80 rounded-full cursor-pointer relative overflow-hidden group"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const clickX = e.clientX - rect.left
                  const pct = clickX / rect.width
                  const newIdx = Math.min(sentences.length - 1, Math.max(0, Math.floor(pct * sentences.length)))
                  setCurrentSentenceIdx(newIdx)
                }}
              >
                <div
                  className="h-full bg-white rounded-full transition-all duration-200 group-hover:bg-[#ff8c21]"
                  style={{ width: `${Math.min(100, Math.round(((currentSentenceIdx) / Math.max(1, sentences.length)) * 100))}%` }}
                />
              </div>

              {/* Right Controls: Speed, CC, Fullscreen, Assessment Button */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const rates = [1.0, 1.25, 1.5, 2.0]
                    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length
                    setPlaybackRate(rates[nextIdx])
                  }}
                  className="text-xs font-bold text-slate-200 hover:text-white bg-slate-800/80 hover:bg-slate-700 px-2 py-0.5 rounded transition cursor-pointer border border-white/10"
                  title="Playback Speed"
                >
                  {playbackRate}x
                </button>

                <button
                  type="button"
                  onClick={() => setShowCC(v => !v)}
                  className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border transition cursor-pointer ${showCC ? 'bg-white text-[#081a38] border-white' : 'bg-transparent text-slate-400 border-slate-600 hover:text-white'
                    }`}
                  title="Toggle Captions"
                >
                  CC
                </button>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="text-slate-200 hover:text-white transition cursor-pointer border-0 bg-transparent p-0 flex items-center justify-center"
                  title="Fullscreen"
                >
                  <svg className="h-4 w-4 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </button>

                {/* Retained Assessment Button */}
                <button
                  type="button"
                  onClick={handleTakeChapterAssessment}
                  disabled={loadingQuiz}
                  className="cursor-pointer rounded-lg bg-[#ff8c21] hover:bg-[#e87a15] px-3 py-1.5 text-xs font-bold text-white border-0 transition shadow-sm flex items-center gap-1.5 disabled:opacity-50 ml-1"
                >
                  {loadingQuiz ? '⚡ Assessment...' : '⚡ Take Assessment'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Ask ARIA Chat Panel (Narrow 260px) */}
        <section className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs flex flex-col h-full min-h-0 overflow-hidden">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-[#fff0e6] border border-orange-100 text-[#ff8c21] flex items-center justify-center font-bold text-sm shadow-2xs">
                <svg className="h-4 w-4 fill-[#ff8c21]" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-[#0f1b2d]">Ask ARIA</h3>
            </div>

            <button
              type="button"
              onClick={() => setHandsFreeVoice(v => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold border transition cursor-pointer ${handsFreeVoice
                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 shadow-2xs'
                : 'bg-slate-100 text-slate-400 border-slate-200'
                }`}
              title="Toggle Always-Listening Voice Assistant"
            >
              <span className={`h-2 w-2 rounded-full ${handsFreeVoice ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`} />
              {handsFreeVoice ? 'Always-On Mic' : 'Mic Off'}
            </button>
          </div>

          {/* Chat Messages Feed */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3.5 my-2.5 pr-0.5">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'aria' && (
                  <div className="h-8 w-8 rounded-full bg-[#fff0e6] border border-orange-100 text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    🤖
                  </div>
                )}

                <div
                  className={`rounded-[18px] px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed max-w-[85%] font-normal shadow-2xs border ${msg.sender === 'user'
                    ? 'bg-[#f0f4f9] text-[#1e293b] border-slate-200/60'
                    : 'bg-[#f0f4f9] text-[#1e293b] border-slate-200/60'
                    }`}
                >
                  {msg.text}
                </div>

                {msg.sender === 'user' && (
                  <div className="h-8 w-8 rounded-full bg-[#fff0e6] border border-orange-100 text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    🤖
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="flex gap-2 items-center text-slate-400 text-xs pl-1">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#ff8c21]/20 border-t-[#ff8c21]" />
                ARIA is typing...
              </div>
            )}
          </div>

          {/* Bottom Chat Input Form */}
          <form onSubmit={handleSendChat} className="shrink-0 flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
            <button
              type="button"
              onClick={toggleRecording}
              title={recording ? 'Stop Voice Input' : 'Start Voice Input'}
              className={`h-8 w-8 shrink-0 grid place-items-center rounded-xl border transition cursor-pointer ${recording
                ? 'bg-red-500 text-white border-red-500 shadow-sm'
                : 'bg-[#f0f4f9] border-slate-200/60 text-[#ff8c21] hover:bg-slate-200/80 shadow-2xs'
                }`}
            >
              {recording ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
              ) : (
                <svg className="h-4 w-4 fill-[#ff8c21]" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              )}
            </button>

            <input
              type="text"
              placeholder="Ask ARIA..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#ff8c21] focus:outline-none transition"
            />

            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading}
              className="h-8 w-8 shrink-0 grid place-items-center rounded-lg bg-[#ff8c21] hover:bg-[#e87a15] text-white border-0 cursor-pointer disabled:opacity-40 shadow-xs transition font-bold text-xs"
            >
              ➔
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}

export default CoursePlayer


