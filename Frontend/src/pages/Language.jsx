import { useMemo, useState } from 'react'

const languages = [
  { code: 'EN', name: 'English', native: 'English' },
  { code: 'ZH', name: 'Chinese', native: '中文' },
  { code: 'MS', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'TA', name: 'Tamil', native: 'தமிழ்' },
  { code: 'BN', name: 'Bangla', native: 'বাংলা' },
]

const stars = [
  { top: '8%', left: '12%', size: 2, delay: '0s' },
  { top: '14%', left: '78%', size: 2.5, delay: '0.4s' },
  { top: '22%', left: '30%', size: 1.5, delay: '0.8s' },
  { top: '28%', left: '88%', size: 2, delay: '1.2s' },
  { top: '45%', left: '6%', size: 2, delay: '0.2s' },
  { top: '52%', left: '94%', size: 1.5, delay: '1s' },
  { top: '68%', left: '18%', size: 2.5, delay: '0.6s' },
  { top: '74%', left: '72%', size: 2, delay: '1.4s' },
  { top: '86%', left: '42%', size: 1.5, delay: '0.3s' },
  { top: '18%', left: '55%', size: 1.5, delay: '0.9s' },
  { top: '38%', left: '48%', size: 2, delay: '1.1s' },
  { top: '60%', left: '58%', size: 1.5, delay: '0.5s' },
]

const Language = ({ onContinue }) => {
  const [selected, setSelected] = useState('EN')

  const starNodes = useMemo(
    () =>
      stars.map((star, index) => (
        <span
          key={index}
          className="pointer-events-none absolute rounded-full bg-[#7eb6ff] animate-soft-pulse"
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
            animationDelay: star.delay,
            boxShadow: '0 0 8px rgba(126, 182, 255, 0.65)',
          }}
          aria-hidden="true"
        />
      )),
    [],
  )

  const handleContinue = () => {
    const language = languages.find((item) => item.code === selected)
    sessionStorage.setItem('skillbridge_language', JSON.stringify(language))
    onContinue?.(language)
  }

  return (
    <main className="relative isolate flex min-h-svh w-full items-center justify-center overflow-hidden px-4 py-10 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_55%_at_50%_0%,#1b3b72_0%,#0d2248_42%,#081530_100%)]"
        aria-hidden="true"
      />
      {starNodes}

      <div className="animate-rise-in relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center">
        <header className="mb-8 max-w-2xl text-center sm:mb-10">
          <h1 className="font-display text-[clamp(1.85rem,4vw,2.6rem)] font-bold tracking-[-0.02em] text-white">
            Choose Your Language
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[#9eb0cc] sm:text-base">
            Select your preferred language for an immersive AI learning experience
          </p>
        </header>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {languages.map((language, index) => {
            const active = selected === language.code
            return (
              <button
                key={language.code}
                type="button"
                onClick={() => setSelected(language.code)}
                className={`group animate-rise-in flex min-h-[88px] cursor-pointer items-center gap-4 rounded-2xl border px-5 py-4 text-left transition duration-300 ${
                  active
                    ? 'border-[#ff8c21]/70 bg-[rgba(255,140,33,0.12)] shadow-[0_0_0_1px_rgba(255,140,33,0.25),0_12px_30px_rgba(0,0,0,0.25)]'
                    : 'border-white/10 bg-[rgba(22,42,78,0.45)] hover:border-white/25 hover:bg-[rgba(30,54,96,0.55)]'
                }`}
                style={{ animationDelay: `${Math.min(index, 11) * 0.04}s` }}
                aria-pressed={active}
              >
                <span
                  className={`font-display text-[28px] font-bold tracking-wide transition ${
                    active ? 'text-[#ff8c21]/80' : 'text-[#4d6488]'
                  }`}
                >
                  {language.code}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-display text-[17px] font-semibold text-white">
                    {language.name}
                  </span>
                  <span
                    className={`truncate text-[14px] ${
                      active ? 'text-[#ffb347]/90' : 'text-[#8fa3c0]'
                    }`}
                    dir="auto"
                  >
                    {language.native}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={handleContinue}
          className="mt-9 flex cursor-pointer items-center justify-center gap-2 rounded-full border border-white/10 bg-[rgba(16,30,58,0.9)] px-10 py-3.5 font-display text-[15px] font-semibold text-white shadow-[0_12px_30px_rgba(0,0,0,0.28)] transition hover:border-[#ff8c21]/40 hover:bg-[rgba(22,40,72,0.95)] hover:shadow-[0_0_24px_rgba(255,140,33,0.18)] active:scale-[0.99] sm:mt-10 sm:px-12"
        >
          Continue
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </main>
  )
}

export default Language
