import express from 'express';
import { passwordLogin, faceLogin } from '../controllers/authController.js';

const router = express.Router();

// Student auth endpoints
router.post('/login', passwordLogin);
router.post('/face-login', faceLogin);

export default router;
