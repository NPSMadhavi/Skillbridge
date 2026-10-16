export const LANGUAGE_INFO = {
  en: { code: 'en', name: 'English', speechCode: 'en-US' },
  zh: { code: 'zh', name: 'Chinese (中文)', speechCode: 'zh-CN' },
  ms: { code: 'ms', name: 'Malay (Bahasa Melayu)', speechCode: 'ms-MY' },
  ta: { code: 'ta', name: 'Tamil (தமிழ்)', speechCode: 'ta-IN' },
  bn: { code: 'bn', name: 'Bangla (বাংলা)', speechCode: 'bn-BD' },
};

export function resolveLanguageInfo(lang) {
  if (!lang) return LANGUAGE_INFO.en;

  if (typeof lang === 'object') {
    return resolveLanguageInfo(lang.code || lang.value || lang.name || lang.label);
  }

  const l = String(lang).toLowerCase().trim();

  if (l === 'en' || l === 'en-us' || l === 'en-gb' || l === 'english') return LANGUAGE_INFO.en;
  if (l === 'zh' || l === 'zh-cn' || l === 'cn' || l.includes('chinese') || l.includes('中文')) return LANGUAGE_INFO.zh;
  if (l === 'ms' || l === 'ms-my' || l === 'my' || l.includes('malay') || l.includes('melayu')) return LANGUAGE_INFO.ms;
  if (l === 'ta' || l === 'ta-in' || l.includes('tamil') || l.includes('தமிழ்')) return LANGUAGE_INFO.ta;
  if (l === 'bn' || l === 'bn-bd' || l === 'bd' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা')) {
    return LANGUAGE_INFO.bn;
  }

  return LANGUAGE_INFO.en;
}

export function detectDominantScript(text) {
  if (!text) return 'en';
  const sample = String(text);
  const bn = (sample.match(/[\u0980-\u09FF]/g) || []).length;
  const ta = (sample.match(/[\u0B80-\u0BFF]/g) || []).length;
  const zh = (sample.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const scored = [
    ['bn', bn],
    ['ta', ta],
    ['zh', zh],
    ['en', latin],
  ].sort((a, b) => b[1] - a[1]);

  const [topCode, topCount] = scored[0];
  const secondCount = scored[1][1];
  if (topCount >= 12 && topCount >= secondCount * 0.45) return topCode;
  if (topCode !== 'en' && topCount >= 8) return topCode;
  return 'en';
}

export function textMatchesLanguage(text, languageCode) {
  if (!text || String(text).trim().length < 20) return false;
  const requested = resolveLanguageInfo(languageCode).code;
  const detected = detectDominantScript(text);

  if (requested === 'bn') return detected === 'bn';
  if (requested === 'ta') return detected === 'ta';
  if (requested === 'zh') return detected === 'zh';
  // English / Malay are Latin; reject if Bangla, Tamil, or Chinese dominate the script
  return detected === 'en' || detected === 'ms';
}
