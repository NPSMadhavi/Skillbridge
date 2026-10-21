import { useState, useEffect } from 'react'
import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import logo from '../../assets/SkillBridge_AI.png'
import { api } from '../../services/api'

const getAdminSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem('skillbridge_admin') || 'null')
  } catch {
    return null
  }
}

const navItems = [
  {
    to: '/admin/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h7v7H4V4Zm9 0h7v5h-7V4ZM4 13h7v7H4v-7Zm9 3h7v4h-7v-4Z" />
      </svg>
    ),
  },
  {
    to: '/admin/register',
    label: 'Register user',
    icon: (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
        <path d="M4 20a8 8 0 0 1 16 0" strokeLinecap="round" />
        <path d="M19 8v4M17 10h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/admin/users',
    label: 'Users',
    icon: (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 9 11Zm9.5-1a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" />
        <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M15 16.5a5 5 0 0 1 6.5 3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/admin/courses',
    label: 'Course Manager',
    icon: (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin/assignments',
    label: 'Course Assignments',
    icon: (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin/admins',
    label: 'Company Admins',
    icon: (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin/ai-settings',
    label: 'AI Tutor & Wake Word',
    icon: (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" strokeLinecap="round" />
        <line x1="12" y1="19" x2="12" y2="22" strokeLinecap="round" />
        <line x1="8" y1="22" x2="16" y2="22" strokeLinecap="round" />
      </svg>
    ),
  },
]


const AdminLayout = () => {
  const navigate = useNavigate()
  const admin = getAdminSession()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let isMounted = true
    api.getAdminMe().then((data) => {
      if (isMounted && data) {
        setProfile(data)
        if (data.tenant?.code || data.tenant?.slug) {
          const current = getAdminSession() || {}
          sessionStorage.setItem('skillbridge_admin', JSON.stringify({
            ...current,
            tenant: data.tenant.code || data.tenant.slug,
            slug: data.tenant.slug || data.tenant.code,
            companyName: data.tenant.name
          }))
        }
      }
    }).catch(() => { })
    return () => { isMounted = false }
  }, [])

  if (!admin) {
    return <Navigate to="/admin" replace />
  }

  const companyName = profile?.tenant?.name || admin.companyName || 'SkillBridge Organization'

  const handleLogout = () => {
    sessionStorage.removeItem('skillbridge_admin')
    navigate('/admin', { replace: true })
  }

  const linkClass = ({ isActive }) =>
    `w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-semibold transition cursor-pointer ${isActive
      ? 'bg-navy text-white shadow-sm'
      : 'text-muted hover:bg-ink hover:text-fg'
    }`

  return (
    <div className="min-h-svh bg-ink text-fg">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px] lg:hidden"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col border-r border-line bg-panel transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="h-16 px-4 flex items-center border-b border-line shrink-0">
          <img src={logo} alt="SkillBridge" className="h-11 w-auto max-w-full object-contain" />
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2.5 py-3.5 overflow-y-auto" aria-label="Admin">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={linkClass}
              onClick={() => setSidebarOpen(false)}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line px-3 py-3 shrink-0 space-y-2">
          <div className="rounded-xl bg-ink px-3 py-2 border border-line/50">
            <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Signed in as</p>
            <p className="truncate text-xs font-semibold text-fg mt-0.5">{admin.email}</p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs font-semibold text-muted transition hover:border-danger/40 hover:text-danger hover:bg-danger/5"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="lg:pl-[240px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-line bg-panel/90 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border border-line bg-ink text-fg lg:hidden shrink-0"
              aria-label="Open sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold text-fg sm:text-base truncate">
                {companyName}
              </p>
            </div>
          </div>
        </header>

        <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 w-full">
          <Outlet />
        </main>
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
    </div>
  )
}

export default AdminLayout
