import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class AIService {
  /**
   * Helper to make ChatCompletion calls with multi-turn conversation support
   */
  async _callLLM(systemPrompt, userPrompt, jsonMode = false, conversationHistory = []) {
    dotenv.config();

    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
      console.error('[AIService] OPENAI_API_KEY is not configured in .env file!');
      throw new Error('OPENAI_API_KEY is missing.');
    }

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      const messages = [
        { role: 'system', content: systemPrompt }
      ];

      // Append multi-turn conversation history if provided
      if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-8);
        for (const item of recentHistory) {
          const role = (item.role === 'user' || item.sender === 'user') ? 'user' : 'assistant';
          const content = item.content || item.text || '';
          if (content && typeof content === 'string' && content.trim()) {
            messages.push({ role, content: content.trim() });
          }
        }
      }

      if (userPrompt && typeof userPrompt === 'string' && userPrompt.trim()) {
        messages.push({ role: 'user', content: userPrompt.trim() });
      }

      const payload = {
        model,
        messages,
        temperature: 0.4
      };

      if (jsonMode) {
        payload.response_format = { type: 'json_object' };
      }

      const response = await axios.post(`${baseUrl}/chat/completions`, payload, {
        headers,
        timeout: 60000 // 60 seconds timeout for OpenAI API
      });

      return response.data?.choices?.[0]?.message?.content || '';
    } catch (error) {
      const status = error.response?.status;
      const errorDetails = error.response?.data?.error?.message || error.message;
      console.warn(`[AIService] OpenAI API call failed (HTTP ${status}): ${errorDetails}`);
      throw error; // Let caller catch and invoke fallback
    }
  }

  /**
   * Generates a single vector embedding using OpenAI text-embedding-3-small
   */
  async getEmbedding(text, dimensions = 768) {
    if (!text || !text.trim()) return null;
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1';

    if (!apiKey) {
      console.warn('[AIService] OPENAI_API_KEY is not configured for embeddings.');
      return null;
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
      return response.data?.data?.[0]?.embedding || null;
    } catch (err) {
      console.warn('[AIService] Failed to generate embedding:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }

  /**
   * Generates batch vector embeddings using OpenAI text-embedding-3-small
   */
  async getEmbeddings(textArray, dimensions = 768) {
    if (!textArray || !Array.isArray(textArray) || textArray.length === 0) return [];
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1';

    if (!apiKey) {
      console.warn('[AIService] OPENAI_API_KEY is not configured for batch embeddings.');
      return [];
    }

    try {
      const cleanInputs = textArray.map(t => (typeof t === 'string' ? t.slice(0, 8000) : ''));
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
      return response.data?.data?.map(d => d.embedding) || [];
    } catch (err) {
      console.warn('[AIService] Batch embeddings failed:', err.response?.data?.error?.message || err.message);
      return [];
    }
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
          sDesc += `Visuals on Slide: ` + s.images.map(img => `[Visual ID: ${img.id}] "${img.name}"${img.descr ? ` - ${img.descr}` : ''}`).join('; ') + '\n';
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

5. SOURCE GROUNDING & TRACEABILITY:
   - Ground every chunk strictly in the source material. Do not hallucinate external facts.
   - For presentations: set "sourceSlides" (array of numbers like [1, 2]).
   - For documents/PDFs: set "sourcePage" (number or primary page).
   - Set "sourceSection" (heading/section title).

6. VISUAL INTEGRATION & TIMING:
   - When a slide has supporting images, photos, charts, or diagrams, link them to the relevant concept.
   - Specify "purpose" and "triggerKeywords" so ARIA knows exactly when to display the visual during lecture playback.

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
      const parsed = JSON.parse(aiResponse.replace(/```json/g, '').replace(/```/g, '').trim());

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
          text: slice.map(s => s.fullText).join('\n\n')
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
        const parsed = JSON.parse(res.replace(/```json/g, '').replace(/```/g, '').trim());
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
      const concept = c.concept || c.title || `Core Concept ${idx + 1}`;
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

    // 1. PPT/PPTX Structural Chunking (combines consecutive related slides)
    if (isPpt && slides.length > 0) {
      let currentCluster = [];
      let currentMainConcept = '';
      let clusterSlides = [];

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const title = slide.title || `Slide ${slide.slideNumber}`;

        // Determine if slide continues previous concept or introduces new major topic
        const isIntroOrOverview = /overview|agenda|introduction|table of contents/i.test(title);
        const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const prevTitleWords = currentMainConcept.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const wordOverlap = titleWords.some(w => prevTitleWords.includes(w));

        const shouldStartNew = currentCluster.length === 0 ||
          (!wordOverlap && currentCluster.length >= 2 && !isIntroOrOverview) ||
          currentCluster.length >= 4;

        if (shouldStartNew && currentCluster.length > 0) {
          // Flush previous slide cluster as one semantic knowledge chunk
          const clusterText = currentCluster.map(s => s.fullText).join('\n\n');
          const allBullets = currentCluster.flatMap(s => s.bulletPoints || []);
          const firstSlide = currentCluster[0];

          generatedChunks.push({
            chunkIndex: generatedChunks.length,
            concept: currentMainConcept || firstSlide.title,
            topic: cleanFileName,
            subtopic: firstSlide.title !== currentMainConcept ? firstSlide.title : null,
            chunkType: 'concept',
            sourcePage: firstSlide.slideNumber,
            sourceSlides: clusterSlides.slice(),
            sourceSection: `Slides ${clusterSlides.join(', ')}`,
            prerequisites: null,
            keyPoints: allBullets.slice(0, 5).map(b => b.replace(/^[\s\-\*]+/, '')),
            relatedConcepts: [],
            semanticSummary: `${currentMainConcept}: ${firstSlide.paragraphs?.[0] || firstSlide.title}`,
            chunkText: `### 📌 Concept: ${currentMainConcept || firstSlide.title}\n**Topic:** ${cleanFileName}\n\n${clusterText}\n\n*(Source: Slides ${clusterSlides.join(', ')})*`
          });

          currentCluster = [];
          clusterSlides = [];
        }

        if (currentCluster.length === 0) {
          currentMainConcept = title;
        }
        currentCluster.push(slide);
        clusterSlides.push(slide.slideNumber);
      }

      // Flush remaining cluster
      if (currentCluster.length > 0) {
        const clusterText = currentCluster.map(s => s.fullText).join('\n\n');
        const allBullets = currentCluster.flatMap(s => s.bulletPoints || []);
        const firstSlide = currentCluster[0];

        generatedChunks.push({
          chunkIndex: generatedChunks.length,
          concept: currentMainConcept || firstSlide.title,
          topic: cleanFileName,
          subtopic: null,
          chunkType: 'concept',
          sourcePage: firstSlide.slideNumber,
          sourceSlides: clusterSlides.slice(),
          sourceSection: `Slides ${clusterSlides.join(', ')}`,
          prerequisites: null,
          keyPoints: allBullets.slice(0, 5).map(b => b.replace(/^[\s\-\*]+/, '')),
          relatedConcepts: [],
          semanticSummary: `${currentMainConcept}: ${firstSlide.paragraphs?.[0] || firstSlide.title}`,
          chunkText: `### 📌 Concept: ${currentMainConcept || firstSlide.title}\n**Topic:** ${cleanFileName}\n\n${clusterText}\n\n*(Source: Slides ${clusterSlides.join(', ')})*`
        });
      }

      return generatedChunks;
    }

    // 2. Document/PDF Structural Semantic Chunking
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
   * Generates a complete dynamic Course structure (chapters, modules, lessons, and quiz)
  /**
   * Generates a dynamic, content-driven Course curriculum tailored entirely to the
   * actual subjects present in the uploaded PPTX/document.
   * NEVER forces 5 modules, fixed chapter counts, or generic placeholder templates.
   */
  async generateCourse(fileName, fullText, docMetadata = {}) {
    const { fileType = 'document', slides = [], pages = [] } = docMetadata;
    const isPpt = fileType === 'pptx' || fileType === 'ppt' || slides.length > 0;
    const docLength = (fullText || '').length;

    // Build rich, structured representation of the presentation/document
    let textSlice = '';
    if (isPpt && slides.length > 0) {
      textSlice = slides.map(s => {
        let sDesc = `[SLIDE ${s.slideNumber}: ${s.title}]\n`;
        if (s.headings?.length) sDesc += `Headings: ${s.headings.join(' | ')}\n`;
        if (s.paragraphs?.length) sDesc += s.paragraphs.join('\n') + '\n';
        if (s.bulletPoints?.length) sDesc += s.bulletPoints.join('\n') + '\n';
        if (s.tables?.length) sDesc += s.tables.join('\n') + '\n';
        if (s.speakerNotes) sDesc += `Speaker Notes: ${s.speakerNotes}\n`;
        return sDesc.trim();
      }).join('\n\n');
    } else if (pages.length > 0) {
      textSlice = pages.map(p => `[PAGE ${p.page_number}${p.title ? `: ${p.title}` : ''}]\n${p.text}`).join('\n\n');
    } else {
      textSlice = fullText.slice(0, 35000);
    }

    if (textSlice.length > 35000) {
      textSlice = textSlice.slice(0, 35000);
    }

    const systemPrompt = `You are the Senior Curriculum Architect & Master Instructional Designer for SkillBridge.
Your mission is to DEEPLY STUDY AND UNDERSTAND the provided course presentation/document and synthesize an AUTHENTIC, DYNAMIC CURRICULUM derived STRICTLY from the actual material.

CRITICAL CONTENT-FIRST DIRECTIVES:
1. STUDY THE ENTIRE MATERIAL FIRST:
   - Study ALL slides or pages before generating the curriculum.
   - Understand the overall purpose, domain, and specific subject matter of the presentation.
   - Discover the real topics from the content itself (e.g. for Driver Training: PPE requirements, driver wellness, pre-operation checklists, safe walkways, parking, speed limits, trailer operations, reversing, blind spots, load height, coupling/decoupling, coil securing, lifting safety, damaged equipment, unstable loads, consequence management).

2. ABSOLUTELY NO FORCED TEMPLATES OR TARGET NUMBERS:
   - NEVER force 5 modules, 4 modules, or any fixed number of modules/chapters.
   - The number of modules is determined ENTIRELY by the content:
     * If the material naturally has 4 major subjects, create 4 modules.
     * If it naturally has 6, create 6.
     * If it naturally has 9, create 9.
     * There is NO target number.
   - NEVER force generic placeholder titles such as:
     * "Chapter Overview"
     * "Introduction"
     * "Core Concepts"
     * "Summary"
     * "Key Takeaways"
     * "Phase 1" / "Phase 2"
     * "Principles Part 1"
     * "Course Overview & Objectives"
   - Every module and lesson title MUST be a specific, content-driven subject derived directly from the presentation.

3. NATURAL GROUPING & RELATIONSHIP PRESERVATION:
   - Group related slides that together explain one cohesive subject into a single module or lesson.
     Examples:
     * PPE Requirement -> Safety Helmet, Safety Glasses, Safety Shoes, Ear Plugs are one related safety topic.
     * Reverse Parking -> Horn Before Reversing, Blind Spots are one related safe-driving topic.
     * Trailer Coupling/Decoupling -> Load Height, Coil Chokes, Stanchions, Lashing are organized according to their actual workflow.
   - Create modules only where the source content naturally forms a major training area.
   - Create lessons only where there is enough meaningful content to teach.
   - Do NOT create artificial lessons just to fill a template.
   - Multiple slides may belong to one lesson. One large topic may contain multiple lessons.
   - Do not assume 1 slide = 1 lesson. Do not assume 1 topic = 1 module.
   - Preserve the logical training sequence of the presentation.

4. REALISTIC TEACHING DURATION:
   - Assign realistic lesson durations between 5 to 15 minutes (e.g. "06:30", "08:45", "12:10").

5. FLAT SEQUENTIAL LESSONS:
   - The "lessons" array MUST be a continuous 1-indexed sequential flat array containing all lessons across all modules (id: 1, id: 2, ... id: N).
   - id: 1 has status: "active", all subsequent lessons have status: "locked".

6. REAL GROUNDED QUIZ:
   - Generate 5 multiple-choice questions derived directly from the real rules, safety procedures, numbers, and warnings in the presentation (with varied answerIndex across 0, 1, 2, 3).

7. OUTPUT FORMAT:
   Return ONLY a raw JSON object matching this schema:
{
  "title": "Specific Course Title Reflecting the Material",
  "description": "A comprehensive 2-3 sentence overview summarizing what learners will master",
  "learning": [
    "Specific practical skill/rule 1",
    "Specific practical skill/rule 2",
    "Specific practical skill/rule 3",
    "Specific practical skill/rule 4"
  ],
  "includes": [
    "Interactive ARIA AI Avatar Tutoring",
    "Comprehensive topic-driven curriculum",
    "Real-time voice Q&A and safety breakdowns",
    "Assessment & verified certificate"
  ],
  "curriculum": [
    { "title": "[Specific Module 1 Title]", "lessons": 2, "duration": "16m", "locked": false }
  ],
  "lessons": [
    {
      "id": 1,
      "chapterId": 1,
      "chapterTitle": "[Specific Module 1 Title]",
      "moduleId": 1,
      "moduleTitle": "[Specific Module 1 Title]",
      "title": "[Specific Lesson 1 Title from Content]",
      "duration": "07:30",
      "status": "active"
    }
  ],
  "quiz": [
    {
      "question": "Clear question testing a real rule/procedure from this course?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 1,
      "explanation": "Why this option is correct based on the training material."
    }
  ]
}`;

    const userPrompt = `Document Filename: ${fileName}\nDocument Length: ${docLength} characters\n\nDocument Content:\n${textSlice}`;

    try {
      const aiResponse = await this._callLLM(systemPrompt, userPrompt, true);
      const parsed = JSON.parse(aiResponse.replace(/```json/g, '').replace(/```/g, '').trim());
      if (parsed.title && Array.isArray(parsed.lessons) && parsed.lessons.length > 0 && parsed.quiz) {
        const slideImageMap = new Map();
        if (Array.isArray(slides)) {
          for (const s of slides) {
            if (s.slideNumber && Array.isArray(s.images) && s.images.length > 0) {
              slideImageMap.set(s.slideNumber, s.images);
            }
          }
        }

        parsed.lessons = parsed.lessons.map((l, idx) => {
          const lessonSourceSlides = Array.isArray(l.sourceSlides) ? l.sourceSlides : [];
          let matchedSlides = lessonSourceSlides.filter(sn => typeof sn === 'number');

          if (matchedSlides.length === 0 && slides.length > 0) {
            matchedSlides = slides
              .filter(s => l.title && s.title && (
                l.title.toLowerCase().includes(s.title.toLowerCase()) ||
                s.title.toLowerCase().includes(l.title.toLowerCase()) ||
                (s.headings && s.headings.some(h => l.title.toLowerCase().includes(h.toLowerCase())))
              ))
              .map(s => s.slideNumber);
          }

          if (matchedSlides.length === 0 && slides.length > 0) {
            matchedSlides = [Math.min(slides.length, idx + 1)];
          }

          const visuals = matchedSlides.flatMap(sn => slideImageMap.get(sn) || []).map(img => ({
            id: img.id,
            dataUrl: img.dataUrl,
            fileName: img.fileName,
            mimetype: img.mimetype,
            sourceSlide: img.slideNumber,
            name: img.name,
            descr: img.descr,
            purpose: img.descr || img.name || `Visual illustration for ${l.title}`,
            triggerKeywords: [
              ...l.title.toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3),
              ...(img.descr || img.name || '').toLowerCase().split(/[\s\-:,]+/).filter(w => w.length > 3)
            ],
            displayWhen: `while explaining ${l.title}`
          }));

          return {
            ...l,
            id: idx + 1,
            sourceSlides: matchedSlides,
            visuals,
            status: idx === 0 ? 'active' : (l.status === 'done' ? 'done' : 'locked'),
            duration: l.duration || '08:00'
          };
        });
        return parsed;
      }
      throw new Error('Incomplete structure from AI response.');
    } catch (e) {
      console.warn('Fallback triggered for generateCourse:', e.message);
      return this._getMockCourse(fileName, fullText, docMetadata);
    }
  }

  /**
   * Generates dynamic assessment questions for a specific chapter/lesson using RAG context.
   */
  async generateLessonQuiz(courseTitle, lessonTitle, contextText, language = 'English') {
    const systemPrompt = `You are ARIA, the expert AI Tutor for SkillBridge.
Generate an interactive multiple-choice assessment quiz for the specific lesson: "${lessonTitle}" in course: "${courseTitle}".
Target Language: ${language}.

CRITICAL QUIZ GENERATION RULES:
1. Target Language: All questions, answer options, and explanations MUST be written fluently in ${language} (e.g. if Tamil (தமிழ்), Chinese (中文), Malay (Bahasa Melayu), Bangla (বাংলা), or English).
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
      const parsed = JSON.parse(aiResponse.replace(/```json/g, '').replace(/```/g, '').trim());
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
1. Target Teaching Language: Deliver the entire lesson explanation, headings, technical breakdowns, analogies, and reflection questions fluently in ${language} (supported: English, Chinese (中文), Malay (Bahasa Melayu), Tamil (தமிழ்), Bangla (বাংলা)).
2. Comprehensive Teaching Duration: Provide an extensive, thorough, and high-value lecture (10-15 clear instructional paragraphs/points). Speak as a world-class instructor explaining each concept step-by-step with depth rather than providing short superficial summaries.
3. Grounding: Draw core principles, terminology, and workflows directly from the retrieved document context.
4. Technical Terminology: Keep recognized technical terms (e.g. PPE, Reversing, Blind Spot, Coupling, Lashing, Stanchions, Checklist) in their standard form alongside the explanation in ${language}.
5. Blackboard Presentation Structure:
   Structure your teaching response into these clear, rich pedagogical sections:
   - ### 💡 Overview & Core Motivation (Detailed intuitive breakdown of what this topic is, why it is critical, and where it fits in the broader training)
   - #### 🎯 Mandatory Requirements & Protocols (4-6 comprehensive bullet points detailing essential rules, safety gear, procedures, or limits)
   - #### 🔍 Step-by-Step Execution & Operational Flow (Step-by-step breakdown of how to execute the procedure correctly and safely)
   - #### 🌐 Real-World Scenario & Practical Case (A vivid, memorable operational scenario demonstrating why this rule exists)
   - #### ⚠️ Critical Hazards & Common Pitfalls (Dangerous mistakes, what can go wrong, and exact prevention steps)
   - #### 📌 Key Safety Takeaways (3 high-value bullet points summarizing the core learnings)
   - #### ⚡ Knowledge Check & Reflection (An insightful question for the learner to test their understanding)`;

    const userPrompt = `Retrieved Course Context:\n${contextText}\n\nLesson to teach: "${lessonTitle}"\nSelected Teaching Language: ${language}`;

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
    const { fileType = 'document', slides = [] } = docMetadata;
    const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    const formattedTitle = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const rawTopics = [];
    if (slides && slides.length > 0) {
      for (const s of slides) {
        if (s.title && !rawTopics.includes(s.title)) {
          const cleanTitle = s.title.replace(/^Slide \d+:?\s*/i, '').trim();
          if (cleanTitle && cleanTitle.length > 2 && !rawTopics.includes(cleanTitle)) {
            rawTopics.push(cleanTitle);
          }
        }
      }
    } else if (text) {
      const paras = text.split(/\n+/);
      for (let p of paras) {
        p = p.trim();
        if (!p || p.length < 3 || p.length > 70) continue;
        if (p.endsWith('.') || p.endsWith(',') || p.endsWith('?') || p.endsWith(';')) continue;
        const clean = p.replace(/^[\d\.\-\s#\*]+/g, '').trim();
        if (clean.length < 4 || clean.length > 60) continue;
        if (!/^[A-Za-z0-9]/.test(clean)) continue;
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

          const lessonObj = {
            id: flatLessons.length + 1,
            chapterId: modId,
            chapterTitle: modTitle,
            moduleId: modId,
            moduleTitle: modTitle,
            title: lessonTitle,
            sourceSlides: [slideNum],
            visuals: slideVisuals,
            duration: `0${Math.floor(7 + ((flatLessons.length) % 5))}:${((flatLessons.length) * 15) % 60 < 10 ? '0' : ''}${((flatLessons.length) * 15) % 60}`,
            status: flatLessons.length === 0 ? 'active' : 'locked'
          };
          modLessons.push(lessonObj);
          flatLessons.push(lessonObj);
        }

        modules.push({
          title: modTitle,
          lessons: modLessons.length,
          duration: `${modLessons.length * 8}m`,
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
        duration: '08:00',
        status: 'active'
      });
      modules.push({
        title: formattedTitle,
        lessons: 1,
        duration: '8m',
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
