import React, { useState, useRef, useEffect, useMemo } from 'react';
import { COUNTRIES, getCountry, getCountryDialCode, applyCountryDialCode, detectCountryFromPhone } from '../data/countries';

const QUICK_COUNTRIES = ['SG', 'MY', 'IN', 'US', 'GB', 'AU', 'ID', 'CN'];

export default function PhoneInputWithCountry({
  value = '',
  onChange,
  country = '',
  onCountryChange,
  placeholder,
  required = false,
  disabled = false,
  darkMode = false,
  className = '',
  id,
  name = 'phone'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  // Active country resolution:
  // 1. Explicit country prop if provided and found
  // 2. Detected from phone value prefix (e.g. +91...)
  // 3. Fallback to Singapore (SG)
  const activeCountry = useMemo(() => {
    if (country) {
      const found = getCountry(country);
      if (found) return found;
    }
    const detected = detectCountryFromPhone(value);
    if (detected) return detected;
    return getCountry('SG') || { code: 'SG', name: 'Singapore', flag: '🇸🇬', dialCode: '+65' };
  }, [country, value]);

  // Filter countries for search
  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [search]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelectCountry = (selected) => {
    if (onCountryChange) {
      onCountryChange(selected.name);
    }
    const updatedPhone = applyCountryDialCode(value, selected.name);
    if (onChange) {
      onChange(updatedPhone);
    }
    setIsOpen(false);
    setSearch('');
  };

  const handleInputChange = (e) => {
    const inputVal = e.target.value;
    if (onChange) {
      onChange(inputVal);
    }
    // If the user typed a known dial code, auto-sync country
    const detected = detectCountryFromPhone(inputVal);
    if (detected && detected.name !== country && onCountryChange) {
      onCountryChange(detected.name);
    }
  };

  const computedPlaceholder = placeholder || `e.g. ${activeCountry.dialCode} 8000 0000`;

  const bgStyle = darkMode
    ? 'bg-ink/60 border-line text-fg focus-within:border-sky'
    : 'bg-white border-slate-300 text-slate-800 focus-within:border-blue-400 focus-within:ring-3 focus-within:ring-blue-100';

  const btnStyle = darkMode
    ? 'hover:bg-panel border-r border-line text-fg'
    : 'hover:bg-slate-50 border-r border-slate-200 text-slate-700';

  const dropdownBg = darkMode
    ? 'bg-panel border-line text-fg shadow-2xl'
    : 'bg-white border-slate-200 text-slate-800 shadow-xl';

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div
        className={`flex items-center rounded-xl border transition-all overflow-hidden ${bgStyle} ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        {/* Dial Code Selector Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
          className={`px-3 py-2.5 flex items-center gap-1.5 text-xs font-semibold shrink-0 transition-colors cursor-pointer select-none ${btnStyle}`}
          title="Select Country & Dial Code"
          aria-expanded={isOpen}
        >
          <span className="text-base leading-none">{activeCountry.flag}</span>
          <span className="font-mono text-xs">{activeCountry.dialCode}</span>
          <svg
            className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180 text-blue-500' : 'text-slate-400'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Phone Input */}
        <input
          id={id}
          name={name}
          type="tel"
          required={required}
          disabled={disabled}
          value={value}
          onChange={handleInputChange}
          placeholder={computedPlaceholder}
          className="flex-1 min-w-0 px-3 py-2.5 bg-transparent text-xs outline-none placeholder-slate-400 font-mono tracking-tight"
        />
      </div>

      {/* Country Selection Dropdown Popover */}
      {isOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-72 sm:w-80 rounded-xl border z-50 p-2 text-xs flex flex-col max-h-72 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100 ${dropdownBg}`}
        >
          {/* Search Bar */}
          <div className="relative mb-2 shrink-0">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search country or dial code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none ${
                darkMode
                  ? 'bg-ink/80 border-line text-fg placeholder:text-muted focus:border-sky'
                  : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:bg-white'
              }`}
            />
            <svg
              className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {/* Quick country chips (when not searching) */}
          {!search && (
            <div className="flex flex-wrap gap-1 mb-2 pb-2 border-b border-slate-100 dark:border-line shrink-0">
              {QUICK_COUNTRIES.map((cCode) => {
                const c = getCountry(cCode);
                if (!c) return null;
                const isSelected = activeCountry.code === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleSelectCountry(c)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white font-semibold'
                        : darkMode
                        ? 'bg-ink hover:bg-slate-700 text-slate-300'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <span>{c.flag}</span>
                    <span>{c.dialCode}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Full List */}
          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {filteredCountries.length === 0 ? (
              <div className="py-4 text-center text-slate-400 text-xs">No matching countries</div>
            ) : (
              filteredCountries.map((c) => {
                const isSelected = activeCountry.code === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleSelectCountry(c)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-blue-700 font-semibold dark:bg-sky/20 dark:text-sky'
                        : darkMode
                        ? 'hover:bg-ink/70 text-slate-200'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate pr-2">
                      <span className="text-sm shrink-0">{c.flag}</span>
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="font-mono text-[11px] font-semibold shrink-0 text-blue-600 dark:text-sky">
                      {c.dialCode}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

