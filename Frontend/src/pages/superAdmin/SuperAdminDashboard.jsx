import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

// Subcomponents
import SuperAdminSidebar from './components/SuperAdminSidebar';
import {
  NewCompanyModal,
  EditCompanyModal,
  InspectDatabaseModal,
  DeleteCompanyModal,
  CreateSuperAdminModal
} from './components/CompanyModals';

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('companies'); // 'companies' | 'databases' | 'superAdmins'
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState(null);

  // 1. CREATE Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [newCompany, setNewCompany] = useState({
    fullName: '',
    nricFin: '',
    email: '',
    phone: '',
    companyName: '',
    department: '',
    slug: '',
    adminPassword: ''
  });
  const [createdResult, setCreatedResult] = useState(null);

  // 2. VIEW / DETAILS Modal State
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingCompany, setViewingCompany] = useState(null);
  const [testingDb, setTestingDb] = useState(false);
  const [dbHealthStatus, setDbHealthStatus] = useState(null);

  // 3. EDIT Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [editError, setEditError] = useState(null);

  // 4. DELETE Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingCompany, setDeletingCompany] = useState(null);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');
  const [dropPhysicalDb, setDropPhysicalDb] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // 5. SUPER ADMINS State
  const [superAdmins, setSuperAdmins] = useState([]);
  const [loadingSuperAdmins, setLoadingSuperAdmins] = useState(false);
  const [showCreateSuperAdminModal, setShowCreateSuperAdminModal] = useState(false);
  const [creatingSuperAdmin, setCreatingSuperAdmin] = useState(false);
  const [createSuperAdminError, setCreateSuperAdminError] = useState(null);
  const [newSuperAdmin, setNewSuperAdmin] = useState({
    name: '',
    email: '',
    password: ''
  });
  const [deletingSuperAdminId, setDeletingSuperAdminId] = useState(null);

  const [copiedKey, setCopiedKey] = useState(null);

  // Read current Super Admin session
  const session = JSON.parse(sessionStorage.getItem('skillbridge_super_admin') || 'null');

  useEffect(() => {
    if (!session?.token) {
      navigate('/super-admin/login');
      return;
    }
    loadCompanies();
    loadSuperAdmins();
  }, []);

  const loadCompanies = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCompanies();
      setCompanies(res.companies || []);
    } catch (err) {
      setError(err.message || 'Failed to load companies.');
    } finally {
      setLoading(false);
    }
  };

  const loadSuperAdmins = async () => {
    setLoadingSuperAdmins(true);
    try {
      const res = await api.getSuperAdmins();
      setSuperAdmins(res.superAdmins || res.admins || []);
    } catch (err) {
      console.error('Failed to load Super Admins:', err);
    } finally {
      setLoadingSuperAdmins(false);
    }
  };

  const handleCreateSuperAdminSubmit = async (e) => {
    e.preventDefault();
    setCreateSuperAdminError(null);
    setCreatingSuperAdmin(true);

    try {
      const res = await api.createSuperAdmin(newSuperAdmin);
      setShowCreateSuperAdminModal(false);
      setNewSuperAdmin({ name: '', email: '', password: '' });
      await loadSuperAdmins();
      triggerSuccessAlert(
        `Super Admin "${res.superAdmin?.name || res.admin?.name || newSuperAdmin.name}" created successfully!`
      );
    } catch (err) {
      setCreateSuperAdminError(err.message || 'Failed to create Super Admin.');
    } finally {
      setCreatingSuperAdmin(false);
    }
  };

  const handleDeleteSuperAdmin = async (admin) => {
    if (session?.superAdmin?.id === admin.id || session?.superAdmin?.email === admin.email) {
      alert('You cannot delete your own active Super Admin account.');
      return;
    }
    if (superAdmins.length <= 1) {
      alert("Cannot delete the platform's sole remaining Super Administrator.");
      return;
    }
    if (!window.confirm(`Are you sure you want to revoke Super Admin privileges for ${admin.name} (${admin.email})?`)) {
      return;
    }

    setDeletingSuperAdminId(admin.id);
    try {
      await api.deleteSuperAdmin(admin.id);
      await loadSuperAdmins();
      triggerSuccessAlert(`Super Admin ${admin.name} revoked successfully.`);
    } catch (err) {
      alert(err.message || 'Failed to delete Super Admin.');
    } finally {
      setDeletingSuperAdminId(null);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('skillbridge_super_admin');
    navigate('/super-admin/login');
  };

  const triggerSuccessAlert = (msg) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  // ---------------- CREATE ----------------
  const handleAutoGenerateSlug = () => {
    let base = newCompany.companyName
      ? newCompany.companyName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
      : 'tenant';

    if (base.length < 2) base = 'company';

    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const generated = `${base}_${randomSuffix}`;
    setNewCompany((prev) => ({ ...prev, slug: generated }));
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const res = await api.createCompany(newCompany);
      setCreatedResult(res.company);
      setNewCompany({
        fullName: '',
        nricFin: '',
        email: '',
        phone: '',
        companyName: '',
        department: '',
        slug: '',
        adminPassword: ''
      });
      await loadCompanies();
      triggerSuccessAlert(`Company "${res.company.name}" and database provisioned!`);
    } catch (err) {
      setCreateError(err.message || 'Failed to create company and database.');
    } finally {
      setCreating(false);
    }
  };

  // ---------------- READ / VIEW ----------------
  const handleOpenViewModal = (company) => {
    setViewingCompany(company);
    setDbHealthStatus(null);
    setShowViewModal(true);
  };

  const handleTestDbConnection = async (id) => {
    setTestingDb(true);
    setDbHealthStatus(null);
    try {
      const res = await api.getCompany(id);
      setDbHealthStatus(res.company?.dbStatus || 'ONLINE');
    } catch (err) {
      setDbHealthStatus('ERROR: ' + err.message);
    } finally {
      setTestingDb(false);
    }
  };

  // ---------------- UPDATE / EDIT ----------------
  const handleOpenEditModal = (company) => {
    setEditingCompany({
      id: company.id,
      name: company.name,
      code: company.code,
      dbName: company.dbName,
      department: company.department || '',
      fullName: company.fullName || '',
      nricFin: company.nricFin || '',
      phone: company.phone || '',
      adminEmail: company.adminEmail || '',
      status: company.status || 'ACTIVE'
    });
    setEditError(null);
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError(null);
    setUpdating(true);

    try {
      await api.updateCompany(editingCompany.id, {
        name: editingCompany.name,
        department: editingCompany.department,
        fullName: editingCompany.fullName,
        nricFin: editingCompany.nricFin,
        phone: editingCompany.phone,
        email: editingCompany.adminEmail,
        status: editingCompany.status
      });

      setShowEditModal(false);
      setEditingCompany(null);
      await loadCompanies();
      triggerSuccessAlert('Company details updated successfully.');
    } catch (err) {
      setEditError(err.message || 'Failed to update company.');
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleStatus = async (company) => {
    const nextStatus = company.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const confirmMsg = `Are you sure you want to ${nextStatus === 'ACTIVE' ? 'activate' : 'suspend'} ${company.name}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await api.updateCompanyStatus(company.id, nextStatus);
      await loadCompanies();
      triggerSuccessAlert(`Status for ${company.name} changed to ${nextStatus}.`);
    } catch (err) {
      alert('Error updating status: ' + err.message);
    }
  };

  // ---------------- DELETE ----------------
  const handleOpenDeleteModal = (company) => {
    setDeletingCompany(company);
    setDeleteConfirmationInput('');
    setDropPhysicalDb(true);
    setDeleteError(null);
    setShowDeleteModal(true);
  };

  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (deleteConfirmationInput.trim() !== deletingCompany.code) {
      setDeleteError(`Please type "${deletingCompany.code}" exactly to confirm.`);
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      await api.deleteCompany(deletingCompany.id, dropPhysicalDb);
      setShowDeleteModal(false);
      setDeletingCompany(null);
      await loadCompanies();
      triggerSuccessAlert(`Company "${deletingCompany.name}" has been permanently deleted.`);
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete company.');
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredCompanies = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase()) ||
      c.dbName.toLowerCase().includes(search.toLowerCase()) ||
      (c.fullName && c.fullName.toLowerCase().includes(search.toLowerCase())) ||
      (c.nricFin && c.nricFin.toLowerCase().includes(search.toLowerCase())) ||
      (c.adminEmail && c.adminEmail.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex font-sans">
      {/* 1. SEPARATE SIDEBAR COMPONENT */}
      <SuperAdminSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        companiesCount={companies.length}
        superAdminsCount={superAdmins.length}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        session={session}
        onLogout={handleLogout}
      />

      {/* 2. MAIN CONTENT AREA */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top Navbar */}
        <header className="h-18 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg lg:hidden cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-[#0f172a] tracking-tight">
                {activeTab === 'companies'
                  ? 'Company & Database Registry'
                  : activeTab === 'databases'
                  ? 'Database Cluster Health'
                  : 'Platform Super Administrators'}
              </h1>
              <p className="text-xs text-slate-500">
                {activeTab === 'superAdmins'
                  ? 'Manage root-level administrators with full platform privileges across all tenant companies'
                  : 'Manage enterprise tenants, auto-provision dedicated databases, and manage credentials'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Master DB: Connected</span>
            </div>

            {activeTab === 'superAdmins' ? (
              <button
                onClick={() => {
                  setCreateSuperAdminError(null);
                  setShowCreateSuperAdminModal(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-[#f06400] hover:bg-[#e05800] text-white font-semibold text-xs shadow-sm shadow-orange-500/25 transition-all flex items-center space-x-2 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                <span>Add Super Admin</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setCreatedResult(null);
                  setCreateError(null);
                  setShowCreateModal(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-[#f06400] hover:bg-[#e05800] text-white font-semibold text-xs shadow-sm shadow-orange-500/25 transition-all flex items-center space-x-2 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Create New Company</span>
              </button>
            )}
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-6 space-y-6 max-w-7xl w-full mx-auto">
          {/* Action Success Alert */}
          {actionSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between shadow-xs">
              <div className="flex items-center space-x-2 font-medium">
                <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>{actionSuccess}</span>
              </div>
              <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900 text-xs cursor-pointer">
                ✕
              </button>
            </div>
          )}

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => setActiveTab('companies')}
              className={`bg-white border rounded-2xl p-5 shadow-xs cursor-pointer transition-all ${
                activeTab === 'companies' ? 'border-[#0e2246] ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Companies</div>
              <div className="text-3xl font-extrabold text-[#0f172a] mt-2">{companies.length}</div>
              <div className="text-xs text-slate-500 mt-1">Active enterprise tenants</div>
            </div>

            <div
              onClick={() => setActiveTab('databases')}
              className={`bg-white border rounded-2xl p-5 shadow-xs cursor-pointer transition-all ${
                activeTab === 'databases' ? 'border-[#0e2246] ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Dedicated Databases</div>
              <div className="text-3xl font-extrabold text-[#0e2246] mt-2">{companies.length}</div>
              <div className="text-xs text-slate-500 mt-1">1 Isolated DB per company</div>
            </div>

            <div
              onClick={() => setActiveTab('superAdmins')}
              className={`bg-white border rounded-2xl p-5 shadow-xs cursor-pointer transition-all ${
                activeTab === 'superAdmins' ? 'border-[#0e2246] ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Super Admins</span>
                <span className="text-[10px] font-bold text-[#f06400] bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                  Control Plane
                </span>
              </div>
              <div className="text-3xl font-extrabold text-[#f06400] mt-2">{superAdmins.length}</div>
              <div className="text-xs text-slate-500 mt-1">Platform root administrators</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Isolation Guarantee</div>
              <div className="text-xl font-extrabold text-emerald-600 mt-2">100% Isolated</div>
              <div className="text-xs text-slate-500 mt-1">Physical PostgreSQL separation</div>
            </div>
          </div>

          {/* TAB 1: COMPANIES & DATABASES */}
          {activeTab === 'companies' && (
            <div className="space-y-4">
              {/* Search & Actions Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <input
                    type="text"
                    placeholder="Search by company, slug, NRIC/FIN, admin..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 transition-all shadow-xs"
                  />
                  <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={loadCompanies}
                    className="px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Companies Table Card */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                {loading ? (
                  <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                    <svg className="animate-spin h-6 w-6 text-[#0e2246]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span className="text-xs text-slate-500 font-medium">Querying Master Database...</span>
                  </div>
                ) : error ? (
                  <div className="p-8 text-center text-red-600 text-xs">
                    <p>{error}</p>
                    <button onClick={loadCompanies} className="mt-3 text-xs text-[#0e2246] underline font-semibold">Try again</button>
                  </div>
                ) : filteredCompanies.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    <p className="text-sm font-semibold text-slate-700">No companies found.</p>
                    <p className="text-xs text-slate-400 mt-1">Click "Create New Company" to provision your first tenant database.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 uppercase tracking-wider font-bold text-[11px]">
                          <th className="py-3.5 px-4">Company & Slug</th>
                          <th className="py-3.5 px-4">Primary Admin</th>
                          <th className="py-3.5 px-4">NRIC/FIN & Phone</th>
                          <th className="py-3.5 px-4">Department</th>
                          <th className="py-3.5 px-4">Dedicated DB</th>
                          <th className="py-3.5 px-4">Status</th>
                          <th className="py-3.5 px-4">Created Date</th>
                          <th className="py-3.5 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {filteredCompanies.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3.5 px-4 font-semibold text-[#0f172a]">
                              <div className="text-[13px]">{c.name}</div>
                              <div className="flex items-center space-x-1 mt-1 font-mono text-[11px] text-blue-700 font-normal">
                                <span className="bg-[#edf4fe] border border-blue-200 px-1.5 py-0.5 rounded">
                                  slug: {c.code}
                                </span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-900">{c.fullName || 'Company Admin'}</div>
                              <div className="text-slate-500 text-[11px] font-mono">{c.adminEmail}</div>
                            </td>
                            <td className="py-3.5 px-4 font-mono">
                              <div className="text-slate-900 font-medium">{c.nricFin || '—'}</div>
                              <div className="text-slate-500 text-[11px]">{c.phone || '—'}</div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-600">
                              {c.department ? (
                                <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 border border-slate-200 text-slate-700 font-medium">
                                  {c.department}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-slate-600">
                              <span className="flex items-center space-x-1.5">
                                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zm0 5h16" />
                                </svg>
                                <span className="truncate max-w-[150px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                  {c.dbName}
                                </span>
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${c.status === 'ACTIVE'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                                  }`}
                              >
                                {c.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-500">
                              {new Date(c.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {/* 1. VIEW */}
                                <button
                                  title="View Details & DB Info"
                                  onClick={() => handleOpenViewModal(c)}
                                  className="p-1.5 text-slate-600 hover:text-[#0e2246] hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                </button>

                                {/* 2. EDIT */}
                                <button
                                  title="Edit Company Profile"
                                  onClick={() => handleOpenEditModal(c)}
                                  className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg border border-slate-200 hover:border-emerald-200 transition-colors cursor-pointer"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>

                                {/* 3. SUSPEND / ACTIVATE */}
                                <button
                                  title={c.status === 'ACTIVE' ? 'Suspend Company' : 'Activate Company'}
                                  onClick={() => handleToggleStatus(c)}
                                  className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg border border-slate-200 hover:border-amber-200 transition-colors cursor-pointer"
                                >
                                  {c.status === 'ACTIVE' ? (
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  ) : (
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  )}
                                </button>

                                {/* 4. DELETE COMPANY */}
                                <button
                                  title="Delete Company & Drop DB"
                                  onClick={() => handleOpenDeleteModal(c)}
                                  className="p-1.5 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg border border-slate-200 hover:border-red-200 transition-colors cursor-pointer"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: DATABASE CLUSTER HEALTH */}
          {activeTab === 'databases' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
                <h2 className="text-base font-bold text-[#0f172a]">PostgreSQL Multi-Database Topology</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Overview of all physical databases currently orchestrated across this cluster.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
                  {companies.map((c) => (
                    <div key={c.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#0f172a] truncate">{c.name}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
                          Online
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 truncate">
                        DB: <span className="font-semibold text-slate-800">{c.dbName}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 truncate">
                        Slug: <span className="text-blue-700">{c.code}</span>
                      </div>
                      <button
                        onClick={() => handleOpenViewModal(c)}
                        className="mt-2 w-full py-1.5 text-xs font-semibold text-[#0e2246] bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      >
                        Inspect Database →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PLATFORM SUPER ADMINISTRATORS */}
          {activeTab === 'superAdmins' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-[#0f172a] flex items-center gap-2">
                      <span>Platform Super Administrators</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-[#f06400] border border-orange-200">
                        {superAdmins.length}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Super Admins possess root-level credentials to provision company databases, manage subscriptions, and oversee platform security.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setCreateSuperAdminError(null);
                      setShowCreateSuperAdminModal(true);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-[#0e2246] hover:bg-[#1a3668] text-white font-semibold text-xs shadow-sm transition-all flex items-center space-x-2 shrink-0 cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <span>Create Super Admin</span>
                  </button>
                </div>

                {loadingSuperAdmins ? (
                  <div className="p-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center space-y-2">
                    <svg className="animate-spin h-6 w-6 text-[#f06400]" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Loading super administrators...</span>
                  </div>
                ) : superAdmins.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-500">
                    No Super Administrators found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[10px] tracking-wider">
                        <tr>
                          <th className="py-3 px-5">Administrator</th>
                          <th className="py-3 px-5">Email Address</th>
                          <th className="py-3 px-5">Role & Privileges</th>
                          <th className="py-3 px-5">Created Date</th>
                          <th className="py-3 px-5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {superAdmins.map((admin) => {
                          const isCurrentUser =
                            session?.superAdmin?.id === admin.id || session?.superAdmin?.email === admin.email;
                          return (
                            <tr key={admin.id} className="hover:bg-slate-50/75 transition-colors">
                              <td className="py-3.5 px-5">
                                <div className="flex items-center space-x-3">
                                  <div className="w-9 h-9 rounded-xl bg-[#0e2246] text-white font-bold text-xs flex items-center justify-center shrink-0">
                                    {(admin.name || 'SA').substring(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-900 flex items-center gap-2">
                                      <span>{admin.name || 'Super Admin'}</span>
                                      {isCurrentUser && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                          You (Current Session)
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-slate-400 font-mono">
                                      ID: {admin.id ? admin.id.substring(0, 8) + '...' : '—'}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-5 font-mono text-slate-700">
                                {admin.email}
                              </td>
                              <td className="py-3.5 px-5">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
                                  Full Root Access
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-slate-500 text-[11px]">
                                {new Date(admin.createdAt).toLocaleDateString(undefined, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </td>
                              <td className="py-3.5 px-5 text-right">
                                {isCurrentUser ? (
                                  <span className="text-[11px] text-slate-400 italic">Protected</span>
                                ) : (
                                  <button
                                    onClick={() => handleDeleteSuperAdmin(admin)}
                                    disabled={deletingSuperAdminId === admin.id || superAdmins.length <= 1}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                  >
                                    {deletingSuperAdminId === admin.id ? 'Revoking...' : 'Revoke Access'}
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
            </div>
          )}
        </main>
      </div>

      {/* ============================================================== */}
      {/* MODAL DIALOGS                                                  */}
      {/* ============================================================== */}

      {/* 1. Register / New Company Modal */}
      <NewCompanyModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateSubmit}
        newCompany={newCompany}
        setNewCompany={setNewCompany}
        onAutoGenerateSlug={handleAutoGenerateSlug}
        creating={creating}
        createError={createError}
        createdResult={createdResult}
        onCloseCreatedResult={() => {
          setShowCreateModal(false);
          setCreatedResult(null);
        }}
        copiedKey={copiedKey}
        onCopy={handleCopy}
      />

      {/* 2. Inspect Database Modal */}
      <InspectDatabaseModal
        isOpen={showViewModal}
        onClose={() => setShowViewModal(false)}
        viewingCompany={viewingCompany}
        dbHealthStatus={dbHealthStatus}
        testingDb={testingDb}
        onTestDbConnection={handleTestDbConnection}
        onSwitchToEdit={() => {
          setShowViewModal(false);
          handleOpenEditModal(viewingCompany);
        }}
      />

      {/* 3. Edit Company Modal */}
      <EditCompanyModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSubmit={handleEditSubmit}
        editingCompany={editingCompany}
        setEditingCompany={setEditingCompany}
        updating={updating}
        editError={editError}
      />

      {/* 4. Delete Company Modal */}
      <DeleteCompanyModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onSubmit={handleDeleteSubmit}
        deletingCompany={deletingCompany}
        deleteConfirmationInput={deleteConfirmationInput}
        setDeleteConfirmationInput={setDeleteConfirmationInput}
        dropPhysicalDb={dropPhysicalDb}
        setDropPhysicalDb={setDropPhysicalDb}
        deleting={deleting}
        deleteError={deleteError}
      />

      {/* 5. Create Super Admin Modal */}
      <CreateSuperAdminModal
        isOpen={showCreateSuperAdminModal}
        onClose={() => {
          setShowCreateSuperAdminModal(false);
          setCreateSuperAdminError(null);
        }}
        onSubmit={handleCreateSuperAdminSubmit}
        formData={newSuperAdmin}
        setFormData={setNewSuperAdmin}
        creating={creatingSuperAdmin}
        createError={createSuperAdminError}
      />
    </div>
  );
}
