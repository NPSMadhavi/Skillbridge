import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
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

const BuildingIcon = () => (
  <svg className="h-5 w-5 text-[#8aa5ca]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const KeyIcon = () => (
  <svg className="h-5 w-5 text-[#8aa5ca]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="8" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
    <path d="m12 12 8 0m-3-3v3m3-3v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const ShieldCheckIcon = () => (
  <svg className="h-5 w-5 text-[#f06400]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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

export default function AdminLogin() {
  const navigate = useNavigate();

  // Mode: 'login' | 'forgot' | 'reset' | 'initial-password'
  const [mode, setMode] = useState('login');

  // Login form state
  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password & reset state
  const [resetEmail, setResetEmail] = useState('');
  const [resetCompanyCode, setResetCompanyCode] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // System-generated initial password change state
  const [pendingAdmin, setPendingAdmin] = useState(null);
  const [initialNewPassword, setInitialNewPassword] = useState('');
  const [initialConfirmPassword, setInitialConfirmPassword] = useState('');
  const [showInitialNewPassword, setShowInitialNewPassword] = useState(false);

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Handle Login
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please provide your admin email and password.');
      return;
    }

    setLoading(true);

    try {
      const data = await api.adminLogin(email.trim(), password, companyCode.trim() || null);

      // If the password is a system-generated password, redirect to set permanent password screen!
      if (data.mustChangePassword) {
        setPendingAdmin(data);
        setInitialNewPassword('');
        setInitialConfirmPassword('');
        setError(null);
        setSuccessMsg(null);
        setMode('initial-password');
        toast.info('System-generated password detected. Please set your new permanent password to continue.');
        return;
      }

      const resolvedTenant = data.tenant?.code || data.tenant?.slug || 'default';
      const companyName = data.tenant?.name || null;

      sessionStorage.setItem(
        'skillbridge_admin',
        JSON.stringify({
          email: data.admin?.email || email.trim(),
          fullName: data.admin?.fullName || 'Admin',
          token: data.token,
          tenant: resolvedTenant,
          slug: resolvedTenant,
          companyName: companyName,
          loggedInAt: Date.now(),
        })
      );
      sessionStorage.setItem('skillbridge_tenant', resolvedTenant);
      localStorage.setItem('skillbridge_tenant', resolvedTenant);

      toast.success(`Welcome back, ${data.admin?.fullName || 'Admin'}!`);
      setTimeout(() => {
        navigate('/admin/dashboard', { replace: true });
      }, 400);
    } catch (err) {
      const msg = err.message || 'Incorrect admin email or password.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Request Reset Code
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!resetEmail.trim()) {
      setError('Please enter your admin email address.');
      return;
    }

    setLoading(true);

    try {
      const res = await api.adminForgotPassword(
        resetEmail.trim(),
        resetCompanyCode.trim() || null
      );
      setSuccessMsg(res.message || 'Verification code sent to your email.');
      toast.success('6-digit verification code sent to your email!');
      // Move to step 2: Enter code & new password
      setMode('reset');
    } catch (err) {
      const msg = err.message || 'Failed to send reset code.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Reset Password Submit (From Forgot Password)
  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!verificationCode.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);

    try {
      const res = await api.adminResetPassword({
        email: resetEmail.trim(),
        companyCode: resetCompanyCode.trim() || null,
        code: verificationCode.trim(),
        newPassword,
      });

      toast.success(res.message || 'Password has been updated! You can now log in.');
      setEmail(resetEmail.trim());
      if (resetCompanyCode.trim()) {
        setCompanyCode(resetCompanyCode.trim());
      }
      setPassword('');
      setMode('login');
      setSuccessMsg('Password reset successful. Please sign in with your new password.');
    } catch (err) {
      const msg = err.message || 'Failed to reset password.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Initial Password Setup Submit (For system-generated passwords)
  const handleInitialPasswordSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!initialNewPassword || initialNewPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (initialNewPassword !== initialConfirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);

    try {
      const res = await api.adminSetInitialPassword({
        email: pendingAdmin?.admin?.email || email.trim(),
        companyCode: pendingAdmin?.tenant?.code || companyCode.trim() || null,
        tempToken: pendingAdmin?.tempToken || null,
        newPassword: initialNewPassword,
      });

      const resolvedTenant = res.tenant?.code || res.tenant?.slug || 'default';
      const companyName = res.tenant?.name || null;

      sessionStorage.setItem(
        'skillbridge_admin',
        JSON.stringify({
          email: res.admin?.email || email.trim(),
          fullName: res.admin?.fullName || 'Admin',
          token: res.token,
          tenant: resolvedTenant,
          slug: resolvedTenant,
          companyName: companyName,
          loggedInAt: Date.now(),
        })
      );
      sessionStorage.setItem('skillbridge_tenant', resolvedTenant);
      localStorage.setItem('skillbridge_tenant', resolvedTenant);

      toast.success('Permanent password set successfully! Welcome to SkillBridge.');
      setTimeout(() => {
        navigate('/admin/dashboard', { replace: true });
      }, 400);
    } catch (err) {
      const msg = err.message || 'Failed to update permanent password.';
      setError(msg);
      toast.error(msg);
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
            className="h-9 w-auto object-contain cursor-pointer"
            onClick={() => navigate('/')}
          />
        </header>

        {/* Card */}
        <section className="w-full bg-white rounded-[28px] border border-slate-100 p-7 sm:p-9 shadow-[0_12px_45px_rgba(15,23,42,0.06)]">
          {/* Header Title based on Mode */}
          {mode === 'login' && (
            <div className="text-center">
              <h1 className="text-[25px] font-bold tracking-tight text-[#0f172a]">
                Welcome back
              </h1>
              <p className="mt-1 text-[13.5px] leading-snug text-slate-500">
                Log in to Company Admin Portal
              </p>
            </div>
          )}

          {mode === 'initial-password' && (
            <div className="text-center">
              <div className="mx-auto w-10 h-10 rounded-2xl bg-orange-50 border border-orange-200/60 flex items-center justify-center mb-3">
                <ShieldCheckIcon />
              </div>
              <h1 className="text-[23px] font-bold tracking-tight text-[#0f172a]">
                Set Permanent Password
              </h1>
              <p className="mt-1 text-[13px] leading-snug text-slate-500">
                You logged in with a system-generated password. Please create your own secure password to proceed.
              </p>
            </div>
          )}

          {mode === 'forgot' && (
            <div className="text-center">
              <h1 className="text-[25px] font-bold tracking-tight text-[#0f172a]">
                Reset Password
              </h1>
              <p className="mt-1 text-[13.5px] leading-snug text-slate-500">
                Enter your admin email to receive a verification code
              </p>
            </div>
          )}

          {mode === 'reset' && (
            <div className="text-center">
              <h1 className="text-[25px] font-bold tracking-tight text-[#0f172a]">
                New Password
              </h1>
              <p className="mt-1 text-[13.5px] leading-snug text-slate-500">
                Enter the 6-digit code sent to <strong className="text-slate-700">{resetEmail}</strong>
              </p>
            </div>
          )}

          {/* Feedback Messages */}
          {error && (
            <div className="mt-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[13px] flex items-center space-x-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="mt-5 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[13px] flex items-center space-x-2">
              <svg className="w-4 h-4 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{successMsg}</span>
            </div>
          )}

          {/* MODE 1: LOGIN FORM */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="mt-5 space-y-3.5" noValidate>

              {/* Admin Email Field */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <MailIcon />
                </span>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="admin@yourcompany.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 focus:outline-none"
                />
              </div>

              {/* Password Field with Eye Icon */}
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

              {/* Forgot Password Link */}
              <div className="flex items-center justify-end px-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email.trim());
                    setResetCompanyCode(companyCode.trim());
                    setError(null);
                    setSuccessMsg(null);
                    setMode('forgot');
                  }}
                  className="text-[12.5px] font-medium text-[#f06400] hover:text-[#d45600] hover:underline cursor-pointer transition-colors"
                >
                  Forgot password?
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
          )}

          {/* MODE: INITIAL PASSWORD CHANGE (For system-generated passwords) */}
          {mode === 'initial-password' && (
            <form onSubmit={handleInitialPasswordSubmit} className="mt-5 space-y-3.5" noValidate>
              {/* Account badge */}
              <div className="p-3 rounded-2xl bg-[#edf4fe] border border-blue-200/60 text-slate-700 text-[12px] flex items-center justify-between">
                <span className="font-medium text-slate-500">Account:</span>
                <span className="font-semibold text-[#0f172a] truncate max-w-[220px]">
                  {pendingAdmin?.admin?.email}
                </span>
              </div>

              {/* New Password */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <LockIcon />
                </span>
                <input
                  type={showInitialNewPassword ? 'text' : 'password'}
                  required
                  placeholder="New Permanent Password (min 6 chars)"
                  value={initialNewPassword}
                  onChange={(e) => setInitialNewPassword(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 pr-2 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowInitialNewPassword((v) => !v)}
                  className="shrink-0 p-1 text-[#8aa5ca] hover:text-slate-600 transition-colors cursor-pointer"
                  aria-label={showInitialNewPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showInitialNewPassword} />
                </button>
              </div>

              {/* Confirm New Password */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <LockIcon />
                </span>
                <input
                  type={showInitialNewPassword ? 'text' : 'password'}
                  required
                  placeholder="Confirm Permanent Password"
                  value={initialConfirmPassword}
                  onChange={(e) => setInitialConfirmPassword(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 pr-2 focus:outline-none"
                />
              </div>

              {/* Save Password & Sign In Button */}
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
                    <span>Setting password…</span>
                  </span>
                ) : (
                  <span>Set Password & Enter Dashboard →</span>
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccessMsg(null);
                    setPendingAdmin(null);
                    setPassword('');
                    setMode('login');
                  }}
                  className="text-[13px] font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  ← Back to Login
                </button>
              </div>
            </form>
          )}

          {/* MODE 2: FORGOT PASSWORD (REQUEST CODE) */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotSubmit} className="mt-5 space-y-3.5" noValidate>
              {/* Optional Company Code */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <BuildingIcon />
                </span>
                <input
                  type="text"
                  placeholder="Company Code (Optional or Auto-detect)"
                  value={resetCompanyCode}
                  onChange={(e) => setResetCompanyCode(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 focus:outline-none"
                />
              </div>

              {/* Admin Email */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <MailIcon />
                </span>
                <input
                  type="email"
                  required
                  placeholder="admin@yourcompany.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 focus:outline-none"
                />
              </div>

              {/* Send Reset Code Button */}
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
                    <span>Sending code…</span>
                  </span>
                ) : (
                  <span>Send Reset Code →</span>
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccessMsg(null);
                    setMode('login');
                  }}
                  className="text-[13px] font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  ← Back to Login
                </button>
              </div>
            </form>
          )}

          {/* MODE 3: ENTER CODE & SET NEW PASSWORD (FORGOT PASSWORD) */}
          {mode === 'reset' && (
            <form onSubmit={handleResetSubmit} className="mt-5 space-y-3.5" noValidate>
              {/* 6-Digit Code */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <KeyIcon />
                </span>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="Enter 6-digit code (e.g. 123456)"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] font-mono tracking-wider text-slate-800 placeholder-slate-400 pl-3 focus:outline-none"
                />
              </div>

              {/* New Password */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <LockIcon />
                </span>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 pr-2 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="shrink-0 p-1 text-[#8aa5ca] hover:text-slate-600 transition-colors cursor-pointer"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showNewPassword} />
                </button>
              </div>

              {/* Confirm New Password */}
              <div className="relative flex items-center rounded-2xl bg-[#edf4fe] px-4 py-3 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100/60 transition-all">
                <span className="pointer-events-none shrink-0">
                  <LockIcon />
                </span>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-[13.5px] text-slate-800 placeholder-slate-400 pl-3 pr-2 focus:outline-none"
                />
              </div>

              {/* Submit Reset */}
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
                    <span>Resetting password…</span>
                  </span>
                ) : (
                  <span>Update Password →</span>
                )}
              </button>

              <div className="pt-2 flex items-center justify-between text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccessMsg(null);
                    setMode('forgot');
                  }}
                  className="text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  ← Request new code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccessMsg(null);
                    setMode('login');
                  }}
                  className="text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  Back to Login
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      <ToastContainer
        position="top-right"
        autoClose={3500}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable
        pauseOnHover
        theme="colored"
      />
    </main>
  );
}
