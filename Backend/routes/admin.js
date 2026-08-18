import express from 'express';
import {
  login,
  registerUser,
  getUsers,
  getStats,
  updateUser,
  toggleUserStatus,
  getUserProgress,
  assignCoursesToUser,
  assignUsersToCourse,
  getCourseAssignments
} from '../controllers/adminController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Public admin routes
router.post('/login', login);

// Protected admin routes
router.post('/register', authenticateToken, requireRole(['ADMIN']), registerUser);
router.get('/users', authenticateToken, requireRole(['ADMIN']), getUsers);
router.get('/users/:id/progress', authenticateToken, requireRole(['ADMIN']), getUserProgress);
router.get('/stats', authenticateToken, requireRole(['ADMIN']), getStats);
router.put('/users/:id', authenticateToken, requireRole(['ADMIN']), updateUser);
router.post('/users/:id/assignments', authenticateToken, requireRole(['ADMIN']), assignCoursesToUser);
router.patch('/users/:id/status', authenticateToken, requireRole(['ADMIN']), toggleUserStatus);
router.post('/courses/:id/assign-users', authenticateToken, requireRole(['ADMIN']), assignUsersToCourse);
router.get('/courses/:id/assignments', authenticateToken, requireRole(['ADMIN']), getCourseAssignments);

export default router;

