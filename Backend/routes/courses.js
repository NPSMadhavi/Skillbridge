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
import { validateDocumentFile, submitDocumentJob, pollDocumentJobResult } from '../services/ubuntuDocumentClient.js';
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
const courseTempDir = path.join(
  process.cwd(),
  'uploads',
  'tmp-course-uploads'
);

fs.mkdirSync(courseTempDir, { recursive: true });

const courseUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, courseTempDir);
    },
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname);
      const uniqueName =
        `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;

      cb(null, uniqueName);
    },
  }),
});
/**
 * Extracts text and segmented pages/slides from any supported document format.
 * Supported: PPTX, PPT, PDF, DOCX, DOC, TXT, MD, CSV, JSON, RTF, HTML, etc.
 */
async function extractDocumentContent(file) {
  return await documentExtractor.extractDocument(file);
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSlideSvg({ slideNumber, totalSlides = 1, title = '', headings = [], bulletPoints = [], paragraphs = [], courseTitle = 'SkillBridge Training' }) {
  const safeTitle = escapeXml(title || `Slide ${slideNumber}`);
  const safeCourse = escapeXml(courseTitle);
  const rawBullets = Array.isArray(bulletPoints) ? bulletPoints : [];
  const rawParas = Array.isArray(paragraphs) ? paragraphs : [];
  const items = rawBullets.length > 0
    ? rawBullets.slice(0, 6).map(b => escapeXml(String(b).replace(/^[-*•▸\d.]+\s*/, '').trim()))
    : rawParas.slice(0, 5).map(p => escapeXml(String(p).trim()));

  let contentY = 220;
  let itemsSvg = '';
  items.forEach((item, idx) => {
    if (!item) return;
    const truncated = item.length > 115 ? item.slice(0, 112) + '...' : item;
    itemsSvg += `
      <g transform="translate(100, ${contentY + idx * 68})">
        <rect x="0" y="0" width="1080" height="52" rx="10" fill="#131e3d" fill-opacity="0.75" stroke="#253561" stroke-width="1.2"/>
        <circle cx="28" cy="26" r="6" fill="#ff8c21"/>
        <text x="50" y="32" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" fill="#e2e8f0" font-weight="500">${truncated}</text>
      </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0b1329"/>
        <stop offset="50%" stop-color="#0f1b3b"/>
        <stop offset="100%" stop-color="#070d1e"/>
      </linearGradient>
      <linearGradient id="orangeBar" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ff8c21"/>
        <stop offset="100%" stop-color="#ffaa44"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bgGrad)"/>
    <rect x="0" y="0" width="1280" height="6" fill="url(#orangeBar)"/>
    
    <!-- Slide Header Card -->
    <g transform="translate(100, 60)">
      <rect x="0" y="0" width="1080" height="124" rx="16" fill="#162244" fill-opacity="0.65" stroke="#2c3e6b" stroke-width="1.5"/>
      <rect x="28" y="24" width="40" height="40" rx="10" fill="#ff8c21" fill-opacity="0.2" stroke="#ff8c21" stroke-width="1.5"/>
      <text x="48" y="50" font-family="sans-serif" font-size="22" fill="#ff8c21" text-anchor="middle" font-weight="bold">📊</text>
      <text x="84" y="38" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#ff8c21" font-weight="bold" letter-spacing="1.5">POWERPOINT PRESENTATION • SLIDE ${slideNumber} OF ${totalSlides}</text>
      <text x="84" y="74" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" fill="#ffffff" font-weight="bold">${safeTitle}</text>
      <text x="84" y="100" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#94a3b8">${safeCourse}</text>
    </g>

    <!-- Slide Content Items -->
    ${itemsSvg}

    <!-- Slide Footer -->
    <g transform="translate(100, 665)">
      <line x1="0" y1="0" x2="1080" y2="0" stroke="#1e293b" stroke-width="1"/>
      <circle cx="8" cy="22" r="5" fill="#ff8c21"/>
      <text x="24" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#64748b" font-weight="500">SkillBridge Interactive Slide Player</text>
      <text x="1080" y="26" font-family="monospace" font-size="12" fill="#64748b" font-weight="bold" text-anchor="end">Slide ${slideNumber} of ${totalSlides}</text>
    </g>
  </svg>`;
}

function normalizeUbuntuSlides(rawSlides = []) {
  if (!Array.isArray(rawSlides)) return [];
  return rawSlides.map((s, idx) => {
    const slideNumber = s.slideNumber || s.page || s.page_number || (idx + 1);
    const rawText = String(s.fullText || s.text || s.content || '').trim();
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l && !/^\d+$/.test(l));
    const firstLine = lines.find(l => l.length > 2 && !isPlaceholderTitle(l)) || '';
    const title = (s.title && !isPlaceholderTitle(s.title)) ? s.title : (firstLine || `Slide ${slideNumber}`);
    const paragraphs = Array.isArray(s.paragraphs) && s.paragraphs.length > 0
      ? s.paragraphs
      : lines.filter(l => l !== firstLine);
    return {
      ...s,
      slideNumber,
      title,
      headings: Array.isArray(s.headings) && s.headings.length > 0 ? s.headings : (firstLine ? [firstLine] : []),
      bulletPoints: Array.isArray(s.bulletPoints) ? s.bulletPoints : [],
      paragraphs,
      fullText: rawText,
    };
  });
}

/**
 * Shared background document processing pipeline for both Create (POST /upload)
 * and Update (PUT /:id) course workflows.
 * Uses Ubuntu Document Engine as primary, generates/stores 768-d pgvector embeddings,
 * falls back explicitly only on failure, and always cleans up the temporary upload file.
 */
async function processCourseDocumentInBackground({
  targetPrisma,
  courseId,
  fileObj,
  fileType,
  title,
  description,
  initialCurriculum,
  tenantCode,
}) {
  try {
    console.log(`[Ubuntu Doc Pipeline] Submitting "${fileObj.originalname}" (${fileType.toUpperCase()}) for course ${courseId}...`);
    let ubuntuJob;
    try {
      ubuntuJob = await submitDocumentJob(fileObj, {
        title,
        description,
        generateCurriculum: true,
      });
    } catch (gwErr) {
      console.warn(`[Ubuntu Doc Pipeline] Centralized submission notice for course ${courseId}:`, formatGatewayError(gwErr));
      throw gwErr;
    }

    let result;
    if (ubuntuJob._isLegacy) {
      console.log(`[Ubuntu Doc Pipeline] Legacy extract result for course ${courseId} (new service not yet deployed).`);
      result = ubuntuJob._legacyResult;
    } else {
      console.log(`[Ubuntu Doc Pipeline] Polling job ${ubuntuJob.job_id} for course ${courseId}...`);
      result = await pollDocumentJobResult(ubuntuJob.job_id, { timeoutMs: 240000, pollIntervalMs: 2000 });
    }

    const doc = result.document || {};
    const normalizedSlides = normalizeUbuntuSlides(doc.slides || result.curriculum?.slides || []);
    const normalizedPages = Array.isArray(doc.pages || result.curriculum?.pages)
      ? (doc.pages || result.curriculum?.pages).map((p, idx) => ({
          ...p,
          pageNumber: p.pageNumber || p.page_number || p.page || (idx + 1),
          page_number: p.page_number || p.pageNumber || p.page || (idx + 1),
          text: p.text || p.content || '',
        }))
      : [];

    let baseCurriculum = result.curriculum && typeof result.curriculum === 'object' ? { ...result.curriculum } : {};
    if (!Array.isArray(baseCurriculum.lessons) || baseCurriculum.lessons.length === 0) {
      if (normalizedSlides.length > 0) {
        baseCurriculum = aiService._groupSlidesIntoLessons(normalizedSlides, fileObj.originalname);
      } else if (doc.text && doc.text.trim().length > 0) {
        baseCurriculum = aiService._getMockCourse(fileObj.originalname, doc.text, {
          fileType: doc.fileType || fileType,
          slides: normalizedSlides,
          pages: normalizedPages,
        });
      }
    }

    const finalCurriculum = {
      ...baseCurriculum,
      title,
      description,
      fileType: doc.fileType || fileType,
      fileName: fileObj.originalname,
      ubuntuJobId: ubuntuJob?.job_id || null,
      processingStatus: 'COMPLETED',
      isAiGenerating: false,
      slides: normalizedSlides,
      pages: normalizedPages,
    };
    synchronizeCurriculumStructure(finalCurriculum, title);

    await targetPrisma.course.update({
      where: { id: courseId },
      data: {
        fileText: doc.text || '',
        curriculum: finalCurriculum,
      },
    });

    if (Array.isArray(result.chunks) && result.chunks.length > 0) {
      let embeddings = Array.isArray(result.embeddings) && result.embeddings.length === result.chunks.length
        ? result.embeddings
        : null;

      if (!embeddings || embeddings.some(v => !Array.isArray(v) || v.length === 0)) {
        const textsToEmbed = result.chunks.map(c => {
          const topicPrefix = c.topic ? `[Topic: ${c.topic}] ` : '';
          const conceptPrefix = c.concept ? `[Concept: ${c.concept}] ` : '';
          return `${topicPrefix}${conceptPrefix}${c.chunkText || c.text || ''}`;
        });
        embeddings = await aiService.getEmbeddings(textsToEmbed, 768);
        if (!Array.isArray(embeddings) || embeddings.length !== result.chunks.length) {
          throw new Error(`Embedding generation returned ${embeddings?.length || 0} vectors for ${result.chunks.length} Ubuntu chunks.`);
        }
      }

      await vectorChunkService.storeChunks(targetPrisma, courseId, result.chunks, embeddings);
      console.log(`[pgvector] Stored ${result.chunks.length} Ubuntu-processed chunks (dim=${result.embedding_dimensions || 768}) for course ${courseId}.`);
    } else if (doc.text && doc.text.trim().length > 40) {
      console.log(`[Ubuntu Doc Pipeline] Indexing extracted text (${doc.text.length} chars) with semantic chunking & 768-d embeddings for course ${courseId}...`);
      const storedChunks = await vectorChunkService.indexCourse(
        targetPrisma,
        courseId,
        {
          text: doc.text,
          fileName: fileObj.originalname,
          fileType: doc.fileType || fileType,
          slides: normalizedSlides,
          pages: normalizedPages,
        },
        finalCurriculum
      );
      if (!storedChunks || storedChunks.length === 0) {
        throw new Error('Semantic chunking produced 0 chunks from extracted document text.');
      }
      console.log(`[pgvector] Stored ${storedChunks.length} semantic chunks with 768-d embeddings for course ${courseId}.`);
    } else {
      throw new Error('Ubuntu document engine returned no readable text or semantic chunks.');
    }

    try {
      const updatedRecord = await targetPrisma.course.findUnique({
        where: { id: courseId },
        select: { curriculum: true },
      });
      const summary = generateModulesSummary(updatedRecord?.curriculum || finalCurriculum);
      await targetPrisma.$executeRaw`
        UPDATE "Course"
        SET "modulesSummary" = ${JSON.stringify(summary)}::jsonb
        WHERE id = ${courseId};
      `;
    } catch (_) { }

    invalidateCoursesCatalogCache(tenantCode);
    console.log(`[Ubuntu Doc Pipeline] Course ${courseId} processing completed successfully via Ubuntu AI server.`);
  } catch (ubuntuErr) {
    console.warn(`[Doc Pipeline Fallback] Ubuntu processing failed (${ubuntuErr.message}). Activating local document extraction and semantic chunking for course ${courseId}...`);
    try {
      const fallbackFileObj = {
        ...fileObj,
        buffer: await fs.promises.readFile(fileObj.path),
      };

      const docResult = await extractDocumentContent(fallbackFileObj);
      const { text: textContent, pages = [], slides = [], fileType: docFileType } = docResult;

      let fallbackCurriculum;
      if (slides.length > 0) {
        fallbackCurriculum = aiService._groupSlidesIntoLessons(slides, fileObj.originalname);
      } else {
        fallbackCurriculum = aiService._getMockCourse(fileObj.originalname, textContent, docResult);
      }

      fallbackCurriculum.title = title;
      fallbackCurriculum.description = description;
      fallbackCurriculum.fileType = docFileType || fileType;
      fallbackCurriculum.fileName = fileObj.originalname;
      fallbackCurriculum.ubuntuJobId = null;
      fallbackCurriculum.processingStatus = 'COMPLETED';
      fallbackCurriculum.processingSource = 'local_fallback';
      fallbackCurriculum.ubuntuError = ubuntuErr.message;
      fallbackCurriculum.isAiGenerating = false;
      fallbackCurriculum.slides = slides.map(s => ({ ...s, images: (s.images || []).map(im => ({ ...im, dataUrl: undefined })) }));
      fallbackCurriculum.pages = pages.map(p => ({ ...p, images: (p.images || []).map(im => ({ ...im, dataUrl: undefined })) }));
      synchronizeCurriculumStructure(fallbackCurriculum, title);

      await targetPrisma.course.update({
        where: { id: courseId },
        data: {
          fileText: textContent || '',
          curriculum: fallbackCurriculum,
        },
      });

      const storedChunks = await vectorChunkService.indexCourse(targetPrisma, courseId, docResult, fallbackCurriculum);
      console.log(`[pgvector] Stored ${storedChunks?.length || 0} locally-indexed semantic chunks for course ${courseId}.`);

      try {
        const updatedRecord = await targetPrisma.course.findUnique({
          where: { id: courseId },
          select: { curriculum: true },
        });
        const summary = generateModulesSummary(updatedRecord?.curriculum || fallbackCurriculum);
        await targetPrisma.$executeRaw`
          UPDATE "Course"
          SET "modulesSummary" = ${JSON.stringify(summary)}::jsonb
          WHERE id = ${courseId};
        `;
      } catch (_) { }

      invalidateCoursesCatalogCache(tenantCode);
      console.log(`[Doc Pipeline Fallback] Course ${courseId} successfully processed and chunked via local engine!`);
    } catch (localErr) {
      console.error(`[Doc Pipeline Fallback] Both Ubuntu and local extraction failed for course ${courseId}:`, localErr.message);
      try {
        await targetPrisma.course.update({
          where: { id: courseId },
          data: {
            curriculum: {
              ...initialCurriculum,
              processingStatus: 'FAILED',
              processingError: localErr.message,
              ubuntuError: ubuntuErr.message,
              isAiGenerating: false,
            },
          },
        });
        invalidateCoursesCatalogCache(tenantCode);
      } catch (_) { }
    }
  } finally {
    try {
      if (fileObj?.path && fs.existsSync(fileObj.path)) {
        await fs.promises.unlink(fileObj.path);
        console.log(`[File Cleanup] Temporary upload removed for course ${courseId}.`);
      }
    } catch (cleanupErr) {
      console.warn(`[File Cleanup] Could not remove temporary upload for course ${courseId}:`, cleanupErr.message);
    }
  }
}

// 1. Admin: Create course module by uploading a document (delegates all AI/OCR/chunking/embeddings to Ubuntu AI server)
router.post('/upload', authenticateToken, requireRole(['ADMIN']), courseUpload.single('file'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
  let backgroundProcessingStarted = false;
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Course title and description/info are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a supported course document (PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, CSV, RTF, HTML, PNG, JPG, JPEG).' });
    }

    let fileType;
    try {
      fileType = validateDocumentFile(req.file);
    } catch (valErr) {
      return res.status(valErr.status || 415).json({ error: valErr.message });
    }

    const fileObj = {
      path: req.file.path,
      size: req.file.size,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
    };

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    const initialCurriculum = {
      title: trimmedTitle,
      description: trimmedDescription,
      fileType,
      fileName: req.file.originalname,
      ubuntuJobId: null,
      processingStatus: 'PROCESSING',
      isAiGenerating: true,
      slides: [],
      pages: [],
      curriculum: [],
      lessons: [],
    };

    const targetPrisma = req.prisma || prisma;
    const newCourse = await targetPrisma.course.create({
      data: {
        title: trimmedTitle,
        description: trimmedDescription,
        fileName: req.file.originalname,
        fileText: '',
        curriculum: initialCurriculum,
      },
    });

    try {
      const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(newCourse.id));
      fs.mkdirSync(courseUploadDir, { recursive: true });
      fs.copyFileSync(
        req.file.path,
        path.join(courseUploadDir, path.basename(req.file.originalname))
      );
    } catch (saveErr) {
      console.warn('[File Storage] Notice saving original file:', saveErr.message);
    }

    invalidateCoursesCatalogCache(req.tenantCode);

    // Return 201 Created immediately (< 100ms) to prevent Nginx 504 Gateway Timeouts
    res.status(201).json({
      message: 'Course uploaded and queued for centralized Ubuntu AI processing.',
      course: {
        id: newCourse.id,
        title: newCourse.title,
        description: newCourse.description,
        fileName: newCourse.fileName,
        curriculum: initialCurriculum,
        createdAt: newCourse.createdAt,
      },
    });
    backgroundProcessingStarted = true;

    // Run entire centralized Ubuntu AI submission, extraction, chunking & 768-d vectors in background
    setImmediate(() => {
      processCourseDocumentInBackground({
        targetPrisma,
        courseId: newCourse.id,
        fileObj,
        fileType,
        title: trimmedTitle,
        description: trimmedDescription,
        initialCurriculum,
        tenantCode: req.tenantCode,
      });
    });
  } catch (error) {
    console.error('[Ubuntu Doc Pipeline] Failed to publish course:', error);

    if (!backgroundProcessingStarted && req.file?.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          await fs.promises.unlink(req.file.path);
          console.log('[File Cleanup] Temporary upload removed after route error.');
        }
      } catch (cleanupErr) {
        console.warn('[File Cleanup] Could not remove temporary upload:', cleanupErr.message);
      }
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: error.message || 'Failed to submit document for centralized processing.',
      });
    }
  }
});

// Get centralized Ubuntu processing status for a course
router.get('/:id/processing-status', authenticateToken, async (req, res) => {
  try {
    const targetPrisma = req.prisma || prisma;
    const course = await targetPrisma.course.findUnique({
      where: { id: req.params.id },
      select: { id: true, curriculum: true, _count: { select: { chunks: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found.' });
    const curr = typeof course.curriculum === 'string' ? JSON.parse(course.curriculum) : (course.curriculum || {});
    return res.json({
      courseId: course.id,
      processingStatus: curr.processingStatus || (course._count?.chunks > 0 ? 'COMPLETED' : 'UNKNOWN'),
      ubuntuJobId: curr.ubuntuJobId || null,
      processingError: curr.processingError || null,
      chunksCount: course._count?.chunks || 0,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check course processing status.' });
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

// Serve slide image (PNG or SVG) for course (PowerPoint slides)
router.get('/:id/slides/:slideNum/image', async (req, res) => {
  try {
    const courseId = req.params.id;
    const slideNum = parseInt(req.params.slideNum, 10);
    if (isNaN(slideNum) || slideNum < 1) {
      return res.status(400).json({ error: 'Invalid slide number.' });
    }

    const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(courseId));
    const slidesDir = path.join(courseUploadDir, 'slides');
    const slidePngFile = path.join(slidesDir, `Slide${slideNum}.png`);
    const slideSvgFile = path.join(slidesDir, `Slide${slideNum}.svg`);

    // 1. Direct raster PNG file exists
    if (fs.existsSync(slidePngFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(slidePngFile).pipe(res);
    }

    // 2. Direct SVG presentation file exists
    if (fs.existsSync(slideSvgFile)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(slideSvgFile).pipe(res);
    }

    // 3. Try on-demand extraction from original presentation file on Ubuntu/Linux
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

    if (fs.existsSync(slidePngFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(slidePngFile).pipe(res);
    }

    // 4. Fallback: Check if slide image is stored in DB curriculum
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
        fs.writeFileSync(slidePngFile, buf);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(buf);
      }
    }

    // 5. Ultimate Guarantee: Dynamically generate crisp presentation SVG card on-the-fly
    fs.mkdirSync(slidesDir, { recursive: true });
    const totalSlides = Array.isArray(cur.slides) ? cur.slides.length : 1;
    const svgOutput = generateSlideSvg({
      slideNumber: slideNum,
      totalSlides,
      title: targetSlide?.title || `Slide ${slideNum}`,
      headings: targetSlide?.headings || [],
      bulletPoints: targetSlide?.bulletPoints || [],
      paragraphs: targetSlide?.paragraphs || [],
      courseTitle: course.title || 'Course Presentation'
    });

    try {
      fs.writeFileSync(slideSvgFile, svgOutput, 'utf-8');
    } catch (_) { }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(svgOutput);
  } catch (err) {
    console.error('Error serving slide image:', err);
    res.status(500).json({ error: 'Failed to retrieve slide image.' });
  }
});

// Serve page image (PNG or SVG) for course (PDF / documents)
router.get('/:id/pages/:pageNum/image', async (req, res) => {
  try {
    const courseId = req.params.id;
    const pageNum = parseInt(req.params.pageNum, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Invalid page number.' });
    }

    const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(courseId));
    const pagesDir = path.join(courseUploadDir, 'pages');
    const pagePngFile = path.join(pagesDir, `Page${pageNum}.png`);
    const pageSvgFile = path.join(pagesDir, `Page${pageNum}.svg`);

    // 1. Direct raster PNG file exists
    if (fs.existsSync(pagePngFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(pagePngFile).pipe(res);
    }

    // 2. Direct SVG document file exists
    if (fs.existsSync(pageSvgFile)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(pageSvgFile).pipe(res);
    }

    // 3. Try on-demand extraction from original PDF document on Ubuntu/Linux
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

    if (fs.existsSync(pagePngFile)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(pagePngFile).pipe(res);
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
        fs.writeFileSync(pagePngFile, buf);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(buf);
      }
    }

    // 5. Ultimate Guarantee: Dynamically generate crisp document SVG card on-the-fly
    fs.mkdirSync(pagesDir, { recursive: true });
    const totalPages = Array.isArray(cur.pages) ? cur.pages.length : 1;
    const svgOutput = generateSlideSvg({
      slideNumber: pageNum,
      totalSlides: totalPages,
      title: targetPage?.title || `Page ${pageNum}`,
      paragraphs: targetPage?.text ? [targetPage.text] : [],
      courseTitle: course.title || 'Training Document'
    });

    try {
      fs.writeFileSync(pageSvgFile, svgOutput, 'utf-8');
    } catch (_) { }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(svgOutput);
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

// In-memory cache mapping courseId -> tenantCode to eliminate repeated multi-tenant database sweeps
const courseTenantCache = new Map();
const COURSE_TENANT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes TTL

// Helper to resolve a course and its active database client across tenant boundaries
export async function findCourseAcrossTenants(courseId, initialPrisma, includeOptions = null) {
  let targetPrisma = initialPrisma || prisma;
  let course = null;

  // 0. Check cache first for rapid resolution
  const cached = courseTenantCache.get(courseId);
  if (cached && (Date.now() - cached.time < COURSE_TENANT_CACHE_TTL)) {
    try {
      const client = cached.tenantCode === 'default'
        ? defaultPrisma
        : await tenantService.getTenantClient(cached.tenantCode);
      if (client) {
        course = await client.course.findUnique({
          where: { id: courseId },
          ...(includeOptions ? { include: includeOptions } : {})
        });
        if (course) return { course, targetPrisma: client };
      }
    } catch (_) { }
  }

  // 1. Check specified / active tenant database
  try {
    course = await targetPrisma.course.findUnique({
      where: { id: courseId },
      ...(includeOptions ? { include: includeOptions } : {})
    });
    if (course) {
      courseTenantCache.set(courseId, { tenantCode: 'active', time: Date.now() });
      return { course, targetPrisma };
    }
  } catch (_) { }

  // 2. Check default database if not found in active tenant
  if (!course && defaultPrisma && targetPrisma !== defaultPrisma) {
    try {
      course = await defaultPrisma.course.findUnique({
        where: { id: courseId },
        ...(includeOptions ? { include: includeOptions } : {})
      });
      if (course) {
        targetPrisma = defaultPrisma;
        courseTenantCache.set(courseId, { tenantCode: 'default', time: Date.now() });
        return { course, targetPrisma };
      }
    } catch (_) { }
  }

  // 3. Scan other tenant databases if course belongs to another company
  if (!course) {
    try {
      const companies = await masterPrisma.company.findMany({ select: { code: true } }).catch(() => []);
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
              courseTenantCache.set(courseId, { tenantCode: comp.code, time: Date.now() });
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

// Helper to synchronize and ensure both curriculum (modules) and lessons are properly structured
export function synchronizeCurriculumStructure(curriculum, courseTitle = 'Course') {
  if (!curriculum || typeof curriculum !== 'object') {
    curriculum = {};
  }
  let rawLessons = Array.isArray(curriculum.lessons) ? curriculum.lessons : [];
  let rawModules = Array.isArray(curriculum.curriculum) ? curriculum.curriculum : [];

  // 1. If lessons exist but modules are empty, synthesize modules from lessons
  if (rawModules.length === 0 && rawLessons.length > 0) {
    const moduleMap = new Map();
    rawLessons.forEach((l, idx) => {
      const modKey = l.moduleTitle || l.chapterTitle || l.moduleId || `Module ${Math.floor(idx / 4) + 1}`;
      if (!moduleMap.has(modKey)) {
        moduleMap.set(modKey, {
          id: l.moduleId || `mod_${moduleMap.size + 1}`,
          title: cleanUnsupportedWords(modKey, `Module ${moduleMap.size + 1}`),
          description: '',
          lessons: []
        });
      }
      moduleMap.get(modKey).lessons.push({
        id: l.id || idx + 1,
        title: cleanUnsupportedWords(l.title, `Lesson ${idx + 1}`),
        duration: l.duration || '02:30'
      });
    });
    rawModules = Array.from(moduleMap.values());
    curriculum.curriculum = rawModules;
  }
  // 2. If modules exist but lessons are empty, extract lessons from modules
  else if (rawLessons.length === 0 && rawModules.length > 0) {
    rawLessons = rawModules.flatMap((m, mIdx) =>
      Array.isArray(m.lessons) ? m.lessons.map((l, lIdx) => ({
        ...l,
        id: l.id || lIdx + 1,
        title: cleanUnsupportedWords(l.title, `Lesson ${lIdx + 1}`),
        duration: l.duration || '02:30',
        moduleId: m.id || `mod_${mIdx + 1}`,
        moduleTitle: cleanUnsupportedWords(m.title, `Module ${mIdx + 1}`)
      })) : []
    );
    curriculum.lessons = rawLessons;
  }

  curriculum.modulesCount = rawModules.length || (rawLessons.length > 0 ? Math.ceil(rawLessons.length / 4) : 0);
  curriculum.lessonsCount = rawLessons.length;

  return curriculum;
}

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
  try {
    let curriculumSummary = course?.curriculum;
    if (curriculumSummary) {
      if (typeof curriculumSummary === 'string') {
        try {
          curriculumSummary = JSON.parse(curriculumSummary);
        } catch (e) {
          curriculumSummary = {};
        }
      }
    }
    if (!curriculumSummary || typeof curriculumSummary !== 'object') {
      curriculumSummary = {};
    }

    const chunksCount = course.chunksCount ?? course._count?.chunks ?? (Array.isArray(course.chunks) ? course.chunks.length : 0);

    // Extract lightweight lessons list for catalog presentation
    let rawLessons = (Array.isArray(curriculumSummary.lessons) && curriculumSummary.lessons.length > 0)
      ? curriculumSummary.lessons
      : (Array.isArray(course.chunks) && course.chunks.length > 0)
        ? course.chunks.map((c, cIdx) => ({
          id: cIdx + 1,
          title: cleanUnsupportedWords(c.concept || c.topic || `Lesson ${cIdx + 1}`),
          duration: '02:30',
          moduleId: `mod_${Math.floor(cIdx / 4) + 1}`,
          moduleTitle: cleanUnsupportedWords(c.topic || course.title),
          chapterTitle: cleanUnsupportedWords(c.topic || course.title),
        }))
        : [];

    let rawModules = Array.isArray(curriculumSummary.curriculum) ? curriculumSummary.curriculum : [];

    // Fallback 1: If rawLessons is empty but rawModules exists, extract lessons from modules
    if (rawLessons.length === 0 && rawModules.length > 0) {
      rawLessons = rawModules.flatMap((m, mIdx) =>
        Array.isArray(m.lessons) ? m.lessons.map((l, lIdx) => ({
          ...l,
          id: l.id || lIdx + 1,
          title: cleanUnsupportedWords(l.title, `Lesson ${lIdx + 1}`),
          duration: l.duration || '02:30',
          moduleId: m.id || `mod_${mIdx + 1}`,
          moduleTitle: cleanUnsupportedWords(m.title, `Module ${mIdx + 1}`)
        })) : []
      );
    }

    // Fallback 2: If rawModules is empty but rawLessons exists, synthesize module groupings
    if (rawModules.length === 0 && rawLessons.length > 0) {
      const moduleMap = new Map();
      rawLessons.forEach((l, idx) => {
        const modKey = l.moduleTitle || l.moduleId || `Module ${Math.floor(idx / 4) + 1}`;
        if (!moduleMap.has(modKey)) {
          moduleMap.set(modKey, {
            id: l.moduleId || `mod_${moduleMap.size + 1}`,
            title: modKey,
            description: '',
            lessons: []
          });
        }
        moduleMap.get(modKey).lessons.push({
          id: l.id || idx + 1,
          title: cleanUnsupportedWords(l.title, `Lesson ${idx + 1}`),
          duration: l.duration || '02:30'
        });
      });
      rawModules = Array.from(moduleMap.values());
    }

    // Fallback 3: If both rawLessons and rawModules are empty but chunksCount > 0, generate structured units
    if (rawLessons.length === 0 && rawModules.length === 0 && chunksCount > 0) {
      const numModules = Math.max(1, Math.ceil(chunksCount / 4));
      for (let m = 1; m <= numModules; m++) {
        const chunkStart = (m - 1) * 4 + 1;
        const chunkEnd = Math.min(chunksCount, m * 4);
        const moduleLessons = [];
        for (let l = chunkStart; l <= chunkEnd; l++) {
          const lessonObj = {
            id: l,
            title: `Lesson ${l}: Learning Unit`,
            duration: '02:30',
            moduleId: `mod_${m}`,
            moduleTitle: `Module ${m}`,
            chapterTitle: `Module ${m}`
          };
          moduleLessons.push(lessonObj);
          rawLessons.push(lessonObj);
        }
        rawModules.push({
          id: `mod_${m}`,
          title: `Module ${m}: Core Knowledge`,
          description: `Key learning points and concepts`,
          lessons: moduleLessons
        });
      }
    }

    const sanitizedLessons = rawLessons.map((l, lIdx) => ({
      id: l.id || lIdx + 1,
      title: cleanUnsupportedWords(l.title, `Lesson ${lIdx + 1}`),
      duration: l.duration || '02:30',
      moduleId: l.moduleId || `mod_${Math.floor(lIdx / 4) + 1}`,
      chapterId: l.chapterId,
      moduleTitle: cleanUnsupportedWords(l.moduleTitle || l.chapterTitle, course.title),
      chapterTitle: cleanUnsupportedWords(l.chapterTitle || l.moduleTitle, course.title),
    }));

    const sanitizedModules = rawModules.map((m, mIdx) => ({
      id: m.id || mIdx + 1,
      title: cleanUnsupportedWords(m.title, `Module ${mIdx + 1}`),
      description: cleanUnsupportedWords(m.description || ''),
      lessons: Array.isArray(m.lessons) ? m.lessons.map((l, idx) => ({
        id: l.id || idx + 1,
        title: cleanUnsupportedWords(l.title, `Lesson ${idx + 1}`),
        duration: l.duration || '02:30'
      })) : []
    }));

    const detectedFileType = (curriculumSummary.fileType || course.fileName?.split('.').pop() || '').toLowerCase();

    // Streamlined slide metadata without heavy base64 images or thousands of paragraph lines
    const slideSummaries = Array.isArray(curriculumSummary.slides)
      ? curriculumSummary.slides.map((s, idx) => ({
        slideNumber: s.slideNumber || idx + 1,
        title: cleanUnsupportedWords(s.title || `Slide ${idx + 1}`),
        type: 'slide',
        image: `/api/v1/courses/${course.id}/slides/${s.slideNumber || idx + 1}/image`,
        bulletPoints: (s.bulletPoints || []).slice(0, 5).map(bp => cleanUnsupportedWords(bp)),
        headings: (s.headings || []).slice(0, 3).map(h => cleanUnsupportedWords(h))
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

    const computedModulesCount = sanitizedModules.length || (sanitizedLessons.length > 0 ? Math.ceil(sanitizedLessons.length / 4) : 0) || chunksCount || 0;
    const computedLessonsCount = sanitizedLessons.length || chunksCount || (sanitizedModules.reduce((acc, m) => acc + (m.lessons?.length || 0), 0)) || 0;

    const currentProcessingStatus = curriculumSummary.processingStatus || (chunksCount > 0 ? 'COMPLETED' : 'UNKNOWN');
    const currentIsAiGenerating = Boolean(curriculumSummary.isAiGenerating);

    return {
      id: course.id,
      title: cleanUnsupportedWords(course.title),
      description: cleanUnsupportedWords(course.description),
      fileName: course.fileName,
      fileType: detectedFileType,
      slides: slideSummaries,
      pages: pageSummaries,
      processingStatus: currentProcessingStatus,
      isAiGenerating: currentIsAiGenerating,
      curriculum: {
        title: cleanUnsupportedWords(curriculumSummary.title || course.title),
        description: cleanUnsupportedWords(curriculumSummary.description || course.description),
        fileType: detectedFileType,
        fileName: course.fileName,
        processingStatus: currentProcessingStatus,
        isAiGenerating: currentIsAiGenerating,
        slides: slideSummaries,
        pages: pageSummaries,
        includes: curriculumSummary.includes,
        learning: curriculumSummary.learning,
        curriculum: sanitizedModules,
        lessons: sanitizedLessons,
        modulesCount: computedModulesCount,
        lessonsCount: computedLessonsCount,
      },
      lessons: sanitizedLessons,
      modulesCount: computedModulesCount,
      lessonsCount: computedLessonsCount,
      chunksCount: chunksCount,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      assignedUsersCount: course.assignedUsersCount ?? course._count?.assignments ?? 0,
    };
  } catch (fmtErr) {
    console.warn(`[Courses] Error formatting course ${course?.id}:`, fmtErr.message);
    return {
      id: course?.id,
      title: course?.title || 'Course',
      description: course?.description || '',
      fileName: course?.fileName || '',
      fileType: 'document',
      slides: [],
      pages: [],
      curriculum: { lessons: [], curriculum: [] },
      lessons: [],
      modulesCount: 0,
      lessonsCount: 0,
      chunksCount: 0,
      createdAt: course?.createdAt || new Date().toISOString(),
      updatedAt: course?.updatedAt || new Date().toISOString(),
      assignedUsersCount: 0
    };
  }
}

// 2. Get published RAG courses (Admin gets all with counts; Students get ONLY assigned courses)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const targetPrisma = req.prisma || prisma;
    const tenantKey = req.tenantCode || 'default';
    const userRole = String(req.user?.role || '').toUpperCase();

    if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' || userRole === 'SUPERADMIN') {
      const now = Date.now();
      const cached = catalogCacheByTenant.get(tenantKey);
      if (cached && (now - cached.time) < CATALOG_CACHE_TTL) {
        return res.json(cached.data);
      }

      let courses = [];
      try {
        courses = await targetPrisma.course.findMany({
          select: {
            id: true,
            title: true,
            description: true,
            fileName: true,
            createdAt: true,
            updatedAt: true,
            curriculum: true,
            _count: {
              select: { assignments: true, chunks: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        });
      } catch (err) {
        console.warn('[Courses] Native findMany fallback:', err.message);
        courses = await targetPrisma.$queryRaw`
          SELECT
            c.id,
            c.title,
            c.description,
            c."fileName",
            c.curriculum,
            c."createdAt",
            c."updatedAt",
            (
              SELECT COUNT(*)::int
              FROM "UserCourseAssignment" uca
              WHERE uca."courseId" = c.id
            ) AS "assignedUsersCount",
            (
              SELECT COUNT(*)::int
              FROM "CourseChunk" cc
              WHERE cc."courseId" = c.id
            ) AS "chunksCount"
          FROM "Course" c
          ORDER BY c."createdAt" DESC;
        `;
      }

      // Auto-recover any existing courses with empty module groupings in database
      for (const c of courses) {
        let cur = c.curriculum;
        if (typeof cur === 'string') {
          try { cur = JSON.parse(cur); } catch (_) { cur = null; }
        }
        if (cur && (!Array.isArray(cur.curriculum) || cur.curriculum.length === 0) && Array.isArray(cur.lessons) && cur.lessons.length > 0) {
          synchronizeCurriculumStructure(cur, c.title);
          targetPrisma.course.update({
            where: { id: c.id },
            data: { curriculum: cur }
          }).catch(() => { });
        }
      }

      const formatted = courses.map(formatCourseForCatalog);
      catalogCacheByTenant.set(tenantKey, { data: formatted, time: now });
      return res.json(formatted);
    }

    // For STUDENT role: return ONLY assigned courses with user progress in 1 fast query
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

    let courses = [];
    try {
      courses = await targetPrisma.course.findMany({
        where: { id: { in: assignedIds } },
        select: {
          id: true,
          title: true,
          description: true,
          fileName: true,
          createdAt: true,
          updatedAt: true,
          curriculum: true,
          _count: {
            select: { assignments: true, chunks: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } catch (_) {
      courses = await targetPrisma.$queryRaw`
        SELECT
          c.id,
          c.title,
          c.description,
          c."fileName",
          c.curriculum,
          c."createdAt",
          c."updatedAt",
          (
            SELECT COUNT(*)::int
            FROM "UserCourseAssignment" uca
            WHERE uca."courseId" = c.id
          ) AS "assignedUsersCount",
          (
            SELECT COUNT(*)::int
            FROM "CourseChunk" cc
            WHERE cc."courseId" = c.id
          ) AS "chunksCount"
        FROM "Course" c
        WHERE c.id = ANY(${assignedIds}::text[])
        ORDER BY c."createdAt" DESC;
      `;
    }

    const progressRecords = await targetPrisma.courseProgress.findMany({
      where: {
        userId: { in: userIds },
        courseId: { in: assignedIds }
      }
    });

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
    const lessonIdStr = String(req.params.lessonId);
    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);
    const targetLanguage = targetLangInfo.name;

    // 1. FAST PATH 1: Check if lesson explanation is already stored in Course.curriculum database record
    let curriculum = course.curriculum;
    if (typeof curriculum === 'string') {
      try { curriculum = JSON.parse(curriculum); } catch { curriculum = {}; }
    }
    if (!curriculum || typeof curriculum !== 'object') curriculum = {};

    let effectiveLessonTitle = lessonTitle;
    if (!effectiveLessonTitle && Array.isArray(curriculum.lessons)) {
      const found = curriculum.lessons.find(l => String(l.id) === lessonIdStr);
      if (found?.title) effectiveLessonTitle = found.title;
    }
    if (!effectiveLessonTitle) {
      return res.status(400).json({ error: 'Lesson title is required.' });
    }

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

    let lectureTimer;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        lectureTimer = setTimeout(() => reject(new Error('Teacher lecture generation timeout (25s)')), 25000);
      });
      explanation = await Promise.race([
        interactiveCourseService.generateTeacherLecture(effectiveLessonTitle, course.title, sourceScript, {
          language: targetLangInfo.code,
          targetWpm: 130,
          signal: req.abortController?.signal,
          timeoutMs: 25000
        }),
        timeoutPromise
      ]);
    } catch (lectureErr) {
      console.warn(`[PERF:LLM_END] AI teacher engine fallback triggered for ${targetLanguage}:`, lectureErr.message);
      explanation = aiService._getMockExplanation(effectiveLessonTitle, targetLanguage);
    } finally {
      if (lectureTimer) clearTimeout(lectureTimer);
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

    // 1b. Lesson explanation fallback: ONLY if the lesson is exclusively mapped to this single slide
    if (matchingLesson && Array.isArray(matchingLesson.sourceSlides) && matchingLesson.sourceSlides.length === 1) {
      const lessonExp = matchingLesson.explanations?.[targetLangInfo.code] ||
        (targetLangInfo.code === 'en' ? (matchingLesson.explanation || matchingLesson.spoken_explanation) : null);
      if (lessonExp && typeof lessonExp === 'string' && lessonExp.trim().length > 30) {
        const cleanLessonExp = cleanUnsupportedWords(stripSlidePlaceholders(lessonExp));
        return res.json({
          page_or_slide_number: pageNum,
          title: stripSlidePlaceholders(title) || `Slide ${pageNum}`,
          spoken_explanation: cleanLessonExp,
          explanation: cleanLessonExp,
          key_points: (targetSlide?.key_points || matchingLesson.key_points || []).map(stripSlidePlaceholders),
          safety_warnings: (targetSlide?.safety_warnings || matchingLesson.safety_warnings || []).map(stripSlidePlaceholders),
          suggested_next_transition: `Proceed to next section when ready.`,
          visuals,
          language: targetLangInfo,
          cached: true
        });
      }
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
    let pageTimer;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        pageTimer = setTimeout(() => reject(new Error('LLM slide explanation timeout (15s)')), 15000);
      });
      structured = await Promise.race([
        aiService.explainVisibleContent({
          pageNumber: pageNum,
          title: stripSlidePlaceholders(title) || `Slide ${pageNum}`,
          text: cleanFullContent,
          bulletPoints: cleanBullets,
          visuals
        }, course.title, targetLangInfo.name, {
          signal: req.abortController?.signal,
          timeoutMs: 15000
        }),
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
    } finally {
      if (pageTimer) clearTimeout(pageTimer);
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
    const quiz = await aiService.generateLessonQuiz(course.title, lessonTitle, contextText, targetLanguage, {
      signal: req.abortController?.signal,
      timeoutMs: 30000
    });
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

    const { message, lessonId, lessonTitle, currentConcept, language, conversationHistory, conversationId } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    const requestId = `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const activeConvId = conversationId || `conv_${course.id}`;

    // Resolve active lesson metadata (sourceSlides + lessonTitle) so RAG prioritizes the current lesson
    let parsedCurr = course.curriculum;
    if (typeof parsedCurr === 'string') {
      try { parsedCurr = JSON.parse(parsedCurr); } catch (_) { parsedCurr = {}; }
    }
    const currLessons = Array.isArray(parsedCurr?.lessons) ? parsedCurr.lessons : [];
    const activeLessonObj = currLessons.find(l =>
      (lessonId !== undefined && lessonId !== null && String(l.id) === String(lessonId)) ||
      (lessonTitle && String(l.title || '').toLowerCase() === String(lessonTitle).toLowerCase())
    ) || null;
    const effectiveLessonId = lessonId ?? activeLessonObj?.id ?? null;
    const effectiveLessonTitle = lessonTitle || activeLessonObj?.title || null;
    const activeLessonSlides = Array.isArray(activeLessonObj?.sourceSlides) ? activeLessonObj.sourceSlides : [];

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

    // Retrieve semantic context matching student query from PostgreSQL pgvector (scoped strictly to course.id & active lesson)
    const ragChatStartTime = Date.now();
    const asksAboutCurrentConcept = currentConcept?.trim() &&
      /^(?:please\s+)?(?:explain (?:this|that)(?: slide| concept| point)?|what does (?:this|that) mean)[?.!\s]*$/i.test(message);
    const ragQuery = asksAboutCurrentConcept
      ? `${effectiveLessonTitle || ''} ${currentConcept}`.trim()
      : message;
    let chunks = [];
    try {
      chunks = await vectorChunkService.querySimilarChunks(targetPrisma, course.id, ragQuery, 3, {
        lessonTitle: effectiveLessonTitle,
        topicFilter: effectiveLessonTitle,
        sourceSlides: activeLessonSlides
      });
    } catch (e) {
      const ragChatDuration = Date.now() - ragChatStartTime;
      console.warn(`[PERF:RAG_END] pgvector RAG query notice (${ragChatDuration}ms):`, e.message);
    }

    const ragContext = interactiveCourseService.buildTeachingRAGContext(course, effectiveLessonTitle, message, chunks);
    const hasCourseMaterial = Boolean((chunks && chunks.length > 0) || (course?.fileText && course.fileText.trim().length > 20));
    const lessonSpecificContext = activeLessonObj?.explanation
      ? `[ACTIVE LESSON CONTEXT: "${effectiveLessonTitle}"]\n${String(activeLessonObj.explanation).slice(0, 600)}\n\n`
      : '';
    const compactGroundedContext = hasCourseMaterial
      ? `${lessonSpecificContext}${ragContext.groundedContext || ''}`.slice(0, 1800)
      : 'NO_COURSE_MATERIAL_AVAILABLE: The uploaded course does not contain verified content for this query.';

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
5. STRICT KNOWLEDGE GROUNDING: Rely ONLY on the verified course training context below. Prioritize the active lesson context. If the student asks something not covered by the retrieved course content (or if context says NO_COURSE_MATERIAL_AVAILABLE), clearly state that the uploaded course does not contain that information rather than inventing facts.
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
    let cancellationReason = null;
    const modelName = process.env.SKILLBRIDGE_MODEL || 'qwen3.5:9b';

    let reply;
    let tutorTimer;
    try {
      // 45-second timeout to accommodate Qwen inference while staying safely within 60s Nginx/frontend timeouts
      const llmPromise = aiService._callLLM(systemPrompt, userPrompt, false, conversationHistory || [], {
        signal: req.abortController?.signal,
        timeoutMs: 45000
      });
      const timeoutPromise = new Promise((_, reject) => {
        tutorTimer = setTimeout(() => reject(new Error('Tutor voice latency threshold reached (45s).')), 45000);
      });
      reply = await Promise.race([llmPromise, timeoutPromise]);
      const llmChatDuration = Date.now() - llmChatStartTime;
      console.log(JSON.stringify({
        tag: 'TUTOR_CHAT',
        requestId,
        courseId: course.id,
        lessonId: effectiveLessonId,
        conversationId: activeConvId,
        retrievedChunkIds: (chunks || []).map(c => c.id),
        retrievalScores: (chunks || []).map(c => Number((c.finalScore ?? c.similarity ?? 0).toFixed(4))),
        model: modelName,
        durationMs: llmChatDuration,
        cancellationReason: null
      }));
    } catch (e) {
      const llmChatDuration = Date.now() - llmChatStartTime;
      cancellationReason = e.message || 'unknown_error';
      console.warn(JSON.stringify({
        tag: 'TUTOR_CHAT_FALLBACK',
        requestId,
        courseId: course.id,
        lessonId: effectiveLessonId,
        conversationId: activeConvId,
        retrievedChunkIds: (chunks || []).map(c => c.id),
        retrievalScores: (chunks || []).map(c => Number((c.finalScore ?? c.similarity ?? 0).toFixed(4))),
        model: modelName,
        durationMs: llmChatDuration,
        cancellationReason
      }));

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
    } finally {
      if (tutorTimer) clearTimeout(tutorTimer);
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
router.put('/:id', authenticateToken, requireRole(['ADMIN']), courseUpload.single('file'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
  let backgroundProcessingStarted = false;
  try {
    const courseId = req.params.id;
    const { title, description, curriculum } = req.body;
    const { course: existingCourse, targetPrisma } = await findCourseAcrossTenants(courseId, req.prisma || prisma, null);

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
      let fileType;
      try {
        fileType = validateDocumentFile(req.file);
      } catch (valErr) {
        return res.status(valErr.status || 415).json({ error: valErr.message });
      }

      const fileObj = {
        path: req.file.path,
        size: req.file.size,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      };

      const initialCurriculum = {
        title: finalTitle,
        description: finalDescription,
        fileType,
        fileName: req.file.originalname,
        ubuntuJobId: null,
        processingStatus: 'PROCESSING',
        isAiGenerating: true,
        slides: [],
        pages: [],
        curriculum: [],
        lessons: [],
      };

      updateData.fileName = req.file.originalname;
      updateData.fileText = '';
      updateData.curriculum = initialCurriculum;

      // Save updated original file to permanent course directory (replacing previous files/cached renders)
      try {
        const courseUploadDir = path.join(process.cwd(), 'uploads', 'courses', String(courseId));
        if (fs.existsSync(courseUploadDir)) {
          fs.rmSync(courseUploadDir, { recursive: true, force: true });
        }
        fs.mkdirSync(courseUploadDir, { recursive: true });
        fs.copyFileSync(
          req.file.path,
          path.join(courseUploadDir, path.basename(req.file.originalname))
        );
      } catch (fErr) {
        console.warn(`[File Storage] Notice updating course file on disk:`, fErr.message);
      }

      const updatedCourse = await targetPrisma.course.update({
        where: { id: courseId },
        data: updateData,
      });

      try {
        const summary = generateModulesSummary(initialCurriculum);
        await targetPrisma.$executeRaw`
          UPDATE "Course"
          SET "modulesSummary" = ${JSON.stringify(summary)}::jsonb
          WHERE id = ${courseId};
        `;
      } catch (_) { }

      invalidateCoursesCatalogCache(req.tenantCode);

      res.json({
        message: 'Course updated and queued for centralized Ubuntu AI processing.',
        course: updatedCourse,
      });
      backgroundProcessingStarted = true;

      setImmediate(() => {
        processCourseDocumentInBackground({
          targetPrisma,
          courseId,
          fileObj,
          fileType,
          title: finalTitle,
          description: finalDescription,
          initialCurriculum,
          tenantCode: req.tenantCode,
        });
      });
      return;
    }

    let curriculumObj = curriculum !== undefined ? curriculum : existingCourse.curriculum;
    if (typeof curriculumObj === 'string') {
      try { curriculumObj = JSON.parse(curriculumObj); } catch (e) { }
    }
    if (curriculumObj && typeof curriculumObj === 'object') {
      curriculumObj.title = finalTitle;
      curriculumObj.description = finalDescription;
      updateData.curriculum = curriculumObj;
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

    if (!backgroundProcessingStarted && req.file?.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          await fs.promises.unlink(req.file.path);
          console.log('[File Cleanup] Temporary upload removed after update route error.');
        }
      } catch (cleanupErr) {
        console.warn('[File Cleanup] Could not remove temporary upload:', cleanupErr.message);
      }
    }

    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to update course module.' });
    }
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
        timeout: 15000
      }).catch(async (err) => {
        if (err.response?.status === 404) {
          return await axios.post(`${gatewayUrl}/api/v1/transcribe`, form, { headers, timeout: 15000 });
        }
        throw err;
      });

      if (pyResponse.data && typeof pyResponse.data.text === 'string') {
        let text = pyResponse.data.text.trim();
        const detectedLanguage = pyResponse.data.detected_language || targetLangCode || 'en';
        const normStt = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
        const whisperHallucinations = new Set([
          'thank you', 'thanks', 'thank you for watching', 'thanks for watching',
          'take a minute', 'wait a minute', 'just a minute', 'one minute', 'one moment',
          'blank audio', 'silence', 'you', 'bye', 'subtitles by'
        ]);
        if (whisperHallucinations.has(normStt)) {
          console.log(`[Whisper Flow] Filtered silence hallucination: "${text}"`);
          text = '';
        } else {
          console.log(`[Whisper Flow Python AI Service Result]: "${text}" (detected: ${detectedLanguage})`);
        }
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
