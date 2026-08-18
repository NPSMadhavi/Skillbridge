import { useState } from 'react'
import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom'
import logo from '../../assets/SkillBridge_AI.png'

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
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 4h7v7H4V4Zm9 0h7v5h-7V4ZM4 13h7v7H4v-7Zm9 3h7v4h-7v-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin/register',
    label: 'Register user',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M19 8v4M17 10h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/admin/users',
    label: 'Users',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 9 11Zm9.5-1a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M15 16.5a5 5 0 0 1 6.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/admin/courses',
    label: 'Course Manager',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin/assignments',
    label: 'Course Assignments',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
]

const AdminLayout = () => {
  const navigate = useNavigate()
  const admin = getAdminSession()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!admin) {
    return <Navigate to="/admin" replace />
  }

  const handleLogout = () => {
    sessionStorage.removeItem('skillbridge_admin')
    navigate('/admin', { replace: true })
  }

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition ${isActive
      ? 'bg-navy text-white shadow-[0_8px_20px_rgba(14,47,92,0.2)]'
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-line bg-panel transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <img src={logo} alt="SkillBridge" className="h-10 w-auto rounded-lg" />
          <div>
            <p className="font-display text-sm font-semibold text-fg">Admin</p>
            <p className="text-[0.7rem] tracking-[0.12em] text-sky uppercase">Console</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1.5 p-4" aria-label="Admin">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={linkClass}
              onClick={() => setSidebarOpen(false)}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line p-4">
          <div className="mb-3 rounded-xl bg-ink px-3.5 py-3">
            <p className="text-xs text-muted">Signed in as</p>
            <p className="truncate text-sm font-semibold text-fg">{admin.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-3 text-sm font-semibold text-muted transition hover:border-danger/40 hover:text-danger"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-line bg-panel/90 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border border-line bg-ink text-fg lg:hidden"
              aria-label="Open sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <div>
              <p className="font-display text-sm font-semibold text-fg sm:text-base">SkillBridge Admin</p>
              <p className="hidden text-xs text-muted sm:block">Manage users and Face ID enrollment</p>
            </div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy font-display text-xs font-bold text-white">
            AD
          </div>
        </header>

        <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
