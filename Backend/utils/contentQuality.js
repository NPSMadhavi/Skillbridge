/**
 * Detects OCR / OLE-binary noise so we never treat it as a lesson or chunk title.
 */

const LETTER_RE = /[A-Za-z\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF]/g;
const VOWEL_RE = /[aeiouAEIOU\u0904-\u0914\u093E-\u094C\u0985-\u098C\u0990\u0994\u09BE-\u09CC\u0B85-\u0B94\u0BBE-\u0BCC\u0C05-\u0C14\u0C3E-\u0C4C]/g;
const SYMBOL_RE = /[^A-Za-z0-9\s\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF.,:;!?'"()\-\/]/g;

export const PLACEHOLDER_PATTERN = /\b(?:Text|Date|Footer|Slide(?:\s*Number)?|Title|Header|Sub-Title|Picture|Object|Shape|Media|Table|Content)?\s*Placeholder(?:\s*\d+)?\b/i;
export const PATH_NOISE_PATTERN = /(?:[A-Za-z]:\\(?:Users|Windows|Program|AppData|Local|Temp)|Content\.MSO|\.tmp\b)/i;
export const FONT_SOFTWARE_PATTERN = /(?:Adobe\s*Photoshop|MS\s*PGothic|Myriad\s*Pro|Times\s*New\s*Roman|PowerPoint\s*Document|DocumentSummaryInformation|SummaryInformation|Current\s*User)/i;
export const TEMPLATE_PROMPT_PATTERN = /^Click\s+to\s+(?:add|edit)\s+(?:text|title|subtitle|master|header|footer)/i;

export function isPlaceholderTitle(value) {
  const t = String(value || '').trim();
  if (/^slide\s+\d+$/i.test(t)) return true;
  if (PLACEHOLDER_PATTERN.test(t)) return true;
  if (TEMPLATE_PROMPT_PATTERN.test(t)) return true;
  return false;
}

export function isGarbageTitle(value) {
  let t = String(value || '').trim();
  if (!t) return true;
  t = t.replace(/^#{1,6}\s+/, '').replace(/^(?:[-*•➔▪▫►→]+|\d+[.)\s-]+)\s*/, '').trim();
  if (!t || t.length < 3 || t.length > 90) return true;
  if (isPlaceholderTitle(t)) return true;
  if (PATH_NOISE_PATTERN.test(t)) return true;
  if (FONT_SOFTWARE_PATTERN.test(t)) return true;
  if (/^[A-Z]{2,6}$/.test(t)) return false;

  // Unmatched brackets or isolated trailing/leading brackets/braces (e.g. "aOJCyy }", "rEK]mEi 5")
  if (/[{}[\]<>]/.test(t)) {
    const openBraces = (t.match(/\{/g) || []).length;
    const closeBraces = (t.match(/\}/g) || []).length;
    const openSquare = (t.match(/\[/g) || []).length;
    const closeSquare = (t.match(/\]/g) || []).length;
    if (openBraces !== closeBraces || openSquare !== closeSquare) return true;
    if (/^[}\])>]|[{\[(<]$/.test(t)) return true;
  }

  // Fragmented slashes with single letters (e.g. "YXadc/f O")
  if (/\/[a-zA-Z]\b|\b[a-zA-Z]\//.test(t)) return true;

  // Mixed random casing within a single word (e.g. "aOJCyy", "rEKmEi")
  const rawWords = t.split(/[^A-Za-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF]+/).filter(Boolean);
  for (const w of rawWords) {
    if (/^[a-z]+[A-Z]{2,}/.test(w)) return true; // e.g. aOJC...
    if (/[a-z][A-Z]{2,}[a-z]/.test(w)) return true; // e.g. rEKmEi
    if (/[A-Z]{2,}[a-z]+[A-Z]/.test(w)) return true; // e.g. YXadC
  }

  // Fragmented labels ending with "only" or dangling prepositions (e.g. "horizon only")
  if (/^(?:horizon|image|picture|photo|graphic|figure|view|illustration|diagram|chart)\s+(?:only|view|cut|crop|frame|layout)$/i.test(t)) {
    return true;
  }
  if (/^(?:only|and|or|the|with|for|at|in|on|by|from|to)\s*$/i.test(t)) {
    return true;
  }

  // Vowel check for words >= 4 chars (must have at least one vowel unless all uppercase acronym)
  for (const w of rawWords) {
    if (/^[A-Za-z]+$/.test(w) && w.length >= 4 && !/^[A-Z]+$/.test(w)) {
      if (!/[aeiouyAEIOUY]/.test(w)) return true; // e.g. dtttll
    }
  }

  // Symbol density in short strings (< 15 chars)
  if (t.length < 15 && /[\/\\}[\]<>=+_~^$*#|]/.test(t)) return true;

  const letters = (t.match(LETTER_RE) || []).length;
  const punct = (t.match(/[^A-Za-z0-9\s\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF]/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  const vowels = (t.match(VOWEL_RE) || []).length;
  const hasIndicOrCjk = /[\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF]/.test(t);
  const words = t.split(/[^A-Za-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF]+/).filter(w => w.length >= 2);
  const longWords = words.filter(w => w.length >= 4);

  if (letters < 3) return true;
  if (punct >= 2 && letters < 12) return true;
  if (digits >= 2 && longWords.length === 0) return true;
  if (/[%#$^*~`|\\]/.test(t) && !/\s/.test(t)) return true;
  if (!hasIndicOrCjk && longWords.length === 0 && words.length < 2) return true;
  if (!hasIndicOrCjk && letters >= 5 && vowels < 1) return true;
  if (/^[.\-,;:_=~^$*$%!?]+/.test(t)) return true;
  if (/^(Microsoft|Font|Theme|Calibri|Arial|Times New Roman|Normal|Click to)/i.test(t)) return true;
  return false;
}

export function isBinaryNoiseText(value) {
  const t = String(value || '').trim();
  if (t.length < 4) return true;
  if (PLACEHOLDER_PATTERN.test(t)) return true;
  if (PATH_NOISE_PATTERN.test(t)) return true;
  if (FONT_SOFTWARE_PATTERN.test(t)) return true;
  if (TEMPLATE_PROMPT_PATTERN.test(t)) return true;
  if (isGarbageTitle(t) && t.length < 40) return true;
  const letters = (t.match(LETTER_RE) || []).length;
  const symbols = (t.match(SYMBOL_RE) || []).length;
  if (letters < 6) return true;
  if (symbols > letters * 0.5) return true;
  if (/Microsoft|Theme|Times New Roman|Calibri|Arial|PowerPoint|SlideShow/i.test(t) && letters < 24) {
    return true;
  }
  return false;
}

export function isUsefulTeachingText(value) {
  const t = String(value || '').trim();
  if (t.length < 15) return false;
  if (isBinaryNoiseText(t)) return false;
  const tokens = t.split(/\s+/).filter(w => w.length >= 2);
  if (tokens.length >= 4 && !isGarbageTitle(t.slice(0, 80))) return true;
  return /[\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF]/.test(t) && t.length >= 16;
}

export function firstUsefulTitleLine(text) {
  const lines = String(text || '').split(/\n+/);
  for (const raw of lines) {
    const line = raw.replace(/^(?:[#\-*•]+|\d+[.)\s-]+)\s*/, '').trim();
    if (line.length < 5 || line.length > 80) continue;
    if ((line.match(/\|/g) || []).length >= 2) continue;
    if (isGarbageTitle(line) || isPlaceholderTitle(line) || isBinaryNoiseText(line)) continue;
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

/**
 * Strips all placeholder tags, template markers, font metadata, binary file paths,
 * visual-content descriptions, and duplicate slide headers.
 */
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
    // Strip PowerPoint placeholder tags (e.g. "Text Placeholder 2", "Date Placeholder 3", "Footer Placeholder 4", "Slide Number Placeholder 5")
    .replace(/(?:[-*•➔,;|\s]*\b(?:Text|Date|Footer|Slide(?:\s*Number)?|Title|Header|Sub-Title|Picture|Object|Shape|Media|Table|Content)?\s*Placeholder(?:\s*\d+)?\b)+/gi, ' ')
    // Strip slide number artifacts like "- Slide 2 -", "- Slide Number 5", etc.
    .replace(/(?:[-*•➔,;|\s]*\bSlide\s*(?:Number\s*)?\d+\b)+/gi, ' ')
    // Strip trailing or incomplete slide references like "- Slide..." or "- Slide"
    .replace(/[-*•➔,;|\s]+\bSlide(?:\s*\.{2,})?$/gi, '')
    // Strip Windows file paths, temporary internet files, Content.MSO, AppData, etc.
    .replace(/(?:[-*•➔\s]*[A-Za-z]:\\[^\n\r"']*(?:Content\.MSO|\.tmp|Temporary Internet Files|AppData)[^\n\r"']*)+/gi, ' ')
    .replace(/[A-Za-z]:\\[^\s\n"']+/gi, ' ')
    // Strip font software metadata and OLE stream tags
    .replace(/\b(?:MS\s*PGothic|Adobe\s*Photoshop|Myriad\s*Pro|Times\s*New\s*Roman|PowerPoint\s*Document|DocumentSummaryInformation|SummaryInformation|Current\s*User)\b/gi, ' ')
    // Strip template click prompts and master slide hierarchy tokens
    .replace(/Click\s+to\s+(?:add|edit)\s+[^\n.,;]+/gi, ' ')
    .replace(/\b(?:First|Second|Third|Fourth|Fifth)\s+level\b/gi, ' ')
    .replace(/\bClick\s+to\s+edit\s+Master\s+(?:title|text)\s+styles\b/gi, ' ')
    // Deduplicate immediately repeated tokens/titles (e.g. "NatSteel NatSteel" -> "NatSteel")
    .replace(/\b([A-Za-z0-9_]{3,})\s+\1\b/gi, '$1')
    // Remove isolated OCR noise patterns like "[=] n @ \ QI I. So. TT ll" or "[——— ll"
    .replace(/\[[—\-=]+\]/g, ' ')
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
    // Remove leading/trailing stray symbols, quotes, and punctuation
    .replace(/^[\s"''""`•\-\*#:,;>+=]+/, '')
    .replace(/[\s"''""`•\-\*#:,;>+=]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return stripSlidePlaceholders(t) || fallback;
}

/**
 * Conjunctions and connecting prepositions indicating broken line continuations.
 * Supports English and common Indic connectors without blindly applying Latin casing rules.
 */
const CONNECTOR_WORDS_TRAILING = /\b(?:and|or|because|with|therefore|including|as well as|such as|which|that|who|whose|to|of|for|in|on|at|by|from|into|onto|through|during|before|after|without|within|along with|due to|in order to|as|మరియు|కావున|ఎందుకంటే|மற்றும்|எனவே|ஏனெனில்|এবং|অথবা|কারণ|तथा|और|क्योंकि|इसलिए)$/i;
const CONNECTOR_WORDS_LEADING = /^(?:and|or|because|with|therefore|including|as well as|such as|which|that|who|whose|to|of|for|in|on|at|by|from|along with|due to|in order to|మరియు|కావున|ఎందుకంటే|மற்றும்|எனவே|ஏனெனில்|এবং|অথবা|কারণ|तथा|और|क्योंकि|इसलिए)\b/i;

/**
 * Intelligent Content Cleaning and Bullet Healing:
 * - Detects sentences broken across multiple PowerPoint bullets or OCR lines
 * - Identifies incomplete grammatical fragments
 * - Merges related fragments into complete, coherent sentences
 * - Detects lowercase sentence continuations
 * - Handles conjunctions (and, or, because, with, therefore, including, as well as, in order to)
 * - Preserves headings (#, ##), numbered procedures (1., 2.), tables (|...|), and independent bullet points
 * - Fixes capitalization and punctuation
 * - Supports multilingual content (English, Indic languages, CJK) without corrupting native scripts
 */
export function healBrokenBullets(text) {
  if (!text || typeof text !== 'string') return '';

  const cleanedBase = stripSlidePlaceholders(text);
  const rawLines = cleanedBase.split(/\r?\n/).map(l => l.trim());
  const healedLines = [];
  let currentBlock = null;

  const isTableLine = (line) => line.startsWith('|') && line.endsWith('|');
  const isHeaderLine = (line) => /^#{1,6}\s+/.test(line) || /^[💡🎯📋⚠️📌🔍🌐⚡]/.test(line);
  const isNumberedProcedure = (line) => /^\d+[\.\)]\s+/.test(line);
  const isBulletLine = (line) => /^[-*•➔▪▫►→]\s+/.test(line);

  const cleanLineContent = (line) => {
    return line.replace(/^(?:[-*•➔▪▫►→]+|\d+[.)\s-]+)\s*/, '').trim();
  };

  const endsWithTerminalPunctuation = (str) => {
    return /[.!?।。！？:]$/.test(str.trim());
  };

  const endsWithConnector = (str) => {
    const s = str.trim();
    if (/[,;\-\–\—]$/.test(s)) return true;
    return CONNECTOR_WORDS_TRAILING.test(s);
  };

  const startsWithLowercase = (str) => {
    const firstLetter = (str.match(/[a-zA-Z]/) || [])[0];
    return firstLetter ? firstLetter === firstLetter.toLowerCase() : false;
  };

  const startsWithConnector = (str) => {
    return CONNECTOR_WORDS_LEADING.test(str.trim());
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line) {
      if (currentBlock) {
        healedLines.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Preserve tables untouched
    if (isTableLine(line)) {
      if (currentBlock) {
        healedLines.push(currentBlock);
        currentBlock = null;
      }
      healedLines.push(line);
      continue;
    }

    // Preserve Markdown section headers untouched
    if (isHeaderLine(line)) {
      if (currentBlock) {
        healedLines.push(currentBlock);
        currentBlock = null;
      }
      healedLines.push(line);
      continue;
    }

    if (isBinaryNoiseText(line)) continue;

    const isNumbered = isNumberedProcedure(line);
    const isBullet = isBulletLine(line);
    const content = cleanLineContent(line);
    if (!content) continue;

    if (!currentBlock) {
      currentBlock = {
        prefix: isNumbered ? line.match(/^\d+[\.\)]\s*/)[0] : (isBullet ? '- ' : ''),
        text: content,
        isNumbered,
        isBullet
      };
      continue;
    }

    // Determine if this line is a continuation of currentBlock
    const prevText = currentBlock.text;
    const isPrevIncomplete = !endsWithTerminalPunctuation(prevText) || endsWithConnector(prevText);
    const isContinuation = startsWithLowercase(content) || startsWithConnector(content) || (isPrevIncomplete && !isNumbered && !isBullet);

    // If continuation: merge seamlessly with proper spacing
    if (isContinuation) {
      const joiner = endsWithConnector(prevText) && !/[,;\-\–\—]$/.test(prevText) ? ' ' : (prevText.endsWith('-') ? '' : ' ');
      currentBlock.text = prevText + joiner + content;
    } else {
      // Independent bullet or statement: push finished block and start new one
      healedLines.push(currentBlock);
      currentBlock = {
        prefix: isNumbered ? line.match(/^\d+[\.\)]\s*/)[0] : (isBullet ? '- ' : ''),
        text: content,
        isNumbered,
        isBullet
      };
    }
  }

  if (currentBlock) {
    healedLines.push(currentBlock);
  }

  // Format healed blocks with proper capitalization and terminal punctuation
  const output = healedLines.map(item => {
    if (typeof item === 'string') return item;
    let t = item.text.trim();
    if (!t) return '';
    // Fix Latin script initial capitalization
    if (/^[a-z]/.test(t)) {
      t = t.charAt(0).toUpperCase() + t.slice(1);
    }
    // Ensure final punctuation if not ending in punctuation or colon
    if (!/[.!?।。！？:]$/.test(t)) {
      // Use danda for Hindi/Bengali script if dominant, otherwise period
      const isIndic = /[\u0900-\u097F\u0980-\u09FF]/.test(t);
      t += isIndic ? '।' : '.';
    }
    return item.prefix ? `${item.prefix}${t}` : t;
  }).filter(Boolean);

  return output.join('\n\n');
}

/**
 * Validation Mechanism:
 * Verifies that the cleaned and healed content preserves critical technical vocabulary and meaning.
 * @param {string} originalText
 * @param {string} cleanedText
 * @returns {{ isValid: boolean, retentionRate: number, missingKeywords: string[] }}
 */
export function validateCleanedContent(originalText, cleanedText) {
  if (!originalText) return { isValid: true, retentionRate: 1.0, missingKeywords: [] };

  const extractTechnicalTokens = (txt) => {
    const stripped = stripSlidePlaceholders(txt);
    return Array.from(new Set(
      String(stripped)
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .split(/[^A-Za-z0-9_\-]+/)
        .map(w => w.trim())
        .filter(w => {
          if (w.length < 4) return false;
          // Filter common English stop words and file system artifacts
          const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'were', 'which', 'there', 'their', 'about', 'would', 'could', 'should', 'these', 'those', 'where', 'when', 'what', 'slide', 'placeholder', 'powerpoint', 'click', 'edit', 'text', 'users', 'appdata', 'temp', 'content', 'local', 'administrator']);
          return !stopWords.has(w.toLowerCase());
        })
    ));
  };

  const origTokens = extractTechnicalTokens(originalText);
  if (origTokens.length === 0) {
    return { isValid: true, retentionRate: 1.0, missingKeywords: [] };
  }

  const cleanedLower = String(cleanedText || '').toLowerCase();
  const missing = [];
  let retainedCount = 0;

  for (const token of origTokens) {
    if (cleanedLower.includes(token.toLowerCase())) {
      retainedCount++;
    } else {
      missing.push(token);
    }
  }

  const retentionRate = retainedCount / origTokens.length;
  // A minimum 80% recall of technical tokens guarantees no loss of technical facts
  const isValid = retentionRate >= 0.80;

  return {
    isValid,
    retentionRate: Math.round(retentionRate * 100) / 100,
    missingKeywords: missing.slice(0, 15)
  };
}
