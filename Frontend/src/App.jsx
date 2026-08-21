import { useEffect, useState } from 'react'
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
import Home from './pages/Home'
import Language from './pages/Language'
import Login from './pages/Login'
import MyCertificates from './pages/MyCertificates'
import { courses as defaultCourses } from './data/courses'
import { api } from './services/api'

// Helper to map DB AI course
const mapRagCourse = (dbCourse) => {
  const curriculumData = typeof dbCourse.curriculum === 'string'
    ? JSON.parse(dbCourse.curriculum)
    : dbCourse.curriculum;

  return {
    id: dbCourse.id,
    isCustom: true,
    title: dbCourse.title,
    instructor: 'ARIA AI Tutor',
    category: 'AI Custom Courses',
    level: 'Adaptive',
    rating: 5.0,
    reviewCount: 'Dynamic',
    students: 'Published',
    duration: 'Self-Paced',
    modules: curriculumData.curriculum?.length || 0,
    price: 0,
    free: true,
    badge: 'AI Course',
    badgeTone: 'orange',
    tags: ['AI-POWERED'],
    image: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #60a5fa 100%)',
    description: dbCourse.description || curriculumData.description || 'AI custom course generated from document.',
    fileName: dbCourse.fileName,
    fileText: dbCourse.fileText,
    learning: curriculumData.learning || [],
    includes: curriculumData.includes || [],
    curriculum: curriculumData.curriculum || [],
    lessons: curriculumData.lessons || [],
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
  const isAuthenticated = Boolean(sessionStorage.getItem('skillbridge_user'))
  const languageReady = Boolean(sessionStorage.getItem('skillbridge_language'))

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (!languageReady) {
    return <Navigate to="/language" replace />
  }

  return (
    <div className="h-screen max-h-screen overflow-hidden flex flex-col bg-[#f4f6fb]">
      <Header
        onLogoClick={() => navigate('/')}
        onLogout={() => {
          sessionStorage.removeItem('skillbridge_user')
          sessionStorage.removeItem('skillbridge_language')
          navigate('/login')
        }}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showSearch={true}
      />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
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
  const [course, setCourse] = useState(location.state?.course || null)
  const [loading, setLoading] = useState(!course)
  const [accessError, setAccessError] = useState('')

  useEffect(() => {
    if (id && !course) {
      setLoading(true)
      setAccessError('')
      api.getCourseDetail(id)
        .then(res => {
          setCourse(mapRagCourse(res))
        })
        .catch(err => {
          console.error("Failed to load course details for player:", err)
          setAccessError(err.message || 'Access denied. You are not assigned to this course.')
        })
        .finally(() => setLoading(false))
    }
  }, [id, course])

  if (loading) {
    return (
      <div className="min-h-svh bg-[#0b0e14] flex flex-col items-center justify-center text-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange/20 border-t-orange mb-4" />
        <p className="text-sm font-semibold text-slate-300">Loading AI Tutor Player...</p>
      </div>
    )
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
      onExit={() => navigate('/')}
      onAssessment={(courseObj, activeLesson, quizQuestions, nextLessonId) =>
        navigate(`/assessment/${id}`, {
          state: { course: courseObj || course, activeLesson, quizQuestions, nextLessonId }
        })
      }
    />
  )
}

// Assessment Page Route Component
const AssessmentRoute = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [course, setCourse] = useState(location.state?.course || null)
  const [accessDenied, setAccessDenied] = useState(false)

  const activeLesson = location.state?.activeLesson
  const quizQuestions = location.state?.quizQuestions
  const nextLessonId = location.state?.nextLessonId

  useEffect(() => {
    if (!course && id) {
      api.getCourseDetail(id)
        .then(res => setCourse(mapRagCourse(res)))
        .catch(err => {
          console.error(err)
          setAccessDenied(true)
        })
    }
  }, [id, course])

  if (accessDenied) {
    return (
      <div className="min-h-svh bg-[#0b0e14] flex flex-col items-center justify-center text-white p-6 text-center">
        <span className="text-3xl mb-3">🔒</span>
        <h2 className="text-lg font-bold mb-2">Access Denied</h2>
        <p className="text-xs text-slate-400 mb-4">You are not assigned to this course assessment.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-xl bg-orange px-4 py-2 text-xs font-bold text-white border-0"
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
  if (sessionStorage.getItem('skillbridge_user')) {
    return <Navigate to="/" replace />
  }
  return (
    <Login
      onSuccess={() => {
        if (!sessionStorage.getItem('skillbridge_language')) {
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
  if (!sessionStorage.getItem('skillbridge_user')) {
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
        const user = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')?.user;
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
