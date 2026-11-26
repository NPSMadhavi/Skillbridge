/**
 * Interactive Course Service for SkillBridge
 * Powers the Advanced AI Teaching Engine:
 * - Intelligent Content Cleaning & Bullet Healing
 * - AI Teacher-Style Pedagogical Explanations
 * - Narration-Quality & Anti-Plagiarism Audit
 * - Neural Narration Preparation Pipeline
 * - SSML Generation for Human-Like Pauses and Phrasing
 * - RAG-Based Grounded Teaching Context
 */

import { stripSlidePlaceholders, cleanUnsupportedWords, healBrokenBullets, validateCleanedContent } from '../utils/contentQuality.js';
import aiService from './aiService.js';
import { detectDominantScript, resolveLanguageInfo } from '../utils/language.js';
import microsoftNeuralTts, { VOICE_CONFIG, PRONUNCIATION_DICTIONARY } from './microsoftNeuralTtsService.js';

export class InteractiveCourseService {
  constructor() {
    // 70% Jaccard vocabulary similarity threshold as pedagogical warning limit
    this.auditThreshold = 0.70;
  }

  /**
   * 1. Intelligent Content Cleaning and Bullet Healing Pipeline
   */
  cleanAndHealContent(rawText, docMetadata = {}) {
    if (!rawText) return { cleanedText: '', validation: { isValid: true, retentionRate: 1.0, missingKeywords: [] } };

    // Step A: Strip PowerPoint placeholders, templates, font metadata, and file path noise
    const stripped = stripSlidePlaceholders(rawText);

    // Step B: Heal broken sentences, lowercase continuations, and disjointed bullets across lines
    const healed = healBrokenBullets(stripped);

    // Step C: Validate that technical keywords and safety terminology were not lost
    const validation = validateCleanedContent(rawText, healed);

    return {
      cleanedText: healed,
      validation
    };
  }

  /**
   * 2. Narration-Quality Audit:
   * Detects excessive verbatim repetition between original slide/document bullets and generated explanation.
   * If narration merely recites slide bullets word-for-word (> 70% token overlap), it triggers a pedagogical rewrite.
   */
  auditNarrationQuality(sourceSlideText, generatedNarration) {
    if (!sourceSlideText || !generatedNarration) {
      return { passesAudit: true, similarityScore: 0, reason: 'Insufficient text to compare' };
    }

    const tokenize = (txt) => {
      return new Set(
        String(txt)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3)
      );
    };

    const sourceTokens = tokenize(sourceSlideText);
    const narrationTokens = tokenize(generatedNarration);

    if (sourceTokens.size === 0 || narrationTokens.size === 0) {
      return { passesAudit: true, similarityScore: 0, reason: 'Tokens insufficient for comparison' };
    }

    // Jaccard similarity of technical vocabulary
    let intersectionCount = 0;
    for (const t of sourceTokens) {
      if (narrationTokens.has(t)) intersectionCount++;
    }

    const unionCount = sourceTokens.size + narrationTokens.size - intersectionCount;
    const similarity = unionCount > 0 ? intersectionCount / unionCount : 0;
    const passesAudit = similarity <= this.auditThreshold;

    return {
      passesAudit,
      similarityScore: Math.round(similarity * 100) / 100,
      reason: passesAudit
        ? 'High pedagogical originality: Explains concepts, procedures, and context rather than reciting slides verbatim.'
        : `Excessive similarity (${Math.round(similarity * 100)}% > ${Math.round(this.auditThreshold * 100)}%): Narration reads source material too verbatim.`
    };
  }

  /**
   * 3. AI Teaching Intelligence – Generates a warm, professional, human-like classroom lecture
   */
  async generateTeacherLecture(lessonTitle, courseTitle, sourceContent, options = {}) {
    const {
      language = 'en',
      aiTutorName = 'ARIA',
      previousConcept = '',
      targetWpm = 135
    } = options;

    const langInfo = resolveLanguageInfo(language);
    const { cleanedText } = this.cleanAndHealContent(sourceContent);
    const effectiveSource = (cleanedText || stripSlidePlaceholders(sourceContent)).slice(0, 2500);

    const langInstruction = langInfo.code !== 'en'
      ? `\nCRITICAL LANGUAGE REQUIREMENT: Deliver your entire teaching lecture fluently in ${langInfo.name}. Write all explanations, headings, and takeaways in ${langInfo.name} (preserving only standard acronyms like PPE or 5S where appropriate).`
      : '';

    const systemPrompt = `/no_think
You are ${aiTutorName}, an experienced workplace safety and operations instructor delivering an interactive classroom lesson.
The course is: "${courseTitle}".
The current lesson is: "${lessonTitle}".
${previousConcept ? `Previous lesson concept: "${previousConcept}".` : ''}${langInstruction}

TEACHING GUIDELINES:
1. Teach strictly from the provided source material for "${lessonTitle}" — do NOT invent unrelated topics.
2. Keep the lecture concise: 3 to 4 clear, natural sentences (~70–110 words total) covering the core rule, workplace reason, and key safety/operational takeaway from the source material.
3. Warm, encouraging, conversational tone (~${targetWpm} WPM). Never output OCR tags or slide headers.

Return clean Markdown.`;

    const userPrompt = `Source material for lesson "${lessonTitle}":\n\n${effectiveSource}\n\nDeliver the concise classroom lecture in ${langInfo.name} now:`;

    const lectureStart = Date.now();
    let lecture = await aiService._callLLM(systemPrompt, userPrompt, false, [], options);

    // Audit quality: verify narration is explanatory rather than verbatim slide reading.
    // To prevent Nginx 110 upstream timeouts, only trigger a synchronous rewrite pass
    // if the first pass finished quickly (< 12s) and client signal is still active.
    const audit = this.auditNarrationQuality(effectiveSource, lecture);
    const timeSpent = Date.now() - lectureStart;
    const canSafelyRetry = timeSpent < 12000 && !options.signal?.aborted;

    if (!audit.passesAudit && canSafelyRetry) {
      console.warn(`[InteractiveCourseService] Narration audit notice (${audit.similarityScore} > ${this.auditThreshold}) after ${timeSpent}ms: Triggering single pedagogical rewrite pass...`);
      const retrySystem = `${systemPrompt}\n\nCRITICAL TEACHING REWRITE: Your previous response was too close to reading the source bullets verbatim. You MUST re-explain using practical analogies, real-world shop floor examples, and deep conceptual breakdown while keeping all technical facts and safety instructions 100% accurate.`;
      try {
        const rewritten = await aiService._callLLM(retrySystem, userPrompt, false, [], {
          ...options,
          timeoutMs: Math.min(options.timeoutMs || 25000, 15000)
        });
        if (rewritten && rewritten.length > 50) {
          lecture = rewritten;
        }
      } catch (err) {
        console.warn(`[InteractiveCourseService] Pedagogical rewrite fallback notice:`, err.message);
      }
    }

    return lecture;
  }

  /**
   * 4. Centralized Teaching Narration Preparation Pipeline:
   * Prepares raw or generated text for crystal-clear, natural neural speech delivery.
   * Leverages microsoftNeuralTts for unified, non-robotic acronym and bullet processing.
   */
  prepareTeachingNarration(text, language = 'en') {
    if (!text || typeof text !== 'string') return '';
    return microsoftNeuralTts.prepareTeacherNarration(text, language);
  }

  /**
   * 5. Segment into sentence-level chunks with natural pauses
   */
  segmentIntoTeachingSentences(text, language = 'en') {
    if (!text) return [];
    const prepared = microsoftNeuralTts.prepareTeacherNarration(text, language);
    const raw = microsoftNeuralTts.segmentSentences(prepared);
    return raw
      .map(s => stripSlidePlaceholders(s).trim())
      .filter(s => {
        if (!s || s.length < 10) return false;
        if (/visual content|slide presentation|speaker notes|placeholder/i.test(s)) return false;
        return true;
      });
  }

  /**
   * 6. Generate SSML (Speech Synthesis Markup Language) for Microsoft Neural TTS with natural teacher pauses
   */
  generateSSML(sentences, options = {}) {
    return microsoftNeuralTts.generateSSML(sentences, options);
  }

  /**
   * 7. Build Grounded RAG Teaching Context for Student Question Answering
   */
  buildTeachingRAGContext(course, lessonTitle, queryText, relevantChunks = []) {
    const courseTitle = course?.title || 'Course';
    const chunksText = (relevantChunks || []).map((c, idx) => {
      const topicTag = c.topic ? `[Topic: ${c.topic}]` : '';
      const conceptTag = c.concept ? `[Concept: ${c.concept}]` : '';
      const slidesTag = Array.isArray(c.source_slides || c.sourceSlides) ? ` (Source Slides: ${(c.source_slides || c.sourceSlides).join(', ')})` : '';
      const keyPoints = Array.isArray(c.key_points || c.keyPoints) && (c.key_points || c.keyPoints).length > 0
        ? `\nKey Points:\n${(c.key_points || c.keyPoints).map(k => `- ${k}`).join('\n')}`
        : '';
      const prereqs = c.prerequisites ? `\nPrerequisites: ${c.prerequisites}` : '';
      return `--- KNOWLEDGE UNIT ${idx + 1} ${topicTag} ${conceptTag}${slidesTag} ---
${c.text || c.chunkText}${keyPoints}${prereqs}`;
    }).join('\n\n');

    return {
      courseTitle,
      lessonTitle: lessonTitle || 'Current Lesson',
      queryText,
      groundedContext: chunksText || (course?.fileText || '').slice(0, 800)
    };
  }
}

export const interactiveCourseService = new InteractiveCourseService();
export default interactiveCourseService;
