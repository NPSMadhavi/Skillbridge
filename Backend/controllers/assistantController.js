import masterPrisma from '../config/masterPrisma.js';
import aiService from '../services/aiService.js';
import { resolveLanguageInfo } from '../utils/language.js';

/**
 * Generate normalized wake word phonetic/conversational variants for a given name
 */
export function generateWakeWordVariants(name) {
  const clean = String(name || 'ARIA').trim();
  const lower = clean.toLowerCase();
  const variants = new Set([
    lower,
    `hey ${lower}`,
    `hi ${lower}`,
    `hello ${lower}`,
    `ok ${lower}`,
    `okay ${lower}`,
    `ask ${lower}`
  ]);

  // Common phonetic misrecognitions for popular virtual assistant names
  if (lower === 'veda' || lower === 'vedha') {
    variants.add('veda');
    variants.add('vedha');
    variants.add('vaida');
    variants.add('veeda');
    variants.add('hey veda');
    variants.add('hey vedha');
  } else if (lower === 'maya') {
    variants.add('maya');
    variants.add('maia');
    variants.add('mya');
    variants.add('hey maya');
  } else if (lower === 'aria') {
    variants.add('aria');
    variants.add('area');
    variants.add('arya');
    variants.add('hey aria');
    variants.add('hey area');
  }

  return Array.from(variants);
}

/**
 * Resolve the current company's AI settings from master database
 */
export async function resolveCompanyAiSettings(tenantCode = 'default') {
  try {
    const rows = await masterPrisma.$queryRawUnsafe(
      `SELECT "id", "name", "code", "aiName", "wakeWord", "aiVoiceGender", "aiVoiceName", "aiVoiceRate", "aiVoicePitch"
       FROM "Company"
       WHERE "code" = $1
       LIMIT 1`,
      tenantCode || 'default'
    ).catch(() => []);

    const company = rows[0] || null;
    const aiName = (company?.aiName || 'ARIA').trim();
    const wakeWord = (company?.wakeWord || `Hey ${aiName}`).trim();

    return {
      assistantName: aiName,
      aiName,
      wakeWord,
      wakeWordVariants: generateWakeWordVariants(aiName),
      aiVoiceGender: company?.aiVoiceGender || 'FEMALE',
      aiVoiceName: company?.aiVoiceName || 'Google US English',
      aiVoiceRate: company?.aiVoiceRate ?? 0.95,
      aiVoicePitch: company?.aiVoicePitch ?? 1.0,
      companyName: company?.name || tenantCode || 'SkillBridge Organization',
      companyCode: tenantCode || 'default'
    };
  } catch (err) {
    console.warn('[AssistantController] Resolve settings notice:', err.message);
    return {
      assistantName: 'ARIA',
      aiName: 'ARIA',
      wakeWord: 'Hey ARIA',
      wakeWordVariants: generateWakeWordVariants('ARIA'),
      aiVoiceGender: 'FEMALE',
      aiVoiceName: 'Google US English',
      aiVoiceRate: 0.95,
      aiVoicePitch: 1.0,
      companyName: 'SkillBridge Organization',
      companyCode: 'default'
    };
  }
}

/**
 * GET /api/assistant/settings or GET /api/v1/assistant/settings
 * Retrieves current active assistant name and wake-word configuration.
 */
export const getAssistantSettings = async (req, res) => {
  try {
    const tenantCode = req.user?.tenantCode || req.tenantCode || req.query.code || req.headers['x-tenant-id'] || 'default';
    const settings = await resolveCompanyAiSettings(tenantCode);
    res.json(settings);
  } catch (error) {
    console.error('[AssistantController] getAssistantSettings error:', error);
    res.status(500).json({ error: 'Failed to retrieve assistant settings.' });
  }
};

/**
 * PUT /api/assistant/settings or PUT /api/v1/assistant/settings
 * Updates the assistant name and wake-word settings persistently at runtime.
 */
export const updateAssistantSettings = async (req, res) => {
  try {
    const tenantCode = req.user?.tenantCode || req.tenantCode || 'default';
    const {
      assistantName,
      aiName,
      wakeWord,
      aiVoiceGender,
      aiVoiceName,
      aiVoiceRate,
      aiVoicePitch
    } = req.body;

    const rawName = String(assistantName || aiName || '').trim();

    // Validation: name must be 2 to 35 characters, containing valid name characters
    if (!rawName || rawName.length < 2 || rawName.length > 35) {
      return res.status(400).json({
        error: 'Assistant name must be between 2 and 35 characters.'
      });
    }

    if (!/^[\p{L}\p{N}\s'-]+$/u.test(rawName)) {
      return res.status(400).json({
        error: 'Assistant name contains invalid characters. Please use letters, numbers, hyphens, or spaces.'
      });
    }

    const cleanAiName = rawName;
    const cleanWakeWord = (wakeWord || '').trim() || `Hey ${cleanAiName}`;

    // Verify company in master database
    const rows = await masterPrisma.$queryRawUnsafe(
      `SELECT "id", "name", "code", "aiName", "wakeWord", "aiVoiceGender", "aiVoiceName", "aiVoiceRate", "aiVoicePitch"
       FROM "Company"
       WHERE "code" = $1
       LIMIT 1`,
      tenantCode
    ).catch(() => []);

    const existingCompany = rows[0] || null;
    const newGender = aiVoiceGender || existingCompany?.aiVoiceGender || 'FEMALE';
    const newVoiceName = aiVoiceName || existingCompany?.aiVoiceName || 'Google US English';
    const newRate = typeof aiVoiceRate === 'number' ? aiVoiceRate : (existingCompany?.aiVoiceRate ?? 0.95);
    const newPitch = typeof aiVoicePitch === 'number' ? aiVoicePitch : (existingCompany?.aiVoicePitch ?? 1.0);

    if (existingCompany) {
      await masterPrisma.$executeRawUnsafe(
        `UPDATE "Company"
         SET "aiName" = $1,
             "wakeWord" = $2,
             "aiVoiceGender" = $3,
             "aiVoiceName" = $4,
             "aiVoiceRate" = $5,
             "aiVoicePitch" = $6,
             "updatedAt" = NOW()
         WHERE "code" = $7`,
        cleanAiName,
        cleanWakeWord,
        newGender,
        newVoiceName,
        newRate,
        newPitch,
        tenantCode
      );
    } else {
      // Create or update default company record
      await masterPrisma.$executeRawUnsafe(
        `INSERT INTO "Company" ("id", "name", "code", "dbName", "dbUrl", "adminEmail", "aiName", "wakeWord", "aiVoiceGender", "aiVoiceName", "aiVoiceRate", "aiVoicePitch", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT ("code") DO UPDATE
         SET "aiName" = EXCLUDED."aiName",
             "wakeWord" = EXCLUDED."wakeWord",
             "updatedAt" = NOW()`,
        tenantCode,
        `skillbridge_tenant_${tenantCode}`,
        process.env.DATABASE_URL || '',
        'admin@skillbridge.com',
        cleanAiName,
        cleanWakeWord,
        newGender,
        newVoiceName,
        newRate,
        newPitch
      ).catch((e) => console.warn('[AssistantController] Company insert notice:', e.message));
    }

    console.log(`[AssistantController] Runtime settings updated: Assistant Name = "${cleanAiName}", Wake Word = "${cleanWakeWord}" for tenant "${tenantCode}"`);

    const updatedSettings = {
      assistantName: cleanAiName,
      aiName: cleanAiName,
      wakeWord: cleanWakeWord,
      wakeWordVariants: generateWakeWordVariants(cleanAiName),
      aiVoiceGender: newGender,
      aiVoiceName: newVoiceName,
      aiVoiceRate: newRate,
      aiVoicePitch: newPitch,
      companyCode: tenantCode
    };

    res.json({
      success: true,
      message: `Assistant name successfully updated to "${cleanAiName}". Wake word active: "${cleanWakeWord}".`,
      settings: updatedSettings
    });
  } catch (error) {
    console.error('[AssistantController] updateAssistantSettings error:', error);
    res.status(500).json({ error: error.message || 'Failed to update assistant settings.' });
  }
};

/**
 * POST /api/voice/ask or POST /api/v1/voice/ask
 * Processes a transcribed voice question and generates a personalized speech-ready answer.
 */
export const askVoiceAssistant = async (req, res) => {
  try {
    const {
      question,
      message,
      assistantName: requestedName,
      aiName: requestedAiName,
      language,
      context,
      conversationHistory
    } = req.body;

    const userQuestion = String(question || message || '').trim();
    if (!userQuestion) {
      return res.status(400).json({ error: 'Question text is required.' });
    }

    // Resolve assistant name: use explicitly provided, or fall back to tenant's persistent setting
    const tenantCode = req.user?.tenantCode || req.tenantCode || 'default';
    let assistantName = requestedName || requestedAiName;
    if (!assistantName) {
      const companySettings = await resolveCompanyAiSettings(tenantCode);
      assistantName = companySettings.assistantName || 'ARIA';
    }

    const targetLangInfo = resolveLanguageInfo(language || req.user?.preferredLanguage);

    console.log(`[Voice Ask] Assistant: "${assistantName}", Lang: "${targetLangInfo.name}", Question: "${userQuestion}"`);

    const response = await aiService.askAssistant({
      question: userQuestion,
      assistantName,
      language: targetLangInfo.code,
      context: context || '',
      conversationHistory: conversationHistory || []
    });

    res.json({
      ...response,
      language: targetLangInfo
    });
  } catch (error) {
    console.error('[Voice Ask] Error answering question:', error);
    res.status(500).json({
      error: error.message || 'The AI assistant is temporarily unavailable. Please try again.'
    });
  }
};
