import express from 'express';
import { login } from '../../controllers/admin/authController.js';

const router = express.Router();

// Public admin login route
router.post('/login', login);

export default router;
