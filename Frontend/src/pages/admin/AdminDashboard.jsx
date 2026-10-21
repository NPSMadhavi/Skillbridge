import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { api } from '../../services/api'

const StatCard = ({ label, value, hint, tone, icon }) => (
  <div className="rounded-xl border border-line bg-panel p-3.5 sm:p-4 shadow-xs hover:shadow-sm transition flex flex-col justify-between min-w-0">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold tracking-wider text-muted uppercase truncate">{label}</p>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-muted">
        {icon}
      </span>
    </div>
    <div className="mt-2.5">
      <p className={`font-display text-2xl font-bold tracking-tight ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted truncate">{hint}</p>
    </div>
  </div>
)

const AdminDashboard = () => {
  const [stats, setStats] = useState({ totalUsers: 0, faceEnrolled: 0, regionsCovered: 0, pendingFaceId: 0 })
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [statsData, usersList] = await Promise.all([
          api.getStats(),
          api.getUsers()
        ])
        setStats(statsData)
        setRecent(usersList.slice(0, 5))
      } catch (err) {
        console.error('Failed to load dashboard data', err)
        toast.error('Failed to load dashboard metrics.')
      } finally {
        setLoading(false)
      }
    }
    fetchDashboardData()
  }, [])

  return (
    <div className="animate-rise-in space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-xs text-muted sm:text-sm">Overview of registered learners and Face ID enrollment.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/admins"
            className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-line bg-panel px-3.5 py-2 text-xs font-semibold text-fg shadow-xs transition hover:bg-ink"
          >
            Manage Admins
          </Link>
          <Link
            to="/admin/register"
            className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-orange px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-orange/20 transition hover:brightness-105"
          >
            Register new user
          </Link>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3.5">
        {loading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-line bg-panel p-3.5 shadow-xs animate-pulse space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="h-3 w-16 rounded bg-ink" />
                <div className="h-7 w-7 rounded-lg bg-ink" />
              </div>
              <div className="h-6 w-12 rounded bg-ink" />
              <div className="h-2.5 w-24 rounded bg-ink/70" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Total users"
              value={stats.totalUsers}
              hint="All registered profiles"
              tone="text-navy"
              icon={
                <svg className="w-4 h-4 text-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              }
            />
            <StatCard
              label="Face ID enrolled"
              value={stats.faceEnrolled}
              hint="Biometric captures saved"
              tone="text-sky"
              icon={
                <svg className="w-4 h-4 text-sky" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
            />
            <StatCard
              label="Regions covered"
              value={stats.regionsCovered}
              hint="Unique regions in use"
              tone="text-orange"
              icon={
                <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Pending Face ID"
              value={stats.pendingFaceId}
              hint="Profiles without capture"
              tone="text-danger"
              icon={
                <svg className="w-4 h-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              }
            />
          </>
        )}
      </div>

      <section className="rounded-2xl border border-line bg-panel p-5 shadow-[0_10px_30px_rgba(15,27,45,0.04)] sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-fg">Recent registrations</h2>
          <Link to="/admin/users" className="text-sm font-semibold text-sky hover:underline">
            View all
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3 p-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 py-3 border-b border-line/50 last:border-0">
                <div className="h-10 w-10 rounded-lg bg-ink shrink-0" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="h-3.5 w-32 rounded bg-ink" />
                  <div className="h-2.5 w-44 rounded bg-ink/70" />
                </div>
                <div className="h-3 w-20 rounded bg-ink/60 hidden sm:block" />
                <div className="h-3 w-20 rounded bg-ink/60 hidden md:block" />
                <div className="h-6 w-16 rounded-full bg-ink/60" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-ink/50 px-4 py-10 text-center">
            <p className="font-medium text-fg">No users registered yet</p>
            <p className="mt-1 text-sm text-muted">Start by registering a learner with Face ID.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs tracking-[0.08em] text-muted uppercase">
                  <th className="py-3 pr-3 font-semibold">User</th>
                  <th className="py-3 pr-3 font-semibold">FIN</th>
                  <th className="py-3 pr-3 font-semibold">Country</th>
                  <th className="py-3 font-semibold">Face ID</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((user) => (
                  <tr key={user.id} className="border-b border-line/70 last:border-0">
                    <td className="py-3.5 pr-3">
                      <div className="flex items-center gap-3">
                        {user.faceIdData && user.faceIdData.startsWith('data:image/') ? (
                          <img src={user.faceIdData} alt="" className="h-10 w-10 rounded-lg object-cover" />
                        ) : (
                          <span className="grid h-10 w-10 place-items-center rounded-lg bg-ink font-semibold text-muted">
                            {user.fullName.slice(0, 1)}
                          </span>
                        )}
                        <div>
                          <p className="font-semibold text-fg">{user.fullName}</p>
                          <p className="text-xs text-muted">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 pr-3 text-muted">{user.finNumber}</td>
                    <td className="py-3.5 pr-3 text-muted">{user.country}</td>
                    <td className="py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase ${user.faceIdData ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                          }`}
                      >
                        {user.faceIdData ? 'Enrolled' : 'Missing'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default AdminDashboard
