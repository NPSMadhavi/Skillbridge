import express from 'express';
import {
  assignUsersToCourse,
  getCourseAssignments,
} from '../../controllers/admin/courseAssignmentController.js';
import { authenticateToken, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// Protected admin course learner assignment routes
router.post('/courses/:id/assign-users', authenticateToken, requireRole(['ADMIN']), assignUsersToCourse);
router.get('/courses/:id/assignments', authenticateToken, requireRole(['ADMIN']), getCourseAssignments);

export default router;
