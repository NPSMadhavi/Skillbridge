import { useEffect, useRef, useState } from 'react'
import logo from '../assets/SkillBridge_AI.png'
import { api } from '../services/api'

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

const ScanBrackets = ({ active }) => (
  <div className={`absolute inset-[26px] ${active ? 'animate-bracket-breathe' : ''}`} aria-hidden="true">
    <span className="absolute top-0 left-0 h-4.5 w-4.5 rounded-tl-[3px] border-t-[2px] border-l-[2px] border-[#ff8c21]" />
    <span className="absolute top-0 right-0 h-4.5 w-4.5 rounded-tr-[3px] border-t-[2px] border-r-[2px] border-[#ff8c21]" />
    <span className="absolute bottom-0 left-0 h-4.5 w-4.5 rounded-bl-[3px] border-b-[2px] border-l-[2px] border-[#ff8c21]" />
    <span className="absolute right-0 bottom-0 h-4.5 w-4.5 rounded-br-[3px] border-r-[2px] border-b-[2px] border-[#ff8c21]" />
  </div>
)



const inputClass =
  'w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pr-4 pl-11 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-4 focus:ring-slate-100'

const Login = ({ onSuccess }) => {
  const [mode, setMode] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  const [panelHeight, setPanelHeight] = useState(240)
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

    if (!email.trim() || !password) {
      setMessage({ type: 'error', text: 'Enter your email and password to continue.' })
      return
    }

    setLoading(true)
    try {
      const res = await api.studentLogin(email.trim(), password)
      sessionStorage.setItem(
        'skillbridge_user',
        JSON.stringify({ user: res.user, token: res.token, loggedInAt: Date.now() })
      )
      sessionStorage.setItem('skillbridge_language', 'en')
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
      await wait(1800, signal)
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
      const base64Data = canvas.toDataURL('image/jpeg', 0.85)

      const res = await api.studentFaceLogin(base64Data)

      sessionStorage.setItem(
        'skillbridge_user',
        JSON.stringify({ user: res.user, token: res.token, loggedInAt: Date.now() })
      )
      sessionStorage.setItem('skillbridge_language', 'en')

      setFaceState('success')
      setFaceCopy('Identity verified')
      stopCamera()
      await wait(850, signal)
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

                <div className="flex justify-end">
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-[#f97316] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

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
              <div className="flex flex-col items-center pt-1">
                {faceState === 'success' ? (
                  <div className="flex h-[140px] w-[140px] items-center justify-center rounded-full border-[1.5px] border-emerald-500 bg-emerald-500/10 shadow-[0_8px_30px_rgba(16,185,129,0.06)] animate-bracket-breathe">
                    <div className="grid h-14 w-14 place-items-center rounded-full border-[3px] border-emerald-500 text-emerald-500">
                      <svg className="h-8 w-8 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={runFaceId}
                    disabled={faceState === 'scanning'}
                    className={`relative grid h-[140px] w-[140px] place-items-center rounded-full border-[1.5px] bg-white transition-all duration-200 ${faceState === 'error'
                      ? 'border-rose-400 ring-4 ring-rose-500/10'
                      : 'border-[#1d3a67] hover:border-slate-300 shadow-sm hover:scale-[1.01]'
                      } ${faceState === 'idle' || faceState === 'error'
                        ? 'cursor-pointer'
                        : 'cursor-default'
                      }`}
                    aria-label="Authenticate with Face ID"
                  >
                    {faceState === 'scanning' ? (
                      <>
                        <video
                          ref={videoRef}
                          playsInline
                          muted
                          className="absolute inset-[3px] h-[132px] w-[132px] rounded-full object-cover scale-x-[-1]"
                        />
                        <span className="absolute inset-0 animate-ring-pulse rounded-full border border-[#ff8c21]/50" />
                        <ScanBrackets active={true} />
                        <span className="pointer-events-none absolute right-6 left-6 h-0.5 animate-scan-move rounded-full bg-linear-to-r from-transparent via-[#ff8c21] to-transparent" />
                      </>
                    ) : (
                      // Bracket scan icon
                      <svg className="h-9 w-9 text-[#0e2246]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M8 20H6a2 2 0 0 1-2-2v-2M20 16v2a2 2 0 0 1-2 2h-2" />
                      </svg>
                    )}
                  </button>
                )}

                <p className="mt-4 text-center text-sm font-semibold text-slate-700">
                  {faceState === 'success'
                    ? 'Identity Verified!'
                    : faceState === 'error'
                      ? 'Authentication failed'
                      : 'Tap to authenticate'}
                </p>
                <p className="mt-0.5 text-center text-xs text-slate-400">
                  {faceState === 'scanning' ? 'Analyzing face biometrics...' : ''}
                </p>

                {/* Information footer alert card */}
                <div className="mt-4 rounded-xl border border-orange-200 bg-[#fff9f4] px-4 py-3.5 text-center max-w-[310px] shadow-sm">
                  <p className="text-[11.5px] leading-relaxed text-slate-600">
                    Use Face ID for quick, secure access to your learning account. Your facial data is securely managed by your device and is never stored by us.
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
