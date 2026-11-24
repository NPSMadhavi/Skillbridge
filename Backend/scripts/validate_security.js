import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwtConfig.js';
import { authenticateToken } from '../middleware/auth.js';
import { resolveTenant } from '../middleware/tenantMiddleware.js';
import { authRateLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';
import pythonService from '../services/pythonService.js';
import tenantService from '../services/tenantService.js';
import prisma from '../config/prisma.js';

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

async function runSecurityTests() {
  console.log('====================================================');
  console.log('1. SECURITY TESTING SUITE');
  console.log('====================================================');

  // --- 1.1 JWT Signature and Expiration Tests ---
  console.log('\n--- 1.1 JWT Signature, Tampering & Expiration ---');
  
  // A. Valid token
  const validToken = jwt.sign(
    { id: 'user-1', email: 'user@tenant-a.com', role: 'STUDENT', tenantCode: 'tenant_a' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  let decodedUser = null;
  try {
    decodedUser = jwt.verify(validToken, JWT_SECRET);
  } catch (e) {}
  assert(decodedUser && decodedUser.id === 'user-1', 'Valid token verifies successfully');

  // B. Missing token
  let missingTokenStatus = null;
  const mockReqMissing = { headers: {}, method: 'GET' };
  const mockResMissing = {
    status: (code) => { missingTokenStatus = code; return { json: () => {} }; }
  };
  authenticateToken(mockReqMissing, mockResMissing, () => {});
  assert(missingTokenStatus === 401, 'Missing token rejected with 401 Unauthorized');

  // C. Tampered/Invalid signature token
  const tamperedToken = validToken.slice(0, -5) + 'XXXXX';
  let invalidTokenStatus = null;
  const mockReqInvalid = { headers: { authorization: `Bearer ${tamperedToken}` }, method: 'GET' };
  const mockResInvalid = {
    status: (code) => { invalidTokenStatus = code; return { json: () => {} }; }
  };
  authenticateToken(mockReqInvalid, mockResInvalid, () => {});
  assert(invalidTokenStatus === 403, 'Tampered token rejected with 403 Forbidden');

  // D. Expired token
  const expiredToken = jwt.sign(
    { id: 'user-1', email: 'user@tenant-a.com', role: 'STUDENT', tenantCode: 'tenant_a' },
    JWT_SECRET,
    { expiresIn: -10 } // Expired 10 seconds ago
  );
  let expiredTokenStatus = null;
  const mockReqExpired = { headers: { authorization: `Bearer ${expiredToken}` }, method: 'GET' };
  const mockResExpired = {
    status: (code) => { expiredTokenStatus = code; return { json: () => {} }; }
  };
  authenticateToken(mockReqExpired, mockResExpired, () => {});
  assert(expiredTokenStatus === 403, 'Expired token rejected with 403 Forbidden');

  // --- 1.2 Tenant Isolation & Boundary Verification ---
  console.log('\n--- 1.2 Tenant Isolation & Cross-Tenant Boundary ---');

  // A. Tenant A trying to access Tenant B via header
  let boundaryViolationStatus = null;
  let boundaryViolationMessage = '';
  const mockReqCrossTenant = {
    headers: {
      authorization: `Bearer ${validToken}`, // tenantCode: 'tenant_a'
      'x-tenant-id': 'tenant_b'
    },
    query: {},
    body: {},
    path: '/courses'
  };
  const mockResCrossTenant = {
    status: (code) => {
      boundaryViolationStatus = code;
      return {
        json: (data) => { boundaryViolationMessage = data.error; }
      };
    }
  };
  await resolveTenant(mockReqCrossTenant, mockResCrossTenant, () => {});
  assert(
    boundaryViolationStatus === 403 && boundaryViolationMessage.includes('Tenant boundary violation'),
    'Authenticated Tenant A user blocked from accessing Tenant B with 403 Forbidden'
  );

  // B. Invalid tenant resolution must NOT silently fall back to default
  let invalidTenantStatus = null;
  const mockReqNonExistent = {
    headers: { 'x-tenant-id': 'non_existent_company_xyz' },
    query: {},
    body: {},
    path: '/courses'
  };
  const mockResNonExistent = {
    status: (code) => { invalidTenantStatus = code; return { json: () => {} }; }
  };
  await resolveTenant(mockReqNonExistent, mockResNonExistent, () => {});
  assert(
    invalidTenantStatus === 404,
    'Non-existent tenant rejected with 404 and does NOT fall back to default'
  );

  // --- 1.3 Rate Limiting Testing ---
  console.log('\n--- 1.3 Rate Limiting Tests ---');

  let authRateLimitTriggered = false;
  const testIp = '192.168.1.99';
  const dummyRes = {
    setHeader: () => {},
    getHeader: () => {},
    status: (code) => {
      if (code === 429) authRateLimitTriggered = true;
      return { json: () => {}, send: () => {} };
    }
  };

  // Test authRateLimiter (limit is 20)
  for (let i = 0; i < 22; i++) {
    const dummyReq = {
      ip: testIp,
      method: 'POST',
      path: '/api/v1/auth/login',
      headers: { 'x-forwarded-for': testIp },
      get: (h) => (h === 'x-forwarded-for' ? testIp : null),
      app: { get: () => true }
    };
    await new Promise((resolve) => {
      authRateLimiter(dummyReq, dummyRes, () => resolve());
    });
    if (authRateLimitTriggered) break;
  }
  assert(authRateLimitTriggered, 'Auth rate limiter triggers 429 Too Many Requests after threshold');

  // Test passwordResetLimiter (limit is 5)
  let resetRateLimitTriggered = false;
  const testIpReset = '192.168.1.98';
  const dummyResetRes = {
    setHeader: () => {},
    getHeader: () => {},
    status: (code) => {
      if (code === 429) resetRateLimitTriggered = true;
      return { json: () => {}, send: () => {} };
    }
  };
  for (let i = 0; i < 7; i++) {
    const dummyReq = {
      ip: testIpReset,
      method: 'POST',
      path: '/api/v1/admin/forgot-password',
      headers: { 'x-forwarded-for': testIpReset },
      get: (h) => (h === 'x-forwarded-for' ? testIpReset : null),
      app: { get: () => true }
    };
    await new Promise((resolve) => {
      passwordResetLimiter(dummyReq, dummyResetRes, () => resolve());
    });
    if (resetRateLimitTriggered) break;
  }
  assert(resetRateLimitTriggered, 'Password reset rate limiter triggers 429 after 5 requests');

  // --- 1.4 Face Recognition Hardening & Fail-Safe Verification ---
  console.log('\n--- 1.4 Face Recognition Hardening & Fail-Safe ---');

  // A. Verify synthetic hash-based embeddings are completely removed
  let enrollmentFailedSafely = false;
  let enrollmentError = '';
  try {
    // Attempt enrollment with a mock image when Python service URL is pointed to an invalid port
    const originalUrl = process.env.PYTHON_SERVICE_URL;
    process.env.PYTHON_SERVICE_URL = 'http://127.0.0.1:59999'; // Dead service
    await pythonService.completeFaceEnrollment('dummy-user', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    process.env.PYTHON_SERVICE_URL = originalUrl;
  } catch (err) {
    enrollmentFailedSafely = true;
    enrollmentError = err.message;
  }
  assert(
    enrollmentFailedSafely && !enrollmentError.includes('synthetic'),
    'Face enrollment fails safely without generating synthetic hash embeddings when Python service is unavailable'
  );

  // B. Verify liveness is never falsely reported as true on failure
  let verifyFailedSafely = false;
  try {
    const originalUrl = process.env.PYTHON_SERVICE_URL;
    process.env.PYTHON_SERVICE_URL = 'http://127.0.0.1:59999'; // Dead service
    const verifyResult = await pythonService.verifyFace('data:image/jpeg;base64,/9j/4AAQSkZJRg==', [{ id: 'cand-1', encrypted_embedding: '[]' }]);
    process.env.PYTHON_SERVICE_URL = originalUrl;
    if (verifyResult && verifyResult.matched === false) {
      verifyFailedSafely = true;
    }
  } catch (err) {
    verifyFailedSafely = true;
  }
  assert(verifyFailedSafely, 'Face verification fails safely and never returns false-positive verification');

  console.log('\n====================================================');
  console.log(`SECURITY TESTS COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((e) => {
  console.error('Fatal error running security tests:', e);
  process.exit(1);
});
