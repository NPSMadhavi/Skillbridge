import React, { useState, useEffect } from 'react';
import { api } from '../../../services/api';
import CountrySelect from '../../../components/CountrySelect';
import PhoneInputWithCountry from '../../../components/PhoneInputWithCountry';
import { getCountry, getCountryDialCode, applyCountryDialCode } from '../../../data/countries';

// ============================================================================
// 1. NEW / REGISTER COMPANY MODAL
// ============================================================================
export function NewCompanyModal({
  isOpen,
  onClose,
  onSubmit,
  newCompany,
  setNewCompany,
  onAutoGenerateSlug,
  creating,
  createError,
  createdResult,
  onCloseCreatedResult,
  copiedKey,
  onCopy
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0e2246]/50 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Modal Header (Fixed) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-[#f06400] shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Register New Company</h2>
              <p className="text-xs text-slate-500">
                Set up a new organization with administrative management.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {createdResult ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                <div className="flex items-center space-x-2 font-bold text-emerald-900 text-sm">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Company Successfully Registered!</span>
                </div>
                <p className="mt-1 text-xs text-emerald-700">
                  Organization account has been set up with primary administrator credentials.
                </p>
              </div>

              <div className="bg-[#edf4fe] border border-blue-100 rounded-xl p-4 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                  <span className="text-slate-500">Company Name:</span>
                  <span className="text-slate-900 font-bold">{createdResult.name}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                  <span className="text-slate-500">Company Code / Slug:</span>
                  <span className="text-blue-700 font-bold bg-white px-2 py-0.5 rounded border border-blue-200">
                    {createdResult.code}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                  <span className="text-slate-500">Admin Name:</span>
                  <span className="text-slate-800">{createdResult.fullName}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                  <span className="text-slate-500">NRIC / FIN:</span>
                  <span className="text-slate-800">{createdResult.nricFin}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                  <span className="text-slate-500">Admin Email:</span>
                  <span className="text-slate-800">{createdResult.adminEmail}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                  <span className="text-slate-500">Phone Number:</span>
                  <span className="text-slate-800">{createdResult.phone}</span>
                </div>
                {createdResult.department && (
                  <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                    <span className="text-slate-500">Department:</span>
                    <span className="text-slate-800">{createdResult.department}</span>
                  </div>
                )}
                {createdResult.generatedPassword && (
                  <div className="flex justify-between items-center py-1.5 bg-amber-100/60 p-2 rounded-lg border border-amber-300">
                    <span className="text-amber-900 font-bold">Initial Admin Password:</span>
                    <span className="text-amber-900 font-bold">{createdResult.generatedPassword}</span>
                  </div>
                )}

                {createdResult.emailStatus && (
                  <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    createdResult.emailStatus.sent
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}>
                    <div className="flex items-center space-x-2">
                      <span className="text-base">{createdResult.emailStatus.sent ? '✉️' : '⚠️'}</span>
                      <span>
                        {createdResult.emailStatus.sent
                          ? <>Login credentials automatically sent to <strong>{createdResult.adminEmail}</strong>.</>
                          : <>Email delivery status: {createdResult.emailStatus.error || 'Check SMTP configuration'}. Credentials are shown above.</>}
                      </span>
                    </div>
                    {createdResult.emailStatus.previewUrl && (
                      <a
                        href={createdResult.emailStatus.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 px-2.5 py-1 bg-white border border-emerald-300 rounded-lg text-emerald-700 font-bold hover:bg-emerald-50 text-[11px]"
                      >
                        Preview Email &rarr;
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                <span>
                  💡 Company admins log in at <code>/admin/login</code> with Company Code: <strong>{createdResult.code}</strong>.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onCopy(
                      `Company: ${createdResult.name}\nCode/Slug: ${createdResult.code}\nDB: ${createdResult.dbName}\nEmail: ${createdResult.adminEmail}\nPassword: ${createdResult.generatedPassword || ''}`,
                      'creds'
                    )
                  }
                  className="ml-3 px-3 py-1.5 text-xs bg-[#0e2246] hover:bg-[#1a3668] text-white font-medium rounded-lg shrink-0 transition-colors cursor-pointer"
                >
                  {copiedKey === 'creds' ? 'Copied!' : 'Copy Info'}
                </button>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 shrink-0">
              <button
                type="button"
                onClick={onCloseCreatedResult}
                className="w-full py-2.5 bg-[#0e2246] hover:bg-[#1a3668] text-white rounded-xl font-semibold text-xs transition-colors cursor-pointer"
              >
                Close & View Companies
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {createError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                  {createError}
                </div>
              )}

              {/* Section 1: Company & Database Setup */}
              <div className="bg-slate-50/80 border border-slate-200 p-4 rounded-2xl space-y-3.5">
                <div className="text-xs font-bold uppercase tracking-wider text-[#0e2246] flex items-center space-x-1.5">
                  <span>1. Company & Database Identification</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter company / organization name"
                    value={newCompany.companyName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewCompany((prev) => ({
                        ...prev,
                        companyName: val
                      }));
                    }}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                  />
                </div>

                {/* Slug input with Auto-generate button */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      Slug / Company Code <span className="text-slate-400 font-normal">(Auto-generated if blank)</span>
                    </label>
                    <button
                      type="button"
                      onClick={onAutoGenerateSlug}
                      className="text-[11px] font-semibold text-[#f06400] hover:text-[#e05800] flex items-center space-x-1 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-2.5 py-0.5 rounded-lg cursor-pointer transition-colors"
                    >
                      <span>⚡</span>
                      <span>Auto Generate</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="company_code (leave blank or click Auto Generate)"
                    value={newCompany.slug}
                    onChange={(e) =>
                      setNewCompany((prev) => ({
                        ...prev,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                      }))
                    }
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-semibold text-blue-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Department <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Operations / Safety"
                    value={newCompany.department}
                    onChange={(e) =>
                      setNewCompany((prev) => ({ ...prev, department: e.target.value }))
                    }
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                  />
                </div>
              </div>

              {/* Section 2: Administrator Contact Details */}
              <div className="bg-slate-50/80 border border-slate-200 p-4 rounded-2xl space-y-3.5">
                <div className="text-xs font-bold uppercase tracking-wider text-[#0e2246] flex items-center space-x-1.5">
                  <span>2. Primary Administrator Profile</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Administrator full name"
                      value={newCompany.fullName}
                      onChange={(e) =>
                        setNewCompany((prev) => ({ ...prev, fullName: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      NRIC / FIN Number <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        maxLength={9}
                        placeholder="e.g. S1234567A"
                        value={newCompany.nricFin}
                        onChange={(e) =>
                          setNewCompany((prev) => ({
                            ...prev,
                            nricFin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9)
                          }))
                        }
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 tracking-wider"
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px]">
                      <span className="text-slate-500">Fixed 9 characters (S, T, F, G, M + 7 digits + letter)</span>
                      <span className={`font-mono ${(newCompany.nricFin || '').length === 9 ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
                        {(newCompany.nricFin || '').length}/9 chars
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="admin@company.com"
                      value={newCompany.email}
                      onChange={(e) =>
                        setNewCompany((prev) => ({ ...prev, email: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700">
                        Phone Number <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[11px] text-blue-600 font-medium">Select country to set code</span>
                    </div>
                    <PhoneInputWithCountry
                      value={newCompany.phone}
                      onChange={(val) => setNewCompany((prev) => ({ ...prev, phone: val }))}
                      country={newCompany.country}
                      onCountryChange={(cntry) => setNewCompany((prev) => ({ ...prev, country: cntry }))}
                      required
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Click the flag button to choose your country dial code (e.g. +65, +91).
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      Initial Admin Password <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <span className="text-[11px] text-emerald-600 font-medium">✉️ Will be sent to admin email</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Leave blank to auto-generate secure password & email to admin"
                    value={newCompany.adminPassword}
                    onChange={(e) =>
                      setNewCompany((prev) => ({ ...prev, adminPassword: e.target.value }))
                    }
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    If left blank, a secure password will be generated and automatically emailed to the admin.
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer (Fixed) */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end space-x-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-5 py-2.5 bg-[#f06400] hover:bg-[#e05800] text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                {creating ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Creating Dedicated Database...</span>
                  </>
                ) : (
                  <span>Create Company & Database</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 2. EDIT COMPANY MODAL
// ============================================================================
export function EditCompanyModal({
  isOpen,
  onClose,
  onSubmit,
  editingCompany,
  setEditingCompany,
  updating,
  editError
}) {
  if (!isOpen || !editingCompany) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0e2246]/50 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Edit Company Profile</h2>
              <p className="text-xs text-slate-500">Update company metadata and administrator contact info</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {editError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                {editError}
              </div>
            )}

            {/* Immutable Identification Pill */}
            <div className="bg-[#edf4fe] border border-blue-100 p-3 rounded-xl flex items-center justify-between text-xs font-mono">
              <div>
                <span className="text-slate-500">Slug: </span>
                <span className="text-blue-700 font-bold">{editingCompany.code}</span>
              </div>
              <div>
                <span className="text-slate-500">Database: </span>
                <span className="text-emerald-700 font-semibold">{editingCompany.dbName}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Name</label>
              <input
                type="text"
                required
                value={editingCompany.name}
                onChange={(e) => setEditingCompany({ ...editingCompany, name: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                <input
                  type="text"
                  placeholder="e.g. Operations"
                  value={editingCompany.department}
                  onChange={(e) => setEditingCompany({ ...editingCompany, department: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={editingCompany.status}
                  onChange={(e) => setEditingCompany({ ...editingCompany, status: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Admin Full Name</label>
                <input
                  type="text"
                  required
                  value={editingCompany.fullName}
                  onChange={(e) => setEditingCompany({ ...editingCompany, fullName: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">NRIC / FIN Number</label>
                  <span className={`text-[11px] font-mono ${(editingCompany.nricFin || '').length === 9 ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
                    {(editingCompany.nricFin || '').length}/9 chars
                  </span>
                </div>
                <input
                  type="text"
                  required
                  maxLength={9}
                  value={editingCompany.nricFin}
                  onChange={(e) => setEditingCompany({ ...editingCompany, nricFin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9) })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 tracking-wider"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Admin Email Address</label>
                <input
                  type="email"
                  required
                  value={editingCompany.adminEmail}
                  onChange={(e) => setEditingCompany({ ...editingCompany, adminEmail: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">Phone Number</label>
                  <span className="text-[11px] text-blue-600 font-medium">Select country code</span>
                </div>
                <PhoneInputWithCountry
                  value={editingCompany.phone}
                  onChange={(val) => setEditingCompany({ ...editingCompany, phone: val })}
                  country={editingCompany.country}
                  onCountryChange={(cntry) => setEditingCompany((prev) => ({ ...prev, country: cntry }))}
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  New Password <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <span className="text-[11px] text-slate-500">Leave blank to keep existing password</span>
              </div>
              <input
                type="text"
                placeholder="Enter 6+ characters to reset password"
                value={editingCompany.adminPassword || ''}
                onChange={(e) => setEditingCompany({ ...editingCompany, adminPassword: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 font-mono"
              />
            </div>
          </div>

          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end space-x-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updating}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
            >
              {updating ? <span>Saving Changes...</span> : <span>Save Company Changes</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 3. DELETE COMPANY MODAL
// ============================================================================
export function DeleteCompanyModal({
  isOpen,
  onClose,
  onSubmit,
  deletingCompany,
  deleteConfirmationInput,
  setDeleteConfirmationInput,
  dropPhysicalDb,
  setDropPhysicalDb,
  deleting,
  deleteError
}) {
  if (!isOpen || !deletingCompany) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0e2246]/50 backdrop-blur-xs">
      <div className="bg-white border border-red-200 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        <div className="flex items-center justify-between px-6 py-4 border-b border-red-100 bg-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Delete Company Tenant</h2>
              <p className="text-xs text-red-600 font-semibold">Irreversible Action</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {deleteError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                {deleteError}
              </div>
            )}

            <p className="text-xs text-slate-600 leading-relaxed">
              You are about to permanently delete <strong className="text-slate-900">{deletingCompany.name}</strong>.
            </p>

            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Company Code:</span>
                <span className="text-blue-700 font-bold">{deletingCompany.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Company Name:</span>
                <span className="text-slate-800 font-bold">{deletingCompany.name}</span>
              </div>
            </div>

            <label className="flex items-start space-x-2.5 text-xs text-slate-700 cursor-pointer bg-red-50/70 border border-red-200 p-3 rounded-xl">
              <input
                type="checkbox"
                checked={dropPhysicalDb}
                onChange={(e) => setDropPhysicalDb(e.target.checked)}
                className="mt-0.5 rounded text-red-600 focus:ring-red-500 cursor-pointer"
              />
              <span>
                Permanently delete all courses, learner progress records, and administrative data for this company.
              </span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Type <span className="font-mono text-red-600 select-all font-bold">{deletingCompany.code}</span> to confirm:
              </label>
              <input
                type="text"
                required
                placeholder={deletingCompany.code}
                value={deleteConfirmationInput}
                onChange={(e) => setDeleteConfirmationInput(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-red-400 focus:ring-3 focus:ring-red-100"
              />
            </div>
          </div>

          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end space-x-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleting || deleteConfirmationInput.trim() !== deletingCompany.code}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {deleting ? <span>Deleting & Dropping DB...</span> : <span>Permanently Delete</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 4. INSPECT DATABASE MODAL
// ============================================================================
export function InspectDatabaseModal({
  isOpen,
  onClose,
  viewingCompany,
  dbHealthStatus,
  testingDb,
  onTestDbConnection,
  onSwitchToEdit,
  onOpenChangePassword
}) {
  if (!isOpen || !viewingCompany) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0e2246]/50 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#0e2246] shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Company Profile Details</h2>
              <p className="text-xs text-slate-500 font-mono">Code: {viewingCompany.code}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3.5 text-xs font-mono">
          <div className="bg-[#edf4fe] border border-blue-100 rounded-xl p-4 space-y-2.5">
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">Company Name:</span>
              <span className="text-slate-900 font-bold">{viewingCompany.name}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">Slug / Tenant Code:</span>
              <span className="text-blue-700 font-bold bg-white px-2 py-0.5 rounded border border-blue-200">
                {viewingCompany.code}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">Status:</span>
              <span className={`font-bold ${viewingCompany.status === 'ACTIVE' ? 'text-blue-700' : 'text-amber-700'}`}>
                {viewingCompany.status}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">Primary Admin Name:</span>
              <span className="text-slate-800">{viewingCompany.fullName || '—'}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">NRIC / FIN:</span>
              <span className="text-slate-800">{viewingCompany.nricFin || '—'}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">Admin Email:</span>
              <span className="text-slate-800">{viewingCompany.adminEmail}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">Phone Number:</span>
              <span className="text-slate-800">{viewingCompany.phone || '—'}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
              <span className="text-slate-500">Department:</span>
              <span className="text-slate-800">{viewingCompany.department || '—'}</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-500">Registration Date:</span>
              <span className="text-slate-600">{new Date(viewingCompany.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onSwitchToEdit}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Edit Company Profile
            </button>
            {onOpenChangePassword && (
              <button
                type="button"
                onClick={onOpenChangePassword}
                className="px-3.5 py-2 text-xs font-semibold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors cursor-pointer flex items-center space-x-1.5"
              >
                <span>🔑</span>
                <span>Change Admin Password</span>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold bg-[#0e2246] hover:bg-[#1a3668] text-white rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. CREATE SUPER ADMIN MODAL
// ============================================================================
export function CreateSuperAdminModal({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  creating,
  createError
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0e2246]/50 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-[#f06400] shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Add Super Administrator</h2>
              <p className="text-xs text-slate-500">
                Grant full platform and tenant control-plane access.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {createError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                {createError}
              </div>
            )}

            <div className="bg-[#edf4fe] border border-blue-100 rounded-xl p-3 text-xs text-slate-600 flex items-start gap-2.5">
              <svg className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                Super Admins can manage all tenant companies, provision databases, and add or remove other Super Admins.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Super Admin Full Name"
                value={formData.name || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                placeholder="admin@company.com"
                value={formData.email || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="Minimum 6 characters"
                value={formData.password || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 transition-all"
              />
              <p className="text-[11px] text-slate-400 mt-1">Must be at least 6 characters long.</p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end space-x-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-5 py-2.5 bg-[#f06400] hover:bg-[#d85800] text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
            >
              {creating ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Creating Admin...</span>
                </>
              ) : (
                <span>Create Super Admin</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 6. CHANGE COMPANY ADMIN PASSWORD MODAL
// ============================================================================
export function ChangeAdminPasswordModal({
  isOpen,
  onClose,
  company,
  onSuccess
}) {
  const [admins, setAdmins] = useState([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [selectedAdminId, setSelectedAdminId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (isOpen && company?.id) {
      setLoadingAdmins(true);
      setError(null);
      setResult(null);
      setNewPassword('');
      api.getCompanyAdmins(company.id)
        .then((res) => {
          if (!isMounted) return;
          const list = res.admins || [];
          setAdmins(list);
          if (list.length > 0) {
            setSelectedAdminId(list[0].id);
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.warn('Could not load company admins:', err);
          setAdmins([
            {
              id: 'primary',
              email: company.adminEmail,
              fullName: company.fullName || 'Primary Administrator'
            }
          ]);
          setSelectedAdminId('primary');
        })
        .finally(() => {
          if (isMounted) setLoadingAdmins(false);
        });
    }
    return () => { isMounted = false; };
  }, [isOpen, company?.id]);

  if (!isOpen || !company) return null;

  const handleAutoGenerate = () => {
    const prefix = (company.name || 'Admin').replace(/[^a-zA-Z]/g, '').slice(0, 6) || 'Admin';
    const capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    setNewPassword(`SB#${capitalized}${randomDigits}!`);
  };

  const selectedAdmin = admins.find(a => a.id === selectedAdminId) || admins[0] || {
    email: company.adminEmail,
    fullName: company.fullName || 'Primary Administrator'
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!newPassword || newPassword.trim().length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    setUpdating(true);
    try {
      const res = await api.changeCompanyAdminPassword(company.id, {
        adminId: selectedAdminId !== 'primary' ? selectedAdminId : undefined,
        adminEmail: selectedAdmin.email,
        password: newPassword.trim(),
        mustChangePassword,
        sendEmail
      });
      setResult(res);
      onSuccess?.(`Password updated successfully for ${selectedAdmin.email}!`);
    } catch (err) {
      setError(err.message || 'Failed to change administrator password.');
    } finally {
      setUpdating(false);
    }
  };

  const handleCopy = () => {
    const loginUrl = `${window.location.origin}/admin/login`;
    const text = `SkillBridge Admin Login Credentials
Company: ${company.name}
Company Code: ${company.code}
Admin Name: ${selectedAdmin.fullName || 'Administrator'}
Admin Email: ${selectedAdmin.email}
New Password: ${result?.newPassword || newPassword}
Login URL: ${loginUrl}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#0e2246]/50 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Change Admin Password</h2>
              <p className="text-xs text-slate-500">Manage credentials for {company.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        {result ? (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start space-x-2.5">
              <span className="text-base">✅</span>
              <div>
                <p className="font-bold text-emerald-900">Password Changed Successfully!</p>
                <p className="mt-0.5 text-emerald-700">The administrative password has been updated in the tenant database.</p>
              </div>
            </div>

            <div className="bg-[#edf4fe] border border-blue-100 rounded-xl p-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                <span className="text-slate-500">Company:</span>
                <span className="text-slate-900 font-bold">{company.name}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                <span className="text-slate-500">Company Code:</span>
                <span className="text-blue-700 font-bold bg-white px-2 py-0.5 rounded border border-blue-200">
                  {company.code}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-blue-200/60">
                <span className="text-slate-500">Admin Email:</span>
                <span className="text-slate-800 font-bold">{selectedAdmin.email}</span>
              </div>
              <div className="flex justify-between items-center py-2 bg-amber-100/70 p-2.5 rounded-lg border border-amber-300">
                <span className="text-amber-900 font-bold">New Password:</span>
                <span className="text-amber-950 font-bold text-sm select-all">{result.newPassword}</span>
              </div>

              {result.emailStatus && (
                <div className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                  result.emailStatus.success !== false
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}>
                  <span className="flex items-center space-x-1.5">
                    <span>{result.emailStatus.success !== false ? '✉️' : '⚠️'}</span>
                    <span>
                      {result.emailStatus.success !== false
                        ? `Credentials sent to ${selectedAdmin.email}.`
                        : `Email notification: ${result.emailStatus.error || 'Check SMTP configuration'}`}
                    </span>
                  </span>
                  {result.emailStatus.previewUrl && (
                    <a
                      href={result.emailStatus.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 px-2 py-0.5 bg-white border border-emerald-300 rounded text-emerald-700 font-bold hover:bg-emerald-50 text-[11px]"
                    >
                      Preview Email &rarr;
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleCopy}
                className="w-full py-2.5 bg-[#0e2246] hover:bg-[#1a3668] text-white rounded-xl font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <span>{copied ? '✓' : '📋'}</span>
                <span>{copied ? 'Copied Credentials to Clipboard!' : 'Copy Login Credentials'}</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                  {error}
                </div>
              )}

              {/* Company Info Banner */}
              <div className="bg-[#edf4fe] border border-blue-100 p-3.5 rounded-xl flex items-center justify-between text-xs font-mono">
                <div>
                  <span className="text-slate-500">Company: </span>
                  <span className="text-slate-900 font-bold">{company.name}</span>
                </div>
                <div>
                  <span className="text-slate-500">Slug: </span>
                  <span className="text-blue-700 font-bold">{company.code}</span>
                </div>
              </div>

              {/* Administrator Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Select Company Administrator
                </label>
                {loadingAdmins ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 flex items-center space-x-2">
                    <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    <span>Loading company administrators...</span>
                  </div>
                ) : admins.length > 1 ? (
                  <select
                    value={selectedAdminId}
                    onChange={(e) => setSelectedAdminId(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 font-medium"
                  >
                    {admins.map((adm) => (
                      <option key={adm.id} value={adm.id}>
                        {adm.fullName ? `${adm.fullName} (${adm.email})` : adm.email}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                    <p className="font-semibold text-slate-900">{selectedAdmin.fullName || 'Primary Administrator'}</p>
                    <p className="text-slate-600 font-mono text-[11px] mt-0.5">{selectedAdmin.email}</p>
                  </div>
                )}
              </div>

              {/* New Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    New Password <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoGenerate}
                    className="text-[11px] font-semibold text-[#f06400] hover:text-[#e05800] flex items-center space-x-1 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-2.5 py-0.5 rounded-lg cursor-pointer transition-colors"
                  >
                    <span>⚡</span>
                    <span>Auto Generate</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    placeholder="Enter or auto-generate secure password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 pr-10 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-3 focus:ring-blue-100 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer p-1"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Must be at least 6 characters long.</p>
              </div>

              {/* Options */}
              <div className="space-y-2.5 pt-1">
                <label className="flex items-center space-x-2.5 cursor-pointer text-xs text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="w-4 h-4 text-[#0e2246] rounded border-slate-300 focus:ring-blue-400"
                  />
                  <span>Email the new credentials to the administrator ({selectedAdmin.email})</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer text-xs text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={mustChangePassword}
                    onChange={(e) => setMustChangePassword(e.target.checked)}
                    className="w-4 h-4 text-[#0e2246] rounded border-slate-300 focus:ring-blue-400"
                  />
                  <span>Require admin to change password on their next login</span>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end space-x-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updating}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                {updating ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <span>Update Admin Password</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
