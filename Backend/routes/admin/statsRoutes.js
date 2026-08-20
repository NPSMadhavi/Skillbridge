import express from 'express';
import { getStats } from '../../controllers/admin/statsController.js';
import { authenticateToken, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// Protected admin stats and analytics route
router.get('/stats', authenticateToken, requireRole(['ADMIN']), getStats);

export default router;
