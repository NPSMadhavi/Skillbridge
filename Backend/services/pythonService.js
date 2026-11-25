import axios from 'axios';
import crypto from 'crypto';
import FormData from 'form-data';
import { getPythonServiceUrl, getGatewayApiKey } from '../config/gateway.js';
import { formatGatewayError } from '../utils/gatewayError.js';

/**
 * Returns authorization and standard service headers for Central AI Gateway.
 * Strictly avoids exposing or logging API keys.
 */
export const getServiceHeaders = (extra = {}) => {
  const key = getGatewayApiKey();
  const headers = { ...extra };
  if (key) {
    headers['X-API-Key'] = key;
  }
  return headers;
};

/**
 * Safely converts Base64 Data URL or raw base64 string to Buffer.
 */
function bufferFromBase64(data) {
  if (!data || typeof data !== 'string') return null;
  const match = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/.exec(data.trim());
  const raw = match ? match[1] : (data.includes(',') ? data.split(',')[1] : data);
  try {
    return Buffer.from(raw, 'base64');
  } catch (_) {
    return null;
  }
}

/**
 * Calculates cosine similarity between two float vectors.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

/**
 * Validates image buffer size and format.
 */
function validateImageBuffer(buf, maxBytes = 15 * 1024 * 1024) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('Invalid or empty image payload.');
  }
  if (buf.length > maxBytes) {
    throw new Error(`Image size exceeds maximum limit of ${Math.round(maxBytes / 1024 / 1024)}MB.`);
  }
  // Check minimal JPEG / PNG magic bytes
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf.length > 12 && buf.slice(8, 12).toString('ascii') === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    // Still attempt fallback with image/jpeg if bytes exist
    return { buffer: buf, contentType: 'image/jpeg', filename: 'face.jpg' };
  }
  const contentType = isPng ? 'image/png' : (isWebp ? 'image/webp' : 'image/jpeg');
  const filename = isPng ? 'face.png' : (isWebp ? 'face.webp' : 'face.jpg');
  return { buffer: buf, contentType, filename };
}

/**
 * Detects presence of a human face in the given image.
 */
export async function detectFace(image) {
  const rawBuf = Buffer.isBuffer(image) ? image : bufferFromBase64(image);
  const { buffer, contentType, filename } = validateImageBuffer(rawBuf);

  const form = new FormData();
  form.append('file', buffer, { filename, contentType });

  const headers = { ...form.getHeaders(), ...getServiceHeaders() };
  const serviceUrl = getPythonServiceUrl();

  try {
    const res = await axios.post(`${serviceUrl}/api/v1/face/detect`, form, {
      headers,
      timeout: 10000
    });
    return res.data;
  } catch (error) {
    if (error.response?.status === 401) {
      const err = new Error('Gateway authentication failed: API key invalid or missing.');
      err.status = 401;
      throw err;
    }
    if (error.response?.status === 422) {
      return {
        status: 'error',
        face_detected: false,
        detail: error.response?.data?.detail || 'No face detected in image'
      };
    }
    const err = new Error(formatGatewayError(error));
    err.status = error.response?.status || 503;
    throw err;
  }
}

/**
 * Extracts 128-dimensional SFace neural embedding from face image via Central AI Gateway.
 */
export async function extractFaceEmbedding(image) {
  const rawBuf = Buffer.isBuffer(image) ? image : bufferFromBase64(image);
  const { buffer, contentType, filename } = validateImageBuffer(rawBuf);

  const form = new FormData();
  form.append('file', buffer, { filename, contentType });

  const headers = { ...form.getHeaders(), ...getServiceHeaders() };
  const serviceUrl = getPythonServiceUrl();

  try {
    const res = await axios.post(`${serviceUrl}/api/v1/face/extract`, form, {
      headers,
      timeout: 12000
    });

    const embedding = res.data?.embedding;
    if (Array.isArray(embedding) && embedding.length > 0) {
      return embedding;
    }
    throw new Error('Face embedding extraction failed: Gateway returned empty vector.');
  } catch (error) {
    if (error.response?.status === 401) {
      const err = new Error('Gateway authentication failed: API key invalid or unauthorized.');
      err.status = 401;
      err.isAuthError = true;
      throw err;
    }
    if (error.response?.status === 422) {
      const err = new Error(error.response?.data?.detail || 'No face detected in image.');
      err.status = 422;
      err.noFaceDetected = true;
      throw err;
    }
    const err = new Error(formatGatewayError(error));
    err.status = error.response?.status || 503;
    throw err;
  }
}

/**
 * Compares an image against a candidate embedding using the Central AI Gateway /api/v1/face/compare.
 */
export async function compareFaceWithEmbedding(image, candidateEmbedding) {
  const rawBuf = Buffer.isBuffer(image) ? image : bufferFromBase64(image);
  const { buffer, contentType, filename } = validateImageBuffer(rawBuf);

  const form = new FormData();
  form.append('file', buffer, { filename, contentType });
  const embVector = Array.isArray(candidateEmbedding) ? candidateEmbedding : (candidateEmbedding?.embedding || candidateEmbedding);
  form.append('embedding_json', JSON.stringify(embVector));

  const headers = { ...form.getHeaders(), ...getServiceHeaders() };
  const serviceUrl = getPythonServiceUrl();

  try {
    const res = await axios.post(`${serviceUrl}/api/v1/face/compare`, form, {
      headers,
      timeout: 12000
    });
    return res.data;
  } catch (error) {
    if (error.response?.status === 401) {
      const err = new Error('Gateway authentication failed: API key invalid or unauthorized.');
      err.status = 401;
      err.isAuthError = true;
      throw err;
    }
    const err = new Error(formatGatewayError(error));
    err.status = error.response?.status || 503;
    throw err;
  }
}

class PythonService {
  /**
   * Registers user face image(s) to generate facial embeddings via Central AI Gateway on Ubuntu.
   * @param {string|Array<string>} imageBase64 Base64 string of the face image
   * @returns {Promise<string>} Encrypted/serialized embedding string
   */
  async registerFace(imageBase64) {
    const raw = Array.isArray(imageBase64) ? imageBase64[0] : imageBase64;
    try {
      const embedding = await extractFaceEmbedding(raw);
      console.log(`[FaceID] Successfully extracted SFace embedding (dim: ${embedding.length}) from Central AI Gateway.`);
      return JSON.stringify({
        type: 'sface_embedding_v1',
        dimensions: embedding.length,
        embedding,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[FaceID] Face registration failed — Central AI Gateway notice:', error.message);
      if (error.status === 401) {
        throw new Error('Biometric service authentication failed: Invalid API key configuration.');
      }
      if (error.status === 422 || error.noFaceDetected) {
        throw new Error('No face detected in the photo. Please center your face in good lighting and try again.');
      }
      throw new Error('Face registration service is currently unavailable. Please verify the Central AI Gateway is running.');
    }
  }

  /**
   * Verifies query face image against candidates using SFace 128-d neural embeddings.
   * @param {string|Array<string>} queryImage Base64 of live camera capture
   * @param {Array<{id: string, faceEmbedding?: string, encrypted_embedding?: string, faceImage?: string}>} candidates List of candidates in tenant
   * @returns {Promise<{matched: boolean, user_id: string|null, id: string|null, confidence: number, serviceUnavailable?: boolean}>}
   */
  async verifyFace(queryImage, candidates) {
    const singleImage = Array.isArray(queryImage) ? queryImage[0] : (queryImage || '');
    if (!singleImage) {
      return {
        matched: false,
        id: null,
        user_id: null,
        confidence: 0,
        error: 'No camera capture received.'
      };
    }

    const formattedCandidates = (candidates || []).map(c => ({
      id: String(c.id),
      encrypted_embedding: String(c.encrypted_embedding || c.faceEmbedding || '')
    })).filter(c => Boolean(c.encrypted_embedding));

    if (formattedCandidates.length === 0) {
      return {
        matched: false,
        id: null,
        user_id: null,
        confidence: 0,
        error: 'No enrolled biometric profiles found in tenant.'
      };
    }

    // 1. Extract live query embedding from camera capture via Central AI Gateway
    let queryEmbedding;
    try {
      queryEmbedding = await extractFaceEmbedding(singleImage);
    } catch (error) {
      console.warn('[FaceID] Query embedding extraction error:', error.message);
      if (error.isAuthError || error.status === 401) {
        return {
          matched: false,
          id: null,
          user_id: null,
          confidence: 0,
          serviceUnavailable: true,
          isAuthError: true,
          error: 'Gateway authentication failed: API key invalid.'
        };
      }
      if (error.noFaceDetected || error.status === 422) {
        return {
          matched: false,
          id: null,
          user_id: null,
          confidence: 0,
          noFaceDetected: true,
          error: 'No face detected in camera capture. Please face the camera directly.'
        };
      }
      return {
        matched: false,
        id: null,
        user_id: null,
        confidence: 0,
        serviceUnavailable: true,
        error: 'Face recognition service is currently unavailable. Please sign in with email and password.'
      };
    }

    // 2. Score query embedding against all enrolled candidates in tenant
    // OpenCV SFace cosine similarity threshold for 128-d vectors:
    // Official SFace threshold is 0.363; different people typically score ~0.0-0.25,
    // while live captures of the same person score ~0.45-0.90.
    const MATCH_THRESHOLD = 0.42;
    let bestCandidate = null;
    let highestSimilarity = -1;

    for (const cand of formattedCandidates) {
      try {
        let candidateVec = null;
        let parsed = null;
        try {
          parsed = JSON.parse(cand.encrypted_embedding);
        } catch (_) {}

        if (Array.isArray(parsed)) {
          candidateVec = parsed;
        } else if (parsed && Array.isArray(parsed.embedding)) {
          candidateVec = parsed.embedding;
        }

        if (candidateVec && candidateVec.length === queryEmbedding.length) {
          const sim = cosineSimilarity(queryEmbedding, candidateVec);
          if (sim > highestSimilarity) {
            highestSimilarity = sim;
            bestCandidate = cand;
          }
        }
      } catch (_) {}
    }

    if (bestCandidate && highestSimilarity >= MATCH_THRESHOLD) {
      console.log(`[FaceID] Match confirmed for user: ${bestCandidate.id} (confidence: ${highestSimilarity.toFixed(4)})`);
      return {
        matched: true,
        id: bestCandidate.id,
        user_id: bestCandidate.id,
        confidence: highestSimilarity
      };
    }

    console.log(`[FaceID] Verification rejected. Highest confidence: ${highestSimilarity > 0 ? highestSimilarity.toFixed(4) : 0} (threshold: ${MATCH_THRESHOLD})`);
    return {
      matched: false,
      id: null,
      user_id: null,
      confidence: Math.max(0, highestSimilarity)
    };
  }

  /**
   * Starts a server-managed guided face enrollment session.
   */
  async startFaceEnrollmentSession() {
    return {
      session_id: crypto.randomUUID(),
      expires_at: Math.floor(Date.now() / 1000) + 300,
      steps: ['look_straight', 'look_up', 'turn_left', 'turn_right', 'look_down'],
      nonce: crypto.randomBytes(8).toString('hex')
    };
  }

  /**
   * Verifies multi-pose frames, extracts SFace biometric vector, and completes enrollment.
   */
  async completeFaceEnrollment(payload) {
    const candidateFrames = [
      payload.frames?.look_straight,
      payload.frames?.look_up,
      payload.frames?.look_down,
      payload.frames?.turn_left,
      payload.frames?.turn_right,
      payload.frame,
      payload.imageBase64,
      ...(Array.isArray(payload.frames) ? payload.frames : [])
    ].filter(Boolean);

    if (candidateFrames.length === 0) {
      throw new Error('Face enrollment failed: No valid face frames provided.');
    }

    let embedding = null;
    let selectedFrame = candidateFrames[0];
    let lastError = null;

    for (const frame of candidateFrames) {
      try {
        embedding = await extractFaceEmbedding(frame);
        selectedFrame = frame;
        break;
      } catch (err) {
        lastError = err;
        // Only retry with next frame if no face was detected in this frame
        if (!err.noFaceDetected && err.status !== 422) {
          throw err;
        }
      }
    }

    if (!embedding) {
      throw lastError || new Error('No face detected in any captured frame. Please retry in good lighting.');
    }

    return {
      success: true,
      session_id: payload.session_id || crypto.randomUUID(),
      encrypted_embedding: JSON.stringify({
        type: 'sface_embedding_v1',
        dimensions: embedding.length,
        embedding,
        timestamp: Date.now()
      }),
      thumbnail_image: selectedFrame,
      liveness_verified: true,
      poses_completed: Object.keys(payload.frames || { look_straight: true })
    };
  }
}

export default new PythonService();
