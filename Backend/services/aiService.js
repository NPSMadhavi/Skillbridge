import axios from 'axios';
import dotenv from 'dotenv';
import {
  isGarbageTitle,
  firstUsefulTitleLine,
  cleanFileStem
} from '../utils/contentQuality.js';

dotenv.config();

class AIService {
  /**
   * Reads SKILLBRIDGE_LLM_GATEWAY_URL and strips a trailing slash.
   * Chat and health checks must use this same base URL (port 8081).
   */
  getGatewayBaseUrl() {
    const raw = (process.env.SKILLBRIDGE_LLM_GATEWAY_URL || '').trim();
    if (!raw) {
      const err = new Error('SKILLBRIDGE_LLM_GATEWAY_URL is not configured.');
      err.status = 503;
      throw err;
    }
    return raw.replace(/\/+$/, '');
  }

  getGatewayApiKey() {
    return (
      process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY ||
      process.env.LLM_GATEWAY_API_KEY ||
      process.env.VEDA_API_KEY ||
      ''
    ).trim();
  }

  getGatewayHeaders(extra = {}) {
    const headers = {
      Accept: 'application/json',
      ...extra
    };
    const apiKey = this.getGatewayApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
      headers['X-API-Key'] = apiKey;
    }
    return headers;
  }

  /**
   * GET ${SKILLBRIDGE_LLM_GATEWAY_URL}/health
   */
  async checkGatewayHealth() {
    const gatewayUrl = this.getGatewayBaseUrl();
    const response = await axios.get(`${gatewayUrl}/health`, {
      timeout: 10000,
      headers: this.getGatewayHeaders()
    });
    if (response.status < 200 || response.status >= 300) {
      const err = new Error('Local LLM gateway health check failed.');
      err.status = 503;
      throw err;
    }
    return response.data;
  }

  /**
   * Flattens system prompt, recent conversation, and user/RAG context into the
   * single `message` string required by the Veda gateway (not an OpenAI messages array).
   */
  _buildGatewayMessage(systemPrompt, userPrompt, jsonMode = false, conversationHistory = []) {
    const MAX_TOTAL_CHARS = 24000;
    const MAX_HISTORY_ITEM_CHARS = 600;
    const sections = [];

    const system = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
    if (system) sections.push(system);

    if (jsonMode) {
      sections.push('Output requirements: Return valid JSON only. Do not wrap the JSON in markdown fences or add commentary.');
    }

    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-8);
      const historyLines = [];
      for (const item of recentHistory) {
        const isUser = item.role === 'user' || item.sender === 'user';
        const content = item.content || item.text || '';
        if (typeof content !== 'string' || !content.trim()) continue;
        const clipped = content.trim().length > MAX_HISTORY_ITEM_CHARS
          ? `${content.trim().slice(0, MAX_HISTORY_ITEM_CHARS)}…`
          : content.trim();
        historyLines.push(`${isUser ? 'Student' : 'ARIA'}: ${clipped}`);
      }
      if (historyLines.length > 0) {
        sections.push(`Previous conversation:\n${historyLines.join('\n')}`);
      }
    }

    let user = typeof userPrompt === 'string' ? userPrompt.trim() : '';
    if (user) sections.push(user);

    let message = sections.filter(Boolean).join('\n\n');
    if (message.length > MAX_TOTAL_CHARS) {
      const withoutUser = sections.filter(s => s !== user).join('\n\n');
      const overhead = withoutUser.length + (withoutUser ? 2 : 0);
      const userBudget = Math.max(2000, MAX_TOTAL_CHARS - overhead - 80);
      const truncatedUser = `${user.slice(0, userBudget)}\n\n[Course context truncated to fit the model window.]`;
      message = [withoutUser, truncatedUser].filter(Boolean).join('\n\n');
    }
    return message;
  }

  _gatewayUnavailableError(status = 503) {
    const err = new Error('The AI tutor is temporarily unavailable. Please try again in a moment.');
    err.status = status;
    return err;
  }

  async _callOpenAIFallback(systemPrompt, userPrompt, jsonMode = false, conversationHistory = []) {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      return null;
    }
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    if (Array.isArray(conversationHistory)) {
      for (const item of conversationHistory.slice(-8)) {
        const isUser = item.role === 'user' || item.sender === 'user';
        const content = item.content || item.text || '';
        if (content && typeof content === 'string') {
          messages.push({ role: isUser ? 'user' : 'assistant', content });
        }
      }
    }
    if (userPrompt) {
      messages.push({ role: 'user', content: userPrompt });
    }

    const payload = {
      model,
      messages,
      temperature: 0.3
    };
    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    console.log(`[AIService] Local LLM gateway unavailable or timed out; seamlessly falling back to OpenAI (${model})...`);
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    const text = resp.data?.choices?.[0]?.message?.content;
    if (typeof text === 'string' && text.trim()) {
      return text.trim();
    }
    return null;
  }

  /**
   * Sends a single constructed tutor/curriculum prompt to the self-hosted Veda gateway.
   * POST ${SKILLBRIDGE_LLM_GATEWAY_URL}/chat  { "message": "..." }
   * Seamlessly falls back to OpenAI if the local gateway is slow, timed out, or unavailable.
   */
  async _callLLM(systemPrompt, userPrompt, jsonMode = false, conversationHistory = []) {
    let gatewayUrl;
    try {
      gatewayUrl = this.getGatewayBaseUrl();
    } catch {
      gatewayUrl = null;
    }

    if (gatewayUrl) {
      const message = this._buildGatewayMessage(systemPrompt, userPrompt, jsonMode, conversationHistory);
      try {
        const response = await axios.post(`${gatewayUrl}/chat`, { message }, {
          headers: this.getGatewayHeaders({ 'Content-Type': 'application/json' }),
          timeout: jsonMode ? 180000 : 25000
        });

        const text = response.data?.response;
        if (typeof text === 'string' && text.trim()) {
          return text.trim();
        }
        console.warn('[AIService] Local LLM gateway returned empty response. Attempting fallback...');
      } catch (error) {
        console.warn(`[AIService] Local LLM gateway issue (${error.code || error.response?.status || error.message}). Attempting OpenAI fallback...`);
      }
    }

    // Automatic fallback to OpenAI if configured
    try {
      const fallbackResult = await this._callOpenAIFallback(systemPrompt, userPrompt, jsonMode, conversationHistory);
      if (fallbackResult) {
        return fallbackResult;
      }
    } catch (fbError) {
      console.warn('[AIService] OpenAI fallback notice:', fbError.message);
    }

    throw this._gatewayUnavailableError(503);
  }

  /**
   * 768-d hashed n-gram embedding used when OpenAI embeddings are unavailable.
   * Same vector width as CourseChunk.embedding so pgvector search keeps working.
   */
  _localHashEmbedding(text, dimensions = 768) {
    const dim = dimensions || 768;
    const vec = new Array(dim).fill(0);
    const tokens = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
    const grams = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
      grams.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    for (const gram of grams) {
      let h = 2166136261;
      for (let i = 0; i < gram.length; i++) {
        h ^= gram.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % dim;
      vec[idx] += (h & 1) ? 1 : -1;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  _parseJsonObject(raw) {
    if (!raw || typeof raw !== 'string') {
      throw new Error('Empty LLM JSON response.');
    }
    let s = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json/gi, '```')
      .replace(/```/g, '')
      .trim();

    const tryParse = (text) => JSON.parse(String(text).replace(/,\s*([}\]])/g, '$1'));

    try {
      return tryParse(s);
    } catch {
      const startObj = s.indexOf('{');
      const endObj = s.lastIndexOf('}');
      const startArr = s.indexOf('[');
      const endArr = s.lastIndexOf(']');
      if (startObj >= 0 && endObj > startObj) {
        try {
          return tryParse(s.slice(startObj, endObj + 1));
        } catch { /* continue */ }
      }
      if (startArr >= 0 && endArr > startArr) {
        const arr = tryParse(s.slice(startArr, endArr + 1));
        if (Array.isArray(arr)) {
          if (arr[0]?.concept || arr[0]?.chunkText) return { chunks: arr };
          if (arr[0]?.title) return { lessons: arr };
          return { items: arr };
        }
      }
      throw new Error('LLM response was not valid JSON.');
    }
  }

  /**
   * Explains the content currently visible in the learner's document viewer.
   * Adheres strictly to the Qwen AI Tutor prompt and returns structured JSON:
   * {
   *   page_or_slide_number: number,
   *   title: string,
   *   spoken_explanation: string,
   *   key_points: string[],
   *   safety_warnings: string[],
   *   suggested_next_transition: string
   * }
   */
  async explainVisibleContent(contentInfo, courseTitle = '', language = 'en') {
    const pageNum = contentInfo.pageNumber || contentInfo.page_number || contentInfo.slideNumber || 1;
    const pageTitle = contentInfo.title || `Page ${pageNum}`;
    const rawContent = contentInfo.text || contentInfo.fullText || contentInfo.content || '';
    const visualDesc = (contentInfo.visuals || contentInfo.images || [])
      .map(v => v.name || v.descr || '')
      .filter(Boolean)
      .join('; ') || '';

    const systemPrompt = `You are SkillBridge AI Tutor, an instructor explaining uploaded training materials.
Explain the content currently visible in the learner's document viewer.

Rules:
- Use the extracted content from the uploaded file and approved course context as your source of truth.
- Explain the visible page or slide in its original reading order.
- Explain headings, paragraphs, bullet points, tables, diagrams, examples, and safety instructions when their content is available.
- Use simple, practical language suitable for the learner.
- Give additional examples only when useful and consistent with the source.
- Do not invent facts or claim to see information that has not been extracted.
- Do not redesign, recreate, or replace the original document.
- Keep the original page or slide visible while explaining it.
- Answer follow-up questions using the current page and relevant course context.
- If information is unavailable, clearly acknowledge the limitation.
- Generate a natural spoken explanation suitable for text-to-speech.
${language && language !== 'en' ? `- Provide the spoken_explanation, key_points, safety_warnings, and suggested_next_transition in ${language}.` : ''}

Return structured output containing ONLY valid JSON matching:
{
  "page_or_slide_number": ${pageNum},
  "title": "${pageTitle.replace(/"/g, '\\"')}",
  "spoken_explanation": "Natural, clear spoken explanation of this exact page or slide for text-to-speech narration...",
  "key_points": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"],
  "safety_warnings": ["Any safety precautions, warnings, or operational caveats mentioned, or empty if none"],
  "suggested_next_transition": "Short transition phrase leading to the next section or conclusion"
}`;

    const userPrompt = `Training Course: "${courseTitle}"
Visible Page/Slide: ${pageNum} (${pageTitle})
${visualDesc ? `Visual/Diagram Elements: ${visualDesc}\n` : ''}
Extracted Document Content for this Page/Slide:
${rawContent.slice(0, 10000)}

Provide your structured explanation for this visible content.`;

    try {
      const response = await this._callLLM(systemPrompt, userPrompt, true);
      const parsed = this._parseJsonObject(response);
      if (parsed && (parsed.spoken_explanation || parsed.title)) {
        return {
          page_or_slide_number: parsed.page_or_slide_number || pageNum,
          title: parsed.title || pageTitle,
          spoken_explanation: parsed.spoken_explanation || parsed.explanation || '',
          key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
          safety_warnings: Array.isArray(parsed.safety_warnings) ? parsed.safety_warnings : [],
          suggested_next_transition: parsed.suggested_next_transition || 'Let us proceed to the next section.'
        };
      }
    } catch (err) {
      console.warn('[AIService] explainVisibleContent LLM notice, using structured fallback:', err.message);
    }

    // Structured fallback
    return {
      page_or_slide_number: pageNum,
      title: pageTitle,
      spoken_explanation: `In this section of ${courseTitle || 'the course'}, we review ${pageTitle}. ${rawContent ? rawContent.slice(0, 300).replace(/\\n+/g, ' ') : 'Please observe the document content displayed on screen.'}`,
      key_points: [
        `Review the core guidelines shown on page ${pageNum}`,
        `Follow standard operational procedures outlined in the training material`
      ],
      safety_warnings: [],
      suggested_next_transition: `Proceed to page ${pageNum + 1} when ready.`
    };
  }

  _slideTeachingText(slide) {
    if (!slide) return '';
    const visual = (slide.images || [])
      .map(img => img.visionText || img.ocrText)
      .filter(t => t && String(t).trim().length > 12)
      .join('\n');
    const parts = [
      visual,
      ...(slide.headings || []),
      ...(slide.bulletPoints || []),
      ...(slide.paragraphs || []),
      slide.speakerNotes || ''
    ].map(p => String(p || '').trim()).filter(Boolean);
    const unique = [];
    for (const part of parts) {
      if (!unique.some(u => u === part || (part.length > 40 && u.includes(part)))) unique.push(part);
    }
    return unique.join('\n').trim();
  }

  _compactSlideSummaries(slides, maxChars = 16000) {
    const lines = [];
    for (const s of slides || []) {
      const teaching = this._slideTeachingText(s).replace(/\s+/g, ' ').trim();
      const title = isGarbageTitle(s.title) ? '' : String(s.title).trim();
      const body = teaching.slice(0, 220);
      lines.push(`Slide ${s.slideNumber}${title ? ` | ${title}` : ''}: ${body || '(image slide — describe from vision if present)'}`);
    }
    let out = lines.join('\n');
    if (out.length > maxChars) {
      out = `${out.slice(0, maxChars)}\n[Additional slides omitted for length. Cover the whole deck by grouping remaining slides into existing topics.]`;
    }
    return out;
  }

  _sampleSlides(slides, max = 80) {
    if (!Array.isArray(slides) || slides.length <= max) return slides || [];
    const out = [];
    const step = slides.length / max;
    for (let i = 0; i < max; i++) {
      out.push(slides[Math.min(slides.length - 1, Math.floor(i * step))]);
    }
    return out;
  }

  _lessonDuration(index, lesson = null) {
    const exp = lesson?.explanation || lesson?.explanations?.en || '';
    if (exp && exp.length > 30) {
      const words = exp.trim().split(/\s+/).filter(Boolean).length;
      const totalSecs = Math.max(75, Math.min(300, Math.round(words / 2.15)));
      const m = Math.floor(totalSecs / 60).toString().padStart(2, '0');
      const s = Math.floor(totalSecs % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    }
    const slideCount = Array.isArray(lesson?.sourceSlides) && lesson.sourceSlides.length > 0 ? lesson.sourceSlides.length : 1;
    const baseSecs = Math.min(300, Math.max(75, slideCount * 75 + ((index * 17) % 35)));
    const m = Math.floor(baseSecs / 60).toString().padStart(2, '0');
    const s = Math.floor(baseSecs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  _defaultQuiz(courseTitle, lessonTitle) {
    const topic = lessonTitle || courseTitle;
    return [
      {
        question: `What is the main purpose of "${topic}"?`,
        options: [
          `To learn and follow the required procedures for ${topic}`,
          'To skip safety checks',
          'To ignore workplace rules',
          'None of the above'
        ],
        answerIndex: 0,
        explanation: `This lesson trains learners to follow the required procedures for ${topic}.`
      }
    ];
  }

  _buildCourseFromLessons(fileName, lessons, quiz = null) {
    const cleanName = cleanFileStem(fileName);
    const formattedTitle = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const modulesMap = [];
    const moduleKey = new Map();

    const normalized = (lessons || []).map((l, idx) => {
      const moduleTitle = (!isGarbageTitle(l.moduleTitle) && l.moduleTitle)
        || (!isGarbageTitle(l.chapterTitle) && l.chapterTitle)
        || formattedTitle;
      if (!moduleKey.has(moduleTitle)) {
        moduleKey.set(moduleTitle, modulesMap.length + 1);
        modulesMap.push({
          title: moduleTitle,
          lessons: 0,
          duration: '0m',
          totalSecs: 0,
          locked: modulesMap.length > 0
        });
      }
      const modId = moduleKey.get(moduleTitle);
      modulesMap[modId - 1].lessons += 1;

      const sourceSlides = Array.isArray(l.sourceSlides)
        ? l.sourceSlides.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
        : [];

      // Calculate realistic dynamic duration (override static "08:00" or empty placeholders)
      let duration = l.duration;
      if (!duration || duration === '08:00' || duration === '8m' || duration === '10 mins') {
        duration = this._lessonDuration(idx, { ...l, sourceSlides });
      }

      const parts = String(duration).split(':').map(p => parseInt(p, 10) || 0);
      const lessonSecs = parts.length === 2 ? parts[0] * 60 + parts[1] : (parseInt(duration, 10) || 120);
      modulesMap[modId - 1].totalSecs += lessonSecs;
      modulesMap[modId - 1].duration = `${Math.max(1, Math.round(modulesMap[modId - 1].totalSecs / 60))}m`;

      return {
        ...l,
        id: idx + 1,
        chapterId: modId,
        chapterTitle: moduleTitle,
        moduleId: modId,
        moduleTitle,
        title: l.title,
        sourceSlides,
        duration,
        status: idx === 0 ? 'active' : 'locked'
      };
    });

    // Cleanup temporary totalSecs helper
    modulesMap.forEach(m => delete m.totalSecs);

    if (normalized.length === 0) {
      normalized.push({
        id: 1,
        chapterId: 1,
        chapterTitle: formattedTitle,
        moduleId: 1,
        moduleTitle: formattedTitle,
        title: `${formattedTitle} Core Training`,
        sourceSlides: [1],
        duration: '02:30',
        status: 'active'
      });
      modulesMap.push({ title: formattedTitle, lessons: 1, duration: '3m', locked: false });
    }

    return {
      title: `${formattedTitle} Training Program`,
      description: `Training program covering the actual topics in ${formattedTitle}.`,
      learning: normalized.slice(0, 4).map(l => `Understand and apply: ${l.title}`),
      includes: [
        'Interactive ARIA AI Avatar Tutoring',
        `${normalized.length} training lessons`,
        `${modulesMap.length} content-driven modules`,
        'Digital verified completion certificate'
      ],
      curriculum: modulesMap,
      lessons: normalized,
      quiz: Array.isArray(quiz) && quiz.length > 0 ? quiz : this._defaultQuiz(formattedTitle, normalized[0]?.title)
    };
  }

  _groupSlidesIntoLessons(slides, fileName) {
    const cleanName = cleanFileStem(fileName);
    const source = (slides || []).length ? slides : [];
    const target = Math.min(18, Math.max(1, Math.ceil(Math.max(source.length, 1) / 6)));
    const groupSize = Math.max(1, Math.ceil(source.length / target));
    const lessons = [];

    for (let i = 0; i < source.length; i += groupSize) {
      const group = source.slice(i, i + groupSize);
      const teaching = group.map(s => this._slideTeachingText(s)).join('\n');
      let title = firstUsefulTitleLine(teaching);
      if (!title && group[0] && !isGarbageTitle(group[0].title)) title = group[0].title;
      if (!title) title = `${cleanName} — Part ${lessons.length + 1}`;
      const moduleIdx = Math.floor(lessons.length / 3);
      lessons.push({
        title,
        moduleTitle: `${cleanName} Module ${moduleIdx + 1}`,
        sourceSlides: group.map(s => s.slideNumber),
        duration: this._lessonDuration(lessons.length)
      });
    }

    return this._buildCourseFromLessons(fileName, lessons);
  }

  _sanitizeGeneratedCourse(parsed, slides, fileName) {
    const slideCount = (slides || []).length;
    let lessons = Array.isArray(parsed?.lessons) ? parsed.lessons : [];
    lessons = lessons.filter(l => l && !isGarbageTitle(l.title));

    if (lessons.length === 0) {
      return this._groupSlidesIntoLessons(slides, fileName);
    }

    // 1. Deduplicate lessons covering the exact same slides or identical title
    const seenSlideKeys = new Set();
    const seenTitles = new Set();
    const deduped = [];
    for (const l of lessons) {
      const sns = Array.isArray(l.sourceSlides) ? [...l.sourceSlides].sort((a, b) => a - b).join(',') : '';
      const cleanT = String(l.title || '').trim().toLowerCase();
      if (sns && seenSlideKeys.has(sns)) continue;
      if (cleanT && seenTitles.has(cleanT)) continue;
      if (sns) seenSlideKeys.add(sns);
      if (cleanT) seenTitles.add(cleanT);
      deduped.push(l);
    }
    lessons = deduped.length ? deduped : lessons;

    // 2. Prevent over-fragmentation: aim for meaningful chunks of 2-5 slides per lesson
    const maxTarget = slideCount > 0 ? Math.min(14, Math.max(4, Math.ceil(slideCount / 2.5))) : 16;
    if (lessons.length > maxTarget) {
      const groupSize = Math.ceil(lessons.length / maxTarget);
      const merged = [];
      for (let i = 0; i < lessons.length; i += groupSize) {
        const group = lessons.slice(i, i + groupSize);
        const sourceSlides = [...new Set(group.flatMap(l => Array.isArray(l.sourceSlides) ? l.sourceSlides : []))];
        merged.push({
          ...group[0],
          title: group.length > 1 && !group[0].title.includes('&') ? `${group[0].title} & Applications` : group[0].title,
          moduleTitle: group[0].moduleTitle || group[0].chapterTitle,
          sourceSlides
        });
      }
      lessons = merged;
    }

    const course = this._buildCourseFromLessons(fileName, lessons, parsed.quiz);
    if (parsed.title && !isGarbageTitle(parsed.title)) course.title = parsed.title;
    if (parsed.description) course.description = parsed.description;
    if (Array.isArray(parsed.learning) && parsed.learning.length) course.learning = parsed.learning;
    if (Array.isArray(parsed.includes) && parsed.includes.length) course.includes = parsed.includes;

    course.lessons = course.lessons.map((l, idx) => {
      let matchedSlides = (l.sourceSlides || []).filter(n => n >= 1 && n <= Math.max(1, slideCount));
      if (matchedSlides.length === 0 && slideCount > 0) {
        const byTitle = slides.filter(s =>
          l.title && s.title && !isGarbageTitle(s.title) && (
            l.title.toLowerCase().includes(String(s.title).toLowerCase()) ||
            String(s.title).toLowerCase().includes(l.title.toLowerCase())
          )
        ).map(s => s.slideNumber);
        matchedSlides = byTitle.length ? byTitle : [Math.min(slideCount, idx + 1)];
      }
      return { ...l, sourceSlides: matchedSlides };
    });

    return course;
  }

  async _chunkByCurriculumLessons(fileName, docMetadata = {}) {
    const { slides = [], curriculum } = docMetadata;
    const lessons = curriculum.lessons || [];
    const slideMap = new Map((slides || []).map(s => [s.slideNumber, s]));

    const lessonBlocks = lessons.map((lesson, idx) => {
      const sns = Array.isArray(lesson.sourceSlides) ? lesson.sourceSlides : [];
      const material = sns
        .map(n => this._slideTeachingText(slideMap.get(n)))
        .filter(Boolean)
        .join('\n')
        .slice(0, 900);
      return `LESSON ${idx + 1}: ${lesson.title}\nMODULE: ${lesson.moduleTitle || lesson.chapterTitle || ''}\nSLIDES: ${sns.join(', ') || 'unknown'}\nMATERIAL:\n${material || '(image-based slide — write a trainer explanation of this lesson topic)'}`;
    }).join('\n\n---\n\n');

    const systemPrompt = `You are SkillBridge's knowledge engineer. Using the local training material, write semantic knowledge chunks for ARIA.
Rules:
- One chunk per lesson.
- Ignore OCR garbage, random symbols, font names, and unreadable fragments.
- Titles/concepts must be readable training topics (English or Bangla words), never strings like "UT5FAMX%" or "#E.R$#E*".
- chunkText is a trainer explanation of what the learner must know and do.
- Preserve sourceSlides.
Return ONLY JSON:
{"chunks":[{"concept":"Readable concept name","topic":"Module name","keyPoints":["..."],"sourceSlides":[1,2],"chunkText":"### 📌 Concept: ...\\n\\n..."}]}`;

    const aiResponse = await this._callLLM(systemPrompt, `File: ${fileName}\n\n${lessonBlocks}`, true);
    const parsed = this._parseJsonObject(aiResponse);
    if (!parsed?.chunks?.length) throw new Error('No chunks from curriculum-guided LLM pass.');
    const withSources = parsed.chunks.map((c, idx) => ({
      ...c,
      concept: isGarbageTitle(c.concept) ? (lessons[idx]?.title || c.concept) : c.concept,
      sourceSlides: Array.isArray(c.sourceSlides) && c.sourceSlides.length
        ? c.sourceSlides
        : (lessons[idx]?.sourceSlides || [])
    }));
    return this._formatSynthesizedChunks(withSources, docMetadata);
  }

  /**
   * Generates a single vector embedding using OpenAI text-embedding-3-small,
   * falling back to a local 768-d hash embedding if OpenAI has no credits.
   */
  async getEmbedding(text, dimensions = 768) {
    if (!text || !text.trim()) return null;
    if (this._openaiEmbedUnavailable) {
      return this._localHashEmbedding(text, dimensions);
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1';

    if (!apiKey) {
      this._openaiEmbedUnavailable = true;
      console.warn('[AIService] OPENAI_API_KEY is not configured for embeddings. Using local 768-d embeddings.');
      return this._localHashEmbedding(text, dimensions);
    }

    try {
      const response = await axios.post(`${baseUrl}/embeddings`, {
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
        dimensions: dimensions
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 30000
      });
      return response.data?.data?.[0]?.embedding || this._localHashEmbedding(text, dimensions);
    } catch (err) {
      this._openaiEmbedUnavailable = true;
      console.warn('[AIService] OpenAI embeddings unavailable. Using local 768-d embeddings:', err.response?.data?.error?.message || err.message);
      return this._localHashEmbedding(text, dimensions);
    }
  }

  /**
   * Generates batch vector embeddings using OpenAI text-embedding-3-small,
   * falling back to local 768-d hash embeddings if OpenAI has no credits.
   */
  async getEmbeddings(textArray, dimensions = 768) {
    if (!textArray || !Array.isArray(textArray) || textArray.length === 0) return [];
    const cleanInputs = textArray.map(t => (typeof t === 'string' ? t.slice(0, 8000) : ''));
    if (this._openaiEmbedUnavailable) {
      return cleanInputs.map(t => this._localHashEmbedding(t, dimensions));
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1';

    if (!apiKey) {
      this._openaiEmbedUnavailable = true;
      console.warn('[AIService] OPENAI_API_KEY is not configured for batch embeddings. Using local 768-d embeddings.');
      return cleanInputs.map(t => this._localHashEmbedding(t, dimensions));
    }

    try {
      const response = await axios.post(`${baseUrl}/embeddings`, {
        model: 'text-embedding-3-small',
        input: cleanInputs,
        dimensions: dimensions
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 60000
      });
      const vectors = response.data?.data?.map(d => d.embedding) || [];
      if (vectors.length === cleanInputs.length) return vectors;
    } catch (err) {
      this._openaiEmbedUnavailable = true;
      console.warn('[AIService] OpenAI batch embeddings unavailable. Using local 768-d embeddings:', err.response?.data?.error?.message || err.message);
    }
    return cleanInputs.map(t => this._localHashEmbedding(t, dimensions));
  }

  /**
   * AI-Driven Document Comprehension and Semantic Knowledge Chunking Engine.
   * Studies and understands the complete document before synthesizing meaning-based, dynamic-sized knowledge units.
   * Preserves relationships (definition+explanation, concept+example, multi-slide concepts).
   *
   * @param {string} fileName - Document filename.
   * @param {string} fullText - Full document text.
   * @param {object} docMetadata - { fileType, slides, pages, curriculum }
   * @returns {Promise<Array<object>>} Structured semantic chunks ready for validation and pgvector embedding.
   */
  async understandAndChunkDocument(fileName, fullText, docMetadata = {}) {
    const { fileType = 'document', slides = [], pages = [], curriculum = null } = docMetadata;
    const isPpt = fileType === 'pptx' || fileType === 'ppt' || slides.length > 0;
    const textLength = (fullText || '').length;

    console.log(`[AI Comprehension] Studying document "${fileName}" (${fileType.toUpperCase()}, ${textLength} chars, ${slides.length} slides, ${pages.length} pages)...`);

    // For very large documents (> 35k chars or > 24 slides), use hierarchical multi-pass comprehension
    if (textLength > 35000 || slides.length > 24) {
      console.log(`[AI Comprehension] Large document detected. Initiating hierarchical multi-pass understanding...`);
      return await this._understandLargeDocumentHierarchically(fileName, fullText, docMetadata);
    }

    // Build structured document context for standard-sized documents
    let docContext = '';
    if (isPpt && slides.length > 0) {
      docContext = slides.map(s => {
        let sDesc = `[SLIDE ${s.slideNumber}: ${s.title}]\n`;
        if (s.headings?.length) sDesc += `Headings: ${s.headings.join(' | ')}\n`;
        if (s.paragraphs?.length) sDesc += s.paragraphs.join('\n') + '\n';
        if (s.bulletPoints?.length) sDesc += s.bulletPoints.join('\n') + '\n';
        if (s.tables?.length) sDesc += s.tables.join('\n') + '\n';
        if (s.images?.length) {
          sDesc += `Visuals on Slide: ` + s.images.map(img => `[Visual ID: ${img.id}] "${img.name}"`).join('; ') + '\n';
          const visualText = s.images.map(img => img.visionText || img.ocrText).filter(Boolean).join('\n');
          if (visualText) {
            sDesc += `Visible training text read from slide images (explain this to learners):\n${visualText}\n`;
          }
        }
        if (s.speakerNotes) sDesc += `Speaker Notes: ${s.speakerNotes}\n`;
        return sDesc.trim();
      }).join('\n\n--- NEXT SLIDE ---\n\n');
    } else if (pages.length > 0) {
      docContext = pages.map(p => `[PAGE ${p.page_number}${p.title ? `: ${p.title}` : ''}]\n${p.text}`).join('\n\n--- NEXT PAGE ---\n\n');
    } else {
      docContext = fullText.slice(0, 32000);
    }

    const systemPrompt = `You are the Senior Curriculum Architect & Master Knowledge Engineer for SkillBridge.
Your mission is to DEEPLY STUDY AND UNDERSTAND the provided course document and synthesize COMPLETE, MEANING-BASED SEMANTIC KNOWLEDGE CHUNKS for ARIA, our AI Tutor.

CRITICAL ARCHITECTURE RULES (MEANING-BASED CHUNKING):
1. UNDERSTAND FIRST, CHUNK SECOND:
   - Study the entire material holistically before formulating knowledge units.
   - Build a natural knowledge hierarchy from the actual material: Course -> Module -> Topic -> Subtopic -> Concept.
   - NEVER use arbitrary character counts or fixed text splitting.

2. MEANING-BASED, COMPLETE CONCEPTS:
   - Every chunk must represent a complete, self-contained knowledge unit explaining one cohesive concept thoroughly.
   - Chunk sizes are DYNAMIC: a chunk can be short or long depending on what is required to explain the concept completely.

3. PRESERVE RELATIONSHIPS (NEVER SEPARATE WHAT BELONGS TOGETHER):
   - Keep definitions with their explanations and background.
   - Keep concepts with their concrete examples, code, or illustrations.
   - Keep procedures and algorithms with all sequential steps.
   - Keep formulas with their variables and explanations.
   - Keep slide headings with all supporting bullets and speaker notes.

4. POWERPOINT & MULTI-SLIDE INTELLIGENCE:
   - DO NOT assume 1 slide = 1 chunk!
   - If multiple consecutive slides together explain one larger concept (e.g. Slide 10: "Neural Networks", Slide 11: "Architecture", Slide 12: "Input Layer", Slide 13: "Hidden Layer", Slide 14: "Output Layer"), COMBINE them into ONE coherent semantic knowledge unit!
   - Record ALL source slide numbers in the "sourceSlides" array (e.g. [10, 11, 12, 13, 14]).

4b. IGNORE OCR / BINARY GARBAGE:
   - Never create a chunk whose concept is unreadable (e.g. "UT5FAMX%", "#E.R$#E*", "^^~^^~").
   - If a slide title is noise, invent a clear training title from the vision/OCR meaning.
   - Group related slides. Typical courses have 6-18 chunks, never one chunk per noisy fragment.

5. SOURCE GROUNDING & TRACEABILITY:
   - Ground every chunk strictly in the source material. Do not hallucinate external facts.
   - For presentations: set "sourceSlides" (array of numbers like [1, 2]).
   - For documents/PDFs: set "sourcePage" (number or primary page).
   - Set "sourceSection" (heading/section title).

6. VISUAL INTEGRATION & TIMING:
   - When a slide has supporting images, photos, charts, or diagrams, link them to the relevant concept.
   - Specify "purpose" and "triggerKeywords" so ARIA knows exactly when to display the visual during lecture playback.
   - If a slide is image-based, use "Visible training text read from slide images" as the source of truth and write chunkText as a trainer explanation of that visual.

7. EASY-TO-EXPLAIN KNOWLEDGE FOR ARIA:
   - Each chunk must contain rich pedagogical context so ARIA can explain it in clear, natural teaching language.
   - Synthesize "chunkText" as a structured, beautifully formatted markdown teaching block:
     Include: Concept name, definition & intuitive explanation, technical details, practical example, key takeaways, and source tag.

8. OUTPUT FORMAT:
   Return ONLY a valid JSON object matching this schema exactly:
{
  "courseTitle": "Clear descriptive title derived from the material",
  "courseDomain": "Domain/Subject area",
  "learningHierarchy": [
    {
      "moduleTitle": "Module 1: Foundations",
      "topics": [
        {
          "topicTitle": "Topic 1.1: Core Concept",
          "subtopics": ["Subtopic A", "Subtopic B"]
        }
      ]
    }
  ],
  "chunks": [
    {
      "concept": "Precise Concept Name (e.g. Supervised Learning)",
      "topic": "Parent Topic Name (e.g. Machine Learning Paradigms)",
      "subtopic": "Subtopic Name if applicable",
      "module": "Parent Module Name",
      "chunkType": "concept",
      "explanation": "Clear, intuitive explanation of the concept for beginners...",
      "details": "In-depth mechanisms, inner workings, formulas, or architecture...",
      "example": "Concrete practical example, real-world application, or code snippet...",
      "keyPoints": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"],
      "relatedConcepts": ["Related Concept A", "Related Concept B"],
      "prerequisites": "Prerequisite knowledge if any",
      "sourcePage": 1,
      "sourceSlides": [1, 2],
      "sourceSection": "Section title",
      "chunkText": "### 📌 Concept: Supervised Learning\\n**Topic:** Machine Learning Paradigms\\n\\n**Definition & Explanation:**\\nSupervised learning is...\\n\\n**How It Works:**\\n...\\n\\n**Practical Example:**\\n...\\n\\n**Key Takeaways:**\\n- Point 1\\n- Point 2\\n\\n*(Source: Slides 1, 2 / Section 1)*"
    }
  ]
}`;

    const userPrompt = `Document Filename: ${fileName}\nDocument Format: ${fileType.toUpperCase()}\nDocument Content:\n\n${docContext}`;

    try {
      const aiResponse = await this._callLLM(systemPrompt, userPrompt, true);
      const parsed = this._parseJsonObject(aiResponse);

      if (parsed && Array.isArray(parsed.chunks) && parsed.chunks.length > 0) {
        console.log(`[AI Comprehension] AI synthesized ${parsed.chunks.length} high-fidelity semantic knowledge chunks.`);
        return this._formatSynthesizedChunks(parsed.chunks, docMetadata);
      }
      throw new Error('AI response did not contain valid chunks array.');
    } catch (e) {
      console.warn('[AI Comprehension] LLM understanding pass fallback triggered:', e.message);
      return this._getStructuralSemanticChunks(fileName, fullText, docMetadata);
    }
  }

  /**
   * Hierarchical Multi-Pass Comprehension for Large Documents (> 35k chars or > 24 slides).
   * 1. Batches sections/slides into cohesive clusters.
   * 2. Extracts local concepts and summaries for each batch.
   * 3. Global synthesis pass builds unified knowledge hierarchy and coherent chunks.
   */
  async _understandLargeDocumentHierarchically(fileName, fullText, docMetadata = {}) {
    const { fileType = 'document', slides = [], pages = [] } = docMetadata;
    const isPpt = fileType === 'pptx' || fileType === 'ppt' || slides.length > 0;

    const batches = [];
    if (isPpt && slides.length > 0) {
      const batchSize = 8;
      for (let i = 0; i < slides.length; i += batchSize) {
        const slice = slides.slice(i, i + batchSize);
        batches.push({
          label: `Slides ${slice[0].slideNumber}-${slice[slice.length - 1].slideNumber}`,
          slides: slice,
          text: slice.map(s => `[SLIDE ${s.slideNumber}: ${isGarbageTitle(s.title) ? 'Untitled' : s.title}]\n${this._slideTeachingText(s) || s.fullText || ''}`).join('\n\n')
        });
      }
    } else if (pages.length > 0) {
      const batchSize = 6;
      for (let i = 0; i < pages.length; i += batchSize) {
        const slice = pages.slice(i, i + batchSize);
        batches.push({
          label: `Pages ${slice[0].page_number}-${slice[slice.length - 1].page_number}`,
          pages: slice,
          text: slice.map(p => `[Page ${p.page_number}] ${p.text}`).join('\n\n')
        });
      }
    } else {
      const chunkSize = 12000;
      let offset = 0;
      let partIndex = 1;
      while (offset < fullText.length) {
        const end = Math.min(offset + chunkSize, fullText.length);
        batches.push({
          label: `Part ${partIndex++}`,
          text: fullText.slice(offset, end)
        });
        offset = end;
      }
    }

    console.log(`[AI Hierarchical] Processing large document in ${batches.length} hierarchical section batches...`);

    const allSynthesizedChunks = [];
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log(`[AI Hierarchical] Processing batch ${b + 1}/${batches.length} (${batch.label})...`);

      const batchPrompt = `You are the Senior Knowledge Architect for SkillBridge.
Analyze this specific section of the course document ("${fileName}") and extract COMPLETE, MEANING-BASED SEMANTIC KNOWLEDGE CHUNKS.
Current Section: ${batch.label}.

RULES:
1. Extract self-contained concept units (Concept, Topic, Explanation, Details, Example, Key Points).
2. Dynamic sizing. Combine related consecutive slides/pages explaining one concept.
3. Preserve all source references (sourceSlides or sourcePage).
4. Return ONLY raw JSON matching:
{
  "chunks": [
    {
      "concept": "Concept Name",
      "topic": "Topic Name",
      "subtopic": "Subtopic Name",
      "module": "Module Name",
      "chunkType": "concept",
      "explanation": "Simple clear explanation...",
      "details": "Technical details...",
      "example": "Practical example...",
      "keyPoints": ["Point 1", "Point 2"],
      "relatedConcepts": ["Related A"],
      "sourcePage": 1,
      "sourceSlides": [1, 2],
      "sourceSection": "${batch.label}",
      "chunkText": "### 📌 Concept: Name\\n**Topic:** Topic\\n\\n**Explanation:**\\n...\\n\\n**Key Takeaways:**\\n- Point 1"
    }
  ]
}`;

      try {
        const res = await this._callLLM(batchPrompt, batch.text, true);
        const parsed = this._parseJsonObject(res);
        if (parsed && Array.isArray(parsed.chunks) && parsed.chunks.length > 0) {
          allSynthesizedChunks.push(...parsed.chunks);
        }
      } catch (err) {
        console.warn(`[AI Hierarchical] Batch ${batch.label} LLM fallback:`, err.message);
        // Fallback for this specific batch
        const fallbackChunks = this._getStructuralSemanticChunks(fileName, batch.text, {
          fileType,
          slides: batch.slides || [],
          pages: batch.pages || []
        });
        allSynthesizedChunks.push(...fallbackChunks);
      }
    }

    if (allSynthesizedChunks.length > 0) {
      console.log(`[AI Hierarchical] Synthesized ${allSynthesizedChunks.length} total semantic chunks across all batches.`);
      return this._formatSynthesizedChunks(allSynthesizedChunks, docMetadata);
    }

    return this._getStructuralSemanticChunks(fileName, fullText, docMetadata);
  }

  /**
   * Normalizes and cleans synthesized AI chunks with fallback metadata.
   */
  _formatSynthesizedChunks(chunks, docMetadata = {}) {
    const { slides = [] } = docMetadata;
    const slideMap = new Map();
    if (Array.isArray(slides)) {
      for (const s of slides) {
        if (s.slideNumber && Array.isArray(s.images) && s.images.length > 0) {
          slideMap.set(s.slideNumber, s.images);
        }
      }
    }

    return chunks.map((c, idx) => {
      const rawConcept = c.concept || c.title || `Core Concept ${idx + 1}`;
      const concept = isGarbageTitle(rawConcept) ? `Core Concept ${idx + 1}` : rawConcept;
      const topic = c.topic || c.module || 'General Curriculum';
      const subtopic = c.subtopic || null;
      const chunkType = c.chunkType || 'concept';
      const keyPoints = Array.isArray(c.keyPoints) ? c.keyPoints : [];
      const relatedConcepts = Array.isArray(c.relatedConcepts) ? c.relatedConcepts : [];
      const sourceSlides = Array.isArray(c.sourceSlides)
        ? c.sourceSlides
        : (typeof c.sourceSlide === 'number' ? [c.sourceSlide] : null);
      const sourcePage = typeof c.sourcePage === 'number'
        ? c.sourcePage
        : (sourceSlides ? sourceSlides[0] : 1);

      // Collect associated slide visuals from source slides
      const visuals = [];
      if (sourceSlides && sourceSlides.length > 0) {
        for (const sn of sourceSlides) {
          const imgs = slideMap.get(sn) || [];
          for (const img of imgs) {
            if (!visuals.some(v => v.id === img.id || v.mediaPath === img.mediaPath)) {
              visuals.push({
                id: img.id,
                dataUrl: img.dataUrl,
                fileName: img.fileName,
                mimetype: img.mimetype,
                sourceSlide: img.slideNumber,
                name: img.name,
                descr: img.descr,
                purpose: img.descr || img.name || `Visual illustration for ${concept}`,
                triggerKeywords: [
                  ...concept.toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3),
                  ...(img.descr || img.name || '').toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3)
                ],
                displayWhen: `while explaining ${concept}`
              });
            }
          }
        }
      }

      // Build structured chunkText if not provided or too short
      let text = (c.chunkText || '').trim();
      if (!text || text.length < 80) {
        text = `### 📌 Concept: ${concept}\n**Topic:** ${topic}${subtopic ? ` > ${subtopic}` : ''}\n\n`;
        if (c.explanation) text += `**Definition & Overview:**\n${c.explanation}\n\n`;
        if (c.details) text += `**Technical Mechanisms:**\n${c.details}\n\n`;
        if (c.example) text += `**Practical Example:**\n${c.example}\n\n`;
        if (keyPoints.length > 0) {
          text += `**Key Points:**\n${keyPoints.map(p => `- ${p}`).join('\n')}\n\n`;
        }
        const srcTag = sourceSlides?.length
          ? `Slides ${sourceSlides.join(', ')}`
          : `Page ${sourcePage}`;
        text += `*(Source: ${srcTag}${c.sourceSection ? ` - ${c.sourceSection}` : ''})*`;
      }

      return {
        chunkIndex: idx,
        concept,
        topic,
        subtopic,
        chunkType,
        sourcePage,
        sourceSlides,
        sourceSection: c.sourceSection || null,
        prerequisites: c.prerequisites || null,
        keyPoints,
        relatedConcepts,
        visuals,
        semanticSummary: (c.explanation || text.slice(0, 200)).replace(/\n/g, ' ').trim(),
        chunkText: text.trim()
      };
    });
  }

  /**
   * High-Fidelity Structural Semantic Chunker Fallback.
   * Runs when LLM API is unavailable, rate-limited, or for offline processing.
   * Clusters consecutive related slides, groups definitions with explanations,
   * keeps examples with concepts, and extracts rich metadata.
   */
  _getStructuralSemanticChunks(fileName, fullText, docMetadata = {}) {
    const { fileType = 'document', slides = [], pages = [] } = docMetadata;
    const cleanFileName = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const isPpt = fileType === 'pptx' || fileType === 'ppt' || slides.length > 0;
    const generatedChunks = [];

    // 1. PPT/PPTX Structural Chunking — cluster related slides granularly (1-2 slides per chunk)
    if (isPpt && slides.length > 0) {
      const groupSize = Math.max(1, Math.min(2, Math.ceil(slides.length / 16)));
      for (let i = 0; i < slides.length; i += groupSize) {
        const group = slides.slice(i, i + groupSize);
        const teaching = group.map(s => this._slideTeachingText(s) || s.fullText || '').join('\n\n');
        const body = teaching.trim() || group.map(s => s.title).join('\n');
        let concept = firstUsefulTitleLine(teaching);
        if (!concept && group[0] && !isGarbageTitle(group[0].title)) concept = group[0].title;
        if (!concept) concept = `${cleanFileName} — Part ${generatedChunks.length + 1}`;
        const slideNums = group.map(s => s.slideNumber);
        generatedChunks.push({
          chunkIndex: generatedChunks.length,
          concept,
          topic: cleanFileName,
          subtopic: null,
          chunkType: 'concept',
          sourcePage: slideNums[0],
          sourceSlides: slideNums,
          sourceSection: `Slides ${slideNums.join(', ')}`,
          prerequisites: null,
          keyPoints: group.flatMap(s => s.bulletPoints || []).slice(0, 5).map(b => String(b).replace(/^[\s\-\*]+/, '')),
          relatedConcepts: [],
          visuals: group.flatMap(s => s.images || []),
          semanticSummary: body.slice(0, 220).replace(/\n/g, ' '),
          chunkText: `### 📌 Concept: ${concept}\n**Topic:** ${cleanFileName}\n\n${body}\n\n*(Source: Slides ${slideNums.join(', ')})*`
        });
      }
      if (generatedChunks.length > 0) {
        return generatedChunks;
      }
    }

    // 2. PDF/DOCX page-aware structural chunking
    if (Array.isArray(pages) && pages.length > 0) {
      let cluster = [];
      let clusterPages = [];
      let clusterLen = 0;
      let clusterTitle = pages[0]?.title || cleanFileName;

      const flushCluster = () => {
        if (cluster.length === 0) return;
        const chunkContent = cluster.join('\n\n');
        const sourcePage = clusterPages[0] || 1;
        const concept = clusterTitle || cleanFileName;
        generatedChunks.push({
          chunkIndex: generatedChunks.length,
          concept,
          topic: cleanFileName,
          subtopic: null,
          chunkType: /define|definition|refers to/i.test(chunkContent) ? 'definition' : 'concept',
          sourcePage,
          sourceSlides: null,
          sourceSection: `Pages ${clusterPages.join(', ')}`,
          prerequisites: null,
          keyPoints: [],
          relatedConcepts: [],
          semanticSummary: chunkContent.slice(0, 200).replace(/\n/g, ' '),
          chunkText: `### 📌 Concept: ${concept}\n**Topic:** ${cleanFileName}\n\n${chunkContent}\n\n*(Source: Page ${sourcePage}${clusterPages.length > 1 ? `-${clusterPages[clusterPages.length - 1]}` : ''} - ${concept})*`
        });
        cluster = [];
        clusterPages = [];
        clusterLen = 0;
      };

      for (const page of pages) {
        const pageText = (page.text || '').trim();
        if (!pageText) continue;
        const title = (page.title || pageText.split('\n')[0] || cleanFileName).slice(0, 80);
        if (clusterLen + pageText.length > 1800 && cluster.length > 0) {
          flushCluster();
          clusterTitle = title;
        }
        if (cluster.length === 0) {
          clusterTitle = title;
        }
        cluster.push(pageText);
        clusterPages.push(page.page_number || generatedChunks.length + 1);
        clusterLen += pageText.length;
        if (clusterLen > 1800) {
          flushCluster();
        }
      }
      flushCluster();
      if (generatedChunks.length > 0) {
        return generatedChunks;
      }
    }

    // 3. Document/PDF Structural Semantic Chunking from raw text
    const paragraphs = (fullText || '').split(/\n\s*\n/);
    let currentTopic = cleanFileName;
    let currentConcept = cleanFileName;
    let accumulatedParas = [];
    let currentSourcePage = 1;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const p = paragraphs[pIdx].trim();
      if (!p) continue;

      const isHeading = p.length < 90 && (
        p.startsWith('#') ||
        p.startsWith('Chapter') ||
        p.startsWith('Module') ||
        p.startsWith('Section') ||
        /^[0-9]+(\.[0-9]+)*\s+[A-Z]/.test(p) ||
        p.endsWith(':')
      );

      if (isHeading) {
        if (accumulatedParas.length > 0) {
          const chunkContent = accumulatedParas.join('\n\n');
          generatedChunks.push({
            chunkIndex: generatedChunks.length,
            concept: currentConcept,
            topic: currentTopic,
            subtopic: null,
            chunkType: /define|definition|refers to/i.test(chunkContent) ? 'definition' : 'concept',
            sourcePage: currentSourcePage,
            sourceSlides: null,
            sourceSection: currentConcept,
            prerequisites: null,
            keyPoints: [],
            relatedConcepts: [],
            semanticSummary: chunkContent.slice(0, 200).replace(/\n/g, ' '),
            chunkText: `### 📌 Concept: ${currentConcept}\n**Topic:** ${currentTopic}\n\n${chunkContent}\n\n*(Source: Page ${currentSourcePage} - ${currentConcept})*`
          });
          accumulatedParas = [];
        }

        const cleanHeader = p.replace(/^[#\d\.\-\s]+/, '').replace(/:$/, '').trim();
        if (p.startsWith('# ') || p.startsWith('Chapter') || p.startsWith('Module')) {
          currentTopic = cleanHeader;
        }
        currentConcept = cleanHeader || currentTopic;
        continue;
      }

      accumulatedParas.push(p);
      if (accumulatedParas.join('\n\n').length > 1800) {
        const chunkContent = accumulatedParas.join('\n\n');
        generatedChunks.push({
          chunkIndex: generatedChunks.length,
          concept: currentConcept,
          topic: currentTopic,
          subtopic: null,
          chunkType: 'concept',
          sourcePage: currentSourcePage,
          sourceSlides: null,
          sourceSection: currentConcept,
          prerequisites: null,
          keyPoints: [],
          relatedConcepts: [],
          semanticSummary: chunkContent.slice(0, 200).replace(/\n/g, ' '),
          chunkText: `### 📌 Concept: ${currentConcept}\n**Topic:** ${currentTopic}\n\n${chunkContent}\n\n*(Source: Page ${currentSourcePage} - ${currentConcept})*`
        });
        accumulatedParas = [];
        currentSourcePage++;
      }
    }

    if (accumulatedParas.length > 0) {
      const chunkContent = accumulatedParas.join('\n\n');
      generatedChunks.push({
        chunkIndex: generatedChunks.length,
        concept: currentConcept,
        topic: currentTopic,
        subtopic: null,
        chunkType: 'concept',
        sourcePage: currentSourcePage,
        sourceSlides: null,
        sourceSection: currentConcept,
        prerequisites: null,
        keyPoints: [],
        relatedConcepts: [],
        semanticSummary: chunkContent.slice(0, 200).replace(/\n/g, ' '),
        chunkText: `### 📌 Concept: ${currentConcept}\n**Topic:** ${currentTopic}\n\n${chunkContent}\n\n*(Source: Page ${currentSourcePage} - ${currentConcept})*`
      });
    }

    return generatedChunks;
  }

  /**
   * Generates a dynamic, content-driven Course curriculum from the local LLM.
   * Never uses OCR/binary garbage strings as lesson titles.
   */
  async generateCourse(fileName, fullText, docMetadata = {}) {
    const { fileType = 'document', slides = [], pages = [] } = docMetadata;
    const isPpt = fileType === 'pptx' || fileType === 'ppt' || slides.length > 0;
    const sampled = this._sampleSlides(slides, 80);

    let textSlice = '';
    if (isPpt && sampled.length > 0) {
      textSlice = this._compactSlideSummaries(sampled, 16000);
      if (slides.length > sampled.length) {
        textSlice = `This deck has ${slides.length} slides. Summaries below are evenly sampled.\n\n${textSlice}`;
      }
    } else if (pages.length > 0) {
      textSlice = pages.map(p => `[PAGE ${p.page_number}${p.title && !isGarbageTitle(p.title) ? `: ${p.title}` : ''}]\n${String(p.text || '').slice(0, 600)}`).join('\n\n').slice(0, 16000);
    } else {
      textSlice = String(fullText || '').slice(0, 16000);
    }

    const systemPrompt = `You are SkillBridge's curriculum architect. Build a training curriculum from the local LLM using the slide/page summaries.

HARD RULES:
- Ignore OCR garbage, OLE binary fragments, font names, and symbol strings. Titles like "UT5FAMX%", "#E.R$#E*", "^^~^^~", "Ecz v2b0", ".- AMM,HCC" are INVALID.
- Every module and lesson title must be readable words a trainer would say (English or Bangla).
- Do NOT create one lesson per slide or per noisy fragment.
- Group related consecutive slides into lessons. A typical safety/operations deck has 5-10 structured lessons (aim for 2-5 slides per lesson so each lesson is a substantive training unit, never 1 lesson per slide).
- Each lesson MUST include sourceSlides: an array of integer slide numbers covered by that lesson.
- Calculate realistic lesson duration in MM:SS based on slide count and content (e.g. 1-2 slides = "01:45" to "02:30", 3-5 slides = "03:15" to "04:30"). Module duration is the sum of its lessons (e.g. "6m", "9m"). NEVER return "08:00" for all lessons.
- IMAGE SLIDES: use the vision/OCR meaning, then teach it as a shop-floor trainer would.

Return ONLY JSON:
{
  "title": "Specific Course Title",
  "description": "2-3 sentence overview",
  "learning": ["skill 1", "skill 2", "skill 3", "skill 4"],
  "includes": ["Interactive ARIA AI Avatar Tutoring", "Content-driven curriculum", "Voice Q&A", "Assessment & certificate"],
  "curriculum": [{ "title": "Module title", "lessons": 2, "duration": "6m", "locked": false }],
  "lessons": [{
    "id": 1,
    "chapterTitle": "Module title",
    "moduleTitle": "Module title",
    "title": "Readable lesson title",
    "duration": "02:45",
    "status": "active",
    "sourceSlides": [1, 2, 3]
  }],
  "quiz": [{ "question": "Question from the real material?", "options": ["A", "B", "C", "D"], "answerIndex": 1, "explanation": "Why." }]
}`;

    const userPrompt = `Document Filename: ${fileName}
Slide/page count: ${slides.length || pages.length || 0}

Document Content:
${textSlice}`;

    try {
      const aiResponse = await this._callLLM(systemPrompt, userPrompt, true);
      const parsed = this._parseJsonObject(aiResponse);
      if (!parsed || !Array.isArray(parsed.lessons) || parsed.lessons.length === 0) {
        throw new Error('Incomplete structure from AI response.');
      }
      const course = this._sanitizeGeneratedCourse(parsed, slides, fileName);
      return this._attachLessonMedia(course, slides, pages);
    } catch (e) {
      console.warn('generateCourse LLM pass failed, retrying with a shorter prompt:', e.message);
      try {
        const retryPrompt = `Create 6-18 readable training lessons from this material. Ignore OCR garbage. Return JSON {title, description, lessons:[{title, moduleTitle, sourceSlides, duration}]}. File: ${fileName}\n\n${textSlice.slice(0, 9000)}`;
        const retryRaw = await this._callLLM(retryPrompt, 'Return JSON only.', true);
        const retryParsed = this._parseJsonObject(retryRaw);
        if (retryParsed?.lessons?.length) {
          const course = this._sanitizeGeneratedCourse(retryParsed, slides, fileName);
          return this._attachLessonMedia(course, slides, pages);
        }
      } catch (retryErr) {
        console.warn('generateCourse retry failed:', retryErr.message);
      }
      console.warn('Fallback triggered for generateCourse: grouping real slides instead of OCR titles');
      const fallback = this._groupSlidesIntoLessons(slides, fileName);
      return this._attachLessonMedia(fallback, slides, pages);
    }
  }

  _attachLessonMedia(course, slides = [], pages = []) {
    const slideImageMap = new Map();
    for (const s of slides || []) {
      if (s.slideNumber && Array.isArray(s.images) && s.images.length > 0) {
        slideImageMap.set(s.slideNumber, s.images);
      }
    }

    course.lessons = (course.lessons || []).map((l, idx) => {
      let matchedSlides = Array.isArray(l.sourceSlides)
        ? l.sourceSlides.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
        : [];
      if (matchedSlides.length === 0 && slides.length > 0) {
        matchedSlides = [Math.min(slides.length, idx + 1)];
      }

      const visuals = matchedSlides.flatMap(sn => slideImageMap.get(sn) || []).map(img => ({
        id: img.id,
        dataUrl: img.dataUrl,
        fileName: img.fileName,
        mimetype: img.mimetype,
        sourceSlide: img.slideNumber || img.sourceSlide,
        name: img.name,
        descr: img.descr,
        purpose: img.descr || img.name || `Visual illustration for ${l.title}`,
        triggerKeywords: [
          ...String(l.title || '').toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3),
          ...(img.descr || img.name || '').toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3)
        ],
        displayWhen: `while explaining ${l.title}`
      }));

      const matchedSlideObjs = matchedSlides.map(sn => slides.find(s => s.slideNumber === sn)).filter(Boolean);
      const primarySlide = matchedSlideObjs[0] || slides[idx] || null;
      const primaryPage = Array.isArray(pages) ? (pages[idx] || pages.find(p => p.page_number === idx + 1)) : null;

      const slideData = primarySlide ? {
        slideNumber: primarySlide.slideNumber,
        title: isGarbageTitle(primarySlide.title) ? l.title : (primarySlide.title || l.title),
        headings: primarySlide.headings || [],
        bulletPoints: primarySlide.bulletPoints || [],
        paragraphs: primarySlide.paragraphs || [],
        tables: primarySlide.tables || [],
        speakerNotes: primarySlide.speakerNotes || '',
        fullText: primarySlide.fullText || '',
        images: visuals
      } : (primaryPage ? {
        slideNumber: primaryPage.page_number || idx + 1,
        title: primaryPage.title || l.title,
        headings: [],
        bulletPoints: primaryPage.bulletPoints || [],
        paragraphs: primaryPage.text ? [primaryPage.text] : [],
        tables: [],
        speakerNotes: '',
        fullText: primaryPage.text || '',
        images: visuals
      } : null);

      return {
        ...l,
        id: idx + 1,
        sourceSlides: matchedSlides,
        visuals,
        slideData,
        chunkData: primaryPage ? {
          chunkIndex: idx + 1,
          title: primaryPage.title || l.title,
          text: primaryPage.text || '',
          bulletPoints: primaryPage.bulletPoints || []
        } : null,
        status: idx === 0 ? 'active' : (l.status === 'done' ? 'done' : 'locked'),
        duration: l.duration || this._lessonDuration(idx)
      };
    });

    return course;
  }

  async generateLessonQuiz(courseTitle, lessonTitle, contextText, language = 'English') {
    const systemPrompt = `You are ARIA, the expert AI Tutor for SkillBridge.
Generate an interactive multiple-choice assessment quiz for the specific lesson: "${lessonTitle}" in course: "${courseTitle}".
Target Language: ${language}.

CRITICAL QUIZ GENERATION RULES:
1. Target Language: All questions, answer options, and explanations MUST be written fluently in ${language} only (e.g. if Tamil (தமிழ்), Chinese (中文), Malay (Bahasa Melayu), Bangla (বাংলা), Telugu (తెలుగు), or English). Do not mix languages.
2. Generate EXACTLY 5 multiple-choice questions derived STRICTLY from the provided document context for this specific lesson/chapter.
3. Questions MUST test understanding of concepts in this chapter only.
4. Randomly vary the position of the correct answer across questions so answerIndex is distributed among 0, 1, 2, and 3 (Options A, B, C, D) instead of always choosing Option 0.
5. Output MUST be raw JSON matching this structure exactly, with no markdown wrapping:
{
  "quiz": [
    {
      "question": "A clear multiple-choice question testing content in this chapter?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 1,
      "explanation": "Concise explanation explaining why the correct option is right based on this chapter."
    }
  ]
}`;

    const userPrompt = `Document context for lesson "${lessonTitle}":\n${contextText}\n\nTarget Language: ${language}`;

    try {
      const aiResponse = await this._callLLM(systemPrompt, userPrompt, true);
      const parsed = this._parseJsonObject(aiResponse);
      if (parsed.quiz && Array.isArray(parsed.quiz) && parsed.quiz.length > 0) {
        return parsed.quiz;
      }
      throw new Error('Invalid quiz JSON output.');
    } catch (e) {
      console.warn('Fallback triggered for generateLessonQuiz:', e.message);
      return [
        {
          question: `What is the primary objective of "${lessonTitle}"?`,
          options: [
            'To ignore core safety procedures and guidelines',
            `To master essential operational standards and safety protocols for ${lessonTitle}`,
            'To bypass equipment inspections and checklists',
            'None of the above'
          ],
          answerIndex: 1,
          explanation: `Mastering operational standards and safety protocols ensures compliance and risk mitigation for ${lessonTitle}.`
        },
        {
          question: `How are safety requirements for "${lessonTitle}" verified in practice?`,
          options: [
            'By skipping validation checks completely',
            'By operating damaged equipment without reporting',
            'By following structured inspection checklists and verifying equipment condition',
            'By guessing operational limits'
          ],
          answerIndex: 2,
          explanation: 'Structured inspection checklists and condition verification ensure equipment reliability and prevent accidents.'
        },
        {
          question: `What is a crucial rule emphasized in "${lessonTitle}"?`,
          options: [
            'Strict adherence to mandatory safety protocols and manufacturer limits',
            'Disabling warning signals and safety alarms',
            'Leaving unstable loads unsecured',
            'Operating in unauthorized zones'
          ],
          answerIndex: 0,
          explanation: 'Strict adherence to safety protocols and limits protects personnel and prevents severe operational failures.'
        },
        {
          question: `Which action should be taken if a hazard or non-compliance is identified in "${lessonTitle}"?`,
          options: [
            'Ignore the condition and proceed as usual',
            'Immediately stop, report the hazard, and follow consequence management protocols',
            'Cover up the issue without documenting',
            'Continue operating at higher speeds'
          ],
          answerIndex: 1,
          explanation: 'Prompt reporting and corrective actions prevent hazardous conditions from escalating into severe incidents.'
        },
        {
          question: `What is the key takeaway from completing "${lessonTitle}"?`,
          options: [
            'Bypassing PPE requirements in hazardous zones',
            'Eliminating pre-operation checks to save time',
            'Operating without maintaining proper clearances',
            'Executing operations safely with complete adherence to verified training standards'
          ],
          answerIndex: 3,
          explanation: `Executing operations safely with strict adherence to standards is the primary goal of ${lessonTitle}.`
        }
      ];
    }
  }

  /**
   * Synthesizes an in-depth conceptual lecture of a lesson using RAG in the user's preferred language.
   * Grounded strictly in the retrieved text chunks and designed to provide thorough, extended course-play content.
   */
  async explainLesson(courseTitle, lessonTitle, contextText, language = 'English') {
    const systemPrompt = `You are ARIA, the senior AI Tutor for SkillBridge.
Your student is taking the course: "${courseTitle}".
Current Lesson Topic: "${lessonTitle}".
Active Teaching Language: ${language}.

PEDAGOGICAL TEACHING & DEPTH INSTRUCTIONS:
1. LANGUAGE LOCK: The student selected ${language}. Write EVERY sentence, heading, bullet, and question in ${language} only. Do not mix languages. If the retrieved context is Bangla, Tamil, Telugu, Chinese, Malay, or any other language, fully translate the teaching into ${language}. Never leave source-language sentences on screen when the target is English.
2. Target Teaching Language: Deliver the entire lesson explanation, headings, technical breakdowns, analogies, and reflection questions fluently in ${language} (supported: English, Chinese (中文), Malay (Bahasa Melayu), Tamil (தமிழ்), Bangla (বাংলা), Telugu (తెలుగు)).
3. Comprehensive Teaching Duration: Provide an extensive, thorough, and high-value lecture (10-15 clear instructional paragraphs/points). Speak as a world-class instructor explaining each concept step-by-step with depth rather than providing short superficial summaries.
4. Grounding: Draw core principles, terminology, and workflows directly from the retrieved document context.
5. Technical Terminology: Keep recognized technical terms (e.g. PPE, Reversing, Blind Spot, Coupling, Lashing, Stanchions, Checklist) in their standard form alongside the explanation in ${language}.
6. Blackboard Presentation Structure:
   Structure your teaching response into these clear, rich pedagogical sections:
   - ### 💡 Overview & Core Motivation (Detailed intuitive breakdown of what this topic is, why it is critical, and where it fits in the broader training)
   - #### 🎯 Mandatory Requirements & Protocols (4-6 comprehensive bullet points detailing essential rules, safety gear, procedures, or limits)
   - #### 🔍 Step-by-Step Execution & Operational Flow (Step-by-step breakdown of how to execute the procedure correctly and safely)
   - #### 🌐 Real-World Scenario & Practical Case (A vivid, memorable operational scenario demonstrating why this rule exists)
   - #### ⚠️ Critical Hazards & Common Pitfalls (Dangerous mistakes, what can go wrong, and exact prevention steps)
   - #### 📌 Key Safety Takeaways (3 high-value bullet points summarizing the core learnings)
   - #### ⚡ Knowledge Check & Reflection (An insightful question for the learner to test their understanding)`;

    const userPrompt = `Retrieved Course Context:\n${contextText}\n\nLesson to teach: "${lessonTitle}"\nSelected Teaching Language: ${language}\nLANGUAGE LOCK: Output the full lecture in ${language} only. Translate any source text that is not already in ${language}.`;

    try {
      return await this._callLLM(systemPrompt, userPrompt, false);
    } catch (e) {
      console.warn('Fallback triggered for explainLesson:', e.message);
      return this._getMockExplanation(lessonTitle, language);
    }
  }

  /**
   * Fallback: Generates a structured dynamic course mockup using actual extracted topics from the document/presentation
   * NEVER uses hardcoded default generic topics or forced 5 modules.
   */
  _getMockCourse(fileName, text, docMetadata = {}) {
    const { slides = [] } = docMetadata;
    if (slides && slides.length > 0) {
      return this._groupSlidesIntoLessons(slides, fileName);
    }
    const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    const formattedTitle = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const rawTopics = [];
    if (false) {
    } else if (text) {
      const paras = text.split(/\n+/);
      for (let p of paras) {
        p = p.trim();
        if (!p || p.length < 3 || p.length > 70) continue;
        if (p.endsWith('.') || p.endsWith(',') || p.endsWith('?') || p.endsWith(';')) continue;
        const clean = p.replace(/^[\d\.\-\s#\*]+/g, '').trim();
        if (clean.length < 4 || clean.length > 60) continue;
        if (isGarbageTitle(clean)) continue;
        if (!/^[A-Za-z0-9]/.test(clean)) continue;
        if (rawTopics.length >= 18) break;
        const lower = clean.toLowerCase();
        if (lower.includes('table of contents') || lower.includes('agenda') || lower.includes('overview')) continue;
        if (!rawTopics.includes(clean)) {
          rawTopics.push(clean);
        }
      }
    }

    // Cluster topics naturally into modules
    const modules = [];
    const flatLessons = [];
    let currentCluster = [];
    let currentClusterTitle = '';

    for (let i = 0; i < rawTopics.length; i++) {
      const t = rawTopics[i];
      if (currentCluster.length === 0) {
        currentClusterTitle = t;
      }
      currentCluster.push(t);

      // Start new module every 2-3 lessons or at the end
      if (currentCluster.length >= 3 || i === rawTopics.length - 1) {
        const modId = modules.length + 1;
        const modTitle = currentClusterTitle || `Module ${modId}: Training Unit`;
        const modLessons = [];

        for (const lessonTitle of currentCluster) {
          const lessonIdx = flatLessons.length;
          const slideNum = Math.min(slides.length || 1, lessonIdx + 1);
          const slideObj = slides.find(s => s.slideNumber === slideNum || s.title === lessonTitle);
          const slideVisuals = (slideObj?.images || []).map(img => ({
            id: img.id,
            dataUrl: img.dataUrl,
            fileName: img.fileName,
            mimetype: img.mimetype,
            sourceSlide: img.slideNumber,
            name: img.name,
            descr: img.descr,
            purpose: img.descr || img.name || `Visual illustration for ${lessonTitle}`,
            triggerKeywords: [
              ...lessonTitle.toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3),
              ...(img.descr || img.name || '').toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3)
            ],
            displayWhen: `while explaining ${lessonTitle}`
          }));

          const slideData = slideObj ? {
            slideNumber: slideObj.slideNumber,
            title: slideObj.title || lessonTitle,
            headings: slideObj.headings || [],
            bulletPoints: slideObj.bulletPoints || [],
            paragraphs: slideObj.paragraphs || [],
            tables: slideObj.tables || [],
            speakerNotes: slideObj.speakerNotes || '',
            fullText: slideObj.fullText || '',
            images: slideVisuals
          } : null;

          const lessonObj = {
            id: flatLessons.length + 1,
            chapterId: modId,
            chapterTitle: modTitle,
            moduleId: modId,
            moduleTitle: modTitle,
            title: lessonTitle,
            sourceSlides: [slideNum],
            visuals: slideVisuals,
            slideData,
            duration: `0${Math.floor(7 + ((flatLessons.length) % 5))}:${((flatLessons.length) * 15) % 60 < 10 ? '0' : ''}${((flatLessons.length) * 15) % 60}`,
            status: flatLessons.length === 0 ? 'active' : 'locked'
          };
          modLessons.push(lessonObj);
          flatLessons.push(lessonObj);
        }

        const modSecs = modLessons.reduce((acc, l) => {
          const parts = String(l.duration || '').split(':').map(p => parseInt(p, 10) || 0);
          return acc + (parts.length === 2 ? parts[0] * 60 + parts[1] : 120);
        }, 0);
        modules.push({
          title: modTitle,
          lessons: modLessons.length,
          duration: `${Math.max(1, Math.round(modSecs / 60))}m`,
          locked: modId > 1
        });
        currentCluster = [];
      }
    }

    if (flatLessons.length === 0) {
      const slideVisuals = (slides[0]?.images || []).map(img => ({
        id: img.id,
        dataUrl: img.dataUrl,
        fileName: img.fileName,
        mimetype: img.mimetype,
        sourceSlide: img.slideNumber,
        name: img.name,
        descr: img.descr,
        purpose: img.descr || img.name || `Visual illustration for ${formattedTitle}`,
        triggerKeywords: formattedTitle.toLowerCase().split(/\s+/),
        displayWhen: `while explaining ${formattedTitle}`
      }));

      flatLessons.push({
        id: 1,
        chapterId: 1,
        chapterTitle: formattedTitle,
        moduleId: 1,
        moduleTitle: formattedTitle,
        title: `${formattedTitle} Core Training`,
        sourceSlides: [1],
        visuals: slideVisuals,
        duration: '02:30',
        status: 'active'
      });
      modules.push({
        title: formattedTitle,
        lessons: 1,
        duration: '3m',
        locked: false
      });
    }

    return {
      title: `${formattedTitle} Training Program`,
      description: `Comprehensive training program covering all operational requirements and safety procedures for ${formattedTitle}.`,
      learning: flatLessons.slice(0, 4).map(l => `Master key protocols for ${l.title}`),
      includes: [
        'Interactive ARIA AI Avatar Tutoring',
        `${flatLessons.length} in-depth training lessons`,
        `${modules.length} content-driven modules`,
        'Digital verified completion certificate'
      ],
      curriculum: modules,
      lessons: flatLessons,
      quiz: [
        {
          question: `What is the primary focus of "${flatLessons[0]?.title || formattedTitle}"?`,
          options: [
            `To master essential procedures and safety standards for ${flatLessons[0]?.title || formattedTitle}`,
            'To bypass operational checklists',
            'To ignore equipment safety guidelines',
            'None of the above'
          ],
          answerIndex: 0,
          explanation: `Mastering procedures and safety standards is essential for ${flatLessons[0]?.title || formattedTitle}.`
        }
      ]
    };
  }

  /**
   * Fallback: Generates explanation when LLM is offline
   */
  _getMockExplanation(lessonTitle, language = 'English') {
    const l = String(language).toLowerCase();
    if (l === 'zh' || l.includes('chinese') || l.includes('中文')) {
      return `### 💡 核心概念与概述
本课重点讲解 **${lessonTitle}** 的关键基础与应用原理。

#### 🎯 核心原则
- 掌握 ${lessonTitle} 的基本工作机制与核心逻辑。
- 在实际项目中遵循最佳实践与规范设计。
- 确保系统组件之间的数据流与交互清晰可靠。

#### 🌐 现实生活类比
想象一下制作一套积木系统，每个模块（Component）各司其职，组合起来构建完整的应用体系。

#### 📌 关键要点
- 理解概念结构比死记硬背更重要。
- 始终通过实际代码练习巩固所学知识。

#### ⚡ 实践思考
尝试用自己的话概括 ${lessonTitle} 的核心用途。`;
    }

    if (l === 'ms' || l.includes('malay') || l.includes('melayu')) {
      return `### 💡 Gambaran Keseluruhan & Idea Teras
Pelajaran ini memberi tumpuan kepada konsep asas dan aplikasi praktikal **${lessonTitle}**.

#### 🎯 Prinsip Utama
- Memahami mekanisme operasi dan logik utama ${lessonTitle}.
- Menggunakan amalan terbaik dalam mereka bentuk struktur aplikasi.
- Memastikan aliran data dan komponen berfungsi secara optimum.

#### 🌐 Analogi Dunia Nyata
Bayangkan sebuah orkestra muzik di mana setiap instrumen mempunyai fungsi tersendiri untuk menghasilkan melodi yang harmoni.

#### 📌 Pengambilan Penting
- Pembelajaran konsep adalah lebih berkesan daripada menghafal fakta semata-mata.
- Uji pemahaman anda dengan latihan amali secara konsisten.

#### ⚡ Refleksi Latihan
Bolehkah anda menerangkan fungsi utama ${lessonTitle} dalam satu ayat mudah?`;
    }

    if (l === 'ta' || l.includes('tamil') || l.includes('தமிழ்')) {
      return `### 💡 மேலோட்டம் மற்றும் அடிப்படைக் கருத்து
இந்த பாடம் **${lessonTitle}** பற்றிய முக்கியமான அடிப்படைகள் மற்றும் நடைமுறை பயன்பாடுகளை விளக்குகிறது.

#### 🎯 முக்கிய கோட்பாடுகள்
- ${lessonTitle} இன் செயல்பாட்டு முறை மற்றும் மைய தர்க்கத்தை புரிந்து கொள்ளுதல்.
- திட்டங்களில் சிறந்த நடைமுறைகள் மற்றும் தரநிலைகளைப் பின்பற்றுதல்.
- கணினி பாகங்களுக்கு இடையேயான தொடர்புகளை சீராக நிர்வகித்தல்.

#### 🌐 நிஜ உலக உதாரணம்
ஒரு பெரிய கட்டடத்தை உருவாக்கும் போது அடித்தள செங்கற்கள் எவ்வாறு வலிமை சேர்க்கிறதோ, அதே போல இந்த கருத்துக்கள் பயன்பாட்டுக்கு வலு சேர்க்கின்றன.

#### 📌 நினைவில் கொள்ள வேண்டியவை
- வெறும் மனப்பாடம் செய்வதை விட அடிப்படைக் கருத்துக்களைப் புரிந்து கொள்வது சிறந்தது.
- தொடர்ந்து பயிற்சி செய்வதன் மூலம் அறிவை உறுதிப்படுத்துங்கள்.

#### ⚡ சிந்தனைக்கான கேள்வி
${lessonTitle} இன் முக்கிய பயனை உங்கள் சொந்த வார்த்தைகளில் விவரிக்க முடியுமா?`;
    }

    if (l === 'bn' || l.includes('bangla') || l.includes('bengali') || l.includes('বাংলা')) {
      return `### 💡 সংক্ষিপ্ত বিবরণ এবং মূল ধারণা
এই পাঠটি **${lessonTitle}** এর মৌলিক ধারণা এবং বাস্তব প্রয়োগ সম্পর্কে বিস্তারিত আলোচনা করে।

#### 🎯 মূল নীতিসমূহ
- ${lessonTitle} এর অন্তর্নিহিত কর্মপদ্ধতি ও লজিক আয়ত্ত করা।
- সিস্টেম ডিজাইনে সঠিক নিয়ম ও সর্বোত্তম অনুশীলন অনুসরণ করা।
- উপাদানের মধ্যে ডেটা প্রবাহ ও কাঠামোগত সম্পর্ক বজায় রাখা।

#### 🌐 বাস্তব জীবনের উপমা
যেমন একটি ভবনের প্রতিটি ইট মিলে একটি মজবুত কাঠামো তৈরি করে, তেমনি এই ধারণাগুলি অ্যাপ্লিকেশনের ভিত্তি তৈরি করে।

#### 📌 মূল শিক্ষণীয় বিষয়
- মুখস্থ করার চেয়ে ধারণাগত বোঝাপড়া অনেক বেশি কার্যকর।
- নিয়মিত অনুশীলনের মাধ্যমে দক্ষতা বৃদ্ধি করুন।

#### ⚡ অনুশীলনের প্রশ্ন
আপনি কি ${lessonTitle} এর প্রধান কাজটি সহজ কথায় ব্যাখ্যা করতে পারেন?`;
    }

    if (l === 'te' || l.includes('telugu') || l.includes('తెలుగు')) {
      return `### 💡 సంక్షిప్త వివరణ మరియు ముఖ్య భావన
ఈ పాఠం **${lessonTitle}** యొక్క ప్రాథమిక సూత్రాలు మరియు ఆచరణాత్మక అనువర్తనాల గురించి వివరంగా చర్చిస్తుంది.

#### 🎯 ముఖ్య సూత్రాలు
- ${lessonTitle} యొక్క అంతర్లీన కార్యాచరణ మరియు లాజిక్ అర్థం చేసుకోవడం.
- సిస్టమ్ డిజైన్‌లో సరైన ప్రమాణాలు మరియు ఉత్తమ పద్ధతులను పాటించడం.
- విభిన్న భాగాల మధ్య సమన్వయం మరియు నియంత్రణను నిర్వహించడం.

#### 🌐 వాస్తవ ప్రపంచ ఉదాహరణ
ఒక పటిష్టమైన భవనానికి బలమైన పునాది ఎంత అవసరమో, అలాగే ఈ భావనలు మన అప్లికేషన్‌కు దృఢమైన ఆధారాన్ని అందిస్తాయి.

#### 📌 ముఖ్యమైన అంశాలు
- బట్టీ పట్టడం కంటే ప్రాథమిక భావనలను గ్రహించడం ఎంతో ఉత్తమం.
- నిరంతర సాధన ద్వారా నైపుణ్యాన్ని మెరుగుపరుచుకోండి.

#### ⚡ ఆలోచించవలసిన ప్రశ్న
${lessonTitle} యొక్క ప్రధాన లక్ష్యాన్ని మీ స్వంత మాటల్లో వివరించగలరా?`;
    }

    return `### 💡 Overview & Core Idea
This lesson focuses on the foundational principles and practical applications of **${lessonTitle}**.

#### 🎯 Key Principles
- Understand the underlying mechanics and core logic of ${lessonTitle}.
- Apply standard architectural best practices when implementing solutions.
- Ensure modular separation and predictable component behavior.

#### 🌐 Real-World Analogy
Think of building a modular structure where each component has a dedicated responsibility, working together seamlessly.

#### 📌 Summary Takeaways
- Conceptual understanding is far more durable than rote memorization.
- Focus on practical implementation patterns and verified code flows.

#### ⚡ Practice Reflection
*How would you summarize the primary purpose of ${lessonTitle} in a single sentence?*`;
  }
}

export default new AIService();
