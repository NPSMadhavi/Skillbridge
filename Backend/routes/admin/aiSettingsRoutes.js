import express from 'express';
import { getAiSettings, updateAiSettings, getPublicCompanyAiSettings } from '../../controllers/admin/aiSettingsController.js';
import { authenticateToken, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// Authenticated Company Admin AI settings (Locked to ADMIN role)
router.get('/ai-settings', authenticateToken, requireRole(['ADMIN']), getAiSettings);
router.put('/ai-settings', authenticateToken, requireRole(['ADMIN']), updateAiSettings);
router.post('/ai-settings', authenticateToken, requireRole(['ADMIN']), updateAiSettings);

// Public / Learner AI settings query (Read-only for learner interface)
router.get('/company-ai-settings', getPublicCompanyAiSettings);
router.get('/ai-settings/public', getPublicCompanyAiSettings);

export default router;
