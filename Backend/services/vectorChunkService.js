/**
 * Vector Chunk Service for Skill-Bridge
 * Handles semantic, meaning-based document chunking, validation, pgvector embeddings,
 * and hybrid semantic & metadata retrieval directly in PostgreSQL.
 */
import aiService from './aiService.js';

export class VectorChunkService {
  constructor() {
    this._columnsChecked = false;
  }

  /**
   * Ensures the PostgreSQL CourseChunk table contains all semantic metadata columns.
   * Runs non-destructively using IF NOT EXISTS.
   */
  async ensureColumnsExist(prisma) {
    if (this._columnsChecked) return;
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "CourseChunk" 
          ADD COLUMN IF NOT EXISTS "topic" TEXT,
          ADD COLUMN IF NOT EXISTS "subtopic" TEXT,
          ADD COLUMN IF NOT EXISTS "concept" TEXT,
          ADD COLUMN IF NOT EXISTS "chunkType" TEXT,
          ADD COLUMN IF NOT EXISTS "sourcePage" INT,
          ADD COLUMN IF NOT EXISTS "sourceSection" TEXT,
          ADD COLUMN IF NOT EXISTS "prerequisites" TEXT,
          ADD COLUMN IF NOT EXISTS "keyPoints" JSONB,
          ADD COLUMN IF NOT EXISTS "semanticSummary" TEXT;
      `);
      this._columnsChecked = true;
    } catch (err) {
      console.warn('[VectorChunkService] Schema check notice (safe to ignore if table already up to date):', err.message);
    }
  }

  /**
   * Intelligently parses text into semantic, meaning-based chunks rather than arbitrary fixed character counts.
   * Respects paragraphs, headings, definitions, code blocks, lists, and concept boundaries.
   *
   * @param {string} text - The raw text content.
   * @param {number} targetSize - Target chunk size in characters (~800-1200).
   * @param {number} minSize - Minimum chunk size (~350).
   * @param {number} maxSize - Maximum chunk size (~2000).
   * @returns {Array<{ text: string, type: string }>} List of semantic segments.
   */
  segmentTextSemantically(text, targetSize = 1000, minSize = 350, maxSize = 2200) {
    if (!text || text.trim().length === 0) return [];

    const rawParagraphs = text.split(/\n\s*\n/);
    const units = [];

    // First pass: clean paragraphs and identify paragraph types
    for (const p of rawParagraphs) {
      const clean = p.trim();
      if (!clean) continue;

      const isHeading = clean.length < 90 && (
        clean.startsWith('#') ||
        clean.startsWith('Chapter') ||
        clean.startsWith('Module') ||
        clean.startsWith('Section') ||
        clean.startsWith('Topic') ||
        /^[0-9]+(\.[0-9]+)*\s+[A-Z]/.test(clean) ||
        clean.endsWith(':')
      );

      const isListOrCode = clean.startsWith('- ') ||
        clean.startsWith('* ') ||
        clean.startsWith('1. ') ||
        clean.startsWith('```') ||
        clean.includes('\n  ') ||
        clean.includes('    ');

      const isDefinition = clean.toLowerCase().includes('is defined as') ||
        clean.toLowerCase().includes('refers to') ||
        clean.toLowerCase().includes('definition:') ||
        clean.toLowerCase().includes('in summary');

      let chunkType = 'concept';
      if (isHeading) chunkType = 'overview';
      else if (isDefinition) chunkType = 'definition';
      else if (isListOrCode) chunkType = 'procedure';

      units.push({ text: clean, type: chunkType, isHeading });
    }

    if (units.length === 0) return [];

    // Second pass: group units into coherent semantic learning chunks
    const semanticChunks = [];
    let currentChunkText = '';
    let currentChunkType = 'concept';
    let currentHeading = '';

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];

      if (unit.isHeading) {
        // If we already have accumulated text and reach a new major heading, flush the existing chunk
        if (currentChunkText.length >= minSize) {
          semanticChunks.push({
            text: currentChunkText.trim(),
            type: currentChunkType,
            section: currentHeading
          });
          currentChunkText = '';
        }
        currentHeading = unit.text.replace(/^#+\s*/, '');
        currentChunkText += (currentChunkText ? '\n\n' : '') + unit.text;
        continue;
      }

      // Check if adding this unit exceeds maximum threshold
      const projectedLength = currentChunkText.length + unit.text.length + 2;
      if (projectedLength > maxSize && currentChunkText.length >= minSize) {
        semanticChunks.push({
          text: currentChunkText.trim(),
          type: currentChunkType,
          section: currentHeading
        });
        currentChunkText = unit.text;
        currentChunkType = unit.type;
      } else {
        currentChunkText += (currentChunkText ? '\n\n' : '') + unit.text;
        if (unit.type !== 'concept') {
          currentChunkType = unit.type;
        }
      }
    }

    if (currentChunkText.trim().length > 0) {
      semanticChunks.push({
        text: currentChunkText.trim(),
        type: currentChunkType,
        section: currentHeading
      });
    }

    return semanticChunks;
  }

  /**
   * Creates rich, structured semantic chunks mapped to document sections and hierarchy.
   *
   * @param {string} fullText - Full document text.
   * @param {Array<{ page_number: number, text: string }>|null} pages - Segmented pages if available.
   * @param {object|null} curriculum - Generated course curriculum with chapters/modules.
   * @returns {Array<object>} Enriched chunk objects.
   */
  createSemanticChunks(fullText, pages = null, curriculum = null) {
    const enrichedChunks = [];
    let globalIndex = 0;

    // Helper to map chunk to curriculum topics if available
    const flatLessons = Array.isArray(curriculum?.lessons) ? curriculum.lessons : [];

    const findBestLessonMatch = (chunkText) => {
      if (flatLessons.length === 0) return null;
      const lower = chunkText.toLowerCase();
      let bestMatch = null;
      let highestScore = 0;

      for (const lesson of flatLessons) {
        const titleWords = (lesson.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
        let score = 0;
        for (const w of titleWords) {
          if (lower.includes(w)) score += 1;
        }
        if (score > highestScore) {
          highestScore = score;
          bestMatch = lesson;
        }
      }
      return highestScore >= 2 ? bestMatch : null;
    };

    if (pages && Array.isArray(pages) && pages.length > 0) {
      for (const p of pages) {
        const pageSegments = this.segmentTextSemantically(p.text);
        for (const seg of pageSegments) {
          const matchedLesson = findBestLessonMatch(seg.text);
          enrichedChunks.push({
            chunkIndex: globalIndex++,
            chunkText: seg.text,
            topic: matchedLesson?.chapterTitle || seg.section || `Section Page ${p.page_number}`,
            subtopic: matchedLesson?.moduleTitle || null,
            concept: matchedLesson?.title || seg.section || 'Core Learning Concept',
            chunkType: seg.type || 'concept',
            sourcePage: p.page_number,
            sourceSection: seg.section || `Page ${p.page_number}`,
            prerequisites: null,
            keyPoints: null,
            semanticSummary: seg.text.slice(0, 200).replace(/\n/g, ' ')
          });
        }
      }
    } else {
      const segments = this.segmentTextSemantically(fullText);
      for (const seg of segments) {
        const matchedLesson = findBestLessonMatch(seg.text);
        enrichedChunks.push({
          chunkIndex: globalIndex++,
          chunkText: seg.text,
          topic: matchedLesson?.chapterTitle || seg.section || 'General Topics',
          subtopic: matchedLesson?.moduleTitle || null,
          concept: matchedLesson?.title || seg.section || 'Core Concept',
          chunkType: seg.type || 'concept',
          sourcePage: Math.floor(globalIndex / 3) + 1,
          sourceSection: seg.section || null,
          prerequisites: null,
          keyPoints: null,
          semanticSummary: seg.text.slice(0, 200).replace(/\n/g, ' ')
        });
      }
    }

    return this.validateChunks(enrichedChunks);
  }

  /**
   * Validates and de-duplicates chunks before storing.
   * Ensures every chunk is coherent, non-empty, and has clean metadata.
   */
  validateChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) return [];

    const seenTexts = new Set();
    const validated = [];
    let cleanIndex = 0;

    for (const c of chunks) {
      const text = (c.chunkText || c.text || '').trim();
      if (text.length < 35) continue; // Filter out trivial noise/blank headers

      const normalized = text.toLowerCase().replace(/\s+/g, ' ');
      if (seenTexts.has(normalized)) continue; // De-duplicate identical chunks
      seenTexts.add(normalized);

      validated.push({
        chunkIndex: cleanIndex++,
        chunkText: text,
        topic: c.topic || 'General Overview',
        subtopic: c.subtopic || null,
        concept: c.concept || 'Core Topic',
        chunkType: c.chunkType || 'concept',
        sourcePage: typeof c.sourcePage === 'number' ? c.sourcePage : 1,
        sourceSection: c.sourceSection || null,
        prerequisites: c.prerequisites || null,
        keyPoints: c.keyPoints || null,
        semanticSummary: c.semanticSummary || text.slice(0, 180).replace(/\n/g, ' ')
      });
    }

    return validated;
  }

  /**
   * High-level entry point to index a course's document into PostgreSQL with pgvector embeddings.
   *
   * @param {object} prisma - Prisma client instance.
   * @param {string} courseId - ID of the course.
   * @param {string} fullText - Complete text content.
   * @param {Array<{ page_number: number, text: string }>|null} pages - Optional segmented pages.
   * @param {object|null} curriculum - Generated structured curriculum.
   */
  async indexCourse(prisma, courseId, fullText, pages = null, curriculum = null) {
    await this.ensureColumnsExist(prisma);

    const semanticChunks = this.createSemanticChunks(fullText, pages, curriculum);

    if (semanticChunks.length === 0) {
      console.warn(`[pgvector] No semantic chunks generated for course ${courseId}`);
      return [];
    }

    console.log(`[pgvector] Generated ${semanticChunks.length} semantic chunks for course ${courseId}. Generating OpenAI vector embeddings...`);
    let embeddings = [];
    try {
      const textsToEmbed = semanticChunks.map(c => {
        // Embed concept + topic context alongside chunk text for high-fidelity semantic matching
        const prefix = c.concept ? `[Concept: ${c.concept}] ` : '';
        return `${prefix}${c.chunkText}`;
      });
      embeddings = await aiService.getEmbeddings(textsToEmbed, 768);
      console.log(`[pgvector] Successfully computed ${embeddings.length} OpenAI vector embeddings.`);
    } catch (e) {
      console.warn(`[pgvector] Failed to compute OpenAI embeddings:`, e.message);
    }

    return await this.storeChunks(prisma, courseId, semanticChunks, embeddings);
  }

  /**
   * Stores structured semantic chunks into the PostgreSQL CourseChunk table.
   * Supports pgvector vector column with fallback to standard columns.
   */
  async storeChunks(prisma, courseId, chunks, embeddings = null) {
    await this.ensureColumnsExist(prisma);

    // Delete existing chunks for this course
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CourseChunk" WHERE "courseId" = $1`,
        courseId
      );
    } catch (delErr) {
      console.warn(`[pgvector] Notice on deleting old course chunks:`, delErr.message);
    }

    const savedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingArr = embeddings && embeddings[i] ? embeddings[i] : null;

      let inserted = null;

      // 1. Primary: Insert with pgvector 768-dim embedding and full semantic metadata
      if (embeddingArr && Array.isArray(embeddingArr) && embeddingArr.length > 0) {
        try {
          const vectorStr = `[${embeddingArr.join(',')}]`;
          const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "CourseChunk" (
               "id", "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
               "chunkType", "sourcePage", "sourceSection", "prerequisites", "semanticSummary",
               "embedding", "createdAt"
             )
             VALUES (
               gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10, $11,
               $12::vector, NOW()
             )
             RETURNING "id", "courseId", "chunkIndex", "chunkText", "topic", "concept"`,
            courseId,
            chunk.chunkIndex,
            chunk.chunkText,
            chunk.topic,
            chunk.subtopic,
            chunk.concept,
            chunk.chunkType,
            chunk.sourcePage,
            chunk.sourceSection,
            chunk.prerequisites,
            chunk.semanticSummary,
            vectorStr
          );
          inserted = rows[0];
        } catch (vecErr) {
          // If inserting into vector column failed (e.g. extension syntax variation), log and fallback
          console.warn(`[pgvector] Vector column insert notice for chunk ${chunk.chunkIndex}:`, vecErr.message);
        }
      }

      // 2. Fallback: Insert without vector column but with full metadata
      if (!inserted) {
        try {
          const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "CourseChunk" (
               "id", "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
               "chunkType", "sourcePage", "sourceSection", "prerequisites", "semanticSummary", "createdAt"
             )
             VALUES (
               gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10, $11, NOW()
             )
             RETURNING "id", "courseId", "chunkIndex", "chunkText", "topic", "concept"`,
            courseId,
            chunk.chunkIndex,
            chunk.chunkText,
            chunk.topic,
            chunk.subtopic,
            chunk.concept,
            chunk.chunkType,
            chunk.sourcePage,
            chunk.sourceSection,
            chunk.prerequisites,
            chunk.semanticSummary
          );
          inserted = rows[0];
        } catch (rawErr) {
          // 3. Final ORM fallback
          try {
            inserted = await prisma.courseChunk.create({
              data: {
                courseId,
                chunkIndex: chunk.chunkIndex,
                chunkText: chunk.chunkText,
                topic: chunk.topic,
                concept: chunk.concept
              }
            });
          } catch (prismaErr) {
            console.warn(`[pgvector] Failed to save chunk ${chunk.chunkIndex}:`, prismaErr.message);
          }
        }
      }

      if (inserted) {
        savedChunks.push(inserted);
      }
    }

    console.log(`[pgvector] Stored ${savedChunks.length} semantic chunks in PostgreSQL CourseChunk table.`);
    return savedChunks;
  }

  /**
   * Executes Cosine Distance vector similarity query using PostgreSQL pgvector.
   */
  async searchSimilarChunks(prisma, courseId, queryVector, topK = 5) {
    const vectorStr = `[${queryVector.join(',')}]`;
    const results = await prisma.$queryRawUnsafe(
      `SELECT "id", "chunkIndex" AS "chunk_index", "sourcePage" AS "page_number", "chunkText" AS "text",
              "topic", "subtopic", "concept", "chunkType", "semanticSummary",
              1 - ("embedding" <=> $1::vector) AS "similarity"
       FROM "CourseChunk"
       WHERE "courseId" = $2 AND "embedding" IS NOT NULL
       ORDER BY "embedding" <=> $1::vector
       LIMIT $3`,
      vectorStr,
      courseId,
      topK
    );
    return results;
  }

  /**
   * Hybrid RAG Retrieval Engine:
   * Combines vector similarity with concept/topic relevance and optional neighbor context expansion.
   *
   * @param {object} prisma - Prisma client.
   * @param {string} courseId - Course ID.
   * @param {string} queryText - Query text (lesson title, question, search terms).
   * @param {number} topK - Number of top chunks to retrieve.
   * @param {object} options - Options: { includeNeighbors: boolean, topicFilter: string, conceptFilter: string }.
   * @returns {Promise<Array<object>>} Retrieved chunks with score and metadata.
   */
  async querySimilarChunks(prisma, courseId, queryText, topK = 5, options = {}) {
    if (!queryText || !queryText.trim()) return [];

    let vectorResults = [];
    try {
      const queryVector = await aiService.getEmbedding(queryText, 768);
      if (queryVector && Array.isArray(queryVector)) {
        vectorResults = await this.searchSimilarChunks(prisma, courseId, queryVector, topK * 2);
      }
    } catch (e) {
      console.warn(`[pgvector RAG] Vector search notice (${e.message}). Falling back to text retrieval.`);
    }

    // If vector search returned results, apply concept/topic relevance weighting
    if (vectorResults && vectorResults.length > 0) {
      const topicKeyword = (options.topicFilter || options.lessonTitle || '').toLowerCase().trim();

      const ranked = vectorResults.map(item => {
        let boost = 0;
        if (topicKeyword) {
          const itemText = (item.text || '').toLowerCase();
          const itemTopic = (item.topic || '').toLowerCase();
          const itemConcept = (item.concept || '').toLowerCase();
          if (itemTopic.includes(topicKeyword) || itemConcept.includes(topicKeyword)) {
            boost += 0.25;
          } else if (itemText.includes(topicKeyword)) {
            boost += 0.10;
          }
        }
        return {
          ...item,
          finalScore: (item.similarity || 0.5) + boost
        };
      });

      ranked.sort((a, b) => b.finalScore - a.finalScore);
      let topResults = ranked.slice(0, topK);

      // Context expansion: if includeNeighbors is requested, fetch surrounding chunks for narrative continuity
      if (options.includeNeighbors && topResults.length > 0) {
        const chunkIndices = new Set(topResults.map(r => r.chunk_index));
        const neighborIndices = [];
        for (const idx of chunkIndices) {
          if (idx > 0 && !chunkIndices.has(idx - 1)) neighborIndices.push(idx - 1);
          if (!chunkIndices.has(idx + 1)) neighborIndices.push(idx + 1);
        }

        if (neighborIndices.length > 0) {
          try {
            const neighbors = await prisma.courseChunk.findMany({
              where: {
                courseId,
                chunkIndex: { in: neighborIndices.slice(0, 3) }
              }
            });
            for (const n of neighbors) {
              topResults.push({
                id: n.id,
                chunk_index: n.chunkIndex,
                page_number: n.sourcePage || n.chunkIndex + 1,
                text: n.chunkText,
                topic: n.topic,
                concept: n.concept,
                similarity: 0.4,
                isNeighborContext: true
              });
            }
            topResults.sort((a, b) => a.chunk_index - b.chunk_index);
          } catch (nErr) {
            // Ignore neighbor fetch errors
          }
        }
      }

      return topResults;
    }

    // Fallback: Retrieve chunks directly from CourseChunk table with keyword matching
    try {
      const dbChunks = await prisma.courseChunk.findMany({
        where: { courseId },
        orderBy: { chunkIndex: 'asc' },
        take: topK
      });

      return dbChunks.map(c => ({
        id: c.id,
        chunk_index: c.chunkIndex,
        page_number: c.sourcePage || c.chunkIndex + 1,
        text: c.chunkText,
        topic: c.topic,
        concept: c.concept,
        similarity: 0.5
      }));
    } catch (err) {
      console.warn(`[pgvector RAG] Fallback database retrieval error:`, err.message);
      return [];
    }
  }
}

export default new VectorChunkService();
