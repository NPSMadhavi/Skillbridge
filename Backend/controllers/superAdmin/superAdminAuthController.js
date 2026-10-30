import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import masterPrisma from '../../config/masterPrisma.js';
import { JWT_SECRET } from '../../config/jwtConfig.js';
import {
  ensureMasterDatabase,
  findSuperAdminByEmail,
  findSuperAdminById,
  listAllSuperAdmins,
  getWorkingMasterClient
} from '../../services/masterDatabaseService.js';
import crypto from 'crypto';

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // Ensure table & default super admin account exist
    await ensureMasterDatabase().catch(() => {});

    const superAdmin = await findSuperAdminByEmail(email, masterPrisma);

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
    res.status(500).json({ error: error.message || 'An error occurred during Super Admin login.' });
  }
};

export const me = async (req, res) => {
  try {
    const superAdmin = await findSuperAdminById(req.superAdmin.id, masterPrisma);

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
    const superAdmins = await listAllSuperAdmins(masterPrisma);
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
    const existing = await findSuperAdminByEmail(cleanEmail, masterPrisma);
    if (existing) {
      return res.status(400).json({ error: 'A Super Admin with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newId = crypto.randomUUID();

    // Try via masterPrisma
    if (masterPrisma && masterPrisma.superAdmin && typeof masterPrisma.superAdmin.create === 'function') {
      try {
        const newAdmin = await masterPrisma.superAdmin.create({
          data: {
            id: newId,
            email: cleanEmail,
            passwordHash,
            name: name ? name.trim() : null
          },
          select: { id: true, email: true, name: true, createdAt: true }
        });
        return res.status(201).json({
          message: `Super Admin "${newAdmin.name || newAdmin.email}" created successfully.`,
          superAdmin: newAdmin
        });
      } catch (_) {}
    }

    // Direct SQL fallback
    const conn = await getWorkingMasterClient();
    if (!conn) throw new Error('No master database connection available.');
    const { client } = conn;
    try {
      const insertRes = await client.query(
        'INSERT INTO "SuperAdmin" ("id", "email", "passwordHash", "name") VALUES ($1, $2, $3, $4) RETURNING id, email, name, "createdAt"',
        [newId, cleanEmail, passwordHash, name ? name.trim() : null]
      );
      res.status(201).json({
        message: `Super Admin "${insertRes.rows[0].name || insertRes.rows[0].email}" created successfully.`,
        superAdmin: insertRes.rows[0]
      });
    } finally {
      await client.end().catch(() => {});
    }
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

    const all = await listAllSuperAdmins(masterPrisma);
    if (all.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the sole Super Admin of the platform.' });
    }

    const target = await findSuperAdminById(id, masterPrisma);
    if (!target) {
      return res.status(404).json({ error: 'Super Admin not found.' });
    }

    if (masterPrisma && masterPrisma.superAdmin && typeof masterPrisma.superAdmin.delete === 'function') {
      try {
        await masterPrisma.superAdmin.delete({ where: { id } });
        return res.json({ message: `Super Admin "${target.name || target.email}" deleted successfully.` });
      } catch (_) {}
    }

    const conn = await getWorkingMasterClient();
    if (conn) {
      const { client } = conn;
      try {
        await client.query('DELETE FROM "SuperAdmin" WHERE id = $1', [id]);
      } finally {
        await client.end().catch(() => {});
      }
    }

    res.json({ message: `Super Admin "${target.name || target.email}" deleted successfully.` });
  } catch (error) {
    console.error('Delete super admin error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete super admin.' });
  }
};
