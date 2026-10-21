import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import prisma, { defaultPrisma } from '../config/prisma.js';
import aiService from '../services/aiService.js';
import vectorChunkService from '../services/vectorChunkService.js';
import documentExtractor from '../services/documentExtractor.js';
import tenantService from '../services/tenantService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { resolveLanguageInfo, textMatchesLanguage } from '../utils/language.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
});

/**
 * Extracts text and segmented pages/slides from any supported document format.
 * Supported: PPTX, PPT, PDF, DOCX, DOC, TXT, MD, CSV, JSON, RTF, HTML, etc.
 */
async function extractDocumentContent(file) {
  return await documentExtractor.extractDocument(file);
}

// 1. Admin: Create course module by uploading a document (PDF, Word, PPTX, TXT, etc.)
router.post('/upload', authenticateToken, requireRole(['ADMIN']), upload.single('file'), async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Course title and description/info are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a course document (PDF, DOCX, DOC, PPTX, PPT, TXT, etc.).' });
    }

    console.log(`[Document Extraction] Admin creating course: "${title}", parsing file: ${req.file.originalname}...`);
    const docResult = await extractDocumentContent(req.file);
    const { text: textContent, pages, slides, fileType } = docResult;

    const imageCount = (slides || []).reduce((n, s) => n + ((s.images || []).length), 0) + ((docResult.images || []).length);
    if (!textContent || textContent.length < 30) {
      return res.status(400).json({
        error: imageCount > 0
          ? 'The PowerPoint is image-based, but no readable training text could be found in the slide pictures. Try a PPTX with clearer photos, or add slide titles/notes.'
          : 'Failed to extract text from document. The file might be empty, password-protected, or scanned images only.'
      });
    }

    const segmentsCount = slides.length > 0 ? `${slides.length} slide(s)` : `${pages.length} section(s)/page(s)`;
    console.log(`[Document Extraction] Document extracted successfully. Extracted ${textContent.length} characters across ${segmentsCount} (${fileType.toUpperCase()}).`);

    console.log(`[Curriculum Design] Generating dynamic content-driven curriculum from document...`);
    const generatedCourse = await aiService.generateCourse(req.file.originalname, textContent, docResult);

    // Override the title/description with Admin input if needed, but preserve structure
    generatedCourse.title = title.trim();
    generatedCourse.description = description.trim();

    console.log(`[Curriculum Design] Curriculum structured. Saving course to database...`);
    const targetPrisma = req.prisma || prisma;
    const newCourse = await targetPrisma.course.create({
      data: {
        title: generatedCourse.title,
        description: generatedCourse.description,
        fileName: req.file.originalname,
        fileText: textContent,
        curriculum: generatedCourse,
      },
    });

    // Store semantic chunks and generate vector embeddings directly in PostgreSQL pgvector
    try {
      console.log(`[pgvector] Indexing course ${newCourse.id} with semantic comprehension into PostgreSQL pgvector...`);
      await vectorChunkService.indexCourse(targetPrisma, newCourse.id, docResult, generatedCourse);
      console.log(`[pgvector] Course chunks and vector embeddings stored successfully.`);

      // If created in a company tenant, also mirror into defaultPrisma so all companies have it
      if (req.tenantCode && req.tenantCode !== 'default') {
        try {
          await tenantService.syncDefaultCoursesToTenant(req.tenantCode);
        } catch (_) {}
      }
    } catch (vectorErr) {
      console.warn(`[pgvector] Indexing warning for course ${newCourse.id}:`, vectorErr.message);
    }

    try {
      const summary = generateModulesSummary(generatedCourse);
      await targetPrisma.$executeRaw`
        UPDATE "Course"
        SET "modulesSummary" = ${JSON.stringify(summary)}::jsonb
        WHERE id = ${newCourse.id};
      `;
    } catch (_) {}
    invalidateCoursesCatalogCache();

    res.status(201).json({
      message: 'Course published successfully.',
      course: {
        id: newCourse.id,
        title: newCourse.title,
        description: newCourse.description,
        fileName: newCourse.fileName,
        curriculum: newCourse.curriculum,
        createdAt: newCourse.createdAt,
      },
    });
  } catch (error) {
    console.error('[Document Extraction] Failed to publish course:', error);
    res.status(500).json({ error: error.message || 'Failed to process document and publish course.' });
  }
});

// 1b. Admin: Manually create course module (without PDF upload)
router.post('/manual', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { title, description, category, level, curriculum } = req.body;

    if (!title || !title.trim() || !description || !description.trim()) {
      return res.status(400).json({ error: 'Course title and description are required.' });
    }

    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();

    let curriculumObj = curriculum;
    if (!curriculumObj || typeof curriculumObj !== 'object') {
      curriculumObj = {
        title: trimmedTitle,
        description: trimmedDesc,
        category: category || 'General',
        level: level || 'Intermediate',
        curriculum: [
          { title: `${trimmedTitle} Fundamentals`, lessons: 2, duration: '15m', locked: false },
          { title: `${trimmedTitle} Practical Application`, lessons: 2, duration: '20m', locked: true }
        ],
        lessons: [
          { id: 1, chapterId: 1, chapterTitle: `${trimmedTitle} Fundamentals`, moduleId: 1, moduleTitle: `${trimmedTitle} Fundamentals`, title: `${trimmedTitle} Essentials`, duration: '07:30', status: 'active' },
          { id: 2, chapterId: 1, chapterTitle: `${trimmedTitle} Fundamentals`, moduleId: 1, moduleTitle: `${trimmedTitle} Fundamentals`, title: 'Core Operating Guidelines', duration: '08:15', status: 'locked' },
          { id: 3, chapterId: 2, chapterTitle: `${trimmedTitle} Practical Application`, moduleId: 2, moduleTitle: `${trimmedTitle} Practical Application`, title: 'Practical Execution & Safety Checks', duration: '09:45', status: 'locked' },
          { id: 4, chapterId: 2, chapterTitle: `${trimmedTitle} Practical Application`, moduleId: 2, moduleTitle: `${trimmedTitle} Practical Application`, title: 'Operational Review & Verification', duration: '08:30', status: 'locked' }
        ],
        quiz: [
          {
            question: `What is the primary focus of "${trimmedTitle}"?`,
            options: [
              trimmedDesc.slice(0, 60) + '...',
              'General computing concepts',
              'Advanced theoretical research',
              'System maintenance'
            ],
            answerIndex: 0
          }
        ]
      };
    } else {
      curriculumObj.title = trimmedTitle;
      curriculumObj.description = trimmedDesc;
    }

    const targetPrisma = req.prisma || prisma;
    const newCourse = await targetPrisma.course.create({
      data: {
        title: trimmedTitle,
        description: trimmedDesc,
        fileName: 'Manual Entry',
        fileText: trimmedDesc,
        curriculum: curriculumObj
      }
    });

    try {
      const summary = generateModulesSummary(curriculumObj);
      await targetPrisma.$executeRaw`
        UPDATE "Course"
        SET "modulesSummary" = ${JSON.stringify(summary)}::jsonb
        WHERE id = ${newCourse.id};
      `;
    } catch (_) {}
    invalidateCoursesCatalogCache();

    res.status(201).json({
      message: 'Course created successfully.',
      course: newCourse
    });
  } catch (error) {
    console.error('Failed to create manual course:', error);
    res.status(500).json({ error: error.message || 'Failed to create manual course.' });
  }
});

// Helper to collect all potential user identification aliases (UUID, email, FIN)
const resolveUserIdentifiers = async (user) => {
  if (!user) return [];
  const directId = user.id || user.userId;
  const email = user.email ? String(user.email).trim().toLowerCase() : null;
  const fin = user.finNumber ? String(user.finNumber).trim() : null;

  const identifiers = new Set();
  if (directId) identifiers.add(String(directId));
  if (email) identifiers.add(email);
  if (fin) identifiers.add(fin);

  // Look up user record in current tenant database to find primary UUID
  try {
    const conditions = [];
    if (directId) conditions.push({ id: directId });
    if (email) conditions.push({ email });
    if (fin) conditions.push({ finNumber: fin });

    if (conditions.length > 0) {
      const dbUser = await prisma.user.findFirst({
        where: { OR: conditions },
        select: { id: true, email: true, finNumber: true }
      });
      if (dbUser) {
        if (dbUser.id) identifiers.add(String(dbUser.id));
        if (dbUser.email) identifiers.add(dbUser.email.toLowerCase());
        if (dbUser.finNumber) identifiers.add(dbUser.finNumber);
      }
    }
  } catch (err) {
    console.warn('[Courses] Identifier resolution warning:', err.message);
  }

  return Array.from(identifiers);
};

// Helper to verify student course assignment access
const checkCourseAccess = async (req, courseId) => {
  if (req.user?.role === 'ADMIN') return true;
  const userIds = await resolveUserIdentifiers(req.user);
  if (userIds.length === 0) return false;

  const assignment = await prisma.userCourseAssignment.findFirst({
    where: {
      userId: { in: userIds },
      courseId,
    },
  });
  return Boolean(assignment);
};

// Helper to generate fast lightweight modules summary
export function generateModulesSummary(curriculum) {
  if (!curriculum) return {};
  let curr = curriculum;
  if (typeof curr === 'string') {
    try { curr = JSON.parse(curr); } catch (_) { curr = {}; }
  }
  const sanitizedLessons = (curr?.lessons || []).map((l) => ({
    id: l.id,
    title: l.title,
    duration: l.duration,
    moduleId: l.moduleId,
    chapterId: l.chapterId,
    moduleTitle: l.moduleTitle,
    chapterTitle: l.chapterTitle,
  }));

  return {
    title: curr?.title || '',
    description: curr?.description || '',
    curriculum: curr?.curriculum || [],
    lessons: sanitizedLessons,
    quiz: curr?.quiz || [],
    modulesCount: (curr?.curriculum || []).length || sanitizedLessons.length,
    lessonsCount: sanitizedLessons.length,
  };
}

// In-memory catalog cache for sub-millisecond responses
let catalogCache = null;
let catalogCacheTime = 0;
const CATALOG_CACHE_TTL = 30 * 1000; // 30 seconds TTL

export function invalidateCoursesCatalogCache() {
  catalogCache = null;
  catalogCacheTime = 0;
}

// Helper to format lightweight course object for catalog/listing without massive base64 payloads
function formatCourseForCatalog(course) {
  let curriculumSummary = course.curriculum;
  if (curriculumSummary) {
    if (typeof curriculumSummary === 'string') {
      try {
        curriculumSummary = JSON.parse(curriculumSummary);
      } catch (e) {
        curriculumSummary = {};
      }
    }

    // Strip heavy base64 visuals and raw slide data from lessons for fast catalog listing
    const sanitizedLessons = (curriculumSummary.lessons || []).map((l) => ({
      id: l.id,
      title: l.title,
      duration: l.duration,
      moduleId: l.moduleId,
      chapterId: l.chapterId,
      moduleTitle: l.moduleTitle,
      chapterTitle: l.chapterTitle,
      explanation: l.explanation,
      sourceSlides: l.sourceSlides,
    }));

    curriculumSummary = {
      title: curriculumSummary.title,
      description: curriculumSummary.description,
      includes: curriculumSummary.includes,
      learning: curriculumSummary.learning,
      curriculum: curriculumSummary.curriculum,
      lessons: sanitizedLessons,
      quiz: curriculumSummary.quiz,
    };
  }

  return {
    id: course.id,
    title: course.title,
    description: course.description,
    fileName: course.fileName,
    curriculum: curriculumSummary,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    assignedUsersCount: course.assignedUsersCount ?? course._count?.assignments ?? 0,
  };
}

// 2. Get published RAG courses (Admin gets all with counts; Students get ONLY assigned courses)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const targetPrisma = req.prisma || prisma;

    // Ensure shared courses from default catalog are synchronized in background without blocking
    if (req.tenantCode && req.tenantCode !== 'default') {
      tenantService.syncDefaultCoursesToTenant(req.tenantCode).catch((syncErr) => {
        console.warn(`[Courses] Auto-sync to tenant notice:`, syncErr.message);
      });
    }

    if (req.user?.role === 'ADMIN') {
      const now = Date.now();
      if (catalogCache && (now - catalogCacheTime) < CATALOG_CACHE_TTL) {
        return res.json(catalogCache);
      }

      const courses = await targetPrisma.$queryRaw`
        SELECT
          c.id,
          c.title,
          c.description,
          c."fileName",
          c."createdAt",
          c."updatedAt",
          (
            SELECT COUNT(*)::int
            FROM "UserCourseAssignment" uca
            WHERE uca."courseId" = c.id
          ) AS "assignedUsersCount",
          c.curriculum AS curriculum
        FROM "Course" c
        ORDER BY c."createdAt" DESC;
      `;
      const formatted = courses.map(formatCourseForCatalog);
      catalogCache = formatted;
      catalogCacheTime = now;
      return res.json(formatted);
    }

    // For STUDENT role: return ONLY assigned courses
    const userIds = await resolveUserIdentifiers(req.user);
    if (userIds.length === 0) {
      return res.json([]);
    }

    const assignments = await targetPrisma.userCourseAssignment.findMany({
      where: {
        userId: { in: userIds }
      },
      select: { courseId: true },
    });
    const assignedIds = assignments.map((a) => a.courseId);

    if (assignedIds.length === 0) {
      return res.json([]);
    }

    const courses = await targetPrisma.$queryRaw`
      SELECT
        c.id,
        c.title,
        c.description,
        c."fileName",
        c."createdAt",
        c."updatedAt",
        (
          SELECT COUNT(*)::int
          FROM "UserCourseAssignment" uca
          WHERE uca."courseId" = c.id
        ) AS "assignedUsersCount",
        c.curriculum AS curriculum
      FROM "Course" c
      WHERE c.id = ANY(${assignedIds}::text[])
      ORDER BY c."createdAt" DESC;
    `;
    return res.json(courses.map(formatCourseForCatalog));
  } catch (error) {
    console.error('Failed to retrieve RAG courses:', error);
    res.status(500).json({ error: 'Failed to retrieve courses catalog.' });
  }
});

// 3. Get specific course details (verifying assignment for students)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.tenantCode && req.tenantCode !== 'default') {
      tenantService.syncDefaultCoursesToTenant(req.tenantCode).catch(() => {});
    }

    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          select: {
            id: true,
            chunkIndex: true,
            chunkText: true,
            topic: true,
            subtopic: true,
            concept: true,
            chunkType: true,
            sourcePage: true,
            sourceSlides: true,
            sourceSection: true,
            keyPoints: true,
            relatedConcepts: true,
            semanticSummary: true,
            metadata: true
          }
        },
        _count: {
          select: { assignments: true },
        },
      },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    const hasAccess = await checkCourseAccess(req, course.id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
    }

    let curriculumData = typeof course.curriculum === 'string'
      ? JSON.parse(course.curriculum)
      : (course.curriculum || {});

    // Parse slide blocks from fileText if available for rich fallback
    const slideBlockMap = new Map();
    if (course.fileText) {
      const blocks = course.fileText.split(/(?=--- Slide \d+:)/);
      for (const b of blocks) {
        const match = b.match(/--- Slide (\d+):\s*(.*?)\s*---/);
        if (match) {
          const sNum = parseInt(match[1], 10);
          const sTitle = match[2]?.trim() || `Slide ${sNum}`;
          const lines = b.replace(/--- Slide \d+:[^\n]+\n/, '').split('\n').map(l => l.trim()).filter(Boolean);
          const bullets = lines.filter(l => l.startsWith('- ') || l.startsWith('* ') || /^\d+\.\s/.test(l));
          const tables = lines.filter(l => l.includes('|'));
          const paragraphs = lines.filter(l => !l.startsWith('- ') && !l.startsWith('* ') && !/^\d+\.\s/.test(l) && !l.includes('|') && !l.startsWith('#') && !l.startsWith('['));
          slideBlockMap.set(sNum, {
            slideNumber: sNum,
            title: sTitle,
            bulletPoints: bullets,
            tables,
            paragraphs,
            fullText: b.trim()
          });
        }
      }
    }

    // Enrich lessons with authentic slide / chunk data
    if (Array.isArray(curriculumData.lessons)) {
      curriculumData.lessons = curriculumData.lessons.map((lesson, idx) => {
        const sNums = Array.isArray(lesson.sourceSlides) ? lesson.sourceSlides : [idx + 1];
        const sNum = sNums[0] || (idx + 1);

        // Find matching chunk from pgvector CourseChunk table
        const matchedChunk = (course.chunks || []).find(c => {
          if (Array.isArray(c.sourceSlides) && c.sourceSlides.includes(sNum)) return true;
          if (c.sourcePage === sNum) return true;
          return false;
        }) || (course.chunks && course.chunks[idx]);

        const slideBlock = slideBlockMap.get(sNum);

        let slideData = lesson.slideData;
        if (!slideData) {
          if (slideBlock) {
            slideData = {
              slideNumber: slideBlock.slideNumber,
              title: slideBlock.title || lesson.title,
              headings: [],
              bulletPoints: slideBlock.bulletPoints || [],
              paragraphs: slideBlock.paragraphs || [],
              tables: slideBlock.tables || [],
              speakerNotes: '',
              fullText: slideBlock.fullText || '',
              images: lesson.visuals || []
            };
          } else if (matchedChunk) {
            const lines = (matchedChunk.chunkText || '').split('\n').map(l => l.trim()).filter(Boolean);
            const bullets = lines.filter(l => l.startsWith('- ') || l.startsWith('* ') || /^\d+\.\s/.test(l));
            const tables = lines.filter(l => l.includes('|'));
            const paragraphs = lines.filter(l => !l.startsWith('- ') && !l.startsWith('* ') && !/^\d+\.\s/.test(l) && !l.includes('|') && !l.startsWith('#'));
            slideData = {
              slideNumber: matchedChunk.sourcePage || sNum,
              title: matchedChunk.concept || lesson.title,
              headings: [matchedChunk.topic].filter(Boolean),
              bulletPoints: bullets.length > 0 ? bullets : (matchedChunk.keyPoints || []),
              paragraphs,
              tables,
              speakerNotes: '',
              fullText: matchedChunk.chunkText || '',
              images: lesson.visuals || (matchedChunk.metadata?.visuals || [])
            };
          }
        }

        return {
          ...lesson,
          sourceSlides: sNums,
          slideData,
          chunkData: matchedChunk ? {
            chunkIndex: matchedChunk.chunkIndex,
            title: matchedChunk.concept || lesson.title,
            text: matchedChunk.chunkText || '',
            bulletPoints: matchedChunk.keyPoints || []
          } : null
        };
      });
    }

    res.json({
      ...course,
      curriculum: curriculumData,
      assignedUsersCount: course._count?.assignments || 0,
    });
  } catch (error) {
    console.error('Failed to retrieve course details:', error);
    res.status(500).json({ error: 'Failed to retrieve course details.' });
  }
});


function synthesizeLessonFromDbChunks(lessonTitle, chunks, courseTitle = '', matchingLesson = null) {
  // Find the most relevant chunk for this specific lesson
  let targetChunk = null;
  if (Array.isArray(chunks) && chunks.length > 0) {
    targetChunk = chunks.find(c => {
      const cConcept = (c.concept || '').toLowerCase();
      const lTitle = (lessonTitle || '').toLowerCase();
      return cConcept === lTitle || lTitle.includes(cConcept) || cConcept.includes(lTitle);
    }) || chunks[0];
  }

  if (!targetChunk) {
    return `### 💡 ${lessonTitle}\nIn this lesson, we study the core operational standards, protocols, and safety practices for ${lessonTitle}.\n\n#### 🎯 Key Protocols\n- Follow all standard operational procedures.\n- Verify all safety requirements before beginning tasks.\n\n#### 📌 Key Takeaways\n- Strict adherence to guidelines prevents errors and ensures safety.`;
  }

  const concept = targetChunk.concept || lessonTitle;
  const topic = targetChunk.topic || matchingLesson?.chapterTitle || matchingLesson?.moduleTitle || courseTitle;

  let rawText = (targetChunk.text || targetChunk.chunkText || '')
    .replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '')
    .replace(/Slide\s*\d+:?\s*---*/gi, '')
    .replace(/Slide\s*\d+:\s*/gi, '')
    .replace(/^###[^\n]+\n/g, '')
    .replace(/^\*\*Topic:[^\n]+\n/g, '')
    .replace(/\*?\(Source:[^\)]*\)\*?/gi, '')
    .replace(/\*?\(Reference:[^\)]*\)\*?/gi, '')
    .trim();

  // Rejoin fragmented lines from PowerPoint line wraps into coherent sentences
  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
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

  let keyPoints = targetChunk.key_points || targetChunk.keyPoints || [];
  if (typeof keyPoints === 'string') {
    try { keyPoints = JSON.parse(keyPoints); } catch(e) { keyPoints = []; }
  }
  keyPoints = (keyPoints || [])
    .map(kp => String(kp).replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '').replace(/Slide\s*\d+:\s*/gi, '').trim())
    .filter(kp => kp.length > 5);

  const sections = [];
  let summary = (targetChunk.semanticSummary || `In this lesson, we study the core standards, operational requirements, and protocols for ${concept}.`)
    .replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '')
    .replace(/Slide\s*\d+:\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  sections.push(`### 💡 ${concept}\n${summary}`);

  if (cleanContentText && cleanContentText.length > 15) {
    sections.push(`#### 🎯 Operational Principles & Standards\n${cleanContentText}`);
  }

  if (Array.isArray(keyPoints) && keyPoints.length > 0) {
    sections.push(`#### 📋 Key Action Items & Protocols\n${keyPoints.map(kp => `- ${kp}`).join('\n')}`);
  }

  sections.push(`#### ⚠️ Safety & Operational Compliance\n- Apply verified protocols for ${concept} systematically in your daily tasks.\n- Adhere strictly to equipment operation limits and safety boundaries.\n- Report any non-conformances, hazards, or equipment defects immediately.`);

  sections.push(`#### 📌 Key Takeaways\n- **Safety & Discipline:** Consistent execution of ${concept} standards prevents incidents and ensures reliable operations.\n- **Quality:** Maintaining verified practices eliminates defects and ensures operational excellence.`);

  return sections.join('\n\n');
}

// 4. Generate AI concept explanation for a specific lesson/chapter using RAG Vector DB with Database Persistence Cache
router.post('/:id/lessons/:lessonId/explain', authenticateToken, async (req, res) => {
  const fetchStartTime = Date.now();
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id }
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    const hasAccess = await checkCourseAccess(req, course.id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
    }

    const { lessonTitle, language } = req.body;
    if (!lessonTitle) {
      return res.status(400).json({ error: 'Lesson title is required.' });
    }

    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);
    const targetLanguage = targetLangInfo.name;
    const lessonIdStr = String(req.params.lessonId);

    console.log(`[PERF:LESSON_FETCH_START] Course: ${course.id}, Lesson: ${lessonIdStr} ("${lessonTitle}"), Lang: "${targetLanguage}" (${targetLangInfo.code})`);

    // 1. FAST PATH 1: Check if lesson explanation is already stored in Course.curriculum database record
    let curriculum = course.curriculum;
    if (typeof curriculum === 'string') {
      try { curriculum = JSON.parse(curriculum); } catch { curriculum = {}; }
    }
    if (!curriculum || typeof curriculum !== 'object') curriculum = {};

    if (Array.isArray(curriculum.lessons)) {
      const existingLesson = curriculum.lessons.find(
        l => String(l.id) === lessonIdStr || l.title === lessonTitle
      );

      if (existingLesson) {
        const cachedExplanation = existingLesson.explanations?.[targetLangInfo.code] ||
          (targetLangInfo.code === 'en' ? existingLesson.explanation : null);

        if (
          cachedExplanation &&
          typeof cachedExplanation === 'string' &&
          cachedExplanation.trim().length > 30 &&
          textMatchesLanguage(cachedExplanation, targetLangInfo.code)
        ) {
          const fetchDuration = Date.now() - fetchStartTime;
          console.log(`[PERF:LESSON_FETCH_END] Served lesson "${lessonTitle}" directly from PostgreSQL DB cache in ${fetchDuration}ms (0 network / 0 LLM latency)`);
          return res.json({
            explanation: cachedExplanation,
            visuals: existingLesson.visuals || [],
            sourceSlides: existingLesson.sourceSlides || [],
            language: targetLangInfo,
            cached: true,
            fetchDurationMs: fetchDuration
          });
        }
      }
    }

    // 2. FAST PATH 2: Instant Database Retrieval from CourseChunk table (0 slow external LLM calls)
    const ragStartTime = Date.now();
    console.log(`[PERF:RAG_START] Fetching semantic knowledge chunks directly from PostgreSQL for lesson "${lessonTitle}" (Course ID: ${course.id})`);

    let chunks = [];
    try {
      chunks = await vectorChunkService.querySimilarChunks(prisma, course.id, lessonTitle, 6, {
        includeNeighbors: true,
        lessonTitle,
        topicFilter: lessonTitle
      });
      const ragDuration = Date.now() - ragStartTime;
      console.log(`[PERF:RAG_END] Retrieved ${chunks.length} chunks directly from pgvector in ${ragDuration}ms.`);
    } catch (e) {
      const ragDuration = Date.now() - ragStartTime;
      console.warn(`[PERF:RAG_END] pgvector query notice (${ragDuration}ms):`, e.message);
    }

    // Collect visuals from matched chunks or curriculum
    let matchingLesson = null;
    if (Array.isArray(curriculum?.lessons)) {
      matchingLesson = curriculum.lessons.find(l => String(l.id) === lessonIdStr || l.title === lessonTitle);
    }
    const retrievedVisuals = matchingLesson?.visuals || chunks.flatMap(c => c.metadata?.visuals || c.visuals || []);
    const uniqueVisuals = [];
    for (const v of retrievedVisuals) {
      if (v && !uniqueVisuals.some(uv => uv.id === v.id || (uv.dataUrl && uv.dataUrl === v.dataUrl))) {
        uniqueVisuals.push(v);
      }
    }

    // Synthesize structured blackboard lesson notes in the selected language only.
    // Source chunks (OCR / PPT) may be Bangla even when the student chose English.
    let explanation;
    const sourceScript = synthesizeLessonFromDbChunks(lessonTitle, chunks, course.title, matchingLesson);
    const sourceAlreadyInTarget = textMatchesLanguage(sourceScript, targetLangInfo.code);

    if (targetLangInfo.code === 'en' && sourceAlreadyInTarget) {
      explanation = sourceScript;
    } else {
      try {
        console.log(`[PERF:LLM_START] Generating lesson explanation in ${targetLanguage} (${targetLangInfo.code})...`);
        explanation = await aiService.explainLesson(course.title, lessonTitle, sourceScript, targetLanguage);
        console.log(`[PERF:LLM_END] Multilingual explanation generated in ${targetLanguage}`);
      } catch (err) {
        console.warn(`[PERF:LLM_END] AI multilingual fallback triggered for ${targetLanguage}:`, err.message);
        explanation = aiService._getMockExplanation(lessonTitle, targetLanguage);
      }
    }

    if (explanation && !textMatchesLanguage(explanation, targetLangInfo.code)) {
      try {
        console.log(`[Language Lock] Regenerating lesson "${lessonTitle}" because output was not ${targetLanguage}`);
        explanation = await aiService.explainLesson(course.title, lessonTitle, sourceScript, targetLanguage);
      } catch (err) {
        explanation = aiService._getMockExplanation(lessonTitle, targetLanguage);
      }
    }

    if (!explanation || explanation.length < 50) {
      explanation = aiService._getMockExplanation(lessonTitle, targetLanguage);
    }

    // 3. PERSISTENCE: Save synthesized explanation into PostgreSQL Course.curriculum for instant future opens
    try {
      if (Array.isArray(curriculum.lessons)) {
        const targetLesson = curriculum.lessons.find(
          l => String(l.id) === lessonIdStr || l.title === lessonTitle
        );
        if (targetLesson) {
          if (!targetLesson.explanations) targetLesson.explanations = {};
          if (textMatchesLanguage(explanation, targetLangInfo.code)) {
            targetLesson.explanations[targetLangInfo.code] = explanation;
            if (targetLangInfo.code === 'en') {
              targetLesson.explanation = explanation;
            }
          }
          await prisma.course.update({
            where: { id: course.id },
            data: { curriculum: curriculum }
          });
          console.log(`[Persisted Cache] Successfully persisted explanation for lesson "${lessonTitle}" (${targetLangInfo.code}) into Course.curriculum`);
        }
      }
    } catch (persistErr) {
      console.warn(`[Persisted Cache] Notice on persisting lesson explanation:`, persistErr.message);
    }

    const totalDuration = Date.now() - fetchStartTime;
    console.log(`[PERF:LESSON_FETCH_END] Total instant lesson fetch completed in ${totalDuration}ms (0 slow external LLM delay)`);

    res.json({
      explanation,
      visuals: uniqueVisuals,
      sourceSlides: matchingLesson?.sourceSlides || [],
      language: targetLangInfo,
      cached: false,
      fetchDurationMs: totalDuration,
      ragDurationMs: Date.now() - ragStartTime
    });
  } catch (error) {
    console.error('Failed to generate dynamic lesson guide:', error);
    res.status(500).json({ error: 'Failed to generate custom lesson guide.' });
  }
});

// 4b. Generate AI Assessment Quiz for a specific lesson/chapter using RAG Vector DB
router.post('/:id/lessons/:lessonId/quiz', authenticateToken, async (req, res) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id }
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    const hasAccess = await checkCourseAccess(req, course.id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
    }

    const { lessonTitle, language } = req.body;
    if (!lessonTitle) {
      return res.status(400).json({ error: 'Lesson title is required.' });
    }

    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);
    const targetLanguage = targetLangInfo.name;
    console.log(`[RAG Quiz Query] Target Language: "${targetLanguage}" (${targetLangInfo.code}), Lesson: "${lessonTitle}" (Course ID: ${course.id})`);

    // Retrieve semantically relevant context chunks from PostgreSQL pgvector for this specific chapter
    let chunks = [];
    try {
      chunks = await vectorChunkService.querySimilarChunks(prisma, course.id, lessonTitle, 5, {
        lessonTitle,
        topicFilter: lessonTitle
      });
      console.log(`[pgvector Quiz Query] Retrieved ${chunks.length} chunks from pgvector for quiz.`);
    } catch (e) {
      console.warn(`[pgvector Quiz Query] pgvector query failed:`, e.message);
    }

    const contextText = chunks.length > 0
      ? chunks.map(c => {
          const src = c.source_slides?.length
            ? `Slides ${c.source_slides.join(', ')}`
            : `Page ${c.page_number || 1}${c.source_section ? ` - ${c.source_section}` : ''}`;
          const conceptTag = c.concept ? `[Concept: ${c.concept}]` : '';
          return `${conceptTag} (${src})\n${c.text}`;
        }).join('\n\n')
      : (course.fileText || '').slice(0, 15000);

    // Call AI Service to generate multiple-choice questions for this chapter in preferred language
    const quiz = await aiService.generateLessonQuiz(course.title, lessonTitle, contextText, targetLanguage);
    res.json({ quiz, language: targetLangInfo });
  } catch (error) {
    console.error('Failed to generate chapter assessment quiz:', error);
    res.status(500).json({ error: 'Failed to generate chapter assessment quiz.' });
  }
});

// 4c. Get Student Course Progress
router.get('/:id/progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const courseId = req.params.id;

    const hasAccess = await checkCourseAccess(req, courseId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
    }

    const progressRecord = await prisma.courseProgress.findFirst({
      where: { userId, courseId }
    });

    if (!progressRecord) {
      return res.json({
        progress: 0,
        completed: false,
        completedLessonIds: []
      });
    }

    let lessonIds = progressRecord.completedLessonIds;
    if (typeof lessonIds === 'string') {
      try { lessonIds = JSON.parse(lessonIds); } catch (e) { lessonIds = []; }
    }
    if (!Array.isArray(lessonIds)) lessonIds = [];

    // Deduplicate and normalize to strings
    const uniqueLessonIds = Array.from(new Set(lessonIds.filter(id => id !== null && id !== undefined).map(String)));

    res.json({
      progress: Math.min(100, Math.max(0, progressRecord.progress || 0)),
      completed: progressRecord.completed,
      completedLessonIds: uniqueLessonIds,
      updatedAt: progressRecord.updatedAt,
      startedAt: progressRecord.startedAt
    });
  } catch (error) {
    console.error('Failed to fetch course progress:', error);
    res.status(500).json({ error: 'Failed to retrieve course progress.' });
  }
});

// 4d. Save/Update Student Course Progress
router.post('/:id/progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const courseId = req.params.id;

    const hasAccess = await checkCourseAccess(req, courseId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
    }

    const { completedLessonId, completedLessonIds, progress, completed } = req.body;

    const existing = await prisma.courseProgress.findFirst({
      where: { userId, courseId }
    });

    let currentCompleted = [];
    if (existing?.completedLessonIds) {
      try {
        const parsed = typeof existing.completedLessonIds === 'string'
          ? JSON.parse(existing.completedLessonIds)
          : existing.completedLessonIds;
        if (Array.isArray(parsed)) {
          currentCompleted = parsed.filter(id => id !== null && id !== undefined).map(String);
        }
      } catch (e) {
        currentCompleted = [];
      }
    }

    const completedSet = new Set(currentCompleted);
    if (completedLessonId !== undefined && completedLessonId !== null) {
      completedSet.add(String(completedLessonId));
    }
    if (Array.isArray(completedLessonIds)) {
      completedLessonIds.forEach(id => {
        if (id !== null && id !== undefined) {
          completedSet.add(String(id));
        }
      });
    }

    const finalCompleted = Array.from(completedSet);

    // Get total lessons count for this course to calculate accurate progress
    let totalLessons = 5;
    try {
      const courseRecord = await prisma.course.findUnique({ where: { id: courseId } });
      if (courseRecord && courseRecord.curriculum) {
        const curr = typeof courseRecord.curriculum === 'string' ? JSON.parse(courseRecord.curriculum) : courseRecord.curriculum;
        if (Array.isArray(curr.lessons) && curr.lessons.length > 0) {
          totalLessons = curr.lessons.length;
        } else if (Array.isArray(curr.curriculum) && curr.curriculum.length > 0) {
          totalLessons = curr.curriculum.length;
        }
      }
    } catch (e) { }

    const calcProgress = Math.min(100, Math.max(0, progress !== undefined ? progress : Math.round((finalCompleted.length / totalLessons) * 100)));
    const isCompleted = completed !== undefined ? completed : (calcProgress >= 100 || finalCompleted.length >= totalLessons);
    const jsonCompleted = JSON.stringify(finalCompleted);

    let record;
    if (existing) {
      record = await prisma.courseProgress.update({
        where: { id: existing.id },
        data: {
          progress: calcProgress,
          completed: isCompleted,
          completedLessonIds: jsonCompleted
        }
      });
    } else {
      record = await prisma.courseProgress.create({
        data: {
          userId,
          courseId,
          progress: calcProgress,
          completed: isCompleted,
          completedLessonIds: jsonCompleted
        }
      });
    }

    res.json({
      message: 'Course progress saved successfully.',
      progress: record.progress,
      completed: record.completed,
      completedLessonIds: finalCompleted
    });
  } catch (error) {
    console.error('Failed to save course progress:', error);
    res.status(500).json({ error: 'Failed to save course progress.' });
  }
});

// 5. Chat with AI Tutor (ARIA) in context of this RAG course using semantic query search
router.post('/:id/chat', authenticateToken, async (req, res) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id }
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    const hasAccess = await checkCourseAccess(req, course.id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this course.' });
    }

    const { message, lessonTitle, currentConcept, language, conversationHistory } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);
    const targetLanguage = targetLangInfo.name;
    console.log(`[RAG Chat Query] Target Language: "${targetLanguage}" (${targetLangInfo.code}), Query: "${message}" (Course ID: ${course.id}${currentConcept ? `, Concept: "${currentConcept.slice(0, 40)}..."` : ''})`);

    const normalizeForEcho = (value) => String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const questionNorm = normalizeForEcho(message);
    const conceptNorm = normalizeForEcho(currentConcept);
    if (conceptNorm.length > 40 && questionNorm.length > 40) {
      const qWords = questionNorm.split(' ').filter(w => w.length > 3);
      const cSet = new Set(conceptNorm.split(' ').filter(w => w.length > 3));
      const overlap = qWords.length ? qWords.filter(w => cSet.has(w)).length / qWords.length : 0;
      if (overlap >= 0.55 || conceptNorm.includes(questionNorm) || questionNorm.includes(conceptNorm.slice(0, 80))) {
        return res.json({
          reply: 'I did not catch a question. Please ask me something about this lesson.',
          text: 'I did not catch a question. Please ask me something about this lesson.',
          language: targetLangInfo
        });
      }
    }

    // Retrieve semantic context matching student query from PostgreSQL pgvector
    const ragChatStartTime = Date.now();
    console.log(`[PERF:RAG_START] Starting question vector query for message: "${message.slice(0, 50)}..." (Course ID: ${course.id})`);
    let chunks = [];
    try {
      chunks = await vectorChunkService.querySimilarChunks(prisma, course.id, message, 5, {
        lessonTitle,
        topicFilter: lessonTitle
      });
      const ragChatDuration = Date.now() - ragChatStartTime;
      console.log(`[PERF:RAG_END] Retrieved ${chunks.length} chunks from pgvector in ${ragChatDuration}ms.`);
    } catch (e) {
      const ragChatDuration = Date.now() - ragChatStartTime;
      console.warn(`[PERF:RAG_END] pgvector RAG query notice (${ragChatDuration}ms):`, e.message);
    }

    const MAX_CONTEXT_CHARS = 8000;
    let contextText = chunks.length > 0
      ? chunks.map(c => {
          const src = c.source_slides?.length
            ? `Slides ${c.source_slides.join(', ')}`
            : `Page ${c.page_number || 1}${c.source_section ? ` - ${c.source_section}` : ''}`;
          const conceptTag = c.concept ? `[Concept: ${c.concept}]` : '';
          const topicTag = c.topic ? `[Topic: ${c.topic}]` : '';
          return `${conceptTag} ${topicTag} (${src})\n${c.text}`;
        }).join('\n\n')
      : (course.fileText || '').slice(0, MAX_CONTEXT_CHARS);
    if (contextText.length > MAX_CONTEXT_CHARS) {
      contextText = contextText.slice(0, MAX_CONTEXT_CHARS);
    }
    const hasCourseContext = !!(contextText && contextText.trim());

    const systemPrompt = `You are ARIA, a patient and accurate AI Tutor for SkillBridge.
You explain concepts clearly, use appropriate examples, and adapt explanations to the learner's level.
You are actively teaching the course: "${course.title}" (Current Lesson: "${lessonTitle || 'Overview'}").
${currentConcept ? `The student is currently viewing / listening to this lesson concept: "${currentConcept}".` : ''}
Selected Teaching Language: ${targetLanguage}.

CRITICAL CONCISE & UNDERSTANDABLE TUTORING RULES:
0. ANSWER THE STUDENT QUESTION ONLY: Reply to the text after "Student Question:". Do not repeat, continue, or narrate the Active Lesson Concept or retrieved course context unless the student asked for that. If the student question is missing, is the same as the lesson script, or is not a real question, say you did not catch the question and ask them to ask again in one short sentence.
1. SHORT & DIRECT (MAX 2-3 SENTENCES): Keep your answer SHORT, CONCISE, and TO THE POINT. Deliver at most 2 to 3 clear, conversational sentences (around 35-60 words). Never output long essays, large lists of bullet points, or multiple paragraphs.
2. SIMPLE & INTUITIVE: Explain the concept in plain, simple, easily digestible words that any beginner can understand immediately.
3. VOICE & AUDIO FRIENDLY: Your answer will be spoken aloud to the student in real-time via text-to-speech. Short and clear answers allow the student to quickly understand without lengthy interruptions to their lesson.
4. TARGET TEACHING LANGUAGE: Generate your ENTIRE answer in ${targetLanguage} only (supported: English, Chinese (中文), Malay (Bahasa Melayu), Tamil (தமிழ்), Bangla (বাংলা), Telugu (తెలుగు)). Do not mix languages.
5. CROSS-LINGUAL UNDERSTANDING: If the student asks in English or another language, understand the intent and respond fluently in ${targetLanguage}. If course excerpts are in another language, translate the answer into ${targetLanguage}.
6. TECHNICAL TERMS: Keep essential technical keywords (e.g. React, API, Database, State, Function, Loop, Component) in their standard form alongside the explanation in ${targetLanguage}.
7. GROUNDING: When retrieved course material is provided, base your explanation on that context and the current lesson. Do not replace document-grounded answers with unrelated generic answers.
8. SOURCE HONESTY: If the available course material does not contain enough information to answer accurately, say so clearly and give a brief general explanation without inventing source-specific facts, slide numbers, or document details.
9. FRIENDLY TONE: Warm, natural, direct, and encouraging.
${hasCourseContext ? 'Relevant course excerpts are included in the student message. Use them when they apply.' : 'No matching course excerpts were retrieved for this question. Do not invent course-document facts.'}`;

    const userPrompt = `${hasCourseContext ? `Retrieved Course Context:\n${contextText}\n\n` : 'Retrieved Course Context: [none]\n\n'}${currentConcept ? `Active Lesson Concept:\n${currentConcept}\n\n` : ''}Student Question:\n${message}\n\nSelected Response Language:\n${targetLanguage}`;

    const llmChatStartTime = Date.now();
    console.log(`[PERF:LLM_START] Generating tutor answer via local LLM gateway in ${targetLanguage} (${chunks.length} RAG chunks)...`);

    let reply;
    try {
      reply = await aiService._callLLM(systemPrompt, userPrompt, false, conversationHistory || []);
      const llmChatDuration = Date.now() - llmChatStartTime;
      console.log(`[PERF:LLM_END] Generated tutor answer via local LLM gateway in ${llmChatDuration}ms.`);
    } catch (e) {
      const llmChatDuration = Date.now() - llmChatStartTime;
      console.warn(`[PERF:LLM_END] Local LLM gateway unavailable for tutor chat (${llmChatDuration}ms).`);
      return res.status(e.status && e.status >= 400 ? e.status : 503).json({
        error: 'The AI tutor is temporarily unavailable. Please try again in a moment.'
      });
    }

    res.json({ reply, text: reply, language: targetLangInfo });
  } catch (error) {
    console.error('Tutoring chat failure:', error);
    res.status(500).json({ error: 'Failed to process tutoring chat.' });
  }
});

// 6. Admin: Update a course module details (and optionally replace document)
router.put('/:id', authenticateToken, requireRole(['ADMIN']), upload.single('file'), async (req, res) => {
  try {
    const courseId = req.params.id;
    const { title, description, curriculum } = req.body;

    const existingCourse = await prisma.course.findUnique({
      where: { id: courseId }
    });

    if (!existingCourse) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    if (title !== undefined && (!title || !title.trim())) {
      return res.status(400).json({ error: 'Course title cannot be empty.' });
    }
    if (description !== undefined && (!description || !description.trim())) {
      return res.status(400).json({ error: 'Course description cannot be empty.' });
    }

    const updateData = {};
    const finalTitle = title ? title.trim() : existingCourse.title;
    const finalDescription = description ? description.trim() : existingCourse.description;

    updateData.title = finalTitle;
    updateData.description = finalDescription;

    if (req.file) {
      console.log(`[Document Extraction] Admin updating course "${finalTitle}" with new file: ${req.file.originalname}...`);
      const docResult = await extractDocumentContent(req.file);
      const { text: textContent, pages, slides, fileType } = docResult;

      const imageCount = (slides || []).reduce((n, s) => n + ((s.images || []).length), 0) + ((docResult.images || []).length);
      if (!textContent || textContent.length < 30) {
        return res.status(400).json({
          error: imageCount > 0
            ? 'The PowerPoint is image-based, but no readable training text could be found in the slide pictures. Try a PPTX with clearer photos, or add slide titles/notes.'
            : 'Failed to extract text from new document. File may be empty or unreadable.'
        });
      }

      const segmentsCount = slides.length > 0 ? `${slides.length} slide(s)` : `${pages.length} section(s)/page(s)`;
      console.log(`[Document Extraction] Extracted ${textContent.length} characters across ${segmentsCount} (${fileType.toUpperCase()}). Generating updated dynamic curriculum...`);
      const generatedCourse = await aiService.generateCourse(req.file.originalname, textContent, docResult);
      generatedCourse.title = finalTitle;
      generatedCourse.description = finalDescription;

      updateData.fileName = req.file.originalname;
      updateData.fileText = textContent;
      updateData.curriculum = generatedCourse;

      // Re-index vector chunks and embeddings for the new document
      try {
        console.log(`[pgvector] Re-indexing course ${courseId} with semantic comprehension...`);
        await vectorChunkService.indexCourse(prisma, courseId, docResult, generatedCourse);
        console.log(`[pgvector] Vector embeddings updated successfully.`);
      } catch (vectorErr) {
        console.warn(`[pgvector] Re-indexing warning for course ${courseId}:`, vectorErr.message);
      }
    } else {
      let curriculumObj = curriculum !== undefined ? curriculum : existingCourse.curriculum;
      if (typeof curriculumObj === 'string') {
        try { curriculumObj = JSON.parse(curriculumObj); } catch (e) { }
      }
      if (curriculumObj && typeof curriculumObj === 'object') {
        curriculumObj.title = finalTitle;
        curriculumObj.description = finalDescription;
        updateData.curriculum = curriculumObj;
      }
    }

    const updatedCourse = await prisma.course.update({
      where: { id: courseId },
      data: updateData
    });

    try {
      const summary = generateModulesSummary(updateData.curriculum || existingCourse.curriculum);
      await prisma.$executeRaw`
        UPDATE "Course"
        SET "modulesSummary" = ${JSON.stringify(summary)}::jsonb
        WHERE id = ${courseId};
      `;
    } catch (_) {}
    invalidateCoursesCatalogCache();

    res.json({
      message: 'Course updated successfully.',
      course: updatedCourse
    });
  } catch (error) {
    console.error('Failed to update course:', error);
    res.status(500).json({ error: error.message || 'Failed to update course module.' });
  }
});

// 6b. Admin: Delete a course module
router.delete('/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const courseId = req.params.id;
    console.log(`Admin deleting course ID: ${courseId}`);

    await prisma.course.delete({
      where: { id: courseId }
    });
    invalidateCoursesCatalogCache();

    res.json({ message: 'Course module deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete course:', error);
    res.status(500).json({ error: 'Failed to delete course module.' });
  }
});

// 7. Transcribe student audio speech to text using Python AI Service (faster-whisper) or fallbacks
router.post('/transcribe', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required for transcription.' });
    }

    const requestedLang = req.body.language || req.query.language || '';
    const resolveLanguageCode = (lang) => {
      if (!lang) return null;
      const l = String(lang).toLowerCase().trim();
      if (l === 'zh' || l.includes('chinese') || l.includes('中文')) return 'zh';
      if (l === 'ms' || l.includes('malay') || l.includes('melayu')) return 'ms';
      if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்')) return 'ta';
      if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা')) return 'bn';
      if (l === 'te' || l.includes('telugu') || l.includes('తెలుగు')) return 'te';
      if (l === 'en' || l.includes('english')) return 'en';
      return null;
    };

    const targetLangCode = resolveLanguageCode(requestedLang);

    const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
    const WHISPER_SERVER_URL = process.env.WHISPER_SERVER_URL || 'http://localhost:9000';
    console.log(`[Whisper Flow] Transcribing audio file: ${req.file.originalname || 'voice.webm'} (${req.file.size} bytes, targetLang: ${targetLangCode || 'auto'})...`);

    // 1. Try Python AI Microservice (faster-whisper on port 8000)
    try {
      const form = new FormData();
      form.append('file', req.file.buffer, {
        filename: req.file.originalname || 'voice.webm',
        contentType: req.file.mimetype || 'audio/webm'
      });
      if (targetLangCode) {
        form.append('language', targetLangCode);
      }

      const pyResponse = await axios.post(`${PYTHON_SERVICE_URL}/api/v1/transcribe`, form, {
        headers: form.getHeaders(),
        timeout: 45000
      });

      if (pyResponse.data && typeof pyResponse.data.text === 'string') {
        const text = pyResponse.data.text.trim();
        const detectedLanguage = pyResponse.data.detected_language || targetLangCode || 'en';
        console.log(`[Whisper Flow Python AI Service Result]: "${text}" (detected: ${detectedLanguage})`);
        return res.json({ text, detectedLanguage });
      }
    } catch (pyErr) {
      console.warn(`[Whisper Flow] Python AI Service at ${PYTHON_SERVICE_URL} offline or unreachable: ${pyErr.message}. Trying Docker container...`);
    }

    // 2. Try Docker Whisper Container (onerahmet/openai-whisper-asr-webservice) on port 9000
    try {
      const form = new FormData();
      form.append('audio_file', req.file.buffer, {
        filename: req.file.originalname || 'voice.webm',
        contentType: req.file.mimetype || 'audio/webm'
      });

      const langQuery = targetLangCode ? `&language=${targetLangCode}` : '';
      const dockerResponse = await axios.post(`${WHISPER_SERVER_URL}/asr?output=json${langQuery}`, form, {
        headers: form.getHeaders(),
        timeout: 30000
      });

      let transcriptionText = '';
      if (typeof dockerResponse.data === 'string') {
        transcriptionText = dockerResponse.data.trim();
      } else if (dockerResponse.data && dockerResponse.data.text) {
        transcriptionText = dockerResponse.data.text.trim();
      }

      if (transcriptionText) {
        console.log(`[Whisper Flow Docker Result]: "${transcriptionText}"`);
        return res.json({ text: transcriptionText, detectedLanguage: targetLangCode || 'en' });
      }
    } catch (dockerErr) {
      console.warn(`[Whisper Flow] Docker container at ${WHISPER_SERVER_URL} offline or unreachable: ${dockerErr.message}. Trying primary LLM server...`);
    }

    // 3. Fallback to Primary OpenAI Audio Transcription Service
    const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'voice.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });
    form.append('model', 'whisper-1');
    if (targetLangCode) {
      form.append('language', targetLangCode);
    }

    const response = await axios.post(`${OPENAI_BASE_URL}/audio/transcriptions`, form, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders()
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 30000
    });

    const transcriptionText = response.data?.text || '';
    console.log(`[Whisper Flow OpenAI Result]: "${transcriptionText}"`);
    res.json({ text: transcriptionText, detectedLanguage: targetLangCode || 'en' });
  } catch (error) {
    console.warn('Whisper transcription warning: All Whisper providers unavailable:', error.message);
    res.json({
      text: '',
      detectedLanguage: 'en',
      error: 'Whisper service is currently unavailable. Please type your message.'
    });
  }
});


export default router;
