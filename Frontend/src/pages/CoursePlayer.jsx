import { useMemo, useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import VoiceTutorManager, { TutorState, containsWakeWord, extractQuestionFromWakeWord, isNoiseOrHallucination, isDanglingFragment } from '../services/voiceTutorService'
import logo from '../assets/SkillBridge_AI.png'
import { persistLanguageSelection, readStoredLanguageCode, textMatchesLanguage } from '../utils/language'
import { cleanUnsupportedWords, cleanForSpeech as cleanSpeechUtil, stripSlidePlaceholders } from '../utils/textCleaner'
import { buildTeacherLectureSentences } from '../utils/teacherNarrator'
import { getStudentUser } from '../utils/authSession'
import LipSyncAvatar from '../components/avatar/LipSyncAvatar'

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
  { value: 'te', label: 'Telugu (తెలుగు)', code: 'TE', native: 'తెలుగు' },
  { value: 'hi', label: 'Hindi (हिन्दी)', code: 'HI', native: 'हिन्दी' },
];

const SPEECH_LANGUAGES = {
  en: 'en-US',
  zh: 'zh-CN',
  ms: 'ms-MY',
  ta: 'ta-IN',
  bn: 'bn-BD',
  te: 'te-IN',
  hi: 'hi-IN',
};

const GREETINGS = {
  en: "Hello! I am ARIA, your personal AI tutor. Ask me any question about this lesson and I will explain it for you!",
  zh: "你好！我是 ARIA，你的个人 AI 导师。你可以问我关于本课的任何问题，我会为你解答！",
  ms: "Hai! Saya ARIA, tutor AI peribadi anda. Tanya saya sebarang soalan tentang pelajaran ini dan saya akan menerangkannya untuk anda!",
  ta: "வணக்கம்! நான் ARIA, உங்கள் தனிப்பட்ட AI ஆசிரியர். இந்த பாடம் குறித்த எந்த கேள்வியையும் என்னிடம் கேளுங்கள், நான் உங்களுக்கு விளக்குகிறேன்!",
  bn: "হ্যালো! আমি ARIA, আপনার ব্যক্তিগত AI টিউটর। এই পাঠ সম্পর্কে যে কোনো প্রশ্ন আমাকে জিজ্ঞাসা করুন, আমি আপনাকে বুঝিয়ে দেব!",
  te: "నమస్కారం! నేను ARIA, మీ వ్యక్తిగత AI ట్యూటర్. ఈ పాఠం గురించి ఏ ప్రశ్నైనా నన్ను అడగండి, నేను మీకు వివరిస్తాను!",
  hi: "नमस्ते! मैं ARIA हूँ, आपकी व्यक्तिगत AI शिक्षक। इस पाठ के बारे में कोई भी प्रश्न पूछें, मैं आपको समझाऊँगी!",
};

const normalizeLanguageCode = (pref) => {
  if (!pref) return null;
  const l = String(pref).toLowerCase().trim();
  if (l === 'zh' || l.includes('chinese') || l.includes('中文') || l === 'cn') return 'zh';
  if (l === 'ms' || l.includes('malay') || l.includes('melayu') || l === 'my') return 'ms';
  if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்')) return 'ta';
  if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা') || l === 'bd') return 'bn';
  if (l === 'te' || l.includes('telugu') || l.includes('తెలుగు')) return 'te';
  if (l === 'hi' || l.includes('hindi') || l.includes('हिन्दी')) return 'hi';
  if (l === 'en' || l.includes('english')) return 'en';
  return null;
};

// In-memory instant client cache for lesson explanations (Key: `${courseId}_${lessonId}_${langCode}`)
const lessonExplanationClientCache = new Map();
// Audio/Utterance cache pool for pre-warmed concepts (Key: `${courseId}_${lessonId}_${conceptIndex}`)
const ttsUtterancePool = new Map();

export const haltAllSkillBridgeAudio = () => {
  try {
    if (window._skillbridgeCurrentAudio) {
      const audio = window._skillbridgeCurrentAudio;
      audio.onended = null;
      audio.onerror = null;
      audio.onplay = null;
      audio.onpause = null;
      audio.ontimeupdate = null;
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
      window._skillbridgeCurrentAudio = null;
    }
  } catch (e) { }

  if (window._skillbridgeResumeInterval) {
    clearInterval(window._skillbridgeResumeInterval);
    window._skillbridgeResumeInterval = null;
  }

  try {
    if (window._skillbridgeCurrentUtterance) {
      window._skillbridgeCurrentUtterance.onstart = null;
      window._skillbridgeCurrentUtterance.onend = null;
      window._skillbridgeCurrentUtterance.onerror = null;
      window._skillbridgeCurrentUtterance.onpause = null;
      window._skillbridgeCurrentUtterance.onresume = null;
      window._skillbridgeCurrentUtterance = null;
    }
    if (window._skillbridgeCurrentAudio) {
      try {
        window._skillbridgeCurrentAudio.onplay = null;
        window._skillbridgeCurrentAudio.ontimeupdate = null;
        window._skillbridgeCurrentAudio.onended = null;
        window._skillbridgeCurrentAudio.onerror = null;
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio.src = '';
      } catch (_) {}
      window._skillbridgeCurrentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  } catch (e) { }
};

const CoursePlayer = ({
  course,
  initialCompletedLessonId,
  initialAutoPlayNext,
  initialNextLessonId,
  onExit,
  onAssessment
}) => {
  const user = useMemo(() => getStudentUser() || { fullName: 'Learner', role: 'STUDENT' }, [])

  const userId = useMemo(() => {
    return user?.id || user?.finNumber || user?.email || 'guest';
  }, [user]);

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)
  const [pipelineState, setPipelineState] = useState('PREPARING') // 'PREPARING' | 'READY' | 'PLAYING'

  // Pre-warm browser Web Speech synthesis voices on component mount
  useEffect(() => {
    window.speechSynthesis?.getVoices()
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
    isMountedRef.current = true;

    const handlePopState = () => {
      isMountedRef.current = false;
      playingRef.current = false;
      isAriaSpeakingRef.current = false;
      isAnsweringRef.current = false;
      wasLecturePlayingRef.current = false;
      if (utteranceRef.current) {
        utteranceRef.current.onstart = null;
        utteranceRef.current.onend = null;
        utteranceRef.current.onerror = null;
        utteranceRef.current = null;
      }
      haltAllSkillBridgeAudio();
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('pagehide', handlePopState);
    window.addEventListener('beforeunload', handlePopState);

    return () => {
      isMountedRef.current = false;
      playingRef.current = false;
      isAriaSpeakingRef.current = false;
      isAnsweringRef.current = false;
      wasLecturePlayingRef.current = false;

      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('pagehide', handlePopState);
      window.removeEventListener('beforeunload', handlePopState);

      if (utteranceRef.current) {
        utteranceRef.current.onstart = null;
        utteranceRef.current.onend = null;
        utteranceRef.current.onerror = null;
        utteranceRef.current = null;
      }

      haltAllSkillBridgeAudio();
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

  const explanationRequest = useRef(0)
  const [retryCount, setRetryCount] = useState(0)
  const [explanationError, setExplanationError] = useState(false)

  const handleLanguageChange = (newLangCode) => {
    const langObj = LANGUAGES.find(l => l.value === newLangCode) || LANGUAGES[0]
    if (langObj.value === selectedLanguageCode) return
    explanationRequest.current++
    setSelectedLanguageCode(langObj.value)
    ttsUtterancePool.clear()
    lessonExplanationClientCache.clear()
    persistLanguageSelection(langObj.value)

    // Halt playback and remain cleanly paused on language switch
    playingRef.current = false;
    setPlaying(false);
    setIsAriaSpeaking(false);
    isAriaSpeakingRef.current = false;
    setActiveSpokenWord('');

    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }

    try {
      if (window._skillbridgeCurrentAudio) {
        window._skillbridgeCurrentAudio.onended = null;
        window._skillbridgeCurrentAudio.onerror = null;
        window._skillbridgeCurrentAudio.onplay = null;
        window._skillbridgeCurrentAudio.ontimeupdate = null;
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio.src = '';
        window._skillbridgeCurrentAudio = null;
      }
      window.speechSynthesis.cancel();
      preloadedAudioMap.current.clear();
    } catch (e) { }
    setCurrentSentenceIdx(0)
    currentSentenceIdxRef.current = 0
    setElapsedSeconds(0)
    elapsedSecondsRef.current = 0
    setExplanation('')
    setExplanationError(false)
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
        currentSlide: currentPageNum || 1,
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
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const isManuallyPausedRef = useRef(false)
  const [explanation, setExplanation] = useState('')
  const [lessonVisuals, setLessonVisuals] = useState([])
  const [enlargedVisual, setEnlargedVisual] = useState(null)
  const [loadingExplanation, setLoadingExplanation] = useState(false)
  const [loadingQuiz, setLoadingQuiz] = useState(false)

  // Teaching slide states
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState(0)

  // Universal Document Viewer States (PowerPoint / PDF Slides)
  const [currentPageNum, setCurrentPageNum] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [fitToWidth, setFitToWidth] = useState(true)
  const [slideImageLoadError, setSlideImageLoadError] = useState(false)
  const [tutorGuidance, setTutorGuidance] = useState({
    keyPoints: [],
    safetyWarnings: [],
    transition: ''
  })

  // Keyboard navigation for presentation slides (ArrowLeft: previous slide, ArrowRight: next slide)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentPageNum(p => Math.max(1, p - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrentPageNum(p => (documentPages.length > 0 ? Math.min(documentPages.length, p + 1) : p + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
  const [aiTutorName, setAiTutorName] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('skillbridge_ai_settings') || sessionStorage.getItem('skillbridge_ai_settings') || '{}');
      if (saved.aiName) return saved.aiName;
      const admin = JSON.parse(sessionStorage.getItem('skillbridge_admin') || localStorage.getItem('skillbridge_admin') || '{}');
      if (admin.aiName) return admin.aiName;
      const user = JSON.parse(sessionStorage.getItem('skillbridge_user') || localStorage.getItem('skillbridge_user') || '{}');
      if (user.aiName) return user.aiName;
    } catch (_) {}
    return 'ARIA';
  })
  const [aiWakeWord, setAiWakeWord] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('skillbridge_ai_settings') || sessionStorage.getItem('skillbridge_ai_settings') || '{}');
      if (saved.wakeWord) return saved.wakeWord;
      const admin = JSON.parse(sessionStorage.getItem('skillbridge_admin') || localStorage.getItem('skillbridge_admin') || '{}');
      if (admin.wakeWord) return admin.wakeWord;
      const user = JSON.parse(sessionStorage.getItem('skillbridge_user') || localStorage.getItem('skillbridge_user') || '{}');
      if (user.wakeWord) return user.wakeWord;
    } catch (_) {}
    return 'Hey ARIA';
  })
  const [aiVoiceConfig, setAiVoiceConfig] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('skillbridge_ai_settings') || sessionStorage.getItem('skillbridge_ai_settings') || '{}');
      if (saved.aiVoiceGender || saved.gender) {
        const isM = (saved.aiVoiceGender || saved.gender || '').toLowerCase() === 'male';
        return {
          gender: isM ? 'male' : 'female',
          voiceName: saved.aiVoiceName || saved.voiceName || (isM ? 'en-US-ChristopherNeural' : 'en-US-JennyNeural'),
          rate: typeof saved.aiVoiceRate === 'number' ? saved.aiVoiceRate : 0.95,
          pitch: typeof saved.aiVoicePitch === 'number' ? saved.aiVoicePitch : 1.0
        };
      }
      const admin = JSON.parse(sessionStorage.getItem('skillbridge_admin') || localStorage.getItem('skillbridge_admin') || '{}');
      if (admin.aiVoiceGender) {
        const isM = admin.aiVoiceGender.toLowerCase() === 'male';
        return {
          gender: isM ? 'male' : 'female',
          voiceName: admin.aiVoiceName || (isM ? 'en-US-ChristopherNeural' : 'en-US-JennyNeural'),
          rate: typeof admin.aiVoiceRate === 'number' ? admin.aiVoiceRate : 0.95,
          pitch: typeof admin.aiVoicePitch === 'number' ? admin.aiVoicePitch : 1.0
        };
      }
      const user = JSON.parse(sessionStorage.getItem('skillbridge_user') || localStorage.getItem('skillbridge_user') || '{}');
      if (user.aiVoiceGender) {
        const isM = user.aiVoiceGender.toLowerCase() === 'male';
        return {
          gender: isM ? 'male' : 'female',
          voiceName: user.aiVoiceName || (isM ? 'en-US-ChristopherNeural' : 'en-US-JennyNeural'),
          rate: typeof user.aiVoiceRate === 'number' ? user.aiVoiceRate : 0.95,
          pitch: typeof user.aiVoicePitch === 'number' ? user.aiVoicePitch : 1.0
        };
      }
    } catch (_) {}
    return {
      gender: 'female',
      voiceName: 'en-US-JennyNeural',
      rate: 0.95,
      pitch: 1.0
    };
  })

  // Professional studio neural teacher acoustics: smooth, human-like voice with natural warmth
  const tutorRate = aiVoiceConfig.rate || 0.92
  const tutorPitch = typeof aiVoiceConfig.pitch === 'number' ? aiVoiceConfig.pitch : 1.0
  const preloadedAudioMap = useRef(new Map())
  const activeCourseIdRef = useRef(course?.id || '')
  if (course?.id && activeCourseIdRef.current !== course.id) {
    activeCourseIdRef.current = course.id;
  }

  // Dynamic Viseme Lip-Sync and Google Voice Pacing states
  const [activeSpokenWord, setActiveSpokenWord] = useState('')
  const [activeCharIndex, setActiveCharIndex] = useState(0)
  const speechTimeoutRef = useRef(null)
  const watchdogRef = useRef(null)

  // Live listener for real-time voice settings updates across tabs and AI Tutor Settings page
  useEffect(() => {
    const handleVoiceUpdate = (e) => {
      const data = e.detail;
      if (!data) return;
      if (data.aiName) setAiTutorName(data.aiName);
      if (data.wakeWord) setAiWakeWord(data.wakeWord);
      if (data.aiVoiceGender) {
        const isM = data.aiVoiceGender.toLowerCase() === 'male';
        setAiVoiceConfig({
          gender: isM ? 'male' : 'female',
          voiceName: data.aiVoiceName || (isM ? 'en-US-ChristopherNeural' : 'en-US-JennyNeural'),
          rate: typeof data.aiVoiceRate === 'number' ? data.aiVoiceRate : 0.95,
          pitch: typeof data.aiVoicePitch === 'number' ? data.aiVoicePitch : 1.0
        });
      }
      preloadedAudioMap.current.clear();
    };

    window.addEventListener('skillbridge_ai_settings_updated', handleVoiceUpdate);
    return () => window.removeEventListener('skillbridge_ai_settings_updated', handleVoiceUpdate);
  }, []);

  // Fetch company AI Tutor and custom wake word configuration
  useEffect(() => {
    let isMounted = true
    const tenantCode = course?.tenantCode || course?.tenant?.code || null
    api.getCompanyAiSettings(tenantCode).then((settings) => {
      if (isMounted && settings?.aiName) {
        setAiTutorName(settings.aiName)
        setAiWakeWord(settings.wakeWord || `Hey ${settings.aiName}`)
        if (settings.aiVoiceGender || settings.aiVoiceName || settings.aiVoiceRate) {
          const isMale = (settings.aiVoiceGender || '').toLowerCase() === 'male'
          setAiVoiceConfig({
            gender: isMale ? 'male' : 'female',
            voiceName: settings.aiVoiceName || (isMale ? 'en-US-ChristopherNeural' : 'en-US-JennyNeural'),
            rate: typeof settings.aiVoiceRate === 'number' ? settings.aiVoiceRate : 0.95,
            pitch: typeof settings.aiVoicePitch === 'number' ? settings.aiVoicePitch : (isMale ? 0.78 : 1.0)
          })
        }
        setChatMessages(prev => {
          if (prev.length === 1 && prev[0].sender === 'aria') {
            const template = GREETINGS[selectedLanguageCode] || GREETINGS.en
            return [{ sender: 'aria', text: template.replace(/ARIA/g, settings.aiName) }]
          }
          return prev
        })
      }
    }).catch(() => {})
    return () => { isMounted = false }
  }, [selectedLanguageCode, course?.id, course?.tenantCode])


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
  const isMountedRef = useRef(true)
  const playingRef = useRef(Boolean(initialAutoPlayNext))
  const micStreamRef = useRef(null)

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

    // 0. If company admin set a specific preferred voice name
    if (aiVoiceConfig?.voiceName) {
      const keyword = aiVoiceConfig.voiceName.toLowerCase().replace(/^en-us-/, '').replace(/neural$/, '')
      const explicit = voices.find(v => v.lang.toLowerCase().split('-')[0] === l && v.name.toLowerCase().includes(keyword))
      if (explicit) return explicit
    }

    // Exclude male voices when female is desired (ARIA is female AI tutor)
    const isDisallowed = (name) => {
      const n = (name || '').toLowerCase()
      const isMale = (aiVoiceConfig?.gender || '').toLowerCase() === 'male'
      if (isMale) {
        return n.includes('zira') || n.includes('female') || n.includes('jenny') || n.includes('ava')
      }
      return n.includes('david') || n.includes('george') || n.includes('mark') || n.includes('guy') || n.includes('brian') || n.includes('christopher') || n.includes('ryan') || n.includes('eric') || n.includes('male') || n.includes('james') || n.includes('richard')
    }

    if (l === 'en') {
      const isMale = (aiVoiceConfig?.gender || '').toLowerCase() === 'male'
      const enVoices = voices.filter(v => v.lang.toLowerCase().startsWith('en') && !isDisallowed(v.name))

      if (isMale) {
        const maleVoice = enVoices.find(v => {
          const n = v.name.toLowerCase()
          return (n.includes('natural') || n.includes('neural') || n.includes('online')) &&
            (n.includes('guy') || n.includes('christopher') || n.includes('ryan') || n.includes('andrew') || n.includes('brian') || n.includes('eric'))
        }) || enVoices.find(v => v.name.toLowerCase().includes('google') && v.name.toLowerCase().includes('male'))
          || enVoices.find(v => (v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('neural')) && !v.name.toLowerCase().includes('female'))
          || enVoices.find(v => v.name.toLowerCase().includes('male'))
        if (maleVoice) {
          return maleVoice
        }
      } else {
        // Female:
        // 1. Microsoft Jenny (Natural) / Ava / Emma / Aria / Sonia / Microsoft Zira
        const naturalFemale = enVoices.find(v => {
          const n = v.name.toLowerCase()
          return (n.includes('natural') || n.includes('neural') || n.includes('online')) &&
            (n.includes('jenny') || n.includes('ava') || n.includes('emma') || n.includes('aria') || n.includes('sonia') || n.includes('neerja'))
        })
        if (naturalFemale) {
          return naturalFemale
        }

        // 2. Google US English / Google UK English Female
        const googleVoice = enVoices.find(v => {
          const n = v.name.toLowerCase()
          return n.includes('google us english') || n.includes('google uk english female') || (n.includes('google') && !n.includes('male'))
        })
        if (googleVoice) {
          return googleVoice
        }

        // 3. Microsoft Zira Desktop (Built-in Windows female voice)
        const ziraVoice = enVoices.find(v => v.name.toLowerCase().includes('zira'))
        if (ziraVoice) {
          return ziraVoice
        }

        // 4. Any other natural female voice
        const anyNatural = enVoices.find(v => {
          const n = v.name.toLowerCase()
          return (n.includes('natural') || n.includes('neural') || n.includes('online')) && !n.includes('guy') && !n.includes('male')
        })
        if (anyNatural) {
          return anyNatural
        }
      }

      // 6. Apple / WebKit natural voices (Samantha, Karen, Victoria)
      const appleVoice = enVoices.find(v => {
        const n = v.name.toLowerCase()
        return n.includes('samantha') || n.includes('karen') || n.includes('victoria')
      })
      if (appleVoice) {
        return appleVoice
      }

      // 7. Any other female/non-male English voice
      const fallbackEn = enVoices.find(v => !isDisallowed(v.name))
      if (fallbackEn) {
        return fallbackEn
      }
      return null
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
    } else if (l === 'te') {
      const teVoices = voices.filter(v => v.lang.toLowerCase().startsWith('te') || v.lang.toLowerCase().includes('telugu'))
      const bestTe = teVoices.find(v => v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('shruti') || v.name.toLowerCase().includes('mohan'))
      if (bestTe) return bestTe
      if (teVoices.length > 0) return teVoices[0]
    }

    const match = voices.find(v => v.lang.toLowerCase().startsWith(l) && !isDisallowed(v.name))
    return match || voices.find(v => v.lang.toLowerCase().startsWith(l)) || null
  }

  // Auto-resume lecture from the exact saved concept/sentence position
  const resumeLectureFromExactPosition = () => {
    if (!isMountedRef.current) return;
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
      const targetPos = Math.max(0, savedLecturePositionRef.current || 0);
      currentSentenceIdxRef.current = targetPos;
      setCurrentSentenceIdx(targetPos);
      isManuallyPausedRef.current = false;
      playingRef.current = true;
      setPlaying(true);
      wasLecturePlayingRef.current = false;
      setVoiceStatusText('▶️ Resuming lecture from where you left off...');
      setTimeout(() => {
        if (isMountedRef.current) setVoiceStatusText('');
      }, 2500);
    } else {
      setVoiceStatusText('');
    }
  }

  const ACKNOWLEDGMENTS = {
    en: "Yes, I'm listening.",
    zh: "我在听，请问有什么可以帮您？",
    ms: "Ya, saya mendengar.",
    ta: "சொல்லுங்கள், நான் கேட்கிறேன்.",
    bn: "হ্যাঁ, বলুন আমি শুনছি।",
    te: "చెప్పండి, నేను వింటున్నాను."
  }

  const RESUME_COURSE_PHRASES = {
    en: "Continuing to the course.",
    zh: "正在继续课程。",
    ms: "Menyambung semula kursus.",
    ta: "பாடத்தைத் தொடர்கிறேன்.",
    bn: "কোর্সে ফিরে যাচ্ছি।",
    te: "పాఠాన్ని కొనసాగిస్తున్నాను."
  }

  // Pre-load multilingual wake acknowledgement audio so ARIA responds in 50ms upon saying "Hey ARIA"
  const wakeAckAudioRef = useRef(null);

  useEffect(() => {
    const ack = ACKNOWLEDGMENTS[selectedLanguageCode] || ACKNOWLEDGMENTS.en;
    const isMale = (aiVoiceConfig?.gender || '').toLowerCase() === 'male';
    try {
      const url = api.getTtsAudioUrl(ack, {
        language: selectedLanguageCode,
        gender: isMale ? 'MALE' : 'FEMALE',
        rate: tutorRate,
        pitch: tutorPitch
      });
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = url;
      audio.load();
      wakeAckAudioRef.current = audio;
    } catch (_) {
      wakeAckAudioRef.current = null;
    }
  }, [selectedLanguageCode, tutorRate, tutorPitch, aiVoiceConfig?.gender]);

  const speakAriaAnswer = (text, onEndCallback) => {
    if (!isMountedRef.current || !text) {
      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
      voiceManagerRef.current?.setTutorSpeaking(false);
      if (isMountedRef.current) onEndCallback?.();
      return;
    }

    try {
      if (window._skillbridgeCurrentAudio) {
        window._skillbridgeCurrentAudio.onended = null;
        window._skillbridgeCurrentAudio.onerror = null;
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      }
      window.speechSynthesis.cancel();
      preloadedAudioMap.current.clear();
    } catch (e) { }

    const cleanText = text
      .replace(/###/g, '')
      .replace(/####/g, '')
      .replace(/\*\*/g, '')
      .replace(/- /g, '')
      .replace(/---/g, '')
      .trim();

    if (!cleanText) {
      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
      voiceManagerRef.current?.setTutorSpeaking(false);
      if (isMountedRef.current) onEndCallback?.();
      return;
    }

    // Immediately mark tutor speaking to prevent microphone echo capture during buffer phase
    setIsAriaSpeaking(true);
    isAriaSpeakingRef.current = true;
    voiceManagerRef.current?.setTutorSpeaking(true, cleanText);

    // Split answer into sentences for instant <150ms streaming playback
    const rawSentences = cleanText.split(/(?<=[.?!;।\n]+[\s\u200B]+)|(?<=[。！？\n])/g)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const sentences = rawSentences.length > 0 ? rawSentences : [cleanText];
    let hasFinished = false;
    let isCancelled = false;
    const answerPreloadMap = new Map();

    const finishTTS = () => {
      if (hasFinished) return;
      hasFinished = true;
      isCancelled = true;
      answerPreloadMap.clear();
      setActiveSpokenWord('');
      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
      voiceManagerRef.current?.setTutorSpeaking(false, cleanText);
      if (isMountedRef.current) {
        onEndCallback?.();
      }
    };

    const isMale = (aiVoiceConfig?.gender || '').toLowerCase() === 'male';
    const effectiveGender = isMale ? 'MALE' : 'FEMALE';

    // Pre-fetch helper: buffer upcoming sentences into memory while current sentence plays
    const prefetchSentence = (idx) => {
      if (idx >= sentences.length || answerPreloadMap.has(idx)) return;
      try {
        const nextUrl = api.getTtsAudioUrl(sentences[idx], {
          language: selectedLanguageCode,
          gender: effectiveGender,
          rate: tutorRate,
          pitch: tutorPitch,
        });
        const preAudio = new Audio(nextUrl);
        preAudio.preload = 'auto';
        preAudio.load();
        answerPreloadMap.set(idx, preAudio);
      } catch (_) { }
    };

    const playSentenceAt = (idx) => {
      if (isCancelled || !isMountedRef.current || idx >= sentences.length) {
        finishTTS();
        return;
      }

      const sentenceText = sentences[idx];

      let audio = answerPreloadMap.get(idx);
      if (!audio || audio.error) {
        const audioUrl = api.getTtsAudioUrl(sentenceText, {
          language: selectedLanguageCode,
          gender: effectiveGender,
          rate: tutorRate,
          pitch: tutorPitch,
        });
        audio = new Audio(audioUrl);
        audio.preload = 'auto';
      }
      answerPreloadMap.delete(idx);
      window._skillbridgeCurrentAudio = audio;

      // Pipeline pre-fetch: buffer NEXT sentence into memory cache immediately
      if (idx + 1 < sentences.length) {
        prefetchSentence(idx + 1);
      }

      let sentenceWatchdog = null;
      let hasAdvanced = false;

      const advanceOrFinish = (nextIdx) => {
        if (hasAdvanced) return;
        hasAdvanced = true;
        if (sentenceWatchdog) {
          clearTimeout(sentenceWatchdog);
          sentenceWatchdog = null;
        }
        if (audio) {
          audio.onplay = null;
          audio.ontimeupdate = null;
          audio.onended = null;
          audio.onerror = null;
          try {
            audio.pause();
            audio.currentTime = 0;
            audio.src = '';
          } catch (_) {}
        }
        try { window.speechSynthesis.cancel(); } catch (_) {}
        if (nextIdx < sentences.length) {
          playSentenceAt(nextIdx);
        } else {
          finishTTS();
        }
      };

      // Watchdog: If audio does not start playing within 8s, advance cleanly to next segment
      sentenceWatchdog = setTimeout(() => {
        console.warn(`[VOICE] Sentence ${idx} audio load watchdog timed out; advancing cleanly.`);
        advanceOrFinish(idx + 1);
      }, 8000);

      audio.onplay = () => {
        if (sentenceWatchdog) {
          clearTimeout(sentenceWatchdog);
          sentenceWatchdog = null;
        }
        try { window.speechSynthesis.cancel(); } catch (_) {}
        if (isCancelled || !isMountedRef.current) return;
        setIsAriaSpeaking(true);
        isAriaSpeakingRef.current = true;
        voiceManagerRef.current?.setTutorSpeaking(true, sentenceText);
      };

      audio.ontimeupdate = () => {
        if (audio.duration > 0) {
          const ratio = audio.currentTime / audio.duration;
          const words = sentenceText.split(/\s+/);
          const wordIdx = Math.min(words.length - 1, Math.floor(ratio * words.length));
          setActiveSpokenWord(words[wordIdx] || '');
        }
      };

      audio.onended = () => {
        advanceOrFinish(idx + 1);
      };

      audio.onerror = (e) => {
        console.warn(`[VOICE] Studio audio error on sentence ${idx}:`, e);
        advanceOrFinish(idx + 1);
      };

      const doPlay = () => {
        if (isCancelled || !isMountedRef.current || hasAdvanced) return;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((playErr) => {
            console.warn('[VOICE] Neural audio play deferred:', playErr?.message);
            setTimeout(() => {
              if (!hasAdvanced && isMountedRef.current && !isCancelled) {
                const retry = audio.play();
                if (retry !== undefined) {
                  retry.catch(() => advanceOrFinish(idx + 1));
                }
              }
            }, 600);
          });
        }
      };

      if (audio.readyState >= 2) {
        doPlay();
      } else {
        const onReady = () => {
          audio.removeEventListener('canplay', onReady);
          audio.removeEventListener('canplaythrough', onReady);
          audio.removeEventListener('loadeddata', onReady);
          doPlay();
        };
        audio.addEventListener('canplay', onReady, { once: true });
        audio.addEventListener('canplaythrough', onReady, { once: true });
        audio.addEventListener('loadeddata', onReady, { once: true });
        audio.load();
      }
    };

    // Instant launch: Sentence 0 audio takes only ~120ms to synthesize and begins playing immediately!
    playSentenceAt(0);
  };

  const interruptLectureAndWake = (question = null) => {

    // ==========================================================
    // 1. SAVE COURSE POSITION + STOP COURSE
    // ==========================================================

    const wasPlaying = Boolean(playingRef.current || playing);
    if (wasPlaying) {
      if (!wasLecturePlayingRef.current) {
        wasLecturePlayingRef.current = true;
        savedLecturePositionRef.current = currentSentenceIdxRef.current;
      }

      // Immediately flag paused in ref & state so lecture loops halt synchronously
      playingRef.current = false;
      setPlaying(false);
      voiceManagerRef.current?.setLecturePlaying(false);
    } else if (isAriaSpeakingRef.current) {
      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
    }

    // ==========================================================
    // 2. DETACH & CANCEL ANY RUNNING LECTURE UTTERANCES / AUDIO
    // ==========================================================
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (utteranceRef.current) {
      utteranceRef.current.onstart = null;
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current = null;
    }
    window._activeSpeechUtterance = null;

    try {
      if (window._skillbridgeCurrentAudio) {
        window._skillbridgeCurrentAudio.onended = null;
        window._skillbridgeCurrentAudio.onerror = null;
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      }
      try {
        if (window._skillbridgeCurrentAudio) {
          window._skillbridgeCurrentAudio.pause();
          window._skillbridgeCurrentAudio.currentTime = 0;
          window._skillbridgeCurrentAudio = null;
        }
        window.speechSynthesis.cancel();
        preloadedAudioMap.current.clear();
      } catch (e) { }
    } catch (e) { }

    setIsAriaSpeaking(false);
    isAriaSpeakingRef.current = false;
    isAnsweringRef.current = false;

    // ==========================================================
    // 3. ENTER GREETING & SPEAK "Yes, I'm listening."
    // ==========================================================

    if (question) {
      voiceManagerRef.current?.setState(TutorState.ACTIVE_LISTENING);
      voiceManagerRef.current?.resetFollowUpTimeout();
      handleVoiceQuestion(question);
      return;
    }

    voiceManagerRef.current?.setState(
      TutorState.ARIA_GREETING
    );

    const ack =
      ACKNOWLEDGMENTS[selectedLanguageCode] ||
      ACKNOWLEDGMENTS.en;

    setVoiceStatusText(
      `👋 ${aiTutorName}: "${ack}"`
    );

    let ackCompleted = false;
    let ackWatchdog = null;

    const onAckEnd = () => {
      if (ackCompleted) return;
      ackCompleted = true;
      if (ackWatchdog) {
        clearTimeout(ackWatchdog);
        ackWatchdog = null;
      }
      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
      voiceManagerRef.current?.setTutorSpeaking(false);
      const vm = voiceManagerRef.current;
      if (vm) {
        vm.ttsMutedUntil = 0;
        vm.setState(TutorState.ACTIVE_LISTENING);
        vm.resetFollowUpTimeout();
        try {
          vm.restartSpeechRecognition?.(true);
        } catch (e) { }
      }
      setVoiceStatusText(`👂 Listening for your question…`);
    };

    // 2.2s Watchdog guarantees onAckEnd ALWAYS fires even if audio glitches or onended drops
    ackWatchdog = setTimeout(() => {
      console.warn('[VOICE] Wake acknowledgment audio watchdog fired; auto-transitioning to ACTIVE_LISTENING');
      onAckEnd();
    }, 2200);

    // Fast-path: If pre-buffered audio is ready, play instantly (< 50ms latency)
    if (wakeAckAudioRef.current?.readyState >= 3) {
      try {
        const audio = wakeAckAudioRef.current;
        audio.currentTime = 0;
        setIsAriaSpeaking(true);
        isAriaSpeakingRef.current = true;
        voiceManagerRef.current?.setTutorSpeaking(true, ack);
        audio.onended = onAckEnd;
        audio.onerror = () => {
          speakAriaAnswer(ack, onAckEnd);
        };
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('[VOICE] Fast-path audio play notice:', err);
            speakAriaAnswer(ack, onAckEnd);
          });
        }
        return;
      } catch (err) {
        console.warn('[VOICE] Pre-buffered wake audio error:', err);
      }
    }

    // Always speak greeting audibly so ARIA responds immediately with full avatar voice
    speakAriaAnswer(ack, onAckEnd);
  };

  const handleAvatarCall = async () => {
    // If audioContext was suspended due to browser autoplay policy, resume it with this user gesture
    try {
      if (voiceManagerRef.current?.audioContext?.state === 'suspended') {
        await voiceManagerRef.current.audioContext.resume().catch(() => {});
      }
    } catch (e) { }

    // Ensure handsFreeVoice is active
    if (!handsFreeVoice) {
      setHandsFreeVoice(true);
      handsFreeVoiceRef.current = true;
    }

    // Check / prompt microphone permission directly within user gesture
    if (navigator?.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (micErr) {
        console.warn('[VOICE] Microphone permission notice on avatar call:', micErr);
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
          setVoiceStatusText('⚠️ Microphone access was denied. Please allow microphone permissions in your browser.');
          return;
        }
      }
    }

    interruptLectureAndWake();
  };

  const isLectureEcho = (text) => {
    if (!text) return false
    if (voiceManagerRef.current?.isTranscriptSelfEcho?.(text)) return true

    // NEVER drop genuine student questions that contain interrogatives or question marks
    const isExplicitQuestion = /\b(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|clarify|mean|help|define|elaborate)\b/i.test(text)
      || text.includes('?')
      || /(?:什么是|为什么|怎么|如何|请问|apa|mengapa|bagaimana|bila|என்ன|ஏன்|எப்படி|কী|কেন|কিভাবে|ఎందుకు|ఏమిటి|ఎలా|क्या|क्यों|कैसे)/iu.test(text);
    if (isExplicitQuestion) return false

    const captured = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
    const capturedWords = captured.split(/\s+/).filter(w => w.length > 3)
    if (capturedWords.length < 5) return false

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
      if (!n || n.length < 25) continue
      const sourceWords = n.split(/\s+/).filter(w => w.length > 3)
      if (sourceWords.length < 5) continue
      const sourceSet = new Set(sourceWords)
      const overlap = capturedWords.filter(w => sourceSet.has(w)).length / capturedWords.length
      if (overlap >= 0.88 && n.includes(captured)) return true
    }
    return false
  }

  const handleVoiceQuestion = async (userSpeech) => {
    if (!isMountedRef.current || !userSpeech || isAnsweringRef.current) return
    const rawSpeech = userSpeech.trim()
    if (rawSpeech.length < 3 || isNoiseOrHallucination(rawSpeech)) {
      return
    }

    if (isLectureEcho(rawSpeech)) {
      return
    }

    // Extra safeguard: discard any audio that is an echo of the assistant's greeting or self-utterance
    const norm = rawSpeech.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?'"“”‘’]/g, ' ').replace(/\s+/g, ' ').trim()
    const lowerName = (aiTutorName || 'aria').toLowerCase().trim()
    const selfEchoPhrases = [
      'yes tell me im listening', 'yes tell me i am listening', 'yes tell me',
      'im listening', 'i am listening', 'tell me', 'listening', 'yes', 'yeah',
      'yes im listening', 'yes i am listening',
      'continuing to the course', 'continuing to course', 'resuming course', 'resuming lecture',
      `hello i am ${lowerName}`, `i am ${lowerName}`, `i am ${lowerName} your personal ai tutor`,
      `hello i am aria`, `i am aria`, `i am aria your personal ai tutor`,
      'i didnt catch your question can you ask again', 'i didnt catch your question',
      'didnt catch your question', 'can you ask again', 'please ask again',
      'i did not catch a question please ask me something about this lesson',
      'i did not catch a question', 'please ask me something',
      'i m ready to help with your course questions', 'how can i help you', 'what would you like to know',
      'i ll check check check', 'check check check', 'hello dear hello dear', 'hello dear',
      '我在听', '请问有什么可以帮您', '我在听请问', '请问', '正在继续课程', '我没有听清您的提问', '请再问一次',
      'ya saya mendengar', 'sila beritahu saya', 'saya mendengar', 'menyambung semula kursus', 'sila tanya semula',
      'சொல்லுங்கள் நான் கேட்கிறேன்', 'நான் கேட்கிறேன்', 'சொல்லுங்கள்', 'பாடத்தைத் தொடர்கிறேன்', 'மீண்டும் கேளுங்கள்',
      'বলুন আমি শুনছি', 'আমি শুনছি', 'হ্যাঁ বলুন', 'কোর্সে ফিরে যাচ্ছি', 'আবার জিজ্ঞাসা করুন',
      'చెప్పండి నేను వింటున్నాను', 'నేను వింటున్నాను', 'చెప్పండి', 'పాఠాన్ని కొనసాగిస్తున్నాను'
    ]
    if (selfEchoPhrases.some(e => norm === e)) {
      return
    }

    // Reject repetitive word loops (Whisper hallucinations e.g. "check check check")
    const words = norm.split(/\s+/).filter(Boolean)
    const unique = new Set(words)
    if (words.length >= 3 && unique.size <= 1) {
      return
    }
    if (words.length >= 4 && unique.size <= 2) {
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
      try {
      if (window._skillbridgeCurrentAudio) {
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      }
      window.speechSynthesis.cancel();
      preloadedAudioMap.current.clear();
    } catch (e) { }
      setPlaying(false)
      wasLecturePlayingRef.current = false
      setVoiceStatusText('⏸️ Standing by.')
      isAnsweringRef.current = false
      voiceManagerRef.current?.returnToSleep()
      return
    }

    const cleanQuestion = extractQuestionFromWakeWord(rawSpeech, aiWakeWord, aiTutorName) || rawSpeech
    if (!cleanQuestion || cleanQuestion.length < 3 || isNoiseOrHallucination(cleanQuestion)) {
      return
    }

    if (isDanglingFragment(cleanQuestion)) {
      voiceManagerRef.current?.setState(TutorState.ACTIVE_LISTENING)
      voiceManagerRef.current?.resetFollowUpTimeout()
      setVoiceStatusText('👂 Still listening… please finish your question')
      return
    }

    // Deduplication check: prevent duplicate triggers for identical utterance within 2.5s
    const now = Date.now()
    if (lastProcessedTextRef.current === cleanQuestion.toLowerCase() && (now - lastProcessedTimeRef.current < 2500)) {
      return
    }
    lastProcessedTextRef.current = cleanQuestion.toLowerCase()
    lastProcessedTimeRef.current = now

    // If lecture is playing when question arrives, immediately stop lecture synchronously
    const wasPlaying = Boolean(playingRef.current || playing);
    if (wasPlaying) {
      if (!wasLecturePlayingRef.current) {
        wasLecturePlayingRef.current = true;
        savedLecturePositionRef.current = currentSentenceIdxRef.current;
      }
      playingRef.current = false;
      setPlaying(false);
      voiceManagerRef.current?.setLecturePlaying(false);
    }
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (utteranceRef.current) {
      utteranceRef.current.onstart = null;
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current = null;
    }
    window._activeSpeechUtterance = null;
    if (window._skillbridgeCurrentAudio) {
      try {
        window._skillbridgeCurrentAudio.onended = null;
        window._skillbridgeCurrentAudio.onerror = null;
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      } catch (e) { }
    }
    try {
      window.speechSynthesis.cancel();
      preloadedAudioMap.current.clear();
    } catch (e) { }

    isAnsweringRef.current = true
    voiceManagerRef.current?.setState(TutorState.PROCESSING)

    // 40s Safety Watchdog prevents permanent locking if network or LLM times out
    const answeringWatchdog = setTimeout(() => {
      if (isAnsweringRef.current) {
        console.warn('[VOICE] Question answering watchdog timed out (40s); recovering state.');
        isAnsweringRef.current = false;
        setChatLoading(false);
        if (voiceManagerRef.current?.state === TutorState.PROCESSING || voiceManagerRef.current?.state === TutorState.ARIA_SPEAKING) {
          voiceManagerRef.current?.returnToSleep();
        }
      }
    }, 40000);

    // Get current concept being explained on chalkboard
    const currentConceptText = (sentencesRef.current && sentencesRef.current[savedLecturePositionRef.current]) ||
      (sentencesRef.current && sentencesRef.current[currentSentenceIdxRef.current]) ||
      activeLessonRef.current?.title || ''

    setVoiceStatusText(`✨ Question: "${cleanQuestion}"`)
    setChatMessages((prev) => [...prev, { sender: 'user', text: cleanQuestion }])
    setChatLoading(true)

    try {
      const historyToSend = (chatMessagesRef.current || []).slice(-8)
      const courseIdToUse = course?.id || activeCourseIdRef.current || 'active-course';
      const chatRes = await api.chatWithTutor(courseIdToUse, {
        message: cleanQuestion,
        courseTitle: course?.title || 'Safety & Operations Course',
        lessonTitle: activeLessonRef.current?.title,
        currentConcept: currentConceptText,
        language: selectedLanguageCode,
        conversationHistory: historyToSend,
        aiName: aiTutorName
      })
      if (!isMountedRef.current) {
        clearTimeout(answeringWatchdog);
        return;
      }
      const ariaAnswer = chatRes.text || chatRes.reply || "I'm ready to help with your course questions!"
      setChatMessages((prev) => [...prev, { sender: 'aria', text: ariaAnswer }])
      setVoiceStatusText(`🤖 ${aiTutorName} is explaining...`)

      voiceManagerRef.current?.setState(TutorState.ARIA_SPEAKING)

      // Speak ARIA answer with 100% microphone suppression and echo recording
      speakAriaAnswer(ariaAnswer, () => {
        clearTimeout(answeringWatchdog);
        isAnsweringRef.current = false
        if (wasLecturePlayingRef.current) {
          const resumePhrase = RESUME_COURSE_PHRASES[selectedLanguageCode] || RESUME_COURSE_PHRASES.en
          setVoiceStatusText(`▶️ ${resumePhrase}`)
          setTimeout(() => {
            speakAriaAnswer(resumePhrase, () => {
              resumeLectureFromExactPosition()
              voiceManagerRef.current?.returnToSleep()
            })
          }, 400)
        } else {
          // Lecture was paused or idle: transition to follow-up listening so student can ask another question!
          const vm = voiceManagerRef.current;
          if (vm) {
            vm.ttsMutedUntil = 0;
            vm.setState(TutorState.FOLLOW_UP_LISTENING);
            vm.resetFollowUpTimeout();
            try {
              vm.restartSpeechRecognition?.(true);
            } catch (e) { }
          }
          setVoiceStatusText(`💬 ${aiTutorName} is listening for your next question...`);
        }
      })
    } catch (err) {
      clearTimeout(answeringWatchdog);
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

    setVoiceStatusText(`🎙️ Always-On Mic Active (${currentLangObj.native}) — Say "${aiWakeWord}" anytime!`)

    const onWake = transcript => {
      if (!isMountedRef.current || isAnsweringRef.current) return
      const question = extractQuestionFromWakeWord(transcript, aiWakeWord, aiTutorName)
      const complete = question && !isDanglingFragment(question) && !isNoiseOrHallucination(question)
      interruptLectureAndWake(complete ? question : null)
    }

    const manager = new VoiceTutorManager({
      debug: false,
      followUpTimeoutMs: 12000,
      aiName: aiTutorName,
      wakeWord: aiWakeWord,
      onWakeWordDetected: onWake,
      onAudioCaptured: async (audioBlob, context = {}) => {
        if (!isMountedRef.current || isTranscribingRef.current) return
        isTranscribingRef.current = true
        try {
          const isWakeDetection = context.isWakeDetection || manager.state === TutorState.SLEEPING
          const res = await api.transcribeSpeech(audioBlob, selectedLanguageCode)
          if (!isMountedRef.current || voiceManagerRef.current !== manager || isAnsweringRef.current) return;
          const transcription = (res?.text || '').trim()

          if (!transcription || isNoiseOrHallucination(transcription) || transcription.length < 3) {
            const recordedState = context.state
            // After wake, empty Whisper must NOT sleep — keep listening for the question
            if (
              recordedState === TutorState.ACTIVE_LISTENING ||
              recordedState === TutorState.FOLLOW_UP_LISTENING ||
              manager.state === TutorState.ACTIVE_LISTENING ||
              manager.state === TutorState.FOLLOW_UP_LISTENING ||
              manager.state === TutorState.PROCESSING
            ) {
              if (!isWakeDetection && recordedState !== TutorState.SLEEPING) {
                manager.setState(TutorState.ACTIVE_LISTENING)
                manager.resetFollowUpTimeout()
                setVoiceStatusText(`👂 Still listening… ask your question (or say "${aiWakeWord}")`)
                return
              }
            }
            if (isWakeDetection || manager.state === TutorState.SLEEPING) {
              if (manager.state !== TutorState.SLEEPING) manager.returnToSleep()
            }
            return
          }

          if (containsWakeWord(transcription, aiWakeWord, aiTutorName)) {
            onWake(transcription)
            return
          }

          if (playingRef.current || isAriaSpeakingRef.current || isLectureEcho(transcription)) {
            if (manager.state === TutorState.PROCESSING) {
              manager.returnToSleep()
            }
            return
          }

          if (isWakeDetection) {
            if (manager.state === TutorState.PROCESSING) manager.returnToSleep()
            return
          }

          // Final noise gate before LLM — reject ambient Whisper loops or dangling fragments
          if (isNoiseOrHallucination(transcription)) {
            if (manager.state === TutorState.PROCESSING) manager.returnToSleep()
            return
          }

          if (isDanglingFragment(transcription)) {
            if (
              manager.state === TutorState.PROCESSING ||
              manager.state === TutorState.ACTIVE_LISTENING ||
              manager.state === TutorState.FOLLOW_UP_LISTENING
            ) {
              manager.setState(TutorState.ACTIVE_LISTENING)
              manager.resetFollowUpTimeout()
              setVoiceStatusText('👂 Still listening… please continue your question')
            }
            return
          }

          handleVoiceQuestion(transcription)
        } catch (err) {
          console.error('[VOICE] Whisper transcription failed:', err)
          // Stay awake and let browser ASR / retry capture the question
          if (
            context.state === TutorState.ACTIVE_LISTENING ||
            context.state === TutorState.FOLLOW_UP_LISTENING ||
            manager.state === TutorState.PROCESSING
          ) {
            manager.setState(TutorState.ACTIVE_LISTENING)
            manager.resetFollowUpTimeout()
            setVoiceStatusText('👂 Mic ready — please ask your question again')
          } else if (manager.state !== TutorState.SLEEPING) {
            manager.returnToSleep()
          }
        } finally {
          isTranscribingRef.current = false
        }
      },
      onQuestionReady: (questionText) => {
        if (!isMountedRef.current) return;
        handleVoiceQuestion(questionText)
      },
      onReturnToSleep: () => {
        if (!isMountedRef.current) return;
        if (wasLecturePlayingRef.current) {
          const resumePhrase = RESUME_COURSE_PHRASES[selectedLanguageCode] || RESUME_COURSE_PHRASES.en
          setVoiceStatusText(`▶️ ${resumePhrase}`)
          speakAriaAnswer(resumePhrase, () => {
            resumeLectureFromExactPosition()
          })
        } else {
          setVoiceStatusText(`🎙️ Always-On Mic Active (${currentLangObj.native}) — Say "${aiWakeWord}" anytime!`)
        }
      }
    })

    manager.onStateChange((newState) => {
      if (!isMountedRef.current) return;
      setTutorVoiceState(newState)
      if (newState === TutorState.SLEEPING) {
        setVoiceStatusText(`🎙️ Always-On Mic Active (${currentLangObj.native}) — Say "${aiWakeWord}" anytime!`)
      } else if (newState === TutorState.WAKE_DETECTED) {
        setVoiceStatusText(`✨ "${aiWakeWord}" Detected! Waking up...`)
      } else if (newState === TutorState.ARIA_GREETING) {
        const ack = ACKNOWLEDGMENTS[selectedLanguageCode] || ACKNOWLEDGMENTS.en
        setVoiceStatusText(`👋 ${aiTutorName}: "${ack}"`)
      } else if (newState === TutorState.ACTIVE_LISTENING) {
        setVoiceStatusText(`👂 Listening for your question (${currentLangObj.native})...`)
      } else if (newState === TutorState.PROCESSING) {
        setVoiceStatusText(`⚡ ${aiTutorName} is searching course knowledge...`)
      } else if (newState === TutorState.ARIA_SPEAKING) {
        setVoiceStatusText(`🗣️ ${aiTutorName} is explaining...`)
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
    // Keep deps narrow — aiName/wakeWord updates must not remount (destroys mid-listen)
  }, [handsFreeVoice, speechRecognitionLang, course?.id, aiWakeWord, aiTutorName])

  // Hot-update wake config without destroying the mic session
  useEffect(() => {
    if (!voiceManagerRef.current) return
    voiceManagerRef.current.aiName = aiTutorName
    voiceManagerRef.current.wakeWord = aiWakeWord
    voiceManagerRef.current.options = {
      ...voiceManagerRef.current.options,
      aiName: aiTutorName,
      wakeWord: aiWakeWord
    }
  }, [aiTutorName, aiWakeWord])

  // Manual Microphone Button Handler (Optional manual trigger)
  const toggleRecording = async () => {
    if (recording) {
      vadStateRef.current = 'PROCESSING'
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop() } catch (e) { }
      }
      setRecording(false)
      return
    }

    if (playingRef.current) {
      wasLecturePlayingRef.current = true
      savedLecturePositionRef.current = currentSentenceIdxRef.current
      try {
      if (window._skillbridgeCurrentAudio) {
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      }
      window.speechSynthesis.cancel();
      preloadedAudioMap.current.clear();
    } catch (e) { }
      setPlaying(false)
    }

    setVoiceStatusText(`🎙️ Listening... Speak your question to ${aiTutorName}`)
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
      isManuallyPausedRef.current = false;
      const request = ++explanationRequest.current;
      setExplanationError(false);
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
        setExplanation(immediateScript);
        setLessonVisuals(activeLesson.visuals || []);
        setLoadingExplanation(false);
        setPipelineState('READY');
        return;
      }

      // 3. Fallback: Fetch from backend (which checks PostgreSQL Course.curriculum cache before RAG)
      setLoadingExplanation(true);
      setPipelineState('PREPARING');
      setExplanation('');
      setLessonVisuals(activeLesson.visuals || []);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const requestLang = langCode;
      api.getLessonExplanation(course.id, activeLesson.id, activeLesson.title, requestLang, controller.signal)
        .then(res => {
          if (!isMountedRef.current || explanationRequest.current !== request) return;
          const script = res.explanation || res.spoken_explanation || '';
          if (requestLang !== 'en' && !textMatchesLanguage(script, requestLang)) {
            console.warn('[CoursePlayer] Script may not strictly match language code, but displaying to learner:', requestLang);
          }
          if (script) {
            lessonExplanationClientCache.set(cacheKey, script);
            setExplanation(script);
          }
          if (res.page_or_slide_number && res.page_or_slide_number !== currentPageNum) {
            setCurrentPageNum(res.page_or_slide_number);
          }
          setTutorGuidance({
            keyPoints: res.key_points || [],
            safetyWarnings: res.safety_warnings || [],
            transition: res.suggested_next_transition || ''
          });
          setLessonVisuals(res.visuals || activeLesson.visuals || []);
          setLoadingExplanation(false);
          setPipelineState('READY');
        })
        .catch((err) => {
          if (!isMountedRef.current || explanationRequest.current !== request) return;
          console.warn('[CoursePlayer] Could not fetch lesson explanation:', err?.message);
          setExplanationError(true);
          setLoadingExplanation(false);

          // Resilient Pedagogical Fallback: If localized backend fetch failed,
          // recover using the available lesson explanation so the student is never blocked
          const fallbackText = activeLesson?.explanations?.[requestLang] ||
            activeLesson?.explanation ||
            activeLesson?.title ||
            '';
          if (fallbackText && fallbackText.length > 20) {
            setExplanation(fallbackText);
            setPipelineState('READY');
          }
        })
        .finally(() => clearTimeout(timeout));
      return () => {
        clearTimeout(timeout);
        if (explanationRequest.current === request) explanationRequest.current++;
        controller.abort();
      };

    }
  }, [course, activeLessonId, preferredLanguage, selectedLanguageCode, retryCount]);

  // Complete Unicode regex matching all emojis
  const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{FE00}-\u{FE0F}]/gu

  // Helper to clean raw text for Speech TTS (removes hashtags, references, markdown symbols, placeholders, and emojis)
  const cleanForSpeech = (text) => {
    if (!text) return ''
    return stripSlidePlaceholders(cleanSpeechUtil(text))
  }

  // Helper to clean raw text for Chalkboard Display (removes emojis, references, #, ###, markdown symbols, placeholders, prompt leakage)
  const cleanForBoard = (text) => {
    if (!text) return ''
    return stripSlidePlaceholders(cleanUnsupportedWords(text))
  }

  const sentences = useMemo(() => {
    if (!explanation) return []
    const cleanExp = stripSlidePlaceholders(cleanUnsupportedWords(explanation))
    const teacherSentences = buildTeacherLectureSentences(cleanExp, activeLesson?.title || '', course?.title || '', selectedLanguageCode)
    const lines = teacherSentences
      .map(s => cleanForSpeech(s))
      .filter(s => s && s.length > 5 && !isNoiseOrHallucination(s))

    return lines
  }, [explanation, activeLesson?.title, course?.title, selectedLanguageCode])

  // Autonomous AI Tutor: Automatically activate teaching when course/lesson explanation is ready
  useEffect(() => {
    if (!loadingExplanation && explanation && sentences.length > 0 && !isManuallyPausedRef.current && !playing) {
      playingRef.current = true;
      setPlaying(true);
    }
  }, [loadingExplanation, explanation, sentences.length, playing])

  // Pre-buffer first 3 sentences of the active slide into memory so playback starts instantaneously
  useEffect(() => {
    if (!sentences || sentences.length === 0) return;
    const isMale = (aiVoiceConfig?.gender || '').toLowerCase() === 'male';
    const effectiveGender = isMale ? 'MALE' : 'FEMALE';

    for (let i = 0; i < Math.min(3, sentences.length); i++) {
      const text = cleanForSpeech(sentences[i]);
      if (text && !preloadedAudioMap.current.has(i)) {
        try {
          const url = api.getTtsAudioUrl(text, {
            language: selectedLanguageCode,
            gender: effectiveGender,
            rate: tutorRate,
            pitch: tutorPitch
          });
          const preAudio = new Audio(url);
          preAudio.preload = 'auto';
          preAudio.load();
          preloadedAudioMap.current.set(i, preAudio);
        } catch (_) {}
      }
    }
  }, [sentences, selectedLanguageCode, tutorRate, tutorPitch, aiVoiceConfig?.gender]);

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

  const resolveMediaUrl = (url, fallbackSlideNum = 1) => {
    if (!url) {
      if (course?.id) {
        return api.getCourseSlideImageUrl(course.id, fallbackSlideNum);
      }
      return null;
    }
    if (typeof url === 'string') {
      if (url.startsWith('data:')) return url;
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('/api')) {
        return url;
      }
    }
    return url;
  };

  // Reset slide image load error when current page or lesson changes
  useEffect(() => {
    setSlideImageLoadError(false);
  }, [currentPageNum, activeLessonId]);

  // Universal Document Viewer Page Extraction (PDF, PPTX, PPT, DOCX, DOC, Images)
  const documentPages = useMemo(() => {
    // 1. Check slides (PPTX, PPT)
    const slidesList = (Array.isArray(course?.slides) && course.slides.length > 0)
      ? course.slides
      : (Array.isArray(course?.curriculumData?.slides) && course.curriculumData.slides.length > 0)
        ? course.curriculumData.slides
        : (course?.curriculum && typeof course.curriculum === 'object' && Array.isArray(course.curriculum.slides) && course.curriculum.slides.length > 0)
          ? course.curriculum.slides
          : null;

    if (slidesList && slidesList.length > 0) {
      return slidesList.map((s, idx) => {
        const sNum = s.slideNumber || idx + 1;
        const fullImg = s.fullSlideImage ||
          (Array.isArray(s.images) ? (s.images.find(im => String(im.id || '').startsWith('full_slide') || String(im.id || '').startsWith('slide_') || im.purpose?.includes('exact powerpoint')) || s.images[0]) : null) ||
          s.image;
        const rawUrl = fullImg?.url || fullImg?.dataUrl || (typeof fullImg === 'string' ? fullImg : null) || s.image || s.url;
        const imgUrl = rawUrl ? resolveMediaUrl(rawUrl, sNum) : (course?.id ? api.getCourseSlideImageUrl(course.id, sNum) : null);
        return {
          pageNumber: sNum,
          title: s.title || `Slide ${sNum}`,
          type: 'slide',
          image: imgUrl,
          text: s.fullText || '',
          headings: s.headings || [],
          paragraphs: s.paragraphs || [],
          tables: s.tables || [],
          bulletPoints: s.bulletPoints || [],
          speakerNotes: s.speakerNotes || ''
        };
      });
    }

    // 2. Check pages (PDF, DOCX, Images, Text)
    const pagesList = (Array.isArray(course?.pages) && course.pages.length > 0)
      ? course.pages
      : (Array.isArray(course?.curriculumData?.pages) && course.curriculumData.pages.length > 0)
        ? course.curriculumData.pages
        : (course?.curriculum && typeof course.curriculum === 'object' && Array.isArray(course.curriculum.pages) && course.curriculum.pages.length > 0)
          ? course.curriculum.pages
          : null;

    if (pagesList && pagesList.length > 0) {
      return pagesList.map((p, idx) => {
        const pNum = p.page_number || p.pageNumber || idx + 1;
        const fullImg = p.pageImage ||
          (Array.isArray(p.images) ? (p.images.find(im => String(im.id || '').startsWith('full_page') || im.purpose?.includes('exact document page')) || p.images[0]) : null) ||
          p.image;
        const rawUrl = fullImg?.url || fullImg?.dataUrl || (typeof fullImg === 'string' ? fullImg : null) || p.image || p.url;
        const imgUrl = rawUrl ? resolveMediaUrl(rawUrl, pNum) : (course?.id ? api.getCoursePageImageUrl(course.id, pNum) : null);
        return {
          pageNumber: pNum,
          title: p.title || `Page ${pNum}`,
          type: 'page',
          image: imgUrl,
          text: p.text || '',
          headings: p.headings || [],
          paragraphs: p.paragraphs || [],
          bulletPoints: p.bulletPoints || []
        };
      });
    }

    // 3. Fallback: Check curriculum.lessons with visuals or slideData
    if (Array.isArray(course?.lessons) && course.lessons.length > 0) {
      return course.lessons.map((l, idx) => {
        const sNum = l.sourceSlides?.[0] || idx + 1;
        const v = (Array.isArray(l.visuals) ? (l.visuals.find(vis => String(vis.id || '').startsWith('full_')) || l.visuals[0]) : null) || l.slideData?.images?.[0];
        const rawUrl = v?.dataUrl || v?.url;
        const imgUrl = rawUrl ? resolveMediaUrl(rawUrl, sNum) : (course?.id ? api.getCourseSlideImageUrl(course.id, sNum) : null);
        return {
          pageNumber: sNum,
          title: l.title || `Section ${idx + 1}`,
          type: 'section',
          image: imgUrl,
          text: l.slideData?.fullText || l.explanation || '',
          headings: l.slideData?.headings || [],
          paragraphs: l.slideData?.paragraphs || [],
          bulletPoints: l.slideData?.bulletPoints || []
        };
      });
    }

    return [];
  }, [course]);

  const totalPages = useMemo(() => Math.max(1, documentPages.length), [documentPages]);

  const currentDocPage = useMemo(() => {
    if (!documentPages || documentPages.length === 0) return null;
    return documentPages.find(p => p.pageNumber === currentPageNum) || documentPages[0];
  }, [documentPages, currentPageNum]);

  const fileTypeBadge = useMemo(() => {
    const ext = (course?.fileName || '').split('.').pop()?.toLowerCase();
    const type = (course?.fileType || course?.curriculumData?.fileType || course?.curriculum?.fileType || ext || '').toLowerCase();
    if (type.includes('pdf')) return 'PDF DOCUMENT';
    if (type.includes('ppt')) return 'POWERPOINT SLIDES';
    if (type.includes('doc')) return 'WORD DOCUMENT';
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'image'].includes(type)) return 'ORIGINAL IMAGE';
    return `${(ext || 'TRAINING').toUpperCase()} DOCUMENT`;
  }, [course]);

  // Synchronize currentPageNum when activeLesson changes
  useEffect(() => {
    if (activeLesson) {
      const pageNum = activeLesson.sourceSlides?.[0] || (course?.lessons ? course.lessons.findIndex(l => l.id === activeLesson.id) + 1 : 1);
      if (pageNum && pageNum !== currentPageNum) {
        setCurrentPageNum(pageNum);
      }
    }
  }, [activeLesson, course?.lessons]);

  const handleNavigatePage = (targetPageNum) => {
    if (targetPageNum < 1 || targetPageNum > totalPages) return;
    setCurrentPageNum(targetPageNum);

    const matchingLesson = course?.lessons?.find(l => {
      const s = Array.isArray(l.sourceSlides) ? l.sourceSlides : [l.id];
      return s.includes(targetPageNum);
    });

    if (matchingLesson && matchingLesson.id !== activeLessonId) {
      setActiveLessonId(matchingLesson.id);
    }

    try {
      if (window._skillbridgeCurrentAudio) {
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      }
      window.speechSynthesis.cancel();
    } catch (e) {}

    // Instant client cache hit for visited slides
    const cacheKey = `${course?.id}_slide_${targetPageNum}_${selectedLanguageCode}`;
    if (lessonExplanationClientCache.has(cacheKey)) {
      const cachedExp = lessonExplanationClientCache.get(cacheKey);
      setExplanation(cachedExp);
      setLoadingExplanation(false);
      setPipelineState('READY');
      setCurrentSentenceIdx(0);
      setElapsedSeconds(0);
      if (playingRef.current) setPlaying(true);
      return;
    }

    // Instant cache hit from pre-loaded course slides payload
    const slidesList = (Array.isArray(course?.slides) && course.slides.length > 0)
      ? course.slides
      : ((Array.isArray(course?.curriculumData?.slides) && course.curriculumData.slides.length > 0)
        ? course.curriculumData.slides
        : (course?.curriculum?.slides || []));
    const targetSlide = slidesList.find(s => (s.slideNumber || s.sourceSlide) === targetPageNum);
    const preCachedSlideExp = targetSlide?.explanations?.[selectedLanguageCode] ||
      (selectedLanguageCode === 'en' ? targetSlide?.explanation : null);

    if (preCachedSlideExp && typeof preCachedSlideExp === 'string' && preCachedSlideExp.length > 20) {
      lessonExplanationClientCache.set(cacheKey, preCachedSlideExp);
      setExplanation(preCachedSlideExp);
      setLoadingExplanation(false);
      setPipelineState('READY');
      setCurrentSentenceIdx(0);
      setElapsedSeconds(0);
      if (playingRef.current) setPlaying(true);
      return;
    }

    setLoadingExplanation(true);
    const request = ++explanationRequest.current;
    setExplanationError(false);
    setExplanation('');

    api.explainCoursePage(course.id, targetPageNum, selectedLanguageCode)
      .then(res => {
        if (!isMountedRef.current || explanationRequest.current !== request) return;
        setTutorGuidance({
          keyPoints: res.key_points || [],
          safetyWarnings: res.safety_warnings || [],
          transition: res.suggested_next_transition || ''
        });
        const exp = res.spoken_explanation || res.explanation || '';
        if (exp) {
          lessonExplanationClientCache.set(cacheKey, exp);
          setExplanation(exp);
          setCurrentSentenceIdx(0);
          setElapsedSeconds(0);
          if (playingRef.current) setPlaying(true);
        }
        setLoadingExplanation(false);
      })
      .catch(err => {
        if (!isMountedRef.current || explanationRequest.current !== request) return;
        console.warn('Page explain notice:', err.message);
        setLoadingExplanation(false);
      });
  };

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

  // Align elapsedSeconds when concept index changes during initial lesson open or manual seek (NOT during active playback to prevent skipping)
  useEffect(() => {
    if (!loadingExplanation && sentences.length > 0 && totalSeconds > 0 && !playing) {
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
      isManuallyPausedRef.current = false;
      if (currentSentenceIdx >= sentences.length - 1 && elapsedSeconds >= totalSeconds - 1) {
        setCurrentSentenceIdx(0);
        currentSentenceIdxRef.current = 0;
        setElapsedSeconds(0);
        elapsedSecondsRef.current = 0;
      }
      try {
        if (window._skillbridgeCurrentAudio) {
          window._skillbridgeCurrentAudio.pause();
          window._skillbridgeCurrentAudio.currentTime = 0;
          window._skillbridgeCurrentAudio = null;
        }
        window.speechSynthesis.cancel();
      } catch (e) { }
      playingRef.current = true;
      setPlaying(true);
      setChatCollapsed(true);
      requestPlayerFullscreen();
    } else {
      isManuallyPausedRef.current = true;
      savedLecturePositionRef.current = currentSentenceIdxRef.current;
      playingRef.current = false;
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      if (window._skillbridgeCurrentAudio) {
        try {
          window._skillbridgeCurrentAudio.onended = null;
          window._skillbridgeCurrentAudio.onerror = null;
          window._skillbridgeCurrentAudio.onplay = null;
          window._skillbridgeCurrentAudio.ontimeupdate = null;
          window._skillbridgeCurrentAudio.pause();
          window._skillbridgeCurrentAudio.currentTime = 0;
          window._skillbridgeCurrentAudio.src = '';
          window._skillbridgeCurrentAudio = null;
        } catch (e) { }
      }
      try {
        window.speechSynthesis.cancel();
      } catch (e) { }
      setIsAriaSpeaking(false);
      isAriaSpeakingRef.current = false;
      setActiveSpokenWord('');
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

  // Speech TTS handler with clean speech text and natural Google Voice human cadence
  useEffect(() => {
    if (playing && !muted && !loadingExplanation && sentences.length > 0) {
      let isCancelled = false;

      const speak = (idx) => {
        if (isCancelled || !playingRef.current || !isMountedRef.current) return;
        if (idx >= sentences.length) {
          setPlaying(false);
          currentSentenceIdxRef.current = 0;
          setCurrentSentenceIdx(0);
          setActiveSpokenWord('');
          if (activeLesson?.id) {
            markLessonCompleted(activeLesson.id);
          }

          const currentIdx = course.lessons.findIndex(l => l.id === activeLesson?.id);
          const nextLesson = course.lessons[currentIdx + 1];
          const currentModule = activeLesson?.moduleTitle || activeLesson?.chapterTitle || '';
          const nextModule = nextLesson?.moduleTitle || nextLesson?.chapterTitle || '';
          const isLastLessonOfModule = !nextLesson || (currentModule !== nextModule);

          if (isLastLessonOfModule) {
            setVoiceStatusText('🎉 Chapter complete! Preparing your assessment, please wait...');
            setLoadingQuiz(true);
            setTimeout(() => {
              if (handleTakeChapterAssessmentRef.current) {
                handleTakeChapterAssessmentRef.current();
              }
            }, 600);
          } else if (nextLesson) {
            setVoiceStatusText(`✅ Lesson completed! Advancing to: ${nextLesson.title}...`);
            isManuallyPausedRef.current = false;
            setTimeout(() => {
              setActiveLessonId(nextLesson.id);
              currentSentenceIdxRef.current = 0;
              setCurrentSentenceIdx(0);
              setElapsedSeconds(0);
              elapsedSecondsRef.current = 0;
              playingRef.current = true;
              setPlaying(true);
            }, 800);
          }
          return;
        }

        const spokenText = cleanForSpeech(sentences[idx]);
        if (!spokenText) {
          const nextIdx = idx + 1;
          currentSentenceIdxRef.current = nextIdx;
          setCurrentSentenceIdx(nextIdx);
          speak(nextIdx);
          return;
        }

        // Real-time Presentation Slide Synchronization:
        // Automatically flip slides to match the sentence topic being taught
        const sourceSlides = Array.isArray(activeLesson?.sourceSlides) && activeLesson.sourceSlides.length > 0
          ? activeLesson.sourceSlides
          : null;
        if (sourceSlides && sentences.length > 0) {
          const slidePos = Math.min(sourceSlides.length - 1, Math.floor((idx / sentences.length) * sourceSlides.length));
          const targetSlide = sourceSlides[slidePos];
          if (targetSlide && targetSlide !== currentPageNum) {
            setCurrentPageNum(targetSlide);
          }
        }

        try {

          // Helper to cleanly advance to the next sentence with teacher pacing
          const handleSentenceAdvance = () => {
            if (isCancelled || !playingRef.current || !isMountedRef.current) return;
            if (watchdogRef.current) {
              clearTimeout(watchdogRef.current);
              watchdogRef.current = null;
            }
            if (window._skillbridgeCurrentAudio) {
              try {
                window._skillbridgeCurrentAudio.onended = null;
                window._skillbridgeCurrentAudio.onerror = null;
                window._skillbridgeCurrentAudio.onplay = null;
                window._skillbridgeCurrentAudio.ontimeupdate = null;
                window._skillbridgeCurrentAudio.pause();
                window._skillbridgeCurrentAudio.currentTime = 0;
                window._skillbridgeCurrentAudio.src = '';
              } catch (_) {}
              window._skillbridgeCurrentAudio = null;
            }
            try { window.speechSynthesis.cancel(); } catch (_) {}
            if (utteranceRef.current) {
              utteranceRef.current.onstart = null;
              utteranceRef.current.onend = null;
              utteranceRef.current.onerror = null;
              utteranceRef.current.onboundary = null;
              utteranceRef.current = null;
            }
            window._activeSpeechUtterance = null;
            setIsAriaSpeaking(false);
            isAriaSpeakingRef.current = false;
            setActiveSpokenWord('');

            const nextIdx = idx + 1;
            currentSentenceIdxRef.current = nextIdx;
            setCurrentSentenceIdx(nextIdx);

            // Natural Teacher Breathing Cadence: clear pauses between sentences, headings, and bullet points
            let pauseDurationMs = 400; // Natural short breath between normal sentences
            if (/[?？]\s*$/.test(spokenText)) {
              pauseDurationMs = 750; // Reflective pause for questions
            } else if (/^(welcome|in this lesson|let's examine|now let's pay|to wrap up|next let's review|regarding)/i.test(spokenText) || /[:—]\s*$/.test(spokenText)) {
              pauseDurationMs = 800; // Longer pause after section headings and introductions
            } else if (/^(first and foremost|to begin with|next|also|furthermore|additionally|another important|step \d+)/i.test(spokenText)) {
              pauseDurationMs = 650; // Distinct pause after bullet points and sequential steps
            } else if (/[!！]\s*$/.test(spokenText) || /warning|hazard|caution|danger|safety|emergency|ppe|mandatory/i.test(spokenText)) {
              pauseDurationMs = 600; // Pause for emphasis on critical safety terms
            }

            if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
            speechTimeoutRef.current = setTimeout(() => {
              if (!isCancelled && playingRef.current && isMountedRef.current) {
                speak(nextIdx);
              }
            }, pauseDurationMs);
          };

          // Primary: Studio Neural TTS (Microsoft Edge Neural TTS: Jenny for Female, Christopher for Male)
          // Studio neural TTS produces broadcast-grade human waveforms. Single-source audio eliminates dual-voice overlap.
          try {
            const isMale = (aiVoiceConfig?.gender || '').toLowerCase() === 'male';
            const effectiveGender = isMale ? 'MALE' : 'FEMALE';

            const audioUrl = api.getTtsAudioUrl(spokenText, {
              language: selectedLanguageCode,
              gender: effectiveGender,
              rate: tutorRate,
              pitch: tutorPitch
            });

            // Strictly neutralize any existing audio or speech synthesis
            try { window.speechSynthesis.cancel(); } catch (_) {}
            window._activeSpeechUtterance = null;

            if (window._skillbridgeCurrentAudio) {
              try {
                window._skillbridgeCurrentAudio.onended = null;
                window._skillbridgeCurrentAudio.onerror = null;
                window._skillbridgeCurrentAudio.onplay = null;
                window._skillbridgeCurrentAudio.ontimeupdate = null;
                window._skillbridgeCurrentAudio.pause();
                window._skillbridgeCurrentAudio.currentTime = 0;
                window._skillbridgeCurrentAudio.src = '';
              } catch (_) { }
              window._skillbridgeCurrentAudio = null;
            }

            // Pipeline pre-fetch upcoming sentences immediately in the background
            for (let offset = 1; offset <= 2; offset++) {
              const targetIdx = idx + offset;
              if (targetIdx < sentences.length && !preloadedAudioMap.current.has(targetIdx)) {
                const textToPreload = cleanForSpeech(sentences[targetIdx]);
                if (textToPreload) {
                  try {
                    const targetUrl = api.getTtsAudioUrl(textToPreload, {
                      language: selectedLanguageCode,
                      gender: effectiveGender,
                      rate: tutorRate,
                      pitch: tutorPitch
                    });
                    const pre = new Audio(targetUrl);
                    pre.preload = 'auto';
                    pre.load();
                    preloadedAudioMap.current.set(targetIdx, pre);
                  } catch (_) { }
                }
              }
            }

            // Check if this sentence was already pre-buffered into memory
            let audio = preloadedAudioMap.current.get(idx);
            if (!audio || audio.error) {
              audio = new Audio(audioUrl);
              audio.preload = 'auto';
            }
            preloadedAudioMap.current.delete(idx);
            window._skillbridgeCurrentAudio = audio;

            let hasStarted = false;
            let hasAdvanced = false;
            let playbackWatchdog = null;
            let canplayTimer = null;

            const clearTimers = () => {
              if (playbackWatchdog) { clearTimeout(playbackWatchdog); playbackWatchdog = null; }
              if (canplayTimer) { clearTimeout(canplayTimer); canplayTimer = null; }
            };

            const triggerAdvance = () => {
              if (hasAdvanced || isCancelled || !playingRef.current || !isMountedRef.current) return;
              hasAdvanced = true;
              clearTimers();
              setIsAriaSpeaking(false);
              isAriaSpeakingRef.current = false;
              handleSentenceAdvance();
            };

            const onAudioStart = () => {
              if (hasStarted || isCancelled || !playingRef.current || !isMountedRef.current) return;
              hasStarted = true;
              clearTimers();

              // Strictly cancel any lingering or background Web Speech synthesis
              try { window.speechSynthesis.cancel(); } catch (_) {}
              utteranceRef.current = null;
              window._activeSpeechUtterance = null;

              voiceManagerRef.current?.noteSpokenText?.(spokenText);
              setIsAriaSpeaking(true);
              isAriaSpeakingRef.current = true;
              setPipelineState('PLAYING');

              // Safety playback watchdog: if onended never fires or sub-frame stall occurs, auto-advance
              const rawDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(3, spokenText.length / 8);
              const watchdogDurationMs = Math.ceil(rawDuration * 1000) + 2500;
              playbackWatchdog = setTimeout(() => {
                if (!hasAdvanced && playingRef.current && isMountedRef.current) {
                  console.warn(`[VOICE] Playback watchdog reached for sentence ${idx}. Advancing cleanly...`);
                  triggerAdvance();
                }
              }, watchdogDurationMs);
            };

            audio.onplay = onAudioStart;

            audio.ontimeupdate = () => {
              if (audio.duration > 0) {
                const ratio = audio.currentTime / audio.duration;
                const words = spokenText.split(' ');
                const wordIdx = Math.min(words.length - 1, Math.floor(ratio * words.length));
                setActiveSpokenWord(words[wordIdx] || '');
              }
            };

            audio.onended = () => {
              triggerAdvance();
            };

            audio.onerror = (e) => {
              console.warn(`[VOICE] Studio neural stream notice for sentence ${idx}:`, e);
              triggerAdvance();
            };

            const startPlay = () => {
              if (!isMountedRef.current || isCancelled || !playingRef.current || hasStarted) return;
              const playPromise = audio.play();
              if (playPromise !== undefined) {
                playPromise.catch((playErr) => {
                  console.warn('[VOICE] Neural audio playback deferred:', playErr?.message);
                  if (playErr?.name === 'NotAllowedError') {
                    setAutoplayBlocked(true);
                    const unlockAutoplay = () => {
                      setAutoplayBlocked(false);
                      window.removeEventListener('click', unlockAutoplay);
                      window.removeEventListener('keydown', unlockAutoplay);
                      window.removeEventListener('touchstart', unlockAutoplay);
                      if (!hasStarted && playingRef.current && isMountedRef.current && !hasAdvanced) {
                        audio.play().catch(() => triggerAdvance());
                      }
                    };
                    window.addEventListener('click', unlockAutoplay, { once: true });
                    window.addEventListener('keydown', unlockAutoplay, { once: true });
                    window.addEventListener('touchstart', unlockAutoplay, { once: true });
                  } else {
                    setTimeout(() => {
                      if (!hasStarted && playingRef.current && isMountedRef.current && !hasAdvanced) {
                        const retry = audio.play();
                        if (retry !== undefined) {
                          retry.catch(() => triggerAdvance());
                        }
                      }
                    }, 600);
                  }
                });
              }
            };

            // Agile Buffering Watchdog: give remote synthesis 8s max before advancing cleanly
            canplayTimer = setTimeout(() => {
              if (!hasStarted && playingRef.current && isMountedRef.current) {
                console.warn('[VOICE] Neural audio stream threshold reached (8s). Advancing cleanly...');
                triggerAdvance();
              }
            }, 8000);

            const onAudioReady = () => {
              audio.removeEventListener('canplay', onAudioReady);
              audio.removeEventListener('canplaythrough', onAudioReady);
              audio.removeEventListener('loadeddata', onAudioReady);
              startPlay();
            };

            // Only trigger playback once audio has buffered data to avoid abort glitches
            if (audio.readyState >= 2) {
              startPlay();
            } else {
              audio.addEventListener('canplay', onAudioReady, { once: true });
              audio.addEventListener('canplaythrough', onAudioReady, { once: true });
              audio.addEventListener('loadeddata', onAudioReady, { once: true });
              audio.load();
            }
          } catch (err) {
            console.warn('[VOICE] Neural audio init notice:', err);
            triggerAdvance();
          }
        } catch (e) {
          console.warn('Speech execution notice:', e);
          handleSentenceAdvance();
        }
      };

      speak(currentSentenceIdxRef.current || 0);

      return () => {
        isCancelled = true;
        if (speechTimeoutRef.current) {
          clearTimeout(speechTimeoutRef.current);
          speechTimeoutRef.current = null;
        }
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        if (window._skillbridgeCurrentAudio) {
          try {
            window._skillbridgeCurrentAudio.onended = null;
            window._skillbridgeCurrentAudio.onerror = null;
            window._skillbridgeCurrentAudio.onplay = null;
            window._skillbridgeCurrentAudio.ontimeupdate = null;
            window._skillbridgeCurrentAudio.pause();
            window._skillbridgeCurrentAudio.currentTime = 0;
            window._skillbridgeCurrentAudio.src = '';
            window._skillbridgeCurrentAudio = null;
          } catch (e) { }
        }
        if (utteranceRef.current) {
          utteranceRef.current.onstart = null;
          utteranceRef.current.onend = null;
          utteranceRef.current.onerror = null;
          utteranceRef.current.onboundary = null;
          utteranceRef.current = null;
        }
        window._activeSpeechUtterance = null;
        try { window.speechSynthesis.cancel(); } catch (e) { }
        const isTutorGreetingOrSpeaking = Boolean(
          voiceManagerRef.current?.state === TutorState.ARIA_GREETING ||
          voiceManagerRef.current?.state === TutorState.ARIA_SPEAKING ||
          voiceManagerRef.current?.state === TutorState.PROCESSING ||
          isAnsweringRef.current
        );
        if (!isTutorGreetingOrSpeaking) {
          setIsAriaSpeaking(false);
          isAriaSpeakingRef.current = false;
        }
        setActiveSpokenWord('');
      };
    } else {
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      if (window._skillbridgeCurrentAudio) {
        try {
          window._skillbridgeCurrentAudio.onended = null;
          window._skillbridgeCurrentAudio.onerror = null;
          window._skillbridgeCurrentAudio.onplay = null;
          window._skillbridgeCurrentAudio.ontimeupdate = null;
          window._skillbridgeCurrentAudio.pause();
          window._skillbridgeCurrentAudio.currentTime = 0;
          window._skillbridgeCurrentAudio.src = '';
          window._skillbridgeCurrentAudio = null;
        } catch (e) { }
      }
      if (utteranceRef.current) {
        utteranceRef.current.onstart = null;
        utteranceRef.current.onend = null;
        utteranceRef.current.onerror = null;
        utteranceRef.current.onboundary = null;
        utteranceRef.current = null;
      }
      window._activeSpeechUtterance = null;
      const isTutorGreetingOrSpeaking = Boolean(
        voiceManagerRef.current?.state === TutorState.ARIA_GREETING ||
        voiceManagerRef.current?.state === TutorState.ARIA_SPEAKING ||
        voiceManagerRef.current?.state === TutorState.PROCESSING ||
        isAnsweringRef.current
      );
      if (!isTutorGreetingOrSpeaking) {
        setIsAriaSpeaking(false);
        isAriaSpeakingRef.current = false;
        try { window.speechSynthesis.cancel(); } catch (e) { }
      }
      setActiveSpokenWord('');
    }
  }, [playing, muted, sentences, loadingExplanation, activeLesson?.id, selectedLanguageCode, preferredVoiceLangCode, aiVoiceConfig]);

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

    // If lecture is playing, immediately stop lecture synchronously
    const wasPlaying = Boolean(playingRef.current || playing);
    if (wasPlaying) {
      if (!wasLecturePlayingRef.current) {
        wasLecturePlayingRef.current = true;
        savedLecturePositionRef.current = currentSentenceIdxRef.current;
      }
      playingRef.current = false;
      setPlaying(false);
      voiceManagerRef.current?.setLecturePlaying(false);
    }
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (utteranceRef.current) {
      utteranceRef.current.onstart = null;
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current = null;
    }
    window._activeSpeechUtterance = null;
    if (window._skillbridgeCurrentAudio) {
      try {
        window._skillbridgeCurrentAudio.onended = null;
        window._skillbridgeCurrentAudio.onerror = null;
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      } catch (e) { }
    }
    try {
      window.speechSynthesis.cancel();
      preloadedAudioMap.current.clear();
    } catch (e) { }

    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current)
      followUpTimerRef.current = null
    }

    // Synchronously engage lockouts so the microphone will NOT listen to the tutor's own audio
    isAnsweringRef.current = true
    voiceManagerRef.current?.setState?.(TutorState.PROCESSING)
    voiceManagerRef.current?.setConversationMode?.(true)

    setChatMessages(prev => [...prev, { sender: 'user', text: userMsg }])
    setChatLoading(true)
    inConversationModeRef.current = true
    setVoiceStatusText(`✨ Question: "${userMsg}"`)

    // 60s Safety Watchdog prevents permanent answering lock if network or LLM is delayed
    const chatAnsweringWatchdog = setTimeout(() => {
      if (isMountedRef.current && isAnsweringRef.current) {
        console.warn('[CHAT] Tutor answering watchdog triggered (60s)');
        isAnsweringRef.current = false;
        setChatLoading(false);
      }
    }, 60000);

    const currentConceptText = (sentencesRef.current && sentencesRef.current[savedLecturePositionRef.current]) ||
      (sentencesRef.current && sentencesRef.current[currentSentenceIdxRef.current]) ||
      activeLessonRef.current?.title || ''

    const courseIdToUse = course?.id || activeCourseIdRef.current || 'active-course';
    api.chatWithTutor(courseIdToUse, {
      message: userMsg,
      courseTitle: course?.title || 'Safety & Operations Course',
      lessonTitle: activeLessonRef.current?.title,
      currentConcept: currentConceptText,
      language: selectedLanguageCode,
      conversationHistory: (chatMessagesRef.current || []).slice(-8),
      aiName: aiTutorName
    })
      .then(res => {
        if (!isMountedRef.current) {
          clearTimeout(chatAnsweringWatchdog);
          isAnsweringRef.current = false;
          return;
        }
        const ariaAnswer = res.text || res.reply || "I'm ready to help with your course questions!"
        setChatMessages(prev => [...prev, { sender: 'aria', text: ariaAnswer }])
        setVoiceStatusText(`🤖 ${aiTutorName} is answering...`)
        setChatLoading(false)

        speakAriaAnswer(ariaAnswer, () => {
          clearTimeout(chatAnsweringWatchdog);
          isAnsweringRef.current = false;
          if (wasLecturePlayingRef.current) {
            const resumePhrase = RESUME_COURSE_PHRASES[selectedLanguageCode] || RESUME_COURSE_PHRASES.en;
            setVoiceStatusText(`▶️ ${resumePhrase}`);
            setTimeout(() => {
              speakAriaAnswer(resumePhrase, () => {
                resumeLectureFromExactPosition();
                voiceManagerRef.current?.returnToSleep();
              });
            }, 400);
          } else if (handsFreeVoiceRef.current) {
            isAwakeRef.current = true;
            inConversationModeRef.current = true;
            voiceManagerRef.current?.setState?.(TutorState.FOLLOW_UP_LISTENING);
            setVoiceStatusText(`💬 ${aiTutorName} is listening for follow-up (or say "Resume")...`);
            followUpTimerRef.current = setTimeout(() => {
              voiceManagerRef.current?.returnToSleep?.();
              resumeLectureFromExactPosition();
            }, 6000);
          } else {
            voiceManagerRef.current?.returnToSleep?.();
            setVoiceStatusText('');
          }
        })
      })
      .catch(err => {
        clearTimeout(chatAnsweringWatchdog);
        isAnsweringRef.current = false;
        if (!isMountedRef.current) return;
        console.error('Chat tutor error:', err);
        setChatMessages(prev => [...prev, { sender: 'aria', text: `⚠️ ${err.message || 'The AI tutor is temporarily unavailable. Please try again in a moment.'}` }])
        setChatLoading(false)
        if (wasLecturePlayingRef.current) {
          setTimeout(() => {
            resumeLectureFromExactPosition()
          }, 1500)
        } else {
          voiceManagerRef.current?.returnToSleep?.()
          setVoiceStatusText('')
        }
      })
  }

  // Comprehensive Back button exit handler ensuring immediate speech cancellation
  const handleExit = () => {

    // 1. Immediately flag unmounted and stop all playback flags BEFORE triggering Web Speech cancel
    isMountedRef.current = false;
    setPlaying(false);
    playingRef.current = false;
    setIsAriaSpeaking(false);
    isAriaSpeakingRef.current = false;
    isAnsweringRef.current = false;
    wasLecturePlayingRef.current = false;

    // 2. Detach utterance listeners so onend/onerror cannot fire next sentence
    if (utteranceRef.current) {
      utteranceRef.current.onstart = null;
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }

    // 3. Halt all audio elements, speech synthesis queue, and intervals
    haltAllSkillBridgeAudio();

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

    if (activeLessonRef.current?.id && !isLessonDone(activeLessonRef.current.id)) {
      saveLessonPlayback(activeLessonRef.current.id, currentSentenceIdxRef.current, elapsedSecondsRef.current);
    }

    onExit?.();
  };

  // Unified module grouping for course curriculum
  const moduleGroups = useMemo(() => {
    const rawLessons = (course.lessons && course.lessons.length > 0)
      ? course.lessons
      : (course.curriculum && Array.isArray(course.curriculum) && course.curriculum.length > 0 && course.curriculum[0].lessons)
        ? course.curriculum.flatMap(m => m.lessons || [])
        : [];
    if (!rawLessons || !rawLessons.length) return []
    const groups = []
    let currentGroup = null

    rawLessons.forEach((rawLesson, index) => {
      const lesson = {
        ...rawLesson,
        title: cleanUnsupportedWords(rawLesson.title, `Lesson ${index + 1}`)
      }
      const rawModule = cleanUnsupportedWords(lesson.moduleTitle || lesson.chapterTitle || 'Module 1', 'Module 1')
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
  }, [course.lessons, course.curriculum])

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
                <h1 className="text-xs font-bold text-slate-900 leading-snug truncate">{cleanUnsupportedWords(course.title)}</h1>
                <p className="text-[11px] text-slate-400 font-medium">
                  {moduleGroups.reduce((acc, g) => acc + g.lessons.length, 0) || course.lessons?.length || 0} Lessons
                </p>
              </div>
            </div>
          </div>

          <hr className="shrink-0 border-slate-100 my-2.5" />

          {/* Course Content Section - Unified Module Groups */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-900">Curriculum Lessons</h2>
              <span className="text-[10px] text-slate-400 font-semibold">
                {moduleGroups.reduce((acc, g) => acc + g.lessons.length, 0) || course.lessons?.length || 0} Total
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5 no-scrollbar">
              {moduleGroups.map((group, gIdx) => (
                <div key={gIdx} className="space-y-1.5">
                  {/* Unified Module Group Header */}
                  <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
                    <span className="text-[10px] font-bold text-[#ff8c21] uppercase tracking-wide truncate max-w-[80%]" title={group.moduleTitle}>
                      {cleanUnsupportedWords(group.moduleTitle)}
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
                                try {
      if (window._skillbridgeCurrentAudio) {
        window._skillbridgeCurrentAudio.pause();
        window._skillbridgeCurrentAudio.currentTime = 0;
        window._skillbridgeCurrentAudio = null;
      }
      window.speechSynthesis.cancel();
      preloadedAudioMap.current.clear();
    } catch (e) { }
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
                                {index + 1}. {cleanUnsupportedWords(lesson.title)}
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
          <div className="shrink-0 flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              {(activeLesson?.chapterTitle || activeLesson?.moduleTitle) && (
                <span className="text-[10px] font-bold text-[#ff8c21] uppercase tracking-wider truncate block">
                  {cleanUnsupportedWords(activeLesson.chapterTitle || activeLesson.moduleTitle)}
                </span>
              )}
              <h2 className="text-base font-bold text-slate-900 leading-snug truncate">
                {cleanUnsupportedWords(activeLesson?.title || 'Introduction to Lesson Topics')}
              </h2>
            </div>

          </div>

          {/* ENLARGED CENTER LECTURE SLIDE VIDEO PLAYER UI WITH Sleek CONTROL BAR */}
          <div ref={playerRef} className="flex-1 min-h-0 bg-[#0f172a] text-white rounded-2xl border border-slate-800 shadow-md relative overflow-hidden flex flex-col justify-between">
            {/* Autonomous AI Tutor Autoplay Activation Banner */}
            {autoplayBlocked && (
              <button
                type="button"
                onClick={() => {
                  setAutoplayBlocked(false);
                  window.dispatchEvent(new Event('click'));
                }}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gradient-to-r from-[#ff8c21] to-amber-500 text-white rounded-full font-semibold text-xs sm:text-sm shadow-2xl flex items-center gap-2 hover:scale-105 active:scale-95 transition-all duration-200 animate-bounce border border-white/30 cursor-pointer"
              >
                <span>👋</span>
                <span>Click anywhere to start live teaching with {aiTutorName}</span>
                <span className="bg-white/20 rounded-full px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider">Start</span>
              </button>
            )}

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
                  Great job finishing this chapter! {aiTutorName} is preparing your personalized chapter assessment. The quiz will start automatically in a few seconds...
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
              {/* Split Content: Presentation Slide (Left) & Tutor Avatar (Right) */}
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 lg:gap-5 items-center my-0.5 sm:my-1">
                {/* Left Universal Document Viewer Canvas Container */}
                <div className="md:col-span-7 lg:col-span-8 bg-[#0b1329] rounded-2xl border-2 border-slate-700/80 p-2.5 sm:p-3 h-full flex flex-col justify-between overflow-hidden shadow-2xl relative min-h-[180px]">
                  {/* Main Display Canvas: Slide Screen Only */}
                  <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden relative">
                    {/* Non-intrusive floating explanation badge while assistant pre-warms explanation */}
                    {explanationError && (
                      <div className="absolute top-2 left-2 z-30 flex items-center gap-2 bg-slate-900/95 border border-amber-500/40 backdrop-blur-md rounded-xl px-3 py-1.5 shadow-xl animate-fadeIn">
                        <span className="text-amber-400 text-xs">⚠️</span>
                        <span className="text-xs text-slate-200 font-medium">
                          Couldn't load the lesson in {preferredLanguage}.
                        </span>
                        <button
                          type="button"
                          className="ml-1 px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 font-semibold text-xs rounded-md border border-amber-500/40 transition-colors cursor-pointer"
                          onClick={() => {
                            setExplanationError(false);
                            setRetryCount(count => count + 1);
                          }}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {loadingExplanation && (
                      <div className="absolute top-2 left-2 right-2 z-30 bg-slate-900/90 border border-[#ff8c21]/40 backdrop-blur-md rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs text-[#ff8c21] shadow-lg animate-fadeIn">
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#ff8c21]/20 border-t-[#ff8c21]" />
                        <span className="font-semibold text-[11px]">Preparing this lesson in {currentLangObj.native}?</span>
                      </div>
                    )}

                    {/* Faithful PowerPoint Presentation Slide Screen */}
                    {(currentDocPage?.image && !slideImageLoadError) || (activeVisual && (activeVisual.dataUrl || activeVisual.url) && !slideImageLoadError) ? (
                      <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
                        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950/80 shadow-lg relative group flex flex-col">
                          <div className={`relative flex-1 min-h-0 flex bg-black/60 overflow-auto no-scrollbar ${fitToWidth ? 'items-start justify-center p-1 sm:p-2' : 'items-center justify-center p-2'}`}>
                            <img
                              src={currentDocPage?.image || activeVisual.dataUrl || activeVisual.url}
                              alt={currentDocPage?.title || activeVisual?.descr || 'Presentation Slide'}
                              onError={() => setSlideImageLoadError(true)}
                              style={{
                                transform: zoomLevel !== 1 ? `scale(${zoomLevel})` : undefined,
                                transformOrigin: 'center top',
                                transition: 'transform 0.15s ease-out'
                              }}
                              className={`rounded-lg shadow-2xl cursor-zoom-in transition-all duration-200 ${
                                fitToWidth
                                  ? 'w-full h-auto object-contain max-h-none'
                                  : 'max-h-full max-w-full w-auto h-auto object-contain'
                              }`}
                              onClick={() => setEnlargedVisual({ dataUrl: currentDocPage?.image || activeVisual?.dataUrl || activeVisual?.url, name: currentDocPage?.title || activeVisual?.name })}
                              title="Click to view full-resolution presentation slide"
                            />
                          </div>
                          <div className="shrink-0 px-3 py-1.5 bg-slate-900/95 border-t border-slate-800 flex items-center justify-between gap-2 text-[10px]">
                            <span className="font-bold text-[#ff8c21] flex items-center gap-1.5 truncate">
                              <span>Slide {currentPageNum} of {totalPages}</span>
                              <span className="text-slate-300 font-medium truncate">• {cleanUnsupportedWords(currentDocPage?.title || activeLesson?.title)}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Interactive PowerPoint Presentation Slide Canvas (when image is rendering or text-structured) */
                      <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
                        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-700/80 bg-linear-to-br from-[#0c142c] via-[#101b3d] to-[#070d1e] shadow-xl relative flex flex-col p-4 sm:p-6 text-white justify-between">
                          {/* Slide Stage Header */}
                          <div className="shrink-0 pb-3 border-b border-slate-700/60 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="h-6 w-6 rounded-lg bg-[#ff8c21]/20 text-[#ff8c21] border border-[#ff8c21]/40 flex items-center justify-center text-xs font-bold">
                                📊
                              </span>
                              <div>
                                <span className="text-[10px] font-bold text-[#ff8c21] uppercase tracking-wider block">
                                  {fileTypeBadge.includes('SLIDE') ? 'PowerPoint Presentation' : 'Training Document'} • {currentPageNum} / {totalPages}
                                </span>
                                <h3 className="text-sm sm:text-base lg:text-lg font-bold text-white leading-tight">
                                  {cleanUnsupportedWords(currentDocPage?.title || activeLesson?.title || `Slide ${currentPageNum}`)}
                                </h3>
                              </div>
                            </div>
                            <span className="text-[10px] text-slate-400 font-semibold px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                              {cleanUnsupportedWords(course.title)}
                            </span>
                          </div>

                          {/* Slide Body Content */}
                          <div className="flex-1 min-h-0 my-3 overflow-y-auto pr-1 space-y-3 no-scrollbar text-left">
                            {/* Headings */}
                            {currentDocPage?.headings && currentDocPage.headings.length > 0 && (
                              <div className="space-y-1">
                                {currentDocPage.headings.map((h, hIdx) => (
                                  <h4 key={hIdx} className="text-xs sm:text-sm font-semibold text-orange-200">
                                    {h}
                                  </h4>
                                ))}
                              </div>
                            )}

                            {/* Bullet points */}
                            {currentDocPage?.bulletPoints && currentDocPage.bulletPoints.length > 0 ? (
                              <ul className="space-y-2 text-xs sm:text-[13px] text-slate-200">
                                {currentDocPage.bulletPoints.map((bp, bpIdx) => (
                                  <li key={bpIdx} className="flex items-start gap-2.5 leading-relaxed bg-slate-800/40 p-2 rounded-lg border border-slate-700/40">
                                    <span className="text-[#ff8c21] font-bold text-sm leading-none mt-0.5">▸</span>
                                    <span className="flex-1">{bp.replace(/^[-*•]\s*/, '')}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : currentDocPage?.text ? (
                              <div className="text-xs sm:text-[13px] text-slate-300 leading-relaxed whitespace-pre-line bg-slate-800/30 p-3 rounded-xl border border-slate-700/40">
                                {currentDocPage.text.slice(0, 800)}
                              </div>
                            ) : (
                              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
                                <span className="text-3xl mb-2">📊</span>
                                <p className="text-xs font-semibold text-slate-300">
                                  PowerPoint Slide {currentPageNum}: {currentDocPage?.title}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Slide Stage Footer */}
                          <div className="shrink-0 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                            <span className="flex items-center gap-1.5 font-medium">
                              <span className="text-[#ff8c21]">●</span> SkillBridge Interactive Slide Player
                            </span>
                            <span className="font-mono text-slate-400 font-bold">
                              Slide {currentPageNum} of {totalPages}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Safety Warnings Banner (when Qwen identifies safety caveats) */}
                    {tutorGuidance.safetyWarnings && tutorGuidance.safetyWarnings.length > 0 && (
                      <div className="mt-1.5 p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2 shrink-0 animate-fadeIn">
                        <span className="text-base shrink-0 leading-none">⚠️</span>
                        <div className="min-w-0 flex-1">
                          <span className="font-bold uppercase tracking-wider text-[10px] text-amber-400 block">
                            Operational Safety Notice:
                          </span>
                          <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-[11px] text-amber-100">
                            {tutorGuidance.safetyWarnings.map((warning, wIdx) => (
                              <li key={wIdx} className="truncate">{warning}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right ARIA Tutor Circle Avatar with Robot AI Emoji */}
                <div className="md:col-span-5 lg:col-span-4 h-full flex flex-col items-center justify-center text-center border-t md:border-t-0 md:border-l border-white/10 pt-3 md:pt-0 px-2 sm:px-4">
                  {/* Circular Avatar Frame with Robot Emoji (Clickable to call) */}
                  <button
                    type="button"
                    onClick={handleAvatarCall}
                    title={`Click to call ${aiTutorName} (or say "${aiWakeWord}")`}
                    className={`relative flex items-center justify-center h-28 w-28 sm:h-36 sm:w-36 md:h-40 md:w-40 lg:h-44 lg:w-44 rounded-full bg-[#182337] border-2 sm:border-[2.5px] cursor-pointer focus:outline-none ${
                      isAriaSpeaking || playing || tutorVoiceState === TutorState.ARIA_SPEAKING || tutorVoiceState === TutorState.ARIA_GREETING
                        ? 'border-[#ff8c21]/90 shadow-[0_0_30px_rgba(245,130,32,0.4)] avatar-active ring-4 ring-[#ff8c21]/20'
                        : tutorVoiceState === TutorState.ACTIVE_LISTENING || tutorVoiceState === TutorState.FOLLOW_UP_LISTENING
                          ? 'border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.35)] ring-4 ring-emerald-500/20 animate-pulse'
                          : 'border-[#293c5d] shadow-2xl'
                    }`}
                  >
                    <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center pointer-events-none">
                      <LipSyncAvatar
                        character={(aiVoiceConfig?.gender || '').toLowerCase() === 'male' ? 'male' : 'female'}
                        isSpeaking={isAriaSpeaking || playing || tutorVoiceState === TutorState.ARIA_SPEAKING || tutorVoiceState === TutorState.ARIA_GREETING}
                        audioElement={typeof window !== 'undefined' ? window._skillbridgeCurrentAudio : null}
                        size={176}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Calling / Listening ripple ring when awake */}
                    {(tutorVoiceState === TutorState.ACTIVE_LISTENING || tutorVoiceState === TutorState.FOLLOW_UP_LISTENING) && (
                      <span className="absolute -inset-2 rounded-full border-2 border-emerald-400 animate-ping opacity-60 pointer-events-none" />
                    )}
                  </button>

                  {/* ARIA AI TUTOR Pill Badge & Call Hint */}
                  <div className="mt-3 sm:mt-4 flex flex-col items-center gap-1.5 select-none">
                    <button
                      type="button"
                      onClick={handleAvatarCall}
                      className="px-4 py-1 rounded-full bg-[#131d2e] border border-[#2a3952] hover:border-[#ff8c21]/60 shadow-sm cursor-pointer transition flex items-center gap-1.5"
                    >
                      <span className="h-2 w-2 rounded-full bg-[#ff8c21] animate-pulse" />
                      <span className="text-xs sm:text-[13px] font-extrabold text-[#ff8c21] tracking-wider uppercase">
                        {aiTutorName} AI TUTOR
                      </span>
                    </button>
                    <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium">
                      Click avatar or say <strong className="text-slate-200">"{aiWakeWord}"</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Subtitle Caption Overlay */}
              {showCC && (
                <div className="shrink-0 bg-[#040814]/90 backdrop-blur-md rounded-lg py-1.5 sm:py-2 px-3 sm:px-4 border border-white/10 mt-1.5 sm:mt-2 text-center">
                  <p className="text-xs sm:text-sm text-white font-medium leading-relaxed italic truncate">
                    {loadingExplanation
                      ? `${aiTutorName}: "Preparing lesson explanation..."`
                      : (playing ? `${aiTutorName}: "${cleanForBoard(sentences[currentSentenceIdx]) || `Focusing on ${cleanForBoard(activeLesson?.title || 'the current topic')}`}"` : 'Lecture paused.')}
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
                  elapsedSecondsRef.current = newSeconds
                  setCurrentSentenceIdx(newIdx)
                  currentSentenceIdxRef.current = newIdx
                  if (playing) {
                    try {
                      if (window._skillbridgeCurrentAudio) {
                        window._skillbridgeCurrentAudio.pause();
                        window._skillbridgeCurrentAudio.currentTime = 0;
                        window._skillbridgeCurrentAudio = null;
                      }
                      window.speechSynthesis.cancel();
                      preloadedAudioMap.current.clear();
                    } catch (e) { }
                    playingRef.current = false;
                    setPlaying(false);
                    setTimeout(() => {
                      if (isMountedRef.current && !isManuallyPausedRef.current) {
                        playingRef.current = true;
                        setPlaying(true);
                      }
                    }, 60);
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
              title={`Open Ask ${aiTutorName}`}
            >
              <svg className="h-5 w-5 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-[9px] font-extrabold tracking-wide [writing-mode:vertical-rl] rotate-180">Ask {aiTutorName}</span>
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
                <h3 className="text-xs sm:text-sm font-bold text-[#0f1b2d]">Ask {aiTutorName}</h3>
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
                  title={`Minimize Ask ${aiTutorName}`}
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
                    <div className="h-8 w-8 rounded-full bg-[#182337] border border-[#ff8c21] overflow-hidden shrink-0 mt-0.5 shadow-xs select-none">
                      <img
                        src={`/avatars/${(aiVoiceConfig?.gender || '').toLowerCase() === 'male' ? 'male' : 'female'}/base.png`}
                        alt="AI Tutor"
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
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
                  {aiTutorName} is typing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Bottom Chat Input Form - Clean Full Width without manual mic */}
            <form onSubmit={handleSendChat} className="shrink-0 flex items-center gap-1.5 sm:gap-2 border-t border-slate-100 pt-2 pb-0.5">
              <input
                type="text"
                placeholder={`Ask ${aiTutorName} anything...`}
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

export default CoursePlayer;
