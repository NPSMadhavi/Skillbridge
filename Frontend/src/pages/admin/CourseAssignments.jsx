import { useEffect, useState, useMemo } from 'react'
import { api } from '../../services/api'

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

  // Toast feedback
  const [toast, setToast] = useState(null)

  const showToast = (type, text) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4000)
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
        <div className="inline-flex rounded-2xl border border-line bg-panel p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setMode('by-user')}
            className={`cursor-pointer rounded-xl px-4 py-2 text-xs font-bold transition ${
              mode === 'by-user'
                ? 'bg-navy text-white shadow-sm'
                : 'text-muted hover:text-fg'
            }`}
          >
            👤 Assign by Learner
          </button>
          <button
            type="button"
            onClick={() => setMode('by-course')}
            className={`cursor-pointer rounded-xl px-4 py-2 text-xs font-bold transition ${
              mode === 'by-course'
                ? 'bg-navy text-white shadow-sm'
                : 'text-muted hover:text-fg'
            }`}
          >
            📚 Assign by Course
          </button>
        </div>
      </div>

      {/* Overview Stat Badges */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Total Learners</p>
          <p className="mt-1 font-display text-2xl font-bold text-fg">{users.length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Published Courses</p>
          <p className="mt-1 font-display text-2xl font-bold text-sky">{courses.length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Active Enrollments</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-500">{totalAssignments}</p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Unassigned Learners</p>
          <p className={`mt-1 font-display text-2xl font-bold ${unassignedLearnersCount > 0 ? 'text-orange' : 'text-muted'}`}>
            {unassignedLearnersCount}
          </p>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`rounded-2xl p-4 text-center text-sm font-semibold transition ${
            toast.type === 'ok'
              ? 'border border-ok/30 bg-ok/10 text-ok'
              : 'border border-danger/30 bg-danger/10 text-danger'
          }`}
        >
          {toast.text}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-sky border-t-transparent mb-3" />
          <p className="text-sm font-semibold text-fg">Loading assignments data...</p>
        </div>
      ) : mode === 'by-user' ? (
        /* ================= MODE 1: ASSIGN BY LEARNER ================= */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left Panel: Learners Directory */}
          <div className="lg:col-span-5 rounded-2xl border border-line bg-panel p-4 shadow-sm flex flex-col h-[640px]">
            <div className="mb-3">
              <h3 className="font-display text-base font-bold text-fg">Learners Directory</h3>
              <p className="text-xs text-muted">Select a learner to configure course access</p>
              
              <div className="relative mt-2.5">
                <input
                  type="text"
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  placeholder="Search name, FIN, email..."
                  className="w-full rounded-xl border border-line bg-ink/50 py-2 pl-9 pr-3 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                />
                <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
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
                      className={`flex items-center gap-3 p-3 rounded-2xl border transition cursor-pointer select-none ${
                        isSelected
                          ? 'border-sky bg-sky/10 shadow-sm ring-1 ring-sky/30'
                          : 'border-line/70 bg-ink/30 hover:border-line hover:bg-ink/60'
                      }`}
                    >
                      {u.faceIdData && u.faceIdData.startsWith('data:image/') ? (
                        <img src={u.faceIdData} alt="" className="h-10 w-10 rounded-xl object-cover shrink-0" />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink font-bold text-muted text-xs">
                          {u.fullName.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className={`text-xs font-bold truncate ${isSelected ? 'text-sky' : 'text-fg'}`}>
                            {u.fullName}
                          </p>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                            count > 0 ? 'bg-sky/15 text-sky border border-sky/30' : 'bg-slate-500/10 text-muted border border-slate-500/20'
                          }`}>
                            {count} {count === 1 ? 'Course' : 'Courses'}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted truncate mt-0.5">
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
          <div className="lg:col-span-7 rounded-2xl border border-line bg-panel p-5 shadow-sm flex flex-col h-[640px]">
            {activeUser ? (
              <>
                {/* Active Learner Banner */}
                <div className="flex items-center justify-between border-b border-line pb-4 mb-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    {activeUser.faceIdData && activeUser.faceIdData.startsWith('data:image/') ? (
                      <img src={activeUser.faceIdData} alt="" className="h-12 w-12 rounded-2xl object-cover shrink-0" />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ink font-bold text-muted text-base">
                        {activeUser.fullName.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-fg truncate">
                        {activeUser.fullName}
                      </h3>
                      <p className="text-xs text-muted truncate">
                        {activeUser.email} • FIN: {activeUser.finNumber} • {activeUser.country || 'Region'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={savingUserAssignments}
                    onClick={handleSaveUserAssignments}
                    className="cursor-pointer rounded-xl border-0 bg-orange px-5 py-2.5 text-xs font-bold text-white shadow-md hover:brightness-105 transition disabled:opacity-60 shrink-0"
                  >
                    {savingUserAssignments ? 'Saving...' : 'Save Assignments'}
                  </button>
                </div>

                {/* Subheader & Search */}
                <div className="flex items-center justify-between gap-3 mb-3 shrink-0 text-xs">
                  <span className="text-muted font-semibold">
                    {userAssignedCourseIds.length} of {courses.length} courses assigned
                  </span>
                  <div className="flex items-center gap-2">
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
                <div className="relative mb-3 shrink-0">
                  <input
                    type="text"
                    value={courseFilterQuery}
                    onChange={(e) => setCourseFilterQuery(e.target.value)}
                    placeholder="Filter courses..."
                    className="w-full rounded-xl border border-line bg-ink/50 py-2 pl-9 pr-3 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                  />
                  <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>

                {/* Courses Checklist Grid */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {courses.length === 0 ? (
                    <div className="py-16 text-center border border-dashed border-line rounded-2xl p-6 text-xs text-muted">
                      No courses published in catalog yet. Create courses in Course Manager.
                    </div>
                  ) : filteredCoursesForUser.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted">No courses match filter.</div>
                  ) : (
                    filteredCoursesForUser.map((c) => {
                      const isChecked = userAssignedCourseIds.includes(c.id)
                      const curriculumData = typeof c.curriculum === 'string' ? JSON.parse(c.curriculum) : (c.curriculum || {})
                      const totalLessons = curriculumData.lessons?.length || 5

                      return (
                        <div
                          key={c.id}
                          onClick={() => toggleUserCourse(c.id)}
                          className={`flex items-start gap-3 p-3.5 rounded-2xl border transition cursor-pointer select-none ${
                            isChecked
                              ? 'border-sky bg-sky/5 shadow-sm'
                              : 'border-line bg-ink/40 hover:border-line/90'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="mt-0.5 h-4 w-4 rounded text-sky focus:ring-sky/40 border-line"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className={`text-xs font-bold leading-snug truncate ${isChecked ? 'text-sky' : 'text-fg'}`}>
                                {c.title}
                              </h4>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-ink border border-line text-muted uppercase font-bold shrink-0">
                                {c.fileName === 'Manual Entry' ? 'Manual' : 'RAG PDF'}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted line-clamp-1 mt-0.5">
                              {c.description || 'Interactive course curriculum'}
                            </p>
                            <div className="flex items-center gap-3 text-[10px] text-muted mt-1.5 font-medium">
                              <span>📖 {totalLessons} Lessons</span>
                              <span>•</span>
                              <span className={isChecked ? 'text-emerald-500 font-bold' : ''}>
                                {isChecked ? '✓ Assigned to learner' : 'Not assigned'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Footer Save Row */}
                <div className="pt-3 border-t border-line flex items-center justify-between shrink-0">
                  <span className="text-[11px] text-muted">
                    {userAssignedCourseIds.length === 0
                      ? '⚠️ No courses assigned to this learner'
                      : `Learner can access ${userAssignedCourseIds.length} course(s)`}
                  </span>
                  <button
                    type="button"
                    disabled={savingUserAssignments}
                    onClick={handleSaveUserAssignments}
                    className="cursor-pointer rounded-xl border-0 bg-orange px-5 py-2.5 text-xs font-bold text-white shadow-md hover:brightness-105 transition disabled:opacity-60"
                  >
                    {savingUserAssignments ? 'Saving...' : 'Save Assignments'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted">
                <span className="text-3xl mb-2">👤</span>
                <p className="text-sm font-semibold text-fg">Select a learner</p>
                <p className="text-xs text-muted mt-1">Choose a user from the directory to manage their course assignments.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================= MODE 2: ASSIGN BY COURSE ================= */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left Panel: Courses Catalog */}
          <div className="lg:col-span-5 rounded-2xl border border-line bg-panel p-4 shadow-sm flex flex-col h-[640px]">
            <div className="mb-3">
              <h3 className="font-display text-base font-bold text-fg">Courses Catalog</h3>
              <p className="text-xs text-muted">Select a course to enroll learners in batch</p>
              
              <div className="relative mt-2.5">
                <input
                  type="text"
                  value={courseSearchQuery}
                  onChange={(e) => setCourseSearchQuery(e.target.value)}
                  placeholder="Search course title..."
                  className="w-full rounded-xl border border-line bg-ink/50 py-2 pl-9 pr-3 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                />
                <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
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
                      className={`flex items-start gap-3 p-3.5 rounded-2xl border transition cursor-pointer select-none ${
                        isSelected
                          ? 'border-sky bg-sky/10 shadow-sm ring-1 ring-sky/30'
                          : 'border-line/70 bg-ink/30 hover:border-line hover:bg-ink/60'
                      }`}
                    >
                      <div className="h-10 w-10 rounded-xl bg-orange/10 border border-orange/20 text-orange grid place-items-center font-bold text-base shrink-0">
                        📚
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className={`text-xs font-bold truncate ${isSelected ? 'text-sky' : 'text-fg'}`}>
                            {c.title}
                          </h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange/15 text-orange border border-orange/30 shrink-0">
                            👥 {enrolledCount}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted line-clamp-1 mt-0.5">
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
          <div className="lg:col-span-7 rounded-2xl border border-line bg-panel p-5 shadow-sm flex flex-col h-[640px]">
            {activeCourse ? (
              <>
                {/* Active Course Banner */}
                <div className="flex items-center justify-between border-b border-line pb-4 mb-3 shrink-0">
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange/90 text-white font-bold uppercase">
                        {activeCourse.fileName === 'Manual Entry' ? 'Manual' : 'RAG PDF'}
                      </span>
                      <h3 className="font-display text-base font-bold text-fg truncate">
                        {activeCourse.title}
                      </h3>
                    </div>
                    <p className="text-xs text-muted truncate mt-0.5">
                      {activeCourse.description || 'Manage learners enrolled in this course'}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={savingCourseAssignments}
                    onClick={handleSaveCourseAssignments}
                    className="cursor-pointer rounded-xl border-0 bg-orange px-5 py-2.5 text-xs font-bold text-white shadow-md hover:brightness-105 transition disabled:opacity-60 shrink-0"
                  >
                    {savingCourseAssignments ? 'Saving...' : 'Save Enrolled Learners'}
                  </button>
                </div>

                {/* Subheader & Select All */}
                <div className="flex items-center justify-between gap-3 mb-3 shrink-0 text-xs">
                  <span className="text-muted font-semibold">
                    {courseEnrolledUserIds.length} of {users.length} learners enrolled
                  </span>
                  <div className="flex items-center gap-2">
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
                <div className="relative mb-3 shrink-0">
                  <input
                    type="text"
                    value={learnerFilterQuery}
                    onChange={(e) => setLearnerFilterQuery(e.target.value)}
                    placeholder="Filter learners by name, FIN..."
                    className="w-full rounded-xl border border-line bg-ink/50 py-2 pl-9 pr-3 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky"
                  />
                  <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>

                {/* Learners Checklist */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {loadingCourseUsers ? (
                    <div className="py-16 text-center text-xs text-muted">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky border-t-transparent mx-auto mb-2" />
                      Loading enrolled learners...
                    </div>
                  ) : users.length === 0 ? (
                    <div className="py-16 text-center border border-dashed border-line rounded-2xl p-6 text-xs text-muted">
                      No learners registered in the system yet.
                    </div>
                  ) : filteredLearnersForCourse.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted">No learners match filter.</div>
                  ) : (
                    filteredLearnersForCourse.map((u) => {
                      const isChecked = courseEnrolledUserIds.includes(u.id)
                      return (
                        <div
                          key={u.id}
                          onClick={() => toggleCourseUser(u.id)}
                          className={`flex items-center gap-3 p-3 rounded-2xl border transition cursor-pointer select-none ${
                            isChecked
                              ? 'border-sky bg-sky/5 shadow-sm'
                              : 'border-line bg-ink/40 hover:border-line/90'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="h-4 w-4 rounded text-sky focus:ring-sky/40 border-line"
                          />
                          {u.faceIdData && u.faceIdData.startsWith('data:image/') ? (
                            <img src={u.faceIdData} alt="" className="h-9 w-9 rounded-xl object-cover shrink-0" />
                          ) : (
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink font-semibold text-muted text-xs">
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
                <div className="pt-3 border-t border-line flex items-center justify-between shrink-0">
                  <span className="text-[11px] text-muted">
                    {courseEnrolledUserIds.length === 0
                      ? '⚠️ No learners enrolled in this course'
                      : `${courseEnrolledUserIds.length} learner(s) can play this course`}
                  </span>
                  <button
                    type="button"
                    disabled={savingCourseAssignments}
                    onClick={handleSaveCourseAssignments}
                    className="cursor-pointer rounded-xl border-0 bg-orange px-5 py-2.5 text-xs font-bold text-white shadow-md hover:brightness-105 transition disabled:opacity-60"
                  >
                    {savingCourseAssignments ? 'Saving...' : 'Save Enrolled Learners'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted">
                <span className="text-3xl mb-2">📚</span>
                <p className="text-sm font-semibold text-fg">Select a course</p>
                <p className="text-xs text-muted mt-1">Choose a course from the catalog to enroll learners.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default CourseAssignments
