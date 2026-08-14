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
  const [editForm, setEditForm] = useState({ fullName: '', finNumber: '', email: '', preferLanguage: 'en', country: '', password: '' })
  const [editErrors, setEditErrors] = useState({})
  const [updating, setUpdating] = useState(false)
  const [progressUser, setProgressUser] = useState(null)
  const [userProgressData, setUserProgressData] = useState(null)
  const [loadingProgress, setLoadingProgress] = useState(false)

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
    })
    setEditErrors({})
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    setEditErrors({})

    const errors = {}
    if (!editForm.fullName.trim()) errors.fullName = 'Full name is required.'
    if (!editForm.finNumber.trim()) errors.finNumber = 'FIN is required.'
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
    const fetchUsers = async () => {
      try {
        const data = await api.getUsers()
        setUsers(data)
      } catch (err) {
        setError(err.message || 'Failed to load users.')
      } finally {
        setLoading(false)
      }
    }
    fetchUsers()
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
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-ink/70">
                <tr className="border-b border-line text-xs tracking-[0.08em] text-muted uppercase">
                  <th className="px-4 py-3 font-semibold sm:px-5 min-w-[240px]">User</th>
                  <th className="px-4 py-3 font-semibold min-w-[130px]">FIN</th>
                  <th className="px-4 py-3 font-semibold min-w-[110px]">Language</th>
                  <th className="px-4 py-3 font-semibold min-w-[120px]">Country</th>
                  <th className="px-4 py-3 font-semibold min-w-[100px]">Status</th>
                  <th className="px-4 py-3 font-semibold sm:px-5 min-w-[110px]">Face ID</th>
                  <th className="px-4 py-3 font-semibold sm:px-5 min-w-[170px] whitespace-nowrap">Course Progress</th>
                  <th className="px-4 py-3 font-semibold text-right sm:px-5 min-w-[130px] whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b border-line/70 last:border-0 hover:bg-ink/40">
                    <td className="px-4 py-4 sm:px-5 min-w-[240px]">
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
                    <td className="px-4 py-4 text-muted whitespace-nowrap">{user.country}</td>
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
                            ? `✓ ${user.progressSummary.completedCourses} Completed`
                            : user.progressSummary && user.progressSummary.inProgressCourses > 0
                            ? `⚙ ${user.progressSummary.inProgressCourses} In Progress`
                            : 'View Progress'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-4 text-right sm:px-5 whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
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
                      </div>
                    </td>
                  </tr>
                ))}
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
                <div className="col-span-2">
                  <p className="text-[0.7rem] font-semibold tracking-wider text-muted uppercase">Registered At</p>
                  <p className="mt-0.5 font-semibold text-fg">
                    {new Date(selectedUser.registeredAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
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

      {editingUser && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-modal-title"
        >
          <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl border border-line bg-panel p-6 shadow-2xl my-auto animate-rise-in">
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
    </div>
  )
}

export default UsersList;
