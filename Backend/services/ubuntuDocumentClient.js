import axios from 'axios';
import FormData from 'form-data';
import path from 'path';
import fs from 'fs';
import { getPythonServiceUrl, getGatewayApiKey } from '../config/gateway.js';
import { formatGatewayError } from '../utils/gatewayError.js';

// Extensions supported by the NEW async /process endpoint (all formats)
// Extensions supported by the EXISTING /extract fallback (subset only)
const EXTRACT_FALLBACK_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'doc', 'ppt', 'txt']);

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx',
  'xls', 'xlsx', 'txt', 'csv', 'rtf',
  'html', 'htm', 'png', 'jpg', 'jpeg',
]);



function getAuthHeaders(extra = {}) {
  const headers = { ...extra };
  const apiKey = getGatewayApiKey();
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

/**
 * Validates file extension, presence, and size before sending to Ubuntu AI Server.
 */
function getDocumentFileSize(file) {
  if (Buffer.isBuffer(file?.buffer)) {
    return file.buffer.length;
  }

  if (file?.path && fs.existsSync(file.path)) {
    return fs.statSync(file.path).size;
  }

  return 0;
}

export function validateDocumentFile(file) {
  const fileSize = getDocumentFileSize(file);

  if (!file || fileSize <= 0) {
    throw Object.assign(
      new Error('Uploaded file is empty or missing.'),
      { status: 400 }
    );
  }

  const ext = path.extname(file.originalname || '')
    .replace('.', '')
    .toLowerCase();

  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(ext)) {
    throw Object.assign(
      new Error(`Unsupported file type: .${ext}`),
      { status: 415 }
    );
  }

  return ext;
}
function appendDocumentFile(form, file) {
  const options = {
    filename: file.originalname || 'document',
    contentType: file.mimetype || 'application/octet-stream',
  };

  if (file.path) {
    form.append('file', fs.createReadStream(file.path), {
      ...options,
      knownLength: getDocumentFileSize(file),
    });
    return;
  }

  form.append('file', file.buffer, options);
}
/**
 * Submits a document to the Ubuntu AI Server async processing pipeline.
 * Falls back to the legacy /api/v1/documents/extract endpoint if the new
 * /process service has not been deployed yet (returns 404 or 502/503 on that path).
 * The fallback synthesises a job-compatible response so the caller (courses.js)
 * does not need to change.
 */
export async function submitDocumentJob(file, { title = '', description = '', generateCurriculum = true } = {}) {
  validateDocumentFile(file);
  const serviceUrl = getPythonServiceUrl();
  const form = new FormData();
  appendDocumentFile(form, file);
  form.append('title', String(title || ''));
  form.append('description', String(description || ''));
  form.append('generate_curriculum', String(Boolean(generateCurriculum)));

  try {
    const res = await axios.post(`${serviceUrl}/api/v1/documents/process`, form, {
      headers: { ...form.getHeaders(), ...getAuthHeaders() },
      timeout: 180000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    // If new service is not yet deployed (404) or gateway has no route (502/503 on this specific path),
    // try the existing legacy extract endpoint as a synchronous fallback.
    if (status === 404 || status === 502 || status === 503) {
      console.warn(`[Ubuntu Doc Pipeline] /api/v1/documents/process returned ${status || 'network error'} — trying legacy /extract fallback.`);
      return await _submitViaLegacyExtract(file, { title, description, generateCurriculum });
    }
    // For auth errors (401), validation errors (400, 413, 415) — re-throw immediately.
    throw err;
  }
}

/**
 * Fallback: calls the EXISTING Ubuntu /api/v1/documents/extract endpoint synchronously,
 * then wraps the result into the same job-compatible shape so courses.js background poller
 * receives a pre-completed synthetic job and skips actual polling.
 *
 * Supported file types by the legacy endpoint: pdf, docx, doc, pptx, ppt, txt.
 * For other types it throws a 415 so the caller surfaces a proper error.
 */
async function _submitViaLegacyExtract(file, { title = '', description = '' } = {}) {
  const serviceUrl = getPythonServiceUrl();
  const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();

  if (!EXTRACT_FALLBACK_EXTENSIONS.has(ext)) {
    const err = new Error(
      `The Ubuntu document processing service (port 8094) is not yet deployed. ` +
      `The legacy fallback supports PDF, DOC, DOCX, PPT, PPTX, TXT only. ` +
      `Please deploy ubuntu-document-service on the Ubuntu server to process .${ext} files.`
    );
    err.status = 503;
    throw err;
  }

  const form = new FormData();
  appendDocumentFile(form, file);

  // The legacy extract endpoint is synchronous — call it and wait for the result.
  const extractRes = await axios.post(`${serviceUrl}/api/v1/documents/extract`, form, {
    headers: { ...form.getHeaders(), ...getAuthHeaders() },
    timeout: 180000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const extracted = extractRes.data || {};

  // Normalise legacy response into the shape pollDocumentJobResult expects.
  // Legacy response typically has: { text, pages, slides, metadata }
  const text = extracted.text || extracted.content || '';
  const pages = Array.isArray(extracted.pages) ? extracted.pages : [];
  const slides = Array.isArray(extracted.slides) ? extracted.slides : [];

  // Build minimal curriculum from extracted slides/pages
  const lessons = _buildLessonsFromExtracted({ title, text, pages, slides, ext });

  const syntheticResult = {
    document: {
      text,
      fileType: ext,
      pages,
      slides,
      metadata: extracted.metadata || {},
    },
    curriculum: {
      title,
      description,
      lessons,
      slides,
      pages,
    },
    // Chunks will be generated locally by the background job in courses.js
    // using vectorChunkService once the text is persisted.
    chunks: [],
    embeddings: null,
    embedding_dimensions: 768,
  };

  // Return a synthetic pre-completed job so the poller in courses.js resolves immediately
  // without hitting any /jobs/:id endpoint.
  return {
    job_id: `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'completed',
    _legacyResult: syntheticResult,
    _isLegacy: true,
  };
}

/**
 * Builds a simple lesson list from legacy extracted content (no Qwen/Ollama available here).
 */
function _buildLessonsFromExtracted({ title, text, pages, slides, ext }) {
  if (slides && slides.length > 0) {
    return slides.map((s, i) => ({
      order: i + 1,
      title: s.title || s.heading || `Slide ${i + 1}`,
      content: s.text || s.content || '',
      slideNumber: s.slideNumber || i + 1,
      duration: '05:00',
    }));
  }
  if (pages && pages.length > 0) {
    return pages.map((p, i) => ({
      order: i + 1,
      title: p.heading || p.title || `Page ${i + 1}`,
      content: p.text || p.content || '',
      pageNumber: p.pageNumber || i + 1,
      duration: '05:00',
    }));
  }
  // Plain text — split into ~1500-char lessons
  const words = text.split(/\s+/).filter(Boolean);
  const lessons = [];
  const WORDS_PER_LESSON = 300;
  for (let i = 0; i < words.length; i += WORDS_PER_LESSON) {
    const chunk = words.slice(i, i + WORDS_PER_LESSON).join(' ');
    lessons.push({
      order: lessons.length + 1,
      title: `${title} — Part ${lessons.length + 1}`,
      content: chunk,
      duration: '05:00',
    });
  }
  return lessons;
}

/**
 * Polls Ubuntu job status until completed or failed, then fetches the full result.
 * If the job was submitted via the legacy fallback (_isLegacy=true), returns the
 * synthetic result immediately without hitting the /jobs endpoint.
 */
export async function pollDocumentJobResult(jobId, { timeoutMs = 240000, pollIntervalMs = 2000 } = {}, _legacyResult = null) {
  // Legacy fallback: synthetic result was pre-computed by _submitViaLegacyExtract
  if (_legacyResult) {
    return _legacyResult;
  }
  const serviceUrl = getPythonServiceUrl();
  const deadline = Date.now() + timeoutMs;
  let transientErrors = 0;

  while (Date.now() < deadline) {
    try {
      const statusRes = await axios.get(`${serviceUrl}/api/v1/documents/jobs/${encodeURIComponent(jobId)}`, {
        headers: getAuthHeaders(),
        timeout: 15000,
      });
      transientErrors = 0;
      const job = statusRes.data;

      if (job.status === 'completed') {
        const resultRes = await axios.get(`${serviceUrl}/api/v1/documents/jobs/${encodeURIComponent(jobId)}/result`, {
          headers: getAuthHeaders(),
          timeout: 30000,
        });
        return resultRes.data;
      }

      if (job.status === 'failed') {
        const err = new Error(job.error || 'Ubuntu document processing failed.');
        err.status = 422;
        throw err;
      }
    } catch (err) {
      if (err.status === 422 || err.response?.status === 401 || err.response?.status === 404) {
        throw err;
      }
      transientErrors += 1;
      if (transientErrors >= 5) {
        throw new Error(`Ubuntu document job polling failed: ${formatGatewayError(err)}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const err = new Error('Document processing timed out on Ubuntu AI server.');
  err.status = 504;
  throw err;
}

/**
 * End-to-end centralized document processing on Ubuntu AI Server.
 */
export async function processDocumentOnUbuntu(file, options = {}) {
  const job = await submitDocumentJob(file, options);
  // If the legacy fallback was used, the result is already embedded in the job object.
  if (job._isLegacy) {
    return job._legacyResult;
  }
  return await pollDocumentJobResult(job.job_id, options);
}

export default {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  validateDocumentFile,
  submitDocumentJob,
  pollDocumentJobResult,
  processDocumentOnUbuntu,
};
