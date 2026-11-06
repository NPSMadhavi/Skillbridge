/**
 * Utility to clean unsupported words, markdown artifacts, prompt leakage,
 * and OCR artifacts from course text, titles, and speech.
 */

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu;

export const PLACEHOLDER_PATTERN = /\b(?:Text|Date|Footer|Slide(?:\s*Number)?|Title|Header|Sub-Title|Picture|Object|Shape|Media|Table|Content)?\s*Placeholder(?:\s*\d+)?\b/i;

export function stripSlidePlaceholders(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Strip PowerPoint placeholder tags (e.g. "- Text Placeholder 2", "Date Placeholder 3", "Footer Placeholder 4", "Slide Number Placeholder 5")
    .replace(/(?:[-*•➔,;|\s]*\b(?:Text|Date|Footer|Slide(?:\s*Number)?|Title|Header|Sub-Title|Picture|Object|Shape|Media|Table|Content)?\s*Placeholder(?:\s*\d+)?\b)+/gi, ' ')
    // Strip slide number artifacts like "- Slide 2 -", "- Slide Number 5", etc.
    .replace(/(?:[-*•➔,;|\s]*\bSlide\s*(?:Number\s*)?\d+\b)+/gi, ' ')
    // Strip trailing or incomplete slide references like "- Slide..." or "- Slide"
    .replace(/[-*•➔,;|\s]+\bSlide(?:\s*\.{2,})?$/gi, '')
    // Strip Windows file paths, temporary internet files, Content.MSO, AppData, etc.
    .replace(/(?:[-*•➔\s]*[A-Za-z]:\\[^\n\r"']*(?:Content\.MSO|\.tmp|Temporary Internet Files|AppData)[^\n\r"']*)+/gi, ' ')
    .replace(/[A-Za-z]:\\[^\s\n"']+/gi, ' ')
    // Strip template click prompts and master slide hierarchy tokens
    .replace(/Click\s+to\s+(?:add|edit)\s+[^\n.,;]+/gi, ' ')
    .replace(/\b(?:First|Second|Third|Fourth|Fifth)\s+level\b/gi, ' ')
    .replace(/\bClick\s+to\s+edit\s+Master\s+(?:title|text)\s+styles\b/gi, ' ')
    // Normalize spaces and strip leading/trailing stray symbols
    .replace(/[ \t]+/g, ' ')
    .replace(/^[\s\-•*➔,;|:]+/, '')
    .replace(/[\s\-•*➔,;|:]+$/, '')
    .trim();
}

export function cleanUnsupportedWords(text, fallback = '') {
  if (!text || typeof text !== 'string') return fallback;

  let t = stripSlidePlaceholders(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Remove markdown formatting asterisks and headers
    .replace(/\*\*+/g, '')
    .replace(/###+/g, '')
    .replace(/[`_~]/g, '')
    // Strip placeholder tokens and file paths
    .replace(/(?:[-*•➔,;|\s]*\b(?:Text|Date|Footer|Slide(?:\s*Number)?|Title|Header|Sub-Title|Picture|Object|Shape|Media|Table|Content)?\s*Placeholder(?:\s*\d+)?\b)+/gi, ' ')
    .replace(/(?:[-*•➔,;|\s]*\bSlide\s*(?:Number\s*)?\d+\b)+/gi, ' ')
    .replace(/[-*•➔,;|\s]+\bSlide(?:\s*\.{2,})?$/gi, '')
    .replace(/(?:[-*•➔\s]*[A-Za-z]:\\[^\n\r"']*(?:Content\.MSO|\.tmp|Temporary Internet Files|AppData)[^\n\r"']*)+/gi, ' ')
    .replace(/[A-Za-z]:\\[^\s\n"']+/gi, ' ')
    // Remove prompt instructions leaked from LLM / vision models
    .replace(/^From this image[,:]?\s*(a trainer should teach about the following:?)?/i, '')
    .replace(/^What a trainer should teach\s*(from this picture|about the following)?:?/i, '')
    .replace(/^The three images show:?/i, '')
    .replace(/^The image shows\s*(a workshop area with the following visible elements:?)?/i, '')
    .replace(/^The image shows\s*[^:\n]+:\s*/i, '')
    .replace(/^This picture illustrates:?/i, '')
    .replace(/^(?:On the left side|On the right side|At the bottom|At the top)[^:\n]*:\s*/i, '')
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

  return stripSlidePlaceholders(t) || fallback;
}

export function cleanForSpeech(text) {
  if (!text) return '';
  return stripSlidePlaceholders(cleanUnsupportedWords(text))
    .replace(/[#*•➔>+:\-_/\\|~`^]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
