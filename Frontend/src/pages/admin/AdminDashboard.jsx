import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../services/api'

const StatCard = ({ label, value, hint, tone, icon }) => (
  <div className="rounded-2xl border border-line bg-panel p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between min-w-0">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase truncate">{label}</p>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink text-muted font-bold text-sm">
        {icon}
      </span>
    </div>
    <div className="mt-3">
      <p className={`font-display text-3xl font-bold tracking-tight ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-muted truncate">{hint}</p>
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
      } finally {
        setLoading(false)
      }
    }
    fetchDashboardData()
  }, [])

  return (
    <div className="animate-rise-in space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">Overview of registered learners and Face ID enrollment.</p>
        </div>
        <Link
          to="/admin/register"
          className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(240,106,0,0.22)] transition hover:brightness-105"
        >
          Register new user
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total users" value={loading ? '…' : stats.totalUsers} hint="All registered profiles" tone="text-navy" icon="👥" />
        <StatCard label="Face ID enrolled" value={loading ? '…' : stats.faceEnrolled} hint="Biometric captures saved" tone="text-sky" icon="📸" />
        <StatCard label="Regions covered" value={loading ? '…' : stats.regionsCovered} hint="Unique regions in use" tone="text-orange" icon="🌐" />
        <StatCard
          label="Pending Face ID"
          value={loading ? '…' : stats.pendingFaceId}
          hint="Profiles without capture"
          tone="text-danger"
          icon="⚠️"
        />
      </div>

      <section className="rounded-2xl border border-line bg-panel p-5 shadow-[0_10px_30px_rgba(15,27,45,0.04)] sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-fg">Recent registrations</h2>
          <Link to="/admin/users" className="text-sm font-semibold text-sky hover:underline">
            View all
          </Link>
        </div>

        {recent.length === 0 ? (
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
                        className={`rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase ${
                          user.faceIdData ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
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
