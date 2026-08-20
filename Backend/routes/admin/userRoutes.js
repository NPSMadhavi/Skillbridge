import express from 'express';
import {
  registerUser,
  checkUserExists,
  getUsers,
  getUserProgress,
  updateUser,
  deleteUser,
  assignCoursesToUser,
  toggleUserStatus,
} from '../../controllers/admin/userController.js';
import { authenticateToken, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// Protected admin user management routes
router.post('/register', authenticateToken, requireRole(['ADMIN']), registerUser);
router.post('/check-user', authenticateToken, requireRole(['ADMIN']), checkUserExists);
router.get('/users', authenticateToken, requireRole(['ADMIN']), getUsers);
router.get('/users/:id/progress', authenticateToken, requireRole(['ADMIN']), getUserProgress);
router.put('/users/:id', authenticateToken, requireRole(['ADMIN']), updateUser);
router.delete('/users/:id', authenticateToken, requireRole(['ADMIN']), deleteUser);
router.post('/users/:id/assignments', authenticateToken, requireRole(['ADMIN']), assignCoursesToUser);
router.patch('/users/:id/status', authenticateToken, requireRole(['ADMIN']), toggleUserStatus);

export default router;
