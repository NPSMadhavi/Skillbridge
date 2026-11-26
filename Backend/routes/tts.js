import express from 'express';
import microsoftNeuralTts, { VOICE_CONFIG } from '../services/microsoftNeuralTtsService.js';
import interactiveCourseService from '../services/interactiveCourseService.js';

const router = express.Router();

/**
 * GET /api/v1/tts/voices
 * Returns full configuration matrix of supported Microsoft Neural voices
 */
router.get('/voices', (req, res) => {
  res.json({
    provider: 'Microsoft Edge Neural TTS',
    voices: VOICE_CONFIG
  });
});

/**
 * GET /api/v1/tts/synthesize
 * Primary neural synthesis endpoint supporting direct audio streaming
 * Query params: text, voice, language, gender, rate, pitch
 */
router.get('/synthesize', async (req, res) => {
  try {
    const { text, voice, language, gender, rate, pitch, sourceChunkId, version } = req.query;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text query parameter is required.' });
    }

    const result = await microsoftNeuralTts.synthesizeAudio(text, {
      language,
      gender,
      voice,
      rate,
      pitch,
      sourceChunkId: sourceChunkId || null,
      version: Number(version) || 1
    });

    res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Voice-Used', result.voice);
    res.setHeader('X-Cache', result.fromCache ? 'HIT' : 'MISS');
    if (result.cacheKey) res.setHeader('X-Audio-Key', result.cacheKey);
    return res.end(result.buffer);
  } catch (error) {
    console.warn('[TTS Endpoint:GET] Neural synthesis notice:', error.message);
    res.status(502).json({
      error: 'Neural TTS service unavailable',
      details: error.message
    });
  }
});

/**
 * POST /api/v1/tts/synthesize
 * POST variant for longer texts or structured payloads
 */
router.post('/synthesize', async (req, res) => {
  try {
    const { text, voice, language, gender, rate, pitch, sourceChunkId, version } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text body field is required.' });
    }

    const result = await microsoftNeuralTts.synthesizeAudio(text, {
      language,
      gender,
      voice,
      rate,
      pitch,
      sourceChunkId: sourceChunkId || null,
      version: Number(version) || 1
    });

    res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Voice-Used', result.voice);
    res.setHeader('X-Cache', result.fromCache ? 'HIT' : 'MISS');
    if (result.cacheKey) res.setHeader('X-Audio-Key', result.cacheKey);
    return res.end(result.buffer);
  } catch (error) {
    console.warn('[TTS Endpoint:POST] Neural synthesis notice:', error.message);
    res.status(502).json({
      error: 'Neural TTS service unavailable',
      details: error.message
    });
  }
});

router.get('/audio', async (req, res) => {
  try {
    const { text, voice, language, gender, rate, pitch, sourceChunkId, version, generate } = req.query;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text query parameter is required.' });
    }
    const status = microsoftNeuralTts.hasCachedAudio(text, {
      language, gender, voice, rate, pitch, sourceChunkId: sourceChunkId || null, version: Number(version) || 1
    });
    if (!status.hit && generate !== 'true') {
      return res.status(404).json({ cached: false, cacheKey: status.cacheKey, voice: status.voice });
    }
    const result = await microsoftNeuralTts.synthesizeAudio(text, {
      language, gender, voice, rate, pitch, sourceChunkId: sourceChunkId || null, version: Number(version) || 1
    });
    res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Voice-Used', result.voice);
    res.setHeader('X-Cache', result.fromCache ? 'HIT' : 'MISS');
    return res.end(result.buffer);
  } catch (error) {
    res.status(502).json({ error: 'Neural TTS service unavailable', details: error.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { text, voice, language, gender, rate, pitch, sourceChunkId, version } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text body field is required.' });
    }
    const result = await microsoftNeuralTts.synthesizeAudio(text, {
      language, gender, voice, rate, pitch, sourceChunkId: sourceChunkId || null, version: Number(version) || 1
    });
    res.json({
      cached: result.fromCache,
      voice: result.voice,
      cacheKey: result.cacheKey || null,
      bytes: result.buffer.length,
    });
  } catch (error) {
    res.status(502).json({ error: 'Neural TTS generation failed', details: error.message });
  }
});

/**
 * POST /api/v1/tts/ssml
 * Generates Microsoft Neural SSML with pedagogical teacher pauses and prosody
 */
router.post('/ssml', (req, res) => {
  try {
    const { text, language, voice, gender, rate, pitch, volume } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text field is required.' });
    }

    const cleanSpoken = microsoftNeuralTts.prepareTeacherNarration(text, language);
    const sentences = microsoftNeuralTts.segmentSentences(cleanSpoken);
    const targetVoice = microsoftNeuralTts.resolveVoice(voice, language, gender, cleanSpoken);
    const ssml = microsoftNeuralTts.generateSSML(sentences, {
      voiceName: targetVoice,
      language,
      gender,
      rate,
      pitch,
      volume
    });

    res.json({
      ssml,
      sentences,
      cleanSpoken,
      voice: targetVoice,
      prosody: microsoftNeuralTts.calculateProsody({ language, gender, rate, pitch, volume })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
