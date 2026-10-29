import { useEffect, useRef, useState } from 'react'
import logo from '../assets/SkillBridge_AI.png'
import { api } from '../services/api'
import { persistLanguageSelection, readStoredLanguageCode } from '../utils/language'

function restoreLanguageAfterLogin(user) {
  const stored = readStoredLanguageCode()
  if (stored) {
    persistLanguageSelection(stored)
    return
  }
  const fromProfile = user?.preferredLanguage || user?.preferLanguage
  if (fromProfile) {
    persistLanguageSelection(fromProfile)
  }
}

const MailIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 6.75A1.75 1.75 0 0 1 5.75 5h12.5A1.75 1.75 0 0 1 20 6.75v10.5A1.75 1.75 0 0 1 18.25 19H5.75A1.75 1.75 0 0 1 4 17.25V6.75Z"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path d="m5 7 7 5.5L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const LockIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5.25" y="10.5" width="13.5" height="9.25" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M8.25 10.5V8.4a3.75 3.75 0 0 1 7.5 0v2.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
)

const EyeIcon = ({ open }) => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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




const inputClass =
  'w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pr-4 pl-11 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-4 focus:ring-slate-100'

const Login = ({ onSuccess }) => {
  const [mode, setMode] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyCode, setCompanyCode] = useState(
    () => localStorage.getItem('skillbridge_tenant') || 'default'
  )
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [faceState, setFaceState] = useState('idle')
  const [faceCopy, setFaceCopy] = useState('Tap to authenticate with Face ID')
  const abortRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => {
    return () => {
      stopCamera()
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (mode !== 'face') {
      abortRef.current?.abort()
      stopCamera()
      setFaceState('idle')
      setFaceCopy('Tap to authenticate with Face ID')
    }
  }, [mode])

  const [panelHeight, setPanelHeight] = useState(200)
  const passwordRef = useRef(null)
  const faceRef = useRef(null)

  useEffect(() => {
    const activeRef = mode === 'password' ? passwordRef : faceRef
    if (activeRef.current) {
      const handleResize = () => {
        if (activeRef.current) {
          setPanelHeight(activeRef.current.offsetHeight)
        }
      }
      handleResize()
      const observer = new ResizeObserver(handleResize)
      observer.observe(activeRef.current)
      return () => observer.disconnect()
    }
  }, [mode, faceState])

  const wait = (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    })

  const switchMode = (next) => {
    if (next === mode) return
    setMessage(null)
    setMode(next)
  }

  const handlePasswordLogin = async (event) => {
    event.preventDefault()
    setMessage(null)

    const cleanCode = (companyCode || localStorage.getItem('skillbridge_tenant') || 'default').trim().toLowerCase()
    setLoading(true)
    try {
      const res = await api.studentLogin(email.trim(), password, cleanCode)
      const userPayload = JSON.stringify({ user: res.user, token: res.token, loggedInAt: Date.now() })
      sessionStorage.setItem('skillbridge_user', userPayload)
      localStorage.setItem('skillbridge_user', userPayload)
      sessionStorage.setItem('skillbridge_tenant', cleanCode)
      localStorage.setItem('skillbridge_tenant', cleanCode)
      restoreLanguageAfterLogin(res.user)
      onSuccess?.()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Incorrect email or password.' })
    } finally {
      setLoading(false)
    }
  }

  const runFaceId = async () => {
    if (faceState === 'scanning' || faceState === 'success') return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    setFaceState('scanning')
    setFaceCopy('Scanning your face…')
    setMessage(null)

    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 300, height: 300 },
        audio: false,
      })
      if (signal.aborted) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch (err) {
      setFaceState('error')
      setFaceCopy('Camera access denied or unavailable.')
      return
    }

    try {
      // Quick frame stabilization delay for instant face scan
      await wait(420, signal)
      if (signal.aborted) return

      setFaceCopy('Verifying identity…')

      const video = videoRef.current
      if (!video) throw new Error('Video stream is not ready.')

      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 300
      const ctx = canvas.getContext('2d')
      const size = Math.min(video.videoWidth, video.videoHeight)
      const sx = (video.videoWidth - size) / 2
      const sy = (video.videoHeight - size) / 2
      ctx.drawImage(video, sx, sy, size, size, 0, 0, 300, 300)
      const base64Data = canvas.toDataURL('image/jpeg', 0.88)

      const cleanCode = (companyCode || 'default').trim().toLowerCase()
      const res = await api.studentFaceLogin(base64Data, cleanCode)

      const userPayload = JSON.stringify({ user: res.user, token: res.token, loggedInAt: Date.now() })
      sessionStorage.setItem('skillbridge_user', userPayload)
      localStorage.setItem('skillbridge_user', userPayload)
      sessionStorage.setItem('skillbridge_tenant', cleanCode)
      localStorage.setItem('skillbridge_tenant', cleanCode)
      restoreLanguageAfterLogin(res.user)

      setFaceState('success')
      setFaceCopy('Identity verified')
      stopCamera()
      await wait(350, signal)
      if (signal.aborted) return
      onSuccess?.()
    } catch (error) {
      stopCamera()
      if (error?.name === 'AbortError') return
      setFaceState('error')
      setFaceCopy(error.message || 'Verification failed. Tap to try again.')
    }
  }

  return (
    <main className="relative isolate flex min-h-svh w-full items-center justify-center px-5 py-8 bg-slate-50">
      <div className="animate-rise-in flex w-full max-w-[390px] flex-col items-center">
        <header className="mb-6 flex flex-col items-center text-center">
          <img
            src={logo}
            alt="SkillBridge"
            className="animate-logo-in h-8.5 w-auto object-contain"
          />
        </header>

        <section className="animate-rise-in-delay w-full rounded-[24px] border border-slate-100 bg-white px-5 py-7 shadow-[0_8px_30px_rgba(15,23,42,0.04)] sm:px-7 sm:py-8">
          <div className="text-center">
            <h1 className="font-display text-[23px] leading-tight font-bold tracking-tight text-[#0f172a]">
              Welcome back
            </h1>
            <p className="mt-1 text-[13px] leading-snug text-slate-500">
              {mode === 'password' ? 'Log in to continue your learning journey' : 'Log in faster with Face ID'}
            </p>
          </div>

          {/* Sliding pill toggle */}
          <div
            className="mt-7 flex rounded-full bg-slate-100 p-1 gap-1"
            role="tablist"
            aria-label="Sign in method"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'password'}
              onClick={() => switchMode('password')}
              className={`flex-1 cursor-pointer rounded-full py-2.5 text-[14px] font-semibold flex items-center justify-center gap-1.5 border-0 transition-all duration-200 ${mode === 'password'
                ? 'bg-[#0e2246] text-white shadow-sm'
                : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'face'}
              onClick={() => switchMode('face')}
              className={`flex-1 cursor-pointer rounded-full py-2.5 text-[14px] font-semibold flex items-center justify-center gap-1.5 border-0 transition-all duration-200 ${mode === 'face'
                ? 'bg-[#0e2246] text-white shadow-sm'
                : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              Face ID
            </button>
          </div>

          {/* Sliding panels */}
          <div
            className="relative mt-6 overflow-hidden transition-[height] duration-300 ease-out"
            style={{ height: panelHeight }}
          >
            <div
              ref={passwordRef}
              className={`transition-all duration-[550ms] ease-[cubic-bezier(0.25,1,0.5,1)] ${mode === 'password'
                ? 'relative translate-x-0 opacity-100'
                : 'pointer-events-none absolute inset-x-0 top-0 -translate-x-12 opacity-0'
                }`}
            >
              <form className="flex flex-col gap-[14px]" onSubmit={handlePasswordLogin} noValidate>
                <label className="relative block">
                  <span className="sr-only">Email address</span>
                  <span className="pointer-events-none absolute top-1/2 left-[16px] -translate-y-1/2 text-slate-400">
                    <MailIcon />
                  </span>
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </label>

                <label className="relative block">
                  <span className="sr-only">Password</span>
                  <span className="pointer-events-none absolute top-1/2 left-[16px] -translate-y-1/2 text-slate-400">
                    <LockIcon />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute top-1/2 right-3.5 -translate-y-1/2 cursor-pointer border-0 bg-transparent p-1 text-slate-400 transition hover:text-slate-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </label>


                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-0 bg-[#f97316] py-3.5 font-display text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
                >
                  {loading ? 'Signing in…' : 'Sign In →'}
                </button>
              </form>
            </div>

            <div
              ref={faceRef}
              className={`transition-all duration-[550ms] ease-[cubic-bezier(0.25,1,0.5,1)] ${mode === 'face'
                ? 'relative translate-x-0 opacity-100'
                : 'pointer-events-none absolute inset-x-0 top-0 translate-x-12 opacity-0'
                }`}
            >
              <div className="flex flex-col items-center pt-0.5">
                {faceState === 'success' ? (
                  <div className="flex h-[104px] w-[104px] items-center justify-center rounded-full border-[1.5px] border-emerald-500 bg-emerald-500/10 shadow-[0_8px_30px_rgba(16,185,129,0.06)] animate-bracket-breathe">
                    <div className="grid h-11 w-11 place-items-center rounded-full border-[2.5px] border-emerald-500 text-emerald-500">
                      <svg className="h-6 w-6 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={runFaceId}
                    disabled={faceState === 'scanning'}
                    className={`relative grid h-[108px] w-[108px] place-items-center rounded-full border-[1.5px] bg-white transition-all duration-200 overflow-hidden ${faceState === 'error'
                      ? 'border-rose-400 ring-4 ring-rose-500/10'
                      : faceState === 'scanning'
                        ? 'border-[#0e2246] ring-4 ring-[#0e2246]/10 shadow-md'
                        : 'border-[#556987] hover:border-slate-400 shadow-sm hover:scale-[1.01]'
                      } ${faceState === 'idle' || faceState === 'error'
                        ? 'cursor-pointer'
                        : 'cursor-default'
                      }`}
                    aria-label="Authenticate with Face ID"
                  >
                    {faceState === 'scanning' ? (
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className="h-full w-full rounded-full object-cover scale-x-[-1]"
                      />
                    ) : (
                      // Face ID scan icon
                      <svg className="h-7 w-7 text-[#0f213d]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 8.5V7a2 2 0 0 1 2-2h1.5M15.5 5H17a2 2 0 0 1 2 2v1.5M5 15.5V17a2 2 0 0 0 2 2h1.5M19 15.5V17a2 2 0 0 1-2 2h-1.5" />
                      </svg>
                    )}
                  </button>
                )}

                <p className="mt-3 text-center text-[14px] font-semibold text-slate-800">
                  {faceState === 'success'
                    ? 'Identity Verified!'
                    : faceState === 'error'
                      ? 'Authentication failed'
                      : 'Tap to authenticate'}
                </p>
                {faceState === 'scanning' && (
                  <p className="mt-0.5 text-center text-xs text-slate-400">
                    Analyzing face biometrics...
                  </p>
                )}

                <div className="mt-4 w-full rounded-[16px] border border-[#fde3c8] bg-[#fffaf5] px-4 py-3.5 text-center">
                  <p className="text-[12.5px] leading-relaxed text-slate-600">
                    Use Face ID for quick, secure access. Your facial data is securely managed by your device and is never stored.
                  </p>
                </div>

              </div>
            </div>
          </div>

          {message && (
            <p
              className={`mt-4 rounded-[12px] px-3.5 py-2.5 text-center text-[13px] ${message.type === 'ok'
                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                : 'border border-rose-500/20 bg-rose-500/10 text-rose-600'
                }`}
              role="status"
            >
              {message.text}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

export default Login
