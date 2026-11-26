import prisma from '../config/prisma.js';
import masterPrisma from '../config/masterPrisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pythonService from '../services/pythonService.js';
import { tenantService } from '../services/tenantService.js';
import { JWT_SECRET } from '../config/jwtConfig.js';

export const passwordLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  try {
    let targetPrisma = req.prisma || prisma;
    let effectiveTenantCode = req.tenantCode || 'default';
    let user = await targetPrisma.user.findUnique({ where: { email: cleanEmail } });

    // Multi-tenant resolution: If not in current tenant, search across active companies
    if (!user) {
      try {
        const companies = await masterPrisma.company.findMany({
          where: { status: 'ACTIVE' },
          select: { code: true }
        }).catch(() => []);

        for (const comp of companies) {
          if (comp.code === effectiveTenantCode) continue;
          try {
            const compClient = await tenantService.getTenantClient(comp.code);
            const foundUser = await compClient.user.findUnique({ where: { email: cleanEmail } });
            if (foundUser) {
              user = foundUser;
              targetPrisma = compClient;
              effectiveTenantCode = comp.code;
              break;
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact admin.' });
    }

    if (!user.passwordHash) {
      return res.status(401).json({ error: 'Account password not configured. Please contact administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const userRole = user.role || 'STUDENT';
    const token = jwt.sign(
      { id: user.id, email: user.email, role: userRole, tenantCode: effectiveTenantCode },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      tenant: { code: effectiveTenantCode },
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        finNumber: user.finNumber,
        preferredLanguage: user.preferredLanguage,
        country: user.country,
        role: userRole,
      },
    });
  } catch (error) {
    console.error('Password login error:', error);
    res.status(500).json({ error: 'An error occurred during sign in.' });
  }
};

export const faceLogin = async (req, res) => {
  const { faceIdData } = req.body;

  if (!faceIdData) {
    return res.status(400).json({ error: 'Face ID image data is required.' });
  }

  try {
    let targetPrisma = req.prisma || prisma;
    let effectiveTenantCode = req.tenantCode || 'default';

    // 1. Fetch candidates from the current tenant database
    const fetchCandidates = async (client) => {
      return await client.user.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { faceEmbedding: { not: null } },
            { faceImage: { not: null } },
          ],
        },
        select: {
          id: true,
          faceEmbedding: true,
          faceImage: true,
        },
      }).catch(() => []);
    };

    let candidates = await fetchCandidates(targetPrisma);
    let result = candidates.length > 0
      ? await pythonService.verifyFace(faceIdData, candidates)
      : { matched: false, id: null, user_id: null, confidence: 0 };

    // Multi-tenant resolution (matching passwordLogin): if logging in from root /login (tenantCode === 'default')
    // and not matched in default DB, check active companies to resolve the user's organization
    if ((!result.matched || !(result.user_id || result.id)) && effectiveTenantCode === 'default' && !result.isAuthError && !result.serviceUnavailable && !result.noFaceDetected) {
      try {
        const companies = await masterPrisma.company.findMany({
          where: { status: 'ACTIVE' },
          select: { code: true }
        }).catch(() => []);

        for (const comp of companies) {
          if (!comp.code || comp.code === effectiveTenantCode) continue;
          try {
            const compClient = await tenantService.getTenantClient(comp.code);
            const compCandidates = await fetchCandidates(compClient);
            if (compCandidates.length === 0) continue;
            const compResult = await pythonService.verifyFace(faceIdData, compCandidates);
            if (compResult.matched && (compResult.user_id || compResult.id)) {
              result = compResult;
              targetPrisma = compClient;
              effectiveTenantCode = comp.code;
              candidates = compCandidates;
              break;
            }
            if (compResult.confidence > (result.confidence || 0)) {
              result = compResult;
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    if (candidates.length === 0 && !result.matched) {
      return res.status(400).json({ error: 'No enrolled Face ID profiles found in your organization. Please log in with password or contact your administrator.' });
    }

    const matchedUserId = result.user_id || result.id;
    if (!result.matched || !matchedUserId) {
      if (result.isAuthError) {
        return res.status(503).json({
          error: 'Biometric authentication service configuration error. Please sign in with email and password.'
        });
      }
      if (result.serviceUnavailable) {
        return res.status(503).json({
          error: 'Face recognition service is currently unavailable. Please sign in with your email and password.'
        });
      }
      if (result.noFaceDetected) {
        return res.status(422).json({
          error: 'No face detected in camera capture. Please face the camera directly in a well-lit room and try again.'
        });
      }
      console.warn(`[FaceLogin] Verification rejected. Confidence: ${result.confidence || 0} (tenant: ${effectiveTenantCode})`);
      return res.status(401).json({
        error: result.error || 'Face verification failed. Face not recognized. Look directly into camera with good lighting and try again.',
        confidence: result.confidence ?? 0,
        tenantCode: effectiveTenantCode
      });
    }

    // Locate the matched user strictly within this tenant
    const user = await targetPrisma.user.findUnique({
      where: { id: matchedUserId },
    });

    if (!user) {
      return res.status(401).json({ error: 'Recognized user profile not found.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact admin.' });
    }

    const userRole = user.role || 'STUDENT';
    const token = jwt.sign(
      { id: user.id, email: user.email, role: userRole, tenantCode: effectiveTenantCode },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      tenantCode: effectiveTenantCode,
      tenant: { code: effectiveTenantCode },
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        finNumber: user.finNumber,
        preferredLanguage: user.preferredLanguage,
        country: user.country,
        role: userRole,
        tenantCode: effectiveTenantCode,
      },
    });
  } catch (error) {
    console.error('Face login error:', error);
    // Return friendly 401 on face recognition failures rather than raw 422 or 500
    const status = error.statusCode === 422 ? 401 : (error.statusCode || 401);
    res.status(status).json({ error: error.message || 'Face verification failed. Please try again or log in with credentials.' });
  }
};
