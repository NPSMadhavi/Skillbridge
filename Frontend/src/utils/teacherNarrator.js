/**
 * Teacher Narrator Utility
 * Converts raw slide bullets, fragmented headings, and dense document notes
 * into warm, fluent, relevant instructional lectures spoken like a real teacher
 * instead of an AI reading a book fast.
 */

import { stripSlidePlaceholders, cleanUnsupportedWords } from './textCleaner';

/**
 * Clean a single line of raw slide text into conversational spoken English
 */
function cleanPhraseForSpeech(phrase) {
  if (!phrase || typeof phrase !== 'string') return '';
  return phrase
    .replace(/^[-*•➔\d\.]+\s*/, '') // Remove bullet dots, dashes, numbers
    .replace(/[#*_~`^|<>]/g, '')     // Remove markdown syntax
    .replace(/\s*=\s*/g, ' means ')  // Convert = to "means"
    .replace(/\s*&\s*/g, ' and ')    // Convert & to "and"
    .replace(/\s*\/\s*/g, ' or ')    // Convert / to "or"
    .replace(/\s*->\s*/g, ', which leads to ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Transform raw lesson content into teacher-style instructional sentences
 * @param {string} rawContent - Raw explanation or chunk text
 * @param {string} lessonTitle - The title of the lesson
 * @param {string} courseTitle - The course name
 * @returns {string[]} Array of warm, connected, instructional spoken sentences
 */
export function buildTeacherLectureSentences(rawContent, lessonTitle = '', courseTitle = '') {
  if (!rawContent || typeof rawContent !== 'string') {
    const topic = lessonTitle || 'this topic';
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

  // Section classifiers
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

    // Check if line is a markdown section header
    const isHeader = /^#{1,4}\s+/.test(line) || /^[💡🎯📋⚠️📌]/.test(line);
    const cleanLine = cleanPhraseForSpeech(line);

    if (isHeader) {
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
      continue;
    }

    const isBullet = /^[-*•➔\d\.]+\s+/.test(line);

    if (isBullet) {
      bulletCount++;
      let connector = '';
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

      // If line already starts with a verb or instruction
      let spokenSentence = connector + cleanLine;
      // Ensure sentence ends with punctuation
      if (!/[.!?]$/.test(spokenSentence)) {
        spokenSentence += '.';
      }
      sentences.push(spokenSentence);
    } else {
      // Normal narrative sentence
      // If it looks like a lone title or fragment
      if (cleanLine.length < 40 && !/[.!?]$/.test(cleanLine)) {
        if (!hasIntroduced) {
          sentences.push(`Let's begin by discussing ${cleanLine}.`);
          hasIntroduced = true;
        } else {
          sentences.push(`Regarding ${cleanLine}:`);
        }
      } else {
        let sent = cleanLine;
        if (!/[.!?]$/.test(sent)) sent += '.';
        sentences.push(sent);
      }
    }
  }

  // If no sentences were generated, provide clear default teacher script
  if (sentences.length === 0) {
    return [
      `In this lesson, we examine ${topicName}.`,
      `Please review the operational requirements and safety guidelines shown on your screen.`,
      `Feel free to ask any questions if you need further clarification.`
    ];
  }

  // Add warm opening if missing
  if (!hasIntroduced && sentences.length > 0) {
    sentences.unshift(`Welcome! Today we will explore ${topicName}.`);
  }

  // Break any unusually long sentences (> 180 chars) into shorter, easy-to-digest teacher statements
  const refinedSentences = [];
  for (const s of sentences) {
    if (s.length > 180 && s.includes(',')) {
      const parts = s.split(/(?<=,)\s+/);
      let buffer = '';
      for (const p of parts) {
        if ((buffer + ' ' + p).length < 140) {
          buffer = buffer ? buffer + ' ' + p : p;
        } else {
          if (buffer) {
            let b = buffer.trim();
            if (!/[.!?]$/.test(b)) b += '.';
            refinedSentences.push(b);
          }
          buffer = p;
        }
      }
      if (buffer) {
        let b = buffer.trim();
        if (!/[.!?]$/.test(b)) b += '.';
        refinedSentences.push(b);
      }
    } else {
      refinedSentences.push(s);
    }
  }

  return refinedSentences;
}

