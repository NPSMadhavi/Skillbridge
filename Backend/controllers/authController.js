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
    const targetPrisma = req.prisma || prisma;
    const user = await targetPrisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact admin.' });
    }

    let isMatch = false;
    if (user.passwordHash) {
      isMatch = await bcrypt.compare(password, user.passwordHash);
    } else if (user.finNumber) {
      // Legacy fallback: If no password hash was set, compare with FIN and immediately upgrade to secure hash
      isMatch = (password.trim() === user.finNumber.trim());
      if (isMatch) {
        const upgradedHash = await bcrypt.hash(password.trim(), 12);
        await targetPrisma.user.update({
          where: { id: user.id },
          data: { passwordHash: upgradedHash },
        }).catch((err) => console.warn('[Auth] Upgrading legacy plain password notice:', err.message));
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const userRole = user.role || 'STUDENT';
    const token = jwt.sign(
      { id: user.id, email: user.email, role: userRole, tenantCode: req.tenantCode || 'default' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      tenant: { code: req.tenantCode || 'default' },
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

    // 1. Fetch candidates from requested tenant database
    let candidates = await targetPrisma.user.findMany({
      where: {
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

    // Track which tenant client each candidate belongs to
    const candidateTenantMap = new Map();
    candidates.forEach(c => candidateTenantMap.set(c.id, { client: targetPrisma, tenantCode: effectiveTenantCode }));

    // 2. If requested tenant was 'default' or no candidates found, search all active company tenants
    if (effectiveTenantCode === 'default' || candidates.length === 0) {
      try {
        const companies = await masterPrisma.company.findMany({
          where: { status: 'ACTIVE' },
          select: { code: true },
        }).catch(() => []);

        for (const comp of companies) {
          if (comp.code === effectiveTenantCode) continue;
          try {
            const compClient = await tenantService.getTenantClient(comp.code);
            const compCandidates = await compClient.user.findMany({
              where: {
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
            });
            for (const cc of compCandidates) {
              if (!candidateTenantMap.has(cc.id)) {
                candidates.push(cc);
                candidateTenantMap.set(cc.id, { client: compClient, tenantCode: comp.code });
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No Face ID profiles enrolled in system. Contact admin.' });
    }

    // Format and verify with Python AI service or local biometric matching
    const result = await pythonService.verifyFace(faceIdData, candidates);

    const matchedUserId = result.user_id || result.id;
    if (!result.matched || !matchedUserId) {
      console.warn(`[FaceLogin] Verification rejected. Highest similarity confidence: ${result.confidence || 0}`);
      return res.status(401).json({ error: 'Face verification failed. Face not recognized. Look directly into camera with good lighting and try again.' });
    }

    // Locate the matched user in the corresponding tenant database
    const tenantInfo = candidateTenantMap.get(matchedUserId) || { client: targetPrisma, tenantCode: effectiveTenantCode };
    const matchedPrisma = tenantInfo.client;
    const finalTenantCode = tenantInfo.tenantCode;

    const user = await matchedPrisma.user.findUnique({
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
      { id: user.id, email: user.email, role: userRole, tenantCode: finalTenantCode },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      tenantCode: finalTenantCode,
      tenant: { code: finalTenantCode },
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        finNumber: user.finNumber,
        preferredLanguage: user.preferredLanguage,
        country: user.country,
        role: userRole,
        tenantCode: finalTenantCode,
      },
    });
  } catch (error) {
    console.error('Face login error:', error);
    // Return friendly 401 on face recognition failures rather than raw 422 or 500
    const status = error.statusCode === 422 ? 401 : (error.statusCode || 401);
    res.status(status).json({ error: error.message || 'Face verification failed. Please try again or log in with credentials.' });
  }
};
