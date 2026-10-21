-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Table
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "finNumber" TEXT NOT NULL UNIQUE,
    "preferredLanguage" TEXT,
    "email" TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT,
    "country" TEXT,
    "faceImage" TEXT,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "faceEmbedding" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Admin Table
CREATE TABLE IF NOT EXISTS "Admin" (
    "id" TEXT PRIMARY KEY,
    "email" TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT,
    "nricFin" TEXT UNIQUE,
    "phone" TEXT,
    "department" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- Course Table
CREATE TABLE IF NOT EXISTS "Course" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileText" TEXT NOT NULL,
    "curriculum" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CourseProgress Table
CREATE TABLE IF NOT EXISTS "CourseProgress" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedLessonIds" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseProgress_userId_courseId_key" UNIQUE ("userId", "courseId")
);

-- CourseChunk Table
CREATE TABLE IF NOT EXISTS "CourseChunk" (
    "id" TEXT PRIMARY KEY,
    "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE,
    "chunkIndex" INTEGER NOT NULL,
    "chunkText" TEXT NOT NULL,
    "topic" TEXT,
    "subtopic" TEXT,
    "concept" TEXT,
    "chunkType" TEXT,
    "sourcePage" INTEGER,
    "sourceSlides" JSONB,
    "sourceSection" TEXT,
    "prerequisites" TEXT,
    "keyPoints" JSONB,
    "relatedConcepts" JSONB,
    "semanticSummary" TEXT,
    "metadata" JSONB,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CourseChunk_courseId_idx" ON "CourseChunk"("courseId");
CREATE INDEX IF NOT EXISTS "CourseChunk_topic_idx" ON "CourseChunk"("topic");
CREATE INDEX IF NOT EXISTS "CourseChunk_concept_idx" ON "CourseChunk"("concept");

-- HNSW Vector Index for Cosine Similarity Search
CREATE INDEX IF NOT EXISTS "CourseChunk_embedding_hnsw_idx" 
ON "CourseChunk" USING hnsw ("embedding" vector_cosine_ops);

-- UserCourseAssignment Table
CREATE TABLE IF NOT EXISTS "UserCourseAssignment" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCourseAssignment_userId_courseId_key" UNIQUE ("userId", "courseId")
);

CREATE INDEX IF NOT EXISTS "UserCourseAssignment_userId_idx" ON "UserCourseAssignment"("userId");
CREATE INDEX IF NOT EXISTS "UserCourseAssignment_courseId_idx" ON "UserCourseAssignment"("courseId");

-- Schema Migrations for Existing Databases
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "fullName" TEXT;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "nricFin" TEXT;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "topic" TEXT;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "subtopic" TEXT;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "concept" TEXT;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "chunkType" TEXT;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "sourcePage" INTEGER;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "sourceSlides" JSONB;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "sourceSection" TEXT;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "prerequisites" TEXT;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "keyPoints" JSONB;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "relatedConcepts" JSONB;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "CourseChunk" ADD COLUMN IF NOT EXISTS "semanticSummary" TEXT;

