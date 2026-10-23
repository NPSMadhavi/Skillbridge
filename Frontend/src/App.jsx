import { useEffect, useState, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams, useLocation } from 'react-router-dom'
import AdminLayout from './components/admin/AdminLayout'
import Header from './components/Header'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminLogin from './pages/admin/AdminLogin'
import Assessment from './pages/Assessment'
import CoursePlayer from './pages/CoursePlayer'
import RegisterUser from './pages/admin/RegisterUser'
import UsersList from './pages/admin/UsersList'
import AdminCourses from './pages/admin/AdminCourses'
import CourseAssignments from './pages/admin/CourseAssignments'
import AdminManagement from './pages/admin/AdminManagement'
import AdminAiSettings from './pages/admin/AdminAiSettings'
import Home from './pages/Home'

import Language from './pages/Language'
import Login from './pages/Login'
import MyCertificates from './pages/MyCertificates'
import SuperAdminLogin from './pages/superAdmin/SuperAdminLogin'
import SuperAdminDashboard from './pages/superAdmin/SuperAdminDashboard'
import { courses as defaultCourses } from './data/courses'
import { api } from './services/api'
import { clearStoredLanguage, hasStoredLanguage } from './utils/language'
import { cleanUnsupportedWords } from './utils/textCleaner'
import { clearStudentSession, isStudentAuthenticated, getStudentUser } from './utils/authSession'

// Helper to map DB AI course
const mapRagCourse = (dbCourse) => {
  if (!dbCourse) return null;
  if (dbCourse._isMapped && Array.isArray(dbCourse.lessons) && dbCourse.lessons.length > 0) {
    return dbCourse;
  }

  const curriculumData = typeof dbCourse.curriculum === 'string'
    ? JSON.parse(dbCourse.curriculum)
    : (dbCourse.curriculumData || (typeof dbCourse.curriculum === 'object' && !Array.isArray(dbCourse.curriculum) ? dbCourse.curriculum : {}));

  // Extract authentic original slides, pages, and visuals
  const slides = (Array.isArray(curriculumData.slides) && curriculumData.slides.length > 0)
    ? curriculumData.slides
    : (Array.isArray(dbCourse.slides) ? dbCourse.slides : []);

  const pages = (Array.isArray(curriculumData.pages) && curriculumData.pages.length > 0)
    ? curriculumData.pages
    : (Array.isArray(dbCourse.pages) ? dbCourse.pages : []);

  const visuals = (Array.isArray(curriculumData.visuals) && curriculumData.visuals.length > 0)
    ? curriculumData.visuals
    : (Array.isArray(dbCourse.visuals) ? dbCourse.visuals : []);

  const fileType = curriculumData.fileType || dbCourse.fileType || (dbCourse.fileName?.split('.').pop()?.toLowerCase()) || '';

  // Extract lessons from dbCourse.lessons, curriculumData.lessons, or synthesize from chunks / slides
  let lessons = [];
  if (Array.isArray(dbCourse.lessons) && dbCourse.lessons.length > 0) {
    lessons = dbCourse.lessons;
  } else if (Array.isArray(curriculumData.lessons) && curriculumData.lessons.length > 0) {
    lessons = curriculumData.lessons;
  } else if (Array.isArray(dbCourse.curriculumData?.lessons) && dbCourse.curriculumData.lessons.length > 0) {
    lessons = dbCourse.curriculumData.lessons;
  }

  const chunks = Array.isArray(dbCourse.chunks) ? dbCourse.chunks : [];
  if (lessons.length === 0 && chunks.length > 0) {
    lessons = chunks.map((c, idx) => ({
      id: idx + 1,
      title: cleanUnsupportedWords(c.concept || c.topic || `Concept ${idx + 1}`),
      moduleTitle: cleanUnsupportedWords(c.topic || dbCourse.title),
      chapterTitle: cleanUnsupportedWords(c.topic || dbCourse.title),
      sourceSlides: Array.isArray(c.sourceSlides) && c.sourceSlides.length > 0 ? c.sourceSlides : [c.sourcePage || idx + 1],
      duration: '02:30',
      status: idx === 0 ? 'active' : 'locked',
      explanation: c.chunkText || c.semanticSummary || '',
      bulletPoints: (Array.isArray(c.keyPoints) ? c.keyPoints : []).map(kp => cleanUnsupportedWords(kp))
    }));
  } else if (lessons.length === 0 && slides.length > 0) {
    lessons = slides.map((s, idx) => ({
      id: idx + 1,
      title: cleanUnsupportedWords(s.title || `Slide ${idx + 1}`),
      moduleTitle: `Slide Presentation`,
      chapterTitle: `Slide Presentation`,
      sourceSlides: [s.slideNumber || idx + 1],
      duration: '02:00',
      status: idx === 0 ? 'active' : 'locked',
      explanation: s.fullText || '',
      bulletPoints: (s.bulletPoints || []).map(bp => cleanUnsupportedWords(bp))
    }));
  } else if (lessons.length > 0) {
    lessons = lessons.map(l => ({
      ...l,
      title: cleanUnsupportedWords(l.title),
      moduleTitle: cleanUnsupportedWords(l.moduleTitle || l.chapterTitle, dbCourse.title),
      chapterTitle: cleanUnsupportedWords(l.chapterTitle || l.moduleTitle, dbCourse.title)
    }));
  }

  return {
    _isMapped: true,
    id: dbCourse.id,
    isCustom: true,
    title: cleanUnsupportedWords(dbCourse.title),
    instructor: 'ARIA AI Tutor',
    category: 'AI Custom Courses',
    level: 'Adaptive',
    rating: 5.0,
    reviewCount: 'Dynamic',
    students: 'Published',
    duration: 'Self-Paced',
    modules: curriculumData.curriculum?.length || Math.ceil(lessons.length / 4) || 1,
    price: 0,
    free: true,
    badge: 'AI Course',
    badgeTone: 'orange',
    tags: ['AI-POWERED'],
    image: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #60a5fa 100%)',
    description: cleanUnsupportedWords(dbCourse.description || curriculumData.description || 'AI custom course generated from document.'),
    fileName: dbCourse.fileName,
    fileText: dbCourse.fileText,
    fileType,
    slides,
    pages,
    visuals,
    chunks,
    learning: curriculumData.learning || [],
    includes: curriculumData.includes || [],
    curriculum: Array.isArray(curriculumData.curriculum) ? curriculumData.curriculum : [],
    curriculumData,
    lessons,
    quiz: curriculumData.quiz || []
  };
};

const getAdminSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem('skillbridge_admin') || 'null')
  } catch {
    return null
  }
}

// Protected Student Shell with Header
const StudentShell = ({ children, searchQuery, setSearchQuery }) => {
  const navigate = useNavigate()
  const isAuthenticated = isStudentAuthenticated()
  const languageReady = hasStoredLanguage()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (!languageReady) {
    return <Navigate to="/language" replace />
  }

  return (
    <div className="h-screen max-h-screen flex flex-col bg-[#f8fafc] overflow-hidden">
      <Header
        onLogoClick={() => navigate('/')}
        onLogout={() => {
          clearStudentSession()
          clearStoredLanguage()
          navigate('/login')
        }}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showSearch={true}
      />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

// Course Player Page Route Component
const CoursePlayerRoute = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const fetchedIdRef = useRef(null)

  // Initialize course instantly from router state or fast client cache
  const [course, setCourse] = useState(() => {
    if (location.state?.course) return mapRagCourse(location.state.course);
    const cached = api.getCachedCourse(id);
    if (cached) return mapRagCourse(cached);
    return null;
  });

  const [loading, setLoading] = useState(!course);
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    if (!id || fetchedIdRef.current === id) return;
    fetchedIdRef.current = id;

    let isMounted = true;
    api.getCourseDetail(id)
      .then(res => {
        if (!isMounted) return;
        const mapped = mapRagCourse(res);
        setCourse(mapped);
        setLoading(false);
      })
      .catch(err => {
        if (!isMounted) return;
        console.error("Failed to load course details for player:", err);
        setCourse(prev => {
          if (!prev) {
            setAccessError(err.message || 'Access denied. You are not assigned to this course.');
          }
          return prev;
        });
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading && !course) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex flex-col overflow-hidden animate-pulse">
        <div className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between">
          <div className="h-4 w-20 bg-slate-200 rounded" />
          <div className="h-4 w-48 bg-slate-200 rounded" />
          <div className="h-8 w-32 bg-slate-200 rounded-lg" />
        </div>
        <div className="flex-1 flex gap-4 p-4 max-w-7xl mx-auto w-full">
          <div className="w-80 bg-white rounded-2xl border border-slate-200 p-4 space-y-3 hidden md:block">
            <div className="h-4 w-32 bg-slate-200 rounded" />
            <div className="h-12 bg-slate-100 rounded-xl" />
            <div className="h-12 bg-slate-100 rounded-xl" />
            <div className="h-12 bg-slate-100 rounded-xl" />
          </div>
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between">
            <div className="h-6 w-64 bg-slate-200 rounded" />
            <div className="h-72 bg-slate-900 rounded-2xl flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange/20 border-t-orange" />
            </div>
            <div className="h-12 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (accessError || !course) {
    return (
      <div className="min-h-svh bg-[#0b0e14] flex flex-col items-center justify-center text-white p-6 text-center">
        <div className="h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 grid place-items-center text-2xl mb-4">
          🔒
        </div>
        <h2 className="font-display text-xl font-bold text-white mb-2">
          Course Access Restricted
        </h2>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          {accessError || 'You do not have access to play this course. Only courses assigned to your account by an administrator can be accessed.'}
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="cursor-pointer rounded-xl bg-orange hover:bg-orange/90 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition border-0"
        >
          Return to My Dashboard
        </button>
      </div>
    )
  }

  return (
    <CoursePlayer
      key={`${id}_${location.state?.nextLessonId || 'current'}`}
      course={course}
      initialCompletedLessonId={location.state?.completedLessonId}
      initialAutoPlayNext={location.state?.autoPlayNext}
      initialNextLessonId={location.state?.nextLessonId}
      onExit={() => {
        try {
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => { });
          }
          window.speechSynthesis?.cancel?.();
        } catch (e) { }
        navigate('/')
      }}
      onAssessment={(courseObj, activeLesson, quizQuestions, nextLessonId) => {
        try { window.speechSynthesis?.cancel?.(); } catch (e) { }
        navigate(`/assessment/${id}`, {
          state: { course: courseObj || course, activeLesson, quizQuestions, nextLessonId }
        })
      }}
    />
  )
}

// Assessment Page Route Component
const AssessmentRoute = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const fetchedIdRef = useRef(null)

  const [course, setCourse] = useState(() => {
    if (location.state?.course) return location.state.course;
    const cached = api.getCachedCourse(id);
    if (cached) return mapRagCourse(cached);
    return null;
  });
  const [loading, setLoading] = useState(!course)
  const [accessDenied, setAccessDenied] = useState(false)

  const activeLesson = location.state?.activeLesson
  const quizQuestions = location.state?.quizQuestions
  const nextLessonId = location.state?.nextLessonId

  useEffect(() => {
    if (!id || course || fetchedIdRef.current === id) return;
    fetchedIdRef.current = id;
    setLoading(true);
    api.getCourseDetail(id)
      .then(res => setCourse(mapRagCourse(res)))
      .catch(err => {
        console.error('Failed to load course for assessment:', err)
        setAccessDenied(true)
      })
      .finally(() => setLoading(false))
  }, [id, course])

  if (!isStudentAuthenticated()) {
    return <Navigate to="/login" replace />
  }

  if (loading && !course) {
    return (
      <div className="min-h-screen bg-[#f4f7fc] flex flex-col items-center justify-center text-slate-800">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#ff8c21]/20 border-t-[#ff8c21] mb-4" />
        <p className="text-sm font-semibold text-slate-600">Preparing Assessment Questions...</p>
      </div>
    )
  }

  if (accessDenied || !course) {
    return (
      <div className="min-h-screen bg-[#f4f7fc] flex flex-col items-center justify-center text-slate-800 p-6 text-center">
        <span className="text-3xl mb-3">🔒</span>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Access Denied</h2>
        <p className="text-xs text-slate-500 mb-4">You are not assigned to this course assessment.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-xl bg-[#ff8c21] hover:bg-[#e87a15] px-5 py-2.5 text-xs font-bold text-white border-0 cursor-pointer shadow-sm transition"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }

  const isFinalAssessment = !nextLessonId || (course?.lessons && activeLesson?.id === course.lessons[course.lessons.length - 1]?.id)

  return (
    <Assessment
      course={course}
      lessonTitle={activeLesson?.title}
      quizQuestions={quizQuestions}
      isFinalAssessment={isFinalAssessment}
      onExit={() => navigate(`/play/${id}`, { state: { course } })}
      onFinishAssessment={() =>
        navigate(`/play/${id}`, {
          state: {
            course,
            completedLessonId: activeLesson?.id,
            autoPlayNext: true,
            nextLessonId
          }
        })
      }
    />
  )
}

// Student Login Route Component
const StudentLoginRoute = () => {
  const navigate = useNavigate()
  if (isStudentAuthenticated()) {
    return <Navigate to="/" replace />
  }
  return (
    <Login
      onSuccess={() => {
        if (!hasStoredLanguage()) {
          navigate('/language')
        } else {
          navigate('/')
        }
      }}
    />
  )
}

// Language Selection Route Component
const LanguageRoute = () => {
  const navigate = useNavigate()
  if (!isStudentAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  return <Language onContinue={() => navigate('/')} />
}

// Admin Login Guard Component
const AdminLoginRoute = () => {
  if (getAdminSession()) {
    return <Navigate to="/admin/dashboard" replace />
  }
  return <AdminLogin />
}

// Home Route wrapper to handle play navigation
const HomeRoute = ({ searchQuery }) => {
  const navigate = useNavigate()
  const handleSelectCourse = (course) => {
    if (course?.id) {
      try {
        const user = getStudentUser();
        const userId = user?.id || user?.finNumber || user?.email || 'guest';
        localStorage.setItem(`skillbridge_last_played_${userId}`, String(course.id));
        localStorage.setItem('skillbridge_last_played', String(course.id));
      } catch (e) { }
    }
    navigate(`/play/${course.id}`, { state: { course } });
  }

  return (
    <Home
      searchQuery={searchQuery}
      onOpenCourse={handleSelectCourse}
      onPlayCourse={handleSelectCourse}
    />
  )
}

function App() {
  const [query, setQuery] = useState('')

  return (
    <BrowserRouter>
      <Routes>
        {/* Student Routes with Explicit Paths */}
        <Route path="/login" element={<StudentLoginRoute />} />
        <Route path="/language" element={<LanguageRoute />} />

        <Route
          path="/"
          element={
            <StudentShell searchQuery={query} setSearchQuery={setQuery}>
              <HomeRoute searchQuery={query} />
            </StudentShell>
          }
        />
        <Route
          path="/home"
          element={
            <StudentShell searchQuery={query} setSearchQuery={setQuery}>
              <HomeRoute searchQuery={query} />
            </StudentShell>
          }
        />

        <Route path="/play/:id" element={<CoursePlayerRoute />} />
        <Route path="/assessment/:id" element={<AssessmentRoute />} />
        <Route path="/certificates" element={<MyCertificates />} />

        {/* Admin Routes with Explicit Paths */}
        <Route path="/admin" element={<AdminLoginRoute />} />
        <Route path="/admin/login" element={<AdminLoginRoute />} />

        <Route element={<AdminLayout />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/register" element={<RegisterUser />} />
          <Route path="/admin/users" element={<UsersList />} />
          <Route path="/admin/courses" element={<AdminCourses />} />
          <Route path="/admin/assignments" element={<CourseAssignments />} />
          <Route path="/admin/admins" element={<AdminManagement />} />
          <Route path="/admin/ai-settings" element={<AdminAiSettings />} />
        </Route>


        {/* Super Admin Multi-Tenant Control Plane Routes */}
        <Route path="/super-admin/login" element={<SuperAdminLogin />} />
        <Route path="/super-admin" element={<SuperAdminDashboard />} />
        <Route path="/super-admin/dashboard" element={<SuperAdminDashboard />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
