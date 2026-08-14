import { useMemo, useState, useEffect } from 'react'
import { courses } from '../data/courses'
import { api } from '../services/api'

const PythonLogo = ({ className = "h-6 w-6" }) => (
  <svg className={className} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M63.35 4C35.03 4 36.43 16.3 36.43 16.3L36.48 29.07H64.08V32.96H24.79C24.79 32.96 4 30.64 4 58.91C4 87.18 22.09 85.8 22.09 85.8L32.86 85.8V70.66C32.86 70.66 32.35 52.48 50.84 52.48H77.94C77.94 52.48 91.73 52.92 91.73 39.19V16.3C91.73 16.3 94.61 4 63.35 4ZM48.65 13.06C51.5 13.06 53.82 15.38 53.82 18.23C53.82 21.08 51.5 23.4 48.65 23.4C45.8 23.4 43.48 21.08 43.48 18.23C43.48 15.38 45.8 13.06 48.65 13.06Z" fill="white" />
    <path d="M64.65 124C92.97 124 91.57 111.7 91.57 111.7L91.52 98.93H63.92V95.04H103.21C103.21 95.04 124 97.36 124 69.09C124 40.82 105.91 42.2 105.91 42.2L95.14 42.2V57.34C95.14 57.34 95.65 75.52 77.16 75.52H50.06C50.06 75.52 36.27 75.08 36.27 88.81V111.7C36.27 111.7 33.39 124 64.65 124ZM79.35 114.94C76.5 114.94 74.18 112.62 74.18 109.77C74.18 106.92 76.5 104.6 79.35 104.6C82.2 104.6 84.52 106.92 84.52 109.77C84.52 112.62 82.2 114.94 79.35 114.94Z" fill="white" opacity="0.9" />
  </svg>
)

const DonutProgress = ({ percentage = 0 }) => {
  const radius = 48
  const strokeWidth = 5.5
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="relative flex items-center justify-center h-36 w-36 flex-shrink-0">
      <svg className="h-full w-full transform rotate-[-135deg]" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="#ff7a00"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none">
        <span className="font-display font-bold text-lg text-[#1e2e4a] leading-none tracking-tight">
          {percentage}%
        </span>
        <span className="text-[10px] font-normal text-slate-400 mt-0.5">Completed</span>
      </div>
    </div>
  )
}

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
    modules: curriculumData.curriculum?.length || 5,
    price: 0,
    free: true,
    badge: 'RAG',
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

const getCompletedLessonIdsForCourse = (courseId, userId) => {
  if (!courseId || !userId) return [];

  const possibleKeys = [
    `skillbridge_progress_${userId}_${courseId}`
  ];
  if (userId === 'guest') {
    possibleKeys.push(`skillbridge_progress_${courseId}`);
    possibleKeys.push(`skillbridge_progress_guest_${courseId}`);
  }

  for (const key of possibleKeys) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) { }
  }

  return [];
};

const Home = ({ onOpenCourse, onPlayCourse }) => {
  const [ragCourses, setRagCourses] = useState([])
  const [selectedCourseId, setSelectedCourseId] = useState(null)
  const [userProgressMap, setUserProgressMap] = useState({})

  const user = useMemo(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James', role: 'STUDENT' }
    } catch {
      return { fullName: 'James', role: 'STUDENT' }
    }
  }, [])

  const userId = useMemo(() => {
    return user?.id || user?.finNumber || user?.email || 'guest';
  }, [user]);

  useEffect(() => {
    api.getCourses()
      .then(res => {
        if (Array.isArray(res) && res.length > 0) {
          const mapped = res.map(mapRagCourse);
          setRagCourses(mapped);

          // Restore last played course or pick active in-progress course
          try {
            const savedLastPlayed = localStorage.getItem(`skillbridge_last_played_${userId}`) || localStorage.getItem('skillbridge_last_played');
            if (savedLastPlayed && mapped.some(c => String(c.id) === String(savedLastPlayed))) {
              setSelectedCourseId(savedLastPlayed);
            } else {
              const inProgress = mapped.find(c => {
                const completed = getCompletedLessonIdsForCourse(c.id, userId);
                const total = c.lessons?.length || 5;
                return completed.length > 0 && completed.length < total;
              });
              if (inProgress) {
                setSelectedCourseId(inProgress.id);
              } else {
                const started = mapped.find(c => getCompletedLessonIdsForCourse(c.id, userId).length > 0);
                if (started) {
                  setSelectedCourseId(started.id);
                } else {
                  setSelectedCourseId(mapped[0].id);
                }
              }
            }
          } catch (e) {
            setSelectedCourseId(mapped[0].id);
          }
        }
      })
      .catch(err => {
        console.error("Error fetching courses catalog:", err);
      });
  }, [userId]);

  const allAvailableCourses = useMemo(() => {
    return ragCourses;
  }, [ragCourses]);

  // Load progress data from localStorage + Database API for all courses
  useEffect(() => {
    const initialMap = {};
    allAvailableCourses.forEach(c => {
      const localCompleted = getCompletedLessonIdsForCourse(c.id, userId);
      if (localCompleted.length > 0) {
        initialMap[c.id] = localCompleted;
        if (c.id) {
          const lessonsCount = c.lessons?.length || 5;
          const calcPct = Math.round((localCompleted.length / lessonsCount) * 100);
          const isDone = localCompleted.length >= lessonsCount;
          api.saveCourseProgress(c.id, {
            completedLessonIds: localCompleted,
            progress: calcPct,
            completed: isDone
          }).catch(() => { });
        }
      }
    });
    setUserProgressMap(initialMap);

    // Sync DB progress
    allAvailableCourses.forEach(c => {
      if (c.id) {
        api.getCourseProgress(c.id)
          .then(res => {
            if (res.completedLessonIds && Array.isArray(res.completedLessonIds) && res.completedLessonIds.length > 0) {
              setUserProgressMap(prev => ({
                ...prev,
                [c.id]: res.completedLessonIds
              }));
            }
          })
          .catch(() => { });
      }
    });
  }, [allAvailableCourses, userId]);

  // Compute dynamic progress statistics
  const stats = useMemo(() => {
    let totalModules = 0;
    let completedModulesCount = 0;
    let completedCourses = 0;
    let inProgressCourses = 0;

    allAvailableCourses.forEach(c => {
      const lessonsCount = c.lessons?.length || 5;
      totalModules += lessonsCount;

      const completedForCourse = userProgressMap[c.id] || [];
      completedModulesCount += completedForCourse.length;

      if (completedForCourse.length >= lessonsCount) {
        completedCourses += 1;
      } else if (completedForCourse.length > 0) {
        inProgressCourses += 1;
      }
    });

    const overallProgress = totalModules > 0 ? Math.round((completedModulesCount / totalModules) * 100) : 0;

    return {
      totalModules,
      completedModulesCount,
      completedCourses,
      inProgressCourses,
      overallProgress
    };
  }, [allAvailableCourses, userProgressMap]);

  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }, []);

  const activeCourseObj = useMemo(() => {
    if (selectedCourseId) {
      const found = allAvailableCourses.find(c => String(c.id) === String(selectedCourseId));
      if (found) return found;
    }

    // Try finding an in-progress course first
    const inProgress = allAvailableCourses.find(c => {
      const completed = userProgressMap[c.id] || [];
      const total = c.lessons?.length || 5;
      return completed.length > 0 && completed.length < total;
    });
    if (inProgress) return inProgress;

    // Or any started course
    const started = allAvailableCourses.find(c => (userProgressMap[c.id] || []).length > 0);
    if (started) return started;

    return allAvailableCourses[0] || null;
  }, [selectedCourseId, allAvailableCourses, userProgressMap])

  const activeCourseCompletedLessons = userProgressMap[activeCourseObj?.id] || [];
  const activeCourseTotalLessons = activeCourseObj?.lessons?.length || 5;
  const activeCourseProgressPct = activeCourseTotalLessons > 0
    ? Math.round((activeCourseCompletedLessons.length / activeCourseTotalLessons) * 100)
    : 0;

  const displayCourses = useMemo(() => {
    return ragCourses;
  }, [ragCourses]);

  return (
    <div className="w-full h-full flex flex-col justify-between overflow-hidden bg-[#f8fafc] text-[#0f172a] px-6 py-4 sm:px-8 sm:py-5 lg:px-10 lg:py-5 select-none">
      <div className="max-w-7xl mx-auto w-full h-full flex flex-col justify-between overflow-hidden gap-3 sm:gap-4">

        {/* Top Greeting Header */}
        <div className="flex-shrink-0">
          <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#0f172a]">
            Welcome Back, {user.fullName || 'James'}
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            {formattedDate}
          </p>
        </div>

        {/* 2-Column Main Dashboard Grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 min-h-0 items-stretch overflow-hidden">

          {/* LEFT COLUMN: Continue Learning Banner + Your Learning Progress */}
          <div className="lg:col-span-6 flex flex-col justify-between gap-3 sm:gap-4 min-h-0 overflow-hidden">

            {/* TOP BLUE CARD: Continue Learning */}
            <div
              style={{ background: 'linear-gradient(135deg, #0A55A1 0%, #0C59A8 50%, #0E5EB1 100%)' }}
              className="rounded-2xl p-5 sm:p-6 text-white flex justify-between items-center relative overflow-hidden flex-[1.3] min-h-[210px]"
            >
              {/* Background Ambient Glow */}
              <div className="pointer-events-none absolute -right-12 -bottom-12 h-48 w-48 rounded-full bg-white/10 blur-xl" />

              <div className="flex flex-col justify-between h-full z-20 flex-1 pr-28 sm:pr-36">
                <span className="text-[11px] font-semibold text-blue-100">Continue Learning</span>
                <div className="my-1">
                  <h3 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white leading-snug line-clamp-2">
                    {activeCourseObj?.title || 'Full-Stack Web Development'}
                  </h3>
                  <p className="text-[11px] text-blue-100/90 font-medium mt-0.5">
                    Modules {activeCourseCompletedLessons.length} of {activeCourseTotalLessons}
                  </p>
                </div>

                <div className="w-full max-w-xs my-1">
                  <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden mb-1">
                    <div
                      className="bg-[#ff7a00] h-full rounded-full transition-all duration-500"
                      style={{ width: `${activeCourseProgressPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-blue-100">
                    {activeCourseProgressPct}% Complete
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onPlayCourse?.(activeCourseObj)}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-extrabold text-slate-900 shadow-md hover:bg-slate-100 transition cursor-pointer border-0 w-fit"
                >
                  <span className="text-[10px] text-black">▶</span> {activeCourseCompletedLessons.length > 0 ? 'Resume Course' : 'Start Course'}
                </button>
              </div>

              {/* 3D Engineer Avatar Illustration */}
              <div className="absolute -right-2 sm:-right-4 bottom-0 h-full flex items-end justify-end pointer-events-none z-10">
                <img
                  src="/avatar.png"
                  alt="Learning Avatar"
                  className="h-full w-auto object-contain object-bottom drop-shadow-2xl"
                />
              </div>
            </div>

            {/* BOTTOM WHITE CARD: Your learning progress */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/70  flex flex-col justify-between flex-shrink-0">
              <h3 className="font-display text-xs sm:text-sm font-semibold text-[#1e2e4a] tracking-tight mb-1.5">
                Your learning progress
              </h3>

              <div className="flex items-center gap-4 sm:gap-6 my-auto">
                {/* Left: Donut Progress Ring */}
                <DonutProgress percentage={stats.overallProgress} />

                {/* Right: Top Motivation Text + Bottom Horizontal 3 Stats Row with Vertical Dividers */}
                <div className="flex flex-col justify-start gap-3.5 sm:gap-4 flex-1 min-w-0 -mt-1.5 sm:-mt-2">
                  {/* Top Motivation Text */}
                  <div>
                    <h4 className="font-display text-lg sm:text-xl font-bold text-[#1e2e4a] tracking-tight leading-snug">
                      {stats.overallProgress > 0 ? "You're doing great!" : "Ready to learn!"}
                    </h4>
                    <p className="text-xs text-slate-400 font-normal mt-0.5 leading-snug">
                      {stats.overallProgress > 0 ? "Keep going and complete your courses" : "Start your lessons and track your progress"}
                    </p>
                  </div>

                  {/* Bottom: 3 Stats Badges (HORIZONTAL / INLINE ROW WITH VERTICAL DIVIDERS) */}
                  <div className="flex items-center gap-3 sm:gap-4 pt-2 sm:pt-2.5">
                    {/* Total Modules */}
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-xl bg-[#eff6ff] text-[#3b82f6] flex items-center justify-center flex-shrink-0">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold font-display text-[#0f172a] leading-none">{stats.totalModules}</p>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">Total Modules</p>
                      </div>
                    </div>

                    {/* Vertical Divider 1 */}
                    <div className="w-[1px] h-6 bg-slate-100 flex-shrink-0" />

                    {/* Completed */}
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-[#f0fdf4] text-[#16a34a] flex items-center justify-center flex-shrink-0">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold font-display text-[#0f172a] leading-none">{stats.completedCourses}</p>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">Completed</p>
                      </div>
                    </div>

                    {/* Vertical Divider 2 */}
                    <div className="w-[1px] h-6 bg-slate-100 flex-shrink-0" />

                    {/* In Progress */}
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-[#fff7ed] text-[#ea580c] flex items-center justify-center flex-shrink-0">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold font-display text-[#0f172a] leading-none">{stats.inProgressCourses}</p>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">In Progress</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Full Height My Courses Card */}
          <div className="lg:col-span-6 bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/70  flex flex-col justify-between flex-1 min-h-0 overflow-hidden">
            <h3 className="font-display text-base font-bold text-[#1e2e4a] tracking-tight mb-2 flex-shrink-0">
              My Courses
            </h3>

            <div className="flex-1 flex flex-col gap-1 divide-y divide-slate-100/80 overflow-y-auto pr-1">
              {displayCourses.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 my-auto">
                  <span className="text-3xl mb-2">📚</span>
                  <p className="text-xs font-semibold text-slate-600">No uploaded courses yet</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                    Upload a PDF document to generate your custom AI course!
                  </p>
                </div>
              ) : (
                displayCourses.map((c, idx) => {
                  const bgColors = ['bg-[#22c55e]', 'bg-[#2563eb]', 'bg-[#9333ea]', 'bg-[#ea580c]', 'bg-[#0891b2]', 'bg-[#4f46e5]'];
                  const completedCount = (userProgressMap[c.id] || []).length;
                  const totalCount = c.lessons?.length || c.modules || (c.curriculum ? c.curriculum.length : 5);
                  const durationText = c.duration || `${totalCount * 15} mins`;

                  return (
                    <div key={c.id} className="py-2.5 flex items-center justify-between group gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className={`h-10 w-10 rounded-xl ${bgColors[idx % bgColors.length]} text-white flex items-center justify-center flex-shrink-0 shadow-sm`}>
                          <PythonLogo className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-display text-xs sm:text-sm font-bold text-[#1e2e4a] truncate group-hover:text-[#ff7a00] transition">
                            {c.title}
                          </h4>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1 font-normal">
                            <span className="flex items-center gap-1 text-slate-400">
                              <svg className="h-3.5 w-3.5 text-[#f97316]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                              {totalCount} Modules
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onPlayCourse?.(c)}
                        className="cursor-pointer rounded-xl bg-[#ff7a00] hover:bg-[#ea6c00] w-[132px] h-9 text-xs font-bold text-white transition shadow-sm border-0 flex items-center justify-center gap-1.5 flex-shrink-0"
                      >
                        {completedCount > 0 ? 'Continue' : 'Start Course'} <span className="text-xs font-bold">→</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}

export default Home