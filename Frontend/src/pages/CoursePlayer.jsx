import { useMemo, useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import logo from '../assets/SkillBridge_AI.png'

const PythonLogo = ({ className = "h-5 w-5" }) => (
  <svg className={className} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M63.35 4C35.03 4 36.43 16.3 36.43 16.3L36.48 29.07H64.08V32.96H24.79C24.79 32.96 4 30.64 4 58.91C4 87.18 22.09 85.8 22.09 85.8L32.86 85.8V70.66C32.86 70.66 32.35 52.48 50.84 52.48H77.94C77.94 52.48 91.73 52.92 91.73 39.19V16.3C91.73 16.3 94.61 4 63.35 4ZM48.65 13.06C51.5 13.06 53.82 15.38 53.82 18.23C53.82 21.08 51.5 23.4 48.65 23.4C45.8 23.4 43.48 21.08 43.48 18.23C43.48 15.38 45.8 13.06 48.65 13.06Z" fill="white" />
    <path d="M64.65 124C92.97 124 91.57 111.7 91.57 111.7L91.52 98.93H63.92V95.04H103.21C103.21 95.04 124 97.36 124 69.09C124 40.82 105.91 42.2 105.91 42.2L95.14 42.2V57.34C95.14 57.34 95.65 75.52 77.16 75.52H50.06C50.06 75.52 36.27 75.08 36.27 88.81V111.7C36.27 111.7 33.39 124 64.65 124ZM79.35 114.94C76.5 114.94 74.18 112.62 74.18 109.77C74.18 106.92 76.5 104.6 79.35 104.6C82.2 104.6 84.52 106.92 84.52 109.77C84.52 112.62 82.2 114.94 79.35 114.94Z" fill="white" opacity="0.9" />
  </svg>
)

const LANGUAGES = [
  { value: 'en', label: 'English', code: 'EN', native: 'English' },
  { value: 'zh', label: 'Chinese (中文)', code: 'ZH', native: '中文' },
  { value: 'ms', label: 'Malay (Bahasa Melayu)', code: 'MS', native: 'Bahasa Melayu' },
  { value: 'ta', label: 'Tamil (தமிழ்)', code: 'TA', native: 'தமிழ்' },
  { value: 'bn', label: 'Bangla (বাংলা)', code: 'BN', native: 'বাংলা' },
];

const SPEECH_LANGUAGES = {
  en: 'en-US',
  zh: 'zh-CN',
  ms: 'ms-MY',
  ta: 'ta-IN',
  bn: 'bn-BD',
};

const GREETINGS = {
  en: "Hello! I am ARIA, your personal AI tutor. Ask me any question about this lesson and I will explain it for you!",
  zh: "你好！我是 ARIA，你的个人 AI 导师。你可以问我关于本课的任何问题，我会为你解答！",
  ms: "Hai! Saya ARIA, tutor AI peribadi anda. Tanya saya sebarang soalan tentang pelajaran ini dan saya akan menerangkannya untuk anda!",
  ta: "வணக்கம்! நான் ARIA, உங்கள் தனிப்பட்ட AI ஆசிரியர். இந்த பாடம் குறித்த எந்த கேள்வியையும் என்னிடம் கேளுங்கள், நான் உங்களுக்கு விளக்குகிறேன்!",
  bn: "হ্যালো! আমি ARIA, আপনার ব্যক্তিগত AI টিউটর। এই পাঠ সম্পর্কে যে কোনো প্রশ্ন আমাকে জিজ্ঞাসা করুন, আমি আপনাকে বুঝিয়ে দেব!",
};

const normalizeLanguageCode = (pref) => {
  if (!pref) return null;
  const l = String(pref).toLowerCase().trim();
  if (l === 'zh' || l.includes('chinese') || l.includes('中文') || l === 'cn') return 'zh';
  if (l === 'ms' || l.includes('malay') || l.includes('melayu') || l === 'my') return 'ms';
  if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்') || l === 'in') return 'ta';
  if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা') || l === 'bd') return 'bn';
  if (l === 'en' || l.includes('english')) return 'en';
  return null;
};

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

  // Selected teaching language state & persistence - user's preferred language is default
  const [selectedLanguageCode, setSelectedLanguageCode] = useState(() => {
    try {
      // 1. FIRST PRIORITY: Student's registered preferred language
      const userRaw = sessionStorage.getItem('skillbridge_user')
      if (userRaw) {
        const u = JSON.parse(userRaw)?.user
        const code = normalizeLanguageCode(u?.preferredLanguage || u?.preferLanguage)
        if (code) return code
      }

      // 2. SECOND PRIORITY: Saved language from Language Selection page or storage
      const raw = sessionStorage.getItem('skillbridge_language') || localStorage.getItem('skillbridge_language')
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          const code = normalizeLanguageCode(parsed?.value || parsed?.code || parsed?.name)
          if (code) return code
        } catch {
          const code = normalizeLanguageCode(raw)
          if (code) return code
        }
      }
    } catch (e) { }
    return 'en'
  })

  // Synchronize teaching language if user profile preferredLanguage is set or changes
  useEffect(() => {
    const code = normalizeLanguageCode(user?.preferredLanguage || user?.preferLanguage)
    if (code && code !== selectedLanguageCode) {
      setSelectedLanguageCode(code)
    }
  }, [user?.preferredLanguage, user?.preferLanguage])

  const currentLangObj = useMemo(() => {
    return LANGUAGES.find(l => l.value === selectedLanguageCode) || LANGUAGES[0]
  }, [selectedLanguageCode])

  const preferredLanguage = currentLangObj.label
  const preferredVoiceLangCode = currentLangObj.value
  const speechRecognitionLang = SPEECH_LANGUAGES[selectedLanguageCode] || 'en-US'

  const handleLanguageChange = (newLangCode) => {
    const langObj = LANGUAGES.find(l => l.value === newLangCode) || LANGUAGES[0]
    setSelectedLanguageCode(langObj.value)
    try {
      sessionStorage.setItem('skillbridge_language', JSON.stringify({
        code: langObj.code,
        name: langObj.label,
        value: langObj.value,
        native: langObj.native
      }))
      localStorage.setItem('skillbridge_language', langObj.value)
    } catch (e) { }

    window.speechSynthesis.cancel()
    setCurrentSentenceIdx(0)
    setElapsedSeconds(0)

    setChatMessages((prev) => {
      if (prev.length <= 1) {
        return [{ sender: 'aria', text: GREETINGS[langObj.value] || GREETINGS.en }]
      }
      return prev
    })
  }

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
      init[String(initialCompletedLessonId)] = true
    }
    if (course?.lessons) {
      course.lessons.forEach(l => {
        if (l.status === 'done') {
          init[l.id] = true
          init[String(l.id)] = true
        }
      })
    }
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          parsed.forEach(id => {
            if (id !== null && id !== undefined) {
              init[id] = true
              init[String(id)] = true
            }
          })
        }
      }
    } catch (e) {
      console.warn('Failed to parse localStorage course progress:', e)
    }
    return init
  })

  const isLessonDone = (lessonId) => {
    if (!lessonId) return false
    return Boolean(
      completedLessons[lessonId] ||
      completedLessons[String(lessonId)] ||
      (!isNaN(lessonId) && completedLessons[Number(lessonId)])
    )
  }

  const markLessonCompleted = (lessonId) => {
    if (!lessonId) return
    setCompletedLessons(prev => {
      const updated = {
        ...prev,
        [lessonId]: true,
        [String(lessonId)]: true
      }
      if (!isNaN(lessonId)) {
        updated[Number(lessonId)] = true
      }
      const uniqueLessonIds = Array.from(new Set(Object.keys(updated).filter(k => updated[k]).map(String)))
      try {
        localStorage.setItem(storageKey, JSON.stringify(uniqueLessonIds))
      } catch (e) { }

      if (course?.id) {
        const lessonsCount = course.lessons?.length || 5;
        const calcPct = Math.min(100, Math.max(0, Math.round((uniqueLessonIds.length / lessonsCount) * 100)));
        const isDone = uniqueLessonIds.length >= lessonsCount;
        api.saveCourseProgress(course.id, {
          completedLessonId: String(lessonId),
          completedLessonIds: uniqueLessonIds,
          progress: calcPct,
          completed: isDone
        }).catch(err => console.warn('Failed to save course progress to DB:', err.message))
      }
      return updated
    })
  }

  const [activeLessonId, setActiveLessonId] = useState(() => {
    if (initialAutoPlayNext && initialNextLessonId) {
      return initialNextLessonId
    }
    if (course?.lessons) {
      const saved = localStorage.getItem(storageKey)
      let completedMap = {}
      try {
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed)) {
            parsed.forEach(id => {
              if (id !== null && id !== undefined) {
                completedMap[id] = true
                completedMap[String(id)] = true
              }
            })
          }
        }
      } catch (e) { }

      if (initialCompletedLessonId) {
        completedMap[initialCompletedLessonId] = true
        completedMap[String(initialCompletedLessonId)] = true
      }

      // Automatically select the first uncompleted lesson
      const firstUncompleted = course.lessons.find((lesson) => {
        return !completedMap[lesson.id] && !completedMap[String(lesson.id)] && lesson.status !== 'done'
      })
      if (firstUncompleted) return firstUncompleted.id
      return course.lessons.find((lesson) => lesson.status === 'active')?.id || course.lessons[0]?.id
    }
    return course?.lessons?.[0]?.id
  })

  // Fetch DB progress on mount and sync with local state
  useEffect(() => {
    if (course?.id) {
      api.getCourseProgress(course.id)
        .then(res => {
          if (res.completedLessonIds && Array.isArray(res.completedLessonIds)) {
            setCompletedLessons(prev => {
              const updated = { ...prev }
              res.completedLessonIds.forEach(id => {
                if (id !== null && id !== undefined) {
                  updated[id] = true
                  updated[String(id)] = true
                }
              })
              try {
                localStorage.setItem(storageKey, JSON.stringify(Object.keys(updated)))
              } catch (e) { }
              return updated
            })

            // If current active lesson is already completed and user didn't request a specific lesson, auto advance
            if (!initialAutoPlayNext && course?.lessons) {
              const completedSet = new Set(res.completedLessonIds.map(String))
              const nextUncompleted = course.lessons.find(l => !completedSet.has(String(l.id)) && l.status !== 'done')
              if (nextUncompleted && completedSet.has(String(activeLessonId))) {
                console.log('[CoursePlayer] Auto-advancing active lesson to next uncompleted lesson:', nextUncompleted.title)
                setActiveLessonId(nextUncompleted.id)
              }
            }
          }
        })
        .catch(err => {
          console.warn('Failed to fetch user course progress from DB:', err.message)
        })
    }
  }, [course?.id, storageKey])

  const [playing, setPlaying] = useState(Boolean(initialAutoPlayNext))
  const [explanation, setExplanation] = useState('')
  const [loadingExplanation, setLoadingExplanation] = useState(false)
  const [loadingQuiz, setLoadingQuiz] = useState(false)

  // Teaching slide states
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState(0)

  // Chat states initialized with localized greeting
  const [chatMessages, setChatMessages] = useState(() => [
    { sender: 'aria', text: GREETINGS[selectedLanguageCode] || GREETINGS.en }
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Video / Slide player controls states
  const playerRef = useRef(null)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
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
  const wasLecturePlayingRef = useRef(false)
  const savedLecturePositionRef = useRef(0)
  const currentSentenceIdxRef = useRef(0)
  const inConversationModeRef = useRef(false)
  const followUpTimerRef = useRef(null)
  const isAnsweringRef = useRef(false)
  const isAriaSpeakingRef = useRef(false)
  const isAwakeRef = useRef(false)
  const awakeTimerRef = useRef(null)
  const handsFreeVoiceRef = useRef(true)
  const playingRef = useRef(false)
  const micStreamRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const vadStateRef = useRef('IDLE') // 'IDLE' | 'AWAKE' | 'RECORDING' | 'PROCESSING'
  const vadLoopIdRef = useRef(null)
  const recognitionRef = useRef(null)
  const lastSpeechTimeRef = useRef(0)
  const recordingStartTimeRef = useRef(0)
  const speechFramesCountRef = useRef(0)
  const manualRecordingRef = useRef(false)
  const activeLessonRef = useRef(null)
  const sentencesRef = useRef([])
  const isTranscribingRef = useRef(false)
  const lastTranscriptionTimeRef = useRef(0)

  // Keep refs in sync with state
  useEffect(() => {
    handsFreeVoiceRef.current = handsFreeVoice
  }, [handsFreeVoice])

  useEffect(() => {
    isAriaSpeakingRef.current = isAriaSpeaking
  }, [isAriaSpeaking])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    currentSentenceIdxRef.current = currentSentenceIdx
  }, [currentSentenceIdx])

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

  const selectVoiceForLanguage = (voices, langCode) => {
    if (!voices || voices.length === 0) return null
    const l = (langCode || 'en').toLowerCase()

    if (l === 'zh') {
      const v = voices.find(v => v.lang.toLowerCase().startsWith('zh') || v.lang.toLowerCase().includes('chinese') || v.lang.toLowerCase().includes('cmn'))
      if (v) return v
    } else if (l === 'ms') {
      const v = voices.find(v => v.lang.toLowerCase().startsWith('ms') || v.lang.toLowerCase().startsWith('id'))
      if (v) return v
    } else if (l === 'ta') {
      const v = voices.find(v => v.lang.toLowerCase().startsWith('ta') || v.lang.toLowerCase().includes('tamil'))
      if (v) return v
    } else if (l === 'bn') {
      const v = voices.find(v => v.lang.toLowerCase().startsWith('bn') || v.lang.toLowerCase().includes('bengali') || v.lang.toLowerCase().includes('bangla'))
      if (v) return v
    } else if (l === 'en') {
      const v = voices.find(v => v.lang.toLowerCase().startsWith('en'))
      if (v) return v
    }

    const match = voices.find(v => v.lang.toLowerCase().startsWith(l))
    return match || voices.find(v => v.lang.startsWith('en')) || voices[0]
  }

  // Auto-resume lecture from the exact saved concept/sentence position
  const resumeLectureFromExactPosition = () => {
    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }
    inConversationModeRef.current = false
    isAwakeRef.current = false
    isAnsweringRef.current = false
    vadStateRef.current = 'IDLE'

    if (wasLecturePlayingRef.current) {
      console.log(`[LiveTutor] Auto-resuming lecture at Concept ${savedLecturePositionRef.current + 1}...`)
      setVoiceStatusText('▶️ Resuming lecture from where you left off...')
      setCurrentSentenceIdx(savedLecturePositionRef.current)
      setPlaying(true)
      wasLecturePlayingRef.current = false
      setTimeout(() => {
        setVoiceStatusText('')
      }, 2500)
    } else {
      setVoiceStatusText('')
    }
  }

  const speakAriaAnswer = (text, onEndCallback) => {
    if (!text) {
      setIsAriaSpeaking(false)
      isAriaSpeakingRef.current = false
      onEndCallback?.()
      return
    }
    try {
      window.speechSynthesis.cancel()
      setIsAriaSpeaking(true)
      isAriaSpeakingRef.current = true
      console.log(`[LiveTutor] TTS start in ${preferredLanguage}: ARIA is speaking response...`)
      const cleanText = text
        .replace(/###/g, '')
        .replace(/####/g, '')
        .replace(/\*\*/g, '')
        .replace(/- /g, '')
        .replace(/---/g, '')
      const utterance = new SpeechSynthesisUtterance(cleanText)
      utterance.lang = speechRecognitionLang
      const voices = window.speechSynthesis.getVoices()
      const matchedVoice = selectVoiceForLanguage(voices, preferredVoiceLangCode)
      if (matchedVoice) utterance.voice = matchedVoice
      utterance.rate = 0.95
      utterance.pitch = 1.05

      const finishTTS = () => {
        setIsAriaSpeaking(false)
        isAriaSpeakingRef.current = false
        console.log('[LiveTutor] TTS end: ARIA finished speaking.')
        onEndCallback?.()
      }

      utterance.onend = finishTTS
      utterance.onerror = finishTTS

      window.speechSynthesis.speak(utterance)
    } catch (e) {
      console.warn('[LiveTutor] Speech synthesis failed:', e)
      setIsAriaSpeaking(false)
      isAriaSpeakingRef.current = false
      onEndCallback?.()
    }
  }

  // Wake-word recognition patterns and helper functions supporting 5 languages
  const WAKE_WORDS = [
    // English
    'hey aria', 'hi aria', 'hello aria', 'ok aria', 'okay aria', 'ask aria', 'aria',
    'hey arya', 'hi arya', 'hello arya', 'ok arya', 'okay arya', 'arya',
    'hey area', 'hi area', 'area', 'hey ariya', 'hi ariya', 'ariya',
    // Chinese
    '你好 aria', '你好aria', '嗨 aria', '嗨aria', 'aria 你好',
    // Malay
    'hai aria', 'halo aria', 'helo aria',
    // Tamil
    'வணக்கம் aria', 'ஹாய் aria', 'வணக்கம் ஆரியா', 'ஆரியா',
    // Bangla
    'হ্যালো aria', 'নমস্কার aria', 'আরিয়া'
  ]

  const containsWakeWord = (text) => {
    if (!text) return false
    const lower = text.trim().toLowerCase()
    return WAKE_WORDS.some(w => lower.includes(w)) || /\b(hey|hi|hello|ok|okay|ask|வணக்கம்|ஹாய்|你好|嗨|hai|halo|হ্যালো)?\s*(aria|arya|area|ariya|ஆரியா|আরিয়া)\b/i.test(text)
  }

  const extractQuestionFromWakeWord = (text) => {
    if (!text) return ''
    let clean = text.trim()
    clean = clean.replace(/^(hey|hi|hello|ok|okay|ask)?\s*(aria|arya|area|ariya)[\s,.:!?-]*/i, '').trim()
    clean = clean.replace(/^(aria|arya|area|ariya)[\s,.:!?-]*/i, '').trim()
    return clean
  }

  const isNoiseOrHallucination = (text) => {
    if (!text) return true
    const t = text.trim().toLowerCase()
    if (t.length < 2) return true
    const noisePhrases = [
      '[blank_audio]', '[silence]', '(silence)', '[music]', '(music)',
      'thank you.', 'thank you for watching', 'thanks for watching',
      'subtitles by', 'subscribe to', 'translated by'
    ]
    return noisePhrases.some(p => t === p || t.startsWith(p))
  }

  // Interruption helper: pauses lecture or ARIA speech and saves position
  const interruptLectureAndWake = () => {
    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }

    // If lecture is playing, pause and record exact concept index
    if (playingRef.current) {
      wasLecturePlayingRef.current = true
      savedLecturePositionRef.current = currentSentenceIdxRef.current
      window.speechSynthesis.cancel()
      setPlaying(false)
      console.log(`[LiveTutor] Lecture interrupted by user at Concept ${currentSentenceIdxRef.current + 1}. Position saved.`)
    } else if (isAriaSpeakingRef.current) {
      // If ARIA is speaking, cancel her speech immediately
      window.speechSynthesis.cancel()
      isAriaSpeakingRef.current = false
      console.log('[LiveTutor] ARIA response interrupted by student. Listening to new question...')
    }

    isAwakeRef.current = true
    inConversationModeRef.current = true
    vadStateRef.current = 'AWAKE'
    setVoiceStatusText('✨ "Hey ARIA" Detected! Lecture paused. Ask your question...')

    if (awakeTimerRef.current) {
      clearTimeout(awakeTimerRef.current)
    }

    awakeTimerRef.current = setTimeout(() => {
      if (isAwakeRef.current && vadStateRef.current === 'AWAKE' && !isAnsweringRef.current) {
        console.log('[LiveTutor] Awake window timeout without question.')
        resumeLectureFromExactPosition()
      }
    }, 7000)
  }

  const handleVoiceQuestion = async (userSpeech, forceQuestion = false) => {
    if (!userSpeech || isAnsweringRef.current) return
    const rawSpeech = userSpeech.trim()
    if (rawSpeech.length < 2 || isNoiseOrHallucination(rawSpeech)) {
      return
    }

    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }

    const lower = rawSpeech.toLowerCase()

    // Voice navigation commands
    if (lower === 'resume' || lower === 'continue' || lower === 'play' || lower === 'carry on' || lower === 'back to lecture') {
      resumeLectureFromExactPosition()
      return
    }
    if (lower === 'pause' || lower === 'pause lecture' || lower === 'stop') {
      window.speechSynthesis.cancel()
      setPlaying(false)
      wasLecturePlayingRef.current = false
      setVoiceStatusText('⏸️ Lecture paused by voice command.')
      isAnsweringRef.current = false
      inConversationModeRef.current = false
      return
    }

    const hasWake = containsWakeWord(rawSpeech)
    const cleanQuestion = extractQuestionFromWakeWord(rawSpeech)

    // If user only said "Hey ARIA" without an attached question
    if (hasWake && (!cleanQuestion || cleanQuestion.length < 2) && !forceQuestion) {
      interruptLectureAndWake()
      return
    }

    // Determine final question (in conversation mode, questions don't require "Hey ARIA")
    let finalQuestion = cleanQuestion || rawSpeech
    if (!finalQuestion || finalQuestion.length < 2) {
      if (hasWake) {
        interruptLectureAndWake()
      }
      return
    }

    if (awakeTimerRef.current) {
      clearTimeout(awakeTimerRef.current)
      awakeTimerRef.current = null
    }

    // If lecture is playing and we got a question directly
    if (playingRef.current) {
      wasLecturePlayingRef.current = true
      savedLecturePositionRef.current = currentSentenceIdxRef.current
      window.speechSynthesis.cancel()
      setPlaying(false)
      console.log(`[LiveTutor] Direct question received. Paused lecture at Concept ${savedLecturePositionRef.current + 1}.`)
    }

    isAwakeRef.current = false
    isAnsweringRef.current = true
    inConversationModeRef.current = true
    vadStateRef.current = 'PROCESSING'

    // Get current concept being explained on chalkboard
    const currentConceptText = (sentencesRef.current && sentencesRef.current[savedLecturePositionRef.current]) ||
      (sentencesRef.current && sentencesRef.current[currentSentenceIdxRef.current]) ||
      activeLessonRef.current?.title || ''

    setVoiceStatusText(`✨ Question: "${finalQuestion}"`)
    setChatMessages((prev) => [...prev, { sender: 'user', text: finalQuestion }])
    setChatLoading(true)
    console.log(`[LiveTutor] AI request: Sending question to ARIA AI Tutor: "${finalQuestion}" (Concept: "${currentConceptText.slice(0, 40)}...", Lang: ${preferredLanguage})`)

    try {
      const chatRes = await api.chatWithTutor(course.id, {
        message: finalQuestion,
        lessonTitle: activeLessonRef.current?.title,
        currentConcept: currentConceptText,
        language: preferredLanguage,
        conversationHistory: chatMessages.slice(-8)
      })
      const ariaAnswer = chatRes.text || chatRes.reply || "I'm ready to help with your course questions!"
      setChatMessages((prev) => [...prev, { sender: 'aria', text: ariaAnswer }])
      setVoiceStatusText('🤖 ARIA is answering...')
      console.log(`[LiveTutor] AI response received: "${ariaAnswer.substring(0, 60)}..."`)

      // Speak ARIA answer immediately with TTS
      speakAriaAnswer(ariaAnswer, () => {
        isAnsweringRef.current = false
        vadStateRef.current = 'IDLE'

        // Multi-turn conversational follow-up window (6 seconds)
        if (handsFreeVoiceRef.current) {
          isAwakeRef.current = true
          inConversationModeRef.current = true
          setVoiceStatusText('💬 ARIA is listening for follow-up (or say "Resume")...')
          console.log('[LiveTutor] ARIA finished speaking. Entered 6s conversational follow-up window (no "Hey ARIA" required)...')

          followUpTimerRef.current = setTimeout(() => {
            console.log('[LiveTutor] Follow-up window ended. Returning to lecture playback...')
            resumeLectureFromExactPosition()
          }, 6000)
        } else {
          resumeLectureFromExactPosition()
        }
      })
    } catch (err) {
      console.error('[LiveTutor] ARIA AI Tutor chat error:', err)
      setChatMessages((prev) => [...prev, { sender: 'aria', text: '⚠️ Failed to answer question via AI Tutor. Resuming lecture...' }])
      isAnsweringRef.current = false
      vadStateRef.current = 'IDLE'
      setTimeout(() => {
        resumeLectureFromExactPosition()
      }, 1500)
    } finally {
      setChatLoading(false)
    }
  }

  // Release all audio pipeline resources completely
  const cleanupAudioPipeline = () => {
    if (awakeTimerRef.current) {
      clearTimeout(awakeTimerRef.current)
      awakeTimerRef.current = null
    }

    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }

    if (vadLoopIdRef.current) {
      clearInterval(vadLoopIdRef.current)
      vadLoopIdRef.current = null
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (e) { }
      recognitionRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch (e) { }
      mediaRecorderRef.current = null
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close()
      } catch (e) { }
      audioContextRef.current = null
    }

    if (micStreamRef.current) {
      try {
        micStreamRef.current.getTracks().forEach((track) => track.stop())
      } catch (e) { }
      micStreamRef.current = null
    }

    analyserRef.current = null
    audioChunksRef.current = []
    vadStateRef.current = 'IDLE'
    isAwakeRef.current = false
    inConversationModeRef.current = false
    setRecording(false)
    setMediaRecorder(null)
    console.log('[LiveTutor] Audio pipeline completely cleaned up & microphone released.')
  }

  // Start recording current mic stream chunks
  const startRecordingStream = (stream) => {
    if (!stream) return
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop() } catch (e) { }
      }

      audioChunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '')

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        audioChunksRef.current = []
        setRecording(false)
        console.log(`[LiveTutor] Speech recording completed (${audioBlob.size} bytes).`)

        manualRecordingRef.current = false

        if (audioBlob.size < 1200) {
          console.log('[LiveTutor] Audio too small, resuming listening.')
          vadStateRef.current = isAwakeRef.current ? 'AWAKE' : 'IDLE'
          return
        }

        if (isTranscribingRef.current) return
        isTranscribingRef.current = true
        vadStateRef.current = 'PROCESSING'
        setVoiceStatusText(`🤖 Transcribing speech (${currentLangObj.label})...`)
        console.log(`[LiveTutor] Whisper start: Transcribing audio in ${selectedLanguageCode}...`)

        try {
          const res = await api.transcribeSpeech(audioBlob, selectedLanguageCode)
          const transcription = (res?.text || '').trim()
          const now = Date.now()
          console.log(`[LiveTutor] Whisper transcription received: "${transcription}"`)

          if (transcription && (now - lastTranscriptionTimeRef.current > 1200) && !isNoiseOrHallucination(transcription)) {
            lastTranscriptionTimeRef.current = now
            handleVoiceQuestion(transcription, inConversationModeRef.current)
          } else {
            console.log('[LiveTutor] No valid speech in Whisper result or duplicate ignored.')
            vadStateRef.current = isAwakeRef.current ? 'AWAKE' : 'IDLE'
            isAnsweringRef.current = false
          }
        } catch (err) {
          console.error('[LiveTutor] Whisper transcription failed:', err)
          vadStateRef.current = isAwakeRef.current ? 'AWAKE' : 'IDLE'
          isAnsweringRef.current = false
        } finally {
          isTranscribingRef.current = false
        }
      }

      recorder.start(250)
      mediaRecorderRef.current = recorder
      setMediaRecorder(recorder)
      setRecording(true)
      recordingStartTimeRef.current = Date.now()
      lastSpeechTimeRef.current = Date.now()
      console.log('[LiveTutor] MediaRecorder capturing speech...')
    } catch (err) {
      console.error('[LiveTutor] Failed to start MediaRecorder:', err)
      vadStateRef.current = 'IDLE'
      setRecording(false)
    }
  }

  // Continuous Always-On Microphone with Instant Wake-Word Detection & 1.8s Silence Detection
  useEffect(() => {
    if (!handsFreeVoice) {
      cleanupAudioPipeline()
      setVoiceStatusText('')
      return
    }

    let isMounted = true
    console.log(`[LiveTutor] Initializing Always-On assistant in ${preferredLanguage} (${speechRecognitionLang})...`)
    setVoiceStatusText(`🎙️ Always-On Mic Active (${currentLangObj.native}) — Say "Hey ARIA" anytime!`)
    setTimeout(() => {
      if (isMounted && vadStateRef.current === 'IDLE' && !isAwakeRef.current && !isAnsweringRef.current) {
        setVoiceStatusText('')
      }
    }, 3000)

    // 1. Initialize instant SpeechRecognition (Web Speech API) for real-time wake word trigger
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = speechRecognitionLang

        rec.onresult = (event) => {
          if (!handsFreeVoiceRef.current) return

          const lastIdx = event.results.length - 1
          const result = event.results[lastIdx]
          if (!result || !result[0]) return

          const transcript = result[0].transcript.trim()
          if (!transcript) return

          // If ARIA is answering / speaking, allow interruption via "Hey ARIA"
          if (isAriaSpeakingRef.current) {
            if (containsWakeWord(transcript)) {
              console.log('[LiveTutor] Student interrupted ARIA speaking via "Hey ARIA".')
              interruptLectureAndWake()
            }
            return
          }

          // In follow-up conversation mode, accept questions directly
          if (inConversationModeRef.current && !isAnsweringRef.current && result.isFinal && transcript.length >= 2) {
            console.log(`[LiveTutor] Follow-up question detected: "${transcript}"`)
            handleVoiceQuestion(transcript, true)
            return
          }

          // Instant Wake-Word detection in real time (even during lecture playback!)
          if (containsWakeWord(transcript)) {
            const cleanQ = extractQuestionFromWakeWord(transcript)
            if (cleanQ && cleanQ.length >= 2 && result.isFinal) {
              console.log(`[LiveTutor] Full question detected during playback: "${cleanQ}"`)
              if (playingRef.current) {
                wasLecturePlayingRef.current = true
                savedLecturePositionRef.current = currentSentenceIdxRef.current
                window.speechSynthesis.cancel()
                setPlaying(false)
              }
              handleVoiceQuestion(transcript)
            } else if (!isAwakeRef.current) {
              interruptLectureAndWake()
            }
          }
        }

        rec.onerror = (e) => {
          if (e.error !== 'no-speech' && e.error !== 'aborted') {
            console.warn('[LiveTutor] Speech recognition notice:', e.error)
          }
        }

        rec.onend = () => {
          if (isMounted && handsFreeVoiceRef.current) {
            setTimeout(() => {
              if (isMounted && handsFreeVoiceRef.current) {
                try { rec.start() } catch (err) { }
              }
            }, 300)
          }
        }

        rec.start()
        recognitionRef.current = rec
        console.log(`[LiveTutor] Real-time SpeechRecognition initialized for ${speechRecognitionLang}.`)
      } catch (err) {
        console.warn('[LiveTutor] SpeechRecognition init notice (fallback to VAD + Whisper):', err)
      }
    }

    // 2. Initialize Web Audio API Analyser & MediaRecorder pipeline for audio capture & Whisper
    const initAudioPipeline = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        })

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        micStreamRef.current = stream
        console.log('[LiveTutor] Microphone stream initialized with echo cancellation.')

        const AudioCtx = window.AudioContext || window.webkitAudioContext
        const audioCtx = new AudioCtx()
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume()
        }

        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.3
        source.connect(analyser)

        audioContextRef.current = audioCtx
        analyserRef.current = analyser

        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)

        const SPEECH_RMS_THRESHOLD = 18
        const SILENCE_RMS_THRESHOLD = 10
        const SILENCE_DURATION_MS = 1800 // Configured 1.8s for natural pauses
        const MAX_RECORDING_MS = 18000

        // Continuous VAD loop (~40ms tick)
        vadLoopIdRef.current = setInterval(() => {
          if (!handsFreeVoiceRef.current || !analyserRef.current) return

          // If ARIA is speaking her answer, suppress VAD to avoid recording her own speech
          if (isAriaSpeakingRef.current || isAnsweringRef.current) {
            speechFramesCountRef.current = 0
            return
          }

          analyserRef.current.getByteFrequencyData(dataArray)
          let sumSquares = 0
          for (let i = 0; i < bufferLength; i++) {
            sumSquares += dataArray[i] * dataArray[i]
          }
          const rms = Math.sqrt(sumSquares / bufferLength)

          const currentState = vadStateRef.current

          if (currentState === 'AWAKE' || inConversationModeRef.current) {
            if (rms >= SPEECH_RMS_THRESHOLD) {
              speechFramesCountRef.current += 1
              if (speechFramesCountRef.current >= 3) { // ~120ms sustained speech
                console.log(`[LiveTutor] Student speech detected (RMS: ${rms.toFixed(1)}). Starting recording...`)
                vadStateRef.current = 'RECORDING'
                speechFramesCountRef.current = 0

                if (followUpTimerRef.current) {
                  clearTimeout(followUpTimerRef.current)
                  followUpTimerRef.current = null
                }

                if (playingRef.current) {
                  wasLecturePlayingRef.current = true
                  savedLecturePositionRef.current = currentSentenceIdxRef.current
                  window.speechSynthesis.cancel()
                  setPlaying(false)
                }

                setVoiceStatusText(`🎙️ Listening (${currentLangObj.native})... Speak your question to ARIA`)
                startRecordingStream(micStreamRef.current)
              }
            } else {
              speechFramesCountRef.current = 0
            }
          } else if (currentState === 'RECORDING') {
            const now = Date.now()
            if (rms >= SILENCE_RMS_THRESHOLD) {
              lastSpeechTimeRef.current = now
            }

            const silenceDuration = now - lastSpeechTimeRef.current
            const totalDuration = now - recordingStartTimeRef.current

            // 1.8s natural silence threshold reached or max duration reached
            if ((silenceDuration >= SILENCE_DURATION_MS && totalDuration >= 600) || totalDuration >= MAX_RECORDING_MS) {
              console.log(`[LiveTutor] Speech ended: Silence detected (${silenceDuration}ms). Finishing recording...`)
              vadStateRef.current = 'PROCESSING'
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                try {
                  mediaRecorderRef.current.stop()
                } catch (e) {
                  console.warn('[LiveTutor] Error stopping recorder on silence:', e)
                }
              }
            }
          }
        }, 40)

      } catch (err) {
        console.error('[LiveTutor] Microphone permission error or device unavailable:', err)
        setVoiceStatusText('⚠️ Microphone access denied or unavailable.')
      }
    }

    initAudioPipeline()

    return () => {
      isMounted = false
      cleanupAudioPipeline()
    }
  }, [handsFreeVoice, speechRecognitionLang])

  // Manual Microphone Button Handler (Optional manual trigger)
  const toggleRecording = async () => {
    if (recording) {
      console.log('[LiveTutor] Manual stop recording requested.')
      vadStateRef.current = 'PROCESSING'
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop() } catch (e) { }
      }
      setRecording(false)
      return
    }

    console.log('[LiveTutor] Manual start recording requested.')
    if (playingRef.current) {
      wasLecturePlayingRef.current = true
      savedLecturePositionRef.current = currentSentenceIdxRef.current
      window.speechSynthesis.cancel()
      setPlaying(false)
    }

    setVoiceStatusText('🎙️ Listening... Speak your question to ARIA')
    manualRecordingRef.current = true
    vadStateRef.current = 'RECORDING'

    if (micStreamRef.current && micStreamRef.current.active) {
      startRecordingStream(micStreamRef.current)
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        micStreamRef.current = stream
        startRecordingStream(stream)
      } catch (err) {
        console.error('[LiveTutor] Manual mic access error:', err)
        alert('Microphone access is required to use voice input.')
        vadStateRef.current = 'IDLE'
        setVoiceStatusText('')
      }
    }
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

  // Live real-time playback elapsed seconds state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedSecondsRef = useRef(0);

  useEffect(() => {
    elapsedSecondsRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  // Reset elapsed time when lesson changes
  useEffect(() => {
    setElapsedSeconds(0);
    elapsedSecondsRef.current = 0;
  }, [activeLessonId]);

  // Align elapsedSeconds when concept index changes if significantly divergent
  useEffect(() => {
    if (sentences.length > 0 && totalSeconds > 0) {
      const sentenceSec = Math.min(
        totalSeconds,
        Math.round((currentSentenceIdx / Math.max(1, sentences.length)) * totalSeconds)
      );
      if (Math.abs(elapsedSecondsRef.current - sentenceSec) > 4) {
        setElapsedSeconds(sentenceSec);
        elapsedSecondsRef.current = sentenceSec;
      }
    }
  }, [currentSentenceIdx, sentences.length, totalSeconds]);

  // Real-time second-by-second ticking while playing
  useEffect(() => {
    if (!playing) return;

    const interval = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= totalSeconds) {
          return totalSeconds;
        }
        elapsedSecondsRef.current = next;
        return next;
      });
    }, 1000 / (playbackRate || 1.0));

    return () => clearInterval(interval);
  }, [playing, totalSeconds, playbackRate]);

  const formatTime = (s) => {
    const total = Math.max(0, Math.round(s || 0));
    const mins = Math.floor(total / 60).toString().padStart(2, '0');
    const secs = Math.floor(total % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const formattedTimeString = useMemo(() => {
    return `${formatTime(elapsedSeconds)} / ${formatTime(totalSeconds)}`;
  }, [elapsedSeconds, totalSeconds]);

  const utteranceRef = useRef(null);

  const handleTogglePlay = () => {
    if (!playing) {
      if (currentSentenceIdx >= sentences.length - 1 && elapsedSeconds >= totalSeconds - 1) {
        setCurrentSentenceIdx(0);
        setElapsedSeconds(0);
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

  const handleTakeChapterAssessmentRef = useRef(null);

  // Speech TTS handler with clean speech text
  useEffect(() => {
    if (playing && !muted && !loadingExplanation && sentences.length > 0) {
      let isCancelled = false;

      const speak = (idx) => {
        if (isCancelled) return;
        if (idx >= sentences.length) {
          setPlaying(false);
          setCurrentSentenceIdx(0);
          if (activeLesson?.id) {
            markLessonCompleted(activeLesson.id);
          }
          console.log('[CoursePlayer] Chapter lecture completed! Navigating to chapter assessment...');
          setTimeout(() => {
            if (handleTakeChapterAssessmentRef.current) {
              handleTakeChapterAssessmentRef.current();
            }
          }, 800);
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

  useEffect(() => {
    activeLessonRef.current = activeLesson
  }, [activeLesson])

  useEffect(() => {
    sentencesRef.current = sentences
  }, [sentences])

  const overallProgressPercentage = useMemo(() => {
    if (!course?.lessons || course.lessons.length === 0) return 0
    const completedCount = course.lessons.filter(l => isLessonDone(l.id) || l.status === 'done').length
    return Math.min(100, Math.max(0, Math.round((completedCount / course.lessons.length) * 100)))
  }, [completedLessons, course?.lessons])

  const highestUnlockedIdx = useMemo(() => {
    let maxIdx = 0
    if (!course?.lessons) return 0
    course.lessons.forEach((l, idx) => {
      const isDone = isLessonDone(l.id) || l.status === 'done'
      if (isDone) {
        maxIdx = Math.max(maxIdx, idx + 1)
      }
    })
    return maxIdx
  }, [course?.lessons, completedLessons])

  if (!course) return null

  const handleTakeChapterAssessment = async () => {
    if (!activeLesson) return
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

  handleTakeChapterAssessmentRef.current = handleTakeChapterAssessment

  const handleSendChat = (e) => {
    e.preventDefault()
    if (!chatInput.trim() || chatLoading) return

    const userMsg = chatInput.trim()
    setChatInput('')

    // If lecture is playing, save exact position and pause
    if (playingRef.current) {
      wasLecturePlayingRef.current = true
      savedLecturePositionRef.current = currentSentenceIdxRef.current
      window.speechSynthesis.cancel()
      setPlaying(false)
      console.log(`[LiveTutor] Typed question received during lecture. Paused at Concept ${savedLecturePositionRef.current + 1}.`)
    }

    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }

    setChatMessages(prev => [...prev, { sender: 'user', text: userMsg }])
    setChatLoading(true)
    inConversationModeRef.current = true
    setVoiceStatusText(`✨ Question: "${userMsg}"`)

    const currentConceptText = (sentencesRef.current && sentencesRef.current[savedLecturePositionRef.current]) ||
      (sentencesRef.current && sentencesRef.current[currentSentenceIdxRef.current]) ||
      activeLessonRef.current?.title || ''

    api.chatWithTutor(course.id, {
      message: userMsg,
      lessonTitle: activeLessonRef.current?.title,
      currentConcept: currentConceptText,
      language: preferredLanguage,
      conversationHistory: chatMessages.slice(-8)
    })
      .then(res => {
        const ariaAnswer = res.text || res.reply || "I'm ready to help with your course questions!"
        setChatMessages(prev => [...prev, { sender: 'aria', text: ariaAnswer }])
        setVoiceStatusText('🤖 ARIA is answering...')
        speakAriaAnswer(ariaAnswer, () => {
          if (handsFreeVoiceRef.current) {
            isAwakeRef.current = true
            inConversationModeRef.current = true
            setVoiceStatusText('💬 ARIA is listening for follow-up (or say "Resume")...')
            followUpTimerRef.current = setTimeout(() => {
              resumeLectureFromExactPosition()
            }, 6000)
          } else {
            resumeLectureFromExactPosition()
          }
        })
        setChatLoading(false)
      })
      .catch(err => {
        console.error('Chat tutor error:', err)
        setChatMessages(prev => [...prev, { sender: 'aria', text: '⚠️ Failed to answer question via AI Tutor. Resuming lecture...' }])
        setChatLoading(false)
        setTimeout(() => {
          resumeLectureFromExactPosition()
        }, 1500)
      })
  }

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-[#f4f7fc] text-[#0f172a] select-none flex flex-col font-sans">
      {/* Sub-header Navigation with Active Language Selector */}
      <div className="shrink-0 w-full px-4 pt-2 pb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 transition border-0 bg-transparent p-0 cursor-pointer"
        >
          <span className="text-base">←</span> Back
        </button>

        {/* Multilingual Teaching Language Switcher */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <span>🌐</span>
            <span className="hidden sm:inline">Teaching Language:</span>
          </label>
          <select
            value={selectedLanguageCode}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="bg-white border border-slate-200/90 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs hover:border-[#ff8c21] focus:outline-none focus:border-[#ff8c21] cursor-pointer transition"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
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

            <ul className="space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-0.5 no-scrollbar">
              {course.lessons.map((lesson, index) => {
                const isActive = lesson.id === activeLesson?.id
                const isCompleted = isLessonDone(lesson.id) || lesson.status === 'done'
                const prevLessonDone = Boolean(index > 0 && (isLessonDone(course.lessons[index - 1]?.id) || course.lessons[index - 1]?.status === 'done'))
                const isUnlocked = index === 0 || isCompleted || prevLessonDone || index <= highestUnlockedIdx

                return (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      disabled={!isUnlocked}
                      onClick={() => {
                        if (isUnlocked) {
                          window.speechSynthesis.cancel()
                          setActiveLessonId(lesson.id)
                          setCurrentSentenceIdx(0)
                          setElapsedSeconds(0)
                          setPlaying(true)
                        }
                      }}
                      className={`w-full flex items-center gap-2 p-2.5 rounded-xl border text-left transition cursor-pointer ${isActive
                        ? 'bg-[#eff6ff] border-slate-200 shadow-2xs font-semibold'
                        : isCompleted
                          ? 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                          : isUnlocked
                            ? 'bg-slate-50 border-slate-100 hover:bg-slate-100 text-slate-800'
                            : 'bg-slate-50/60 border-slate-100 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed'
                        }`}
                    >
                      {/* Left Icon Badge */}
                      <span
                        className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${isActive
                          ? 'bg-[#2563eb] text-white shadow-xs'
                          : isCompleted
                            ? 'bg-[#22c55e] text-white'
                            : isUnlocked
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-slate-200 text-slate-400'
                          }`}
                      >
                        {isActive ? '▶' : isCompleted ? '✓' : (isUnlocked ? '▶' : '🔒')}
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
              .no-scrollbar::-webkit-scrollbar { display: none; width: 0px; height: 0px; }
              .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>

            <div className="p-5 flex flex-col flex-1 min-h-0 justify-between">
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
                  <div className="flex-1 min-h-0 space-y-2.5 overflow-y-auto pr-1 text-left my-1 no-scrollbar">
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
                className="flex-1 min-w-[100px] max-w-md mx-2 h-2 bg-slate-700/80 rounded-full cursor-pointer relative overflow-hidden group flex items-center"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const clickX = e.clientX - rect.left
                  const pct = Math.max(0, Math.min(1, clickX / rect.width))
                  const newSeconds = Math.round(pct * totalSeconds)
                  const newIdx = Math.min(sentences.length - 1, Math.max(0, Math.floor(pct * sentences.length)))
                  setElapsedSeconds(newSeconds)
                  setCurrentSentenceIdx(newIdx)
                  if (playing) {
                    window.speechSynthesis.cancel()
                  }
                }}
              >
                <div
                  className="h-full bg-white rounded-full transition-all duration-150 group-hover:bg-[#ff8c21]"
                  style={{ width: `${Math.min(100, Math.max(0, (elapsedSeconds / Math.max(1, totalSeconds)) * 100))}%` }}
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
              <svg className="h-5 w-5 stroke-[#ff8c21] fill-none shrink-0" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
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
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3.5 my-2.5 pr-0.5 no-scrollbar">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'aria' && (
                  <div className="h-8 w-8 rounded-full bg-white border border-[#ff8c21] text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
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
                  <div className="h-8 w-8 rounded-full bg-white border border-[#ff8c21] text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
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


