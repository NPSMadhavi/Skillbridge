import { useMemo, useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import VoiceTutorManager, { TutorState, containsWakeWord, extractQuestionFromWakeWord, isNoiseOrHallucination } from '../services/voiceTutorService'
import logo from '../assets/SkillBridge_AI.png'
import { persistLanguageSelection, readStoredLanguageCode, textMatchesLanguage } from '../utils/language'

const CourseBookIcon = ({ className = "h-5 w-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
    <path d="M4.5 16.5h15" />
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

// In-memory instant client cache for lesson explanations (Key: `${courseId}_${lessonId}_${langCode}`)
const lessonExplanationClientCache = new Map();
// Audio/Utterance cache pool for pre-warmed concepts (Key: `${courseId}_${lessonId}_${conceptIndex}`)
const ttsUtterancePool = new Map();

const CoursePlayer = ({
  course,
  initialCompletedLessonId,
  initialAutoPlayNext,
  initialNextLessonId,
  onExit,
  onAssessment
}) => {
  // Retrieve user details from sessionStorage
  const user = useMemo(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James Lee', email: 'user@skillbridge.com' }
    } catch {
      return { fullName: 'James Lee', email: 'user@skillbridge.com' }
    }
  }, [])

  const userId = useMemo(() => {
    return user?.id || user?.finNumber || user?.email || 'guest';
  }, [user]);

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)
  const lessonOpenTimestampRef = useRef(performance.now())
  const [pipelineState, setPipelineState] = useState('PREPARING') // 'PREPARING' | 'READY' | 'PLAYING'

  // Pre-warm browser Web Speech synthesis voices on component mount
  useEffect(() => {
    const voiceInitStartTime = performance.now();
    console.log('[PERF:TTS_START] Initializing and pre-warming Web Speech synthesis voices');
    const handleVoices = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      if (voices.length > 0) {
        const duration = Math.round(performance.now() - voiceInitStartTime);
        console.log(`[PERF:TTS_END] Web Speech synthesis ready with ${voices.length} voices in ${duration}ms`);
      }
    };
    handleVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = handleVoices;
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Universal component unmount cleanup to guarantee zero background audio or speech synthesis and save playback
  useEffect(() => {
    return () => {
      console.log('[CoursePlayer] Unmounting player: completely canceling speech synthesis and releasing audio resources.');
      try {
        window.speechSynthesis?.cancel?.();
      } catch (e) { }

      if (window._skillbridgeResumeInterval) {
        clearInterval(window._skillbridgeResumeInterval);
        window._skillbridgeResumeInterval = null;
      }
      if (followUpTimerRef.current) {
        clearTimeout(followUpTimerRef.current);
        followUpTimerRef.current = null;
      }
      if (awakeTimerRef.current) {
        clearTimeout(awakeTimerRef.current);
        awakeTimerRef.current = null;
      }

      if (voiceManagerRef.current) {
        try {
          voiceManagerRef.current.destroy();
        } catch (e) { }
        voiceManagerRef.current = null;
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { }
        mediaRecorderRef.current = null;
      }

      if (micStreamRef.current) {
        try {
          micStreamRef.current.getTracks().forEach(t => t.stop());
        } catch (e) { }
        micStreamRef.current = null;
      }

      if (activeLessonRef.current?.id && (currentSentenceIdxRef.current > 0 || elapsedSecondsRef.current > 0)) {
        try {
          const uId = user?.id || user?.finNumber || user?.email || 'guest';
          const pbKey = `skillbridge_playback_${uId}_${course?.id}`;
          const raw = localStorage.getItem(pbKey);
          const data = raw ? JSON.parse(raw) : { lastActiveLessonId: activeLessonRef.current.id, lessons: {} };
          if (!data.lessons) data.lessons = {};
          data.lastActiveLessonId = activeLessonRef.current.id;
          data.lessons[String(activeLessonRef.current.id)] = {
            sentenceIdx: Math.max(0, currentSentenceIdxRef.current || 0),
            elapsedSeconds: Math.max(0, elapsedSecondsRef.current || 0),
            updatedAt: Date.now()
          };
          localStorage.setItem(pbKey, JSON.stringify(data));
        } catch (e) { }
      }
    };
  }, [course?.id, user]);

  // Selected teaching language: explicit choice (survives refresh), then profile default
  const [selectedLanguageCode, setSelectedLanguageCode] = useState(() => {
    try {
      const stored = readStoredLanguageCode()
      if (stored) return stored

      const userRaw = sessionStorage.getItem('skillbridge_user')
      if (userRaw) {
        const u = JSON.parse(userRaw)?.user
        const code = normalizeLanguageCode(u?.preferredLanguage || u?.preferLanguage)
        if (code) return code
      }
    } catch (e) { }
    return 'en'
  })

  const currentLangObj = useMemo(() => {
    return LANGUAGES.find(l => l.value === selectedLanguageCode) || LANGUAGES[0]
  }, [selectedLanguageCode])

  const preferredLanguage = currentLangObj.label
  const preferredVoiceLangCode = currentLangObj.value
  const speechRecognitionLang = SPEECH_LANGUAGES[selectedLanguageCode] || 'en-US'
  const selectedLanguageCodeRef = useRef(selectedLanguageCode)
  selectedLanguageCodeRef.current = selectedLanguageCode

  const handleLanguageChange = (newLangCode) => {
    const langObj = LANGUAGES.find(l => l.value === newLangCode) || LANGUAGES[0]
    setSelectedLanguageCode(langObj.value)
    ttsUtterancePool.clear()
    persistLanguageSelection(langObj.value)

    window.speechSynthesis.cancel()
    setCurrentSentenceIdx(0)
    setElapsedSeconds(0)
    setExplanation('')
    setLoadingExplanation(true)
    setPipelineState('PREPARING')

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

  const storageKey = useMemo(() => {
    return `skillbridge_progress_${userId}_${course?.id}`
  }, [course?.id, userId])

  const playbackStorageKey = useMemo(() => {
    return `skillbridge_playback_${userId}_${course?.id}`
  }, [course?.id, userId])

  const getSavedPlayback = (lessonId) => {
    if (!lessonId) return null;
    try {
      const raw = localStorage.getItem(playbackStorageKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data?.lessons?.[String(lessonId)] || data?.lessons?.[Number(lessonId)] || null;
    } catch (e) {
      return null;
    }
  };

  const saveLessonPlayback = (lessonId, sentenceIdx, elapsedSec) => {
    if (!lessonId || !course?.id) return;
    try {
      const raw = localStorage.getItem(playbackStorageKey);
      const data = raw ? JSON.parse(raw) : { lastActiveLessonId: lessonId, lessons: {} };
      if (!data.lessons) data.lessons = {};
      data.lastActiveLessonId = lessonId;
      data.lessons[String(lessonId)] = {
        sentenceIdx: Math.max(0, sentenceIdx || 0),
        elapsedSeconds: Math.max(0, elapsedSec || 0),
        updatedAt: Date.now()
      };
      localStorage.setItem(playbackStorageKey, JSON.stringify(data));
    } catch (e) { }
  };

  const clearLessonPlayback = (lessonId) => {
    if (!lessonId || !course?.id) return;
    try {
      const raw = localStorage.getItem(playbackStorageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.lessons) {
        delete data.lessons[String(lessonId)];
        delete data.lessons[Number(lessonId)];
        localStorage.setItem(playbackStorageKey, JSON.stringify(data));
      }
    } catch (e) { }
  };

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
    clearLessonPlayback(lessonId)
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
        const lessonsCount = course.lessons?.length || (course.curriculum?.length || 1);
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
      // 1. Check if there was a saved active lesson with progress from last session
      try {
        const savedPb = localStorage.getItem(`skillbridge_playback_${userId}_${course?.id}`);
        if (savedPb) {
          const pbData = JSON.parse(savedPb);
          if (pbData?.lastActiveLessonId && course.lessons.some(l => l.id === pbData.lastActiveLessonId)) {
            return pbData.lastActiveLessonId;
          }
        }
      } catch (e) { }

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
  const [lessonVisuals, setLessonVisuals] = useState([])
  const [enlargedVisual, setEnlargedVisual] = useState(null)
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
  const [showCC, setShowCC] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)

  // Centralized Voice Tutor & Always-On Hands-Free states
  const [tutorVoiceState, setTutorVoiceState] = useState(TutorState.IDLE)
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [handsFreeVoice, setHandsFreeVoice] = useState(true)
  const [voiceStatusText, setVoiceStatusText] = useState('')
  const [isAriaSpeaking, setIsAriaSpeaking] = useState(false)

  const requestPlayerFullscreen = () => {
    if (!playerRef.current) return
    if (document.fullscreenElement === playerRef.current) {
      setIsFullscreen(true)
      return
    }
    const doRequest = () => {
      const req = playerRef.current?.requestFullscreen || playerRef.current?.webkitRequestFullscreen
      if (!req) return
      Promise.resolve(req.call(playerRef.current))
        .then(() => setIsFullscreen(true))
        .catch(() => { })
    }

    if (document.fullscreenElement && document.fullscreenElement !== playerRef.current) {
      Promise.resolve(document.exitFullscreen?.())
        .then(() => setTimeout(doRequest, 50))
        .catch(() => doRequest())
    } else {
      doRequest()
    }
  }

  const toggleFullscreen = () => {
    if (!playerRef.current) return
    if (!document.fullscreenElement) {
      requestPlayerFullscreen()
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => { })
    }
  }

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [])

  useEffect(() => {
    if (playing) {
      setChatCollapsed(true)
    } else if (!isFullscreen) {
      setChatCollapsed(false)
    }
  }, [playing, isFullscreen])

  const voiceManagerRef = useRef(null)
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
  const lastAriaSpokenTimeRef = useRef(0)

  // Scroll references for transcripts / chalkboard notes
  const activeSentenceRef = useRef(null)
  const notesScrollRef = useRef(null)

  // Auto-scroll transcripts smoothly as the teacher explains
  useEffect(() => {
    if (activeSentenceRef.current) {
      activeSentenceRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    } else if (notesScrollRef.current) {
      notesScrollRef.current.scrollTo({
        top: notesScrollRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [currentSentenceIdx])

  // Auto-scroll left sidebar curriculum list so recent played scrolls up and current playing is at the top
  const activeLessonListRef = useRef(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeLessonListRef.current) {
        activeLessonListRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        })
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [activeLessonId, course?.lessons])
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
  const chatMessagesRef = useRef(chatMessages)
  const lastProcessedTextRef = useRef('')
  const lastProcessedTimeRef = useRef(0)
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatMessagesRef.current = chatMessages
  }, [chatMessages])

  // Auto-scroll chat to latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  // Keep refs in sync with state
  useEffect(() => {
    handsFreeVoiceRef.current = handsFreeVoice
  }, [handsFreeVoice])

  useEffect(() => {
    isAriaSpeakingRef.current = isAriaSpeaking
  }, [isAriaSpeaking])

  useEffect(() => {
    playingRef.current = playing
    voiceManagerRef.current?.setLecturePlaying(playing)
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

    // Explicitly exclude robotic David and user-disliked Aria voices
    const isDisallowed = (name) => {
      const n = (name || '').toLowerCase()
      return n.includes('aria') || n.includes('david')
    }

    if (l === 'en') {
      const enVoices = voices.filter(v => v.lang.toLowerCase().startsWith('en') && !isDisallowed(v.name))

      // 1. Google US English / Google UK English Female (The authentic Veda gTTS voice)
      const googleVoice = enVoices.find(v => {
        const n = v.name.toLowerCase()
        return n.includes('google us english') || n.includes('google uk english female') || n.includes('google')
      })
      if (googleVoice) {
        console.log(`[VOICE:TTS_VOICE_SELECTED] Chosen voice: ${googleVoice.name} (${googleVoice.lang})`)
        return googleVoice
      }

      // 2. Microsoft Jenny (Natural) - The warm, gentle, authentic educator voice
      const jennyVoice = enVoices.find(v => {
        const n = v.name.toLowerCase()
        return n.includes('jenny') && n.includes('natural')
      })
      if (jennyVoice) {
        console.log(`[VOICE:TTS_VOICE_SELECTED] Chosen voice: ${jennyVoice.name} (${jennyVoice.lang})`)
        return jennyVoice
      }

      // 3. Microsoft Ava / Emma / Sonia / Neerja (Natural)
      const naturalVoice = enVoices.find(v => {
        const n = v.name.toLowerCase()
        return (n.includes('ava') || n.includes('emma') || n.includes('sonia') || n.includes('neerja')) && n.includes('natural')
      })
      if (naturalVoice) {
        console.log(`[VOICE:TTS_VOICE_SELECTED] Chosen voice: ${naturalVoice.name} (${naturalVoice.lang})`)
        return naturalVoice
      }

      // 4. Any other Microsoft Natural female/neutral voice (excluding male voices)
      const anyNatural = enVoices.find(v => {
        const n = v.name.toLowerCase()
        return n.includes('natural') && !n.includes('guy') && !n.includes('christopher') && !n.includes('brian') && !n.includes('male')
      })
      if (anyNatural) {
        console.log(`[VOICE:TTS_VOICE_SELECTED] Chosen voice: ${anyNatural.name} (${anyNatural.lang})`)
        return anyNatural
      }

      // 5. Microsoft Zira Desktop (Clear Windows female voice)
      const ziraVoice = enVoices.find(v => v.name.toLowerCase().includes('zira'))
      if (ziraVoice) {
        console.log(`[VOICE:TTS_VOICE_SELECTED] Chosen voice: ${ziraVoice.name} (${ziraVoice.lang})`)
        return ziraVoice
      }

      // 6. Apple / WebKit natural voices (Samantha, Karen, Victoria)
      const appleVoice = enVoices.find(v => {
        const n = v.name.toLowerCase()
        return n.includes('samantha') || n.includes('karen') || n.includes('victoria')
      })
      if (appleVoice) {
        console.log(`[VOICE:TTS_VOICE_SELECTED] Chosen voice: ${appleVoice.name} (${appleVoice.lang})`)
        return appleVoice
      }

      // 7. Any other non-disallowed English voice (preferring female or neutral)
      const fallbackEn = enVoices.find(v => !v.name.toLowerCase().includes('male')) || enVoices[0]
      if (fallbackEn) {
        console.log(`[VOICE:TTS_VOICE_SELECTED] Chosen voice: ${fallbackEn.name} (${fallbackEn.lang})`)
        return fallbackEn
      }
    } else if (l === 'zh') {
      const zhVoices = voices.filter(v => v.lang.toLowerCase().startsWith('zh') || v.lang.toLowerCase().includes('chinese') || v.lang.toLowerCase().includes('cmn'))
      const bestZh = zhVoices.find(v => v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('xiaoxiao'))
      if (bestZh) return bestZh
      if (zhVoices.length > 0) return zhVoices[0]
    } else if (l === 'ms') {
      const msVoices = voices.filter(v => v.lang.toLowerCase().startsWith('ms') || v.lang.toLowerCase().startsWith('id') || v.lang.toLowerCase().includes('malay') || v.lang.toLowerCase().includes('indonesian'))
      const bestMs = msVoices.find(v => v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('yasmin'))
      if (bestMs) return bestMs
      if (msVoices.length > 0) return msVoices[0]
    } else if (l === 'ta') {
      const taVoices = voices.filter(v => v.lang.toLowerCase().startsWith('ta') || v.lang.toLowerCase().includes('tamil'))
      const bestTa = taVoices.find(v => v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('pallavi'))
      if (bestTa) return bestTa
      if (taVoices.length > 0) return taVoices[0]
    } else if (l === 'bn') {
      const bnVoices = voices.filter(v => v.lang.toLowerCase().startsWith('bn') || v.lang.toLowerCase().includes('bengali') || v.lang.toLowerCase().includes('bangla'))
      const bestBn = bnVoices.find(v => v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('tanishaa'))
      if (bestBn) return bestBn
      if (bnVoices.length > 0) return bnVoices[0]
    }

    const match = voices.find(v => v.lang.toLowerCase().startsWith(l) && !isDisallowed(v.name))
    return match || voices.find(v => v.lang.startsWith('en') && !isDisallowed(v.name)) || voices[0]
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
    voiceManagerRef.current?.setConversationMode(false)
    voiceManagerRef.current?.setAwake(false)
    voiceManagerRef.current?.returnToSleep?.()

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

  const ACKNOWLEDGMENTS = {
    en: "Yes, I'm listening.",
    zh: "我在听，请问有什么可以帮您？",
    ms: "Ya, saya mendengar.",
    ta: "சொல்லுங்கள், நான் கேட்கிறேன்.",
    bn: "হ্যাঁ, বলুন আমি শুনছি।"
  }

  const RESUME_COURSE_PHRASES = {
    en: "Continuing to the course.",
    zh: "正在继续课程。",
    ms: "Menyambung semula kursus.",
    ta: "பாடத்தைத் தொடர்கிறேன்.",
    bn: "কোর্সে ফিরে যাচ্ছি।"
  }

  const speakAriaAnswer = (text, onEndCallback) => {
    if (!text) {
      setIsAriaSpeaking(false)
      isAriaSpeakingRef.current = false
      voiceManagerRef.current?.setTutorSpeaking(false)
      onEndCallback?.()
      return
    }
    try {
      window.speechSynthesis.cancel()
      try { window.speechSynthesis.resume?.() } catch (e) { }
      setIsAriaSpeaking(true)
      isAriaSpeakingRef.current = true

      const cleanText = text
        .replace(/###/g, '')
        .replace(/####/g, '')
        .replace(/\*\*/g, '')
        .replace(/- /g, '')
        .replace(/---/g, '')
        .trim()

      voiceManagerRef.current?.setTutorSpeaking(true, cleanText)
      console.log(`[VOICE:TTS_START] Spoken response in ${preferredLanguage}: "${cleanText.slice(0, 60)}..."`)

      const utterance = new SpeechSynthesisUtterance(cleanText)
      utterance.lang = speechRecognitionLang
      const voices = window.speechSynthesis.getVoices()
      const matchedVoice = selectVoiceForLanguage(voices, selectedLanguageCode)
      if (matchedVoice) utterance.voice = matchedVoice
      utterance.rate = 0.95
      utterance.pitch = 1.0

      // Global reference to prevent browser GC bug
      window._skillbridgeCurrentUtterance = utterance

      let hasFinished = false
      const finishTTS = () => {
        if (hasFinished) return
        hasFinished = true
        if (window._skillbridgeResumeInterval) {
          clearInterval(window._skillbridgeResumeInterval)
          window._skillbridgeResumeInterval = null
        }
        setIsAriaSpeaking(false)
        isAriaSpeakingRef.current = false
        lastAriaSpokenTimeRef.current = Date.now()
        voiceManagerRef.current?.setTutorSpeaking(false, cleanText)
        onEndCallback?.()
      }

      utterance.onend = finishTTS
      utterance.onerror = (err) => {
        console.warn('[VOICE] Speech utterance error:', err)
        finishTTS()
      }

      // Keep Chrome TTS alive during playback
      if (window._skillbridgeResumeInterval) clearInterval(window._skillbridgeResumeInterval)
      window._skillbridgeResumeInterval = setInterval(() => {
        if (isAriaSpeakingRef.current) {
          try { window.speechSynthesis.resume?.() } catch (e) { }
        } else {
          clearInterval(window._skillbridgeResumeInterval)
        }
      }, 2500)

      // Absolute safety timeout: max duration based on character count (min 4s, max 25s)
      const safetyTimeoutMs = Math.min(25000, Math.max(4000, cleanText.length * 75))
      setTimeout(() => {
        if (!hasFinished) {
          console.warn('[VOICE] TTS safety timeout reached. Resetting ARIA speaking state.')
          finishTTS()
        }
      }, safetyTimeoutMs)

      setTimeout(() => {
        try {
          window.speechSynthesis.speak(utterance)
        } catch (speakErr) {
          console.warn('[VOICE] Speech synthesis speak error:', speakErr)
          finishTTS()
        }
      }, 60)
    } catch (e) {
      console.warn('[VOICE] Speech synthesis failed:', e)
      setIsAriaSpeaking(false)
      isAriaSpeakingRef.current = false
      voiceManagerRef.current?.setTutorSpeaking(false)
      onEndCallback?.()
    }
  }

  const interruptLectureAndWake = () => {
    console.log('[VOICE:INTERRUPT] Wake command detected - interrupting lecture and greeting');

    // ==========================================================
    // SAVE COURSE POSITION + STOP COURSE
    // ==========================================================

    if (playingRef.current) {
      wasLecturePlayingRef.current = true;
      savedLecturePositionRef.current = currentSentenceIdxRef.current;
      console.log(`[VOICE:INTERRUPT] Pausing course at Concept ${currentSentenceIdxRef.current + 1}`);

      // Pause course
      setPlaying(false);
      voiceManagerRef.current?.setLecturePlaying(false);
    } else if (isAriaSpeakingRef.current) {
      console.log('[VOICE:INTERRUPT] User interrupted ARIA answer');
      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
    }

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    } catch (e) { }

    // ==========================================================
    // ENTER GREETING & SPEAK "Yes, I'm listening."
    // ==========================================================

    voiceManagerRef.current?.setState(
      TutorState.ARIA_GREETING
    );

    const ack =
      ACKNOWLEDGMENTS[selectedLanguageCode] ||
      ACKNOWLEDGMENTS.en;

    setVoiceStatusText(
      `👋 ARIA: "${ack}"`
    );

    speakAriaAnswer(
      ack,
      () => {
        console.log(
          '[VOICE] Wake acknowledgement finished. Listening for question.'
        );
      }
    );
  };
  const isLectureEcho = (text) => {
    if (!text) return false
    if (voiceManagerRef.current?.isTranscriptSelfEcho?.(text)) return true
    const captured = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
    const capturedWords = captured.split(/\s+/).filter(w => w.length > 3)
    if (capturedWords.length < 4) return false

    const candidates = []
    const sentences = sentencesRef.current || []
    const idx = currentSentenceIdxRef.current || 0
    for (let i = Math.max(0, idx - 1); i <= Math.min(sentences.length - 1, idx + 1); i++) {
      if (sentences[i]) candidates.push(sentences[i])
    }
    for (const msg of (chatMessagesRef.current || []).slice(-4)) {
      if (msg?.sender === 'aria' && msg.text) candidates.push(msg.text)
    }

    for (const candidate of candidates) {
      const n = String(candidate).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
      if (!n || n.length < 12) continue
      if (n.includes(captured) || captured.includes(n.slice(0, 80))) return true
      const sourceWords = n.split(/\s+/).filter(w => w.length > 3)
      if (sourceWords.length < 4) continue
      const sourceSet = new Set(sourceWords)
      const overlap = capturedWords.filter(w => sourceSet.has(w)).length / capturedWords.length
      if (overlap >= 0.45) return true
    }
    return false
  }

  const handleVoiceQuestion = async (userSpeech) => {
    if (!userSpeech || isAnsweringRef.current || isAriaSpeakingRef.current) return
    const rawSpeech = userSpeech.trim()
    if (rawSpeech.length < 3 || isNoiseOrHallucination(rawSpeech)) {
      return
    }

    // Guard against microphone hearing speaker audio right after TTS finishes (reverberation)
    if (Date.now() - (lastAriaSpokenTimeRef.current || 0) < 1800) {
      console.log(`[VOICE:ECHO_REJECTED] Ignored speech captured during/right after TTS playback: "${rawSpeech}"`)
      return
    }
    if (isLectureEcho(rawSpeech)) {
      console.log(`[VOICE:ECHO_REJECTED] Ignored lecture/ARIA echo: "${rawSpeech.slice(0, 80)}..."`)
      return
    }

    // Extra safeguard: discard any audio that is an echo of ARIA's greeting or self-utterance
    const norm = rawSpeech.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?'"“”‘’]/g, ' ').replace(/\s+/g, ' ').trim()
    const selfEchoPhrases = [
      'yes tell me im listening', 'yes tell me i am listening', 'yes tell me',
      'im listening', 'i am listening', 'tell me', 'listening', 'yes', 'yeah',
      'yes im listening', 'yes i am listening',
      'continuing to the course', 'continuing to course', 'resuming course', 'resuming lecture',
      'hello i am aria', 'i am aria', 'i am aria your personal ai tutor',
      'i didnt catch your question can you ask again', 'i didnt catch your question',
      'didnt catch your question', 'can you ask again', 'please ask again',
      'i did not catch a question please ask me something about this lesson',
      'i did not catch a question', 'please ask me something',
      'i m ready to help with your course questions', 'how can i help you', 'what would you like to know',
      'i ll check check check', 'check check check', 'hello dear hello dear', 'hello dear',
      '我在听', '请问有什么可以帮您', '我在听请问', '请问', '正在继续课程', '我没有听清您的提问', '请再问一次',
      'ya saya mendengar', 'sila beritahu saya', 'saya mendengar', 'menyambung semula kursus', 'sila tanya semula',
      'சொல்லுங்கள் நான் கேட்கிறேன்', 'நான் கேட்கிறேன்', 'சொல்லுங்கள்', 'பாடத்தைத் தொடர்கிறேன்', 'மீண்டும் கேளுங்கள்',
      'বলুন আমি শুনছি', 'আমি শুনছি', 'হ্যাঁ বলুন', 'কোর্সে ফিরে যাচ্ছি', 'আবার জিজ্ঞাসা করুন'
    ]
    if (selfEchoPhrases.some(e => norm === e || (norm.length < 35 && (norm.includes(e) || e.includes(norm))))) {
      console.log(`[VOICE:ECHO_REJECTED] Ignored self-greeting echo in handleVoiceQuestion: "${rawSpeech}"`)
      return
    }

    // Reject repetitive word loops (Whisper hallucinations e.g. "check check check")
    const words = norm.split(/\s+/).filter(Boolean)
    const unique = new Set(words)
    if (words.length >= 3 && unique.size <= 1) {
      console.log(`[VOICE:REJECT] Repetitive phrase rejected: "${rawSpeech}"`)
      return
    }
    if (words.length >= 4 && unique.size <= 2) {
      console.log(`[VOICE:REJECT] Low-variety repetitive phrase rejected: "${rawSpeech}"`)
      return
    }

    const lower = rawSpeech.toLowerCase()

    // Voice navigation commands
    if (lower === 'resume' || lower === 'continue' || lower === 'play' || lower === 'carry on' || lower === 'back to lecture') {
      const resumePhrase = RESUME_COURSE_PHRASES[selectedLanguageCode] || RESUME_COURSE_PHRASES.en
      setVoiceStatusText(`▶️ ${resumePhrase}`)
      speakAriaAnswer(resumePhrase, () => {
        resumeLectureFromExactPosition()
        voiceManagerRef.current?.returnToSleep()
      })
      return
    }
    if (lower === 'pause' || lower === 'pause lecture' || lower === 'stop' || lower === 'never mind' || lower === 'goodbye' || lower === 'bye') {
      window.speechSynthesis.cancel()
      setPlaying(false)
      wasLecturePlayingRef.current = false
      setVoiceStatusText('⏸️ Standing by.')
      isAnsweringRef.current = false
      voiceManagerRef.current?.returnToSleep()
      return
    }

    const cleanQuestion = extractQuestionFromWakeWord(rawSpeech) || rawSpeech
    if (!cleanQuestion || cleanQuestion.length < 3 || isNoiseOrHallucination(cleanQuestion)) {
      return
    }

    // Require substance: questions must have at least 2 distinct words or a direct inquiry word
    const cleanWords = cleanQuestion.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)
    const cleanUnique = new Set(cleanWords)
    if (cleanWords.length < 2 && !['why', 'how', 'what', 'who', 'when', 'where', 'help', 'explain'].includes(cleanWords[0])) {
      console.log(`[VOICE:REJECT] Single-word non-question rejected: "${cleanQuestion}"`)
      return
    }
    if (cleanWords.length >= 3 && cleanUnique.size <= 1) {
      console.log(`[VOICE:REJECT] Repetitive question rejected: "${cleanQuestion}"`)
      return
    }

    // Deduplication check: prevent duplicate triggers for identical utterance within 2.5s
    const now = Date.now()
    if (lastProcessedTextRef.current === cleanQuestion.toLowerCase() && (now - lastProcessedTimeRef.current < 2500)) {
      console.log(`[VOICE] Duplicate question ignored: "${cleanQuestion}"`)
      return
    }
    lastProcessedTextRef.current = cleanQuestion.toLowerCase()
    lastProcessedTimeRef.current = now

    // If lecture is playing when question arrives, bookmark position
    if (playingRef.current) {
      wasLecturePlayingRef.current = true
      savedLecturePositionRef.current = currentSentenceIdxRef.current
      window.speechSynthesis.cancel()
      setPlaying(false)
    }

    isAnsweringRef.current = true
    voiceManagerRef.current?.setState(TutorState.PROCESSING)

    // Get current concept being explained on chalkboard
    const currentConceptText = (sentencesRef.current && sentencesRef.current[savedLecturePositionRef.current]) ||
      (sentencesRef.current && sentencesRef.current[currentSentenceIdxRef.current]) ||
      activeLessonRef.current?.title || ''

    setVoiceStatusText(`✨ Question: "${cleanQuestion}"`)
    setChatMessages((prev) => [...prev, { sender: 'user', text: cleanQuestion }])
    setChatLoading(true)
    console.log(`[VOICE:LLM_REQUEST] Sending question to ARIA AI Tutor: "${cleanQuestion}" (Concept: "${currentConceptText.slice(0, 40)}...", Lang: ${preferredLanguage})`)

    try {
      const historyToSend = (chatMessagesRef.current || []).slice(-8)
      const chatRes = await api.chatWithTutor(course.id, {
        message: cleanQuestion,
        lessonTitle: activeLessonRef.current?.title,
        currentConcept: currentConceptText,
        language: selectedLanguageCode,
        conversationHistory: historyToSend
      })
      const ariaAnswer = chatRes.text || chatRes.reply || "I'm ready to help with your course questions!"
      setChatMessages((prev) => [...prev, { sender: 'aria', text: ariaAnswer }])
      setVoiceStatusText('🤖 ARIA is explaining...')
      console.log(`[VOICE] AI response received: "${ariaAnswer.substring(0, 60)}..."`)

      voiceManagerRef.current?.setState(TutorState.ARIA_SPEAKING)

      // Speak ARIA answer with 100% microphone suppression and echo recording
      speakAriaAnswer(ariaAnswer, () => {
        isAnsweringRef.current = false
        if (wasLecturePlayingRef.current) {
          console.log('[VOICE] ARIA answer complete. Speaking continuation notice and resuming course...')
          const resumePhrase = RESUME_COURSE_PHRASES[selectedLanguageCode] || RESUME_COURSE_PHRASES.en
          setVoiceStatusText(`▶️ ${resumePhrase}`)
          setTimeout(() => {
            speakAriaAnswer(resumePhrase, () => {
              resumeLectureFromExactPosition()
              voiceManagerRef.current?.returnToSleep()
            })
          }, 400)
        }
      })
    } catch (err) {
      console.error('[VOICE] ARIA AI Tutor chat error:', err)
      setChatMessages((prev) => [...prev, { sender: 'aria', text: `⚠️ ${err.message || 'The AI tutor is temporarily unavailable. Please try again in a moment.'}` }])
      isAnsweringRef.current = false
      setTimeout(() => {
        if (wasLecturePlayingRef.current) {
          const resumePhrase = RESUME_COURSE_PHRASES[selectedLanguageCode] || RESUME_COURSE_PHRASES.en
          setVoiceStatusText(`▶️ ${resumePhrase}`)
          speakAriaAnswer(resumePhrase, () => {
            resumeLectureFromExactPosition()
            voiceManagerRef.current?.returnToSleep()
          })
        } else {
          voiceManagerRef.current?.returnToSleep()
        }
      }, 1000)
    } finally {
      setChatLoading(false)
    }
  }

  // Centralized Voice Interaction & Always-On Hands-Free Microphone Lifecycle (8-State Machine)
  useEffect(() => {
    if (!handsFreeVoice) {
      if (voiceManagerRef.current) {
        voiceManagerRef.current.destroy()
        voiceManagerRef.current = null
      }
      setVoiceStatusText('')
      return
    }

    console.log(`[VOICE] Initializing 8-State ARIA voice manager in ${preferredLanguage} (${speechRecognitionLang})...`)
    setVoiceStatusText(`🎙️ Always-On Mic Active (${currentLangObj.native}) — Say "Hey ARIA" anytime!`)

    const manager = new VoiceTutorManager({
      debug: true,
      followUpTimeoutMs: 7000,
      onWakeWordDetected: (wakePhrase) => {
        console.log(`[VOICE:WAKE_MATCH] Wake phrase received: "${wakePhrase}". Transitioning to greeting...`)
        interruptLectureAndWake()
      },
      onAudioCaptured: async (audioBlob, context = {}) => {
        if (isTranscribingRef.current) return
        isTranscribingRef.current = true
        try {
          const isWakeDetection = context.isWakeDetection || manager.state === TutorState.SLEEPING
          console.log(`[VOICE:TRANSCRIPTION] Transcribing user audio with faster-whisper (${selectedLanguageCode}, size: ${audioBlob.size}B, isWakeDetection: ${isWakeDetection})...`)
          const res = await api.transcribeSpeech(audioBlob, selectedLanguageCode)
          const transcription = (res?.text || '').trim()
          console.log(`[VOICE:TRANSCRIPTION] Result: "${transcription}"`)

          if (!transcription || isNoiseOrHallucination(transcription) || transcription.length < 3) {
            if (!isWakeDetection && manager.state !== TutorState.SLEEPING) {
              manager.setState(TutorState.FOLLOW_UP_LISTENING)
              manager.resetFollowUpTimeout()
            } else if (manager.state === TutorState.PROCESSING) {
              manager.returnToSleep()
            }
            return
          }

          if (playingRef.current || isAriaSpeakingRef.current || isLectureEcho(transcription)) {
            if (containsWakeWord(transcription) && playingRef.current) {
              interruptLectureAndWake()
              const cleanQuestion = extractQuestionFromWakeWord(transcription)
              if (cleanQuestion && cleanQuestion.length >= 2 && !isNoiseOrHallucination(cleanQuestion) && !isLectureEcho(cleanQuestion)) {
                setTimeout(() => handleVoiceQuestion(cleanQuestion), 1600)
              }
            } else {
              console.log(`[VOICE:ECHO_REJECTED] Ignored lecture/TTS capture: "${transcription.slice(0, 80)}"`)
              if (manager.state === TutorState.PROCESSING) {
                manager.returnToSleep()
              }
            }
            return
          }

          if (isWakeDetection) {
            if (containsWakeWord(transcription)) {
              console.log(`[VOICE:WAKE_MATCH] Whisper wake word detected: "${transcription}". Interrupting course lecture...`)
              interruptLectureAndWake()

              const cleanQuestion = extractQuestionFromWakeWord(transcription)
              if (cleanQuestion && cleanQuestion.length >= 3 && !isNoiseOrHallucination(cleanQuestion) && !isLectureEcho(cleanQuestion)) {
                console.log(`[VOICE] Wake phrase included question: "${cleanQuestion}". Forwarding to AI Tutor after greeting...`)
                setTimeout(() => {
                  handleVoiceQuestion(cleanQuestion)
                }, 1600)
              }
            } else {
              console.log(`[VOICE:WAKE_IGNORE] No wake word in audio: "${transcription}". Staying in SLEEPING.`)
              if (manager.state === TutorState.PROCESSING) {
                manager.returnToSleep()
              }
            }
            return
          }

          handleVoiceQuestion(transcription)
        } catch (err) {
          console.error('[VOICE] Whisper transcription failed:', err)
          if (manager.state !== TutorState.SLEEPING) {
            manager.setState(TutorState.FOLLOW_UP_LISTENING)
            manager.resetFollowUpTimeout()
          }
        } finally {
          isTranscribingRef.current = false
        }
      },
      onQuestionReady: (questionText) => {
        handleVoiceQuestion(questionText)
      },
      onReturnToSleep: () => {
        console.log('[VOICE:RETURN_TO_SLEEP] Conversational window ended. Returning to SLEEPING.')
        if (wasLecturePlayingRef.current) {
          console.log(`[VOICE] Auto-resuming course lecture from Concept ${savedLecturePositionRef.current + 1}...`)
          const resumePhrase = RESUME_COURSE_PHRASES[selectedLanguageCode] || RESUME_COURSE_PHRASES.en
          setVoiceStatusText(`▶️ ${resumePhrase}`)
          speakAriaAnswer(resumePhrase, () => {
            resumeLectureFromExactPosition()
          })
        } else {
          setVoiceStatusText(`🎙️ Always-On Mic Active (${currentLangObj.native}) — Say "Hey ARIA" anytime!`)
        }
      }
    })

    manager.onStateChange((newState) => {
      setTutorVoiceState(newState)
      if (newState === TutorState.SLEEPING) {
        setVoiceStatusText(`🎙️ Always-On Mic Active (${currentLangObj.native}) — Say "Hey ARIA" anytime!`)
      } else if (newState === TutorState.WAKE_DETECTED) {
        setVoiceStatusText('✨ "Hey ARIA" Detected! Waking up...')
      } else if (newState === TutorState.ARIA_GREETING) {
        const ack = ACKNOWLEDGMENTS[selectedLanguageCode] || ACKNOWLEDGMENTS.en
        setVoiceStatusText(`👋 ARIA: "${ack}"`)
      } else if (newState === TutorState.ACTIVE_LISTENING) {
        setVoiceStatusText(`👂 Listening for your question (${currentLangObj.native})...`)
      } else if (newState === TutorState.PROCESSING) {
        setVoiceStatusText('⚡ ARIA is searching course knowledge...')
      } else if (newState === TutorState.ARIA_SPEAKING) {
        setVoiceStatusText('🗣️ ARIA is explaining...')
      } else if (newState === TutorState.FOLLOW_UP_LISTENING) {
        setVoiceStatusText('💬 Ask a follow-up question, or wait to resume lecture...')
      } else if (newState === TutorState.RETURN_TO_SLEEP) {
        setVoiceStatusText('💤 Returning to standby mode...')
      } else if (newState === TutorState.ERROR) {
        setVoiceStatusText('⚠️ Microphone unavailable or permission denied.')
      }
    })

    manager.start(speechRecognitionLang)
    voiceManagerRef.current = manager

    return () => {
      if (voiceManagerRef.current) {
        voiceManagerRef.current.destroy()
        voiceManagerRef.current = null
      }
    }
  }, [handsFreeVoice, speechRecognitionLang, selectedLanguageCode, currentLangObj])

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
      lessonOpenTimestampRef.current = performance.now();
      const langCode = selectedLanguageCode || 'en';
      const cacheKey = `${course.id}_${activeLesson.id}_${langCode}`;

      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
      try { window.speechSynthesis.cancel(); } catch (e) { }

      // Restore saved playback for this lesson if previously stopped
      const savedPb = getSavedPlayback(activeLesson.id);
      const isDone = isLessonDone(activeLesson.id);
      const restoredSentence = (savedPb && typeof savedPb.sentenceIdx === 'number' && !isDone) ? savedPb.sentenceIdx : 0;
      const restoredElapsed = (savedPb && typeof savedPb.elapsedSeconds === 'number' && !isDone) ? savedPb.elapsedSeconds : 0;

      if (restoredSentence > 0 || restoredElapsed > 0) {
        console.log(`[Playback Resume] Resumed Lesson ${activeLesson.id} ("${activeLesson.title}") at Concept ${restoredSentence + 1} (${restoredElapsed}s elapsed)`);
      }

      setElapsedSeconds(restoredElapsed);
      elapsedSecondsRef.current = restoredElapsed;
      setCurrentSentenceIdx(restoredSentence);
      currentSentenceIdxRef.current = restoredSentence;

      // 1. Check in-memory instant client cache
      const memoryCached = lessonExplanationClientCache.get(cacheKey);

      // 2. Check if already present on activeLesson from course payload
      const propCached = activeLesson.explanations?.[langCode] ||
        (langCode === 'en' ? activeLesson.explanation : null);

      const candidateScript = memoryCached || (typeof propCached === 'string' && propCached.length > 30 ? propCached : null);
      const immediateScript = (candidateScript && textMatchesLanguage(candidateScript, langCode))
        ? candidateScript
        : null;
      if (memoryCached && !immediateScript) {
        lessonExplanationClientCache.delete(cacheKey);
      }

      if (immediateScript) {
        console.log(`[PERF:LESSON_FETCH_START] [CLIENT_CACHE_HIT] Course: ${course.id}, Lesson: ${activeLesson.id} ("${activeLesson.title}"), Lang: ${langCode}`);
        setExplanation(immediateScript);
        setLessonVisuals(activeLesson.visuals || []);
        setLoadingExplanation(false);
        setPipelineState('READY');
        const duration = Math.round(performance.now() - lessonOpenTimestampRef.current);
        console.log(`[PERF:LESSON_FETCH_END] [CLIENT_CACHE_HIT] Retrieved instant lesson script in ${duration}ms (0 network / 0 LLM calls)`);
        return;
      }

      // 3. Fallback: Fetch from backend (which checks PostgreSQL Course.curriculum cache before RAG)
      console.log(`[PERF:LESSON_FETCH_START] [NETWORK] Requesting lesson script for "${activeLesson.title}" (Course: ${course.id}, Lang: ${preferredLanguage})`);
      setLoadingExplanation(true);
      setPipelineState('PREPARING');
      setExplanation('');
      setLessonVisuals(activeLesson.visuals || []);

      const fetchReqStartTime = performance.now();
      const requestLang = langCode;
      api.getLessonExplanation(course.id, activeLesson.id, activeLesson.title, requestLang)
        .then(res => {
          if (selectedLanguageCodeRef.current !== requestLang) return;
          const fetchReqDuration = Math.round(performance.now() - fetchReqStartTime);
          console.log(`[PERF:LESSON_FETCH_END] Received lesson script from backend in ${fetchReqDuration}ms (Backend DB Cached: ${res.cached ? 'YES' : 'NO'})`);
          const script = res.explanation || '';
          if (script && !textMatchesLanguage(script, requestLang)) {
            console.warn(`[Language Lock] Ignoring mixed-language lesson script for ${requestLang}`);
          }
          lessonExplanationClientCache.set(cacheKey, script);
          setExplanation(script);
          setLessonVisuals(res.visuals || activeLesson.visuals || []);
          setLoadingExplanation(false);
          setPipelineState('READY');
        })
        .catch(err => {
          console.error('Failed to load dynamic lesson explanation:', err);
          const fallbackText = 'Frontend: Client-side logic (React, HTML/CSS, JavaScript)\nBackend: Server-side logic (Node.js, Express, API routes)\nDatabase: Storing data (SQL vs NoSQL, schema design)';
          setExplanation(fallbackText);
          setLessonVisuals(activeLesson.visuals || []);
          setLoadingExplanation(false);
          setPipelineState('READY');
        });
    }
  }, [course, activeLessonId, preferredLanguage, selectedLanguageCode]);

  // Complete Unicode regex matching all emojis
  const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{FE00}-\u{FE0F}]/gu

  // Helper to clean raw text for Speech TTS (removes hashtags, references, markdown symbols, and emojis that TTS speaks out loud)
  const cleanForSpeech = (text) => {
    if (!text) return ''
    return text
      .replace(EMOJI_REGEX, '')
      .replace(/\*?\(Reference:[^\)]*\)\*?/gi, '')
      .replace(/#+/g, '')
      .replace(/[\*_~`]+/g, '')
      .replace(/^[-\*•➔>+:\s]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Helper to clean raw text for Chalkboard Display (removes emojis, references, #, ###, markdown symbols)
  const cleanForBoard = (text) => {
    if (!text) return ''
    return text
      .replace(EMOJI_REGEX, '')
      .replace(/\*?\(Reference:[^\)]*\)\*?/gi, '')
      .replace(/^[#*•➔>+-\s]+/, '')
      .replace(/#+/g, '')
      .replace(/[\*_~`]+/g, '')
      .replace(/^[•\-\*\s]+/, '')
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

  // Intelligently determine which visual to display for the active spoken sentence/concept
  const activeVisual = useMemo(() => {
    const list = (lessonVisuals && lessonVisuals.length > 0) ? lessonVisuals : (activeLesson?.visuals || []);
    if (!list || list.length === 0) return null;

    const sizeOf = (vis) => vis.sizeBytes || (typeof vis.dataUrl === 'string' ? vis.dataUrl.length : 0);
    const isFullSlide = (vis) =>
      String(vis.id || '').startsWith('full_slide') ||
      String(vis.id || '').startsWith('full_page') ||
      String(vis.purpose || '').toLowerCase().includes('exact powerpoint') ||
      String(vis.purpose || '').toLowerCase().includes('exact document page');

    const photos = list.filter((vis) =>
      (vis.dataUrl || vis.url) && (isFullSlide(vis) || sizeOf(vis) >= 50000)
    );
    const pool = photos.length > 0 ? photos : list.filter((vis) => vis.dataUrl || vis.url);
    if (pool.length === 0) return null;

    const ranked = [...pool].sort((a, b) => {
      if (isFullSlide(a) !== isFullSlide(b)) return isFullSlide(a) ? -1 : 1;
      return sizeOf(b) - sizeOf(a);
    });

    if (ranked.length === 1) return ranked[0];

    const sourceSlides = Array.isArray(activeLesson?.sourceSlides) ? activeLesson.sourceSlides : [];
    if (sourceSlides.length > 0) {
      const bySlide = ranked.find((vis) => sourceSlides.includes(vis.sourceSlide || vis.sourcePage));
      if (bySlide) return bySlide;
    }

    return ranked[0];
  }, [lessonVisuals, activeLesson?.visuals, activeLesson?.sourceSlides]);

  const getRealLessonDurationStr = (lesson, activeExp = null, idx = 0) => {
    // Check active loaded explanation, or the lesson's stored explanation
    const expText = (activeExp && activeExp.length > 30)
      ? activeExp
      : (lesson?.explanation || lesson?.explanations?.en || '');

    if (expText && expText.length > 30) {
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

    // Deterministic fallback
    const baseSecs = 65 + ((idx * 17) % 55);
    const m = Math.floor(baseSecs / 60).toString().padStart(2, '0');
    const s = Math.floor(baseSecs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
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

  // Continuously persist current playback position when sentence or time advances
  useEffect(() => {
    if (activeLesson?.id && !isLessonDone(activeLesson.id) && (currentSentenceIdx > 0 || elapsedSeconds > 0)) {
      saveLessonPlayback(activeLesson.id, currentSentenceIdx, elapsedSeconds);
    }
  }, [activeLesson?.id, currentSentenceIdx, elapsedSeconds]);

  // Align elapsedSeconds when concept index changes during active playback
  useEffect(() => {
    if (!loadingExplanation && sentences.length > 0 && totalSeconds > 0 && playing) {
      const sentenceSec = Math.min(
        totalSeconds,
        Math.round((currentSentenceIdx / Math.max(1, sentences.length)) * totalSeconds)
      );
      setElapsedSeconds(sentenceSec);
      elapsedSecondsRef.current = sentenceSec;
    }
  }, [currentSentenceIdx, loadingExplanation, sentences.length, totalSeconds, playing]);

  // Real-time second-by-second ticking ONLY when playing and actively speaking
  useEffect(() => {
    if (!playing || loadingExplanation || loadingQuiz || !isAriaSpeaking) return;

    const interval = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= totalSeconds) {
          return totalSeconds;
        }
        elapsedSecondsRef.current = next;
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [playing, loadingExplanation, loadingQuiz, isAriaSpeaking, totalSeconds]);

  const formatTime = (s) => {
    const total = Math.max(0, Math.round(s || 0));
    const mins = Math.floor(total / 60).toString().padStart(2, '0');
    const secs = Math.floor(total % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const formattedTimeString = useMemo(() => {
    if (loadingExplanation) {
      return `00:00 / ${activeRealDurationStr}`;
    }
    return `${formatTime(elapsedSeconds)} / ${formatTime(totalSeconds)}`;
  }, [loadingExplanation, elapsedSeconds, totalSeconds, activeRealDurationStr]);

  const utteranceRef = useRef(null);

  const handleTogglePlay = () => {
    if (!playing) {
      if (currentSentenceIdx >= sentences.length - 1 && elapsedSeconds >= totalSeconds - 1) {
        setCurrentSentenceIdx(0);
        currentSentenceIdxRef.current = 0;
        setElapsedSeconds(0);
        elapsedSecondsRef.current = 0;
      }
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      } catch (e) { }
      setPlaying(true);
      setChatCollapsed(true);
      requestPlayerFullscreen();
    } else {
      try {
        window.speechSynthesis.cancel();
      } catch (e) { }
      setPlaying(false);
      if (activeLesson?.id && !isLessonDone(activeLesson.id)) {
        saveLessonPlayback(activeLesson.id, currentSentenceIdxRef.current, elapsedSecondsRef.current);
      }
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

          const currentIdx = course.lessons.findIndex(l => l.id === activeLesson?.id);
          const nextLesson = course.lessons[currentIdx + 1];
          const currentModule = activeLesson?.moduleTitle || activeLesson?.chapterTitle || '';
          const nextModule = nextLesson?.moduleTitle || nextLesson?.chapterTitle || '';
          const isLastLessonOfModule = !nextLesson || (currentModule !== nextModule);

          if (isLastLessonOfModule) {
            console.log('[CoursePlayer] Chapter lecture completed! Opening chapter assessment...');
            setVoiceStatusText('🎉 Chapter complete! Preparing your assessment, please wait...');
            setLoadingQuiz(true);
            setTimeout(() => {
              if (handleTakeChapterAssessmentRef.current) {
                handleTakeChapterAssessmentRef.current();
              }
            }, 600);
          } else if (nextLesson) {
            console.log('[CoursePlayer] Lesson completed! Advancing to next lesson in chapter:', nextLesson.title);
            setVoiceStatusText(`✅ Lesson completed! Advancing to: ${nextLesson.title}...`);
            setTimeout(() => {
              setActiveLessonId(nextLesson.id);
              setCurrentSentenceIdx(0);
              setElapsedSeconds(0);
              setPlaying(true);
            }, 800);
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
          const ttsStartTime = performance.now();
          console.log(`[PERF:TTS_START] Concept ${idx + 1}/${sentences.length}: "${spokenText.slice(0, 40)}..."`);

          window.speechSynthesis.cancel();
          window.speechSynthesis.resume();

          // Check if utterance is already pre-warmed in cache pool
          const poolKey = `${course?.id}_${activeLesson?.id}_${selectedLanguageCode}_${idx}`;
          let utterance = ttsUtterancePool.get(poolKey);
          if (!utterance) {
            utterance = new SpeechSynthesisUtterance(spokenText);
            const voices = window.speechSynthesis.getVoices();
            const matchedVoice = selectVoiceForLanguage(voices, preferredVoiceLangCode);
            if (matchedVoice) {
              utterance.voice = matchedVoice;
              utterance.lang = matchedVoice.lang;
            } else {
              utterance.lang = SPEECH_LANGUAGES[selectedLanguageCode] || 'en-US';
            }
            utterance.rate = 0.95;
            utterance.pitch = 1.0;
          }
          utteranceRef.current = utterance; // Prevent GC cancellation bug

          utterance.onstart = () => {
            if (isCancelled) return;
            voiceManagerRef.current?.noteSpokenText?.(spokenText);
            const ttsDuration = Math.round(performance.now() - ttsStartTime);
            console.log(`[PERF:TTS_END] TTS audio synthesis started in ${ttsDuration}ms`);
            const startupLatency = lessonOpenTimestampRef.current ? Math.round(performance.now() - lessonOpenTimestampRef.current) : 0;
            console.log(`[PERF:PLAYBACK_START] Playback active (Concept ${idx + 1}/${sentences.length}, Total Startup Latency: ${startupLatency}ms)`);
            setIsAriaSpeaking(true);
            isAriaSpeakingRef.current = true;
            voiceManagerRef.current?.noteSpokenText?.(spokenText);
            setPipelineState('PLAYING');

            // Background pre-warming of next concept without blocking current playback
            if (idx + 1 < sentences.length) {
              const nextSpoken = cleanForSpeech(sentences[idx + 1]);
              if (nextSpoken) {
                const preStartTime = performance.now();
                console.log(`[PERF:AUDIO_LOAD_START] Pre-warming upcoming Concept ${idx + 2}/${sentences.length} audio in background`);
                const nextUtterance = new SpeechSynthesisUtterance(nextSpoken);
                const voices = window.speechSynthesis.getVoices();
                const matchedVoice = selectVoiceForLanguage(voices, preferredVoiceLangCode);
                if (matchedVoice) {
                  nextUtterance.voice = matchedVoice;
                  nextUtterance.lang = matchedVoice.lang;
                } else {
                  nextUtterance.lang = SPEECH_LANGUAGES[selectedLanguageCode] || 'en-US';
                }
                nextUtterance.rate = 0.95;
                nextUtterance.pitch = 1.0;
                ttsUtterancePool.set(`${course?.id}_${activeLesson?.id}_${selectedLanguageCode}_${idx + 1}`, nextUtterance);
                const preDuration = Math.round(performance.now() - preStartTime);
                console.log(`[PERF:AUDIO_LOAD_END] Concept ${idx + 2} pre-warmed in ${preDuration}ms`);
              }
            }
          };

          utterance.onend = () => {
            if (isCancelled || !playingRef.current) return;
            setIsAriaSpeaking(false);
            isAriaSpeakingRef.current = false;
            lastAriaSpokenTimeRef.current = Date.now();
            setCurrentSentenceIdx((prev) => {
              const next = prev + 1;
              if (playingRef.current && !isCancelled) {
                speak(next);
              }
              return next;
            });
          };

          utterance.onerror = (e) => {
            if (e?.error === 'canceled' || e?.error === 'interrupted') return;
            console.warn('Speech synthesis error:', e);
            if (isCancelled || !playingRef.current) return;
            setIsAriaSpeaking(false);
            isAriaSpeakingRef.current = false;
            setTimeout(() => {
              if (isCancelled || !playingRef.current) return;
              setCurrentSentenceIdx((prev) => {
                const next = prev + 1;
                if (playingRef.current && !isCancelled) {
                  speak(next);
                }
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
        setIsAriaSpeaking(false);
        isAriaSpeakingRef.current = false;
        try { window.speechSynthesis.cancel(); } catch (e) { }
      };
    } else {
      try { window.speechSynthesis.cancel(); } catch (e) { }
    }
  }, [playing, muted, sentences, currentSentenceIdx, loadingExplanation, selectedLanguageCode]);

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

  const activeLessonIndex = useMemo(() => {
    if (!course?.lessons || !activeLesson) return 0
    const idx = course.lessons.findIndex(l => l.id === activeLesson.id)
    return idx >= 0 ? idx : 0
  }, [course?.lessons, activeLesson])

  const isNavigatingAssessmentRef = useRef(false)

  const handleTakeChapterAssessment = async () => {
    if (!activeLesson || isNavigatingAssessmentRef.current) return
    isNavigatingAssessmentRef.current = true
    setPlaying(false)
    window.speechSynthesis?.cancel()
    if (voiceManagerRef.current) {
      voiceManagerRef.current.setLecturePlaying(false)
    }
    setLoadingQuiz(true)
    markLessonCompleted(activeLesson.id)

    const currentIdx = course.lessons.findIndex(l => l.id === activeLesson.id)
    const nextLesson = course.lessons[currentIdx + 1]
    const nextLessonId = nextLesson ? nextLesson.id : null

    try {
      const quizRes = await api.getLessonQuiz(course.id, activeLesson.id, activeLesson.title, selectedLanguageCode)
      setLoadingQuiz(false)
      onAssessment?.(course, activeLesson, quizRes?.quiz || null, nextLessonId)
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
      language: selectedLanguageCode,
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
            voiceManagerRef.current?.setState?.(TutorState.FOLLOW_UP_LISTENING)
            setVoiceStatusText('💬 ARIA is listening for follow-up (or say "Resume")...')
            followUpTimerRef.current = setTimeout(() => {
              voiceManagerRef.current?.returnToSleep?.()
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
        setChatMessages(prev => [...prev, { sender: 'aria', text: `⚠️ ${err.message || 'The AI tutor is temporarily unavailable. Please try again in a moment.'}` }])
        setChatLoading(false)
        setTimeout(() => {
          resumeLectureFromExactPosition()
        }, 1500)
      })
  }

  // Comprehensive Back button exit handler ensuring immediate speech cancellation
  const handleExit = () => {
    console.log('[CoursePlayer] Back button clicked: halting all speech synthesis and audio streams.');
    try {
      window.speechSynthesis?.cancel?.();
    } catch (e) { }

    if (window._skillbridgeResumeInterval) {
      clearInterval(window._skillbridgeResumeInterval);
      window._skillbridgeResumeInterval = null;
    }
    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = null;
    }
    if (awakeTimerRef.current) {
      clearTimeout(awakeTimerRef.current);
      awakeTimerRef.current = null;
    }

    setPlaying(false);
    playingRef.current = false;
    setIsAriaSpeaking(false);
    isAriaSpeakingRef.current = false;
    isAnsweringRef.current = false;
    wasLecturePlayingRef.current = false;

    if (voiceManagerRef.current) {
      try {
        voiceManagerRef.current.destroy();
      } catch (e) { }
      voiceManagerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) { }
      mediaRecorderRef.current = null;
    }

    if (micStreamRef.current) {
      try {
        micStreamRef.current.getTracks().forEach(t => t.stop());
      } catch (e) { }
      micStreamRef.current = null;
    }

    if (activeLessonRef.current?.id && !isLessonDone(activeLessonRef.current.id)) {
      saveLessonPlayback(activeLessonRef.current.id, currentSentenceIdxRef.current, elapsedSecondsRef.current);
      console.log(`[CoursePlayer] Saved progress on exit for Lesson ${activeLessonRef.current.id} at Concept ${currentSentenceIdxRef.current + 1} (${elapsedSecondsRef.current}s)`);
    }

    onExit?.();
  };

  // Unified module grouping for course curriculum
  const moduleGroups = useMemo(() => {
    if (!course.lessons || !course.lessons.length) return []
    const groups = []
    let currentGroup = null

    course.lessons.forEach((lesson, index) => {
      const rawModule = lesson.moduleTitle || lesson.chapterTitle || 'Module 1'
      if (!currentGroup || currentGroup.moduleTitle !== rawModule) {
        currentGroup = {
          moduleTitle: rawModule,
          lessons: []
        }
        groups.push(currentGroup)
      }
      currentGroup.lessons.push({ lesson, index })
    })

    return groups
  }, [course.lessons])

  return (
    <div className="min-h-screen lg:h-screen lg:max-h-screen overflow-y-auto lg:overflow-hidden bg-[#f4f7fc] text-[#0f172a] select-none flex flex-col font-sans">
      {/* Sub-header Navigation with Active Language Selector */}
      <div className="shrink-0 w-full px-3 sm:px-4 pt-1.5 sm:pt-2 pb-1 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleExit}
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

      {/* Main 3-Column Grid Layout - Dynamically Proportioned for Scaled Screens */}
      <main className={`w-full px-3 sm:px-4 pb-2.5 sm:pb-3 grid grid-cols-1 gap-2.5 sm:gap-3 flex-1 min-h-0 overflow-visible lg:overflow-hidden ${chatCollapsed
          ? 'lg:grid-cols-[210px_1fr_52px] xl:grid-cols-[240px_1fr_52px]'
          : 'lg:grid-cols-[210px_1fr_240px] xl:grid-cols-[240px_1fr_260px]'
        }`}>

        {/* LEFT COLUMN: Course Card & Modules List */}
        <section className="bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-3.5 shadow-xs flex flex-col min-h-[220px] lg:h-full lg:min-h-0 overflow-hidden">
          {/* Course Info Header Box */}
          <div className="shrink-0 space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-[#2563eb] text-white flex items-center justify-center shadow-xs">
                <CourseBookIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xs font-bold text-slate-900 leading-snug truncate">{course.title}</h1>
                <p className="text-[11px] text-slate-400 font-medium">
                  {course.chapters?.length
                    ? `${course.chapters.length} Chapters • ${course.lessons?.length || 0} Lessons`
                    : `${course.lessons?.length || 0} Lessons`}
                </p>
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

          {/* Course Content Section - Unified Module Groups */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-900">Curriculum Lessons</h2>
              <span className="text-[10px] text-slate-400 font-semibold">
                {course.lessons?.length || 0} Total
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5 no-scrollbar">
              {moduleGroups.map((group, gIdx) => (
                <div key={gIdx} className="space-y-1.5">
                  {/* Unified Module Group Header */}
                  <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
                    <span className="text-[10px] font-bold text-[#ff8c21] uppercase tracking-wide truncate max-w-[80%]" title={group.moduleTitle}>
                      {group.moduleTitle.replace(/^Module\s*/i, 'Mod ')}
                    </span>
                    <span className="text-[9px] font-semibold text-slate-400">
                      {group.lessons.length} {group.lessons.length === 1 ? 'lesson' : 'lessons'}
                    </span>
                  </div>

                  {/* Clean Lesson Items Inside This Module */}
                  <ul className="space-y-1.5">
                    {group.lessons.map(({ lesson, index }) => {
                      const isActive = lesson.id === activeLesson?.id
                      const isCompleted = isLessonDone(lesson.id) || lesson.status === 'done'
                      const prevLessonDone = Boolean(index > 0 && (isLessonDone(course.lessons[index - 1]?.id) || course.lessons[index - 1]?.status === 'done'))
                      const isUnlocked = index === 0 || isCompleted || prevLessonDone || index <= highestUnlockedIdx

                      return (
                        <li key={lesson.id} ref={isActive ? activeLessonListRef : null}>
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
                                setChatCollapsed(true)
                                requestPlayerFullscreen()
                              }
                            }}
                            className={`w-full flex items-center gap-2 p-2.5 rounded-xl border text-left transition cursor-pointer ${isActive
                              ? 'bg-[#eff6ff] border-blue-200 shadow-2xs font-semibold'
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

                            {/* Clean Numbered Lesson Title & Duration */}
                            <div className="min-w-0 flex-1">
                              <p className={`text-[11px] leading-snug truncate ${isActive ? 'font-bold text-slate-900' : 'font-medium text-slate-800'}`}>
                                {index + 1}. {lesson.title}
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
              ))}
            </div>
          </div>
        </section>

        {/* CENTER COLUMN: ENLARGED Video/Slide Play Screen */}
        <section className="flex flex-col h-full min-h-0 overflow-hidden gap-2">
          {/* Active Lesson Header & Hands-Free Status Banner */}
          <div className="shrink-0 flex flex-col gap-0.5">
            {(activeLesson?.chapterTitle || activeLesson?.moduleTitle) && (
              <span className="text-[10px] font-bold text-[#ff8c21] uppercase tracking-wider truncate">
                {activeLesson.chapterTitle || activeLesson.moduleTitle}
              </span>
            )}
            <h2 className="text-base font-bold text-slate-900 leading-snug truncate">
              {activeLesson?.title || 'Introduction to Lesson Topics'}
            </h2>
          </div>

          {/* ENLARGED CENTER LECTURE SLIDE VIDEO PLAYER UI WITH Sleek CONTROL BAR */}
          <div ref={playerRef} className="flex-1 min-h-0 bg-[#0f172a] text-white rounded-2xl border border-slate-800 shadow-md relative overflow-hidden flex flex-col justify-between">
            {/* Chapter Completed - Waiting for Assessment Overlay */}
            {loadingQuiz && (
              <div className="absolute inset-0 z-40 bg-[#070d1e]/95 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 select-none animate-fadeIn">
                <div className="relative mb-4">
                  <div className="h-16 w-16 rounded-2xl bg-[#ff8c21]/20 border border-[#ff8c21]/40 text-[#ff8c21] flex items-center justify-center text-3xl shadow-lg">
                    📝
                  </div>
                  <span className="absolute -top-1 -right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff8c21] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-[#ff8c21]"></span>
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ff8c21]/15 border border-[#ff8c21]/30 text-[#ff8c21] text-xs font-bold uppercase tracking-wider mb-2">
                  🎉 Chapter Completed!
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
                  Please Wait for Assessment
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 max-w-md mb-5 leading-relaxed">
                  Great job finishing this chapter! ARIA is preparing your personalized chapter assessment. The quiz will start automatically in a few seconds...
                </p>
                <div className="flex items-center gap-3 bg-slate-800/90 border border-slate-700/80 px-4 py-2 rounded-xl text-xs font-medium text-slate-300 shadow-inner">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#ff8c21]/20 border-t-[#ff8c21]" />
                  <span>Preparing chapter assessment questions...</span>
                </div>
              </div>
            )}

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

            <div className="p-3 sm:p-4 lg:p-5 flex flex-col flex-1 min-h-0 justify-between">
              {/* Split Content: Presentation Slide (Left) & ARIA Tutor Avatar (Right) */}
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 lg:gap-5 items-center my-0.5 sm:my-1">
                {/* Left Presentation Chalkboard Container */}
                <div className="md:col-span-7 lg:col-span-8 bg-[#0b1329] rounded-2xl border-2 border-slate-700/80 p-3 sm:p-4 lg:p-5 h-full flex flex-col justify-between overflow-hidden shadow-2xl relative min-h-[160px]">
                  {/* Blackboard Top Header */}
                  <div className="shrink-0 flex items-center justify-between border-b border-slate-700/80 pb-1.5 sm:pb-2 mb-1.5 sm:mb-2">
                    <span className="text-[10px] sm:text-[11px] font-bold text-[#ff8c21] tracking-wider uppercase flex items-center gap-2 truncate max-w-[70%]">
                      <span className="h-2 w-2 rounded-full bg-[#ff8c21] shrink-0 animate-pulse" />
                      <span className="truncate">{activeLesson?.title || 'Lecture Concepts'}</span>
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                      NOTE {currentSentenceIdx + 1} / {sentences.length}
                    </span>
                  </div>

                  {/* Interactive Board Notes List & PPT Visual Display */}
                  {loadingExplanation ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 sm:p-6 space-y-2.5 sm:space-y-3 select-none">
                      <div className="h-7 w-7 sm:h-8 sm:w-8 animate-spin rounded-full border-2 border-[#ff8c21]/20 border-t-[#ff8c21]" />
                      <p className="text-xs font-semibold text-slate-300">
                        ARIA is preparing lesson notes & speech...
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
                      {/* PPT Slide Visual Display Card (When concept visual exists) */}
                      {activeVisual && (activeVisual.dataUrl || activeVisual.url) ? (
                        <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
                          <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950/80 shadow-lg relative group flex flex-col">
                            <div className="relative flex-1 min-h-0 flex items-center justify-center p-2 bg-black/40 overflow-hidden">
                              <img
                                src={activeVisual.dataUrl || activeVisual.url}
                                alt={activeVisual.descr || activeVisual.name || 'Presentation Slide'}
                                className="max-h-full max-w-full w-auto h-auto object-contain rounded-lg shadow-xl cursor-zoom-in hover:scale-[1.01] transition-transform duration-200"
                                onClick={() => setEnlargedVisual(activeVisual)}
                                title="Click to view full-resolution slide"
                              />
                              <button
                                type="button"
                                onClick={() => setEnlargedVisual(activeVisual)}
                                className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-slate-950/85 hover:bg-[#ff8c21] text-white text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-md border border-white/20 transition cursor-pointer shadow-md"
                                title="Click to enlarge diagram"
                              >
                                <span>🔍</span>
                                <span className="hidden sm:inline">Enlarge Slide</span>
                              </button>
                            </div>
                            <div className="shrink-0 px-3 py-1 bg-slate-900/95 border-t border-slate-800 flex items-center justify-between gap-2 text-[10px]">
                              <span className="font-bold text-[#ff8c21] flex items-center gap-1.5 truncate">
                                <span>Slide {activeVisual.sourceSlide || (activeLessonIndex + 1)}</span>
                                <span className="text-slate-300 font-medium truncate">• {activeLesson?.title || activeVisual.name}</span>
                              </span>
                              <span className="text-[9px] text-emerald-400 font-extrabold shrink-0 uppercase tracking-wider bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                PRESENTATION SLIDE
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Fallback interactive board notes list when no slide image */
                        <div
                          ref={notesScrollRef}
                          className="flex-1 min-h-0 space-y-1.5 sm:space-y-2 overflow-y-auto pr-1 text-left my-0.5 scroll-smooth no-scrollbar"
                        >
                          {sentences.map((sentenceText, sIdx) => {
                            const isCurrent = sIdx === currentSentenceIdx
                            const isPast = sIdx < currentSentenceIdx
                            const cleanedText = cleanForBoard(sentenceText)

                            return (
                              <div
                                key={sIdx}
                                ref={isCurrent ? activeSentenceRef : null}
                                onClick={() => {
                                  window.speechSynthesis?.cancel?.();
                                  setCurrentSentenceIdx(sIdx);
                                  currentSentenceIdxRef.current = sIdx;
                                  if (totalSeconds > 0 && sentences.length > 0) {
                                    const newSec = Math.min(totalSeconds, Math.round((sIdx / Math.max(1, sentences.length)) * totalSeconds));
                                    setElapsedSeconds(newSec);
                                    elapsedSecondsRef.current = newSec;
                                    if (activeLesson?.id && !isLessonDone(activeLesson.id)) {
                                      saveLessonPlayback(activeLesson.id, sIdx, newSec);
                                    }
                                  }
                                }}
                                className={`p-2 sm:p-2.5 rounded-xl transition-all duration-300 cursor-pointer ${isCurrent
                                  ? 'bg-[#ff8c21]/20 border-l-4 border-[#ff8c21] shadow-xs text-white scale-[1.01]'
                                  : isPast
                                    ? 'bg-slate-800/50 border-l-2 border-slate-600/60 text-slate-300 hover:bg-slate-800/70'
                                    : 'bg-slate-800/20 border-l-2 border-slate-700/30 text-slate-400 opacity-60 hover:opacity-90'
                                  }`}
                                title="Click to jump to this concept"
                              >
                                <p className="text-xs sm:text-[13px] lg:text-sm leading-relaxed font-medium flex items-start gap-2 sm:gap-2.5">
                                  <span className={`text-[9px] sm:text-[10px] mt-1 shrink-0 ${isCurrent ? 'text-[#ff8c21] font-bold' : 'text-slate-500'}`}>
                                    {isCurrent ? '●' : '○'}
                                  </span>
                                  <span className="flex-1">{cleanedText}</span>
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right ARIA Tutor Circle Avatar with Robot AI Emoji */}
                <div className="md:col-span-5 lg:col-span-4 h-full flex flex-col items-center justify-center text-center border-t md:border-t-0 md:border-l border-white/10 pt-3 md:pt-0 px-2 sm:px-4">
                  {/* Circular Avatar Frame with Robot Emoji */}
                  <div className={`relative flex items-center justify-center h-28 w-28 sm:h-36 sm:w-36 md:h-40 md:w-40 lg:h-44 lg:w-44 rounded-full bg-[#182337] border-2 sm:border-[2.5px] ${isAriaSpeaking || playing || tutorVoiceState === TutorState.ARIA_SPEAKING || tutorVoiceState === TutorState.ARIA_GREETING
                    ? 'border-[#ff8c21]/90 shadow-[0_0_30px_rgba(245,130,32,0.3)] avatar-active'
                    : 'border-[#293c5d] shadow-2xl'
                    } transition-all duration-300 select-none`}>
                    <span className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl select-none filter drop-shadow-md">
                      🤖
                    </span>
                  </div>

                  {/* ARIA AI TUTOR Pill Badge */}
                  <div className="mt-4 sm:mt-5 px-5 py-1.5 rounded-full bg-[#131d2e] border border-[#2a3952] shadow-sm select-none">
                    <span className="text-xs sm:text-[13px] font-extrabold text-[#ff8c21] tracking-wider uppercase">
                      ARIA AI TUTOR
                    </span>
                  </div>
                </div>
              </div>

              {/* Subtitle Caption Overlay */}
              {showCC && (
                <div className="shrink-0 bg-[#040814]/90 backdrop-blur-md rounded-lg py-1.5 sm:py-2 px-3 sm:px-4 border border-white/10 mt-1.5 sm:mt-2 text-center">
                  <p className="text-xs sm:text-sm text-white font-medium leading-relaxed italic truncate">
                    {loadingExplanation
                      ? 'ARIA: "Preparing lesson explanation..."'
                      : (playing ? `ARIA: "${cleanForBoard(sentences[currentSentenceIdx])}"` : 'Lecture paused.')}
                  </p>
                </div>
              )}
            </div>

            {/* SLEEK DARK BLUE VIDEO PLAYER CONTROL BAR (ATTACHED IMAGE STYLE) */}
            <div className="shrink-0 bg-[#081a38] text-white px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-3 border-t border-white/10 select-none">
              {/* Left Controls: Play/Pause, Volume/Mute, Timestamp */}
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
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

              {/* Right Controls: CC, Fullscreen, Assessment Button */}
              <div className="flex items-center gap-2.5">
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
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? (
                    <svg className="h-4 w-4 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Ask ARIA Chat Panel */}
        {chatCollapsed ? (
          <section className="hidden lg:flex bg-white rounded-2xl border border-slate-200/80 shadow-xs h-full min-h-0 overflow-hidden flex-col items-center py-3 gap-3">
            <button
              type="button"
              onClick={() => setChatCollapsed(false)}
              className="flex flex-col items-center gap-2 px-1 py-2 text-[#0f1b2d] hover:text-[#ff8c21] transition cursor-pointer border-0 bg-transparent"
              title="Open Ask ARIA"
            >
              <svg className="h-5 w-5 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-[9px] font-extrabold tracking-wide [writing-mode:vertical-rl] rotate-180">Ask ARIA</span>
            </button>
          </section>
        ) : (
          <section className="bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-3.5 pb-2 sm:pb-2.5 shadow-xs flex flex-col justify-between min-h-[260px] lg:h-full lg:min-h-0 overflow-hidden">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between border-b border-slate-100 pb-2 sm:pb-2.5">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <svg className="h-4.5 w-4.5 sm:h-5 sm:w-5 stroke-[#ff8c21] fill-none shrink-0" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <h3 className="text-xs sm:text-sm font-bold text-[#0f1b2d]">Ask ARIA</h3>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setHandsFreeVoice(v => !v)}
                  className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-extrabold border transition cursor-pointer ${handsFreeVoice
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 shadow-2xs'
                    : 'bg-slate-100 text-slate-400 border-slate-200'
                    }`}
                  title="Toggle Always-Listening Voice Assistant"
                >
                  <span className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${handsFreeVoice ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`} />
                  {handsFreeVoice ? 'Always-On' : 'Mic Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setChatCollapsed(true)}
                  className="hidden lg:inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition cursor-pointer bg-transparent"
                  title="Minimize Ask ARIA"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M4 10.75A.75.75 0 0 1 4.75 10h10.5a.75.75 0 0 1 0 1.5H4.75a.75.75 0 0 1-.75-.75Z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Chat Messages Feed */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 sm:space-y-3 my-1.5 sm:my-2 pr-0.5 no-scrollbar">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender === 'aria' && (
                    <div className="h-8 w-8 rounded-full bg-[#182337] border border-[#ff8c21] text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-xs select-none">
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
                    <div className="h-8 w-8 rounded-full bg-white border border-slate-300 text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-xs" title="You">
                      👤
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
              <div ref={chatEndRef} />
            </div>

            {/* Bottom Chat Input Form - Clean Full Width without manual mic */}
            <form onSubmit={handleSendChat} className="shrink-0 flex items-center gap-1.5 sm:gap-2 border-t border-slate-100 pt-2 pb-0.5">
              <input
                type="text"
                placeholder="Ask ARIA anything..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-1.5 sm:py-2 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:border-[#ff8c21] focus:outline-none transition shadow-2xs"
              />

              <button
                type="submit"
                disabled={!chatInput.trim() || chatLoading}
                className="h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 grid place-items-center rounded-xl bg-[#ff8c21] hover:bg-[#e87a15] text-white border-0 cursor-pointer disabled:opacity-40 shadow-xs transition font-bold text-xs"
                title="Send Message"
              >
                ➔
              </button>
            </form>
          </section>
        )}
      </main>

      {/* Full-Screen High-Resolution PPT Diagram Lightbox Modal */}
      {enlargedVisual && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none animate-fadeIn cursor-pointer"
          onClick={() => setEnlargedVisual(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setEnlargedVisual(null)}
              className="absolute -top-10 right-0 text-white hover:text-[#ff8c21] text-xs sm:text-sm font-bold bg-slate-900/90 px-3 py-1 rounded-full border border-slate-700 cursor-pointer shadow-lg flex items-center gap-1.5 transition"
            >
              <span>✕</span>
              <span>Close View</span>
            </button>
            <img
              src={enlargedVisual.dataUrl || enlargedVisual.url}
              alt={enlargedVisual.descr || 'Enlarged PPT Diagram'}
              className="max-h-[76vh] w-auto max-w-full object-contain rounded-2xl shadow-2xl border-2 border-slate-700 bg-slate-950 p-2"
            />
            <div className="mt-3 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-700 text-xs text-white font-medium text-center shadow-lg max-w-2xl truncate">
              <span className="font-bold text-[#ff8c21]">Slide {enlargedVisual.sourceSlide}:</span> {enlargedVisual.purpose || enlargedVisual.descr || enlargedVisual.name || 'Visual Reference'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CoursePlayer