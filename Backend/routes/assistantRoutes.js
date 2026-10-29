import express from 'express';
import {
  getAssistantSettings,
  updateAssistantSettings,
  askVoiceAssistant
} from '../controllers/assistantController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Assistant Name & Wake-Word Configuration Endpoints
router.get('/settings', getAssistantSettings);
// Lock updates strictly to authenticated Admins
router.put('/settings', authenticateToken, requireRole(['ADMIN']), updateAssistantSettings);
router.post('/settings', authenticateToken, requireRole(['ADMIN']), updateAssistantSettings);

// Direct voice question answering (requires valid learner or admin session)
router.post('/ask', authenticateToken, askVoiceAssistant);

export default router;
