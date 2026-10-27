import express from 'express';
import {
  getAssistantSettings,
  updateAssistantSettings,
  askVoiceAssistant
} from '../controllers/assistantController.js';

const router = express.Router();

// Assistant Name & Wake-Word Configuration Endpoints
router.get('/settings', getAssistantSettings);
router.put('/settings', updateAssistantSettings);
router.post('/settings', updateAssistantSettings);

// Direct voice question answering
router.post('/ask', askVoiceAssistant);

export default router;
