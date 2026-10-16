import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import masterPrisma from '../../config/masterPrisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const superAdmin = await masterPrisma.superAdmin.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (!superAdmin) {
      return res.status(401).json({ error: 'Invalid Super Admin credentials.' });
    }

    const isMatch = await bcrypt.compare(password, superAdmin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid Super Admin credentials.' });
    }

    const token = jwt.sign(
      {
        id: superAdmin.id,
        email: superAdmin.email,
        role: 'SUPER_ADMIN'
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      superAdmin: {
        id: superAdmin.id,
        email: superAdmin.email,
        name: superAdmin.name || 'Super Admin'
      }
    });
  } catch (error) {
    console.error('Super Admin login error:', error);
    res.status(500).json({ error: 'An error occurred during Super Admin login.' });
  }
};

export const me = async (req, res) => {
  try {
    const superAdmin = await masterPrisma.superAdmin.findUnique({
      where: { id: req.superAdmin.id },
      select: { id: true, email: true, name: true, createdAt: true }
    });

    if (!superAdmin) {
      return res.status(404).json({ error: 'Super Admin not found.' });
    }

    res.json({ superAdmin });
  } catch (error) {
    console.error('Super Admin me error:', error);
    res.status(500).json({ error: 'Failed to fetch Super Admin profile.' });
  }
};

export const listSuperAdmins = async (req, res) => {
  try {
    const superAdmins = await masterPrisma.superAdmin.findMany({
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ superAdmins, currentSuperAdminId: req.superAdmin?.id });
  } catch (error) {
    console.error('List super admins error:', error);
    res.status(500).json({ error: 'Failed to retrieve super admins.' });
  }
};

export const createSuperAdmin = async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Super Admin email is required.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    const existing = await masterPrisma.superAdmin.findUnique({
      where: { email: cleanEmail }
    });
    if (existing) {
      return res.status(400).json({ error: 'A Super Admin with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newAdmin = await masterPrisma.superAdmin.create({
      data: {
        email: cleanEmail,
        passwordHash,
        name: name ? name.trim() : null
      },
      select: { id: true, email: true, name: true, createdAt: true }
    });

    res.status(201).json({
      message: `Super Admin "${newAdmin.name || newAdmin.email}" created successfully.`,
      superAdmin: newAdmin
    });
  } catch (error) {
    console.error('Create super admin error:', error);
    res.status(500).json({ error: error.message || 'Failed to create super admin.' });
  }
};

export const deleteSuperAdmin = async (req, res) => {
  const { id } = req.params;
  try {
    if (id === req.superAdmin?.id) {
      return res.status(400).json({ error: 'You cannot delete your own Super Admin account.' });
    }

    const count = await masterPrisma.superAdmin.count();
    if (count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the sole Super Admin of the platform.' });
    }

    const target = await masterPrisma.superAdmin.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ error: 'Super Admin not found.' });
    }

    await masterPrisma.superAdmin.delete({ where: { id } });
    res.json({ message: `Super Admin "${target.name || target.email}" deleted successfully.` });
  } catch (error) {
    console.error('Delete super admin error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete super admin.' });
  }
};
