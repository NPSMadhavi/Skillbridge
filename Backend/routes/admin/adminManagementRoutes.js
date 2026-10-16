import express from 'express';
import {
  getCompanyAdmins,
  createCompanyAdmin,
  deleteCompanyAdmin,
} from '../../controllers/admin/adminManagementController.js';
import { authenticateToken, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// All routes require authenticated company ADMIN session
router.get('/admins', authenticateToken, requireRole(['ADMIN']), getCompanyAdmins);
router.post('/admins', authenticateToken, requireRole(['ADMIN']), createCompanyAdmin);
router.delete('/admins/:id', authenticateToken, requireRole(['ADMIN']), deleteCompanyAdmin);

export default router;
