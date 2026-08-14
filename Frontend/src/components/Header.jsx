import { useState, useEffect, useRef } from 'react'
import logo from '../assets/SkillBridge_AI.png'

const Header = ({ onLogout, onLogoClick }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Retrieve user details from sessionStorage
  const user = (() => {
    try {
      const data = JSON.parse(sessionStorage.getItem('skillbridge_user') || 'null')
      return data?.user || { fullName: 'James', role: 'STUDENT' }
    } catch {
      return { fullName: 'James', role: 'STUDENT' }
    }
  })()

  // Calculate user initial / first letter
  const initial = (() => {
    if (!user.fullName) return 'P';
    const clean = user.fullName.trim();
    return clean.charAt(0).toUpperCase();
  })()

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#e5eaf2] bg-white select-none">
      <div className="flex h-[56px] w-full items-center justify-between gap-4 px-6 sm:px-8 lg:px-10">
        {/* Left Side: Logo */}
        <div className="flex flex-1 items-center gap-8">
          <button
            type="button"
            onClick={onLogoClick}
            className="flex cursor-pointer items-center border-0 bg-transparent p-0 transition hover:opacity-90"
          >
            <img src={logo} alt="SkillBridge" className="h-8 w-auto object-contain" />
          </button>
        </div>

        {/* Right Actions: Initial Avatar + Dropdown Chevron Icon Only */}
        <div className="flex items-center gap-4">
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex cursor-pointer items-center gap-1.5 rounded-full p-0.5 pl-0.5 pr-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 transition shadow-xs"
            >
              {/* Avatar circle with name's first letter */}
              <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-tr from-[#ff8c21] to-[#f58220] text-white font-extrabold text-xs shadow-sm ring-2 ring-orange-100 uppercase">
                {initial}
              </div>

              {/* Dropdown Chevron Icon */}
              <svg
                className={`h-4 w-4 text-slate-500 transition-transform duration-200 ml-0.5 ${dropdownOpen ? 'rotate-180 text-[#ff8c21]' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-52 origin-top-right rounded-xl border border-[#e5eaf2] bg-white p-1.5 shadow-[0_10px_30px_rgba(15,27,45,0.08)] ring-1 ring-black/5 animate-panel-in z-50">
                <div className="px-3 py-2 border-b border-slate-100 text-xs text-slate-400">
                  Signed in as <br />
                  <strong className="text-slate-700 truncate block font-semibold">{user.email || user.fullName}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false)
                    if (window.location.pathname !== '/certificates') {
                      window.location.href = '/certificates'
                    }
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-orange-50 hover:text-[#ff7a00] border-0 bg-transparent my-0.5"
                >
                  My Certificates
                </button>

                <button
                  type="button"
                  onClick={onLogout}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50 border-0 bg-transparent mt-0.5 border-t border-slate-100"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
