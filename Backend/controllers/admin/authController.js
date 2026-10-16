import prisma from '../../config/prisma.js';
import masterPrisma from '../../config/masterPrisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { tenantService } from '../../services/tenantService.js';
import { sendCompanyAdminPasswordReset } from '../../services/emailService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

// In-memory store for active password reset requests
// Key: `${cleanEmail}::${tenantCode}`
const passwordResetStore = new Map();

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

    // Check if the admin is still using a system-generated password
    if (admin.mustChangePassword) {
      const tempToken = jwt.sign(
        { id: admin.id, email: admin.email, role: 'ADMIN_PENDING_PASSWORD', tenantCode: targetTenantCode },
        JWT_SECRET,
        { expiresIn: '30m' }
      );

      return res.json({
        mustChangePassword: true,
        message: 'System-generated password detected. Please set your new permanent password to continue.',
        tempToken,
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
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: 'ADMIN', tenantCode: targetTenantCode },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      mustChangePassword: false,
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

/**
 * Initiate password reset for Company Admin
 */
export const forgotPassword = async (req, res) => {
  const { email, companyCode } = req.body;

  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Admin email address is required.' });
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
      return res.status(404).json({
        error: 'No administrator account found with this email. Please check your email or enter your Company Code.'
      });
    }

    // Generate 6-digit verification code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes validity
    const storeKey = `${cleanEmail}::${targetTenantCode}`;

    passwordResetStore.set(storeKey, {
      code: resetCode,
      expiresAt,
      adminId: admin.id,
      tenantCode: targetTenantCode,
      email: cleanEmail
    });

    // Send email with reset verification code
    const emailResult = await sendCompanyAdminPasswordReset({
      adminEmail: cleanEmail,
      fullName: admin.fullName || 'Company Administrator',
      companyName: company?.name || targetTenantCode,
      resetCode,
      expiresMinutes: 15
    });

    res.json({
      success: true,
      message: 'Verification code sent to your email address.',
      companyCode: targetTenantCode,
      email: cleanEmail,
      previewUrl: emailResult.previewUrl || null
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: error.message || 'Failed to process password reset request.' });
  }
};

/**
 * Complete password reset with verification code
 */
export const resetPassword = async (req, res) => {
  const { email, companyCode, code, newPassword } = req.body;

  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email address is required.' });
  }
  if (!code || !code.trim()) {
    return res.status(400).json({ error: '6-digit verification code is required.' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = code.trim();

  try {
    let targetTenantCode = companyCode ? companyCode.trim().toLowerCase() : null;
    let storeEntry = null;
    let foundKey = null;

    // Check direct key if companyCode provided
    if (targetTenantCode) {
      const key = `${cleanEmail}::${targetTenantCode}`;
      if (passwordResetStore.has(key)) {
        storeEntry = passwordResetStore.get(key);
        foundKey = key;
      }
    }

    // If not found yet, scan for matching email
    if (!storeEntry) {
      for (const [key, entry] of passwordResetStore.entries()) {
        if (entry.email === cleanEmail) {
          storeEntry = entry;
          foundKey = key;
          targetTenantCode = entry.tenantCode;
          break;
        }
      }
    }

    if (!storeEntry) {
      return res.status(400).json({
        error: 'No active password reset request found for this email. Please request a new code.'
      });
    }

    // Check expiration
    if (Date.now() > storeEntry.expiresAt) {
      passwordResetStore.delete(foundKey);
      return res.status(400).json({
        error: 'Verification code has expired. Please request a new reset code.'
      });
    }

    // Check code match
    if (storeEntry.code !== cleanCode) {
      return res.status(400).json({
        error: 'Invalid verification code. Please check your email and try again.'
      });
    }

    // Code is valid! Update password in tenant DB
    const targetClient = await tenantService.getTenantClient(storeEntry.tenantCode);
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await targetClient.admin.update({
      where: { email: cleanEmail },
      data: {
        passwordHash,
        mustChangePassword: false
      }
    });

    // Remove from reset store
    passwordResetStore.delete(foundKey);

    res.json({
      success: true,
      message: 'Password has been updated successfully. You can now sign in.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: error.message || 'Failed to update password.' });
  }
};

/**
 * Set permanent password for admins with system-generated initial passwords
 */
export const setInitialPassword = async (req, res) => {
  const { email, companyCode, tempToken, newPassword } = req.body;

  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email address is required.' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    let targetTenantCode = companyCode ? companyCode.trim().toLowerCase() : null;

    // Verify tempToken if supplied
    if (tempToken) {
      try {
        const decoded = jwt.verify(tempToken, JWT_SECRET);
        if (decoded.email && decoded.email.toLowerCase() !== cleanEmail) {
          return res.status(401).json({ error: 'Verification token does not match this admin email.' });
        }
        if (decoded.tenantCode && !targetTenantCode) {
          targetTenantCode = decoded.tenantCode;
        }
      } catch (tokenErr) {
        return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
      }
    }

    let targetClient = null;
    let company = null;

    if (!targetTenantCode || targetTenantCode === 'default') {
      company = await tenantService.findCompanyByAdminEmail(cleanEmail);
      if (company) {
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
      return res.status(404).json({ error: 'Admin account not found.' });
    }

    // Hash the new permanent password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password and clear mustChangePassword flag
    const updatedAdmin = await targetClient.admin.update({
      where: { email: cleanEmail },
      data: {
        passwordHash,
        mustChangePassword: false
      }
    });

    // Issue permanent 8-hour JWT token
    const token = jwt.sign(
      { id: updatedAdmin.id, email: updatedAdmin.email, role: 'ADMIN', tenantCode: targetTenantCode },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      message: 'New permanent password created successfully! Welcome to SkillBridge.',
      token,
      admin: {
        id: updatedAdmin.id,
        email: updatedAdmin.email,
        fullName: updatedAdmin.fullName || 'Admin',
        department: updatedAdmin.department || null,
        nricFin: updatedAdmin.nricFin || null
      },
      tenant: {
        code: targetTenantCode,
        slug: targetTenantCode,
        name: company?.name || targetTenantCode
      }
    });
  } catch (error) {
    console.error('Set initial password error:', error);
    res.status(500).json({ error: error.message || 'Failed to update permanent password.' });
  }
};


