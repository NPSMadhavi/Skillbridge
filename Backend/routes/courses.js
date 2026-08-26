import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import prisma from '../config/prisma.js';
import aiService from '../services/aiService.js';
import vectorChunkService from '../services/vectorChunkService.js';
import documentExtractor from '../services/documentExtractor.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

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

    if (!textContent || textContent.length < 30) {
      return res.status(400).json({ error: 'Failed to extract text from document. The file might be empty, password-protected, or scanned images only.' });
    }

    const segmentsCount = slides.length > 0 ? `${slides.length} slide(s)` : `${pages.length} section(s)/page(s)`;
    console.log(`[Document Extraction] Document extracted successfully. Extracted ${textContent.length} characters across ${segmentsCount} (${fileType.toUpperCase()}).`);

    console.log(`[Curriculum Design] Generating dynamic content-driven curriculum from document...`);
    const generatedCourse = await aiService.generateCourse(req.file.originalname, textContent, docResult);

    // Override the title/description with Admin input if needed, but preserve structure
    generatedCourse.title = title.trim();
    generatedCourse.description = description.trim();

    console.log(`[Curriculum Design] Curriculum structured. Saving course to database...`);
    const newCourse = await prisma.course.create({
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
      await vectorChunkService.indexCourse(prisma, newCourse.id, docResult, generatedCourse);
      console.log(`[pgvector] Course chunks and vector embeddings stored successfully.`);
    } catch (vectorErr) {
      console.warn(`[pgvector] Indexing warning for course ${newCourse.id}:`, vectorErr.message);
    }

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

    const newCourse = await prisma.course.create({
      data: {
        title: trimmedTitle,
        description: trimmedDesc,
        fileName: 'Manual Entry',
        fileText: trimmedDesc,
        curriculum: curriculumObj
      }
    });

    res.status(201).json({
      message: 'Course created successfully.',
      course: newCourse
    });
  } catch (error) {
    console.error('Failed to create manual course:', error);
    res.status(500).json({ error: error.message || 'Failed to create manual course.' });
  }
});

// Helper to verify student course assignment access
const checkCourseAccess = async (req, courseId) => {
  if (req.user?.role === 'ADMIN') return true;
  const userId = req.user?.id || req.user?.userId;
  if (!userId) return false;

  const assignment = await prisma.userCourseAssignment.findUnique({
    where: {
      userId_courseId: {
        userId,
        courseId,
      },
    },
  });
  return Boolean(assignment);
};

// 2. Get published RAG courses (Admin gets all with counts; Students get ONLY assigned courses)
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role === 'ADMIN') {
      const courses = await prisma.course.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { assignments: true },
          },
        },
      });
      const formatted = courses.map((c) => ({
        ...c,
        assignedUsersCount: c._count?.assignments || 0,
      }));
      return res.json(formatted);
    }

    // For STUDENT role: return ONLY assigned courses
    const userId = req.user?.id || req.user?.userId;
    const assignments = await prisma.userCourseAssignment.findMany({
      where: { userId },
      select: { courseId: true },
    });
    const assignedIds = assignments.map((a) => a.courseId);

    const courses = await prisma.course.findMany({
      where: { id: { in: assignedIds } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(courses);
  } catch (error) {
    console.error('Failed to retrieve RAG courses:', error);
    res.status(500).json({ error: 'Failed to retrieve courses catalog.' });
  }
});

// 3. Get specific course details (verifying assignment for students)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
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

    res.json({
      ...course,
      assignedUsersCount: course._count?.assignments || 0,
    });
  } catch (error) {
    console.error('Failed to retrieve course details:', error);
    res.status(500).json({ error: 'Failed to retrieve course details.' });
  }
});


function synthesizeLessonFromDbChunks(lessonTitle, chunks, courseTitle = '', matchingLesson = null) {
  const sections = [];
  const mainConcept = matchingLesson?.title || chunks[0]?.concept || lessonTitle;

  // 1. Overview & Objectives
  const primarySummary = chunks.map(c => c.semanticSummary).filter(Boolean).slice(0, 2).join(' ') ||
    `In this lesson on "${lessonTitle}", we examine the core principles, operational requirements, and safety protocols from ${courseTitle || 'the course material'}.`;

  sections.push(`### 💡 Overview: ${mainConcept}\n${primarySummary}`);

  // 2. Core Concepts & Slide Breakdowns
  if (Array.isArray(chunks) && chunks.length > 0) {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const header = chunk.concept && chunk.concept !== mainConcept ? chunk.concept : `Key Principle ${i + 1}`;
      const sourceRef = chunk.source_slides?.length ? `*(Reference: Slide ${chunk.source_slides.join(', ')})*` : '';

      let rawText = (chunk.text || chunk.chunkText || '')
        .replace(/^###[^\n]+\n/g, '')
        .replace(/^\*\*Topic:[^\n]+\n/g, '')
        .replace(/\*\(Source:[^\)]+\)\*/g, '')
        .trim();

      const keyPoints = chunk.key_points || chunk.keyPoints || [];
      if (Array.isArray(keyPoints) && keyPoints.length > 0) {
        const bullets = keyPoints.map(kp => `- ${kp}`).join('\n');
        sections.push(`#### 🎯 ${header} ${sourceRef}\n${rawText}\n\n**Key Protocols:**\n${bullets}`);
      } else if (rawText) {
        sections.push(`#### 🎯 ${header} ${sourceRef}\n${rawText}`);
      }
    }
  }

  // 3. Operational Protocols & Checklist
  const allKeyPoints = chunks.flatMap(c => c.key_points || c.keyPoints || []).filter(Boolean);
  if (allKeyPoints.length > 0) {
    const steps = allKeyPoints.slice(0, 6).map((kp, idx) => `${idx + 1}. **Step ${idx + 1}:** ${kp}`).join('\n');
    sections.push(`#### 🔍 Operational Checklist & Protocols\n${steps}`);
  }

  // 4. Critical Precautions & Compliance
  sections.push(`#### ⚠️ Critical Precautions & Compliance\n- Always verify operational conditions and inspect relevant equipment before commencing tasks.\n- Adhere strictly to verified safety standards and training guidelines.\n- Immediately report any hazards, deviations, or damaged components to the supervisor.`);

  // 5. Key Safety Takeaways
  sections.push(`#### 📌 Key Safety Takeaways\n- **Safety First:** Strict adherence to protocols prevents incidents and ensures reliable execution.\n- **Verification:** Regular checks and systematic procedures maintain operational integrity.\n- **Continuous Improvement:** Master each standard procedure to build dependable habits.`);

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

    const resolveLanguageInfo = (lang) => {
      if (!lang) return { code: 'en', name: 'English', speechCode: 'en-US' };
      const l = String(lang).toLowerCase().trim();
      if (l === 'zh' || l.includes('chinese') || l.includes('中文')) {
        return { code: 'zh', name: 'Chinese (中文)', speechCode: 'zh-CN' };
      }
      if (l === 'ms' || l.includes('malay') || l.includes('melayu')) {
        return { code: 'ms', name: 'Malay (Bahasa Melayu)', speechCode: 'ms-MY' };
      }
      if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்')) {
        return { code: 'ta', name: 'Tamil (தமிழ்)', speechCode: 'ta-IN' };
      }
      if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা')) {
        return { code: 'bn', name: 'Bangla (বাংলা)', speechCode: 'bn-BD' };
      }
      return { code: 'en', name: 'English', speechCode: 'en-US' };
    };

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

        if (cachedExplanation && typeof cachedExplanation === 'string' && cachedExplanation.trim().length > 30) {
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

    // Synthesize structured blackboard lesson notes directly from the rich semantic chunks stored in database
    let explanation = synthesizeLessonFromDbChunks(lessonTitle, chunks, course.title, matchingLesson);
    if (!explanation || explanation.length < 50) {
      explanation = `### 💡 Overview: ${lessonTitle}\nIn this lesson on "${lessonTitle}", we study the essential operational standards, guidelines, and safety procedures.\n\n#### 🎯 Core Protocols\n- Follow all standard operating procedures and guidelines from the training material.\n- Maintain verified equipment condition and perform routine inspections.\n\n#### 📌 Key Takeaways\n- Strict adherence to guidelines ensures safety and quality.\n- Execute tasks systematically with complete attention to detail.`;
    }

    // 3. PERSISTENCE: Save synthesized explanation into PostgreSQL Course.curriculum for instant future opens
    try {
      if (Array.isArray(curriculum.lessons)) {
        const targetLesson = curriculum.lessons.find(
          l => String(l.id) === lessonIdStr || l.title === lessonTitle
        );
        if (targetLesson) {
          if (!targetLesson.explanations) targetLesson.explanations = {};
          targetLesson.explanations[targetLangInfo.code] = explanation;
          if (targetLangInfo.code === 'en') {
            targetLesson.explanation = explanation;
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

    const resolveLanguageInfo = (lang) => {
      if (!lang) return { code: 'en', name: 'English', speechCode: 'en-US' };
      const l = String(lang).toLowerCase().trim();
      if (l === 'zh' || l.includes('chinese') || l.includes('中文')) {
        return { code: 'zh', name: 'Chinese (中文)', speechCode: 'zh-CN' };
      }
      if (l === 'ms' || l.includes('malay') || l.includes('melayu')) {
        return { code: 'ms', name: 'Malay (Bahasa Melayu)', speechCode: 'ms-MY' };
      }
      if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்')) {
        return { code: 'ta', name: 'Tamil (தமிழ்)', speechCode: 'ta-IN' };
      }
      if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা')) {
        return { code: 'bn', name: 'Bangla (বাংলা)', speechCode: 'bn-BD' };
      }
      return { code: 'en', name: 'English', speechCode: 'en-US' };
    };

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

    const resolveLanguageInfo = (lang) => {
      if (!lang) return { code: 'en', name: 'English', speechCode: 'en-US' };
      const l = String(lang).toLowerCase().trim();
      if (l === 'zh' || l.includes('chinese') || l.includes('中文')) {
        return { code: 'zh', name: 'Chinese (中文)', speechCode: 'zh-CN' };
      }
      if (l === 'ms' || l.includes('malay') || l.includes('melayu')) {
        return { code: 'ms', name: 'Malay (Bahasa Melayu)', speechCode: 'ms-MY' };
      }
      if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்')) {
        return { code: 'ta', name: 'Tamil (தமிழ்)', speechCode: 'ta-IN' };
      }
      if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা')) {
        return { code: 'bn', name: 'Bangla (বাংলা)', speechCode: 'bn-BD' };
      }
      return { code: 'en', name: 'English', speechCode: 'en-US' };
    };

    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);
    const targetLanguage = targetLangInfo.name;
    console.log(`[RAG Chat Query] Target Language: "${targetLanguage}" (${targetLangInfo.code}), Query: "${message}" (Course ID: ${course.id}${currentConcept ? `, Concept: "${currentConcept.slice(0, 40)}..."` : ''})`);

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

    const contextText = chunks.length > 0
      ? chunks.map(c => {
          const src = c.source_slides?.length
            ? `Slides ${c.source_slides.join(', ')}`
            : `Page ${c.page_number || 1}${c.source_section ? ` - ${c.source_section}` : ''}`;
          const conceptTag = c.concept ? `[Concept: ${c.concept}]` : '';
          const topicTag = c.topic ? `[Topic: ${c.topic}]` : '';
          return `${conceptTag} ${topicTag} (${src})\n${c.text}`;
        }).join('\n\n')
      : (course.fileText || '').slice(0, 15000);

    const systemPrompt = `You are ARIA, the intelligent AI Tutor for SkillBridge.
You are actively teaching the course: "${course.title}" (Current Lesson: "${lessonTitle || 'Overview'}").
${currentConcept ? `The student is currently viewing / listening to this lesson concept: "${currentConcept}".` : ''}
Selected Teaching Language: ${targetLanguage}.

CRITICAL CONCISE & UNDERSTANDABLE TUTORING RULES:
1. SHORT & DIRECT (MAX 2-3 SENTENCES): Keep your answer SHORT, CONCISE, and TO THE POINT. Deliver at most 2 to 3 clear, conversational sentences (around 35-60 words). Never output long essays, large lists of bullet points, or multiple paragraphs.
2. SIMPLE & INTUITIVE: Explain the concept in plain, simple, easily digestible words that any beginner can understand immediately.
3. VOICE & AUDIO FRIENDLY: Your answer will be spoken aloud to the student in real-time via text-to-speech. Short and clear answers allow the student to quickly understand without lengthy interruptions to their lesson.
4. TARGET TEACHING LANGUAGE: Generate your ENTIRE answer in ${targetLanguage} (supported: English, Chinese (中文), Malay (Bahasa Melayu), Tamil (தமிழ்), Bangla (বাংলা)).
5. CROSS-LINGUAL UNDERSTANDING: If the student asks in English or another language, understand the intent and respond fluently in ${targetLanguage}.
6. TECHNICAL TERMS: Keep essential technical keywords (e.g. React, API, Database, State, Function, Loop, Component) in their standard form alongside the explanation in ${targetLanguage}.
7. GROUNDING: Base your explanation on the course concepts and current lesson context.
8. FRIENDLY TONE: Warm, natural, direct, and encouraging.`;

    const userPrompt = `Retrieved Course Context:\n${contextText}\n\n${currentConcept ? `Active Lesson Concept:\n${currentConcept}\n\n` : ''}Student Question:\n${message}\n\nSelected Response Language:\n${targetLanguage}`;

    const llmChatStartTime = Date.now();
    console.log(`[PERF:LLM_START] Generating tutor answer via LLM in ${targetLanguage}...`);

    let reply;
    try {
      reply = await aiService._callLLM(systemPrompt, userPrompt, false, conversationHistory || []);
      const llmChatDuration = Date.now() - llmChatStartTime;
      console.log(`[PERF:LLM_END] Generated tutor answer via LLM in ${llmChatDuration}ms.`);
    } catch (e) {
      const llmChatDuration = Date.now() - llmChatStartTime;
      console.warn(`[PERF:LLM_END] AI call in chat fallback triggered (${llmChatDuration}ms):`, e.message);
      if (targetLangInfo.code === 'zh') {
        reply = `非常好的一点！在 ${course.title} 中，理解这个概念对于掌握核心技能非常重要。如果您有更多疑问，欢迎随时提问！`;
      } else if (targetLangInfo.code === 'ms') {
        reply = `Soalan yang bagus! Dalam ${course.title}, memahami konsep ini membina asas yang kukuh. Sila tanya jika anda perlukan penjelasan lanjut!`;
      } else if (targetLangInfo.code === 'ta') {
        reply = `அருமையான கேள்வி! ${course.title} பாடத்தில், இந்தக் கருத்தைப் புரிந்து கொள்வது உங்கள் அறிவை வலுவாக்கும். கூடுதல் விவரங்கள் தேவைப்பட்டால் தாராளமாக கேளுங்கள்!`;
      } else if (targetLangInfo.code === 'bn') {
        reply = `চমৎকার প্রশ্ন! ${course.title} কোর্সে এই ধারণাটি বোঝা অত্যন্ত জরুরি। আপনার আর কোনো প্রশ্ন থাকলে নির্দ্বিধায় জিজ্ঞাসা করুন!`;
      } else {
        reply = `Great question! In ${course.title}, understanding this concept builds strong core foundations. Feel free to ask more details!`;
      }
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

      if (!textContent || textContent.length < 30) {
        return res.status(400).json({ error: 'Failed to extract text from new document. File may be empty or unreadable.' });
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
