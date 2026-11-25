import axios from 'axios';
import FormData from 'form-data';
import path from 'path';
import { getPythonServiceUrl, getGatewayApiKey } from '../config/gateway.js';
import { formatGatewayError } from '../utils/gatewayError.js';

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx',
  'xls', 'xlsx', 'txt', 'csv', 'rtf',
  'html', 'htm', 'png', 'jpg', 'jpeg',
]);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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
export function validateDocumentFile(file) {
  if (!file || !file.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    const err = new Error('Uploaded file is empty or missing.');
    err.status = 400;
    throw err;
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    const err = new Error('Uploaded file exceeds maximum 100 MB limit.');
    err.status = 413;
    throw err;
  }
  const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(ext)) {
    const err = new Error(
      `Unsupported file format ".${ext || 'unknown'}". Supported formats: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, CSV, RTF, HTML, PNG, JPG, JPEG.`
    );
    err.status = 415;
    throw err;
  }
  return ext;
}

/**
 * Submits a document to the Ubuntu AI Server async processing pipeline.
 */
export async function submitDocumentJob(file, { title = '', description = '', generateCurriculum = true } = {}) {
  validateDocumentFile(file);
  const serviceUrl = getPythonServiceUrl();
  const form = new FormData();
  form.append('file', file.buffer, {
    filename: file.originalname || 'document',
    contentType: file.mimetype || 'application/octet-stream',
  });
  form.append('title', String(title || ''));
  form.append('description', String(description || ''));
  form.append('generate_curriculum', String(Boolean(generateCurriculum)));

  const res = await axios.post(`${serviceUrl}/api/v1/documents/process`, form, {
    headers: { ...form.getHeaders(), ...getAuthHeaders() },
    timeout: 60000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return res.data;
}

/**
 * Polls Ubuntu job status until completed or failed, then fetches the full result.
 */
export async function pollDocumentJobResult(jobId, { timeoutMs = 240000, pollIntervalMs = 2000 } = {}) {
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
  return await pollDocumentJobResult(job.job_id, options);
}

export default {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  validateDocumentFile,
  submitDocumentJob,
  pollDocumentJobResult,
  processDocumentOnUbuntu,
};
