import express from 'express';
import { passwordLogin, faceLogin } from '../controllers/authController.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Student auth endpoints protected by rate limiting
router.post('/login', authRateLimiter, passwordLogin);
router.post('/face-login', authRateLimiter, faceLogin);

export default router;
