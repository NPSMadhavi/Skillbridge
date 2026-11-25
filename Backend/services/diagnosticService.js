import axios from 'axios';
import prisma from '../config/prisma.js';
import masterPrisma from '../config/masterPrisma.js';
import aiService from './aiService.js';
import { getJwtValidationStatus } from '../config/jwtConfig.js';
import {
  getChatGatewayUrl,
  getPythonServiceUrl,
  getFaceServiceUrl,
  getSttServiceUrl,
  getTtsServiceUrl,
  getDocServiceUrl,
  getEmbeddingServiceUrl,
  getGatewayHeaders,
  getGatewayApiKey,
} from '../config/gateway.js';

/**
 * Probes an HTTP endpoint and returns structured connectivity diagnostic status.
 * Distinguishes:
 * - Connected
 * - Disconnected
 * - Configuration missing
 * - Authentication failed
 * - Timeout
 */
async function probeEndpoint(url, path, { acceptedStatuses = [200], timeout = 4000 } = {}) {
  if (!url) {
    return { status: 'CONFIG_MISSING', message: 'URL not configured' };
  }

  const headers = getGatewayHeaders();
  const target = `${url}${path}`;

  try {
    const res = await axios.get(target, {
      headers,
      timeout,
      validateStatus: () => true, // Don't throw on 4xx/5xx so we can inspect the exact code
    });

    if (res.status === 401 || res.status === 403) {
      return { status: 'AUTH_FAILED', message: `Authentication failed (HTTP ${res.status})` };
    }

    if (acceptedStatuses.includes(res.status)) {
      return { status: 'CONNECTED', message: 'Connected', data: res.data, statusCode: res.status };
    }

    if (res.status === 404) {
      return { status: 'NOT_FOUND', message: `Endpoint not found (HTTP 404)` };
    }

    return { status: 'UNEXPECTED', message: `HTTP ${res.status}`, data: res.data };
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return { status: 'TIMEOUT', message: `Timeout (>${timeout}ms)` };
    }
    if (err.code === 'ECONNREFUSED') {
      return { status: 'DISCONNECTED', message: 'Connection refused' };
    }
    if (err.code === 'ENOTFOUND') {
      return { status: 'DISCONNECTED', message: 'Host not found' };
    }
    return { status: 'ERROR', message: err.message || 'Unknown network error' };
  }
}

/**
 * Runs end-to-end diagnostics on all SkillBridge backend subsystems.
 */
export async function runStartupDiagnostics({ port = 5000, isProduction = false } = {}) {
  const envName = process.env.NODE_ENV || (isProduction ? 'production' : 'development');
  const frontendUrl = process.env.FRONTEND_URL || (isProduction ? 'https://brutallyhired.com/' : 'http://localhost:5173');
  const backendUrl = isProduction ? 'https://brutallyhired.com' : `http://localhost:${port}`;
  const hasApiKey = Boolean(getGatewayApiKey());

  // 1. Database Check
  let dbStatus = { status: 'UNKNOWN', message: 'Checking...' };
  try {
    await prisma.$queryRaw`SELECT 1`;
    let masterOk = false;
    try {
      await masterPrisma.$queryRaw`SELECT 1`;
      masterOk = true;
    } catch (_) {}
    dbStatus = {
      status: 'CONNECTED',
      message: masterOk ? 'Connected (Master + Tenant DB)' : 'Connected (Tenant DB)'
    };
  } catch (dbErr) {
    dbStatus = {
      status: 'DISCONNECTED',
      message: dbErr.message?.slice(0, 50) || 'Database connection error'
    };
  }

  // 2. JWT Configuration Validation
  const jwtValidation = getJwtValidationStatus();
  let jwtDisplay = jwtValidation.message;
  if (jwtValidation.status === 'STRONG_PRODUCTION') {
    jwtDisplay = 'Validated (256-bit strong production secret)';
  } else if (jwtValidation.status === 'STRONG_DEVELOPMENT') {
    jwtDisplay = 'Validated (256-bit strong development secret)';
  } else if (jwtValidation.status === 'DEV_DEFAULT') {
    jwtDisplay = 'Active (Development fallback key)';
  }

  // 3. Central LLM Gateway & Model Detection
  let llmStatus = { status: 'UNKNOWN', message: 'Checking...' };
  try {
    const health = await aiService.checkGatewayHealth();
    llmStatus = {
      status: 'CONNECTED',
      message: `Connected (${health.modelDetails || health.model || 'qwen3.5:9b'})`
    };
  } catch (llmErr) {
    if (llmErr.statusCode === 401 || llmErr.status === 401) {
      llmStatus = { status: 'AUTH_FAILED', message: 'Authentication failed (Invalid API key)' };
    } else if (llmErr.code === 'ECONNREFUSED' || llmErr.message?.includes('refused')) {
      llmStatus = { status: 'DISCONNECTED', message: 'Connection refused' };
    } else if (llmErr.message?.includes('timeout')) {
      llmStatus = { status: 'TIMEOUT', message: 'Timeout (>8s)' };
    } else {
      llmStatus = { status: 'ERROR', message: llmErr.message?.slice(0, 45) || 'Gateway offline' };
    }
  }

  // 4. Face Recognition Service
  const faceUrl = getFaceServiceUrl();
  const faceProbe = await probeEndpoint(faceUrl, '/api/v1/face/detect', { acceptedStatuses: [200, 400, 405] });
  let faceDisplay = faceProbe.message;
  if (faceProbe.status === 'CONNECTED') {
    faceDisplay = 'Connected (YuNet + SFace 128-d)';
  }

  // 5. STT (Speech-to-Text) Service
  const sttUrl = getSttServiceUrl();
  const sttProbe = await probeEndpoint(sttUrl, '/api/v1/stt/transcribe', { acceptedStatuses: [200, 400, 405] });
  let sttDisplay = sttProbe.message;
  if (sttProbe.status === 'CONNECTED') {
    sttDisplay = 'Connected (FastAPI STT / Whisper)';
  }

  // 6. TTS (Text-to-Speech) Service
  const ttsUrl = getTtsServiceUrl();
  const ttsProbe = await probeEndpoint(ttsUrl, '/api/v1/tts/voices', { acceptedStatuses: [200] });
  let ttsDisplay = ttsProbe.message;
  if (ttsProbe.status === 'CONNECTED') {
    const count = ttsProbe.data?.count || (Array.isArray(ttsProbe.data?.voices) ? ttsProbe.data.voices.length : 6);
    ttsDisplay = `Connected (${count} voices available)`;
  }

  // 7. Document / OCR Service
  const docUrl = getDocServiceUrl();
  const docAsyncProbe = await probeEndpoint(docUrl, '/api/v1/documents/process', { acceptedStatuses: [200, 400, 405] });
  let docDisplay = docAsyncProbe.message;
  if (docAsyncProbe.status === 'CONNECTED') {
    docDisplay = 'Connected (Async Job Pipeline)';
  } else {
    const docSyncProbe = await probeEndpoint(docUrl, '/api/v1/documents/extract', { acceptedStatuses: [200, 400, 405] });
    if (docSyncProbe.status === 'CONNECTED') {
      docDisplay = 'Connected (Sync Gateway Fallback)';
    }
  }

  // 8. Embeddings Service
  const embedUrl = getEmbeddingServiceUrl();
  const embedProbe = await probeEndpoint(embedUrl, '/api/v1/embeddings', { acceptedStatuses: [200, 400, 405] });
  let embedDisplay = embedProbe.message;
  if (embedProbe.status === 'CONNECTED') {
    embedDisplay = 'Connected (BAAI/bge-m3 768-d)';
  }

  // Pretty Console Output
  const pad = (str, len = 24) => str.padEnd(len, ' ');
  console.log('================================================================');
  console.log(` SKILLBRIDGE SYSTEM STARTUP DIAGNOSTICS [${envName.toUpperCase()}]`);
  console.log('================================================================');
  console.log(` ${pad('Environment:')} ${envName}`);
  console.log(` ${pad('Backend URL:')} ${backendUrl}`);
  console.log(` ${pad('Frontend URL:')} ${frontendUrl}`);
  console.log(` ${pad('Gateway API Key:')} ${hasApiKey ? 'Configured (Hidden)' : 'Missing'}`);
  console.log('----------------------------------------------------------------');
  console.log(` ${pad('Database:')} ${dbStatus.status === 'CONNECTED' ? '✓' : '✗'} ${dbStatus.message}`);
  console.log(` ${pad('JWT Secret:')} ${jwtValidation.valid ? '✓' : '⚠'} ${jwtDisplay}`);
  console.log(` ${pad('LLM Gateway:')} ${llmStatus.status === 'CONNECTED' ? '✓' : '✗'} ${llmStatus.message}`);
  console.log(` ${pad('Face Recognition:')} ${faceProbe.status === 'CONNECTED' ? '✓' : '✗'} ${faceDisplay}`);
  console.log(` ${pad('Speech-to-Text:')} ${sttProbe.status === 'CONNECTED' ? '✓' : '✗'} ${sttDisplay}`);
  console.log(` ${pad('Text-to-Speech:')} ${ttsProbe.status === 'CONNECTED' ? '✓' : '✗'} ${ttsDisplay}`);
  console.log(` ${pad('Document / OCR:')} ${docDisplay.startsWith('Connected') ? '✓' : '✗'} ${docDisplay}`);
  console.log(` ${pad('Embeddings:')} ${embedProbe.status === 'CONNECTED' ? '✓' : '✗'} ${embedDisplay}`);
  console.log('================================================================\n');

  return {
    environment: envName,
    backendUrl,
    frontendUrl,
    database: dbStatus,
    jwt: jwtValidation,
    llmGateway: llmStatus,
    face: faceProbe,
    stt: sttProbe,
    tts: ttsProbe,
    document: docDisplay,
    embeddings: embedProbe
  };
}

export default {
  runStartupDiagnostics
};
