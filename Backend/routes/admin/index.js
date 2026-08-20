import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import courseRoutes from './courseRoutes.js';
import statsRoutes from './statsRoutes.js';

const router = express.Router();

// Mount all modular admin subroutes
router.use('/', authRoutes);
router.use('/', userRoutes);
router.use('/', courseRoutes);
router.use('/', statsRoutes);

export default router;
