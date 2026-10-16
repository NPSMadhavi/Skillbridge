import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../../assets/SkillBridge_AI.png';
import { api } from '../../services/api';

const MailIcon = () => (
  <svg className="h-5 w-5 text-[#8aa5ca]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 6.75A1.75 1.75 0 0 1 5.75 5h12.5A1.75 1.75 0 0 1 20 6.75v10.5A1.75 1.75 0 0 1 18.25 19H5.75A1.75 1.75 0 0 1 4 17.25V6.75Z"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path d="m5 7 7 5.5L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LockIcon = () => (
  <svg className="h-5 w-5 text-[#8aa5ca]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5.25" y="10.5" width="13.5" height="9.25" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M8.25 10.5V8.4a3.75 3.75 0 0 1 7.5 0v2.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

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
);

export default function SuperAdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);

    try {
      const res = await api.superAdminLogin(email.trim(), password);
      sessionStorage.setItem(
        'skillbridge_super_admin',
        JSON.stringify({
          token: res.token,
          superAdmin: res.superAdmin,
          loggedInAt: Date.now()
        })
      );
      navigate('/super-admin');
    } catch (err) {
      setError(err.message || 'Invalid Super Admin credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#f8fafc] flex flex-col items-center justify-center px-4 py-8 font-sans">
      <div className="w-full max-w-[420px] flex flex-col items-center">
        {/* Brand Logo */}
        <header className="mb-7 flex flex-col items-center text-center">
          <img
            src={logo}
            alt="SkillBridge"
            className="h-9 w-auto object-contain"
          />
        </header>

        {/* Login Card */}
        <section className="w-full bg-white rounded-[28px] border border-slate-100 p-7 sm:p-9 shadow-[0_12px_45px_rgba(15,23,42,0.06)]">
          <div className="text-center">
            <h1 className="text-[25px] font-bold tracking-tight text-[#0f172a]">
              Welcome back
            </h1>
            <p className="mt-1 text-[13.5px] leading-snug text-slate-500">
              Log in to Super Admin Control Panel
            </p>
          </div>

          {error && (
            <div className="mt-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[13px] flex items-center space-x-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5" noValidate>
            {/* Email Field with Soft Light-Blue Fill */}
            <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
              <span className="pointer-events-none shrink-0">
                <MailIcon />
              </span>
              <input
                type="email"
                required
                autoComplete="username"
                placeholder="admin@skillbridge.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 focus:outline-none"
              />
            </div>

            {/* Password Field with Soft Light-Blue Fill & Show/Hide Eye */}
            <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
              <span className="pointer-events-none shrink-0">
                <LockIcon />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 pr-2 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="shrink-0 p-1 text-[#8aa5ca] hover:text-slate-600 transition-colors cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>

            {/* Vibrant Orange Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full py-3.5 px-4 rounded-2xl bg-[#f06400] hover:bg-[#e05800] active:scale-[0.99] text-white font-semibold text-[14.5px] shadow-[0_8px_20px_rgba(240,100,0,0.28)] transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center space-x-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Signing in…</span>
                </span>
              ) : (
                <span>Sign In →</span>
              )}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
