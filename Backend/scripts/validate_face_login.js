import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import pythonService, { detectFace, extractFaceEmbedding, compareFaceWithEmbedding } from '../services/pythonService.js';
import { getGatewayApiKey, getPythonServiceUrl } from '../config/gateway.js';
import { faceLogin } from '../controllers/authController.js';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details}`);
    failed++;
  }
}

async function runFaceValidationTests() {
  console.log('====================================================');
  console.log('FACE LOGIN & AI GATEWAY BIOMETRIC VERIFICATION SUITE');
  console.log('====================================================');

  const sampleFacePath = 'C:/Users/premsai/.gemini/antigravity/brain/33e17d18-aec8-4032-a421-116e36a2b72f/.user_uploaded/media_1795149416853_7c0c0916.jpg';
  const differentFacePath = 'C:/Users/premsai/.gemini/antigravity/brain/33e17d18-aec8-4032-a421-116e36a2b72f/.user_uploaded/media_1795491228387_a3626016.jpg';

  if (!fs.existsSync(sampleFacePath) || !fs.existsSync(differentFacePath)) {
    console.error('Test images not found in artifact directory.');
    process.exit(1);
  }

  const sampleFaceBuffer = fs.readFileSync(sampleFacePath);
  const differentFaceBuffer = fs.readFileSync(differentFacePath);
  const sampleFaceBase64 = `data:image/jpeg;base64,${sampleFaceBuffer.toString('base64')}`;
  const differentFaceBase64 = `data:image/jpeg;base64,${differentFaceBuffer.toString('base64')}`;

  const serviceUrl = getPythonServiceUrl();
  const validApiKey = getGatewayApiKey();

  // --- 1. Gateway Authentication & API Key Enforcement ---
  console.log('\n--- 1. Gateway Authentication (X-API-Key) ---');
  
  // A. Valid API Key Check
  try {
    const form = new FormData();
    form.append('file', sampleFaceBuffer, { filename: 'face.jpg', contentType: 'image/jpeg' });
    const authRes = await axios.post(`${serviceUrl}/api/v1/face/detect`, form, {
      headers: { ...form.getHeaders(), 'X-API-Key': validApiKey },
      timeout: 10000
    });
    assert(authRes.status === 200, 'Gateway accepts valid X-API-Key from environment');
  } catch (err) {
    assert(false, 'Gateway accepts valid X-API-Key', err.message);
  }

  // B. Invalid API Key Check (Must return 401)
  let rejectedWith401 = false;
  try {
    const formInvalid = new FormData();
    formInvalid.append('file', sampleFaceBuffer, { filename: 'face.jpg', contentType: 'image/jpeg' });
    await axios.post(`${serviceUrl}/api/v1/face/detect`, formInvalid, {
      headers: { ...formInvalid.getHeaders(), 'X-API-Key': 'invalid_test_key_12345' },
      timeout: 10000
    });
  } catch (err) {
    if (err.response?.status === 401) {
      rejectedWith401 = true;
    }
  }
  assert(rejectedWith401, 'Gateway rejects unauthorized requests with HTTP 401 when X-API-Key is invalid');

  // --- 2. Face Detection ---
  console.log('\n--- 2. Face Detection via Gateway ---');
  try {
    const detectResult = await detectFace(sampleFaceBuffer);
    assert(
      detectResult.status === 'success' && detectResult.face_detected === true && detectResult.detection_score > 0.9,
      `Face detection succeeds with score ${(detectResult.detection_score * 100).toFixed(1)}%`
    );
  } catch (err) {
    assert(false, 'Face detection via gateway', err.message);
  }

  // --- 3. Face Embedding Extraction ---
  console.log('\n--- 3. Face Embedding Extraction (SFace 128-d) ---');
  let extractedEmbedding = null;
  try {
    extractedEmbedding = await extractFaceEmbedding(sampleFaceBuffer);
    assert(
      Array.isArray(extractedEmbedding) && extractedEmbedding.length === 128,
      `SFace neural embedding extracted with 128 dimensions (dim: ${extractedEmbedding?.length})`
    );
  } catch (err) {
    assert(false, 'Face embedding extraction', err.message);
  }

  // --- 4. Face Comparison & Anti-Spoofing Calibration ---
  console.log('\n--- 4. Face Comparison & Verification ---');
  try {
    // Compare same face
    const compareSelf = await compareFaceWithEmbedding(sampleFaceBuffer, extractedEmbedding);
    assert(
      compareSelf.status === 'success' && compareSelf.similarity_score >= 0.98,
      `Same person verification produces high similarity (${compareSelf.similarity_score.toFixed(4)})`
    );

    // Compare different face
    const compareDifferent = await compareFaceWithEmbedding(differentFaceBuffer, extractedEmbedding);
    assert(
      compareDifferent.status === 'success' && compareDifferent.similarity_score < compareSelf.similarity_score,
      `Different persons are distinctly differentiated (score: ${compareDifferent.similarity_score.toFixed(4)} vs ${compareSelf.similarity_score.toFixed(4)})`
    );
  } catch (err) {
    assert(false, 'Face comparison', err.message);
  }

  // --- 5. Candidate Verification in pythonService.verifyFace ---
  console.log('\n--- 5. Candidate Verification (verifyFace) ---');
  try {
    const candidates = [
      {
        id: 'user-matched-1',
        encrypted_embedding: JSON.stringify({ type: 'sface_embedding_v1', dimensions: 128, embedding: extractedEmbedding })
      },
      {
        id: 'user-other-2',
        encrypted_embedding: JSON.stringify({ type: 'sface_embedding_v1', dimensions: 128, embedding: new Array(128).fill(0.05) })
      }
    ];

    const verifyMatch = await pythonService.verifyFace(sampleFaceBase64, candidates);
    assert(
      verifyMatch.matched === true && verifyMatch.id === 'user-matched-1',
      `verifyFace identifies the correct enrolled user (${verifyMatch.id}, confidence: ${verifyMatch.confidence?.toFixed(4)})`
    );

    // Verify non-enrolled person is rejected
    const nonMatchingCandidates = [
      {
        id: 'user-other-2',
        encrypted_embedding: JSON.stringify({ type: 'sface_embedding_v1', dimensions: 128, embedding: new Array(128).fill(0.01) })
      }
    ];
    const verifyMismatch = await pythonService.verifyFace(sampleFaceBase64, nonMatchingCandidates);
    assert(
      verifyMismatch.matched === false && verifyMismatch.user_id === null,
      'verifyFace safely rejects non-matching candidates'
    );
  } catch (err) {
    assert(false, 'Candidate verification in verifyFace', err.message);
  }

  // --- 6. End-to-End Face Login Controller ---
  console.log('\n--- 6. Face Login Controller End-to-End ---');
  try {
    const mockUser = {
      id: 'student-uuid-1',
      email: 'student@tenant-a.com',
      fullName: 'John Doe',
      finNumber: 'S1234567A',
      preferredLanguage: 'en',
      country: 'Singapore',
      status: 'ACTIVE',
      role: 'STUDENT',
      faceEmbedding: JSON.stringify({ type: 'sface_embedding_v1', dimensions: 128, embedding: extractedEmbedding })
    };

    let loginResponseCode = null;
    let loginResponseBody = null;

    const mockReq = {
      body: { faceIdData: sampleFaceBase64 },
      tenantCode: 'tenant_alpha',
      prisma: {
        user: {
          findMany: async () => [{ id: mockUser.id, faceEmbedding: mockUser.faceEmbedding }],
          findUnique: async ({ where }) => (where.id === mockUser.id ? mockUser : null)
        }
      }
    };

    const mockRes = {
      status: (code) => {
        loginResponseCode = code;
        return {
          json: (data) => { loginResponseBody = data; }
        };
      },
      json: (data) => {
        loginResponseCode = 200;
        loginResponseBody = data;
      }
    };

    await faceLogin(mockReq, mockRes);

    assert(
      loginResponseCode === 200 && loginResponseBody?.token && loginResponseBody?.tenantCode === 'tenant_alpha',
      'faceLogin issues valid JWT bound strictly to the user tenant on biometric match'
    );
  } catch (err) {
    assert(false, 'Face login controller end-to-end', err.message);
  }

  // --- 7. Biometric Fail-Safe When Gateway Unreachable ---
  console.log('\n--- 7. Biometric Fail-Safe Verification ---');
  try {
    const origUrl = process.env.PYTHON_SERVICE_URL;
    process.env.PYTHON_SERVICE_URL = 'http://127.0.0.1:59998'; // Dead service

    const deadServiceResult = await pythonService.verifyFace(sampleFaceBase64, [{ id: 'user-1', encrypted_embedding: '[]' }]);
    process.env.PYTHON_SERVICE_URL = origUrl;

    assert(
      deadServiceResult.matched === false && deadServiceResult.serviceUnavailable === true,
      'When AI Gateway is offline, verifyFace reports safe failure (matched: false, serviceUnavailable: true)'
    );
  } catch (err) {
    assert(false, 'Biometric fail-safe check', err.message);
  }

  console.log('\n====================================================');
  console.log(`FACE VALIDATION TESTS COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runFaceValidationTests().catch(e => {
  console.error('Fatal error in face validation tests:', e);
  process.exit(1);
});
