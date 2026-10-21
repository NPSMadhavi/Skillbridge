import express from 'express';
import axios from 'axios';

const router = express.Router();
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

/**
 * Neural Text-to-Speech synthesis proxy to Python AI Service
 * Supports query params: text, voice, gender, rate, pitch
 */
router.get('/synthesize', async (req, res) => {
  try {
    const { text, voice, gender, rate, pitch } = req.query;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text query parameter is required.' });
    }

    const pyRes = await axios.get(`${PYTHON_SERVICE_URL}/api/tts/speak`, {
      params: {
        text: text.trim(),
        voice: voice || undefined,
        gender: gender || 'FEMALE',
        rate: rate ? parseFloat(rate) : 1.0,
        pitch: pitch ? parseFloat(pitch) : 1.0,
      },
      responseType: 'stream',
      timeout: 15000,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (pyRes.headers['x-voice-used']) {
      res.setHeader('X-Voice-Used', pyRes.headers['x-voice-used']);
    }

    pyRes.data.pipe(res);
  } catch (error) {
    console.warn('[TTS Proxy] Python neural TTS unavailable:', error.message);
    res.status(502).json({
      error: 'Neural TTS service unavailable',
      fallback: 'browser_speech_synthesis',
      details: error.message,
    });
  }
});

router.post('/synthesize', async (req, res) => {
  try {
    const { text, voice, gender, rate, pitch } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text body field is required.' });
    }

    const pyRes = await axios.post(`${PYTHON_SERVICE_URL}/api/tts/speak`, {
      text: text.trim(),
      voice: voice || undefined,
      gender: gender || 'FEMALE',
      rate: rate ? parseFloat(rate) : 1.0,
      pitch: pitch ? parseFloat(pitch) : 1.0,
    }, {
      responseType: 'stream',
      timeout: 15000,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    pyRes.data.pipe(res);
  } catch (error) {
    console.warn('[TTS Proxy] Python neural TTS post unavailable:', error.message);
    res.status(502).json({
      error: 'Neural TTS service unavailable',
      fallback: 'browser_speech_synthesis',
      details: error.message,
    });
  }
});

export default router;
