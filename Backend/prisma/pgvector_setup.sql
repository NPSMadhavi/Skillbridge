-- =============================================================================
-- pgvector Setup & Chunked Vector Storage Schema for pgAdmin & Skill-Bridge
-- =============================================================================

-- Step 1: Enable the pgvector extension in PostgreSQL
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Ensure uuid extension is enabled for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 3: Create CourseChunk table for storing text chunks and vector embeddings
CREATE TABLE IF NOT EXISTS "CourseChunk" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE,
    "chunkIndex" INT NOT NULL,
    "chunkText" TEXT NOT NULL,
    "embedding" vector(768), -- Change dimension (e.g. 768 or 1536) based on your AI model
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Create indexes for fast metadata lookup and HNSW vector similarity search
CREATE INDEX IF NOT EXISTS "CourseChunk_courseId_idx" ON "CourseChunk"("courseId");

-- HNSW Vector Index for Cosine Similarity Search
CREATE INDEX IF NOT EXISTS "CourseChunk_embedding_hnsw_idx" 
ON "CourseChunk" USING hnsw ("embedding" vector_cosine_ops);

-- =============================================================================
-- Verification & Example Usage Queries
-- =============================================================================

-- Verify vector extension is enabled:
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Example Vector Similarity Search Query (Cosine Distance):
-- SELECT "id", "chunkIndex", "chunkText", 1 - (embedding <=> '[0.01, 0.02, ...]'::vector) AS similarity
-- FROM "CourseChunk"
-- WHERE "courseId" = 'YOUR_COURSE_ID'
-- ORDER BY embedding <=> '[0.01, 0.02, ...]'::vector
-- LIMIT 5;
