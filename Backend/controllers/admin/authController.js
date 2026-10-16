import prisma from '../../config/prisma.js';
import masterPrisma from '../../config/masterPrisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { tenantService } from '../../services/tenantService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

export const login = async (req, res) => {
  const { email, password, companyCode } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    let targetTenantCode = companyCode ? companyCode.trim().toLowerCase() : null;
    let targetClient = null;
    let company = null;

    // Automatically resolve company tenant from email if companyCode not provided or not known
    if (!targetTenantCode || targetTenantCode === 'default') {
      company = await tenantService.findCompanyByAdminEmail(cleanEmail);
      if (company) {
        if (company.status === 'SUSPENDED') {
          return res.status(403).json({
            error: `Company "${company.name}" is suspended. Please contact Super Admin.`
          });
        }
        targetTenantCode = company.code;
        targetClient = await tenantService.getTenantClient(targetTenantCode);
      }
    }

    if (!targetClient) {
      targetTenantCode = targetTenantCode || req.tenantCode || 'default';
      targetClient = await tenantService.getTenantClient(targetTenantCode);
    }

    if (!company && targetTenantCode) {
      company = await masterPrisma.company
        .findUnique({ where: { code: targetTenantCode } })
        .catch(() => null);
    }

    const admin = await targetClient.admin.findUnique({ where: { email: cleanEmail } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid admin credentials or email not registered.' });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: 'ADMIN', tenantCode: targetTenantCode },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName || 'Admin',
        department: admin.department || null,
        nricFin: admin.nricFin || null
      },
      tenant: {
        code: targetTenantCode,
        slug: targetTenantCode,
        name: company?.name || targetTenantCode
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: error.message || 'An error occurred during admin login.' });
  }
};

export const me = async (req, res) => {
  try {
    const tenantCode = req.user?.tenantCode || req.tenantCode || 'default';
    const client = await tenantService.getTenantClient(tenantCode);
    const admin = await client.admin.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        department: true,
        nricFin: true,
        phone: true,
        createdAt: true
      }
    });

    const company = await masterPrisma.company
      .findUnique({ where: { code: tenantCode } })
      .catch(() => null);

    res.json({
      admin,
      tenant: {
        code: tenantCode,
        slug: tenantCode,
        name: company?.name || tenantCode
      }
    });
  } catch (error) {
    console.error('Admin me error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch admin profile.' });
  }
};
