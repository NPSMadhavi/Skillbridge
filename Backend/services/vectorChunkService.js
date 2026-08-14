/**
 * Vector Chunk Service for Skill-Bridge
 * Handles chunking full document/course text into semantic chunks and executing
 * pgvector similarity operations directly in PostgreSQL.
 */
import aiService from './aiService.js';

export class VectorChunkService {
  /**
   * Splits a long text string into overlapping chunks.
   * @param {string} text - The input text to chunk.
   * @param {number} chunkSize - Maximum characters per chunk (default 800).
   * @param {number} overlap - Overlapping character count (default 100).
   * @returns {Array<{ index: number, text: string }>} Array of chunk objects.
   */
  chunkText(text, chunkSize = 800, overlap = 100) {
    if (!text || text.trim().length === 0) return [];
    
    const cleanText = text.trim();
    const chunks = [];
    let start = 0;
    let index = 0;

    while (start < cleanText.length) {
      let end = start + chunkSize;
      if (end < cleanText.length) {
        // Try to break cleanly at paragraph or newline or period
        const breakPos = cleanText.lastIndexOf('\n', end);
        if (breakPos > start + chunkSize / 2) {
          end = breakPos + 1;
        } else {
          const periodPos = cleanText.lastIndexOf('. ', end);
          if (periodPos > start + chunkSize / 2) {
            end = periodPos + 2;
          }
        }
      } else {
        end = cleanText.length;
      }

      const chunkContent = cleanText.substring(start, end).trim();
      if (chunkContent.length > 0) {
        chunks.push({
          index,
          text: chunkContent
        });
        index++;
      }

      start = end - overlap;
      if (start >= cleanText.length || end >= cleanText.length) break;
    }

    return chunks;
  }

  /**
   * High-level helper to index a course's document into PostgreSQL with pgvector embeddings.
   * @param {object} prisma - Prisma client instance.
   * @param {string} courseId - ID of the course.
   * @param {string} fullText - Complete text content.
   * @param {Array<{ page_number: number, text: string }>|null} pages - Optional page items.
   */
  async indexCourse(prisma, courseId, fullText, pages = null) {
    let chunks = [];

    if (pages && Array.isArray(pages) && pages.length > 0) {
      let globalIndex = 0;
      for (const p of pages) {
        const pageChunks = this.chunkText(p.text, 800, 100);
        if (pageChunks.length === 0) {
          chunks.push({
            index: globalIndex++,
            text: `[Page ${p.page_number}] ${p.text}`
          });
        } else {
          for (const pc of pageChunks) {
            chunks.push({
              index: globalIndex++,
              text: `[Page ${p.page_number}] ${pc.text}`
            });
          }
        }
      }
    } else {
      chunks = this.chunkText(fullText, 800, 100);
    }

    if (chunks.length === 0) {
      console.warn(`[pgvector] No text chunks generated for course ${courseId}`);
      return [];
    }

    console.log(`[pgvector] Generated ${chunks.length} chunks. Computing embeddings via OpenAI...`);
    let embeddings = [];
    try {
      const textsToEmbed = chunks.map(c => c.text);
      embeddings = await aiService.getEmbeddings(textsToEmbed, 768);
      console.log(`[pgvector] Computed ${embeddings.length} vector embeddings.`);
    } catch (e) {
      console.warn(`[pgvector] Failed to compute embeddings:`, e.message);
    }

    return await this.storeChunks(prisma, courseId, chunks, embeddings);
  }

  /**
   * Stores text chunks into PostgreSQL database for a given course.
   * @param {object} prisma - Prisma client instance.
   * @param {string} courseId - ID of the course.
   * @param {Array<{ index: number, text: string }>|string} chunksOrText - Array of chunks or raw text.
   * @param {Array<number[]>|null} embeddings - Optional pre-computed vector embeddings.
   */
  async storeChunks(prisma, courseId, chunksOrText, embeddings = null) {
    const chunks = Array.isArray(chunksOrText) ? chunksOrText : this.chunkText(chunksOrText);

    // Delete existing chunks for this course if any
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CourseChunk" WHERE "courseId" = $1`,
        courseId
      );
    } catch (delErr) {
      console.warn(`[pgvector] Notice on delete old chunks:`, delErr.message);
    }

    const savedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingArr = embeddings && embeddings[i] ? embeddings[i] : null;

      let inserted = null;

      // Try inserting with pgvector embedding
      if (embeddingArr && Array.isArray(embeddingArr) && embeddingArr.length > 0) {
        try {
          const vectorStr = `[${embeddingArr.join(',')}]`;
          const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "CourseChunk" ("id", "courseId", "chunkIndex", "chunkText", "embedding", "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4::vector, NOW())
             RETURNING "id", "courseId", "chunkIndex", "chunkText"`,
            courseId,
            chunk.index,
            chunk.text,
            vectorStr
          );
          inserted = rows[0];
        } catch (vecErr) {
          console.warn(`[pgvector] Vector column insert notice for chunk ${chunk.index}:`, vecErr.message);
        }
      }

      // Fallback standard insertion without vector if vector insert failed or no embedding
      if (!inserted) {
        try {
          const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "CourseChunk" ("id", "courseId", "chunkIndex", "chunkText", "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())
             RETURNING "id", "courseId", "chunkIndex", "chunkText"`,
            courseId,
            chunk.index,
            chunk.text
          );
          inserted = rows[0];
        } catch (rawErr) {
          // Final fallback via Prisma ORM
          try {
            inserted = await prisma.courseChunk.create({
              data: {
                courseId,
                chunkIndex: chunk.index,
                chunkText: chunk.text
              }
            });
          } catch (prismaErr) {
            console.warn(`[pgvector] Failed to save chunk ${chunk.index}:`, prismaErr.message);
          }
        }
      }

      if (inserted) {
        savedChunks.push(inserted);
      }
    }

    console.log(`[pgvector] Stored ${savedChunks.length} chunks in PostgreSQL CourseChunk table.`);
    return savedChunks;
  }

  /**
   * Performs vector similarity search using pgvector (<=> Cosine Distance)
   * @param {object} prisma - Prisma client instance.
   * @param {string} courseId - Course ID to search within.
   * @param {number[]} queryVector - Vector representation of the search query.
   * @param {number} topK - Number of top chunks to return.
   */
  async searchSimilarChunks(prisma, courseId, queryVector, topK = 5) {
    const vectorStr = `[${queryVector.join(',')}]`;
    const results = await prisma.$queryRawUnsafe(
      `SELECT "id", "chunkIndex" AS "chunk_index", "chunkIndex" + 1 AS "page_number", "chunkText" AS "text",
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
   * End-to-end semantic query search in PostgreSQL pgvector.
   * Embeds the query and retrieves the top-K relevant chunks with fallback to database text chunks.
   * @param {object} prisma - Prisma client instance.
   * @param {string} courseId - Course ID.
   * @param {string} queryText - Query text (lesson title, question, or search string).
   * @param {number} topK - Top K results.
   */
  async querySimilarChunks(prisma, courseId, queryText, topK = 5) {
    if (!queryText || !queryText.trim()) return [];

    try {
      const queryVector = await aiService.getEmbedding(queryText, 768);
      if (queryVector && Array.isArray(queryVector)) {
        const results = await this.searchSimilarChunks(prisma, courseId, queryVector, topK);
        if (results && results.length > 0) {
          console.log(`[pgvector RAG] Found ${results.length} relevant chunks using vector similarity.`);
          return results;
        }
      }
    } catch (e) {
      console.warn(`[pgvector RAG] Vector search error (${e.message}). Falling back to text retrieval.`);
    }

    // Fallback: Retrieve chunks directly from CourseChunk table
    try {
      const dbChunks = await prisma.courseChunk.findMany({
        where: { courseId },
        orderBy: { chunkIndex: 'asc' },
        take: topK
      });

      return dbChunks.map(c => ({
        id: c.id,
        chunk_index: c.chunkIndex,
        page_number: c.chunkIndex + 1,
        text: c.chunkText,
        similarity: 0.5
      }));
    } catch (err) {
      console.warn(`[pgvector RAG] Fallback retrieval error:`, err.message);
      return [];
    }
  }
}

export default new VectorChunkService();
