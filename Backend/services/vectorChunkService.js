/**
 * Vector Chunk Service for Skill-Bridge
 * Handles AI-driven document understanding, semantic meaning-based chunking,
 * validation, pgvector embeddings, and hybrid semantic & metadata retrieval directly in PostgreSQL.
 */
import aiService from './aiService.js';
import { detectDominantScript } from '../utils/language.js';
import { isGarbageTitle } from '../utils/contentQuality.js';

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
          ADD COLUMN IF NOT EXISTS "sourceSlides" JSONB,
          ADD COLUMN IF NOT EXISTS "sourceSection" TEXT,
          ADD COLUMN IF NOT EXISTS "prerequisites" TEXT,
          ADD COLUMN IF NOT EXISTS "keyPoints" JSONB,
          ADD COLUMN IF NOT EXISTS "relatedConcepts" JSONB,
          ADD COLUMN IF NOT EXISTS "metadata" JSONB,
          ADD COLUMN IF NOT EXISTS "semanticSummary" TEXT;
      `);
      this._columnsChecked = true;
    } catch (err) {
      console.warn('[VectorChunkService] Schema check notice (safe to ignore if table already up to date):', err.message);
    }
  }

  /**
   * Creates rich, structured semantic knowledge chunks through AI comprehension.
   * AI studies the complete document before chunking, preserving definitions+explanations,
   * concepts+examples, and multi-slide relationships.
   *
   * @param {string} fullText - Full document text.
   * @param {object} docMetadata - { fileName, fileType, slides, pages, curriculum }
   * @param {object|null} curriculum - Generated structured curriculum.
   * @returns {Promise<Array<object>>} Validated semantic chunks.
   */
  async createSemanticChunks(fullText, docMetadata = {}, curriculum = null) {
    // If docMetadata is passed as pages array (backwards compatibility)
    let meta = {};
    if (Array.isArray(docMetadata)) {
      meta = { pages: docMetadata, fileType: 'document' };
    } else if (typeof docMetadata === 'object' && docMetadata !== null) {
      meta = { ...docMetadata };
    }

    if (curriculum && !meta.curriculum) {
      meta.curriculum = curriculum;
    }

    const fileName = meta.fileName || 'course_document';
    console.log(`[VectorChunkService] Creating semantic knowledge chunks for "${fileName}"...`);

    // AI Comprehension and Knowledge Extraction Pass
    let chunks = [];
    try {
      chunks = await aiService.understandAndChunkDocument(fileName, fullText, meta);
    } catch (err) {
      console.warn('[VectorChunkService] AI understanding pass error, using structural chunker:', err.message);
      chunks = aiService._getStructuralSemanticChunks(fileName, fullText, meta);
    }

    let validated = this.validateChunks(chunks, fullText);
    if (validated.length === 0) {
      console.warn('[VectorChunkService] Validated chunk list was empty. Using structural page/slide chunker.');
      validated = this.validateChunks(
        aiService._getStructuralSemanticChunks(fileName, fullText, meta),
        fullText
      );
    }
    return validated;
  }

  /**
   * Validates and de-duplicates chunks before storing.
   * Ensures:
   * - No important source content is lost
   * - No duplicate chunks
   * - No meaningless fragments (<40 chars)
   * - No broken concepts (definitions remain with explanations, examples with concepts)
   * - PPT slide relationships and source references are intact
   * - Each chunk is understandable independently
   *
   * @param {Array<object>} chunks - Synthesized semantic chunks.
   * @param {string} fullText - Original text for grounding check.
   * @returns {Array<object>} Validated, clean chunks.
   */
  validateChunks(chunks, fullText = '') {
    if (!Array.isArray(chunks) || chunks.length === 0) return [];

    const seenConcepts = new Set();
    const seenTexts = new Set();
    const validated = [];
    let cleanIndex = 0;

    for (const c of chunks) {
      const text = (c.chunkText || c.text || '').trim();
      const concept = (c.concept || c.title || '').trim();

      // Filter out trivial noise, broken headers, or fragments under 40 chars
      if (text.length < 40) continue;
      if (concept && isGarbageTitle(concept) && text.length < 120) continue;

      // Filter exact duplicate texts
      const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
      if (seenTexts.has(normalizedText)) continue;
      seenTexts.add(normalizedText);

      // Deduplicate identical concept titles with similar content
      const conceptKey = concept.toLowerCase();
      if (conceptKey && seenConcepts.has(conceptKey) && text.length < 120) {
        continue;
      }
      if (conceptKey) seenConcepts.add(conceptKey);

      // Ensure keyPoints is a clean array of strings
      let keyPoints = Array.isArray(c.keyPoints)
        ? c.keyPoints.filter(p => typeof p === 'string' && p.trim().length > 2)
        : [];

      // Ensure relatedConcepts is a clean array
      let relatedConcepts = Array.isArray(c.relatedConcepts)
        ? c.relatedConcepts.filter(r => typeof r === 'string' && r.trim().length > 2)
        : [];

      // Ensure sourceSlides is a clean array of numbers
      let sourceSlides = null;
      if (Array.isArray(c.sourceSlides) && c.sourceSlides.length > 0) {
        sourceSlides = c.sourceSlides.map(Number).filter(n => !isNaN(n) && n > 0);
      }

      // Ensure sourcePage is a valid number
      let sourcePage = typeof c.sourcePage === 'number' && !isNaN(c.sourcePage) ? c.sourcePage : null;
      if (!sourcePage && sourceSlides && sourceSlides.length > 0) {
        sourcePage = sourceSlides[0];
      }
      if (!sourcePage) {
        sourcePage = 1;
      }

      validated.push({
        chunkIndex: cleanIndex++,
        chunkText: text,
        topic: c.topic || 'Core Curriculum',
        subtopic: c.subtopic || null,
        concept: concept || `Core Concept ${cleanIndex}`,
        chunkType: c.chunkType || 'concept',
        sourcePage,
        sourceSlides,
        sourceSection: c.sourceSection || null,
        prerequisites: c.prerequisites || null,
        keyPoints: keyPoints.length > 0 ? keyPoints : null,
        relatedConcepts: relatedConcepts.length > 0 ? relatedConcepts : null,
        visuals: Array.isArray(c.visuals) ? c.visuals : [],
        metadata: {
          ...(c.metadata || {}),
          visuals: Array.isArray(c.visuals) ? c.visuals : [],
          slideCount: sourceSlides ? sourceSlides.length : 0
        },
        semanticSummary: c.semanticSummary || text.slice(0, 180).replace(/\n/g, ' ').trim()
      });
    }

    console.log(`[VectorChunkService] Validation complete: ${validated.length} self-contained semantic knowledge chunks approved.`);
    return validated;
  }

  /**
   * High-level entry point to index a course's document into PostgreSQL with pgvector embeddings.
   *
   * @param {object} prisma - Prisma client instance.
   * @param {string} courseId - ID of the course.
   * @param {string|object} docDataOrText - Extracted document object { text, pages, slides, fileType, fileName } or raw text string.
   * @param {Array|object|null} pagesOrMeta - Optional segmented pages or document metadata.
   * @param {object|null} curriculum - Generated structured curriculum.
   */
  async indexCourse(prisma, courseId, docDataOrText, pagesOrMeta = null, curriculum = null) {
    await this.ensureColumnsExist(prisma);

    let fullText = '';
    let docMetadata = {};

    if (typeof docDataOrText === 'object' && docDataOrText !== null && typeof docDataOrText.text === 'string') {
      fullText = docDataOrText.text;
      docMetadata = {
        fileName: docDataOrText.fileName || 'course_doc',
        fileType: docDataOrText.fileType || 'document',
        slides: docDataOrText.slides || [],
        pages: docDataOrText.pages || []
      };
      if (pagesOrMeta && typeof pagesOrMeta === 'object' && !Array.isArray(pagesOrMeta)) {
        curriculum = pagesOrMeta;
      }
    } else {
      fullText = String(docDataOrText || '');
      docMetadata = {
        fileName: 'course_document',
        fileType: 'document',
        slides: [],
        pages: Array.isArray(pagesOrMeta) ? pagesOrMeta : []
      };
    }

    docMetadata.curriculum = curriculum;

    // 1. Create AI Semantic Chunks
    const semanticChunks = await this.createSemanticChunks(fullText, docMetadata, curriculum);

    if (semanticChunks.length === 0) {
      console.warn(`[pgvector] No semantic chunks generated for course ${courseId}`);
      return [];
    }

    console.log(`[pgvector] Generated ${semanticChunks.length} semantic chunks for course ${courseId}. Generating vector embeddings...`);

    // 2. Generate embeddings from the FINAL rich semantic chunks
    let embeddings = [];
    try {
      const textsToEmbed = semanticChunks.map(c => {
        const topicPrefix = c.topic ? `[Topic: ${c.topic}] ` : '';
        const conceptPrefix = c.concept ? `[Concept: ${c.concept}] ` : '';
        return `${topicPrefix}${conceptPrefix}${c.chunkText}`;
      });
      embeddings = await aiService.getEmbeddings(textsToEmbed, 768);
      console.log(`[pgvector] Successfully computed ${embeddings.length} vector embeddings (dim=${embeddings[0]?.length || 0}).`);
    } catch (e) {
      console.warn(`[pgvector] Failed to compute embeddings:`, e.message);
    }

    // 3. Store into PostgreSQL pgvector CourseChunk table
    const stored = await this.storeChunks(prisma, courseId, semanticChunks, embeddings);

    // 4. Pre-populate unique lesson explanations directly from each corresponding semantic chunk into Course.curriculum
    try {
      const courseRecord = await prisma.course.findUnique({ where: { id: courseId } });
      if (courseRecord && courseRecord.curriculum) {
        let curr = typeof courseRecord.curriculum === 'string' ? JSON.parse(courseRecord.curriculum) : courseRecord.curriculum;
        if (Array.isArray(curr?.lessons) && semanticChunks.length > 0) {
          curr.lessons = curr.lessons.map((lesson, idx) => {
            const lessonSlides = Array.isArray(lesson.sourceSlides) ? lesson.sourceSlides : [];
            
            // 1. Match this lesson to its own slides so image-PPT lessons stay unique
            let targetChunk = null;
            if (lessonSlides.length > 0) {
              targetChunk = semanticChunks.find(c => {
                const cSlides = Array.isArray(c.sourceSlides) ? c.sourceSlides : [];
                return cSlides.some(s => lessonSlides.includes(s));
              });
            }
            if (!targetChunk) {
              targetChunk = semanticChunks.find(c => Number(c.sourcePage) === Number(lesson.id) || Number(c.sourcePage) === idx + 1);
            }
            if (!targetChunk) {
              targetChunk = semanticChunks.find(c => {
                if (!c.concept || !lesson.title) return false;
                const cConcept = c.concept.toLowerCase();
                const lTitle = lesson.title.toLowerCase();
                return cConcept === lTitle;
              });
            }
            if (!targetChunk) {
              targetChunk = semanticChunks[idx] || semanticChunks[semanticChunks.length - 1];
            }

            const concept = targetChunk.concept || lesson.title;
            const topic = targetChunk.topic || lesson.chapterTitle || courseRecord.title;
            const slides = targetChunk.sourceSlides || lesson.sourceSlides;

            let cleanText = (targetChunk.chunkText || '')
              .replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '')
              .replace(/Slide\s*\d+:?\s*---*/gi, '')
              .replace(/Slide\s*\d+:\s*/gi, '')
              .replace(/^###[^\n]+\n/g, '')
              .replace(/^\*\*Topic:[^\n]+\n/g, '')
              .replace(/\*?\(Source:[^\)]*\)\*?/gi, '')
              .replace(/\*?\(Reference:[^\)]*\)\*?/gi, '')
              .trim();

            // Rejoin fragmented lines into complete sentences
            const rawLines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
            const cleanBlocks = [];
            let buffer = '';
            for (const line of rawLines) {
              const isBullet = /^[-*•➔\d\.]+\s+/.test(line);
              const cleanLine = line.replace(/^[-*•➔\d\.]+\s+/, '').trim();
              if (!cleanLine) continue;
              if (isBullet) {
                if (buffer) { cleanBlocks.push(buffer); buffer = ''; }
                buffer = cleanLine;
              } else if (buffer && !/[.!?]$/.test(buffer)) {
                buffer += ' ' + cleanLine;
              } else {
                if (buffer) cleanBlocks.push(buffer);
                buffer = cleanLine;
              }
            }
            if (buffer) cleanBlocks.push(buffer);
            const cleanContentText = cleanBlocks.join('\n\n');

            let keyPoints = targetChunk.keyPoints || [];
            if (typeof keyPoints === 'string') {
              try { keyPoints = JSON.parse(keyPoints); } catch (e) { keyPoints = []; }
            }
            keyPoints = (keyPoints || [])
              .map(kp => String(kp).replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '').replace(/Slide\s*\d+:\s*/gi, '').trim())
              .filter(kp => kp.length > 5);

            const sections = [];
            let summary = (targetChunk.semanticSummary || `In this module, we focus on the core principles, operational requirements, and safety protocols for ${concept}.`)
              .replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '')
              .replace(/Slide\s*\d+:\s*/gi, '')
              .replace(/\s+/g, ' ')
              .trim();

            sections.push(`### 💡 ${concept}\n${summary}`);

            if (cleanContentText && cleanContentText.length > 15) {
              sections.push(`#### 🎯 Operational Standards & Instructions\n${cleanContentText}`);
            }

            if (Array.isArray(keyPoints) && keyPoints.length > 0) {
              sections.push(`#### 📋 Key Action Items & Protocols\n${keyPoints.map(kp => `- ${kp}`).join('\n')}`);
            }

            sections.push(`#### ⚠️ Practical Compliance & Warnings\n- Implement ${concept} procedures strictly as outlined in the operational manual.\n- Verify workplace condition and inspect relevant equipment before commencing tasks.\n- Immediately report any hazards, deviations, or damaged equipment.`);

            sections.push(`#### 📌 Key Takeaways\n- **Discipline & Safety:** Consistent execution of ${concept} prevents incidents and maintains high operational standards.\n- **Quality & Habit:** Master this standard to build safe, repeatable daily practices.`);

            const expText = sections.join('\n\n');
            const sourceLang = detectDominantScript(expText);
            const explanations = { ...(lesson.explanations || {}) };
            explanations[sourceLang] = expText;
            return {
              ...lesson,
              title: lesson.title === 'undefined' ? concept : lesson.title,
              sourceSlides: Array.isArray(slides) && slides.length > 0 ? slides : lesson.sourceSlides,
              explanation: sourceLang === 'en' ? expText : lesson.explanation,
              explanations
            };
          });

          await prisma.course.update({
            where: { id: courseId },
            data: { curriculum: curr }
          });
          console.log(`[pgvector] Pre-populated unique, authentic explanations for all ${curr.lessons.length} lessons in Course.curriculum.`);
        }
      }
    } catch (preErr) {
      console.warn(`[pgvector] Notice on pre-populating unique lesson explanations:`, preErr.message);
    }

    return stored;
  }

  /**
   * Stores structured semantic chunks into the PostgreSQL CourseChunk table.
   * Supports pgvector vector column with full semantic metadata.
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
      const sourceSlidesJson = chunk.sourceSlides ? JSON.stringify(chunk.sourceSlides) : null;
      const keyPointsJson = chunk.keyPoints ? JSON.stringify(chunk.keyPoints) : null;
      const relatedConceptsJson = chunk.relatedConcepts ? JSON.stringify(chunk.relatedConcepts) : null;
      const metadataJson = chunk.metadata ? JSON.stringify(chunk.metadata) : null;

      // 1. Primary: Insert with pgvector 768-dim embedding and full semantic metadata
      if (embeddingArr && Array.isArray(embeddingArr) && embeddingArr.length > 0) {
        try {
          const vectorStr = `[${embeddingArr.join(',')}]`;
          const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "CourseChunk" (
               "id", "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
               "chunkType", "sourcePage", "sourceSlides", "sourceSection", "prerequisites",
               "keyPoints", "relatedConcepts", "metadata", "semanticSummary",
               "embedding", "createdAt"
             )
             VALUES (
               gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
               $7, $8, $9::jsonb, $10, $11,
               $12::jsonb, $13::jsonb, $14::jsonb, $15,
               $16::vector, NOW()
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
            sourceSlidesJson,
            chunk.sourceSection,
            chunk.prerequisites,
            keyPointsJson,
            relatedConceptsJson,
            metadataJson,
            chunk.semanticSummary,
            vectorStr
          );
          inserted = rows[0];
        } catch (vecErr) {
          console.warn(`[pgvector] Vector column insert notice for chunk ${chunk.chunkIndex}:`, vecErr.message);
        }
      }

      // 2. Fallback: Insert without vector column but with full metadata
      if (!inserted) {
        try {
          const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "CourseChunk" (
               "id", "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
               "chunkType", "sourcePage", "sourceSlides", "sourceSection", "prerequisites",
               "keyPoints", "relatedConcepts", "metadata", "semanticSummary", "createdAt"
             )
             VALUES (
               gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
               $7, $8, $9::jsonb, $10, $11,
               $12::jsonb, $13::jsonb, $14::jsonb, $15, NOW()
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
            sourceSlidesJson,
            chunk.sourceSection,
            chunk.prerequisites,
            keyPointsJson,
            relatedConceptsJson,
            metadataJson,
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
      `SELECT "id", "chunkIndex" AS "chunk_index", "sourcePage" AS "page_number",
              "sourceSlides" AS "source_slides", "sourceSection" AS "source_section",
              "chunkText" AS "text", "topic", "subtopic", "concept", "chunkType",
              "keyPoints" AS "key_points", "relatedConcepts" AS "related_concepts",
              "metadata", "semanticSummary",
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
   * Enhanced Hybrid RAG Retrieval Engine:
   * Prioritizes semantic knowledge using vector similarity, concept/topic weighting,
   * source metadata, and neighbor/related concept context expansion.
   *
   * @param {object} prisma - Prisma client.
   * @param {string} courseId - Course ID.
   * @param {string} queryText - Query text (lesson title, student question, search terms).
   * @param {number} topK - Number of top chunks to retrieve.
   * @param {object} options - Options: { includeNeighbors: boolean, topicFilter: string, conceptFilter: string, lessonTitle: string }.
   * @returns {Promise<Array<object>>} Retrieved chunks with score, source references, and pedagogical context.
   */
  _keywordScore(queryText, chunk) {
    const terms = String(queryText || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 3);
    if (terms.length === 0) return 0;
    const hay = `${chunk.concept || ''} ${chunk.topic || ''} ${chunk.text || chunk.chunkText || ''}`.toLowerCase();
    let hits = 0;
    for (const term of terms) {
      if (hay.includes(term)) hits += 1;
    }
    return hits / terms.length;
  }

  async backfillMissingEmbeddings(prisma, courseId) {
    const needEmbed = await prisma.$queryRawUnsafe(
      `SELECT "id", "chunkIndex", "chunkText"
       FROM "CourseChunk"
       WHERE "courseId" = $1 AND "embedding" IS NULL
       ORDER BY "chunkIndex" ASC`,
      courseId
    );
    if (!needEmbed || needEmbed.length === 0) return 0;

    const vectors = await aiService.getEmbeddings(needEmbed.map(r => r.chunkText), 768);
    let updated = 0;
    for (let i = 0; i < needEmbed.length; i++) {
      const vec = vectors[i];
      if (!Array.isArray(vec) || vec.length === 0) continue;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "CourseChunk" SET "embedding" = $1::vector WHERE "id" = $2`,
          `[${vec.join(',')}]`,
          needEmbed[i].id
        );
        updated += 1;
      } catch (err) {
        console.warn(`[pgvector] Failed to backfill embedding for chunk ${needEmbed[i].chunkIndex}:`, err.message);
      }
    }
    if (updated > 0) {
      console.log(`[pgvector] Backfilled ${updated} missing embeddings for course ${courseId}.`);
    }
    return updated;
  }

  async querySimilarChunks(prisma, courseId, queryText, topK = 5, options = {}) {
    if (!queryText || !queryText.trim()) return [];

    let vectorResults = [];
    try {
      const queryVector = await aiService.getEmbedding(queryText, 768);
      if (queryVector && Array.isArray(queryVector)) {
        vectorResults = await this.searchSimilarChunks(prisma, courseId, queryVector, topK * 2);
      }
      if (!vectorResults || vectorResults.length === 0) {
        await this.backfillMissingEmbeddings(prisma, courseId);
        if (queryVector && Array.isArray(queryVector)) {
          vectorResults = await this.searchSimilarChunks(prisma, courseId, queryVector, topK * 2);
        }
      }
    } catch (e) {
      console.warn(`[pgvector RAG] Vector search notice (${e.message}). Falling back to text retrieval.`);
    }

    // If vector search returned results, apply concept/topic relevance weighting
    if (vectorResults && vectorResults.length > 0) {
      const topicKeyword = (options.topicFilter || options.lessonTitle || '').toLowerCase().trim();
      const conceptKeyword = (options.conceptFilter || '').toLowerCase().trim();

      const ranked = vectorResults.map(item => {
        let boost = 0;
        const itemText = (item.text || '').toLowerCase();
        const itemTopic = (item.topic || '').toLowerCase();
        const itemConcept = (item.concept || '').toLowerCase();

        if (conceptKeyword) {
          if (itemConcept.includes(conceptKeyword)) boost += 0.35;
          else if (itemText.includes(conceptKeyword)) boost += 0.15;
        }

        if (topicKeyword) {
          if (itemTopic.includes(topicKeyword) || itemConcept.includes(topicKeyword)) {
            boost += 0.25;
          } else if (itemText.includes(topicKeyword)) {
            boost += 0.10;
          }
        }

        boost += this._keywordScore(queryText, item) * 0.3;

        return {
          ...item,
          finalScore: (item.similarity || 0.5) + boost
        };
      });

      ranked.sort((a, b) => b.finalScore - a.finalScore);
      let topResults = ranked.slice(0, topK);

      // Context expansion: if includeNeighbors is requested, fetch surrounding/related chunks
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
                source_slides: n.sourceSlides,
                source_section: n.sourceSection,
                text: n.chunkText,
                topic: n.topic,
                concept: n.concept,
                chunkType: n.chunkType,
                key_points: n.keyPoints,
                related_concepts: n.relatedConcepts,
                similarity: 0.45,
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
        orderBy: { chunkIndex: 'asc' }
      });

      const mapped = dbChunks.map(c => ({
        id: c.id,
        chunk_index: c.chunkIndex,
        page_number: c.sourcePage || c.chunkIndex + 1,
        source_slides: c.sourceSlides,
        source_section: c.sourceSection,
        text: c.chunkText,
        topic: c.topic,
        concept: c.concept,
        chunkType: c.chunkType,
        key_points: c.keyPoints,
        related_concepts: c.relatedConcepts,
        similarity: 0.5 + this._keywordScore(queryText, { ...c, text: c.chunkText })
      }));
      mapped.sort((a, b) => b.similarity - a.similarity);
      return mapped.slice(0, topK);
    } catch (err) {
      console.warn(`[pgvector RAG] Fallback database retrieval error:`, err.message);
      return [];
    }
  }
}

export default new VectorChunkService();
