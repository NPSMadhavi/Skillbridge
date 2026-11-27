import crypto from 'crypto';
import aiService from './aiService.js';
import vectorChunkService from './vectorChunkService.js';
import { resolveLanguageInfo, textMatchesLanguage } from '../utils/language.js';
import { stripSlidePlaceholders, cleanUnsupportedWords, healBrokenBullets } from '../utils/contentQuality.js';

const inFlightChunkTranslations = new Map();

function normalizeForSimilarity(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

export function jaccardSimilarity(a, b) {
  const setA = normalizeForSimilarity(a);
  const setB = normalizeForSimilarity(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function deduplicateSourceLines(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    const key = line.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join('\n').trim();
}

function splitIntoTranslationBlocks(text, maxChars = 1000) {
  const paras = String(text || '').split(/\n{2,}/);
  const blocks = [];
  let curr = '';
  for (const p of paras) {
    if (!p.trim()) continue;
    if (curr && curr.length + p.length + 2 > maxChars) {
      blocks.push(curr.trim());
      curr = p;
    } else {
      curr = curr ? `${curr}\n\n${p}` : p;
    }
  }
  if (curr.trim()) blocks.push(curr.trim());
  return blocks.length > 0 ? blocks : [String(text || '').slice(0, maxChars)];
}

class TranslationService {
  /**
   * Strict source-grounded translation of a single canonical chunk.
   * Translates the exact source text into targetLanguage without inventing content.
   */
  async translateChunkText(sourceText, targetLangCode, context = {}) {
    const langInfo = resolveLanguageInfo(targetLangCode);
    const rawStr = String(sourceText || '');
    const cleaned = cleanUnsupportedWords(stripSlidePlaceholders(healBrokenBullets(rawStr) || rawStr)).trim();
    const cleanSource = deduplicateSourceLines(cleaned);
    if (!cleanSource) return '';
    if (langInfo.code === 'en') return cleanSource;

    const { concept = '', topic = '' } = context;
    const systemPrompt = `/no_think
You are a precise technical translator for SkillBridge.
Translate the provided source training content from English into ${langInfo.name} (${langInfo.code}).

STRICT SOURCE-GROUNDING RULES:
1. Translate ONLY what is present in the source content.
2. Preserve all technical facts, terminology, numbers, headings, bullet lists, and examples.
3. Preserve the original teaching sequence.
4. Do NOT introduce new topics, invent examples, or add outside facts.
5. Do NOT omit important source information or repeat unrelated content.
6. Retain standard technical acronyms and terms (such as CPU, GPU, TPU, NPU, RAM, VRAM, HDD, SSD, AI, API, PPE, 5S) in English alongside natural ${langInfo.name} grammar.
7. Output ONLY the clean ${langInfo.name} translation in Markdown — no preamble or meta-commentary.`;

    const blocks = splitIntoTranslationBlocks(cleanSource, 1000);
    const translatedParts = new Array(blocks.length);
    let blockIdx = 0;
    const workerCount = Math.min(2, blocks.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (blockIdx < blocks.length) {
          const i = blockIdx++;
          const block = blocks[i];
          const userPrompt = `${topic ? `Module/Topic: ${topic}\n` : ''}${concept ? `Section: ${concept}\n` : ''}
Source Content to Translate:
${block}`;
          const raw = await aiService._callLLM(systemPrompt, userPrompt, false, [], {
            timeoutMs: 60000,
          });
          const part = cleanUnsupportedWords(stripSlidePlaceholders(String(raw || ''))).trim();
          if (part) translatedParts[i] = part;
        }
      })
    );

    const translated = translatedParts.filter(Boolean).join('\n\n').trim();
    if (!translated || !textMatchesLanguage(translated, langInfo.code)) {
      throw new Error(`Translation output did not match ${langInfo.name} (${langInfo.code}).`);
    }
    return translated;
  }

  /**
   * Retrieves a cached chunk translation from PostgreSQL ChunkTranslation table,
   * or translates and persists it with deduplication and duplicate-content validation.
   */
  async getOrTranslateChunk(prisma, chunk, options = {}) {
    await vectorChunkService.ensureColumnsExist(prisma);
    const {
      courseId = chunk.courseId,
      moduleId = null,
      lessonId = null,
      targetLanguage = 'en',
      translationVersion = 1,
      sourceLanguage = 'en',
    } = options;

    const langInfo = resolveLanguageInfo(targetLanguage);
    const sourceText = cleanUnsupportedWords(stripSlidePlaceholders(chunk.chunkText || chunk.content || '')).trim();

    if (langInfo.code === 'en') {
      return {
        id: chunk.id,
        sourceChunkId: chunk.id,
        courseId,
        moduleId: moduleId ? String(moduleId) : null,
        lessonId: lessonId ? String(lessonId) : null,
        sourceLanguage,
        targetLanguage: 'en',
        translatedText: sourceText,
        translationStatus: 'READY',
        translationVersion,
        cached: true,
      };
    }

    // 1. Check PostgreSQL ChunkTranslation cache
    const existingRows = await prisma.$queryRawUnsafe(
      `SELECT id, "sourceChunkId", "courseId", "moduleId", "lessonId", "sourceLanguage",
              "targetLanguage", "translatedText", "translationStatus", "translationVersion",
              "audioCacheKey", "audioUrl", "createdAt", "updatedAt"
       FROM "ChunkTranslation"
       WHERE "sourceChunkId" = $1 AND "targetLanguage" = $2 AND "translationVersion" = $3
       LIMIT 1`,
      chunk.id,
      langInfo.code,
      translationVersion
    );

    if (
      existingRows?.length > 0 &&
      existingRows[0].translationStatus === 'READY' &&
      existingRows[0].translatedText &&
      textMatchesLanguage(existingRows[0].translatedText, langInfo.code)
    ) {
      return { ...existingRows[0], cached: true };
    }

    // 2. Coalesce concurrent requests for the same (sourceChunkId, targetLanguage, version)
    const inflightKey = `${chunk.id}:${langInfo.code}:${translationVersion}`;
    if (inFlightChunkTranslations.has(inflightKey)) {
      return await inFlightChunkTranslations.get(inflightKey);
    }

    const workPromise = (async () => {
      const translatedText = await this.translateChunkText(sourceText, langInfo.code, {
        concept: chunk.concept,
        topic: chunk.topic,
      });

      // 3. Duplicate-translation guard: ensure another chunk with different source text doesn't share this exact translation
      const normalizedNew = translatedText.replace(/\s+/g, ' ').trim();
      const sameCourseRows = await prisma.$queryRawUnsafe(
        `SELECT ct."sourceChunkId", ct."translatedText", cc."chunkText"
         FROM "ChunkTranslation" ct
         JOIN "CourseChunk" cc ON cc.id = ct."sourceChunkId"
         WHERE ct."courseId" = $1 AND ct."targetLanguage" = $2 AND ct."sourceChunkId" != $3`,
        courseId,
        langInfo.code,
        chunk.id
      );

      for (const other of (sameCourseRows || [])) {
        if ((other.translatedText || '').replace(/\s+/g, ' ').trim() === normalizedNew) {
          const srcSim = jaccardSimilarity(sourceText, other.chunkText || '');
          if (srcSim < 0.7) {
            throw new Error(
              `Duplicate translation detected for distinct source chunks (${chunk.id} vs ${other.sourceChunkId}, sourceSimilarity=${srcSim.toFixed(2)}).`
            );
          }
        }
      }

      const rowId = existingRows?.[0]?.id || crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ChunkTranslation" (
          "id", "sourceChunkId", "courseId", "moduleId", "lessonId",
          "sourceLanguage", "targetLanguage", "translatedText",
          "translationStatus", "translationVersion", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'READY', $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("sourceChunkId", "targetLanguage", "translationVersion")
        DO UPDATE SET
          "translatedText" = EXCLUDED."translatedText",
          "translationStatus" = 'READY',
          "moduleId" = COALESCE(EXCLUDED."moduleId", "ChunkTranslation"."moduleId"),
          "lessonId" = COALESCE(EXCLUDED."lessonId", "ChunkTranslation"."lessonId"),
          "updatedAt" = CURRENT_TIMESTAMP`,
        rowId,
        chunk.id,
        courseId,
        moduleId ? String(moduleId) : null,
        lessonId ? String(lessonId) : null,
        sourceLanguage,
        langInfo.code,
        translatedText,
        translationVersion
      );

      return {
        id: rowId,
        sourceChunkId: chunk.id,
        courseId,
        moduleId: moduleId ? String(moduleId) : null,
        lessonId: lessonId ? String(lessonId) : null,
        sourceLanguage,
        targetLanguage: langInfo.code,
        translatedText,
        translationStatus: 'READY',
        translationVersion,
        cached: false,
      };
    })();

    inFlightChunkTranslations.set(inflightKey, workPromise);
    try {
      return await workPromise;
    } finally {
      inFlightChunkTranslations.delete(inflightKey);
    }
  }

  /**
   * Resolves the ordered CourseChunk rows belonging strictly to a given lesson.
   */
  async getLessonChunks(prisma, courseId, matchingLesson = null, lessonTitle = '') {
    await vectorChunkService.ensureColumnsExist(prisma);
    const allChunks = await prisma.$queryRawUnsafe(
      `SELECT id, "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
              "sourcePage", "sourceSlides", "sourceSection", "keyPoints", "semanticSummary"
       FROM "CourseChunk"
       WHERE "courseId" = $1
       ORDER BY "chunkIndex" ASC`,
      courseId
    );
    if (!Array.isArray(allChunks) || allChunks.length === 0) return [];

    const lessonSlides = Array.isArray(matchingLesson?.sourceSlides)
      ? matchingLesson.sourceSlides.map(Number).filter(Number.isFinite)
      : [];
    const cleanTitle = String(lessonTitle || matchingLesson?.title || '').trim().toLowerCase();

    // 1. Exact slide/page overlap
    let matched = [];
    if (lessonSlides.length > 0) {
      matched = allChunks.filter(c => {
        const cSlides = Array.isArray(c.sourceSlides) ? c.sourceSlides.map(Number) : [];
        return cSlides.some(s => lessonSlides.includes(s)) || (c.sourcePage && lessonSlides.includes(Number(c.sourcePage)));
      });
    }

    // 2. Fallback to concept/title match within this course
    if (matched.length === 0 && cleanTitle) {
      matched = allChunks.filter(c => {
        const cConcept = String(c.concept || '').trim().toLowerCase();
        return cConcept && (cConcept === cleanTitle || cConcept.includes(cleanTitle) || cleanTitle.includes(cConcept));
      });
    }

    // 3. Fallback to lesson index slice if still unmatched
    if (matched.length === 0 && matchingLesson?.id) {
      const idx = Math.max(0, Number(matchingLesson.id) - 1);
      if (allChunks[idx]) matched = [allChunks[idx]];
    }

    return matched.length > 0 ? matched : [allChunks[0]];
  }

  /**
   * Translates (or retrieves cached) all chunks for a specific lesson.
   * Never translates unrelated lessons or the entire course.
   */
  async getOrTranslateLesson(prisma, { courseId, matchingLesson = null, lessonTitle = '', targetLanguage = 'en', translationVersion = 1 }) {
    const langInfo = resolveLanguageInfo(targetLanguage);
    const chunks = await this.getLessonChunks(prisma, courseId, matchingLesson, lessonTitle);
    if (chunks.length === 0) return null;

    const moduleId = matchingLesson?.moduleId || matchingLesson?.chapterId || null;
    const lessonId = matchingLesson?.id || null;

    const translatedChunks = [];
    let anyUncached = false;
    for (const chunk of chunks) {
      const tr = await this.getOrTranslateChunk(prisma, chunk, {
        courseId,
        moduleId,
        lessonId,
        targetLanguage: langInfo.code,
        translationVersion,
      });
      if (!tr.cached) anyUncached = true;
      translatedChunks.push(tr);
    }

    const combinedText = translatedChunks.map(c => c.translatedText).filter(Boolean).join('\n\n');
    return {
      language: langInfo,
      chunks: translatedChunks,
      combinedText,
      cached: !anyUncached,
    };
  }

  /**
   * Warms remaining chunks of a course in the background so switching lessons is instant.
   */
  pretranslateCourseChunksInBackground(prisma, courseId, targetLanguage, excludeChunkIds = []) {
    const langInfo = resolveLanguageInfo(targetLanguage);
    if (langInfo.code === 'en') return;
    const excludeSet = new Set(excludeChunkIds.map(String));
    setImmediate(async () => {
      try {
        const allChunks = await prisma.$queryRawUnsafe(
          `SELECT id, "courseId", "chunkIndex", "chunkText", "topic", "concept"
           FROM "CourseChunk" WHERE "courseId" = $1 ORDER BY "chunkIndex" ASC`,
          courseId
        );
        for (const chunk of (allChunks || [])) {
          if (excludeSet.has(String(chunk.id))) continue;
          await this.getOrTranslateChunk(prisma, chunk, {
            courseId,
            targetLanguage: langInfo.code,
            translationVersion: 1,
          }).catch(() => {});
        }
      } catch (_) {}
    });
  }

  /**
   * Parallel multilingual chunk pre-translation worker.
   * Translates all chunks of a course into supported target languages using a bounded worker pool
   * and stores them in PostgreSQL ChunkTranslation so lesson switching is instant.
   */
  pretranslateCourseParallel(prisma, courseId, languages = ['te', 'hi', 'ta', 'zh', 'ms', 'bn'], concurrency = 1) {
    setImmediate(async () => {
      try {
        await vectorChunkService.ensureColumnsExist(prisma);
        const chunks = await prisma.$queryRawUnsafe(
          `SELECT id, "courseId", "chunkIndex", "chunkText", "topic", "concept"
           FROM "CourseChunk" WHERE "courseId" = $1 ORDER BY "chunkIndex" ASC`,
          courseId
        );
        if (!Array.isArray(chunks) || chunks.length === 0) return;

        const jobs = [];
        for (const lang of languages) {
          const code = resolveLanguageInfo(lang).code;
          if (code === 'en') continue;
          for (const chunk of chunks) {
            jobs.push({ chunk, code });
          }
        }

        let cursor = 0;
        const workerCount = Math.max(1, Math.min(concurrency, jobs.length));
        const workers = Array.from({ length: workerCount }, async () => {
          while (cursor < jobs.length) {
            const job = jobs[cursor++];
            if (!job) break;
            await this.getOrTranslateChunk(prisma, job.chunk, {
              courseId,
              targetLanguage: job.code,
              translationVersion: 1,
            }).catch(() => {});
            // Gentle pacing so background warming never starves or rate-limits live user language switches
            await new Promise(r => setTimeout(r, 350));
          }
        });
        await Promise.all(workers);
        console.log(`[ChunkTranslation] Parallel pre-translation complete for course ${courseId} (${chunks.length} chunks x ${languages.length} languages).`);
      } catch (err) {
        console.warn(`[ChunkTranslation] Parallel pre-translation notice for ${courseId}:`, err.message);
      }
    });
  }
}

export const translationService = new TranslationService();
export default translationService;
