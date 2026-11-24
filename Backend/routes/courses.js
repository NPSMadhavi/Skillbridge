import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import prisma, { defaultPrisma } from '../config/prisma.js';
import masterPrisma from '../config/masterPrisma.js';
import aiService from '../services/aiService.js';
import vectorChunkService from '../services/vectorChunkService.js';
import interactiveCourseService from '../services/interactiveCourseService.js';
import documentExtractor from '../services/documentExtractor.js';
import tenantService from '../services/tenantService.js';
import { authenticateToken, optionalAuthenticateToken, requireRole } from '../middleware/auth.js';
import { resolveLanguageInfo, textMatchesLanguage } from '../utils/language.js';
import { cleanUnsupportedWords, stripSlidePlaceholders, isBinaryNoiseText, isPlaceholderTitle } from '../utils/contentQuality.js';
import { getGatewayBaseUrl, getPythonServiceUrl, getGatewayApiKey } from '../config/gateway.js';
import { formatGatewayError } from '../utils/gatewayError.js';

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
  req.setTimeout(300000);
  res.setTimeout(300000);
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
    generatedCourse.fileType = fileType || docResult.fileType;
    generatedCourse.fileName = req.file.originalname;

    // Retain exact original document structure and page/slide visual images in curriculum
    if (Array.isArray(docResult.slides) && docResult.slides.length > 0) {
      generatedCourse.slides = docResult.slides;
    }
    if (Array.isArray(docResult.pages) && docResult.pages.length > 0) {
      generatedCourse.pages = docResult.pages;
    }
    if (Array.isArray(docResult.images) && docResult.images.length > 0) {
      generatedCourse.visuals = docResult.images;
    }

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

    // Save original file buffer and individual slide/page images to disk for lightweight streaming
    try {
      const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(newCourse.id));
      const slidesDir = path.join(courseUploadDir, 'slides');
      const pagesDir = path.join(courseUploadDir, 'pages');
      fs.mkdirSync(slidesDir, { recursive: true });
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(courseUploadDir, req.file.originalname), req.file.buffer);
      console.log(`[File Storage] Saved original file to ${path.join(courseUploadDir, req.file.originalname)}`);

      // Extract slide images to disk
      if (Array.isArray(generatedCourse.slides)) {
        generatedCourse.slides = generatedCourse.slides.map((s, idx) => {
          const sNum = s.slideNumber || idx + 1;
          const slideFile = path.join(slidesDir, `Slide${sNum}.png`);
          const rawData = s.fullSlideImage?.dataUrl || s.images?.[0]?.dataUrl || s.dataUrl;
          let imageSaved = false;

          if (rawData && rawData.startsWith('data:image')) {
            const base64Part = rawData.split(',')[1];
            if (base64Part) {
              fs.writeFileSync(slideFile, Buffer.from(base64Part, 'base64'));
              imageSaved = true;
            }
          } else if (fs.existsSync(slideFile)) {
            imageSaved = true;
          }

          const imageUrl = imageSaved ? `/api/v1/courses/${newCourse.id}/slides/${sNum}/image` : null;
          return {
            ...s,
            slideNumber: sNum,
            image: imageUrl,
            fullSlideImage: imageSaved ? {
              id: `full_slide_${sNum}`,
              url: imageUrl,
              slideNumber: sNum,
              fileName: `Slide${sNum}.png`,
              mimetype: 'image/png'
            } : null,
            images: (s.images || []).map((im, imIdx) => ({
              ...im,
              dataUrl: undefined,
              url: imageSaved ? `/api/v1/courses/${newCourse.id}/slides/${sNum}/image` : null
            }))
          };
        });
      }

      // Extract page images to disk
      if (Array.isArray(generatedCourse.pages)) {
        generatedCourse.pages = generatedCourse.pages.map((p, idx) => {
          const pNum = p.page_number || p.pageNumber || idx + 1;
          const pageFile = path.join(pagesDir, `Page${pNum}.png`);
          const rawData = p.pageImage?.dataUrl || p.images?.[0]?.dataUrl || p.dataUrl;
          if (rawData && rawData.startsWith('data:image')) {
            const base64Part = rawData.split(',')[1];
            if (base64Part) {
              fs.writeFileSync(pageFile, Buffer.from(base64Part, 'base64'));
            }
          }
          const imageUrl = `/api/v1/courses/${newCourse.id}/pages/${pNum}/image`;
          return {
            ...p,
            page_number: pNum,
            pageNumber: pNum,
            image: imageUrl,
            pageImage: {
              id: `full_page_${pNum}`,
              url: imageUrl,
              pageNumber: pNum,
              fileName: `Page${pNum}.png`,
              mimetype: 'image/png'
            },
            images: (p.images || []).map(im => ({ ...im, dataUrl: undefined }))
          };
        });
      }

      // Update course in DB with lightweight sanitized curriculum
      await targetPrisma.course.update({
        where: { id: newCourse.id },
        data: { curriculum: generatedCourse }
      });
      console.log(`[File Storage] Saved slide/page PNGs to disk and sanitized course payload in database.`);
    } catch (saveErr) {
      console.warn(`[File Storage] Notice saving course files:`, saveErr.message);
    }

    // Store semantic chunks and generate vector embeddings directly in PostgreSQL pgvector
    try {
      console.log(`[pgvector] Indexing course ${newCourse.id} with semantic comprehension into PostgreSQL pgvector...`);
      await vectorChunkService.indexCourse(targetPrisma, newCourse.id, docResult, generatedCourse);
      console.log(`[pgvector] Course chunks and vector embeddings stored successfully.`);

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
    } catch (_) { }
    invalidateCoursesCatalogCache(req.tenantCode);

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

// Serve the original uploaded file (PDF, PPTX, DOCX, Image, etc.) for viewing/download
router.get('/:id/file', authenticateToken, async (req, res) => {
  try {
    const { course } = await findCourseAcrossTenants(req.params.id, req.prisma || prisma, null);
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(course.id));
    if (!fs.existsSync(courseUploadDir)) {
      return res.status(404).json({ error: 'Original document file not found on server.' });
    }
    const files = fs.readdirSync(courseUploadDir);
    const targetFile = files.find(f => f.toLowerCase() === (course.fileName || '').toLowerCase()) || files[0];
    if (!targetFile) {
      return res.status(404).json({ error: 'Original document file not found.' });
    }

    const fullPath = path.join(courseUploadDir, targetFile);
    const ext = path.extname(targetFile).toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
      '.md': 'text/markdown'
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const inline = req.query.download === '1' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${inline}; filename="${encodeURIComponent(targetFile)}"`);
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    console.error('Error serving course file:', err);
    res.status(500).json({ error: 'Failed to retrieve original course file.' });
  }
});

// Serve slide image (PNG) for course (PowerPoint slides)
router.get('/:id/slides/:slideNum/image', async (req, res) => {
  try {
    const courseId = req.params.id;
    const slideNum = parseInt(req.params.slideNum, 10);
    if (isNaN(slideNum) || slideNum < 1) {
      return res.status(400).json({ error: 'Invalid slide number.' });
    }

    const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(courseId));
    const slidesDir = path.join(courseUploadDir, 'slides');
    const slideFile = path.join(slidesDir, `Slide${slideNum}.png`);

    if (fs.existsSync(slideFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(slideFile).pipe(res);
    }

    // Try on-demand extraction from original presentation file on Ubuntu/Linux
    if (fs.existsSync(courseUploadDir)) {
      const files = fs.readdirSync(courseUploadDir);
      const presFile = files.find(f => /\.(pptx|ppt)$/i.test(f));
      if (presFile) {
        try {
          const presPath = path.join(courseUploadDir, presFile);
          const buf = fs.readFileSync(presPath);
          const rendered = await documentExtractor.renderPptSlidesToImages(buf, presFile);
          if (Array.isArray(rendered) && rendered.length > 0) {
            fs.mkdirSync(slidesDir, { recursive: true });
            for (const r of rendered) {
              const targetPath = path.join(slidesDir, `Slide${r.sourceSlide}.png`);
              if (r.dataUrl && r.dataUrl.startsWith('data:image')) {
                const b64 = r.dataUrl.split(',')[1];
                if (b64 && !fs.existsSync(targetPath)) {
                  fs.writeFileSync(targetPath, Buffer.from(b64, 'base64'));
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Courses] On-demand slide rendering notice:', e.message);
        }
      }
    }

    if (fs.existsSync(slideFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(slideFile).pipe(res);
    }

    // Fallback: Check if slide image is stored in DB curriculum
    const { course } = await findCourseAcrossTenants(courseId, req.prisma || prisma, null);
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    const cur = typeof course.curriculum === 'string' ? JSON.parse(course.curriculum) : (course.curriculum || {});
    const targetSlide = (cur.slides || []).find(s => s.slideNumber === slideNum) || cur.slides?.[slideNum - 1];
    const rawData = targetSlide?.fullSlideImage?.dataUrl || targetSlide?.images?.[0]?.dataUrl;

    if (rawData && rawData.startsWith('data:image')) {
      const base64Part = rawData.split(',')[1];
      if (base64Part) {
        fs.mkdirSync(slidesDir, { recursive: true });
        const buf = Buffer.from(base64Part, 'base64');
        fs.writeFileSync(slideFile, buf);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(buf);
      }
    }

    return res.status(404).json({ error: `Slide image ${slideNum} not found.` });
  } catch (err) {
    console.error('Error serving slide image:', err);
    res.status(500).json({ error: 'Failed to retrieve slide image.' });
  }
});

// Serve page image (PNG) for course (PDF / documents)
router.get('/:id/pages/:pageNum/image', async (req, res) => {
  try {
    const courseId = req.params.id;
    const pageNum = parseInt(req.params.pageNum, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Invalid page number.' });
    }

    const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(courseId));
    const pagesDir = path.join(courseUploadDir, 'pages');
    const pageFile = path.join(pagesDir, `Page${pageNum}.png`);

    if (fs.existsSync(pageFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(pageFile).pipe(res);
    }

    // Try on-demand extraction from original PDF document on Ubuntu/Linux
    if (fs.existsSync(courseUploadDir)) {
      const files = fs.readdirSync(courseUploadDir);
      const pdfFile = files.find(f => /\.pdf$/i.test(f));
      if (pdfFile) {
        try {
          const pdfPath = path.join(courseUploadDir, pdfFile);
          const buf = fs.readFileSync(pdfPath);
          const rendered = await documentExtractor.renderPdfPagesToImages(buf);
          if (Array.isArray(rendered) && rendered.length > 0) {
            fs.mkdirSync(pagesDir, { recursive: true });
            for (const r of rendered) {
              const targetPath = path.join(pagesDir, `Page${r.sourcePage}.png`);
              if (r.dataUrl && r.dataUrl.startsWith('data:image')) {
                const b64 = r.dataUrl.split(',')[1];
                if (b64 && !fs.existsSync(targetPath)) {
                  fs.writeFileSync(targetPath, Buffer.from(b64, 'base64'));
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Courses] On-demand PDF page rendering notice:', e.message);
        }
      }
    }

    if (fs.existsSync(pageFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(pageFile).pipe(res);
    }

    const { course } = await findCourseAcrossTenants(courseId, req.prisma || prisma, null);
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    const cur = typeof course.curriculum === 'string' ? JSON.parse(course.curriculum) : (course.curriculum || {});
    const targetPage = (cur.pages || []).find(p => (p.page_number || p.pageNumber) === pageNum) || cur.pages?.[pageNum - 1];
    const rawData = targetPage?.pageImage?.dataUrl || targetPage?.images?.[0]?.dataUrl;

    if (rawData && rawData.startsWith('data:image')) {
      const base64Part = rawData.split(',')[1];
      if (base64Part) {
        fs.mkdirSync(pagesDir, { recursive: true });
        const buf = Buffer.from(base64Part, 'base64');
        fs.writeFileSync(pageFile, buf);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(buf);
      }
    }

    return res.status(404).json({ error: `Page image ${pageNum} not found.` });
  } catch (err) {
    console.error('Error serving page image:', err);
    res.status(500).json({ error: 'Failed to retrieve page image.' });
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
    } catch (_) { }
    invalidateCoursesCatalogCache(req.tenantCode);

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
const resolveUserIdentifiers = async (user, targetPrisma = prisma) => {
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
      const dbUser = await targetPrisma.user.findFirst({
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

// Helper to resolve a course and its active database client across tenant boundaries
export async function findCourseAcrossTenants(courseId, initialPrisma, includeOptions = null) {
  let targetPrisma = initialPrisma || prisma;
  let course = null;

  // 1. Check specified / active tenant database
  try {
    course = await targetPrisma.course.findUnique({
      where: { id: courseId },
      ...(includeOptions ? { include: includeOptions } : {})
    });
  } catch (_) { }

  // 2. Check default database if not found in active tenant
  if (!course && defaultPrisma && targetPrisma !== defaultPrisma) {
    try {
      course = await defaultPrisma.course.findUnique({
        where: { id: courseId },
        ...(includeOptions ? { include: includeOptions } : {})
      });
      if (course) targetPrisma = defaultPrisma;
    } catch (_) { }
  }

  // 3. Scan other tenant databases if course belongs to another company
  if (!course) {
    try {
      const companies = await masterPrisma.company.findMany().catch(() => []);
      for (const comp of companies) {
        try {
          const client = await tenantService.getTenantClient(comp.code);
          if (client && client !== targetPrisma) {
            const found = await client.course.findUnique({
              where: { id: courseId },
              ...(includeOptions ? { include: includeOptions } : {})
            });
            if (found) {
              course = found;
              targetPrisma = client;
              break;
            }
          }
        } catch (_) { }
      }
    } catch (_) { }
  }

  return { course, targetPrisma };
}

// Helper to verify student course assignment access
const checkCourseAccess = async (req, courseId, customPrisma = null) => {
  if (req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN') return true;
  if (!req.user || req.user.id === 'guest-student') return true; // Guest / preview access
  const targetPrisma = customPrisma || req.prisma || prisma;
  const userIds = await resolveUserIdentifiers(req.user, targetPrisma);
  if (userIds.length === 0) return true;

  try {
    // If course has no assignments defined, treat as open company course
    const totalAssignments = await targetPrisma.userCourseAssignment.count({
      where: { courseId }
    }).catch(() => 0);
    if (totalAssignments === 0) return true;

    const assignment = await targetPrisma.userCourseAssignment.findFirst({
      where: {
        userId: { in: userIds },
        courseId,
      },
    });
    return Boolean(assignment);
  } catch (_) {
    return true;
  }
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

// In-memory catalog cache keyed by tenantCode to ensure strict tenant isolation
const catalogCacheByTenant = new Map();
const CATALOG_CACHE_TTL = 30 * 1000; // 30 seconds TTL

export function invalidateCoursesCatalogCache(tenantCode) {
  if (tenantCode) {
    catalogCacheByTenant.delete(tenantCode);
  } else {
    catalogCacheByTenant.clear();
  }
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

    // If lessons array is empty, synthesize clean lessons from course.chunks
    const rawLessons = (Array.isArray(curriculumSummary.lessons) && curriculumSummary.lessons.length > 0)
      ? curriculumSummary.lessons
      : (Array.isArray(course.chunks) && course.chunks.length > 0)
        ? course.chunks.map((c, cIdx) => ({
          id: cIdx + 1,
          title: cleanUnsupportedWords(c.concept || c.topic || `Lesson ${cIdx + 1}`),
          duration: '02:30',
          moduleId: `mod_${Math.floor(cIdx / 4) + 1}`,
          moduleTitle: cleanUnsupportedWords(c.topic || course.title),
          chapterTitle: cleanUnsupportedWords(c.topic || course.title),
          explanation: c.chunkText || c.semanticSummary || '',
          sourceSlides: Array.isArray(c.sourceSlides) && c.sourceSlides.length > 0 ? c.sourceSlides : [c.sourcePage || cIdx + 1]
        }))
        : [];

    // Strip heavy base64 visuals and raw slide data from lessons for fast catalog listing
    const sanitizedLessons = rawLessons.map((l, lIdx) => ({
      id: l.id || lIdx + 1,
      title: cleanUnsupportedWords(l.title, `Lesson ${lIdx + 1}`),
      duration: l.duration || '02:30',
      moduleId: l.moduleId || `mod_${Math.floor(lIdx / 4) + 1}`,
      chapterId: l.chapterId,
      moduleTitle: cleanUnsupportedWords(l.moduleTitle || l.chapterTitle, course.title),
      chapterTitle: cleanUnsupportedWords(l.chapterTitle || l.moduleTitle, course.title),
      explanation: l.explanation,
      explanations: l.explanations,
      sourceSlides: l.sourceSlides,
    }));

    const fileType = (curriculumSummary.fileType || course.fileName?.split('.').pop() || '').toLowerCase();
    const slideSummaries = Array.isArray(curriculumSummary.slides)
      ? curriculumSummary.slides.map((s, idx) => ({
        slideNumber: s.slideNumber || idx + 1,
        title: cleanUnsupportedWords(s.title || `Slide ${idx + 1}`),
        type: 'slide',
        image: `/api/v1/courses/${course.id}/slides/${s.slideNumber || idx + 1}/image`,
        bulletPoints: (s.bulletPoints || []).map(bp => cleanUnsupportedWords(bp)),
        headings: (s.headings || []).map(h => cleanUnsupportedWords(h)),
        paragraphs: s.paragraphs || []
      }))
      : [];

    const pageSummaries = Array.isArray(curriculumSummary.pages)
      ? curriculumSummary.pages.map((p, idx) => ({
        page_number: p.page_number || p.pageNumber || idx + 1,
        title: cleanUnsupportedWords(p.title || `Page ${idx + 1}`),
        type: 'page',
        image: `/api/v1/courses/${course.id}/pages/${p.page_number || p.pageNumber || idx + 1}/image`
      }))
      : [];

    curriculumSummary = {
      title: cleanUnsupportedWords(curriculumSummary.title || course.title),
      description: cleanUnsupportedWords(curriculumSummary.description || course.description),
      fileType,
      fileName: course.fileName,
      slides: slideSummaries,
      pages: pageSummaries,
      includes: curriculumSummary.includes,
      learning: curriculumSummary.learning,
      curriculum: curriculumSummary.curriculum,
      lessons: sanitizedLessons,
      quiz: curriculumSummary.quiz,
    };
  }

  const detectedFileType = (curriculumSummary?.fileType || course.fileName?.split('.').pop() || '').toLowerCase();

  return {
    id: course.id,
    title: cleanUnsupportedWords(course.title),
    description: cleanUnsupportedWords(course.description),
    fileName: course.fileName,
    fileType: detectedFileType,
    slides: curriculumSummary?.slides || [],
    pages: curriculumSummary?.pages || [],
    curriculum: curriculumSummary,
    lessons: curriculumSummary?.lessons || [],
    chunks: course.chunks || [],
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    assignedUsersCount: course.assignedUsersCount ?? course._count?.assignments ?? 0,
  };
}

// 2. Get published RAG courses (Admin gets all with counts; Students get ONLY assigned courses)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const targetPrisma = req.prisma || prisma;

    const tenantKey = req.tenantCode || 'default';

    if (req.user?.role === 'ADMIN') {
      const now = Date.now();
      const cached = catalogCacheByTenant.get(tenantKey);
      if (cached && (now - cached.time) < CATALOG_CACHE_TTL) {
        return res.json(cached.data);
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
      catalogCacheByTenant.set(tenantKey, { data: formatted, time: now });
      return res.json(formatted);
    }

    // For STUDENT role: return ONLY assigned courses with user progress in 1 query
    const userIds = await resolveUserIdentifiers(req.user, targetPrisma);
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

    const [courses, progressRecords] = await Promise.all([
      targetPrisma.$queryRaw`
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
      `,
      targetPrisma.courseProgress.findMany({
        where: {
          userId: { in: userIds },
          courseId: { in: assignedIds }
        }
      })
    ]);

    const progressByCourse = {};
    for (const pr of progressRecords) {
      let lessonIds = pr.completedLessonIds;
      if (typeof lessonIds === 'string') {
        try { lessonIds = JSON.parse(lessonIds); } catch (_) { lessonIds = []; }
      }
      if (!Array.isArray(lessonIds)) lessonIds = [];
      progressByCourse[pr.courseId] = {
        progress: Math.min(100, Math.max(0, pr.progress || 0)),
        completed: Boolean(pr.completed),
        completedLessonIds: Array.from(new Set(lessonIds.filter(id => id !== null && id !== undefined).map(String)))
      };
    }

    const formatted = courses.map(c => {
      const formattedCourse = formatCourseForCatalog(c);
      formattedCourse.userProgress = progressByCourse[c.id] || {
        progress: 0,
        completed: false,
        completedLessonIds: []
      };
      return formattedCourse;
    });

    return res.json(formatted);
  } catch (error) {
    console.error('Failed to retrieve RAG courses:', error);
    res.status(500).json({ error: 'Failed to retrieve courses catalog.' });
  }
});

// 3. Get specific course details (verifying assignment for students)
router.get('/:id', optionalAuthenticateToken, async (req, res) => {
  try {
    const { course, targetPrisma } = await findCourseAcrossTenants(
      req.params.id,
      req.prisma || prisma,
      {
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
      }
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    const hasAccess = await checkCourseAccess(req, course.id, targetPrisma);
    if (!hasAccess && req.user?.role !== 'ADMIN') {
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

        const cleanLessonVisuals = Array.isArray(lesson.visuals)
          ? lesson.visuals.map(v => ({
            ...v,
            dataUrl: undefined,
            url: v.sourceSlide ? `/api/v1/courses/${course.id}/slides/${v.sourceSlide}/image` : v.url
          }))
          : [];

        if (slideData && Array.isArray(slideData.images)) {
          slideData.images = slideData.images.map(img => ({
            ...img,
            dataUrl: undefined,
            url: img.sourceSlide ? `/api/v1/courses/${course.id}/slides/${img.sourceSlide}/image` : img.url
          }));
        }

        const cleanExplanation = lesson.explanation ? cleanUnsupportedWords(stripSlidePlaceholders(lesson.explanation)) : '';
        const cleanSpokenExplanation = lesson.spoken_explanation ? cleanUnsupportedWords(stripSlidePlaceholders(lesson.spoken_explanation)) : '';
        const cleanTitle = stripSlidePlaceholders(lesson.title) || lesson.title;

        const cleanExplanations = {};
        if (lesson.explanations && typeof lesson.explanations === 'object') {
          for (const [lKey, lVal] of Object.entries(lesson.explanations)) {
            cleanExplanations[lKey] = typeof lVal === 'string' ? cleanUnsupportedWords(stripSlidePlaceholders(lVal)) : lVal;
          }
        }

        return {
          ...lesson,
          title: cleanTitle,
          explanation: cleanExplanation || lesson.explanation,
          spoken_explanation: cleanSpokenExplanation || cleanExplanation || lesson.spoken_explanation,
          explanations: Object.keys(cleanExplanations).length > 0 ? cleanExplanations : lesson.explanations,
          sourceSlides: sNums,
          visuals: cleanLessonVisuals,
          slideData,
          chunkData: matchedChunk ? {
            chunkIndex: matchedChunk.chunkIndex,
            title: matchedChunk.concept || cleanTitle,
            text: stripSlidePlaceholders(matchedChunk.chunkText || ''),
            bulletPoints: Array.isArray(matchedChunk.keyPoints) ? matchedChunk.keyPoints.map(stripSlidePlaceholders) : []
          } : null
        };
      });
    }

    const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(course.id));
    const slidesDir = path.join(courseUploadDir, 'slides');
    const pagesDir = path.join(courseUploadDir, 'pages');
    const hasOriginalDoc = fs.existsSync(courseUploadDir) && fs.readdirSync(courseUploadDir).some(f => /\.(pptx|ppt|pdf|docx|doc)$/i.test(f));

    // Sanitize heavy base64 strings from curriculumData.slides and curriculumData.pages
    if (Array.isArray(curriculumData.slides)) {
      curriculumData.slides = curriculumData.slides.map((s, idx) => {
        const sNum = s.slideNumber || (idx + 1);
        const slideFile = path.join(slidesDir, `Slide${sNum}.png`);
        const imageExists = fs.existsSync(slideFile) || hasOriginalDoc || (s.fullSlideImage?.dataUrl && s.fullSlideImage.dataUrl.startsWith('data:image')) || (s.images?.[0]?.dataUrl && s.images[0].dataUrl.startsWith('data:image'));
        const imageUrl = imageExists ? `/api/v1/courses/${course.id}/slides/${sNum}/image` : null;
        return {
          ...s,
          slideNumber: sNum,
          image: imageUrl,
          fullSlideImage: imageUrl ? {
            id: `full_slide_${sNum}`,
            url: imageUrl,
            slideNumber: sNum,
            fileName: `Slide${sNum}.png`,
            mimetype: 'image/png'
          } : null,
          images: Array.isArray(s.images)
            ? s.images.map(img => {
              if (String(img.id).startsWith('full_slide') || img.slideNumber === sNum) {
                return { ...img, url: imageUrl, dataUrl: undefined };
              }
              return { ...img, dataUrl: undefined };
            })
            : []
        };
      });
    }

    if (Array.isArray(curriculumData.pages)) {
      curriculumData.pages = curriculumData.pages.map((p, idx) => {
        const pNum = p.page_number || p.pageNumber || (idx + 1);
        const pageFile = path.join(pagesDir, `Page${pNum}.png`);
        const imageExists = fs.existsSync(pageFile) || hasOriginalDoc || (p.pageImage?.dataUrl && p.pageImage.dataUrl.startsWith('data:image')) || (p.images?.[0]?.dataUrl && p.images[0].dataUrl.startsWith('data:image'));
        const imageUrl = imageExists ? `/api/v1/courses/${course.id}/pages/${pNum}/image` : null;
        return {
          ...p,
          page_number: pNum,
          pageNumber: pNum,
          image: imageUrl,
          pageImage: imageUrl ? {
            id: `full_page_${pNum}`,
            url: imageUrl,
            pageNumber: pNum,
            fileName: `Page${pNum}.png`,
            mimetype: 'image/png'
          } : null,
          images: []
        };
      });
    }

    if (Array.isArray(curriculumData.visuals)) {
      curriculumData.visuals = curriculumData.visuals.map(v => ({
        ...v,
        dataUrl: undefined,
        url: v.sourceSlide ? `/api/v1/courses/${course.id}/slides/${v.sourceSlide}/image` : v.url
      }));
    }

    const cleanChunks = (course.chunks || []).map(c => ({
      ...c,
      topic: cleanUnsupportedWords(c.topic),
      subtopic: cleanUnsupportedWords(c.subtopic),
      concept: cleanUnsupportedWords(c.concept),
      keyPoints: Array.isArray(c.keyPoints) ? c.keyPoints.map(kp => cleanUnsupportedWords(kp)) : [],
      semanticSummary: cleanUnsupportedWords(c.semanticSummary)
    }));

    const detectedFileType = (curriculumData?.fileType || course.fileName?.split('.').pop() || '').toLowerCase();

    // If curriculumData.lessons is empty or sparse, populate from clean chunks so all concepts are divided into lessons
    if ((!Array.isArray(curriculumData.lessons) || curriculumData.lessons.length === 0) && cleanChunks.length > 0) {
      curriculumData.lessons = cleanChunks.map((c, idx) => ({
        id: idx + 1,
        title: cleanUnsupportedWords(c.concept || c.topic || `Lesson ${idx + 1}`),
        duration: '02:30',
        moduleTitle: cleanUnsupportedWords(c.topic || course.title),
        chapterTitle: cleanUnsupportedWords(c.topic || course.title),
        sourceSlides: Array.isArray(c.sourceSlides) && c.sourceSlides.length > 0 ? c.sourceSlides : [c.sourcePage || idx + 1],
        status: idx === 0 ? 'active' : 'locked',
        explanation: c.chunkText || c.semanticSummary || '',
        bulletPoints: (c.keyPoints || []).map(kp => cleanUnsupportedWords(kp))
      }));
    } else if (Array.isArray(curriculumData.lessons)) {
      curriculumData.lessons = curriculumData.lessons.map(l => ({
        ...l,
        title: cleanUnsupportedWords(l.title),
        moduleTitle: cleanUnsupportedWords(l.moduleTitle || l.chapterTitle, course.title),
        chapterTitle: cleanUnsupportedWords(l.chapterTitle || l.moduleTitle, course.title)
      }));
    }

    res.json({
      ...course,
      title: cleanUnsupportedWords(course.title),
      description: cleanUnsupportedWords(course.description),
      chunks: cleanChunks,
      fileType: detectedFileType,
      slides: curriculumData.slides || [],
      pages: curriculumData.pages || [],
      visuals: curriculumData.visuals || [],
      curriculum: curriculumData,
      lessons: curriculumData.lessons || [],
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

  let rawText = stripSlidePlaceholders(targetChunk.text || targetChunk.chunkText || '')
    .replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '')
    .replace(/Slide\s*\d+:?\s*---*/gi, '')
    .replace(/Slide\s*\d+:\s*/gi, '')
    .replace(/^###[^\n]+\n/g, '')
    .replace(/^\*\*Topic:[^\n]+\n/g, '')
    .replace(/\*?\(Source:[^\)]*\)\*?/gi, '')
    .replace(/\*?\(Reference:[^\)]*\)\*?/gi, '')
    .trim();

  // Rejoin fragmented lines from PowerPoint line wraps into coherent sentences
  const rawLines = rawText.split('\n').map(l => stripSlidePlaceholders(l.trim())).filter(Boolean);
  const cleanBlocks = [];
  let buffer = '';
  for (const line of rawLines) {
    const isBullet = /^[-*•➔\d\.]+\s+/.test(line);
    const cleanLine = stripSlidePlaceholders(line.replace(/^[-*•➔\d\.]+\s+/, '').trim());
    if (!cleanLine || isBinaryNoiseText(cleanLine)) continue;
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
  if (buffer && !isBinaryNoiseText(buffer)) cleanBlocks.push(buffer);
  const cleanContentText = cleanUnsupportedWords(cleanBlocks.join('\n\n'));

  let keyPoints = targetChunk.key_points || targetChunk.keyPoints || [];
  if (typeof keyPoints === 'string') {
    try { keyPoints = JSON.parse(keyPoints); } catch (e) { keyPoints = []; }
  }
  keyPoints = (keyPoints || [])
    .map(kp => cleanUnsupportedWords(stripSlidePlaceholders(String(kp).replace(/---+\s*Slide\s*\d+[^-\n]*---*/gi, '').replace(/Slide\s*\d+:\s*/gi, '').trim())))
    .filter(kp => kp.length > 5 && !isBinaryNoiseText(kp));

  const sections = [];
  let summary = cleanUnsupportedWords(stripSlidePlaceholders(targetChunk.semanticSummary || `In this lesson, we study the core standards, operational requirements, and protocols for ${concept}.`))
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
router.post('/:id/lessons/:lessonId/explain', optionalAuthenticateToken, async (req, res) => {
  const fetchStartTime = Date.now();
  try {
    let { course, targetPrisma } = await findCourseAcrossTenants(req.params.id, req.prisma || prisma, null);

    if (!course) {
      course = {
        id: req.params.id,
        title: req.body.courseTitle || req.body.lessonTitle || 'Safety & Operations Course',
        curriculum: null
      };
    }

    if (course.createdAt) {
      try {
        const hasAccess = await checkCourseAccess(req, course.id);
        if (!hasAccess && req.user?.role !== 'ADMIN') {
          console.log(`[Lesson Explain] Student ${req.user?.id || 'guest'} accessing course ${course.id}`);
        }
      } catch (_) { }
    }

    const { lessonTitle, language } = req.body;
    let effectiveLessonTitle = lessonTitle;
    if (!effectiveLessonTitle && Array.isArray(curriculum.lessons)) {
      const found = curriculum.lessons.find(l => String(l.id) === lessonIdStr);
      if (found?.title) effectiveLessonTitle = found.title;
    }
    if (!effectiveLessonTitle) {
      return res.status(400).json({ error: 'Lesson title is required.' });
    }

    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);
    const targetLanguage = targetLangInfo.name;
    const lessonIdStr = String(req.params.lessonId);


    // 1. FAST PATH 1: Check if lesson explanation is already stored in Course.curriculum database record
    let curriculum = course.curriculum;
    if (typeof curriculum === 'string') {
      try { curriculum = JSON.parse(curriculum); } catch { curriculum = {}; }
    }
    if (!curriculum || typeof curriculum !== 'object') curriculum = {};

    const isRawSlideBulletNoise = (text) => {
      if (!text || typeof text !== 'string') return true;
      const lower = text.toLowerCase();
      return lower.includes('[visual content') ||
             lower.includes('full slide presentation') ||
             lower.includes('natsteel natsteel') ||
             lower.includes('--- slide') ||
             lower.includes('[speaker notes') ||
             /[=]\s*n\s*@\s*\\\s*qi/i.test(text);
    };

    const lessons = Array.isArray(curriculum.lessons) ? curriculum.lessons : [];
    const matchingLesson = lessons.find(lesson => String(lesson.id) === lessonIdStr)
      || lessons.find(lesson => lesson.title === lessonTitle);
    if (matchingLesson) {
      const cachedExplanation = matchingLesson.explanations?.[targetLangInfo.code] ||
        (targetLangInfo.code === 'en' ? matchingLesson.explanation : null);

      if (
        cachedExplanation &&
        typeof cachedExplanation === 'string' &&
        cachedExplanation.trim().length > 50 &&
        textMatchesLanguage(cachedExplanation, targetLangInfo.code) &&
        !isRawSlideBulletNoise(cachedExplanation)
      ) {
        const fetchDuration = Date.now() - fetchStartTime;
        const cleanCached = cleanUnsupportedWords(stripSlidePlaceholders(cachedExplanation));
        return res.json({
          explanation: cleanCached,
          spoken_explanation: cleanCached,
          title: stripSlidePlaceholders(lessonTitle) || lessonTitle,
          page_or_slide_number: matchingLesson.sourceSlides?.[0] || matchingLesson.id || 1,
          key_points: (matchingLesson.key_points || []).map(stripSlidePlaceholders),
          safety_warnings: (matchingLesson.safety_warnings || []).map(stripSlidePlaceholders),
          suggested_next_transition: 'Proceed to the next section when ready.',
          visuals: matchingLesson.visuals || [],
          sourceSlides: matchingLesson.sourceSlides || [],
          language: targetLangInfo,
          cached: true,
          fetchDurationMs: fetchDuration
        });
      }
    }

    // 2. FAST PATH 2: Instant Database Retrieval from CourseChunk table
    const ragStartTime = Date.now();

    const storedScript = matchingLesson?.explanation || matchingLesson?.explanations?.en;
    const hasCleanStored = typeof storedScript === 'string' && storedScript.trim().length > 50 && !isRawSlideBulletNoise(storedScript);
    let chunks = [];
    try {
      chunks = await vectorChunkService.querySimilarChunks(targetPrisma, course.id, lessonTitle, 6, {
        includeNeighbors: true,
        lessonTitle,
        topicFilter: lessonTitle
      });
    } catch (e) {
      const ragDuration = Date.now() - ragStartTime;
      console.warn(`[PERF:RAG_END] pgvector query notice (${ragDuration}ms):`, e.message);
    }

    // Collect visuals from matched chunks or curriculum
    const retrievedVisuals = matchingLesson?.visuals || chunks.flatMap(c => c.metadata?.visuals || c.visuals || []);
    const uniqueVisuals = [];
    for (const v of retrievedVisuals) {
      if (v && !uniqueVisuals.some(uv => uv.id === v.id || (uv.dataUrl && uv.dataUrl === v.dataUrl))) {
        uniqueVisuals.push(v);
      }
    }

    // Synthesize structured blackboard lesson notes using the AI Teacher Engine
    let explanation;
    const sourceScript = hasCleanStored ? storedScript : synthesizeLessonFromDbChunks(lessonTitle, chunks, course.title, matchingLesson);

    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Teacher lecture generation timeout (50s)')), 50000));
      explanation = await Promise.race([
        interactiveCourseService.generateTeacherLecture(effectiveLessonTitle, course.title, sourceScript, {
          language: targetLangInfo.code,
          targetWpm: 130
        }),
        timeoutPromise
      ]);
    } catch (lectureErr) {
      console.warn(`[PERF:LLM_END] AI teacher engine fallback triggered for ${targetLanguage}:`, lectureErr.message);
      explanation = aiService._getMockExplanation(effectiveLessonTitle, targetLanguage);
    }

    if (explanation && !textMatchesLanguage(explanation, targetLangInfo.code)) {
      console.warn(`[Language Lock] Output was not in ${targetLanguage} (${targetLangInfo.code}). Using native verified translation.`);
      explanation = aiService._getMockExplanation(lessonTitle, targetLanguage);
    }

    if (!explanation || explanation.length < 50) {
      explanation = aiService._getMockExplanation(lessonTitle, targetLanguage);
    }

    explanation = cleanUnsupportedWords(stripSlidePlaceholders(explanation));

    // 3. PERSISTENCE: Save synthesized explanation into PostgreSQL Course.curriculum for instant future opens
    try {
      if (Array.isArray(curriculum.lessons)) {
        const targetLesson = curriculum.lessons.find(
          l => String(l.id) === lessonIdStr || l.title === lessonTitle
        );
        if (targetLesson) {
          if (!targetLesson.explanations) targetLesson.explanations = {};
          if (textMatchesLanguage(explanation, targetLangInfo.code) || targetLangInfo.code === 'en') {
            targetLesson.explanations[targetLangInfo.code] = explanation;
            if (targetLangInfo.code === 'en') {
              targetLesson.explanation = explanation;
            }
          }
          await targetPrisma.course.update({
            where: { id: course.id },
            data: { curriculum: curriculum }
          });
        }
      }
    } catch (persistErr) {
      console.warn(`[Persisted Cache] Notice on persisting lesson explanation:`, persistErr.message);
    }

    const totalDuration = Date.now() - fetchStartTime;

    res.json({
      explanation: explanation,
      spoken_explanation: explanation,
      title: stripSlidePlaceholders(lessonTitle) || lessonTitle,
      page_or_slide_number: matchingLesson?.sourceSlides?.[0] || 1,
      key_points: matchingLesson?.key_points || [],
      safety_warnings: matchingLesson?.safety_warnings || [],
      suggested_next_transition: 'Proceed to the next section when ready.',
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

// 4c. Generate structured Qwen explanation for a specific page/slide in the universal document viewer
router.post('/:id/page/:pageNum/explain', optionalAuthenticateToken, async (req, res) => {
  try {
    let { course, targetPrisma } = await findCourseAcrossTenants(req.params.id, req.prisma || prisma, null);

    if (!course) {
      course = {
        id: req.params.id,
        title: req.body.courseTitle || 'Safety & Operations Course',
        curriculum: null
      };
    }

    if (course.createdAt) {
      try {
        const hasAccess = await checkCourseAccess(req, course.id);
        if (!hasAccess && req.user?.role !== 'ADMIN') {
          console.log(`[Page Explain] Student ${req.user?.id || 'guest'} accessing course ${course.id}`);
        }
      } catch (_) { }
    }

    const pageNum = parseInt(req.params.pageNum, 10) || 1;
    const { language } = req.body;
    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);

    let curriculum = course.curriculum;
    if (typeof curriculum === 'string') {
      try { curriculum = JSON.parse(curriculum); } catch { curriculum = {}; }
    }

    const slides = curriculum?.slides || [];
    const pages = curriculum?.pages || [];
    const targetSlide = slides.find(s => s.slideNumber === pageNum || s.sourceSlide === pageNum);
    const targetPage = pages.find(p => p.page_number === pageNum || p.pageNumber === pageNum);

    const title = targetSlide?.title || targetPage?.title || `Slide ${pageNum}`;
    const visuals = targetSlide?.images || targetPage?.images || (targetPage?.pageImage ? [targetPage.pageImage] : []);

    // 1. FAST PATH: Check if this specific slide already has a dedicated pre-computed explanation
    const matchingLesson = (curriculum?.lessons || []).find(l => {
      const s = Array.isArray(l.sourceSlides) ? l.sourceSlides : [l.id];
      return s.includes(pageNum);
    });

    const cachedSlideExp = targetSlide?.explanations?.[targetLangInfo.code] ||
      (targetLangInfo.code === 'en' ? targetSlide?.explanation : null);

    // Only serve cached explanation if specifically generated for this individual slide
    if (cachedSlideExp && typeof cachedSlideExp === 'string' && cachedSlideExp.trim().length > 30) {
      const cleanExp = cleanUnsupportedWords(stripSlidePlaceholders(cachedSlideExp));
      return res.json({
        page_or_slide_number: pageNum,
        title: stripSlidePlaceholders(title) || `Slide ${pageNum}`,
        spoken_explanation: cleanExp,
        explanation: cleanExp,
        key_points: (targetSlide?.key_points || matchingLesson?.key_points || []).map(stripSlidePlaceholders),
        safety_warnings: (targetSlide?.safety_warnings || matchingLesson?.safety_warnings || []).map(stripSlidePlaceholders),
        suggested_next_transition: `Proceed to next section when ready.`,
        visuals,
        language: targetLangInfo,
        cached: true
      });
    }

    // 1b. Lesson explanation fallback: if slide has no direct explanation, reuse matching lesson's verified curriculum
    const lessonExp = matchingLesson?.explanations?.[targetLangInfo.code] ||
      (targetLangInfo.code === 'en' ? (matchingLesson?.explanation || matchingLesson?.spoken_explanation) : null);
    if (lessonExp && typeof lessonExp === 'string' && lessonExp.trim().length > 30) {
      const cleanLessonExp = cleanUnsupportedWords(stripSlidePlaceholders(lessonExp));
      return res.json({
        page_or_slide_number: pageNum,
        title: stripSlidePlaceholders(title) || `Slide ${pageNum}`,
        spoken_explanation: cleanLessonExp,
        explanation: cleanLessonExp,
        key_points: (targetSlide?.key_points || matchingLesson?.key_points || []).map(stripSlidePlaceholders),
        safety_warnings: (targetSlide?.safety_warnings || matchingLesson?.safety_warnings || []).map(stripSlidePlaceholders),
        suggested_next_transition: `Proceed to next section when ready.`,
        visuals,
        language: targetLangInfo,
        cached: true
      });
    }

    const rawTeachingText = targetSlide
      ? (aiService._slideTeachingText(targetSlide) || targetSlide.fullText || targetSlide.title || '')
      : (targetPage?.text || targetPage?.title || '');

    // Search for a pre-computed semantic knowledge chunk for this specific slide
    let chunkContext = '';
    try {
      const targetPrisma = req.prisma || prisma;
      const matchingChunk = await targetPrisma.courseChunk.findFirst({
        where: {
          courseId: course.id,
          OR: [
            { sourcePage: pageNum },
            { sourceSection: { contains: `${pageNum}` } }
          ]
        }
      });
      if (matchingChunk?.chunkText) {
        chunkContext = matchingChunk.chunkText;
      }
    } catch (_) { }

    const fullSlideContent = [chunkContext, rawTeachingText].filter(Boolean).join('\n\n');
    const cleanBullets = (targetSlide?.bulletPoints || [])
      .map(b => stripSlidePlaceholders(b))
      .filter(b => b && !isBinaryNoiseText(b));

    const cleanFullContent = cleanUnsupportedWords(stripSlidePlaceholders(fullSlideContent));

    let structured;
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('LLM slide explanation timeout (15s)')), 15000));
      structured = await Promise.race([
        aiService.explainVisibleContent({
          pageNumber: pageNum,
          title: stripSlidePlaceholders(title) || `Slide ${pageNum}`,
          text: cleanFullContent,
          bulletPoints: cleanBullets,
          visuals
        }, course.title, targetLangInfo.name),
        timeoutPromise
      ]);
    } catch (llmErr) {
      console.warn(`[ExplainPage] LLM notice for slide ${pageNum} (${targetLangInfo.name}):`, llmErr.message);
      // Fallback to structured teaching text
      const fallbackText = aiService._getMockExplanation(title, targetLangInfo.name);
      structured = {
        page_or_slide_number: pageNum,
        title: stripSlidePlaceholders(title) || `Slide ${pageNum}`,
        spoken_explanation: fallbackText,
        explanation: fallbackText,
        key_points: cleanBullets.slice(0, 3),
        safety_warnings: [`Follow standard safety guidelines for ${title}`],
        suggested_next_transition: 'Let us proceed to the next section.'
      };
    }

    // Save into curriculum DB record for future instant hits
    try {
      if (targetSlide) {
        if (!targetSlide.explanations) targetSlide.explanations = {};
        targetSlide.explanations[targetLangInfo.code] = structured.spoken_explanation || structured.explanation;
        const targetPrisma = req.prisma || prisma;
        await targetPrisma.course.update({
          where: { id: course.id },
          data: { curriculum: curriculum }
        });
      }
    } catch (saveErr) {
      console.warn('[ExplainPage] Notice on persisting slide cache:', saveErr.message);
    }

    res.json({
      ...structured,
      visuals,
      language: targetLangInfo,
      cached: false
    });
  } catch (err) {
    console.error('Failed to explain page content:', err);
    res.status(500).json({ error: 'Failed to explain page content.' });
  }
});

// 4b. Generate AI Assessment Quiz for a specific lesson/chapter using RAG Vector DB
router.post('/:id/lessons/:lessonId/quiz', optionalAuthenticateToken, async (req, res) => {
  try {
    let { course, targetPrisma } = await findCourseAcrossTenants(req.params.id, req.prisma || prisma, null);

    if (!course) {
      course = {
        id: req.params.id,
        title: req.body.courseTitle || req.body.lessonTitle || 'Safety & Operations Course',
        curriculum: null
      };
    }

    if (course.createdAt) {
      try {
        const hasAccess = await checkCourseAccess(req, course.id);
        if (!hasAccess && req.user?.role !== 'ADMIN') {
          console.log(`[Lesson Explain] Student ${req.user?.id || 'guest'} accessing course ${course.id}`);
        }
      } catch (_) { }
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

    const targetPrisma = req.prisma || prisma;
    const progressRecord = await targetPrisma.courseProgress.findFirst({
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

    const targetPrisma = req.prisma || prisma;
    const existing = await targetPrisma.courseProgress.findFirst({
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
      const courseRecord = await targetPrisma.course.findUnique({ where: { id: courseId } });
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
    try {
      record = await targetPrisma.courseProgress.upsert({
        where: {
          userId_courseId: { userId, courseId }
        },
        update: {
          progress: calcProgress,
          completed: isCompleted,
          completedLessonIds: jsonCompleted
        },
        create: {
          userId,
          courseId,
          progress: calcProgress,
          completed: isCompleted,
          completedLessonIds: jsonCompleted
        }
      });
    } catch (upsertErr) {
      const retryExisting = existing || await targetPrisma.courseProgress.findFirst({ where: { userId, courseId } });
      if (retryExisting) {
        record = await targetPrisma.courseProgress.update({
          where: { id: retryExisting.id },
          data: {
            progress: calcProgress,
            completed: isCompleted,
            completedLessonIds: jsonCompleted
          }
        });
      } else {
        throw upsertErr;
      }
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
router.post('/:id/chat', optionalAuthenticateToken, async (req, res) => {
  try {
    let { course, targetPrisma } = await findCourseAcrossTenants(req.params.id, req.prisma || prisma, null);

    // 4. Resilient Pedagogical Fallback: If course record is not in DB (e.g. preview, client-cached, or test mode),
    // NEVER throw a 404 dead end. Construct an operational course context so the AI Teacher answers the student!
    if (!course) {
      course = {
        id: req.params.id,
        title: req.body.courseTitle || req.body.lessonTitle || 'Safety & Operations Course',
        description: req.body.currentConcept || '',
        curriculum: null
      };
    }

    // Access check: only enforce for real database courses when assignments table is active
    if (course.createdAt) {
      try {
        const hasAccess = await checkCourseAccess(req, course.id);
        if (!hasAccess && req.user?.role !== 'ADMIN') {
          // Log notice but continue to provide learning answers during active player session
          console.log(`[Tutor Chat] Student ${req.user?.id || 'guest'} accessing course ${course.id}`);
        }
      } catch (_) { }
    }

    const { message, lessonTitle, currentConcept, language, conversationHistory } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // Resolve dynamic assistant name for the current tenant or request
    let aiTutorName = (req.body.aiName || req.body.assistantName || '').trim();
    if (!aiTutorName) {
      try {
        const rows = await masterPrisma.$queryRawUnsafe(
          `SELECT "aiName" FROM "Company" WHERE "code" = $1 LIMIT 1`,
          req.tenantCode || 'default'
        ).catch(() => []);
        aiTutorName = (rows[0]?.aiName || 'ARIA').trim();
      } catch (_) {
        aiTutorName = 'ARIA';
      }
    }
    if (!aiTutorName) aiTutorName = 'ARIA';

    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);
    const targetLanguage = targetLangInfo.name;

    // Handle direct assistant identity / name query
    const isIdentityQuestion = /^(what('?s| is) your name|who are you|what should i call you|tell me your name|introduce yourself|who are u)/i.test(
      message.replace(/[?!.]/g, '').trim()
    );
    if (isIdentityQuestion) {
      const intro = `I am ${aiTutorName}, your AI voice tutor for this course. How can I help you understand this lesson?`;
      return res.json({
        reply: intro,
        text: intro,
        assistantName: aiTutorName,
        language: targetLangInfo
      });
    }

    const normalizeForEcho = (value) => String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const questionNorm = normalizeForEcho(message);
    const conceptNorm = normalizeForEcho(currentConcept);
    const isExplicitQuestion = /\b(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|clarify|mean|help|define|elaborate)\b/i.test(message)
      || message.includes('?')
      || /(?:什么是|为什么|怎么|如何|请问|apa|mengapa|bagaimana|bila|என்ன|ஏன்|எப்படி|কী|কেন|কিভাবে|ఎందుకు|ఏమిటి|ఎలా)/iu.test(message);

    // Only reject as an acoustic self-echo if there are NO question words AND it is a verbatim 85%+ replica of the active concept
    if (!isExplicitQuestion && conceptNorm.length > 50 && questionNorm.length > 50) {
      const qWords = questionNorm.split(' ').filter(w => w.length > 3);
      const cSet = new Set(conceptNorm.split(' ').filter(w => w.length > 3));
      const overlap = qWords.length ? qWords.filter(w => cSet.has(w)).length / qWords.length : 0;
      if (overlap >= 0.88 && conceptNorm.includes(questionNorm)) {
        return res.json({
          reply: 'I did not catch a question. Please ask me something about this lesson.',
          text: 'I did not catch a question. Please ask me something about this lesson.',
          language: targetLangInfo
        });
      }
    }

    // Retrieve semantic context matching student query from PostgreSQL pgvector
    const ragChatStartTime = Date.now();
    const asksAboutCurrentConcept = currentConcept?.trim() &&
      /^(?:please\s+)?(?:explain (?:this|that)(?: slide| concept| point)?|what does (?:this|that) mean)[?.!\s]*$/i.test(message);
    let chunks = [];
    try {
      if (!asksAboutCurrentConcept) chunks = await vectorChunkService.querySimilarChunks(targetPrisma, course.id, message, 3, {
        lessonTitle,
        topicFilter: lessonTitle
      });
    } catch (e) {
      const ragChatDuration = Date.now() - ragChatStartTime;
      console.warn(`[PERF:RAG_END] pgvector RAG query notice (${ragChatDuration}ms):`, e.message);
    }

    const ragContext = interactiveCourseService.buildTeachingRAGContext(course, lessonTitle, message, chunks);
    const compactGroundedContext = (ragContext.groundedContext || 'General course principles apply.').slice(0, 1500);

    const systemPrompt = `/no_think
You are ${aiTutorName}, an expert, supportive classroom teacher delivering instruction for the course "${course.title}".
Your goal is to explain concepts clearly, warmly, and concisely to students, prioritizing workplace safety and practical understanding.

PROFESSIONAL TEACHING GUIDELINES:
1. Speak in a warm, encouraging, authoritative human teacher voice.
2. Structure your answer:
   - Directly answer the student's question in the first sentence.
   - Follow with a concise, practical workplace reason or safety precaution.
3. Keep your spoken explanation between 2 to 3 natural, conversational sentences. Avoid lengthy essays or multi-paragraph lists.
4. DO NOT recite raw slide bullet points, placeholder tags, or OCR garbage.
5. STRICT KNOWLEDGE GROUNDING: Rely on the verified course training context below. If the student asks something completely outside this course, politely inform them that it is outside this module's scope.
6. Deliver your explanation directly in natural, articulate ${targetLanguage}.`;

    const cleanConceptTopic = (currentConcept || '')
      .replace(/[-*•➔\d\.]+\s*/g, ' ')
      .replace(/[#*_~`^|<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const userPrompt = `/no_think
COURSE KNOWLEDGE CONTEXT:
${compactGroundedContext}

Active Lesson: ${lessonTitle || 'Core Curriculum'}
${cleanConceptTopic ? `Current Concept on Blackboard: ${cleanConceptTopic.slice(0, 200)}\n` : ''}
Student Question: "${message}"

Deliver your expert teacher explanation in ${targetLanguage} (2 to 3 spoken sentences):`;

    const llmChatStartTime = Date.now();

    let reply;
    try {
      // 55-second timeout to allow GPU LLM to produce thoughtful native-language responses
      const llmPromise = aiService._callLLM(systemPrompt, userPrompt, false, conversationHistory || []);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tutor voice latency threshold reached (55s).')), 55000)
      );
      reply = await Promise.race([llmPromise, timeoutPromise]);
      const llmChatDuration = Date.now() - llmChatStartTime;
      console.log(`[PERF:LLM_END] Generated tutor answer via central AI gateway in ${llmChatDuration}ms.`);
    } catch (e) {
      const llmChatDuration = Date.now() - llmChatStartTime;
      console.warn(`[PERF:LLM_END] Tutor fallback triggered (${llmChatDuration}ms): ${e.message}`);

      // High-quality conversational fallbacks per language — NEVER raw slide OCR or PPT dumps
      const FALLBACK_TUTOR_REPLIES = {
        te: 'ఈ అంశం గురించి మీ ప్రశ్నకు ధన్యవాదాలు. పని ప్రదేశంలో భద్రతా నిబంధనలను పాటించడం మరియు తగిన రక్షణ పరికరాలను ధరించడం ప్రమాదాల నుండి మిమ్మల్ని రక్షిస్తుంది.',
        ta: 'இந்த தலைப்பு பற்றிய உங்கள் கேள்விக்கு நன்றி. பணியிடத்தில் பாதுகாப்பு விதிகளைப் பின்பற்றுவதும் சரியான பாதுகாப்பு உபகரணங்களை அணிவதும் உங்களை விபத்துகளிலிருந்து பாதுகாக்கும்.',
        hi: 'इस विषय पर आपके प्रश्न के लिए धन्यवाद। कार्यस्थल पर सुरक्षा नियमों का पालन करना और आवश्यक सुरक्षा उपकरण पहनना दुर्घटनाओं से बचाता है।',
        bn: 'এই বিষয়ে আপনার প্রশ্নের জন্য ধন্যবাদ। কর্মক্ষেত্রে সুরক্ষা নিয়মাবলী মেনে চলা এবং যথাযথ সুরক্ষা সরঞ্জাম পরিধান করা আপনাকে বিপদমুক্ত রাখবে।',
        zh: '感谢您的提问。在工作现场，严格遵守操作规范并正确穿戴安全防护装备，是保障人身安全的关键。',
        ms: 'Terima kasih atas soalan anda. Di tempat kerja, mematuhi peraturan keselamatan dan memakai peralatan perlindungan yang betul adalah penting untuk mengelakkan kemalangan.',
        en: 'Thank you for asking. On the work site, always ensure you follow the standard operating procedures and wear the required protective equipment to stay safe.'
      };
      reply = FALLBACK_TUTOR_REPLIES[targetLangInfo.code] || FALLBACK_TUTOR_REPLIES.en;
    }

    // Prepare reply for neural speech: clean markdown, expand acronyms, normalize numbers
    const cleanSpeechReply = interactiveCourseService.prepareTeachingNarration(reply, targetLangInfo.code);

    res.json({ reply: cleanSpeechReply, text: cleanSpeechReply, assistantName: aiTutorName, language: targetLangInfo });
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
    let { course: existingCourse, targetPrisma } = await findCourseAcrossTenants(courseId, req.prisma || prisma, null);

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
      generatedCourse.fileType = fileType || docResult.fileType;
      generatedCourse.fileName = req.file.originalname;

      if (Array.isArray(docResult.slides) && docResult.slides.length > 0) {
        generatedCourse.slides = docResult.slides;
      }
      if (Array.isArray(docResult.pages) && docResult.pages.length > 0) {
        generatedCourse.pages = docResult.pages;
      }
      if (Array.isArray(docResult.images) && docResult.images.length > 0) {
        generatedCourse.visuals = docResult.images;
      }

      updateData.fileName = req.file.originalname;
      updateData.fileText = textContent;
      updateData.curriculum = generatedCourse;

      // Save updated original file buffer to disk
      try {
        const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(courseId));
        fs.mkdirSync(courseUploadDir, { recursive: true });
        fs.writeFileSync(path.join(courseUploadDir, req.file.originalname), req.file.buffer);
      } catch (fErr) {
        console.warn(`[File Storage] Notice updating course file on disk:`, fErr.message);
      }

      // Re-index vector chunks and embeddings for the new document
      try {
        console.log(`[pgvector] Re-indexing course ${courseId} with semantic comprehension...`);
        await vectorChunkService.indexCourse(targetPrisma, courseId, docResult, generatedCourse);
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

    const updatedCourse = await targetPrisma.course.update({
      where: { id: courseId },
      data: updateData
    });

    try {
      const summary = generateModulesSummary(updateData.curriculum || existingCourse.curriculum);
      await targetPrisma.$executeRaw`
        UPDATE "Course"
        SET "modulesSummary" = ${JSON.stringify(summary)}::jsonb
        WHERE id = ${courseId};
      `;
    } catch (_) { }
    invalidateCoursesCatalogCache(req.tenantCode);

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
    console.log(`[Courses] Admin deleting course ID: ${courseId}`);

    const targetPrisma = req.prisma || prisma;

    // Helper to safely clean up all relations and the course record from a Prisma client
    const purgeCourse = async (client) => {
      if (!client) return;
      try {
        await client.userCourseAssignment.deleteMany({ where: { courseId } });
      } catch (e) {
        console.warn('[Courses] userCourseAssignment cleanup notice:', e.message);
      }

      try {
        await client.courseProgress.deleteMany({ where: { courseId } });
      } catch (e) {
        console.warn('[Courses] courseProgress cleanup notice:', e.message);
      }

      try {
        await client.courseChunk.deleteMany({ where: { courseId } });
      } catch (e) {
        console.warn('[Courses] courseChunk cleanup notice:', e.message);
      }

      try {
        await client.course.delete({ where: { id: courseId } });
      } catch (e) {
        if (!e.message?.includes('Record to delete does not exist') && !e.code?.includes('P2025')) {
          console.warn('[Courses] course delete notice:', e.message);
        }
      }
    };

    // 1. Purge from active tenant database only (strict tenant isolation)
    await purgeCourse(targetPrisma);

    // 2. Remove uploaded original document files from disk
    try {
      const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(courseId));
      if (fs.existsSync(courseUploadDir)) {
        fs.rmSync(courseUploadDir, { recursive: true, force: true });
        console.log(`[Courses] Removed uploaded files for course ${courseId}`);
      }
    } catch (fsErr) {
      console.warn('[Courses] Notice removing course files:', fsErr.message);
    }

    invalidateCoursesCatalogCache(req.tenantCode);

    res.json({ message: 'Course module deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete course:', error);
    res.status(500).json({ error: error.message || 'Failed to delete course module.' });
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
      if (l === 'zh' || l.startsWith('zh-') || l.includes('chinese') || l.includes('中文')) return 'zh';
      if (l === 'ms' || l.startsWith('ms-') || l.includes('malay') || l.includes('melayu')) return 'ms';
      if (l === 'ta' || l.startsWith('ta-') || l.includes('tamil') || l.includes('தமிழ்')) return 'ta';
      if (l === 'bn' || l.startsWith('bn-') || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা')) return 'bn';
      if (l === 'te' || l.startsWith('te-') || l.includes('telugu') || l.includes('తెలుగు')) return 'te';
      if (l === 'en' || l.startsWith('en-') || l.includes('english')) return 'en';
      return null;
    };

    const targetLangCode = resolveLanguageCode(requestedLang);

    const gatewayUrl = getPythonServiceUrl();
    const gatewayApiKey = getGatewayApiKey();
    const WHISPER_SERVER_URL = process.env.WHISPER_SERVER_URL || 'http://localhost:9000';
    console.log(`[Whisper Flow] Transcribing audio file: ${req.file.originalname || 'voice.webm'} (${req.file.size} bytes, targetLang: ${targetLangCode || 'auto'})...`);

    // 1. Try Python AI Microservice (Central AI Gateway or Whisper service)
    try {
      const form = new FormData();
      form.append('file', req.file.buffer, {
        filename: req.file.originalname || 'voice.webm',
        contentType: req.file.mimetype || 'audio/webm'
      });
      if (targetLangCode) {
        form.append('language', targetLangCode);
      }

      const headers = form.getHeaders();
      if (gatewayApiKey) {
        headers['X-API-Key'] = gatewayApiKey;
      }

      const transcribeEndpoint = `${gatewayUrl}/api/v1/stt/transcribe`;
      const pyResponse = await axios.post(transcribeEndpoint, form, {
        headers,
        timeout: 3000
      }).catch(async (err) => {
        if (err.response?.status === 404) {
          return await axios.post(`${gatewayUrl}/api/v1/transcribe`, form, { headers, timeout: 3000 });
        }
        throw err;
      });

      if (pyResponse.data && typeof pyResponse.data.text === 'string') {
        const text = pyResponse.data.text.trim();
        const detectedLanguage = pyResponse.data.detected_language || targetLangCode || 'en';
        console.log(`[Whisper Flow Python AI Service Result]: "${text}" (detected: ${detectedLanguage})`);
        return res.json({ text, detectedLanguage });
      }
    } catch (pyErr) {
      const mapped = formatGatewayError(pyErr);
      console.warn(`[Whisper Flow] Python AI Service notice: ${mapped}. Trying Docker container...`);
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
        timeout: 2000
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
      console.warn(`[Whisper Flow] Docker container at ${WHISPER_SERVER_URL} offline or unreachable: ${dockerErr.message}. Trying OpenAI transcription...`);
    }

    // 3. Fallback to Primary OpenAI Audio Transcription Service
    const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';

    if (!OPENAI_API_KEY) {
      return res.json({
        text: '',
        detectedLanguage: targetLangCode || 'en',
        unavailable: true,
        notice: 'Voice transcription backend is idle; browser speech recognition is active.'
      });
    }

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
      unavailable: true
    });
  }
});


export default router;
