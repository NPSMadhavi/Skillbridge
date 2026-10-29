import prisma from '../config/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pythonService from '../services/pythonService.js';
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
    const targetPrisma = req.prisma || prisma;
    // Get all users who have face embeddings registered in PostgreSQL
    const candidates = await targetPrisma.user.findMany({
      where: {
        faceEmbedding: { not: null },
      },
      select: {
        id: true,
        faceEmbedding: true,
      },
    });

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No Face ID profiles enrolled in system. Contact admin.' });
    }

    // Call Python AI service to find a match among these candidates
    const result = await pythonService.verifyFace(faceIdData, candidates);

    if (!result.matched || !result.id) {
      return res.status(401).json({ error: 'Face verification failed. Face not recognized.' });
    }

    // Fetch the matched user profile from PostgreSQL
    const user = await targetPrisma.user.findUnique({
      where: { id: result.id },
    });

    if (!user) {
      return res.status(401).json({ error: 'Recognized user profile not found.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact admin.' });
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
    console.error('Face login error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || 'An error occurred during face sign in.' });
  }
};
