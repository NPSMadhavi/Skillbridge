import express from 'express';
import { getAiSettings, updateAiSettings, getPublicCompanyAiSettings } from '../../controllers/admin/aiSettingsController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Authenticated Company Admin AI settings
router.get('/ai-settings', authenticateToken, getAiSettings);
router.put('/ai-settings', authenticateToken, updateAiSettings);
router.post('/ai-settings', authenticateToken, updateAiSettings);

// Public / Learner AI settings query
router.get('/company-ai-settings', getPublicCompanyAiSettings);
router.get('/ai-settings/public', getPublicCompanyAiSettings);

export default router;
