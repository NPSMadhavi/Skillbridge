import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { api } from '../../services/api'
import CountrySelect from '../../components/CountrySelect'
import FaceEnrollmentModal from '../../components/face/FaceEnrollmentModal'

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
  const [existingFaceUser, setExistingFaceUser] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusBanner, setStatusBanner] = useState(null)
  const [enrollmentModalOpen, setEnrollmentModalOpen] = useState(false)
  const [faceEnrollment, setFaceEnrollment] = useState(null)
  const [courses, setCourses] = useState([])
  const [assignedCourseIds, setAssignedCourseIds] = useState([])
  const [loadingCourses, setLoadingCourses] = useState(false)

  useEffect(() => {
    setLoadingCourses(true)
    api.getCourses(true)
      .then((data) => setCourses(data || []))
      .catch(() => setCourses([]))
      .finally(() => setLoadingCourses(false))
  }, [])

  const fullNameRef = useRef(null)
  const finNumberRef = useRef(null)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)
  const countryRef = useRef(null)

  const formRef = useRef(form)
  formRef.current = form

  const updateField = (key, value) => {
    if (key === 'faceIdData' && !value) {
      setExistingFaceUser(null)
      setFaceEnrollment(null)
    }
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      formRef.current = next
      if (touched[key] || errors[key] || key === 'country') {
        const err = validateField(key, value)
        setErrors((prevErr) => ({ ...prevErr, [key]: err || undefined }))
      }
      return next
    })
    if (key === 'country') {
      setTouched((prev) => ({ ...prev, country: true }))
    }
  }

  const handleBlur = async (key) => {
    setTouched((prev) => ({ ...prev, [key]: true }))
    const err = validateField(key, formRef.current[key])
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

  const handleEnrollmentComplete = (enrollmentResult) => {
    setExistingFaceUser(null)
    setFaceEnrollment(enrollmentResult)
    updateField('faceIdData', enrollmentResult.thumbnailImage)
    setErrors((prev) => ({ ...prev, faceIdData: undefined }))
    toast.success('Live Face ID enrolled and liveness verified!')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setStatusBanner(null)

    // Mark all touched
    const allTouched = Object.keys(emptyTouched).reduce((acc, k) => {
      acc[k] = true
      return acc
    }, {})
    setTouched(allTouched)

    if (existingFaceUser) {
      const errMsg = `Cannot register user: This face is already enrolled to ${existingFaceUser.fullName || 'an existing user'}.`
      setErrors((prev) => ({ ...prev, faceIdData: errMsg }))
      toast.error(errMsg)
      return
    }

    const nextErrors = validateAll(form)
    if (existingFaceUser) {
      nextErrors.faceIdData = `Face already enrolled to ${existingFaceUser.fullName || 'an existing user'}.`
    }
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      toast.warn('Please resolve all validation errors before submitting.')
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
        faceIdData: form.faceIdData,
        faceEnrollment: faceEnrollment,
        assignedCourseIds,
      })
      setForm(emptyForm)
      setFaceEnrollment(null)
      setAssignedCourseIds([])
      setTouched(emptyTouched)
      setExistingFaceUser(null)
      setErrors({})
      toast.success(`${res.user.fullName} registered successfully!`)
      setStatusBanner({ type: 'ok', text: `${res.user.fullName} registered successfully with ${assignedCourseIds.length} course(s) assigned.` })
    } catch (err) {
      const errorMsg = err.message || 'Registration failed.'
      if (err.matchedUser || errorMsg.toLowerCase().includes('already exists') || errorMsg.toLowerCase().includes('already registered')) {
        setExistingFaceUser(err.matchedUser || { fullName: 'Registered User' })
        setErrors((prev) => ({ ...prev, faceIdData: errorMsg }))
      } else if (errorMsg.toLowerCase().includes('face') || errorMsg.toLowerCase().includes('biometric')) {
        setExistingFaceUser(null)
        setErrors((prev) => ({ ...prev, faceIdData: errorMsg }))
      } else if (errorMsg.toLowerCase().includes('fin number')) {
        setErrors((prev) => ({ ...prev, finNumber: errorMsg }))
        finNumberRef.current?.focus()
      } else if (errorMsg.toLowerCase().includes('email')) {
        setErrors((prev) => ({ ...prev, email: errorMsg }))
        emailRef.current?.focus()
      }
      toast.error(errorMsg)
      setStatusBanner({ type: 'error', text: errorMsg })
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
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit} noValidate autoComplete="off">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="fullName" className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Full name <span className="text-rose-500">*</span>
            </label>
            <input
              ref={fullNameRef}
              id="fullName"
              name="fullName"
              autoComplete="off"
              value={form.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              onBlur={() => handleBlur('fullName')}
              placeholder="Enter full name"
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
              name="finNumber"
              autoComplete="off"
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
              name="new_user_email"
              autoComplete="new-password"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              onBlur={() => handleBlur('email')}
              placeholder="Enter email"
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
                name="new_user_password"
                autoComplete="new-password"
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
            <CountrySelect
              ref={countryRef}
              id="country"
              value={form.country}
              onChange={(val) => updateField('country', val)}
              onBlur={() => handleBlur('country')}
              hasError={!!errors.country}
              placeholder="Search or select country..."
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
              existingFaceUser ? (
                <div className="flex flex-col gap-3.5 rounded-2xl border-2 border-rose-500/50 bg-rose-500/10 p-4.5 animate-fade-in shadow-sm">
                  <div className="flex items-center gap-2 text-rose-500 font-semibold text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white font-bold text-xs">
                      !
                    </span>
                    <span>Face already registered in system</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                    <div className="relative shrink-0">
                      <img
                        src={form.faceIdData}
                        alt="Captured Face ID"
                        className="h-24 w-24 rounded-xl object-cover border-2 border-rose-500/50 shadow-sm"
                      />
                      <span className="absolute bottom-1 right-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                        Captured
                      </span>
                    </div>

                    {existingFaceUser.faceImage && (
                      <div className="relative shrink-0 hidden sm:block">
                        <img
                          src={existingFaceUser.faceImage}
                          alt={existingFaceUser.fullName || 'Existing User'}
                          className="h-24 w-24 rounded-xl object-cover border-2 border-rose-500/50 opacity-90 shadow-sm"
                        />
                        <span className="absolute bottom-1 right-1 rounded-md bg-navy/90 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                          Enrolled
                        </span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-rose-500 text-base">
                        Matched: {existingFaceUser.fullName || 'Registered User'}
                      </h4>
                      <p className="mt-0.5 text-xs text-muted">
                        FIN: <span className="font-mono font-medium text-fg">{existingFaceUser.finNumber || 'N/A'}</span>
                        {existingFaceUser.email && (
                          <> • Email: <span className="text-fg">{existingFaceUser.email}</span></>
                        )}
                      </p>
                      <p className="mt-1.5 text-xs text-rose-400 font-medium leading-relaxed">
                        ⚠️ This face is already enrolled. A new account cannot be registered with an existing user's face.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExistingFaceUser(null)
                            setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                            openCamera()
                          }}
                          className="cursor-pointer rounded-lg border border-rose-500/40 bg-rose-500/20 px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/30 transition"
                        >
                          Recapture Face
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            updateField('faceIdData', '')
                            setExistingFaceUser(null)
                            setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                          }}
                          className="cursor-pointer rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-semibold text-fg hover:border-sky/40 transition"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-2xl border border-ok/25 bg-ok/5 p-4 sm:flex-row sm:items-center">
                  <div className="relative">
                    <img
                      src={form.faceIdData}
                      alt="Enrolled Face ID"
                      className="h-24 w-24 rounded-xl object-cover shadow-sm border border-ok/30"
                    />
                    <span className="absolute -bottom-1 -right-1 bg-ok text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow">
                      ✓ LIVE
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ok">Face ID Enrolled</p>
                      <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                        3D Liveness Verified
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      5-point pose challenge completed and biometrics cryptographically signed.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setExistingFaceUser(null)
                          setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                          setEnrollmentModalOpen(true)
                        }}
                        className="cursor-pointer rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-semibold text-fg hover:border-sky/40 transition"
                      >
                        Recapture
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateField('faceIdData', '')
                          setFaceEnrollment(null)
                          setExistingFaceUser(null)
                          setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                        }}
                        className="cursor-pointer rounded-lg border border-danger/25 bg-danger/5 px-3 py-1.5 text-sm font-semibold text-danger transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <button
                type="button"
                onClick={() => {
                  setExistingFaceUser(null)
                  setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                  setEnrollmentModalOpen(true)
                }}
                className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed px-4 py-8 text-center transition ${
                  errors.faceIdData
                    ? 'border-rose-400 bg-rose-500/5 hover:bg-rose-500/10'
                    : 'border-sky/40 bg-sky/5 hover:bg-sky/10'
                }`}
              >
                <span
                  className={`grid h-12 w-12 place-items-center rounded-full ${
                    errors.faceIdData ? 'bg-rose-500/15 text-rose-500' : 'bg-sky/15 text-sky'
                  }`}
                >
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
                <div>
                  <span className="font-display font-semibold text-fg block">
                    Start Guided Face Enrollment
                  </span>
                  <span className="text-xs text-muted block mt-0.5">
                    Real-time webcam 5-pose liveness challenge (MediaPipe Face Landmarker)
                  </span>
                </div>
              </button>
            )}
            {errors.faceIdData && !existingFaceUser && (
              <p role="alert" className="mt-2 flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.faceIdData}</span>
              </p>
            )}
          </div>

          {/* Course Assignment Section */}
          <div className="sm:col-span-2 rounded-2xl border border-line bg-panel p-4.5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[0.75rem] font-semibold tracking-[0.08em] text-muted uppercase">
                  Assign Courses (Optional)
                </p>
                <p className="text-xs text-muted mt-0.5">
                  Select which courses this learner can access immediately upon registration.
                </p>
              </div>
              {courses.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setAssignedCourseIds(courses.map(c => c.id))}
                    className="text-sky hover:underline cursor-pointer border-0 bg-transparent font-semibold"
                  >
                    Select all
                  </button>
                  <span className="text-muted">•</span>
                  <button
                    type="button"
                    onClick={() => setAssignedCourseIds([])}
                    className="text-muted hover:text-fg cursor-pointer border-0 bg-transparent font-medium"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {loadingCourses ? (
              <div className="py-4 text-center text-xs text-muted">Loading courses catalog...</div>
            ) : courses.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted">
                No courses published yet. You can create courses in Course Manager.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                {courses.map((c) => {
                  const isChecked = assignedCourseIds.includes(c.id);
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setAssignedCourseIds(prev =>
                          prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                        );
                      }}
                      className={`flex items-start gap-2.5 p-3 rounded-xl border transition cursor-pointer select-none ${
                        isChecked
                          ? 'border-sky/60 bg-sky/5 shadow-xs'
                          : 'border-line bg-ink/30 hover:border-line/90'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          setAssignedCourseIds(prev =>
                            prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                          );
                        }}
                        className="mt-0.5 h-4 w-4 rounded text-sky focus:ring-sky/40 border-line cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-semibold leading-tight truncate ${isChecked ? 'text-sky' : 'text-fg'}`}>
                          {c.title}
                        </p>
                        <p className="text-[10px] text-muted line-clamp-1 mt-0.5">
                          {c.description || 'AI training course'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted">
              {assignedCourseIds.length} course{assignedCourseIds.length === 1 ? '' : 's'} selected
            </p>
          </div>

          {statusBanner && (
            <p
              className={`sm:col-span-2 rounded-[10px] px-3.5 py-2.5 text-center text-sm ${
                statusBanner.type === 'ok'
                  ? 'border border-ok/25 bg-ok/10 text-ok'
                  : 'border border-danger/25 bg-danger/10 text-danger'
              }`}
              role="status"
            >
              {statusBanner.text}
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

      {/* Guided 5-Pose Real-Time Face Enrollment Modal */}
      <FaceEnrollmentModal
        isOpen={enrollmentModalOpen}
        onClose={() => setEnrollmentModalOpen(false)}
        onEnrollmentComplete={handleEnrollmentComplete}
      />
    </div>
  )
}

export default RegisterUser
