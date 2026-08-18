import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logo from '../../assets/SkillBridge_AI.png'
import { api } from '../../services/api'

const fieldClass =
  'w-full rounded-xl border border-line bg-ink/60 px-4 py-3.5 text-[0.98rem] text-fg outline-none transition placeholder:text-muted/60 hover:border-sky/40 focus:border-sky focus:bg-panel focus:shadow-[0_0_0_3px_rgba(2,132,199,0.14)]'

const AdminLogin = () => {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    setLoading(true)
    try {
      const data = await api.adminLogin(email.trim(), password)
      sessionStorage.setItem(
        'skillbridge_admin',
        JSON.stringify({ email: data.admin.email, token: data.token, loggedInAt: Date.now() }),
      )
      navigate('/admin/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Incorrect admin email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative isolate grid min-h-svh w-full place-items-center overflow-hidden bg-ink px-5 py-8 text-fg sm:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_18%_12%,rgba(14,47,92,0.12),transparent_60%),radial-gradient(ellipse_50%_40%_at_88%_78%,rgba(240,106,0,0.1),transparent_55%),linear-gradient(165deg,#f8fbff_0%,#eef4fb_48%,#f3f7fc_100%)]" />
      </div>

      <div className="animate-rise-in flex w-full max-w-[440px] flex-col items-center gap-6">
        <header className="w-full text-center">
          <img
            className="mx-auto block h-auto w-[min(280px,88%)] rounded-2xl shadow-[0_16px_40px_rgba(15,27,45,0.12)]"
            src={logo}
            alt="SkillBridge"
          />
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-navy/15 bg-navy/5 px-3 py-1 text-[0.72rem] font-semibold tracking-[0.14em] text-navy uppercase">
            Admin portal
          </p>
          <p className="mt-3 font-display text-[0.98rem] text-muted">
            Sign in to register users and manage Face ID enrollment.
          </p>
        </header>

        <section className="w-full rounded-[18px] border border-line bg-panel p-5 shadow-[0_20px_50px_rgba(15,27,45,0.08)] sm:p-7">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-2 text-left">
              <label htmlFor="admin-email" className="text-[0.78rem] font-semibold tracking-[0.08em] text-muted uppercase">
                Admin email
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                placeholder="admin@skillbridge.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
              />
            </div>

            <div className="flex flex-col gap-2 text-left">
              <label htmlFor="admin-password" className="text-[0.78rem] font-semibold tracking-[0.08em] text-muted uppercase">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
              />
            </div>

            {error && (
              <p className="rounded-[10px] border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-center text-[0.88rem] text-danger" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full cursor-pointer rounded-xl border-0 bg-navy px-4 py-3.5 font-display text-base font-semibold text-white shadow-[0_10px_28px_rgba(14,47,92,0.22)] transition hover:bg-[#143a6b] disabled:cursor-wait disabled:opacity-70"
            >
              {loading ? 'Signing in…' : 'Admin sign in'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}

export default AdminLogin
