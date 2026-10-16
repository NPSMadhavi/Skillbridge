import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
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
  const [copiedSlug, setCopiedSlug] = useState(false)

  const session = JSON.parse(sessionStorage.getItem('skillbridge_admin') || 'null')
  const slug = session?.slug || session?.tenant || 'default'
  const companyName = session?.companyName || 'Your Organization'

  const handleCopySlug = () => {
    navigator.clipboard.writeText(slug)
    setCopiedSlug(true)
    toast.info(`Company slug "${slug}" copied to clipboard!`)
    setTimeout(() => setCopiedSlug(false), 2000)
  }

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
    <div className="animate-rise-in space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">Overview of registered learners and Face ID enrollment.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            to="/admin/admins"
            className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-fg shadow-xs transition hover:bg-ink"
          >
            Manage Admins
          </Link>
          <Link
            to="/admin/register"
            className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(240,106,0,0.22)] transition hover:brightness-105"
          >
            Register new user
          </Link>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl border border-line bg-panel p-5 shadow-sm animate-pulse space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-3 w-20 rounded bg-ink" />
                <div className="h-9 w-9 rounded-xl bg-ink" />
              </div>
              <div className="h-8 w-16 rounded-lg bg-ink" />
              <div className="h-2.5 w-32 rounded bg-ink/70" />
            </div>
          ))
        ) : (
          <>
            <StatCard label="Total users" value={stats.totalUsers} hint="All registered profiles" tone="text-navy" icon="👥" />
            <StatCard label="Face ID enrolled" value={stats.faceEnrolled} hint="Biometric captures saved" tone="text-sky" icon="📸" />
            <StatCard label="Regions covered" value={stats.regionsCovered} hint="Unique regions in use" tone="text-orange" icon="🌐" />
            <StatCard
              label="Pending Face ID"
              value={stats.pendingFaceId}
              hint="Profiles without capture"
              tone="text-danger"
              icon="⚠️"
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
