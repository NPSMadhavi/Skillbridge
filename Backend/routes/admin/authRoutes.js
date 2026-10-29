import express from 'express';
import { login, me, forgotPassword, resetPassword, setInitialPassword } from '../../controllers/admin/authController.js';
import { authenticateToken } from '../../middleware/auth.js';
import { authRateLimiter, passwordResetLimiter } from '../../middleware/rateLimiter.js';

const router = express.Router();

// Public admin login route with rate limiting
router.post('/login', authRateLimiter, login);

// Admin password reset & first-time password setup routes with rate limiting
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPassword);
router.post('/set-initial-password', passwordResetLimiter, setInitialPassword);

// Authenticated admin profile route
router.get('/me', authenticateToken, me);

export default router;
