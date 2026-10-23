/**
 * Utility to clean unsupported words, markdown artifacts, prompt leakage,
 * and OCR artifacts from course text, titles, and speech.
 */

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu;

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
    // Remove stray emojis
    .replace(EMOJI_REGEX, '')
    // Remove leading/trailing stray symbols, quotes, and punctuation
    .replace(/^[\s"''""`•\-\*#:,;>+=]+/, '')
    .replace(/[\s"''""`•\-\*#:,;>+=]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return t || fallback;
}

export function cleanForSpeech(text) {
  if (!text) return '';
  return cleanUnsupportedWords(text)
    .replace(/[#*•➔>+:\-_/\\|~`^]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
