import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import courseRoutes from './courseRoutes.js';
import statsRoutes from './statsRoutes.js';
import adminManagementRoutes from './adminManagementRoutes.js';
import aiSettingsRoutes from './aiSettingsRoutes.js';

const router = express.Router();

// Mount all modular admin subroutes
router.use('/', authRoutes);
router.use('/', userRoutes);
router.use('/', courseRoutes);
router.use('/', statsRoutes);
router.use('/', adminManagementRoutes);
router.use('/', aiSettingsRoutes);

export default router;

