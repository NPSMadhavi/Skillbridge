import masterPrisma from '../../config/masterPrisma.js';

/**
 * Get AI Tutor and Wake Word settings for the authenticated company
 */
export const getAiSettings = async (req, res) => {
  try {
    const tenantCode = req.user?.tenantCode || req.tenantCode || 'default';
    const rows = await masterPrisma.$queryRawUnsafe(
      `SELECT "id", "name", "code", "aiName", "wakeWord", "aiVoiceGender", "aiVoiceName", "aiVoiceRate", "aiVoicePitch"
       FROM "Company"
       WHERE "code" = $1
       LIMIT 1`,
      tenantCode
    ).catch(() => []);

    const company = rows[0] || null;
    const aiName = company?.aiName || 'ARIA';
    const wakeWord = company?.wakeWord || `Hey ${aiName}`;

    res.json({
      aiName,
      wakeWord,
      aiVoiceGender: company?.aiVoiceGender || 'FEMALE',
      aiVoiceName: company?.aiVoiceName || 'Veda',
      aiVoiceRate: company?.aiVoiceRate ?? 0.95,
      aiVoicePitch: company?.aiVoicePitch ?? 1.0,
      companyName: company?.name || tenantCode,
      companyCode: tenantCode
    });
  } catch (error) {
    console.error('Get AI settings error:', error);
    res.status(500).json({ error: 'Failed to retrieve AI settings.' });
  }
};

/**
 * Update AI Tutor and Wake Word settings for the authenticated company
 */
export const updateAiSettings = async (req, res) => {
  try {
    const tenantCode = req.user?.tenantCode || req.tenantCode || 'default';
    const { aiName, wakeWord, aiVoiceGender, aiVoiceName, aiVoiceRate, aiVoicePitch } = req.body;

    const cleanAiName = (aiName || '').trim() || 'ARIA';
    const cleanWakeWord = (wakeWord || '').trim() || `Hey ${cleanAiName}`;

    // Verify company exists
    const rows = await masterPrisma.$queryRawUnsafe(
      `SELECT "id", "name", "code", "aiName", "wakeWord", "aiVoiceGender", "aiVoiceName", "aiVoiceRate", "aiVoicePitch"
       FROM "Company"
       WHERE "code" = $1
       LIMIT 1`,
      tenantCode
    ).catch(() => []);

    const existingCompany = rows[0] || null;
    if (!existingCompany) {
      return res.status(404).json({ error: 'Company record not found in master database.' });
    }

    const newGender = aiVoiceGender || existingCompany.aiVoiceGender || 'FEMALE';
    const newVoiceName = aiVoiceName || existingCompany.aiVoiceName || 'Google US English';
    const newRate = typeof aiVoiceRate === 'number' ? aiVoiceRate : (existingCompany.aiVoiceRate ?? 0.95);
    const newPitch = typeof aiVoicePitch === 'number' ? aiVoicePitch : (existingCompany.aiVoicePitch ?? 1.0);

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

    console.log(`[AI Settings] Company "${tenantCode}" updated AI Name to "${cleanAiName}", Wake Word to "${cleanWakeWord}", Voice: ${newGender} / ${newVoiceName}`);

    res.json({
      success: true,
      message: `AI Tutor name set to "${cleanAiName}" with wake word "${cleanWakeWord}".`,
      settings: {
        aiName: cleanAiName,
        wakeWord: cleanWakeWord,
        aiVoiceGender: newGender,
        aiVoiceName: newVoiceName,
        aiVoiceRate: newRate,
        aiVoicePitch: newPitch,
        companyCode: tenantCode
      }
    });
  } catch (error) {
    console.error('Update AI settings error:', error);
    res.status(500).json({ error: error.message || 'Failed to update AI settings.' });
  }
};

/**
 * Public endpoint to get company AI settings for CoursePlayer / Learner
 */
export const getPublicCompanyAiSettings = async (req, res) => {
  try {
    const tenantCode = req.query.code || req.headers['x-tenant-id'] || req.tenantCode || 'default';
    const rows = await masterPrisma.$queryRawUnsafe(
      `SELECT "id", "name", "code", "aiName", "wakeWord", "aiVoiceGender", "aiVoiceName", "aiVoiceRate", "aiVoicePitch"
       FROM "Company"
       WHERE "code" = $1
       LIMIT 1`,
      tenantCode
    ).catch(() => []);

    const company = rows[0] || null;
    const aiName = company?.aiName || 'ARIA';
    const wakeWord = company?.wakeWord || `Hey ${aiName}`;

    res.json({
      aiName,
      wakeWord,
      aiVoiceGender: company?.aiVoiceGender || 'FEMALE',
      aiVoiceName: company?.aiVoiceName || 'Google US English',
      aiVoiceRate: company?.aiVoiceRate ?? 0.95,
      aiVoicePitch: company?.aiVoicePitch ?? 1.0,
      companyName: company?.name || tenantCode
    });
  } catch (error) {
    console.error('Get public AI settings error:', error);
    res.json({
      aiName: 'ARIA',
      wakeWord: 'Hey ARIA',
      aiVoiceGender: 'FEMALE',
      aiVoiceName: 'Google US English',
      aiVoiceRate: 0.95,
      aiVoicePitch: 1.0
    });
  }
};
