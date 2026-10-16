import prisma from '../../config/prisma.js';
import bcrypt from 'bcryptjs';

// Format validation for FIN/NRIC (e.g. S1234567A, T1234567B, F1234567C, G1234567D, M1234567E)
const NRIC_FIN_REGEX = /^[STFGMstfgm]\d{7}[A-Za-z]$/;

/**
 * Get all administrators of the current authenticated company
 */
export const getCompanyAdmins = async (req, res) => {
  try {
    const admins = await prisma.admin.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        nricFin: true,
        phone: true,
        department: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      admins,
      currentAdminEmail: req.user?.email,
      tenantCode: req.tenantCode,
    });
  } catch (error) {
    console.error('[AdminManagement] Failed to list company admins:', error);
    res.status(500).json({ error: 'Failed to retrieve company administrators.' });
  }
};

/**
 * Create a new administrator for the current company
 * Enforces strict FIN/NRIC uniqueness within the company database.
 */
export const createCompanyAdmin = async (req, res) => {
  const { fullName, nricFin, email, password, phone, department } = req.body;

  // Validation
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'Full Name is required.' });
  }

  if (!nricFin || !nricFin.trim()) {
    return res.status(400).json({ error: 'NRIC / FIN Number is required.' });
  }

  const cleanFin = nricFin.trim().toUpperCase();
  if (cleanFin.length !== 9 || !NRIC_FIN_REGEX.test(cleanFin)) {
    return res.status(400).json({
      error: 'Invalid NRIC/FIN format. Must be 9 characters starting with S, T, F, G, or M (e.g., S1234567A).',
    });
  }

  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Admin email address is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    // 1. Check uniqueness of FIN/NRIC among existing company admins
    const existingAdminWithFin = await prisma.admin.findFirst({
      where: { nricFin: cleanFin },
    });
    if (existingAdminWithFin) {
      return res.status(400).json({
        error: `An administrator with NRIC/FIN "${cleanFin}" already exists in your company.`,
      });
    }

    // Also verify against User table to prevent FIN collisions within the tenant
    const existingUserWithFin = await prisma.user.findFirst({
      where: { finNumber: cleanFin },
    });
    if (existingUserWithFin) {
      return res.status(400).json({
        error: `A user with NRIC/FIN "${cleanFin}" already exists in your company database.`,
      });
    }

    // 2. Check uniqueness of Email among existing admins
    const existingAdminWithEmail = await prisma.admin.findUnique({
      where: { email: cleanEmail },
    });
    if (existingAdminWithEmail) {
      return res.status(400).json({
        error: `An administrator with email "${cleanEmail}" already exists in your company.`,
      });
    }

    // 3. Hash password and persist in current company tenant database
    const passwordHash = await bcrypt.hash(password, 10);

    const newAdmin = await prisma.admin.create({
      data: {
        fullName: fullName.trim(),
        nricFin: cleanFin,
        email: cleanEmail,
        passwordHash,
        phone: phone ? phone.trim() : null,
        department: department ? department.trim() : null,
      },
      select: {
        id: true,
        fullName: true,
        nricFin: true,
        email: true,
        phone: true,
        department: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      message: `Admin "${newAdmin.fullName}" successfully registered for your company.`,
      admin: newAdmin,
      tenantCode: req.tenantCode,
    });
  } catch (error) {
    console.error('[AdminManagement] Failed to create company admin:', error);
    if (error.code === 'P2002') {
      const targetField = error.meta?.target?.includes('nricFin') ? 'NRIC/FIN number' : 'email address';
      return res.status(400).json({
        error: `An administrator with this ${targetField} already exists in your company.`,
      });
    }
    res.status(500).json({ error: error.message || 'Failed to create company administrator.' });
  }
};

/**
 * Delete a company administrator (cannot delete self, cannot delete sole admin)
 */
export const deleteCompanyAdmin = async (req, res) => {
  const { id } = req.params;

  try {
    const targetAdmin = await prisma.admin.findUnique({
      where: { id },
    });

    if (!targetAdmin) {
      return res.status(404).json({ error: 'Administrator not found in this company.' });
    }

    // Prevent deleting own currently active session
    if (targetAdmin.email.toLowerCase() === req.user?.email?.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot delete your own administrator account.' });
    }

    // Prevent deleting if they are the sole admin
    const totalAdmins = await prisma.admin.count();
    if (totalAdmins <= 1) {
      return res.status(400).json({ error: 'Cannot delete the sole administrator of the company.' });
    }

    await prisma.admin.delete({
      where: { id },
    });

    res.json({
      message: `Administrator "${targetAdmin.fullName || targetAdmin.email}" has been removed.`,
    });
  } catch (error) {
    console.error('[AdminManagement] Failed to delete company admin:', error);
    res.status(500).json({ error: 'Failed to delete company administrator.' });
  }
};
