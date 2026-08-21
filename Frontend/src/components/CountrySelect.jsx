import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'
import { COUNTRIES } from '../data/countries'

const CountrySelect = forwardRef(function CountrySelect(
  {
    id,
    value = '',
    onChange,
    onBlur,
    placeholder = 'Select a country...',
    hasError = false,
    disabled = false,
    className = '',
  },
  ref
) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const containerRef = useRef(null)
  const searchInputRef = useRef(null)
  const listRef = useRef(null)
  const internalId = useId()
  const selectId = id || internalId

  const selectedCountry = useMemo(() => {
    if (!value) return null
    return (
      COUNTRIES.find(
        (c) =>
          c.name.toLowerCase() === value.toLowerCase() ||
          c.code.toLowerCase() === value.toLowerCase()
      ) || { name: value, flag: '🌐', code: '' }
    )
  }, [value])

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return COUNTRIES
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    )
  }, [search])

  useEffect(() => {
    setHighlightedIndex(0)
  }, [search])

  useEffect(() => {
    if (isOpen) {
      // Focus search input on open
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    } else {
      setSearch('')
    }
  }, [isOpen])

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex, isOpen])

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (isOpen) {
          setIsOpen(false)
          onBlur?.()
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onBlur])

  const handleSelect = (country) => {
    onChange?.(country.name)
    setIsOpen(false)
    setSearch('')
    onBlur?.()
  }

  const handleKeyDown = (e) => {
    if (disabled) return

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev < filteredCountries.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCountries.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (filteredCountries[highlightedIndex]) {
          handleSelect(filteredCountries[highlightedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        onBlur?.()
        break
      case 'Tab':
        setIsOpen(false)
        onBlur?.()
        break
      default:
        break
    }
  }

  return (
    <div ref={containerRef} className="relative w-full text-left" onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={ref}
        id={selectId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev)
            if (isOpen) onBlur?.()
          }
        }}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-ink/50 px-4 py-3 text-[0.95rem] text-fg transition cursor-pointer outline-none ${
          hasError
            ? 'border-rose-400 focus:border-rose-500 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]'
            : isOpen
            ? 'border-sky bg-panel shadow-[0_0_0_3px_rgba(2,132,199,0.14)]'
            : 'border-line hover:border-sky/40 focus:border-sky focus:bg-panel focus:shadow-[0_0_0_3px_rgba(2,132,199,0.14)]'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
      >
        <span className="flex items-center gap-2.5 truncate">
          {selectedCountry ? (
            <>
              <span className="text-lg leading-none" aria-hidden="true">
                {selectedCountry.flag}
              </span>
              <span className="font-medium text-fg">{selectedCountry.name}</span>
            </>
          ) : (
            <span className="text-muted/60">{placeholder}</span>
          )}
        </span>

        <span className="flex items-center gap-1.5 text-muted shrink-0">
          {selectedCountry && (
            <span
              onClick={(e) => {
                e.stopPropagation()
                onChange?.('')
                onBlur?.()
              }}
              className="p-1 text-muted/60 hover:text-fg hover:bg-line/40 rounded-md transition"
              title="Clear selection"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </span>
          )}
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-sky' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl animate-rise-in">
          {/* Search Bar */}
          <div className="relative border-b border-line p-2.5 bg-ink/40">
            <span className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country name or code..."
              className="w-full rounded-xl border border-line bg-panel py-2 pr-8 pl-9 text-xs text-fg outline-none transition placeholder:text-muted/60 focus:border-sky focus:shadow-[0_0_0_2px_rgba(2,132,199,0.12)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-4 -translate-y-1/2 cursor-pointer p-1 text-muted/60 hover:text-fg"
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            )}
          </div>

          {/* Country Items List */}
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            className="max-h-60 overflow-y-auto p-1.5 text-sm outline-none"
          >
            {filteredCountries.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-muted">
                No countries found matching <span className="font-semibold text-fg">"{search}"</span>
              </li>
            ) : (
              filteredCountries.map((c, index) => {
                const isSelected =
                  value &&
                  (value.toLowerCase() === c.name.toLowerCase() ||
                    value.toLowerCase() === c.code.toLowerCase())
                const isHighlighted = index === highlightedIndex

                return (
                  <li
                    key={c.code || c.name}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(c)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer transition select-none ${
                      isSelected
                        ? 'bg-sky/15 text-sky font-semibold'
                        : isHighlighted
                        ? 'bg-ink text-fg'
                        : 'text-fg hover:bg-ink'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="text-lg leading-none" aria-hidden="true">
                        {c.flag}
                      </span>
                      <span className="truncate">{c.name}</span>
                      <span className="text-[11px] font-mono text-muted/70">{c.code}</span>
                    </div>

                    {isSelected && (
                      <svg
                        className="h-4 w-4 text-sky shrink-0"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
})

export default CountrySelect
