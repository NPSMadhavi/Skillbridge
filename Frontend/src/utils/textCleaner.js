/**
 * Utility to clean unsupported words, markdown artifacts, prompt leakage,
 * and OCR artifacts from course text, titles, and speech.
 */

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu;

export const PLACEHOLDER_PATTERN = /\b(?:Text|Date|Footer|Slide(?:\s*Number)?|Title|Header|Sub-Title|Picture|Object|Shape|Media|Table|Content)?\s*Placeholder(?:\s*\d+)?\b/i;

export function stripSlidePlaceholders(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Strip Visual Content markers, descriptions, and full slide presentation placeholders
    .replace(/\[Visual Content on [^\]]+\]:\s*Full slide presentation[^\n]*/gi, ' ')
    .replace(/\[Visual Content on [^\]]+\]:?[^\n]*/gi, ' ')
    .replace(/Visual Content on:?[^\n]*/gi, ' ')
    .replace(/Full slide presentation[^\n]*/gi, ' ')
    .replace(/\[Speaker Notes for [^\]]+\]:?/gi, ' ')
    // Strip slide divider tags
    .replace(/---+\s*Slide\s*\d+[^-\n]*---+/gi, ' ')
    .replace(/Slide\s*\d+:?\s*---+/gi, ' ')
    .replace(/Slide\s*\d+:\s*/gi, ' ')
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
    // Deduplicate immediately repeated tokens/titles (e.g. "NatSteel NatSteel" -> "NatSteel")
    .replace(/\b([A-Za-z0-9_]{3,})\s+\1\b/gi, '$1')
    .replace(/\s*-\s*-\s*-\s*/g, ' ')
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
    .replace(/\[Visual Content on [^\]]+\]:\s*Full slide presentation[^\n]*/gi, '')
    .replace(/\[Visual Content on [^\]]+\]:?[^\n]*/gi, '')
    .replace(/Visual Content on:?[^\n]*/gi, '')
    .replace(/Full slide presentation[^\n]*/gi, '')
    .replace(/\[PAGE\s*\d+[^\]]*\]/gi, '')
    .replace(/\[Topic:[^\]]*\]/gi, '')
    .replace(/\[Concept:[^\]]*\]/gi, '')
    .replace(/\*?\(Source:[^\)]*\)\*?/gi, '')
    .replace(/\*?\(Reference:[^\)]*\)\*?/gi, '')
    // Deduplicate consecutive words
    .replace(/\b([A-Za-z0-9_]{3,})\s+\1\b/gi, '$1')
    .replace(/\s*-\s*-\s*-\s*/g, ' ')
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
  let cleaned = stripSlidePlaceholders(cleanUnsupportedWords(text))
    // Expand common acronyms & abbreviations for crystal-clear teacher articulation
    .replace(/\bPPE\b/g, 'P.P.E.')
    .replace(/\bSOP\b/g, 'S.O.P.')
    .replace(/\bCSM\b/g, 'Contractor Safety Management')
    .replace(/\bEHS\b/g, 'E.H.S.')
    .replace(/\bHSE\b/g, 'H.S.E.')
    .replace(/\bOSHA\b/g, 'O.S.H.A.')
    .replace(/\bLOTO\b/g, 'Lockout Tagout')
    .replace(/\bSWP\b/g, 'Safe Work Procedure')
    .replace(/\bJSA\b/g, 'Job Safety Analysis')
    .replace(/\bJHA\b/g, 'Job Hazard Analysis')
    .replace(/\bPTW\b/g, 'Permit to Work')
    .replace(/\be\.g\.,?\b/gi, 'for example, ')
    .replace(/\bi\.e\.,?\b/gi, 'that is, ')
    .replace(/\betc\.\b/gi, 'and so forth.')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\bapprox\.?\b/gi, 'approximately')
    .replace(/\bmin\b/gi, 'minutes')
    .replace(/\bsec\b/gi, 'seconds')
    .replace(/\bhr\b/gi, 'hours')
    .replace(/%/g, ' percent')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/\b°C\b/gi, ' degrees Celsius')
    .replace(/\b°F\b/gi, ' degrees Fahrenheit')
    // Remove formatting characters while preserving natural sentence pauses (. , ! ? ; :)
    .replace(/[#*•➔>~`^|_/\\\[\]{}()]+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}
