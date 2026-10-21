import { useEffect, useState } from 'react';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { api } from '../../services/api';

const NRIC_FIN_REGEX = /^[STFGMstfgm]\d{7}[A-Za-z]$/;

export default function AdminManagement() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [currentAdminEmail, setCurrentAdminEmail] = useState('');

  // Create Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [form, setForm] = useState({
    fullName: '',
    nricFin: '',
    email: '',
    phone: '',
    department: '',
    password: '',
  });

  // Delete confirmation state
  const [deletingAdmin, setDeletingAdmin] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadAdmins();
  }, []);

  const loadAdmins = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getCompanyAdmins();
      setAdmins(data.admins || []);
      setTenantCode(data.tenantCode || '');
      setCurrentAdminEmail(data.currentAdminEmail || '');
    } catch (err) {
      setError(err.message || 'Failed to load company administrators.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = () => {
    setForm({
      fullName: '',
      nricFin: '',
      email: '',
      phone: '',
      department: '',
      password: '',
    });
    setCreateError('');
    setShowCreateModal(true);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setCreateError('');

    // Pre-flight client checks
    if (!form.fullName.trim()) {
      setCreateError('Full Name is required.');
      return;
    }

    const cleanFin = form.nricFin.trim().toUpperCase();
    if (!cleanFin || cleanFin.length !== 9 || !NRIC_FIN_REGEX.test(cleanFin)) {
      setCreateError('NRIC/FIN number must be 9 characters starting with S, T, F, G, or M (e.g. S1234567A).');
      return;
    }

    // Client-side quick check
    if (admins.some((a) => (a.nricFin || '').toUpperCase() === cleanFin)) {
      setCreateError(`An administrator with NRIC/FIN "${cleanFin}" already exists in your company.`);
      return;
    }

    if (!form.email.trim()) {
      setCreateError('Admin email is required.');
      return;
    }

    if (admins.some((a) => a.email.toLowerCase() === form.email.trim().toLowerCase())) {
      setCreateError(`An administrator with email "${form.email.trim()}" already exists in your company.`);
      return;
    }

    if (!form.password || form.password.length < 6) {
      setCreateError('Password must be at least 6 characters.');
      return;
    }

    setCreating(true);
    try {
      const res = await api.createCompanyAdmin({
        fullName: form.fullName.trim(),
        nricFin: cleanFin,
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        department: form.department.trim(),
        password: form.password,
      });

      toast.success(res.message || 'Company administrator created successfully!');
      setShowCreateModal(false);
      await loadAdmins();
    } catch (err) {
      setCreateError(err.message || 'Failed to create company administrator.');
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingAdmin) return;
    setDeleting(true);

    try {
      await api.deleteCompanyAdmin(deletingAdmin.id);
      toast.success('Administrator removed successfully.');
      setDeletingAdmin(null);
      await loadAdmins();
    } catch (err) {
      toast.error(err.message || 'Failed to delete administrator.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <ToastContainer position="top-right" autoClose={3000} />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-fg sm:text-2xl">
            Company Administrators
          </h1>
          <p className="mt-1 text-xs text-muted sm:text-sm">
            Create and manage administrators for your organization.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#f06400] px-4 py-2.5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(240,100,0,0.22)] transition hover:bg-[#e05800]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Create Company Admin</span>
        </button>
      </div>

      {/* Admins Table Card */}
      <div className="rounded-2xl border border-line bg-panel overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-4 space-y-3 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4 py-3 px-2 border-b border-line/50 last:border-0">
                <div className="w-7 h-7 rounded-full bg-ink shrink-0" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="h-3.5 w-32 rounded bg-ink" />
                  <div className="h-2.5 w-48 rounded bg-ink/70" />
                </div>
                <div className="h-3 w-24 rounded bg-ink/60 hidden sm:block" />
                <div className="h-3 w-28 rounded bg-ink/60 hidden md:block" />
                <div className="h-3 w-20 rounded bg-ink/60 hidden lg:block" />
                <div className="h-7 w-20 rounded-lg bg-ink/70" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-500 text-xs">
            <p>{error}</p>
            <button
              onClick={loadAdmins}
              className="mt-3 text-xs text-navy underline font-semibold cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : admins.length === 0 ? (
          <div className="p-12 text-center text-muted">
            <p className="font-semibold text-fg">No administrators found.</p>
            <p className="text-xs mt-1">Click "Create Company Admin" to add an administrator.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line bg-ink/50 text-muted uppercase tracking-wider font-bold text-[11px]">
                  <th className="py-3.5 px-4">Admin Name</th>
                  <th className="py-3.5 px-4">NRIC / FIN (Unique)</th>
                  <th className="py-3.5 px-4">Email Address</th>
                  <th className="py-3.5 px-4">Phone Number</th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4">Registered Date</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-fg">
                {admins.map((adm) => {
                  const isCurrent = adm.email.toLowerCase() === currentAdminEmail.toLowerCase();
                  return (
                    <tr key={adm.id} className="hover:bg-ink/40 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-fg">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-navy text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                            {(adm.fullName || adm.email || 'A').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold">{adm.fullName || 'Company Admin'}</div>
                            {isCurrent && (
                              <span className="inline-block mt-0.5 rounded bg-sky/15 px-1.5 py-0.2 text-[10px] font-bold text-sky border border-sky/30">
                                You (Current)
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-medium">
                        <span className="bg-ink px-2 py-0.5 rounded border border-line text-sky font-semibold">
                          {adm.nricFin || '—'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-muted">{adm.email}</td>
                      <td className="py-3.5 px-4 text-muted">{adm.phone || '—'}</td>
                      <td className="py-3.5 px-4">
                        {adm.department ? (
                          <span className="rounded bg-line/60 px-2 py-0.5 text-[11px] font-medium text-fg">
                            {adm.department}
                          </span>
                        ) : (
                          <span className="text-muted/60">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-muted">
                        {new Date(adm.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isCurrent ? (
                          <span className="text-[11px] text-muted italic">Active Session</span>
                        ) : admins.length <= 1 ? (
                          <span className="text-[11px] text-muted italic">Sole Admin</span>
                        ) : (
                          <button
                            title="Remove Administrator"
                            onClick={() => setDeletingAdmin(adm)}
                            className="p-1.5 text-muted hover:text-rose-500 hover:bg-rose-500/10 rounded-lg border border-line hover:border-rose-300 transition-colors cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 1. CREATE COMPANY ADMIN MODAL                                  */}
      {/* ============================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-navy/40 backdrop-blur-xs">
          <div className="bg-panel border border-line rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
            <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-panel shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-[#f06400] shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-fg">Register Company Admin</h2>
                  <p className="text-xs text-muted">Provision a new administrator account for your organization.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-muted hover:text-fg hover:bg-ink w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {createError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-500 text-xs">
                    {createError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-fg mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rachel Lim"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-ink/60 border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-sky focus:bg-panel"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-fg">
                      NRIC / FIN Number <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] text-sky font-semibold bg-sky/10 px-2 py-0.2 rounded border border-sky/25">
                      Unique to Company
                    </span>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="e.g. S1234567A"
                    value={form.nricFin}
                    onChange={(e) => setForm({ ...form, nricFin: e.target.value.toUpperCase() })}
                    className="w-full px-3.5 py-2.5 bg-ink/60 border border-line rounded-xl text-xs font-mono font-semibold text-sky focus:outline-none focus:border-sky focus:bg-panel"
                  />
                  <p className="text-[11px] text-muted mt-1">
                    Must start with S, T, F, G, or M followed by 7 digits and 1 letter.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-fg mb-1">
                      Admin Email <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="rachel@company.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-ink/60 border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-sky focus:bg-panel"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-fg mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      placeholder="e.g. +65 9123 4567"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-ink/60 border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-sky focus:bg-panel"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fg mb-1">
                    Department <span className="text-muted font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Human Resources, Operations"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-ink/60 border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-sky focus:bg-panel"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fg mb-1">
                    Initial Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Minimum 6 characters"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-ink/60 border border-line rounded-xl text-xs text-fg focus:outline-none focus:border-sky focus:bg-panel"
                  />
                </div>
              </div>

              <div className="px-6 py-3.5 bg-ink/40 border-t border-line flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-muted hover:text-fg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 bg-[#f06400] hover:bg-[#e05800] text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {creating ? <span>Creating Admin...</span> : <span>Create Administrator</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. DELETE ADMIN MODAL                                          */}
      {/* ============================================================== */}
      {deletingAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-navy/40 backdrop-blur-xs">
          <div className="bg-panel border border-rose-500/30 rounded-2xl w-full max-w-md shadow-2xl p-6 relative">
            <h3 className="text-base font-bold text-fg">Remove Administrator</h3>
            <p className="mt-2 text-xs text-muted leading-relaxed">
              Are you sure you want to remove administrator <strong className="text-fg">{deletingAdmin.fullName || deletingAdmin.email}</strong> (FIN: {deletingAdmin.nricFin || 'N/A'})? They will immediately lose access to this company console.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingAdmin(null)}
                className="px-4 py-2 text-xs font-semibold text-muted hover:text-fg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
