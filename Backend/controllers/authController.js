import prisma from '../config/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pythonService from '../services/pythonService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

export const passwordLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact admin.' });
    }

    let isMatch = false;
    if (user.passwordHash) {
      isMatch = await bcrypt.compare(password, user.passwordHash);
    } else {
      // Fallback: If no password is set, the student's password is their FIN number
      isMatch = (password === user.finNumber);
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: 'STUDENT' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        finNumber: user.finNumber,
        preferredLanguage: user.preferredLanguage,
        country: user.country,
        role: user.role,
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
    // Get all users who have face embeddings registered in PostgreSQL
    const candidates = await prisma.user.findMany({
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
    const user = await prisma.user.findUnique({
      where: { id: result.id },
    });

    if (!user) {
      return res.status(401).json({ error: 'Recognized user profile not found.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact admin.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: 'STUDENT' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        finNumber: user.finNumber,
        preferredLanguage: user.preferredLanguage,
        country: user.country,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Face login error:', error);
    res.status(500).json({ error: error.message || 'An error occurred during face sign in.' });
  }
};
