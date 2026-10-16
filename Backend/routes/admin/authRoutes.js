import express from 'express';
import { login, me, forgotPassword, resetPassword, setInitialPassword } from '../../controllers/admin/authController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Public admin login route
router.post('/login', login);

// Admin password reset & first-time password setup routes
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/set-initial-password', setInitialPassword);


// Authenticated admin profile route
router.get('/me', authenticateToken, me);

export default router;

