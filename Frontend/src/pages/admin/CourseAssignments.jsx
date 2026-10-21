import { useEffect, useState, useMemo } from 'react'
import { toast } from 'react-toastify'
import { api } from '../../services/api'

const AssignmentSkeleton = () => (
  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
    {/* Left Panel Skeleton */}
    <div className="lg:col-span-5 rounded-2xl border border-line bg-panel p-4 shadow-sm flex flex-col h-[640px]">
      <div className="mb-3 animate-pulse">
        <div className="h-4.5 w-36 rounded-md bg-ink mb-1.5" />
        <div className="h-3 w-52 rounded bg-ink/70 mb-3" />
        <div className="h-9 w-full rounded-xl bg-ink/60" />
      </div>

      <div className="flex-1 overflow-hidden space-y-2 pr-1 pt-1">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-2xl border border-line/60 bg-ink/30 animate-pulse"
          >
            <div className="h-10 w-10 rounded-xl bg-ink shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="h-3.5 w-28 rounded bg-ink" />
                <div className="h-4 w-16 rounded-full bg-ink/80" />
              </div>
              <div className="h-2.5 w-40 rounded bg-ink/60" />
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Right Panel Skeleton */}
    <div className="lg:col-span-7 rounded-2xl border border-line bg-panel p-5 shadow-sm flex flex-col h-[640px]">
      {/* Active Header Skeleton */}
      <div className="flex items-center justify-between border-b border-line pb-4 mb-3 shrink-0 animate-pulse">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-12 w-12 rounded-2xl bg-ink shrink-0" />
          <div className="space-y-2">
            <div className="h-4 w-36 rounded bg-ink" />
            <div className="h-3 w-52 rounded bg-ink/70" />
          </div>
        </div>
        <div className="h-9 w-32 rounded-xl bg-ink shrink-0" />
      </div>

      {/* Subheader & Search Skeleton */}
      <div className="flex items-center justify-between mb-3 shrink-0 animate-pulse">
        <div className="h-3 w-40 rounded bg-ink/70" />
        <div className="h-3 w-28 rounded bg-ink/60" />
      </div>
      <div className="h-9 w-full rounded-xl bg-ink/60 mb-3 shrink-0 animate-pulse" />

      {/* Checklist Cards Skeleton */}
      <div className="flex-1 overflow-hidden space-y-2.5 pr-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-start gap-3 p-3.5 rounded-2xl border border-line bg-ink/30 animate-pulse"
          >
            <div className="h-4 w-4 rounded bg-ink mt-1 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="h-3.5 w-48 rounded bg-ink" />
                <div className="h-4 w-14 rounded-full bg-ink/80" />
              </div>
              <div className="h-3 w-5/6 rounded bg-ink/60" />
              <div className="flex items-center gap-3 pt-1">
                <div className="h-2.5 w-20 rounded bg-ink/60" />
                <div className="h-2.5 w-28 rounded bg-ink/50" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer Skeleton */}
      <div className="pt-3 border-t border-line flex items-center justify-between shrink-0 animate-pulse">
        <div className="h-3 w-40 rounded bg-ink/60" />
        <div className="h-9 w-32 rounded-xl bg-ink" />
      </div>
    </div>
  </div>
)

const CourseAssignments = () => {
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState([])
  const [courses, setCourses] = useState([])
  const [mode, setMode] = useState('by-user') // 'by-user' | 'by-course'

  // User-centric state
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [userAssignedCourseIds, setUserAssignedCourseIds] = useState([])
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [courseFilterQuery, setCourseFilterQuery] = useState('')
  const [savingUserAssignments, setSavingUserAssignments] = useState(false)

  // Course-centric state
  const [selectedCourseId, setSelectedCourseId] = useState(null)
  const [courseEnrolledUserIds, setCourseEnrolledUserIds] = useState([])
  const [courseSearchQuery, setCourseSearchQuery] = useState('')
  const [learnerFilterQuery, setLearnerFilterQuery] = useState('')
  const [savingCourseAssignments, setSavingCourseAssignments] = useState(false)
  const [loadingCourseUsers, setLoadingCourseUsers] = useState(false)

  // Toast feedback helper
  const showToast = (type, text) => {
    if (type === 'ok' || type === 'success') {
      toast.success(text)
    } else if (type === 'warn' || type === 'warning') {
      toast.warn(text)
    } else {
      toast.error(text)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [usersData, coursesData] = await Promise.all([
        api.getUsers(),
        api.getCourses(),
      ])
      setUsers(usersData || [])
      setCourses(coursesData || [])

      // Set default selected items
      if (usersData && usersData.length > 0 && !selectedUserId) {
        setSelectedUserId(usersData[0].id)
        setUserAssignedCourseIds(usersData[0].assignedCourseIds || [])
      }
      if (coursesData && coursesData.length > 0 && !selectedCourseId) {
        setSelectedCourseId(coursesData[0].id)
      }
    } catch (err) {
      console.error('Failed to load assignments data:', err)
      showToast('error', 'Failed to load learners and courses.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // When selected user changes, update userAssignedCourseIds
  const handleSelectUser = (user) => {
    setSelectedUserId(user.id)
    setUserAssignedCourseIds(user.assignedCourseIds || [])
  }

  // When selected course changes in by-course mode, load enrolled users
  useEffect(() => {
    if (mode === 'by-course' && selectedCourseId) {
      const loadCourseUsers = async () => {
        setLoadingCourseUsers(true)
        try {
          const res = await api.getCourseAssignments(selectedCourseId)
          const ids = (res.assignedUsers || []).map((u) => u.id)
          setCourseEnrolledUserIds(ids)
        } catch (err) {
          console.error(err)
          const fallback = users
            .filter((u) => (u.assignedCourseIds || []).includes(selectedCourseId))
            .map((u) => u.id)
          setCourseEnrolledUserIds(fallback)
        } finally {
          setLoadingCourseUsers(false)
        }
      }
      loadCourseUsers()
    }
  }, [mode, selectedCourseId])

  // Handlers for by-user mode
  const toggleUserCourse = (courseId) => {
    setUserAssignedCourseIds((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId]
    )
  }

  const selectAllCoursesForUser = () => {
    setUserAssignedCourseIds(courses.map((c) => c.id))
  }

  const clearAllCoursesForUser = () => {
    setUserAssignedCourseIds([])
  }

  const handleSaveUserAssignments = async () => {
    if (!selectedUserId) return
    setSavingUserAssignments(true)
    try {
      const res = await api.assignUserCourses(selectedUserId, userAssignedCourseIds)
      setUsers((prev) =>
        prev.map((u) =>
          u.id === selectedUserId
            ? {
                ...u,
                assignedCourseIds: res.assignedCourseIds,
                assignedCourses: res.assignedCourses,
              }
            : u
        )
      )
      showToast('ok', 'Course assignments saved successfully!')
    } catch (err) {
      showToast('error', err.message || 'Failed to save assignments.')
    } finally {
      setSavingUserAssignments(false)
    }
  }

  // Handlers for by-course mode
  const toggleCourseUser = (userId) => {
    setCourseEnrolledUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  const selectAllLearnersForCourse = () => {
    setCourseEnrolledUserIds(users.map((u) => u.id))
  }

  const clearAllLearnersForCourse = () => {
    setCourseEnrolledUserIds([])
  }

  const handleSaveCourseAssignments = async () => {
    if (!selectedCourseId) return
    setSavingCourseAssignments(true)
    try {
      await api.assignCourseUsers(selectedCourseId, courseEnrolledUserIds)
      // Sync local users state
      setUsers((prev) =>
        prev.map((u) => {
          const isEnrolled = courseEnrolledUserIds.includes(u.id)
          const currentIds = u.assignedCourseIds || []
          let nextIds
          if (isEnrolled && !currentIds.includes(selectedCourseId)) {
            nextIds = [...currentIds, selectedCourseId]
          } else if (!isEnrolled && currentIds.includes(selectedCourseId)) {
            nextIds = currentIds.filter((id) => id !== selectedCourseId)
          } else {
            nextIds = currentIds
          }
          return { ...u, assignedCourseIds: nextIds }
        })
      )
      showToast('ok', 'Course learner roster updated successfully!')
    } catch (err) {
      showToast('error', err.message || 'Failed to update course learners.')
    } finally {
      setSavingCourseAssignments(false)
    }
  }

  // Metrics
  const totalAssignments = useMemo(() => {
    return users.reduce((acc, u) => acc + (u.assignedCourseIds?.length || 0), 0)
  }, [users])

  const unassignedLearnersCount = useMemo(() => {
    return users.filter((u) => !u.assignedCourseIds || u.assignedCourseIds.length === 0).length
  }, [users])

  // Filtered lists
  const filteredUsers = useMemo(() => {
    const q = userSearchQuery.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.fullName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.finNumber?.toLowerCase().includes(q)
    )
  }, [users, userSearchQuery])

  const filteredCoursesForUser = useMemo(() => {
    const q = courseFilterQuery.trim().toLowerCase()
    if (!q) return courses
    return courses.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
    )
  }, [courses, courseFilterQuery])

  const filteredCourses = useMemo(() => {
    const q = courseSearchQuery.trim().toLowerCase()
    if (!q) return courses
    return courses.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
    )
  }, [courses, courseSearchQuery])

  const filteredLearnersForCourse = useMemo(() => {
    const q = learnerFilterQuery.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.fullName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.finNumber?.toLowerCase().includes(q)
    )
  }, [users, learnerFilterQuery])

  const activeUser = users.find((u) => u.id === selectedUserId)
  const activeCourse = courses.find((c) => c.id === selectedCourseId)

  return (
    <div className="animate-rise-in space-y-6">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            Course Assignments
          </h1>
          <p className="mt-1 text-sm text-muted">
            Manage course access permissions. Learners can only play courses assigned to their account.
          </p>
        </div>

        {/* Mode Toggle Switch */}
        <div className="inline-flex rounded-xl border border-line bg-panel p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setMode('by-user')}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
              mode === 'by-user'
                ? 'bg-navy text-white shadow-xs'
                : 'text-muted hover:text-fg'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>Assign by Learner</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('by-course')}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
              mode === 'by-course'
                ? 'bg-navy text-white shadow-xs'
                : 'text-muted hover:text-fg'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>Assign by Course</span>
          </button>
        </div>
      </div>

      {/* Overview Stat Badges */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {loading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-line bg-panel p-3 shadow-xs animate-pulse space-y-1.5">
              <div className="h-2 w-20 rounded bg-ink/80" />
              <div className="h-6 w-12 rounded bg-ink" />
            </div>
          ))
        ) : (
          <>
            <div className="rounded-xl border border-line bg-panel p-3 shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Total Learners</p>
              <p className="mt-0.5 font-display text-xl font-bold text-fg">{users.length}</p>
            </div>
            <div className="rounded-xl border border-line bg-panel p-3 shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Published Courses</p>
              <p className="mt-0.5 font-display text-xl font-bold text-sky">{courses.length}</p>
            </div>
            <div className="rounded-xl border border-line bg-panel p-3 shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Active Enrollments</p>
              <p className="mt-0.5 font-display text-xl font-bold text-emerald-600">{totalAssignments}</p>
            </div>
            <div className="rounded-xl border border-line bg-panel p-3 shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Unassigned Learners</p>
              <p className={`mt-0.5 font-display text-xl font-bold ${unassignedLearnersCount > 0 ? 'text-orange' : 'text-muted'}`}>
                {unassignedLearnersCount}
              </p>
            </div>
          </>
        )}
      </div>


      {loading ? (
        <AssignmentSkeleton />
      ) : mode === 'by-user' ? (
        /* ================= MODE 1: ASSIGN BY LEARNER ================= */
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
          {/* Left Panel: Learners Directory */}
          <div className="lg:col-span-5 rounded-xl border border-line bg-panel p-3.5 shadow-xs flex flex-col h-[580px]">
            <div className="mb-2.5">
              <h3 className="font-display text-sm font-bold text-fg">Learners Directory</h3>
              <p className="text-[11px] text-muted">Select a learner to configure course access</p>
              
              <div className="relative mt-2">
                <input
                  type="text"
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  placeholder="Search name, FIN, email..."
                  className="w-full rounded-lg border border-line bg-ink/50 py-1.5 pl-8 pr-2.5 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                />
                <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredUsers.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted">No learners found matching search.</div>
              ) : (
                filteredUsers.map((u) => {
                  const isSelected = u.id === selectedUserId
                  const count = u.assignedCourseIds?.length || 0
                  return (
                    <div
                      key={u.id}
                      onClick={() => handleSelectUser(u)}
                      className={`flex items-center gap-2.5 p-2 rounded-xl border transition cursor-pointer select-none ${
                        isSelected
                          ? 'border-sky bg-sky/10 shadow-xs ring-1 ring-sky/30'
                          : 'border-line/70 bg-ink/30 hover:border-line hover:bg-ink/60'
                      }`}
                    >
                      {u.faceIdData && u.faceIdData.startsWith('data:image/') ? (
                        <img src={u.faceIdData} alt="" className="h-8 w-8 rounded-lg object-cover shrink-0" />
                      ) : (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink font-bold text-muted text-xs">
                          {u.fullName.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className={`text-xs font-semibold truncate ${isSelected ? 'text-sky' : 'text-fg'}`}>
                            {u.fullName}
                          </p>
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${
                            count > 0 ? 'bg-sky/15 text-sky border border-sky/30' : 'bg-slate-500/10 text-muted border border-slate-500/20'
                          }`}>
                            {count} {count === 1 ? 'Course' : 'Courses'}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted truncate mt-0.5">
                          FIN: {u.finNumber} • {u.email}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right Panel: Course Checklist for Selected Learner */}
          <div className="lg:col-span-7 rounded-xl border border-line bg-panel p-3.5 sm:p-4 shadow-xs flex flex-col h-[580px]">
            {activeUser ? (
              <>
                {/* Active Learner Banner */}
                <div className="flex items-center justify-between border-b border-line pb-3 mb-2.5 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {activeUser.faceIdData && activeUser.faceIdData.startsWith('data:image/') ? (
                      <img src={activeUser.faceIdData} alt="" className="h-9 w-9 rounded-xl object-cover shrink-0" />
                    ) : (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink font-bold text-muted text-sm">
                        {activeUser.fullName.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-fg truncate">
                        {activeUser.fullName}
                      </h3>
                      <p className="text-[11px] text-muted truncate">
                        {activeUser.email} • FIN: {activeUser.finNumber} • {activeUser.country || 'Region'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={savingUserAssignments}
                    onClick={handleSaveUserAssignments}
                    className="cursor-pointer rounded-lg border-0 bg-orange px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:brightness-105 transition disabled:opacity-60 shrink-0"
                  >
                    {savingUserAssignments ? 'Saving...' : 'Save Assignments'}
                  </button>
                </div>

                {/* Subheader & Search */}
                <div className="flex items-center justify-between gap-3 mb-2 shrink-0 text-xs">
                  <span className="text-muted font-semibold text-[11px]">
                    {userAssignedCourseIds.length} of {courses.length} courses assigned
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={selectAllCoursesForUser}
                      className="text-sky hover:underline cursor-pointer border-0 bg-transparent font-semibold"
                    >
                      Select all
                    </button>
                    <span className="text-muted">•</span>
                    <button
                      type="button"
                      onClick={clearAllCoursesForUser}
                      className="text-muted hover:text-fg cursor-pointer border-0 bg-transparent font-medium"
                    >
                      Clear all
                    </button>
                  </div>
                </div>

                {/* Search Courses */}
                <div className="relative mb-2 shrink-0">
                  <input
                    type="text"
                    value={courseFilterQuery}
                    onChange={(e) => setCourseFilterQuery(e.target.value)}
                    placeholder="Filter courses..."
                    className="w-full rounded-lg border border-line bg-ink/50 py-1.5 pl-8 pr-2.5 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                  />
                  <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>

                {/* Courses Checklist Grid */}
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {courses.length === 0 ? (
                    <div className="py-12 text-center border border-dashed border-line rounded-xl p-4 text-xs text-muted">
                      No courses published in catalog yet. Create courses in Course Manager.
                    </div>
                  ) : filteredCoursesForUser.length === 0 ? (
                    <div className="py-10 text-center text-xs text-muted">No courses match filter.</div>
                  ) : (
                    filteredCoursesForUser.map((c) => {
                      const isChecked = userAssignedCourseIds.includes(c.id)
                      const curriculumData = typeof c.curriculum === 'string' ? JSON.parse(c.curriculum) : (c.curriculum || {})
                      const totalLessons = curriculumData.lessons?.length || (curriculumData.curriculum?.length || 1)

                      return (
                        <div
                          key={c.id}
                          onClick={() => toggleUserCourse(c.id)}
                          className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition cursor-pointer select-none ${
                            isChecked
                              ? 'border-sky bg-sky/5 shadow-xs'
                              : 'border-line bg-ink/40 hover:border-line/90'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="mt-0.5 h-3.5 w-3.5 rounded text-sky focus:ring-sky/40 border-line"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className={`text-xs font-bold leading-snug truncate ${isChecked ? 'text-sky' : 'text-fg'}`}>
                                {c.title}
                              </h4>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-ink border border-line text-muted uppercase font-bold shrink-0">
                                {c.fileName ? (c.fileName.includes('.') ? c.fileName.split('.').pop().toUpperCase() : 'DOC') : 'COURSE'}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted line-clamp-1 mt-0.5">
                              {c.description || 'Interactive course curriculum'}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-muted mt-1 font-medium">
                              <span className="inline-flex items-center gap-1">
                                <svg className="w-3 h-3 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                                <span>{totalLessons} Lessons</span>
                              </span>
                              <span>•</span>
                              <span className={isChecked ? 'text-emerald-600 font-semibold inline-flex items-center gap-1' : ''}>
                                {isChecked && (
                                  <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                                <span>{isChecked ? 'Assigned' : 'Not assigned'}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Footer Save Row */}
                <div className="pt-2.5 border-t border-line flex items-center justify-between shrink-0">
                  <span className="text-[11px] text-muted">
                    {userAssignedCourseIds.length === 0
                      ? 'No courses assigned to this learner'
                      : `Learner can access ${userAssignedCourseIds.length} course(s)`}
                  </span>
                  <button
                    type="button"
                    disabled={savingUserAssignments}
                    onClick={handleSaveUserAssignments}
                    className="cursor-pointer rounded-lg border-0 bg-orange px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:brightness-105 transition disabled:opacity-60"
                  >
                    {savingUserAssignments ? 'Saving...' : 'Save Assignments'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-muted mb-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-fg">Select a learner</p>
                <p className="text-xs text-muted mt-0.5">Choose a user from the directory to manage their course assignments.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================= MODE 2: ASSIGN BY COURSE ================= */
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
          {/* Left Panel: Courses Catalog */}
          <div className="lg:col-span-5 rounded-xl border border-line bg-panel p-3.5 shadow-xs flex flex-col h-[580px]">
            <div className="mb-2.5">
              <h3 className="font-display text-sm font-bold text-fg">Courses Catalog</h3>
              <p className="text-[11px] text-muted">Select a course to enroll learners in batch</p>
              
              <div className="relative mt-2">
                <input
                  type="text"
                  value={courseSearchQuery}
                  onChange={(e) => setCourseSearchQuery(e.target.value)}
                  placeholder="Search course title..."
                  className="w-full rounded-lg border border-line bg-ink/50 py-1.5 pl-8 pr-2.5 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                />
                <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredCourses.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted">No courses found.</div>
              ) : (
                filteredCourses.map((c) => {
                  const isSelected = c.id === selectedCourseId
                  const enrolledCount = users.filter((u) => (u.assignedCourseIds || []).includes(c.id)).length

                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCourseId(c.id)}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition cursor-pointer select-none ${
                        isSelected
                          ? 'border-sky bg-sky/10 shadow-xs ring-1 ring-sky/30'
                          : 'border-line/70 bg-ink/30 hover:border-line hover:bg-ink/60'
                      }`}
                    >
                      <div className="h-8 w-8 rounded-lg bg-orange/10 border border-orange/20 text-orange grid place-items-center shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className={`text-xs font-bold truncate ${isSelected ? 'text-sky' : 'text-fg'}`}>
                            {c.title}
                          </h4>
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange/15 text-orange border border-orange/30 shrink-0 inline-flex items-center gap-1">
                            <svg className="w-2.5 h-2.5 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span>{enrolledCount}</span>
                          </span>
                        </div>
                        <p className="text-[10px] text-muted line-clamp-1 mt-0.5">
                          {c.description || 'Course curriculum'}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right Panel: Learners Roster for Selected Course */}
          <div className="lg:col-span-7 rounded-xl border border-line bg-panel p-3.5 sm:p-4 shadow-xs flex flex-col h-[580px]">
            {activeCourse ? (
              <>
                {/* Active Course Banner */}
                <div className="flex items-center justify-between border-b border-line pb-3 mb-2.5 shrink-0">
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-orange/90 text-white font-bold uppercase">
                        {activeCourse.fileName ? (activeCourse.fileName.includes('.') ? activeCourse.fileName.split('.').pop().toUpperCase() : 'DOC') : 'COURSE'}
                      </span>
                      <h3 className="font-display text-sm font-bold text-fg truncate">
                        {activeCourse.title}
                      </h3>
                    </div>
                    <p className="text-[11px] text-muted truncate mt-0.5">
                      {activeCourse.description || 'Manage learners enrolled in this course'}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={savingCourseAssignments}
                    onClick={handleSaveCourseAssignments}
                    className="cursor-pointer rounded-lg border-0 bg-orange px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:brightness-105 transition disabled:opacity-60 shrink-0"
                  >
                    {savingCourseAssignments ? 'Saving...' : 'Save Enrolled Learners'}
                  </button>
                </div>

                {/* Subheader & Select All */}
                <div className="flex items-center justify-between gap-3 mb-2 shrink-0 text-xs">
                  <span className="text-muted font-semibold text-[11px]">
                    {courseEnrolledUserIds.length} of {users.length} learners enrolled
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={selectAllLearnersForCourse}
                      className="text-sky hover:underline cursor-pointer border-0 bg-transparent font-semibold"
                    >
                      Select all
                    </button>
                    <span className="text-muted">•</span>
                    <button
                      type="button"
                      onClick={clearAllLearnersForCourse}
                      className="text-muted hover:text-fg cursor-pointer border-0 bg-transparent font-medium"
                    >
                      Clear all
                    </button>
                  </div>
                </div>

                {/* Search Learners */}
                <div className="relative mb-2 shrink-0">
                  <input
                    type="text"
                    value={learnerFilterQuery}
                    onChange={(e) => setLearnerFilterQuery(e.target.value)}
                    placeholder="Filter learners by name, FIN..."
                    className="w-full rounded-lg border border-line bg-ink/50 py-1.5 pl-8 pr-2.5 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                  />
                  <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>

                {/* Learners Checklist */}
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {loadingCourseUsers ? (
                    <div className="space-y-1.5 animate-pulse pr-1">
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="flex items-center gap-2.5 p-2 rounded-xl border border-line/70 bg-ink/30">
                          <div className="h-3.5 w-3.5 rounded bg-ink shrink-0" />
                          <div className="h-8 w-8 rounded-lg bg-ink shrink-0" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="h-3 w-28 rounded bg-ink" />
                              <div className="h-2.5 w-16 rounded bg-ink/70" />
                            </div>
                            <div className="h-2.5 w-36 rounded bg-ink/60" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : users.length === 0 ? (
                    <div className="py-12 text-center border border-dashed border-line rounded-xl p-4 text-xs text-muted">
                      No learners registered in the system yet.
                    </div>
                  ) : filteredLearnersForCourse.length === 0 ? (
                    <div className="py-10 text-center text-xs text-muted">No learners match filter.</div>
                  ) : (
                    filteredLearnersForCourse.map((u) => {
                      const isChecked = courseEnrolledUserIds.includes(u.id)
                      return (
                        <div
                          key={u.id}
                          onClick={() => toggleCourseUser(u.id)}
                          className={`flex items-center gap-2.5 p-2 rounded-xl border transition cursor-pointer select-none ${
                            isChecked
                              ? 'border-sky bg-sky/5 shadow-xs'
                              : 'border-line bg-ink/40 hover:border-line/90'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 rounded text-sky focus:ring-sky/40 border-line"
                          />
                          {u.faceIdData && u.faceIdData.startsWith('data:image/') ? (
                            <img src={u.faceIdData} alt="" className="h-8 w-8 rounded-lg object-cover shrink-0" />
                          ) : (
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink font-semibold text-muted text-xs">
                              {u.fullName.slice(0, 1)}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs font-semibold truncate ${isChecked ? 'text-sky' : 'text-fg'}`}>
                                {u.fullName}
                              </p>
                              <span className="text-[10px] text-muted shrink-0">
                                {u.finNumber}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted truncate">
                              {u.email} • {u.country || 'Region'}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Footer Save Row */}
                <div className="pt-2.5 border-t border-line flex items-center justify-between shrink-0">
                  <span className="text-[11px] text-muted">
                    {courseEnrolledUserIds.length === 0
                      ? 'No learners enrolled in this course'
                      : `${courseEnrolledUserIds.length} learner(s) can play this course`}
                  </span>
                  <button
                    type="button"
                    disabled={savingCourseAssignments}
                    onClick={handleSaveCourseAssignments}
                    className="cursor-pointer rounded-lg border-0 bg-orange px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:brightness-105 transition disabled:opacity-60"
                  >
                    {savingCourseAssignments ? 'Saving...' : 'Save Enrolled Learners'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-muted mb-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-fg">Select a course</p>
                <p className="text-xs text-muted mt-0.5">Choose a course from the catalog to enroll learners.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default CourseAssignments
