/**
 * Detects OCR / OLE-binary noise so we never treat it as a lesson or chunk title.
 */

const LETTER_RE = /[A-Za-z\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF]/g;
const VOWEL_RE = /[aeiouAEIOU\u0985-\u098C\u0990\u0994\u09BE-\u09CC]/g;
const SYMBOL_RE = /[^A-Za-z0-9\s\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF.,:;!?'"()\-\/]/g;

export function isPlaceholderTitle(value) {
  return /^slide\s+\d+$/i.test(String(value || '').trim());
}

export function isGarbageTitle(value) {
  let t = String(value || '').trim();
  if (!t) return true;
  t = t.replace(/^\d+[.)]\s*/, '').trim();
  if (!t || t.length < 3 || t.length > 90) return true;
  if (isPlaceholderTitle(t)) return true;
  if (/^[A-Z]{2,6}$/.test(t)) return false;

  const letters = (t.match(LETTER_RE) || []).length;
  const punct = (t.match(/[^A-Za-z0-9\s\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF]/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  const vowels = (t.match(VOWEL_RE) || []).length;
  const hasIndicOrCjk = /[\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF]/.test(t);
  const words = t.split(/[^A-Za-z\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF]+/).filter(w => w.length >= 3);
  const longWords = words.filter(w => w.length >= 4);

  if (letters < 3) return true;
  if (punct >= 2 && letters < 12) return true;
  if (digits >= 2 && longWords.length === 0) return true;
  if (/[%#$^*~`|\\]/.test(t) && !/\s/.test(t)) return true;
  if (!hasIndicOrCjk && longWords.length === 0 && words.length < 2) return true;
  if (!hasIndicOrCjk && letters >= 5 && vowels < 1) return true;
  if (/^[.\-,;:_=~^#*$%!?]+/.test(t)) return true;
  if (/^(Microsoft|Font|Theme|Calibri|Arial|Times New Roman|Normal|Click to)/i.test(t)) return true;
  return false;
}

export function isBinaryNoiseText(value) {
  const t = String(value || '').trim();
  if (t.length < 8) return true;
  if (isGarbageTitle(t) && t.length < 40) return true;
  const letters = (t.match(LETTER_RE) || []).length;
  const symbols = (t.match(SYMBOL_RE) || []).length;
  if (letters < 8) return true;
  if (symbols > letters * 0.5) return true;
  if (/Microsoft|Theme|Times New Roman|Calibri|Arial|PowerPoint|SlideShow/i.test(t) && letters < 24) {
    return true;
  }
  return false;
}

export function isUsefulTeachingText(value) {
  const t = String(value || '').trim();
  if (t.length < 24) return false;
  const tokens = t.split(/\s+/).filter(w => w.length >= 2);
  if (tokens.length >= 5 && !isGarbageTitle(t.slice(0, 80))) return true;
  return /[\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF]/.test(t) && t.length >= 16;
}

export function firstUsefulTitleLine(text) {
  const lines = String(text || '').split(/\n+/);
  for (const raw of lines) {
    const line = raw.replace(/^[#\-*•\d.)\s]+/, '').trim();
    if (line.length < 8 || line.length > 70) continue;
    if (isGarbageTitle(line) || isPlaceholderTitle(line)) continue;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;
    return line;
  }
  return '';
}

export function cleanFileStem(fileName) {
  return String(fileName || 'Course')
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Course';
}

export function cleanUnsupportedWords(text, fallback = '') {
  if (!text || typeof text !== 'string') return fallback;

  let t = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Remove markdown formatting asterisks and headers
    .replace(/\*\*+/g, '')
    .replace(/###+/g, '')
    .replace(/[`_~]/g, '')
    // Remove prompt instructions leaked from LLM / vision models
    .replace(/^From this image[,:]?\s*(a trainer should teach about the following:?)?/i, '')
    .replace(/^What a trainer should teach\s*(from this picture|about the following)?:?/i, '')
    .replace(/^The three images show:?/i, '')
    .replace(/^The image shows\s*(a workshop area with the following visible elements:?)?/i, '')
    .replace(/^This picture illustrates:?/i, '')
    .replace(/^Several large spools of wire[^:]*:\s*/i, 'Cable and Wire Storage: ')
    .replace(/^A floor marked with[^:]*:\s*/i, 'Forklift Access & Floor Markings: ')
    .replace(/^A desk or table with[^:]*:\s*/i, 'Workstation & Desk Organization: ')
    .replace(/^"?THANK YOU"?[^.]*\.?/i, 'Training Review and Conclusion')
    .replace(/^"?5S IS NO EASY[^"]*"?/i, '5S Commitment and Sustained Discipline')
    .replace(/Production Scoring Sheet\**/i, 'Workstation 5S Scoring Sheet')
    // Remove slide reference tags and metadata tokens
    .replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '')
    .replace(/Slide\s*\d+:\s*/gi, '')
    .replace(/\[PAGE\s*\d+[^\]]*\]/gi, '')
    .replace(/\[Topic:[^\]]*\]/gi, '')
    .replace(/\[Concept:[^\]]*\]/gi, '')
    .replace(/\*?\(Source:[^\)]*\)\*?/gi, '')
    .replace(/\*?\(Reference:[^\)]*\)\*?/gi, '')
    // Remove leading/trailing stray symbols, quotes, and punctuation
    .replace(/^[\s"''""`•\-\*#:,;>+=]+/, '')
    .replace(/[\s"''""`•\-\*#:,;>+=]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return t || fallback;
}

