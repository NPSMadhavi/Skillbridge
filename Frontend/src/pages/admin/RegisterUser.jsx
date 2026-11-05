import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { api } from '../../services/api'
import CountrySelect from '../../components/CountrySelect'
import { applyCountryDialCode, getCountryDialCode, getCountry } from '../../data/countries'
import FaceEnrollmentModal from '../../components/face/FaceEnrollmentModal'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (中文)' },
  { value: 'ms', label: 'Malay (Bahasa Melayu)' },
  { value: 'ta', label: 'Tamil (தமிழ்)' },
  { value: 'bn', label: 'Bangla (বাংলা)' },
  { value: 'te', label: 'Telugu (తెలుగు)' },
]

const ExclamationCircleIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      clipRule="evenodd"
    />
  </svg>
)

const EyeIcon = ({ open }) =>
  open ? (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ) : (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.775M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  )

const getFieldClass = (hasError) =>
  `w-full rounded-xl border bg-ink/50 px-3.5 py-2 text-[0.875rem] text-fg outline-none transition placeholder:text-muted/60 focus:bg-panel ${
    hasError
      ? 'border-rose-400 focus:border-rose-500 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]'
      : 'border-line hover:border-sky/40 focus:border-sky focus:shadow-[0_0_0_3px_rgba(2,132,199,0.14)]'
  }`

const emptyForm = {
  fullName: '',
  finNumber: '',
  email: '',
  phone: '',
  preferLanguage: 'en',
  password: '',
  country: '',
  faceIdData: '',
}

const emptyTouched = {
  fullName: false,
  finNumber: false,
  email: false,
  phone: false,
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
    case 'phone': {
      const trimmed = (val || '').trim()
      if (!trimmed) return 'Mobile number is required.'
      const digitsOnly = trimmed.replace(/\D/g, '')
      if (digitsOnly.length < 6) {
        return 'Enter a valid mobile number with at least 6 digits.'
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

  const fullNameRef = useRef(null)
  const finNumberRef = useRef(null)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)
  const countryRef = useRef(null)
  const phoneRef = useRef(null)

  const formRef = useRef(form)
  formRef.current = form

  const updateField = (key, value) => {
    if (key === 'faceIdData' && !value) {
      setExistingFaceUser(null)
      setFaceEnrollment(null)
    }

    if (key === 'country') {
      const nextCountry = value || ''
      setTouched((prev) => ({ ...prev, country: true }))
      setForm((prev) => {
        // Automatically add or update dial code when country changes
        const nextPhone = applyCountryDialCode(prev.phone, nextCountry)
        const next = { ...prev, country: nextCountry, phone: nextPhone }
        formRef.current = next

        const countryErr = validateField('country', nextCountry)
        const phoneErr = (touched.phone || errors.phone) ? validateField('phone', nextPhone) : undefined
        setErrors((prevErr) => ({
          ...prevErr,
          country: countryErr || undefined,
          phone: phoneErr || undefined,
        }))
        return next
      })
      return
    }

    setForm((prev) => {
      const next = { ...prev, [key]: value }
      formRef.current = next
      if (touched[key] || errors[key] || key === 'finNumber') {
        const err = validateField(key, value)
        setErrors((prevErr) => ({ ...prevErr, [key]: err || undefined }))
      }
      return next
    })
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
  }

  const handleEnrollmentComplete = (enrollmentResult) => {
    const primaryFace = enrollmentResult.thumbnailImage
    setFaceEnrollment(enrollmentResult)
    setExistingFaceUser(null)
    updateField('faceIdData', primaryFace)
    setErrors((prev) => ({ ...prev, faceIdData: undefined }))
    toast.success('Face biometric vector captured successfully!')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
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
      else if (nextErrors.phone) phoneRef.current?.focus()
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
        phone: form.phone.trim(),
        faceIdData: form.faceIdData,
        faceEnrollment: faceEnrollment,
      })
      setForm(emptyForm)
      setFaceEnrollment(null)
      setTouched(emptyTouched)
      setExistingFaceUser(null)
      setErrors({})
      toast.success(`${res.user.fullName} registered successfully!`)
      setStatusBanner({ type: 'ok', text: `${res.user.fullName} registered successfully.` })
    } catch (err) {
      const errorMsg = err.message || 'Registration failed.'
      if (err.matchedUser || errorMsg.toLowerCase().includes('already exists') || errorMsg.toLowerCase().includes('already registered')) {
        setExistingFaceUser(err.matchedUser || { fullName: 'Registered User' })
        setErrors((prev) => ({ ...prev, faceIdData: errorMsg }))
      } else if (errorMsg.toLowerCase().includes('face') || errorMsg.toLowerCase().includes('biometric')) {
        setExistingFaceUser(null)
        setErrors((prev) => ({ ...prev, faceIdData: errorMsg }))
      } else if (errorMsg.toLowerCase().includes('fin number') || errorMsg.toLowerCase().includes('fin')) {
        setErrors((prev) => ({ ...prev, finNumber: errorMsg }))
        finNumberRef.current?.focus()
      } else if (errorMsg.toLowerCase().includes('email')) {
        setErrors((prev) => ({ ...prev, email: errorMsg }))
        emailRef.current?.focus()
      } else if (errorMsg.toLowerCase().includes('phone') || errorMsg.toLowerCase().includes('mobile')) {
        setErrors((prev) => ({ ...prev, phone: errorMsg }))
        phoneRef.current?.focus()
      }
      toast.error(errorMsg)
      setStatusBanner({ type: 'error', text: errorMsg })
    } finally {
      setSaving(false)
    }
  }

  const selectedCountryInfo = form.country ? getCountry(form.country) : null

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-fg">
          Register user
        </h1>
        <p className="mt-0.5 text-xs text-muted">
          Add a learner with FIN, country, mobile number, contact details, and Face ID enrollment.
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5 shadow-sm">
        <form className="grid gap-3.5 sm:grid-cols-2" onSubmit={handleSubmit} noValidate autoComplete="off">
          {/* Row 1: Full Name & FIN Number */}
          <div className="flex flex-col gap-1">
            <label htmlFor="fullName" className="text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
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

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="finNumber" className="text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
                FIN number <span className="text-rose-500">*</span>
              </label>
              <span
                className={`font-mono text-[11px] ${
                  form.finNumber.length === 9
                    ? 'text-ok font-semibold'
                    : form.finNumber.length > 0
                    ? 'text-sky'
                    : 'text-muted'
                }`}
              >
                {form.finNumber.length}/9 chars
              </span>
            </div>
            <input
              ref={finNumberRef}
              id="finNumber"
              name="finNumber"
              autoComplete="off"
              maxLength={9}
              value={form.finNumber}
              onChange={(e) =>
                updateField('finNumber', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9))
              }
              onBlur={() => handleBlur('finNumber')}
              placeholder="e.g. S1234567A"
              aria-invalid={!!errors.finNumber}
              aria-describedby={errors.finNumber ? 'finNumber-error' : undefined}
              className={`${getFieldClass(!!errors.finNumber)} font-mono tracking-wider`}
            />
            {errors.finNumber ? (
              <p id="finNumber-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.finNumber}</span>
              </p>
            ) : (
              <p className="text-[11px] text-muted pl-0.5">
                Fixed 9-character format (e.g. S1234567A, F1234567M)
              </p>
            )}
          </div>

          {/* Row 2: Email & Password */}
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
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

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
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

          {/* Row 3: Country & Mobile Number */}
          <div className="flex flex-col gap-1">
            <label htmlFor="country" className="text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
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

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="phone" className="text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
                Mobile number <span className="text-rose-500">*</span>
              </label>
              {selectedCountryInfo && (
                <span className="text-[11px] font-mono text-sky flex items-center gap-1">
                  <span>{selectedCountryInfo.flag}</span>
                  <span className="font-semibold">{selectedCountryInfo.dialCode}</span>
                </span>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                ref={phoneRef}
                id="phone"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                onBlur={() => handleBlur('phone')}
                placeholder={
                  selectedCountryInfo
                    ? `e.g. ${selectedCountryInfo.dialCode} 9123 4567`
                    : 'Select country to auto-add code (e.g. +65, +91)'
                }
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                className={getFieldClass(!!errors.phone)}
              />
            </div>
            {errors.phone ? (
              <p id="phone-error" role="alert" className="flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.phone}</span>
              </p>
            ) : (
              <p className="text-[11px] text-muted pl-0.5">
                {selectedCountryInfo
                  ? `Dial code (${selectedCountryInfo.dialCode}) applied for ${selectedCountryInfo.name}.`
                  : 'Select country above to auto-add dial code (e.g. +65, +91).'}
              </p>
            )}
          </div>

          {/* Row 4: Prefer Language */}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="preferLanguage" className="text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
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

          {/* Face ID Section */}
          <div className="sm:col-span-2">
            <p className="mb-1 text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
              Face ID data <span className="text-rose-500">*</span>
            </p>

            {form.faceIdData ? (
              existingFaceUser ? (
                <div className="flex flex-col gap-2 rounded-xl border-2 border-rose-500/50 bg-rose-500/10 p-3 animate-fade-in shadow-sm">
                  <div className="flex items-center gap-2 text-rose-500 font-semibold text-xs">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white font-bold text-[10px]">
                      !
                    </span>
                    <span>Face already registered in system</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    {existingFaceUser.faceImage && (
                      <div className="relative shrink-0">
                        <img
                          src={existingFaceUser.faceImage}
                          alt="Existing User Face"
                          className="h-16 w-16 rounded-lg object-cover border border-rose-500/30 shadow-sm"
                        />
                        <span className="absolute -bottom-1 -right-1 bg-rose-500 text-[9px] text-white font-bold px-1 rounded shadow">
                          MATCH
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-fg">
                        {existingFaceUser.fullName || 'Registered User'}
                      </p>
                      <p className="text-[11px] text-muted truncate">
                        Email: <span className="font-medium text-fg">{existingFaceUser.email || 'N/A'}</span>
                      </p>
                      <p className="text-[11px] text-muted truncate">
                        FIN: <span className="font-mono font-medium text-fg">{existingFaceUser.finNumber || 'N/A'}</span>
                      </p>
                    </div>
                  </div>

                  <p className="text-[11px] text-rose-400">
                    A user cannot be registered with a face that is already enrolled in the system. Please scan the correct person or remove the capture.
                  </p>

                  <div className="flex items-center gap-2 pt-1 border-t border-rose-500/20">
                    <button
                      type="button"
                      onClick={() => {
                        setExistingFaceUser(null)
                        setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                        setEnrollmentModalOpen(true)
                      }}
                      className="cursor-pointer rounded-lg bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-400 hover:bg-rose-500/30 transition"
                    >
                      Scan Again
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateField('faceIdData', '')
                        setFaceEnrollment(null)
                        setExistingFaceUser(null)
                        setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                      }}
                      className="cursor-pointer rounded-lg bg-transparent px-3 py-1 text-xs font-semibold text-muted hover:text-fg transition"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-ok/30 bg-ok/5 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={form.faceIdData}
                      alt="Enrolled Face"
                      className="h-12 w-12 rounded-lg object-cover border border-ok/40 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold text-ok truncate">Face ID Enrolled</p>
                        <span className="rounded bg-ok/15 px-1.5 py-0.2 text-[10px] font-bold text-ok">
                          ✓ Ready
                        </span>
                      </div>
                      <p className="text-[11px] text-muted truncate">
                        Biometric face capture saved successfully.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setExistingFaceUser(null)
                        setErrors((prev) => ({ ...prev, faceIdData: undefined }))
                        setEnrollmentModalOpen(true)
                      }}
                      className="cursor-pointer rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-semibold text-fg hover:border-sky/40 transition"
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
                      className="cursor-pointer rounded-lg border border-danger/25 bg-danger/5 px-2.5 py-1 text-xs font-semibold text-danger transition"
                    >
                      Remove
                    </button>
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
                className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed px-3.5 py-2.5 text-left transition ${
                  errors.faceIdData
                    ? 'border-rose-400 bg-rose-500/5 hover:bg-rose-500/10'
                    : 'border-sky/40 bg-sky/5 hover:bg-sky/10'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                      errors.faceIdData ? 'bg-rose-500/15 text-rose-500' : 'bg-sky/15 text-sky'
                    }`}
                  >
                    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
                  <div className="min-w-0">
                    <span className="font-display text-xs sm:text-sm font-semibold text-fg block truncate">
                      Enroll Face ID
                    </span>
                    <span className="text-[11px] text-muted block truncate">
                      Quick 5-step face capture via webcam
                    </span>
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-sky px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-105">
                  Start Scan
                </span>
              </button>
            )}
            {errors.faceIdData && !existingFaceUser && (
              <p role="alert" className="mt-1 flex items-center gap-1.5 pl-0.5 text-xs text-rose-500 font-medium animate-fade-in">
                <ExclamationCircleIcon />
                <span>{errors.faceIdData}</span>
              </p>
            )}
          </div>

          {statusBanner && (
            <p
              className={`sm:col-span-2 rounded-[10px] px-3 py-2 text-center text-xs ${
                statusBanner.type === 'ok'
                  ? 'border border-ok/25 bg-ok/10 text-ok'
                  : 'border border-danger/25 bg-danger/10 text-danger'
              }`}
              role="status"
            >
              {statusBanner.text}
            </p>
          )}

          <div className="sm:col-span-2 flex flex-col gap-2.5 sm:flex-row mt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 cursor-pointer rounded-xl border-0 bg-orange px-4 py-2.5 font-display text-sm font-semibold text-white shadow-[0_6px_20px_rgba(240,106,0,0.22)] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-70"
            >
              {saving ? 'Registering…' : 'Register user'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/users')}
              className="cursor-pointer rounded-xl border border-line bg-ink px-4 py-2.5 text-sm font-semibold text-fg transition hover:border-sky/40"
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
