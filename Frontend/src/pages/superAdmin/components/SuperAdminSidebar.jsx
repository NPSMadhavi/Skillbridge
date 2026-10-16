import React from 'react';
import logo from '../../../assets/SkillBridge_AI.png';

export default function SuperAdminSidebar({
  activeTab,
  setActiveTab,
  companiesCount = 0,
  superAdminsCount = 0,
  sidebarOpen,
  setSidebarOpen,
  session,
  onLogout
}) {
  return (
    <>
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0e2246]/40 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Super Admin Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-[260px] flex-col shrink-0 border-r border-slate-200 bg-white transition-transform duration-300 lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center border-b border-slate-100 gap-3 shrink-0">
          <img src={logo} alt="SkillBridge" className="h-8 w-auto object-contain" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#f06400]">
              Control Panel
            </span>
            <span className="text-xs font-semibold text-slate-700">Super Admin</span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Management
          </div>

          <button
            onClick={() => {
              setActiveTab('companies');
              setSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold transition cursor-pointer ${activeTab === 'companies'
              ? 'bg-[#0e2246] text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span>Companies</span>
            <span
              className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'companies' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}
            >
              {companiesCount}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('superAdmins');
              setSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold transition cursor-pointer ${activeTab === 'superAdmins'
              ? 'bg-[#0e2246] text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Super Admins</span>
            {superAdminsCount !== undefined && (
              <span
                className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'superAdmins' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
              >
                {superAdminsCount}
              </span>
            )}
          </button>
        </nav>

        {/* Sidebar Footer with Super Admin Profile */}
        <div className="p-3 border-t border-slate-100 shrink-0">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-[#0e2246] text-white font-bold text-xs flex items-center justify-center shrink-0">
                SA
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-bold text-[#0f172a] truncate">Super Admin</div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {session?.superAdmin?.email || 'superadmin@skillbridge.com'}
                </div>
              </div>
            </div>
            <button
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
