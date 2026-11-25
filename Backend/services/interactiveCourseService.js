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
import { detectDominantScript } from '../utils/language.js';
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

    const { cleanedText } = this.cleanAndHealContent(sourceContent);
    const effectiveSource = cleanedText || stripSlidePlaceholders(sourceContent);

    const langInstruction = language && language !== 'en'
      ? `\nIMPORTANT: Deliver your entire teaching lecture fluently in the requested language (code: "${language}"). Use natural native phrasing, not literal machine translation.`
      : '';

    const systemPrompt = `/no_think
You are ${aiTutorName}, a passionate, highly experienced master teacher delivering an interactive classroom lesson.
The course is: "${courseTitle}".
The current lesson is: "${lessonTitle}".
${previousConcept ? `Previous lesson concept: "${previousConcept}".` : ''}${langInstruction}

TEACHING PHILOSOPHY & OBJECTIVES:
1. DO NOT simply read the text or slide bullets word-for-word.
2. Teach like an expert human instructor explaining ideas patiently to students in a real classroom.
3. STRUCTURE YOUR LESSON:
   - Warm Introduction: Hook the student's interest and explain why this topic matters in the real world.
   - Core Meaning: What the concept actually means in simple, intuitive terms.
   - Why It Matters: Real-world consequences, safety risks, and operational value.
   - How It Works & Step-by-Step Procedure: Actionable, sequential walkthrough.
   - Practical Workplace Scenario: A concrete example or case study showing it in practice.
   - Common Pitfalls & Mistakes: What inexperienced personnel often get wrong and how to avoid it.
   - Connection: How this connects with previous or upcoming lessons.
   - Key Takeaways: 2-3 concise summary rules to remember.
   - Understanding Check: 1 thought-provoking check question for the learner.
4. SPEAKING STYLE:
   - Natural conversational transitions (e.g. "Now, you might wonder...", "Notice how...", "A critical rule to always keep in mind is...").
   - Clear, measured pacing (~${targetWpm} words per minute).
   - Warm, confident, encouraging, and articulate.
   - Never sound robotic, monotonic, or like an audio-book reader.
   - Never output OCR tags, slide headers/footers, or visual descriptions.

Return your response in clean Markdown.`;

    const userPrompt = `Source material for lesson "${lessonTitle}":\n\n${effectiveSource}\n\nPlease deliver the complete classroom lecture for this lesson now.`;

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
