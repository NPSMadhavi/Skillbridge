import { useMemo, useState, useEffect } from 'react'
import { courses } from '../data/courses'
import { api } from '../services/api'

const CourseBookIcon = ({ className = "h-5 w-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
    <path d="M4.5 16.5h15" />
  </svg>
)

const DonutProgress = ({ percentage = 0 }) => {
  const cleanPct = Math.min(100, Math.max(0, Math.round(percentage) || 0));
  const radius = 48
  const strokeWidth = 5.5
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (cleanPct / 100) * circumference

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
          {cleanPct}%
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
          return Array.from(new Set(parsed.filter(id => id !== null && id !== undefined).map(String)));
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
      }
    });
    setUserProgressMap(initialMap);

    // Sync DB progress
    allAvailableCourses.forEach(c => {
      if (c.id) {
        api.getCourseProgress(c.id)
          .then(res => {
            if (res.completedLessonIds && Array.isArray(res.completedLessonIds)) {
              const uniqueDbLessons = Array.from(new Set(res.completedLessonIds.filter(id => id !== null && id !== undefined).map(String)));
              setUserProgressMap(prev => {
                const existing = prev[c.id] || [];
                const merged = Array.from(new Set([...existing.map(String), ...uniqueDbLessons]));
                return {
                  ...prev,
                  [c.id]: merged
                };
              });
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
      const courseLessons = (Array.isArray(c.lessons) && c.lessons.length > 0)
        ? c.lessons
        : (Array.isArray(c.curriculum) && c.curriculum.length > 0 ? c.curriculum : []);
      const lessonsCount = courseLessons.length > 0 ? courseLessons.length : (c.modules || 5);
      totalModules += lessonsCount;

      const rawCompleted = userProgressMap[c.id] || [];
      const uniqueCompletedIds = new Set(
        (Array.isArray(rawCompleted) ? rawCompleted : [])
          .filter(id => id !== null && id !== undefined && String(id).trim() !== '')
          .map(String)
      );

      let courseDoneCount = 0;
      if (courseLessons.length > 0) {
        courseDoneCount = courseLessons.filter(l =>
          uniqueCompletedIds.has(String(l.id)) ||
          (l.title && uniqueCompletedIds.has(String(l.title)))
        ).length;
        if (courseDoneCount === 0 && uniqueCompletedIds.size > 0) {
          courseDoneCount = Math.min(uniqueCompletedIds.size, lessonsCount);
        }
      } else {
        courseDoneCount = Math.min(uniqueCompletedIds.size, lessonsCount);
      }

      // Safeguard: courseDoneCount cannot exceed total lessons for this course
      courseDoneCount = Math.min(courseDoneCount, lessonsCount);
      completedModulesCount += courseDoneCount;

      if (courseDoneCount >= lessonsCount && lessonsCount > 0) {
        completedCourses += 1;
      } else if (courseDoneCount > 0) {
        inProgressCourses += 1;
      }
    });

    const overallProgress = totalModules > 0
      ? Math.min(100, Math.max(0, Math.round((completedModulesCount / totalModules) * 100)))
      : 0;

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

  const activeCourseRaw = userProgressMap[activeCourseObj?.id] || [];
  const activeCourseLessons = activeCourseObj?.lessons || [];
  const activeCourseTotalLessons = activeCourseLessons.length > 0
    ? activeCourseLessons.length
    : (activeCourseObj?.modules || 5);

  const activeCourseCompletedCount = useMemo(() => {
    const uniqueIds = new Set(activeCourseRaw.filter(id => id !== null && id !== undefined).map(String));
    if (activeCourseLessons.length > 0) {
      const matched = activeCourseLessons.filter(l => uniqueIds.has(String(l.id)) || (l.title && uniqueIds.has(String(l.title)))).length;
      return matched > 0 ? matched : Math.min(uniqueIds.size, activeCourseTotalLessons);
    }
    return Math.min(uniqueIds.size, activeCourseTotalLessons);
  }, [activeCourseRaw, activeCourseLessons, activeCourseTotalLessons]);

  const activeCourseProgressPct = activeCourseTotalLessons > 0
    ? Math.min(100, Math.round((activeCourseCompletedCount / activeCourseTotalLessons) * 100))
    : 0;

  const displayCourses = useMemo(() => {
    return ragCourses;
  }, [ragCourses]);

  return (
    <div className="w-full h-full flex flex-col justify-between overflow-y-auto lg:overflow-hidden bg-[#f8fafc] text-[#0f172a] p-4 sm:p-5 lg:p-6 select-none">
      <div className="max-w-7xl mx-auto w-full h-full flex flex-col justify-between gap-3 sm:gap-4 overflow-visible lg:overflow-hidden">

        {/* Top Greeting Header */}
        <div className="flex-shrink-0">
          <h1 className="font-display text-base sm:text-lg lg:text-xl font-bold tracking-tight text-[#0f172a]">
            Welcome Back, {user.fullName || 'James'}
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-400 font-medium mt-0.5">
            {formattedDate}
          </p>
        </div>

        {/* 2-Column Main Dashboard Grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-4 lg:gap-5 min-h-0 items-stretch overflow-visible lg:overflow-hidden">

          {/* LEFT COLUMN: Continue Learning Banner + Your Learning Progress */}
          <div className="lg:col-span-6 flex flex-col justify-between gap-3 sm:gap-4 min-h-0 overflow-visible lg:overflow-hidden">

            {/* TOP BLUE CARD: Continue Learning */}
            <div
              style={{ background: 'linear-gradient(135deg, #0A55A1 0%, #0C59A8 50%, #0E5EB1 100%)' }}
              className="rounded-2xl p-4 sm:p-5 lg:p-6 text-white flex justify-between items-center relative overflow-hidden flex-[1.2] lg:flex-[1.3] min-h-[190px] sm:min-h-[210px] shadow-sm"
            >
              {/* Background Ambient Glow */}
              <div className="pointer-events-none absolute -right-12 -bottom-12 h-48 w-48 rounded-full bg-white/10 blur-xl" />

              <div className="flex flex-col justify-between h-full z-20 flex-1 pr-20 sm:pr-32 lg:pr-36">
                <span className="text-[10px] sm:text-[11px] font-semibold text-blue-100">
                  {activeCourseProgressPct === 100 ? 'Course Completed' : 'Continue Learning'}
                </span>
                <div className="my-1">
                  <h3 className="font-display text-base sm:text-lg lg:text-xl font-bold tracking-tight text-white leading-snug line-clamp-2">
                    {activeCourseObj ? activeCourseObj.title : 'No Courses Assigned'}
                  </h3>
                  <p className="text-[10px] sm:text-[11px] text-blue-100/90 font-medium mt-0.5">
                    {activeCourseObj
                      ? `Modules ${activeCourseCompletedCount} of ${activeCourseTotalLessons}`
                      : 'Please contact your administrator to assign courses'}
                  </p>
                </div>

                <div className="w-full max-w-xs my-1">
                  <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden mb-1">
                    <div
                      className="bg-[#ff7a00] h-full rounded-full transition-all duration-500"
                      style={{ width: `${activeCourseProgressPct}%` }}
                    />
                  </div>
                  <span className="text-[9px] sm:text-[10px] font-semibold text-blue-100">
                    {activeCourseProgressPct}% Complete
                  </span>
                </div>

                {activeCourseObj ? (
                  <button
                    type="button"
                    onClick={() => onPlayCourse?.(activeCourseObj)}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-xs font-extrabold text-slate-900 shadow-md hover:bg-slate-100 transition cursor-pointer border-0 w-fit"
                  >
                    <span className="text-[9px] sm:text-[10px] text-black">▶</span> {activeCourseProgressPct === 100 ? 'Review Course' : activeCourseCompletedCount > 0 ? 'Resume Course' : 'Start Course'}
                  </button>
                ) : (
                  <span className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-white/20 px-3 py-1 text-[11px] font-semibold text-blue-100 w-fit">
                    Awaiting Course Assignment
                  </span>
                )}
              </div>

              {/* 3D Engineer Avatar Illustration */}
              <div className="absolute -right-2 sm:-right-4 bottom-0 h-full flex items-end justify-end pointer-events-none z-10">
                <img
                  src="/avatar.png"
                  alt="Learning Avatar"
                  className="h-[140px] sm:h-full w-auto object-contain object-bottom drop-shadow-xl opacity-80 sm:opacity-100"
                />
              </div>
            </div>

            {/* BOTTOM WHITE CARD: Your learning progress */}
            <div className="bg-white rounded-2xl p-3.5 sm:p-4 lg:p-5 border border-slate-200/70 flex flex-col justify-between flex-shrink-0 shadow-2xs">
              <h3 className="font-display text-xs sm:text-sm font-semibold text-[#1e2e4a] tracking-tight mb-1.5">
                Your learning progress
              </h3>

              <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5 lg:gap-6 my-auto">
                {/* Left: Donut Progress Ring */}
                <div className="shrink-0 scale-90 sm:scale-95 lg:scale-100 origin-center">
                  <DonutProgress percentage={stats.overallProgress} />
                </div>

                {/* Right: Top Motivation Text + Bottom Horizontal 3 Stats Row */}
                <div className="flex flex-col justify-start gap-2.5 sm:gap-3.5 lg:gap-4 flex-1 min-w-0 text-center sm:text-left sm:-mt-1">
                  {/* Top Motivation Text */}
                  <div>
                    <h4 className="font-display text-base sm:text-lg lg:text-xl font-bold text-[#1e2e4a] tracking-tight leading-snug">
                      {stats.overallProgress > 0 ? "You're doing great!" : displayCourses.length > 0 ? "Ready to learn!" : "Welcome to SkillBridge"}
                    </h4>
                    <p className="text-[11px] sm:text-xs text-slate-400 font-normal mt-0.5 leading-snug">
                      {stats.overallProgress > 0
                        ? "Keep going and complete your courses"
                        : displayCourses.length > 0
                        ? "Start your lessons and track your progress"
                        : "Your assigned courses will appear here"}
                    </p>
                  </div>

                  {/* Bottom: 3 Stats Badges */}
                  <div className="grid grid-cols-3 sm:flex items-center gap-1.5 sm:gap-3 lg:gap-4 pt-1 sm:pt-2 w-full justify-center sm:justify-start">
                    {/* Total Modules */}
                    <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 text-center sm:text-left">
                      <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-xl bg-[#eff6ff] text-[#3b82f6] flex items-center justify-center flex-shrink-0">
                        <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold font-display text-[#0f172a] leading-none">{stats.totalModules}</p>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium mt-0.5 whitespace-nowrap">Total Modules</p>
                      </div>
                    </div>

                    {/* Vertical Divider 1 */}
                    <div className="hidden sm:block w-[1px] h-6 bg-slate-100 flex-shrink-0" />

                    {/* Completed */}
                    <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 text-center sm:text-left">
                      <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-[#f0fdf4] text-[#16a34a] flex items-center justify-center flex-shrink-0">
                        <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold font-display text-[#0f172a] leading-none">{stats.completedCourses}</p>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium mt-0.5 whitespace-nowrap">Completed</p>
                      </div>
                    </div>

                    {/* Vertical Divider 2 */}
                    <div className="hidden sm:block w-[1px] h-6 bg-slate-100 flex-shrink-0" />

                    {/* In Progress */}
                    <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 text-center sm:text-left">
                      <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-[#fff7ed] text-[#ea580c] flex items-center justify-center flex-shrink-0">
                        <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold font-display text-[#0f172a] leading-none">{stats.inProgressCourses}</p>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium mt-0.5 whitespace-nowrap">In Progress</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Full Height My Courses Card */}
          <div className="lg:col-span-6 bg-white rounded-2xl p-3.5 sm:p-4 lg:p-5 border border-slate-200/70 flex flex-col justify-between flex-1 min-h-[280px] lg:min-h-0 overflow-hidden shadow-2xs">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <h3 className="font-display text-sm sm:text-base font-bold text-[#1e2e4a] tracking-tight">
                My Assigned Courses
              </h3>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium">
                {displayCourses.length} Course{displayCourses.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex-1 flex flex-col gap-1 divide-y divide-slate-100/80 overflow-y-auto pr-1">
              {displayCourses.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 my-auto">
                  <span className="text-3xl mb-2">📚</span>
                  <p className="text-xs font-semibold text-slate-600">No assigned courses yet</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                    Your administrator has not assigned any courses to your account. Once assigned, your courses will appear here ready to learn!
                  </p>
                </div>
              ) : (
                displayCourses.map((c, idx) => {
                  const bgColors = ['bg-[#2563eb]', 'bg-[#8b5cf6]', 'bg-[#059669]', 'bg-[#ea580c]', 'bg-[#0891b2]', 'bg-[#4f46e5]', 'bg-[#db2777]'];
                  const courseLessons = (Array.isArray(c.lessons) && c.lessons.length > 0)
                    ? c.lessons
                    : (Array.isArray(c.curriculum) && c.curriculum.length > 0 ? c.curriculum : []);
                  const totalCount = courseLessons.length > 0 ? courseLessons.length : (c.modules || 5);

                  const rawCompleted = userProgressMap[c.id] || [];
                  const uniqueCompletedIds = new Set(
                    (Array.isArray(rawCompleted) ? rawCompleted : [])
                      .filter(id => id !== null && id !== undefined && String(id).trim() !== '')
                      .map(String)
                  );

                  let completedCount = 0;
                  if (courseLessons.length > 0) {
                    completedCount = courseLessons.filter(l =>
                      uniqueCompletedIds.has(String(l.id)) ||
                      (l.title && uniqueCompletedIds.has(String(l.title)))
                    ).length;
                    if (completedCount === 0 && uniqueCompletedIds.size > 0) {
                      completedCount = Math.min(uniqueCompletedIds.size, totalCount);
                    }
                  } else {
                    completedCount = Math.min(uniqueCompletedIds.size, totalCount);
                  }
                  completedCount = Math.min(completedCount, totalCount);

                  const isCompleted = totalCount > 0 && completedCount >= totalCount;
                  const isStarted = completedCount > 0;

                  return (
                    <div key={c.id} className="py-2 sm:py-2.5 flex items-center justify-between group gap-2.5 sm:gap-3">
                      <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
                        <div className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl ${bgColors[idx % bgColors.length]} text-white flex items-center justify-center flex-shrink-0 shadow-sm`}>
                          <CourseBookIcon className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-display text-xs sm:text-sm font-bold text-[#1e2e4a] truncate group-hover:text-[#ff7a00] transition">
                            {c.title}
                          </h4>
                          <div className="flex items-center gap-3 text-[10px] sm:text-[11px] text-slate-400 mt-0.5 sm:mt-1 font-normal">
                            <span className="flex items-center gap-1 text-slate-400">
                              <svg className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-[#f97316]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                              {totalCount} Modules
                            </span>
                          </div>
                        </div>
                      </div>

                      {isCompleted ? (
                        <button
                          type="button"
                          onClick={() => onPlayCourse?.(c)}
                          className="cursor-pointer rounded-xl bg-[#16a34a] hover:bg-[#15803d] min-w-[76px] sm:w-[124px] lg:w-[132px] h-8 sm:h-9 text-[11px] sm:text-xs font-bold text-white transition shadow-sm border-0 flex items-center justify-center gap-1 sm:gap-1.5 flex-shrink-0 px-2.5 sm:px-3"
                        >
                          <svg className="h-3 w-3 sm:h-3.5 sm:w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="hidden sm:inline">Completed</span>
                          <span className="sm:hidden">Done</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onPlayCourse?.(c)}
                          className="cursor-pointer rounded-xl bg-[#ff7a00] hover:bg-[#ea6c00] min-w-[76px] sm:w-[124px] lg:w-[132px] h-8 sm:h-9 text-[11px] sm:text-xs font-bold text-white transition shadow-sm border-0 flex items-center justify-center gap-1 sm:gap-1.5 flex-shrink-0 px-2.5 sm:px-3"
                        >
                          <span>{isStarted ? 'Continue' : 'Start'}</span>
                          <span className="text-[10px] sm:text-xs font-bold">→</span>
                        </button>
                      )}
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