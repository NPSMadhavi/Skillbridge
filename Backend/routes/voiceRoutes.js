import express from 'express';
import { askVoiceAssistant } from '../controllers/assistantController.js';

const router = express.Router();

// Direct voice question answering
router.post('/ask', askVoiceAssistant);

export default router;
