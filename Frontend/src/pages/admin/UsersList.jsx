import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../../services/api'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (中文)' },
  { value: 'ms', label: 'Malay (Bahasa Melayu)' },
  { value: 'ta', label: 'Tamil (தமிழ்)' },
  { value: 'bn', label: 'Bangla (বাংলা)' },
]

const UsersList = () => {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({
    fullName: '',
    finNumber: '',
    email: '',
    preferLanguage: 'en',
    country: '',
    password: '',
    assignedCourseIds: []
  })
  const [editErrors, setEditErrors] = useState({})
  const [updating, setUpdating] = useState(false)
  const [progressUser, setProgressUser] = useState(null)
  const [userProgressData, setUserProgressData] = useState(null)
  const [loadingProgress, setLoadingProgress] = useState(false)

  const [deletingUser, setDeletingUser] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Course assignment state
  const [allCourses, setAllCourses] = useState([])
  const [assignModalUser, setAssignModalUser] = useState(null)
  const [assignedCourseSelection, setAssignedCourseSelection] = useState([])
  const [savingAssignments, setSavingAssignments] = useState(false)

  const handleConfirmDelete = async () => {
    if (!deletingUser) return
    setIsDeleting(true)
    try {
      await api.deleteUser(deletingUser.id)
      setUsers(prev => prev.filter(u => u.id !== deletingUser.id))
      if (selectedUser?.id === deletingUser.id) {
        setSelectedUser(null)
      }
      setDeletingUser(null)
    } catch (err) {
      alert(err.message || 'Failed to delete user.')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleOpenAssign = (user) => {
    setAssignModalUser(user)
    setAssignedCourseSelection(user.assignedCourseIds || [])
  }

  const toggleCourseSelection = (courseId) => {
    setAssignedCourseSelection((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId]
    )
  }

  const handleSaveAssignments = async () => {
    if (!assignModalUser) return
    setSavingAssignments(true)
    try {
      const res = await api.assignUserCourses(assignModalUser.id, assignedCourseSelection)
      setUsers((prev) =>
        prev.map((u) =>
          u.id === assignModalUser.id
            ? {
                ...u,
                assignedCourseIds: res.assignedCourseIds,
                assignedCourses: res.assignedCourses,
              }
            : u
        )
      )
      setAssignModalUser(null)
    } catch (err) {
      alert(err.message || 'Failed to save course assignments.')
    } finally {
      setSavingAssignments(false)
    }
  }

  const handleOpenProgress = async (user) => {
    setProgressUser(user)
    setLoadingProgress(true)
    try {
      const data = await api.getUserProgress(user.id)
      setUserProgressData(data)
    } catch (err) {
      console.error('Failed to load user progress:', err)
    } finally {
      setLoadingProgress(false)
    }
  }

  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [capturing, setCapturing] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const openCamera = async () => {
    setCameraError('')
    setCameraOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      })
      streamRef.current = stream
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      }, 100)
    } catch (err) {
      console.error(err)
      setCameraError('Could not access camera. Please check permissions.')
    }
  }

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraOpen(false)
  }

  const startCapturing = async () => {
    if (!videoRef.current) return
    setCapturing(true)
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    const capturedImages = []

    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      capturedImages.push(canvas.toDataURL('image/jpeg', 0.86))
    }

    setEditForm(prev => ({
      ...prev,
      faceIdData: capturedImages[0],
      faceIdDataList: capturedImages
    }))
    setCapturing(false)
    closeCamera()
  }

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const handleToggleStatus = async (id) => {
    try {
      const res = await api.toggleUserStatus(id)
      setUsers(prev => prev.map(u => u.id === id ? { ...u, status: res.user.status } : u))
    } catch (err) {
      alert(err.message || 'Failed to toggle status.')
    }
  }

  const startEdit = (user) => {
    setEditingUser(user)
    setEditForm({
      fullName: user.fullName,
      finNumber: user.finNumber,
      email: user.email,
      preferLanguage: user.preferLanguage || 'en',
      country: user.country,
      password: '',
      faceIdData: user.faceIdData || '',
      assignedCourseIds: user.assignedCourseIds || [],
    })
    setEditErrors({})
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    setEditErrors({})

    const errors = {}
    if (!editForm.fullName.trim()) errors.fullName = 'Full name is required.'
    if (!editForm.finNumber.trim()) {
      errors.finNumber = 'FIN is required.'
    } else if (!/^[STFGMstfgm]\d{7}[A-Za-z]$/.test(editForm.finNumber.trim())) {
      errors.finNumber = 'FIN must be 9 characters (e.g. S1234567A).'
    }
    if (!editForm.email.trim()) errors.email = 'Email is required.'
    if (!editForm.country.trim()) errors.country = 'Country is required.'

    if (Object.keys(errors).length) {
      setEditErrors(errors)
      return
    }

    setUpdating(true)
    try {
      const payload = {
        fullName: editForm.fullName.trim(),
        finNumber: editForm.finNumber.trim(),
        preferLanguage: editForm.preferLanguage,
        email: editForm.email.trim().toLowerCase(),
        country: editForm.country.trim(),
        assignedCourseIds: editForm.assignedCourseIds,
      }
      if (editForm.password) {
        payload.password = editForm.password
      }
      if (editForm.faceIdDataList) {
        payload.faceIdData = editForm.faceIdDataList
      } else if (editForm.faceIdData && editForm.faceIdData.startsWith('data:image/')) {
        payload.faceIdData = editForm.faceIdData
      }

      const res = await api.updateUser(editingUser.id, payload)
      setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, ...res.user } : u))
      setEditingUser(null)
    } catch (err) {
      alert(err.message || 'Failed to update user.')
    } finally {
      setUpdating(false)
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersData, coursesData] = await Promise.all([
          api.getUsers(),
          api.getCourses().catch(() => []),
        ])
        setUsers(usersData || [])
        setAllCourses(coursesData || [])
      } catch (err) {
        setError(err.message || 'Failed to load users.')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])


  const filtered = useMemo(() => {
    return users.filter((user) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return (
        user.fullName.toLowerCase().includes(q) ||
        user.finNumber.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        (user.preferLanguage && user.preferLanguage.toLowerCase().includes(q)) ||
        (user.country && user.country.toLowerCase().includes(q))
      )
    })
  }, [users, query])

  return (
    <div className="animate-rise-in space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">Users</h1>
          <p className="mt-1 text-sm text-muted">{users.length} registered learner{users.length === 1 ? '' : 's'}</p>
        </div>
        <Link
          to="/admin/register"
          className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#143a6b]"
        >
          Register user
        </Link>
      </div>

      <label className="relative block max-w-md">
        <span className="sr-only">Search users</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, FIN, email, country…"
          className="w-full rounded-xl border border-line bg-panel py-2.5 pr-3 pl-10 text-sm text-fg outline-none transition placeholder:text-muted/70 focus:border-sky/50 focus:shadow-[0_0_0_3px_rgba(2,132,199,0.12)]"
        />
        <svg
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </label>

      <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_10px_30px_rgba(15,27,45,0.04)]">
        {loading ? (
          <div className="px-4 py-14 text-center">
            <p className="font-medium text-fg">Loading users…</p>
          </div>
        ) : error ? (
          <div className="px-4 py-14 text-center">
            <p className="font-medium text-danger">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="font-medium text-fg">No users found</p>
            <p className="mt-1 text-sm text-muted">Try another search or register a new user.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] text-left text-sm">
              <thead className="bg-ink/70">
                <tr className="border-b border-line text-xs tracking-[0.08em] text-muted uppercase">
                  <th className="px-4 py-3 font-semibold sm:px-5 min-w-[220px]">User</th>
                  <th className="px-4 py-3 font-semibold min-w-[120px]">FIN</th>
                  <th className="px-4 py-3 font-semibold min-w-[100px]">Language</th>
                  <th className="px-4 py-3 font-semibold sm:px-5 min-w-[160px] whitespace-nowrap">Assigned Courses</th>
                  <th className="px-4 py-3 font-semibold min-w-[100px]">Status</th>
                  <th className="px-4 py-3 font-semibold sm:px-5 min-w-[100px]">Face ID</th>
                  <th className="px-4 py-3 font-semibold sm:px-5 min-w-[160px] whitespace-nowrap">Course Progress</th>
                  <th className="px-4 py-3 font-semibold text-right sm:px-5 min-w-[150px] whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const assignedCount = user.assignedCourseIds?.length || user.assignedCourses?.length || 0;
                  return (
                    <tr key={user.id} className="border-b border-line/70 last:border-0 hover:bg-ink/40">
                      <td className="px-4 py-4 sm:px-5 min-w-[220px]">
                        <div className="flex items-center gap-3">
                          {user.faceIdData && user.faceIdData.startsWith('data:image/') ? (
                            <img src={user.faceIdData} alt="" className="h-11 w-11 rounded-xl object-cover shrink-0" />
                          ) : (
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink font-semibold text-muted">
                              {user.fullName.slice(0, 1)}
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-fg truncate">{user.fullName}</p>
                            <p className="text-xs text-muted truncate">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 font-medium text-fg whitespace-nowrap">{user.finNumber}</td>
                      <td className="px-4 py-4 text-muted uppercase whitespace-nowrap">{user.preferLanguage}</td>
                      
                      {/* Assigned Courses Column */}
                      <td className="px-4 py-4 sm:px-5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenAssign(user)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                            assignedCount > 0
                              ? 'border-sky/30 bg-sky/10 text-sky hover:bg-sky/20'
                              : 'border-dashed border-orange/40 bg-orange/5 text-orange hover:bg-orange/10'
                          }`}
                          title="Click to assign or manage courses for this learner"
                        >
                          <span>📚</span>
                          <span>{assignedCount > 0 ? `${assignedCount} Assigned` : '+ Assign'}</span>
                        </button>
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(user.id)}
                          className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[0.68rem] font-bold uppercase transition hover:brightness-105 cursor-pointer ${
                            user.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                          title="Click to toggle status"
                        >
                          {user.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-4 py-4 sm:px-5 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase ${
                            user.faceIdData ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                          }`}
                        >
                          {user.faceIdData ? 'Enrolled' : 'Missing'}
                        </span>
                      </td>
                      <td className="px-4 py-4 sm:px-5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenProgress(user)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink px-2.5 py-1 text-xs font-semibold text-sky hover:border-sky/40 transition cursor-pointer"
                          title="View course progress"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14" />
                          </svg>
                          <span>
                            {user.progressSummary && user.progressSummary.completedCourses > 0
                              ? `✓ ${user.progressSummary.completedCourses} Done`
                              : user.progressSummary && user.progressSummary.inProgressCourses > 0
                              ? `⚙ ${user.progressSummary.inProgressCourses} Active`
                              : 'Progress'}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-4 text-right sm:px-5 whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenAssign(user)}
                            className="inline-flex cursor-pointer items-center justify-center h-8 w-8 rounded-lg border border-line bg-ink text-orange hover:bg-orange/10 hover:border-orange/40 transition"
                            title="Assign Courses"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenProgress(user)}
                            className="inline-flex cursor-pointer items-center justify-center h-8 w-8 rounded-lg border border-line bg-ink text-sky hover:bg-sky/10 hover:border-sky/40 transition"
                            title="View course progress"
                          >
                            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedUser(user)}
                            className="inline-flex cursor-pointer items-center justify-center h-8 w-8 rounded-lg border border-line bg-ink text-muted hover:border-sky/40 hover:text-sky transition"
                            title="View details"
                          >
                            <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="inline-flex cursor-pointer items-center justify-center h-8 w-8 rounded-lg border border-line bg-ink text-muted hover:border-sky/40 hover:text-sky transition"
                            title="Edit user"
                          >
                            <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingUser(user)}
                            className="inline-flex cursor-pointer items-center justify-center h-8 w-8 rounded-lg border border-line bg-ink text-muted hover:border-danger/40 hover:text-danger hover:bg-danger/10 transition"
                            title="Delete user"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

          </div>
        )}
      </section>

      {selectedUser && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-modal-title"
        >
          <div className="relative w-full max-w-lg rounded-3xl border border-line bg-panel p-6 shadow-2xl my-auto animate-rise-in">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <h2 id="details-modal-title" className="font-display text-xl font-semibold text-fg">
                User Details
              </h2>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-line bg-ink text-muted hover:text-fg transition"
                aria-label="Close details"
              >
                ✕
              </button>
            </div>
            
            <div className="mt-5 space-y-4">
              <div className="flex items-center gap-4 border-b border-line/40 pb-4">
                {selectedUser.faceIdData && selectedUser.faceIdData.startsWith('data:image/') ? (
                  <img src={selectedUser.faceIdData} alt="" className="h-16 w-16 rounded-2xl object-cover" />
                ) : (
                  <span className="grid h-16 w-16 place-items-center rounded-2xl bg-ink font-display text-2xl font-semibold text-muted">
                    {selectedUser.fullName.slice(0, 1)}
                  </span>
                )}
                <div>
                  <h3 className="font-display text-base font-bold text-fg">{selectedUser.fullName}</h3>
                  <p className="text-xs text-muted">{selectedUser.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-sm">
                <div>
                  <p className="text-[0.7rem] font-semibold tracking-wider text-muted uppercase">FIN Number</p>
                  <p className="mt-0.5 font-semibold text-fg">{selectedUser.finNumber}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold tracking-wider text-muted uppercase">Preferred Language</p>
                  <p className="mt-0.5 font-semibold text-fg uppercase">{selectedUser.preferLanguage}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold tracking-wider text-muted uppercase">Country</p>
                  <p className="mt-0.5 font-semibold text-fg">{selectedUser.country}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold tracking-wider text-muted uppercase">Face ID status</p>
                  <p className="mt-0.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[0.68rem] font-bold uppercase ${
                      selectedUser.faceIdData ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                    }`}>
                      {selectedUser.faceIdData ? 'Enrolled' : 'Missing'}
                    </span>
                  </p>
                </div>
                <div className="col-span-2 border-t border-line/40 pt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[0.7rem] font-semibold tracking-wider text-muted uppercase">
                      Assigned Courses ({selectedUser.assignedCourses?.length || 0})
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const u = selectedUser;
                        setSelectedUser(null);
                        handleOpenAssign(u);
                      }}
                      className="text-xs text-sky hover:underline cursor-pointer border-0 bg-transparent font-medium"
                    >
                      Manage Assignments
                    </button>
                  </div>
                  {selectedUser.assignedCourses && selectedUser.assignedCourses.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {selectedUser.assignedCourses.map((c) => (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-sky/10 text-sky border border-sky/20"
                        >
                          <span>📚</span>
                          <span>{c.title}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted italic">No courses assigned to this user yet.</p>
                  )}
                </div>
                <div className="col-span-2">
                  <p className="text-[0.7rem] font-semibold tracking-wider text-muted uppercase">Registered At</p>
                  <p className="mt-0.5 font-semibold text-fg">
                    {new Date(selectedUser.registeredAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const u = selectedUser;
                  setSelectedUser(null);
                  setDeletingUser(u);
                }}
                className="cursor-pointer rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-xs sm:text-sm font-semibold text-danger hover:bg-danger/20 transition inline-flex items-center gap-1.5"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete User
              </button>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="cursor-pointer rounded-xl border border-line bg-ink px-4 py-2.5 text-sm font-semibold text-fg hover:border-sky/40 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {deletingUser && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="relative w-full max-w-md rounded-3xl border border-line bg-panel p-6 shadow-2xl my-auto animate-rise-in">
            <div className="flex items-center gap-3.5 border-b border-line pb-4">
              <div className="h-10 w-10 rounded-2xl bg-danger/15 text-danger flex items-center justify-center shrink-0 border border-danger/30">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h2 id="delete-modal-title" className="font-display text-lg font-bold text-fg">
                  Delete User Account
                </h2>
                <p className="text-xs text-muted">This action is permanent and cannot be undone.</p>
              </div>
            </div>

            <div className="mt-4 p-3.5 rounded-2xl bg-ink/60 border border-line/60 space-y-1.5 text-sm">
              <p className="text-fg font-semibold">{deletingUser.fullName}</p>
              <p className="text-xs text-muted font-mono">{deletingUser.email} • FIN: {deletingUser.finNumber}</p>
              <p className="text-xs text-danger pt-1">
                ⚠️ All course assignments and progress records for this student will also be removed.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingUser(null)}
                className="cursor-pointer rounded-xl border border-line bg-ink px-4 py-2.5 text-xs sm:text-sm font-semibold text-fg hover:border-sky/40 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="cursor-pointer rounded-xl bg-danger px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-lg transition hover:bg-danger/90 disabled:opacity-50 border-0 flex items-center gap-1.5"
              >
                {isDeleting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete User'
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingUser && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-modal-title"
        >
          <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl border border-line bg-panel p-6 shadow-2xl my-auto animate-rise-in">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <h2 id="edit-modal-title" className="font-display text-xl font-semibold text-fg">
                Edit User
              </h2>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-line bg-ink text-muted hover:text-fg transition"
                aria-label="Close form"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-3.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                  Full name
                </label>
                <input
                  value={editForm.fullName}
                  onChange={(e) => setEditForm(prev => ({ ...prev, fullName: e.target.value }))}
                  className="w-full rounded-xl border border-line bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky"
                />
                {editErrors.fullName && <p className="text-xs text-danger">{editErrors.fullName}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                  FIN number
                </label>
                <input
                  value={editForm.finNumber}
                  onChange={(e) => setEditForm(prev => ({ ...prev, finNumber: e.target.value }))}
                  className="w-full rounded-xl border border-line bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky"
                />
                {editErrors.finNumber && <p className="text-xs text-danger">{editErrors.finNumber}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                  Email
                </label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full rounded-xl border border-line bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky"
                />
                {editErrors.email && <p className="text-xs text-danger">{editErrors.email}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                    Language
                  </label>
                  <select
                    value={editForm.preferLanguage}
                    onChange={(e) => setEditForm(prev => ({ ...prev, preferLanguage: e.target.value }))}
                    className="w-full rounded-xl border border-line bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky"
                  >
                    {LANGUAGES.map(lang => (
                      <option key={lang.value} value={lang.value}>{lang.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                    Country
                  </label>
                  <input
                    value={editForm.country}
                    onChange={(e) => setEditForm(prev => ({ ...prev, country: e.target.value }))}
                    className="w-full rounded-xl border border-line bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky"
                  />
                  {editErrors.country && <p className="text-xs text-danger">{editErrors.country}</p>}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                  Password
                </label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Leave blank to keep unchanged"
                  className="w-full rounded-xl border border-line bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky"
                />
              </div>

              {/* Assigned Courses Section in Edit User */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                    Assigned Courses ({editForm.assignedCourseIds?.length || 0})
                  </label>
                  {allCourses.length > 0 && (
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setEditForm(p => ({ ...p, assignedCourseIds: allCourses.map(c => c.id) }))}
                        className="text-sky hover:underline cursor-pointer border-0 bg-transparent font-medium"
                      >
                        Select all
                      </button>
                      <span className="text-muted">•</span>
                      <button
                        type="button"
                        onClick={() => setEditForm(p => ({ ...p, assignedCourseIds: [] }))}
                        className="text-muted hover:text-fg cursor-pointer border-0 bg-transparent font-medium"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid gap-2 max-h-36 overflow-y-auto pr-1 border border-line rounded-xl p-2 bg-ink/30">
                  {allCourses.length === 0 ? (
                    <p className="text-xs text-muted p-2 text-center">No courses available.</p>
                  ) : (
                    allCourses.map(c => {
                      const isChecked = (editForm.assignedCourseIds || []).includes(c.id);
                      return (
                        <label
                          key={c.id}
                          onClick={() => {
                            setEditForm(p => {
                              const curr = p.assignedCourseIds || [];
                              const next = curr.includes(c.id) ? curr.filter(id => id !== c.id) : [...curr, c.id];
                              return { ...p, assignedCourseIds: next };
                            });
                          }}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border text-xs cursor-pointer select-none transition ${
                            isChecked ? 'border-sky/50 bg-sky/5 text-sky font-semibold' : 'border-line bg-ink/40 text-fg'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 rounded text-sky focus:ring-sky/40 border-line"
                          />
                          <span className="truncate flex-1">{c.title}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                  Face ID Biometrics
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-line bg-ink/50 p-3">
                  {editForm.faceIdData && editForm.faceIdData.startsWith('data:image/') ? (
                    <img src={editForm.faceIdData} alt="Enrolled Face" className="h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <div className="grid h-12 w-12 place-items-center rounded-lg bg-ink text-muted font-bold text-sm">
                      ?
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-[0.75rem] font-semibold text-fg">
                      {editForm.faceIdData ? 'Face ID Enrolled' : 'Face ID Missing'}
                    </p>
                    <p className="text-[0.65rem] text-muted leading-tight">
                      Enroll or update user biometric authentication.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openCamera}
                    className="cursor-pointer rounded-lg bg-sky px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-105"
                  >
                    {editForm.faceIdData ? 'Re-register' : 'Register'}
                  </button>
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 cursor-pointer rounded-xl border border-line bg-ink px-4 py-3 font-semibold text-fg hover:border-sky/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="flex-1 cursor-pointer rounded-xl border-0 bg-sky px-4 py-3 font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
                >
                  {updating ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}


      {cameraOpen && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6 bg-navy/70 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-3xl border border-line bg-panel p-6 text-center shadow-2xl animate-rise-in">
            <h3 className="font-display text-lg font-semibold text-fg">Capture Face ID</h3>
            <p className="mt-1 text-xs text-muted">Look directly into the camera during verification.</p>
            
            <div className="relative mx-auto mt-4 aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink">
              {cameraError ? (
                <div className="absolute inset-0 grid place-items-center px-4 text-center">
                  <p className="text-xs text-danger">{cameraError}</p>
                </div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              )}
              {capturing && (
                <div className="absolute inset-0 grid place-items-center bg-ink/75">
                  <div className="space-y-2">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky border-t-transparent mx-auto"></div>
                    <p className="text-xs text-sky font-semibold">Capturing biometrics...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={closeCamera}
                disabled={capturing}
                className="flex-1 cursor-pointer rounded-xl border border-line bg-ink px-4 py-2.5 text-sm font-semibold text-fg hover:border-sky/40 transition disabled:opacity-50"
              >
                Cancel
              </button>
              {!cameraError && (
                <button
                  type="button"
                  onClick={startCapturing}
                  disabled={capturing}
                  className="flex-1 cursor-pointer rounded-xl border-0 bg-sky px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                >
                  Capture
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {progressUser && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="progress-modal-title"
        >
          <div className="relative w-full max-w-2xl rounded-3xl border border-line bg-panel p-6 shadow-2xl my-auto max-h-[85vh] flex flex-col justify-between overflow-hidden animate-rise-in">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-line pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-sky/10 border border-sky/20 text-sky grid place-items-center font-bold text-lg">
                  📈
                </div>
                <div>
                  <h2 id="progress-modal-title" className="font-display text-lg sm:text-xl font-semibold text-fg">
                    User Course Progress
                  </h2>
                  <p className="text-xs text-muted">
                    {progressUser.fullName} ({progressUser.email}) • FIN: {progressUser.finNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProgressUser(null)
                  setUserProgressData(null)
                }}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-line bg-ink text-muted hover:text-fg transition"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Modal Content Body */}
            <div className="flex-1 min-h-0 overflow-y-auto my-4 space-y-4 pr-1">
              {loadingProgress ? (
                <div className="py-14 text-center">
                  <div className="inline-block animate-spin h-7 w-7 border-3 border-sky border-t-transparent rounded-full mb-2" />
                  <p className="text-xs text-muted font-medium">Fetching course progress for {progressUser.fullName}...</p>
                </div>
              ) : !userProgressData || !userProgressData.courses || userProgressData.courses.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-line rounded-2xl bg-ink p-6">
                  <p className="text-sm font-semibold text-fg">No Course Activity Found</p>
                  <p className="text-xs text-muted mt-1">This user has not started any course modules yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary Metrics */}
                  <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-ink border border-line text-center">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted">Completed</p>
                      <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {userProgressData.courses.filter(c => c.completed).length}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted">In Progress</p>
                      <p className="text-lg font-bold text-sky mt-0.5">
                        {userProgressData.courses.filter(c => !c.completed && c.progress > 0).length}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted">Total Courses</p>
                      <p className="text-lg font-bold text-fg mt-0.5">
                        {userProgressData.courses.length}
                      </p>
                    </div>
                  </div>

                  {/* Course list */}
                  <div className="space-y-3">
                    {userProgressData.courses.map((c) => (
                      <div key={c.id} className="rounded-2xl border border-line bg-panel p-4 space-y-3 shadow-sm hover:border-sky/40 transition">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-bold text-fg leading-snug">{c.title}</h4>
                            <p className="text-xs text-muted mt-0.5">
                              Modules {c.completedCount} of {c.totalLessons} finished
                            </p>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                            c.completed
                              ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                              : c.progress > 0
                              ? 'bg-sky/10 text-sky border border-sky/20'
                              : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
                          }`}>
                            {c.completed ? '✓ Verified Certificate' : c.progress > 0 ? `${c.progress}% In Progress` : 'Not Started'}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1">
                          <div className="w-full h-2.5 rounded-full bg-ink overflow-hidden border border-line/60">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                c.completed ? 'bg-emerald-500' : 'bg-orange'
                              }`}
                              style={{ width: `${c.progress}%` }}
                            />
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-muted font-medium">
                            <span>{c.progress}% Completed</span>
                            {c.updatedAt && <span>Updated: {new Date(c.updatedAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-line flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => {
                  setProgressUser(null)
                  setUserProgressData(null)
                }}
                className="cursor-pointer rounded-xl border border-line bg-ink px-4 py-2.5 text-sm font-semibold text-fg hover:border-sky/40 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Assign Courses Modal */}
      {assignModalUser && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-modal-title"
        >
          <div className="relative w-full max-w-lg rounded-3xl border border-line bg-panel p-6 shadow-2xl my-auto animate-rise-in max-h-[85vh] flex flex-col justify-between overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-line pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-orange/10 border border-orange/20 text-orange grid place-items-center font-bold text-lg">
                  📚
                </div>
                <div>
                  <h2 id="assign-modal-title" className="font-display text-lg sm:text-xl font-semibold text-fg">
                    Assign Courses
                  </h2>
                  <p className="text-xs text-muted">
                    {assignModalUser.fullName} ({assignModalUser.email}) • FIN: {assignModalUser.finNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAssignModalUser(null)}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-line bg-ink text-muted hover:text-fg transition"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Quick action bar */}
            <div className="flex items-center justify-between py-2 border-b border-line/40 shrink-0 text-xs">
              <span className="text-muted font-medium">
                {assignedCourseSelection.length} of {allCourses.length} course{allCourses.length === 1 ? '' : 's'} assigned
              </span>
              {allCourses.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAssignedCourseSelection(allCourses.map((c) => c.id))}
                    className="text-sky hover:underline cursor-pointer border-0 bg-transparent font-semibold"
                  >
                    Select all
                  </button>
                  <span className="text-muted">•</span>
                  <button
                    type="button"
                    onClick={() => setAssignedCourseSelection([])}
                    className="text-muted hover:text-fg cursor-pointer border-0 bg-transparent font-medium"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {/* Course Checklist List */}
            <div className="flex-1 min-h-0 overflow-y-auto my-3 space-y-2 pr-1">
              {allCourses.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted">
                  No courses published in catalog. Create a course first from Course Manager.
                </div>
              ) : (
                allCourses.map((c) => {
                  const isChecked = assignedCourseSelection.includes(c.id);
                  const curriculumData = typeof c.curriculum === 'string' ? JSON.parse(c.curriculum) : (c.curriculum || {});
                  const totalLessons = curriculumData.lessons?.length || 5;

                  return (
                    <div
                      key={c.id}
                      onClick={() => toggleCourseSelection(c.id)}
                      className={`flex items-start gap-3 p-3.5 rounded-2xl border transition cursor-pointer select-none ${
                        isChecked
                          ? 'border-sky/60 bg-sky/5 shadow-sm'
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
                          {c.description || 'AI tutor course module'}
                        </p>
                        <div className="flex items-center gap-3 text-[10px] text-muted mt-1.5 font-medium">
                          <span>📖 {totalLessons} Lessons</span>
                          <span>•</span>
                          <span>{isChecked ? '✓ Assigned to learner' : 'Not assigned'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-line flex items-center justify-between shrink-0">
              <span className="text-[11px] text-muted">
                {assignedCourseSelection.length === 0
                  ? '⚠️ No courses assigned (learner will see empty dashboard)'
                  : 'Learner can play only selected courses'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAssignModalUser(null)}
                  className="cursor-pointer rounded-xl border border-line bg-ink px-4 py-2.5 text-xs font-semibold text-fg hover:border-sky/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingAssignments}
                  onClick={handleSaveAssignments}
                  className="cursor-pointer rounded-xl border-0 bg-orange px-5 py-2.5 text-xs font-bold text-white shadow-md hover:brightness-105 transition disabled:opacity-60"
                >
                  {savingAssignments ? 'Saving...' : 'Save Assignments'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default UsersList;

