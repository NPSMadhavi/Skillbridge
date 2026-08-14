import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/api'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (中文)' },
  { value: 'ms', label: 'Malay (Bahasa Melayu)' },
  { value: 'ta', label: 'Tamil (தமிழ்)' },
  { value: 'bn', label: 'Bangla (বাংলা)' },
]

const fieldClass =
  'w-full rounded-xl border border-line bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky focus:bg-panel focus:shadow-[0_0_0_3px_rgba(2,132,199,0.14)]'

const emptyForm = {
  fullName: '',
  finNumber: '',
  email: '',
  preferLanguage: 'en',
  password: '',
  country: '',
  faceIdData: '',
}

const validate = (form) => {
  const errors = {}

  if (!form.fullName.trim()) errors.fullName = 'Full name is required.'
  if (!form.finNumber.trim()) errors.finNumber = 'FIN number is required.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (!form.preferLanguage) errors.preferLanguage = 'Select preferred language.'
  if (!form.password || form.password.length < 6) {
    errors.password = 'Password must be at least 6 characters.'
  }
  if (!form.country.trim()) errors.country = 'Country is required.'
  if (!form.faceIdData) errors.faceIdData = 'Capture Face ID data before registering.'

  return errors
}

const RegisterUser = () => {
  const navigate = useNavigate()
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [capturing, setCapturing] = useState(false)

  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const openCamera = async () => {
    setCameraError('')
    setCameraOpen(true)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch {
      setCameraError('Camera access denied or unavailable. Allow camera permission to enroll Face ID.')
    }
  }

  const closeCamera = () => {
    stopCamera()
    setCameraOpen(false)
    setCapturing(false)
  }

  const captureFace = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      setCameraError('Camera is not ready yet. Wait a moment and try again.')
      return
    }

    setCapturing(true)
    const capturedImages = []
    
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      capturedImages.push(canvas.toDataURL('image/jpeg', 0.86))
    }

    updateField('faceIdData', capturedImages[0])
    updateField('faceIdDataList', capturedImages)
    setCapturing(false)
    closeCamera()
    setToast({ type: 'ok', text: 'Face ID data captured successfully.' })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setToast(null)

    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    try {
      const res = await api.registerUser({
        fullName: form.fullName.trim(),
        finNumber: form.finNumber.trim(),
        preferLanguage: form.preferLanguage,
        email: form.email.trim().toLowerCase(),
        password: form.password,
        country: form.country.trim(),
        faceIdData: form.faceIdDataList || form.faceIdData,
      })
      setForm(emptyForm)
      setToast({ type: 'ok', text: `${res.user.fullName} registered successfully.` })
    } catch (err) {
      setToast({ type: 'error', text: err.message || 'Registration failed.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="animate-rise-in mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          Register user
        </h1>
        <p className="mt-1 text-sm text-muted">
          Add a learner with FIN, region, contact details, and Face ID enrollment.
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-panel p-5 shadow-[0_10px_30px_rgba(15,27,45,0.04)] sm:p-7">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="fullName" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Full name
            </label>
            <input
              id="fullName"
              value={form.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              placeholder="e.g. Prem Sai"
              className={fieldClass}
            />
            {errors.fullName && <p className="text-xs text-danger">{errors.fullName}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="finNumber" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              FIN number
            </label>
            <input
              id="finNumber"
              value={form.finNumber}
              onChange={(e) => updateField('finNumber', e.target.value)}
              placeholder="e.g. S1234567A"
              className={fieldClass}
            />
            {errors.finNumber && <p className="text-xs text-danger">{errors.finNumber}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="preferLanguage" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Prefer language
            </label>
            <select
              id="preferLanguage"
              value={form.preferLanguage}
              onChange={(e) => updateField('preferLanguage', e.target.value)}
              className={fieldClass}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            {errors.preferLanguage && <p className="text-xs text-danger">{errors.preferLanguage}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="user@company.com"
              className={fieldClass}
            />
            {errors.email && <p className="text-xs text-danger">{errors.email}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => updateField('password', e.target.value)}
              placeholder="Minimum 6 characters"
              className={fieldClass}
            />
            {errors.password && <p className="text-xs text-danger">{errors.password}</p>}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="country" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Country
            </label>
            <input
              id="country"
              value={form.country}
              onChange={(e) => updateField('country', e.target.value)}
              placeholder="e.g. Singapore"
              className={fieldClass}
            />
            {errors.country && <p className="text-xs text-danger">{errors.country}</p>}
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Face ID data
            </p>

            {form.faceIdData ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-ok/25 bg-ok/5 p-4 sm:flex-row sm:items-center">
                <img
                  src={form.faceIdData}
                  alt="Captured Face ID"
                  className="h-24 w-24 rounded-xl object-cover shadow-sm"
                />
                <div className="flex-1">
                  <p className="font-semibold text-ok">Face ID enrolled</p>
                  <p className="mt-1 text-sm text-muted">
                    Biometric snapshot captured and ready to save with this user.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openCamera}
                      className="cursor-pointer rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-semibold text-fg hover:border-sky/40"
                    >
                      Recapture
                    </button>
                    <button
                      type="button"
                      onClick={() => updateField('faceIdData', '')}
                      className="cursor-pointer rounded-lg border border-danger/25 bg-danger/5 px-3 py-1.5 text-sm font-semibold text-danger"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={openCamera}
                className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-sky/40 bg-sky/5 px-4 py-8 text-center transition hover:bg-sky/10"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-sky/15 text-sky">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M8 21H6a3 3 0 0 1-3-3v-2M16 21h2a3 3 0 0 0 3-3v-2"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <circle cx="9" cy="10.5" r="1.1" fill="currentColor" />
                    <circle cx="15" cy="10.5" r="1.1" fill="currentColor" />
                    <path d="M10 15.2c.8.9 3.2.9 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="font-display font-semibold text-fg">Capture Face ID</span>
                <span className="text-sm text-muted">Use the camera to enroll biometric data</span>
              </button>
            )}
            {errors.faceIdData && <p className="mt-2 text-xs text-danger">{errors.faceIdData}</p>}
          </div>

          {toast && (
            <p
              className={`sm:col-span-2 rounded-[10px] px-3.5 py-2.5 text-center text-sm ${
                toast.type === 'ok'
                  ? 'border border-ok/25 bg-ok/10 text-ok'
                  : 'border border-danger/25 bg-danger/10 text-danger'
              }`}
              role="status"
            >
              {toast.text}
            </p>
          )}

          <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 cursor-pointer rounded-xl border-0 bg-orange px-4 py-3.5 font-display text-base font-semibold text-white shadow-[0_10px_28px_rgba(240,106,0,0.25)] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-70"
            >
              {saving ? 'Registering…' : 'Register user'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/users')}
              className="cursor-pointer rounded-xl border border-line bg-ink px-4 py-3.5 font-semibold text-fg transition hover:border-sky/40"
            >
              View users
            </button>
          </div>
        </form>
      </section>

      {cameraOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-navy/60 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="face-capture-title"
        >
          <div className="relative w-full max-w-md rounded-3xl border border-line bg-panel p-6 shadow-2xl animate-rise-in my-auto">
            <h2 id="face-capture-title" className="font-display text-xl font-semibold text-fg">
              Capture Face ID
            </h2>
            <p className="mt-1 text-sm text-muted">Center the face in the frame, then capture.</p>

            <div className="relative mt-4 overflow-hidden rounded-2xl border border-line bg-navy/90">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-4/3 w-full scale-x-[-1] object-cover"
              />
              <div className="pointer-events-none absolute inset-6 rounded-[28px] border-2 border-sky/70" />
              {capturing && (
                <div className="absolute inset-0 grid place-items-center bg-navy/40">
                  <p className="rounded-full bg-panel px-3 py-1.5 text-sm font-semibold text-fg">
                    Capturing…
                  </p>
                </div>
              )}
            </div>

            {cameraError && (
              <p className="mt-3 rounded-[10px] border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                {cameraError}
              </p>
            )}

            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={closeCamera}
                className="flex-1 cursor-pointer rounded-xl border border-line bg-transparent px-3 py-3 font-semibold text-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={captureFace}
                disabled={!!cameraError || capturing}
                className="flex-1 cursor-pointer rounded-xl border-0 bg-sky px-3 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {capturing ? 'Saving…' : 'Capture'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default RegisterUser
