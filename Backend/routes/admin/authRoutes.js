import express from 'express';
import { login, me } from '../../controllers/admin/authController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Public admin login route
router.post('/login', login);

// Authenticated admin profile route
router.get('/me', authenticateToken, me);

export default router;
