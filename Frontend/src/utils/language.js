export const LANGUAGE_STORAGE_KEY = 'skillbridge_language'

export const LANGUAGE_OPTIONS = [
  { value: 'en', code: 'EN', name: 'English', native: 'English' },
  { value: 'zh', code: 'ZH', name: 'Chinese (中文)', native: '中文' },
  { value: 'ms', code: 'MS', name: 'Malay (Bahasa Melayu)', native: 'Bahasa Melayu' },
  { value: 'ta', code: 'TA', name: 'Tamil (தமிழ்)', native: 'தமிழ்' },
  { value: 'bn', code: 'BN', name: 'Bangla (বাংলা)', native: 'বাংলা' },
]

export function normalizeLanguageCode(pref) {
  if (!pref) return null
  const l = String(pref).toLowerCase().trim()
  if (l === 'zh' || l.includes('chinese') || l.includes('中文') || l === 'cn') return 'zh'
  if (l === 'ms' || l.includes('malay') || l.includes('melayu') || l === 'my') return 'ms'
  if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்')) return 'ta'
  if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা') || l === 'bd') return 'bn'
  if (l === 'en' || l.includes('english')) return 'en'
  return null
}

function parseStoredLanguage(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') {
      return normalizeLanguageCode(parsed)
    }
    return normalizeLanguageCode(parsed?.value || parsed?.code || parsed?.name || parsed?.label)
  } catch {
    return normalizeLanguageCode(raw)
  }
}

export function readStoredLanguageCode() {
  try {
    return (
      parseStoredLanguage(sessionStorage.getItem(LANGUAGE_STORAGE_KEY)) ||
      parseStoredLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY))
    )
  } catch {
    return null
  }
}

export function persistLanguageSelection(codeOrObj) {
  const code =
    typeof codeOrObj === 'string'
      ? normalizeLanguageCode(codeOrObj)
      : normalizeLanguageCode(codeOrObj?.value || codeOrObj?.code || codeOrObj?.name || codeOrObj?.label)

  if (!code) return null

  const option = LANGUAGE_OPTIONS.find((item) => item.value === code) || LANGUAGE_OPTIONS[0]
  const payload = JSON.stringify({
    value: option.value,
    code: option.code,
    name: option.name,
    native: option.native,
  })

  try {
    sessionStorage.setItem(LANGUAGE_STORAGE_KEY, payload)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, payload)
  } catch {
    // ignore quota / private-mode failures
  }

  return option.value
}

export function clearStoredLanguage() {
  try {
    sessionStorage.removeItem(LANGUAGE_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function hasStoredLanguage() {
  return Boolean(readStoredLanguageCode())
}

export function detectDominantScript(text) {
  if (!text) return 'en'
  const sample = String(text)
  const bn = (sample.match(/[\u0980-\u09FF]/g) || []).length
  const ta = (sample.match(/[\u0B80-\u0BFF]/g) || []).length
  const zh = (sample.match(/[\u4E00-\u9FFF]/g) || []).length
  const latin = (sample.match(/[A-Za-z]/g) || []).length
  const scored = [
    ['bn', bn],
    ['ta', ta],
    ['zh', zh],
    ['en', latin],
  ].sort((a, b) => b[1] - a[1])

  const [topCode, topCount] = scored[0]
  const secondCount = scored[1][1]
  if (topCount >= 12 && topCount >= secondCount * 0.45) return topCode
  if (topCode !== 'en' && topCount >= 8) return topCode
  return 'en'
}

export function textMatchesLanguage(text, languageCode) {
  if (!text || String(text).trim().length < 20) return false
  const requested = normalizeLanguageCode(languageCode) || String(languageCode || 'en').toLowerCase()
  const detected = detectDominantScript(text)
  if (requested === 'bn') return detected === 'bn'
  if (requested === 'ta') return detected === 'ta'
  if (requested === 'zh') return detected === 'zh'
  return detected === 'en' || detected === 'ms'
}
