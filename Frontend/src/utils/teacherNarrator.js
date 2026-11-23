/**
 * Teacher Narrator Utility
 * Converts raw slide bullets, fragmented headings, and dense document notes
 * into warm, fluent, relevant instructional lectures spoken like a real teacher
 * instead of an AI reading a book fast.
 */

import { stripSlidePlaceholders, cleanUnsupportedWords } from './textCleaner.js';

/**
 * Clean a single line of raw slide text into conversational spoken text
 */
function cleanPhraseForSpeech(phrase) {
  if (!phrase || typeof phrase !== 'string') return '';
  return phrase
    .replace(/\[Visual Content on [^\]]+\]:\s*Full slide presentation[^\n]*/gi, '')
    .replace(/\[Visual Content on [^\]]+\]:?[^\n]*/gi, '')
    .replace(/Visual Content on:?[^\n]*/gi, '')
    .replace(/Full slide presentation[^\n]*/gi, '')
    .replace(/\[Speaker Notes for [^\]]+\]:?[^\n]*/gi, '')
    .replace(/^[-*•➔\d\.]+\s*/, '') // Remove bullet dots, dashes, numbers
    .replace(/[#*_~`^|<>]/g, '')     // Remove markdown syntax
    .replace(/\s*=\s*/g, ' means ')  // Convert = to "means"
    .replace(/\s*&\s*/g, ' and ')    // Convert & to "and"
    .replace(/\s*\/\s*/g, ' or ')    // Convert / to "or"
    .replace(/\s*->\s*/g, ', which leads to ')
    .replace(/\b([A-Za-z0-9_]{3,})\s+\1\b/gi, '$1') // Deduplicate immediate repeated words
    .replace(/\s*-\s*-\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DEFAULT_INTROS = {
  te: 'ఈ పాఠంలో, మనం ముఖ్యమైన అంశాలు మరియు సూత్రాలను వివరంగా నేర్చుకుందాం.',
  ta: 'இந்த பாடத்தில், நாம் முக்கியமான நடைமுறைகள் மற்றும் பாதுகாப்பு விதிகளை விரிவாகக் கற்றுக்கொள்வோம்.',
  bn: 'এই পাঠে, আমরা গুরুত্বপূর্ণ বিষয় এবং নিরাপত্তা নিয়মাবলী বিস্তারিতভাবে শিখব।',
  zh: '在本课中，我们将详细学习关键概念与操作规范。',
  ms: 'Dalam pelajaran ini, kita akan mempelajari prinsip-prinsip operasi dan keselamatan secara terperinci.',
  en: 'Welcome to this lesson. We will examine the key principles and operational requirements step by step.'
};

/**
 * Transform raw lesson content into teacher-style instructional sentences
 * @param {string} rawContent - Raw explanation or chunk text
 * @param {string} lessonTitle - The title of the lesson
 * @param {string} courseTitle - The course name
 * @param {string} languageCode - Target language ('en', 'te', 'ta', 'bn', 'zh', 'ms')
 * @returns {string[]} Array of warm, connected, instructional spoken sentences
 */
export function buildTeacherLectureSentences(rawContent, lessonTitle = '', courseTitle = '', languageCode = 'en') {
  const lang = (languageCode || 'en').toLowerCase().trim();
  const isEnglish = lang === 'en';

  if (!rawContent || typeof rawContent !== 'string') {
    const topic = lessonTitle || 'this topic';
    if (!isEnglish && DEFAULT_INTROS[lang]) {
      return [
        DEFAULT_INTROS[lang],
        `దయచేసి స్క్రీన్ పై ప్రదర్శించబడే అంశాలను గమనించండి.`
      ];
    }
    return [
      `Welcome to this lesson on ${topic}.`,
      `We will cover the essential operational concepts, practical procedures, and safety standards step by step.`,
      `Please follow along with the material displayed on your screen.`
    ];
  }

  const cleanText = stripSlidePlaceholders(cleanUnsupportedWords(rawContent));
  const rawLines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);

  const sentences = [];
  const topicName = cleanPhraseForSpeech(lessonTitle) || 'this lesson';

  // Section classifiers (Only for English)
  const introPhrases = [
    `Welcome! In this lesson, we will focus on ${topicName}.`,
    `Let's examine the key principles and operational requirements for ${topicName}.`
  ];

  let hasIntroduced = false;
  let bulletCount = 0;
  let isInSafetySection = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line || line.length < 3) continue;

    const lower = line.toLowerCase();

    // Skip visual content metadata, slide presentation tags, or binary noise
    if (/visual content|slide presentation|speaker notes|click to add|master text|placeholder/i.test(line)) continue;
    if (lower.includes('--- slide') || lower.includes('--- page')) continue;

    // Check if line is a markdown section header
    const isHeader = /^#{1,4}\s+/.test(line) || /^[💡🎯📋⚠️📌🔍🌐⚡]/.test(line);
    const cleanLine = cleanPhraseForSpeech(line);
    if (!cleanLine || cleanLine.length < 3) continue;

    // Discard lines that merely repeat the topic or course name
    if (cleanLine.toLowerCase() === topicName.toLowerCase() || (courseTitle && cleanLine.toLowerCase() === courseTitle.toLowerCase())) {
      continue;
    }

    if (isHeader) {
      if (isEnglish) {
        if (lower.includes('safety') || lower.includes('warning') || lower.includes('hazard') || lower.includes('compliance')) {
          isInSafetySection = true;
          sentences.push(`Now, let's pay close attention to the critical safety rules and compliance procedures.`);
        } else if (lower.includes('key takeaways') || lower.includes('summary') || lower.includes('conclusion')) {
          sentences.push(`To wrap up this section, let's review the main takeaways.`);
        } else if (lower.includes('operational') || lower.includes('standards') || lower.includes('protocols') || lower.includes('action')) {
          sentences.push(`Next, let's review the practical operating guidelines you should follow on the job.`);
        } else if (!hasIntroduced) {
          sentences.push(introPhrases[0]);
          hasIntroduced = true;
        }
      } else {
        // In non-English languages, speak the localized section header clean without inserting English phrases
        if (cleanLine.length >= 4) {
          let hSent = cleanLine;
          if (!/[.!?।]$/.test(hSent)) hSent += '.';
          sentences.push(hSent);
        }
      }
      continue;
    }

    const isBullet = /^[-*•➔\d\.]+\s+/.test(line);

    if (isBullet) {
      bulletCount++;
      let connector = '';
      if (isEnglish) {
        if (isInSafetySection) {
          if (bulletCount % 3 === 1) connector = 'First and foremost, always ensure that ';
          else if (bulletCount % 3 === 2) connector = 'In addition, it is mandatory to ';
          else connector = 'Furthermore, you must ';
        } else {
          if (bulletCount === 1) connector = 'To begin with, ';
          else if (bulletCount === 2) connector = 'Next, ';
          else if (bulletCount === 3) connector = 'Also, make sure to ';
          else if (bulletCount === 4) connector = 'Additionally, ';
          else connector = 'Another important point is to ';
        }
      }

      let spokenSentence = connector + cleanLine;
      if (!/[.!?।]$/.test(spokenSentence)) {
        spokenSentence += '.';
      }
      sentences.push(spokenSentence);
    } else {
      // Normal narrative sentence: split on sentence boundaries
      const subSentences = cleanLine.split(/(?<=[.!?।。\n])\s+/).filter(Boolean);
      for (const sub of subSentences) {
        let sent = sub.trim();
        // Discard trivial noise or one-word fragments
        if (sent.length < 12 && !/[.!?।]$/.test(sent)) continue;
        if (!/[.!?।]$/.test(sent)) sent += '.';
        sentences.push(sent);
      }
    }
  }

  // If no sentences were generated, provide clear default teacher script
  if (sentences.length === 0) {
    if (!isEnglish && DEFAULT_INTROS[lang]) {
      return [DEFAULT_INTROS[lang]];
    }
    return [
      `In this lesson, we examine ${topicName}.`,
      `Please review the operational requirements and safety guidelines shown on your screen.`,
      `Feel free to ask any questions if you need further clarification.`
    ];
  }

  // Add warm opening if missing for English
  if (isEnglish && !hasIntroduced && sentences.length > 0) {
    sentences.unshift(`Welcome! Today we will explore ${topicName}.`);
  }

  // Ensure clean complete sentences without cutting in the middle
  const refinedSentences = [];
  for (const s of sentences) {
    const trimmed = s.replace(/[-–—\s]+$/, '').trim();
    if (trimmed.length < 10) continue;
    let finalSent = trimmed;
    if (!/[.!?।]$/.test(finalSent)) finalSent += '.';
    refinedSentences.push(finalSent);
  }

  return refinedSentences;

  return refinedSentences;
}
