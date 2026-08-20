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

const ExclamationCircleIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0 text-rose-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      clipRule="evenodd"
    />
  </svg>
)

const EyeIcon = ({ open }) => (
  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {open ? (
      <>
        <path
          d="M2.8 12S6.2 6.2 12 6.2 21.2 12 21.2 12 17.8 17.8 12 17.8 2.8 12 2.8 12Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      </>
    ) : (
      <path
        d="M3.2 4.2 20.8 21.8M10 10.2A2.8 2.8 0 0 0 14 14M7.4 7.7C5.4 9 3.8 11.2 3.2 12c0 0 3.4 5.8 8.8 5.8 1.5 0 2.9-.4 4.1-1.1M14.5 6.6A8.4 8.4 0 0 0 12 6.2C6.6 6.2 3.2 12 3.2 12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    )}
  </svg>
)

const getFieldClass = (hasError) =>
  `w-full rounded-xl border bg-ink/50 px-4 py-3 text-[0.95rem] text-fg outline-none transition placeholder:text-muted/60 focus:bg-panel ${
    hasError
      ? 'border-rose-400 focus:border-rose-500 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]'
      : 'border-line hover:border-sky/40 focus:border-sky focus:shadow-[0_0_0_3px_rgba(2,132,199,0.14)]'
  }`

const emptyForm = {
  fullName: '',
  finNumber: '',
  email: '',
  preferLanguage: 'en',
  password: '',
  country: '',
  faceIdData: '',
}

const emptyTouched = {
  fullName: false,
  finNumber: false,
  email: false,
  preferLanguage: false,
  password: false,
  country: false,
  faceIdData: false,
}

const validateField = (key, val) => {
  switch (key) {
    case 'fullName': {
      const trimmed = (val || '').trim()
      if (!trimmed) return 'Full name is required.'
      if (trimmed.length < 2) return 'Full name must be at least 2 characters.'
      return ''
    }
    case 'finNumber': {
      const trimmed = (val || '').trim().toUpperCase()
      if (!trimmed) return 'FIN number is required.'
      if (trimmed.length !== 9) {
        return 'FIN number must be exactly 9 characters (e.g. S1234567A).'
      }
      if (!/^[STFGMstfgm]\d{7}[A-Za-z]$/.test(trimmed)) {
        return 'FIN must start with S, T, F, G, or M, followed by 7 digits and 1 letter (e.g. S1234567A).'
      }
      return ''
    }
    case 'email': {
      const trimmed = (val || '').trim()
      if (!trimmed) return 'Email address is required.'
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
        return 'Enter a valid email address.'
      }
      return ''
    }
    case 'preferLanguage': {
      if (!val) return 'Select preferred language.'
      return ''
    }
    case 'password': {
      if (!val) return 'Password is required.'
      if (val.length < 6) return 'Password must be at least 6 characters.'
      return ''
    }
    case 'country': {
      const trimmed = (val || '').trim()
      if (!trimmed) return 'Country is required.'
      return ''
    }
    case 'faceIdData': {
      if (!val) return 'Capture Face ID data before registering.'
      return ''
    }
    default:
      return ''
  }
}

const validateAll = (form) => {
  const errors = {}
  Object.keys(emptyForm).forEach((key) => {
    const err = validateField(key, form[key])
    if (err) errors[key] = err
  })
  return errors
}

const RegisterUser = () => {
  const navigate = useNavigate()
  const [form, setForm] = useState(emptyForm)
  const [touched, setTouched] = useState(emptyTouched)
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [capturing, setCapturing] = useState(false)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fullNameRef = useRef(null)
  const finNumberRef = useRef(null)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)
  const countryRef = useRef(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  const updateField = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (touched[key] || errors[key]) {
        const err = validateField(key, value)
        setErrors((prevErr) => ({ ...prevErr, [key]: err || undefined }))
      }
      return next
    })
  }

  const handleBlur = async (key) => {
    setTouched((prev) => ({ ...prev, [key]: true }))
    const err = validateField(key, form[key])
    if (err) {
      setErrors((prev) => ({ ...prev, [key]: err }))
      return
    }

    if (key === 'finNumber' && form.finNumber && form.finNumber.trim().length === 9) {
      try {
        const check = await api.checkUserExists({ finNumber: form.finNumber.trim().toUpperCase() })
        if (check.exists && check.field === 'finNumber') {
          setErrors((prev) => ({
            ...prev,
            finNumber: check.message || 'User already exists with this FIN number.',
          }))
          return
        }
      } catch (e) {
        console.warn('FIN existence check warning:', e)
      }
    }

    if (key === 'email' && form.email && form.email.includes('@')) {
      try {
        const check = await api.checkUserExists({ email: form.email.trim().toLowerCase() })
        if (check.exists && check.field === 'email') {
          setErrors((prev) => ({
            ...prev,
            email: check.message || 'User already exists with this email address.',
          }))
          return
        }
      } catch (e) {
        console.warn('Email existence check warning:', e)
      }
    }

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
    setCameraError('')
    const capturedImages = []
    
    try {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 300))
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        capturedImages.push(canvas.toDataURL('image/jpeg', 0.86))
      }

      // Check if face is already recognized and registered to an existing user
      try {
        const check = await api.checkUserExists({ faceIdData: capturedImages[0] })
        if (check.exists && check.field === 'faceIdData') {
          setCapturing(false)
          setCameraError(`⚠️ ${check.message || 'User already exists with this Face ID.'}`)
          setErrors((prev) => ({
            ...prev,
            faceIdData: check.message || 'User already exists with this Face ID.',
          }))
          setToast({
            type: 'error',
            text: check.message || 'User already exists with this Face ID.',
          })
          return
        }
      } catch (checkErr) {
        console.warn('Face duplicate check warning:', checkErr)
      }

      setForm((prev) => ({
        ...prev,
        faceIdData: capturedImages[0],
        faceIdDataList: capturedImages,
      }))
      setErrors((prev) => ({ ...prev, faceIdData: undefined }))
      setCapturing(false)
      closeCamera()
      setToast({ type: 'ok', text: 'Face ID verified and captured successfully.' })
    } catch (err) {
      setCapturing(false)
      setCameraError('Failed to capture face biometric data. Please try again.')
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setToast(null)

    // Mark all touched
    const allTouched = Object.keys(emptyTouched).reduce((acc, k) => {
      acc[k] = true
      return acc
    }, {})
    setTouched(allTouched)

    const nextErrors = validateAll(form)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      if (nextErrors.fullName) fullNameRef.current?.focus()
      else if (nextErrors.finNumber) finNumberRef.current?.focus()
      else if (nextErrors.email) emailRef.current?.focus()
      else if (nextErrors.password) passwordRef.current?.focus()
      else if (nextErrors.country) countryRef.current?.focus()
      return
    }

    setSaving(true)
    try {
      const res = await api.registerUser({
        fullName: form.fullName.trim(),
        finNumber: form.finNumber.trim().toUpperCase(),
        preferLanguage: form.preferLanguage,
        email: form.email.trim().toLowerCase(),
        password: form.password,
        country: form.country.trim(),
        faceIdData: form.faceIdDataList || form.faceIdData,
      })
      setForm(emptyForm)
      setTouched(emptyTouched)
      setErrors({})
      setToast({ type: 'ok', text: `${res.user.fullName} registered successfully. You can assign courses in Course Assignments.` })
    } catch (err) {
      const errorMsg = err.message || 'Registration failed.'
      if (errorMsg.toLowerCase().includes('fin number')) {
        setErrors((prev) => ({ ...prev, finNumber: errorMsg }))
        finNumberRef.current?.focus()
      } else if (errorMsg.toLowerCase().includes('face')) {
        setErrors((prev) => ({ ...prev, faceIdData: errorMsg }))
      } else if (errorMsg.toLowerCase().includes('email')) {
        setErrors((prev) => ({ ...prev, email: errorMsg }))
        emailRef.current?.focus()
      }
      setToast({ type: 'error', text: errorMsg })
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
              Full name <span className="text-rose-500">*</span>
            </label>
            <input
              ref={fullNameRef}
              id="fullName"
              value={form.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              onBlur={() => handleBlur('fullName')}
              placeholder="e.g. Prem Sai"
              aria-invalid={!!errors.fullName}
              aria-describedby={errors.fullName ? 'fullName-error' : undefined}
              className={getFieldClass(!!errors.fullName)}
            />
            {errors.fullName && (
              <p id="fullName-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.fullName}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="finNumber" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              FIN number <span className="text-rose-500">*</span>
            </label>
            <input
              ref={finNumberRef}
              id="finNumber"
              maxLength={9}
              value={form.finNumber}
              onChange={(e) => updateField('finNumber', e.target.value.toUpperCase())}
              onBlur={() => handleBlur('finNumber')}
              placeholder="e.g. S1234567A"
              aria-invalid={!!errors.finNumber}
              aria-describedby={errors.finNumber ? 'finNumber-error' : undefined}
              className={getFieldClass(!!errors.finNumber)}
            />
            {errors.finNumber && (
              <p id="finNumber-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.finNumber}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="preferLanguage" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Prefer language <span className="text-rose-500">*</span>
            </label>
            <select
              id="preferLanguage"
              value={form.preferLanguage}
              onChange={(e) => updateField('preferLanguage', e.target.value)}
              onBlur={() => handleBlur('preferLanguage')}
              aria-invalid={!!errors.preferLanguage}
              aria-describedby={errors.preferLanguage ? 'preferLanguage-error' : undefined}
              className={getFieldClass(!!errors.preferLanguage)}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            {errors.preferLanguage && (
              <p id="preferLanguage-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.preferLanguage}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Email <span className="text-rose-500">*</span>
            </label>
            <input
              ref={emailRef}
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              onBlur={() => handleBlur('email')}
              placeholder="user@company.com"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              className={getFieldClass(!!errors.email)}
            />
            {errors.email && (
              <p id="email-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.email}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Password <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                ref={passwordRef}
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                onBlur={() => handleBlur('password')}
                placeholder="Minimum 6 characters"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                className={`${getFieldClass(!!errors.password)} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer border-0 bg-transparent p-1 text-muted transition hover:text-fg"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
            {errors.password && (
              <p id="password-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.password}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="country" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Country <span className="text-rose-500">*</span>
            </label>
            <input
              ref={countryRef}
              id="country"
              value={form.country}
              onChange={(e) => updateField('country', e.target.value)}
              onBlur={() => handleBlur('country')}
              placeholder="e.g. Singapore"
              aria-invalid={!!errors.country}
              aria-describedby={errors.country ? 'country-error' : undefined}
              className={getFieldClass(!!errors.country)}
            />
            {errors.country && (
              <p id="country-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.country}</span>
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Face ID data <span className="text-rose-500">*</span>
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
                className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition ${
                  errors.faceIdData
                    ? 'border-rose-400 bg-rose-500/5 hover:bg-rose-500/10'
                    : 'border-sky/40 bg-sky/5 hover:bg-sky/10'
                }`}
              >
                <span className={`grid h-12 w-12 place-items-center rounded-full ${
                  errors.faceIdData ? 'bg-rose-500/15 text-rose-500' : 'bg-sky/15 text-sky'
                }`}>
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
            {errors.faceIdData && (
              <p role="alert" className="mt-2 flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.faceIdData}</span>
              </p>
            )}
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
                disabled={capturing}
                className="flex-1 cursor-pointer rounded-xl border-0 bg-sky px-3 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {capturing ? 'Verifying & Saving…' : cameraError ? 'Try Again' : 'Capture'}
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
