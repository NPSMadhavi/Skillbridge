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
   * Generates a complete dynamic Course structure (chapters, modules, lessons, and quiz)
   * tailored to the uploaded document length, complexity, and sections.
   */
  async generateCourse(fileName, fullText) {
    const docLength = fullText.length;
    // For very long documents, sample introduction, middle sections, and conclusion
    let textSlice = fullText;
    if (docLength > 35000) {
      const part1 = fullText.slice(0, 15000);
      const mid = Math.floor(docLength / 2);
      const part2 = fullText.slice(mid - 5000, mid + 5000);
      const part3 = fullText.slice(-10000);
      textSlice = `${part1}\n\n[... middle section ...]\n\n${part2}\n\n[... concluding section ...]\n\n${part3}`;
    } else {
      textSlice = fullText.slice(0, 35000);
    }

    const systemPrompt = `You are an expert curriculum architect and senior instructional designer.
Analyze the provided document text and synthesize a complete, professional, multi-tiered interactive curriculum based SOLELY on the actual content, chapters, and topics present in the document.

DYNAMIC CURRICULUM ARCHITECTURE RULES:
1. Dynamic Scope Based on Document Depth:
   - Determine the number of Chapters, Modules, and Lessons dynamically based on document length and topic richness.
   - Small documents: 2-3 Chapters, 4-6 Total Lessons.
   - Medium documents: 3-5 Chapters, 6-12 Total Lessons.
   - Large / comprehensive documents: 5-8+ Chapters, 12-20+ Total Lessons.
   - DO NOT artificially cap or force the course to 5 lessons. Let the curriculum naturally reflect the full breadth of the material.
2. Two or More Modules per Chapter:
   - Every Chapter MUST contain at least 2 distinct, meaningful Modules (e.g. Chapter 1 -> Module 1.1 Foundations, Module 1.2 Core Mechanisms).
   - Each Module must contain 1 to 3 concrete Lessons derived from the document's actual concepts.
3. Content-Driven Topics:
   - Extract real headings, algorithms, technical definitions, and domain topics from the text.
   - Avoid generic placeholder titles like "Introduction & Scope" or "Advanced Analysis" unless they literally reflect the text.
4. Realistic Teaching Durations:
   - Assign realistic lesson durations between 5 to 15 minutes (e.g. "06:30", "08:45", "12:10") to represent substantial, high-value learning sessions.
5. Flat Sequential Lessons Array:
   - The "lessons" array MUST be a continuous, 1-indexed flat array containing ALL lessons across all chapters and modules in sequential learning order (Lesson 1 -> Lesson 2 -> ... -> Lesson N).
   - The first lesson (id: 1) has status "active", all subsequent lessons have status "locked".
6. Output Format:
   You must respond with a raw JSON object matching the following structure exactly, and nothing else. No markdown code fences.
{
  "title": "A concise, professional course title reflecting the document",
  "description": "A comprehensive 2-3 sentence overview summarizing what learners will master",
  "learning": [
    "Master foundational concepts of [Topic A]",
    "Implement and configure [Topic B] workflows",
    "Analyze and debug [Topic C] architectures",
    "Apply best practices for [Topic D] in production environments"
  ],
  "includes": [
    "Interactive ARIA AI Avatar Tutoring",
    "Multi-chapter comprehensive curriculum",
    "Real-time voice Q&A and concept breakdowns",
    "Chapter assessments & verified certificate"
  ],
  "chapters": [
    {
      "chapterId": 1,
      "title": "Chapter 1: [Chapter Title]",
      "description": "Brief description of this chapter's domain",
      "modules": [
        {
          "moduleId": 1,
          "title": "Module 1.1: [Module Title]",
          "lessons": [
            { "id": 1, "title": "[Specific Lesson Title 1]", "duration": "07:30", "status": "active" },
            { "id": 2, "title": "[Specific Lesson Title 2]", "duration": "09:15", "status": "locked" }
          ]
        },
        {
          "moduleId": 2,
          "title": "Module 1.2: [Module Title]",
          "lessons": [
            { "id": 3, "title": "[Specific Lesson Title 3]", "duration": "08:45", "status": "locked" }
          ]
        }
      ]
    }
  ],
  "curriculum": [
    { "title": "Chapter 1: [Chapter Title]", "lessons": 3, "duration": "25m", "locked": false }
  ],
  "lessons": [
    {
      "id": 1,
      "chapterId": 1,
      "chapterTitle": "Chapter 1: [Chapter Title]",
      "moduleId": 1,
      "moduleTitle": "Module 1.1: [Module Title]",
      "title": "[Specific Lesson Title 1]",
      "duration": "07:30",
      "status": "active"
    },
    {
      "id": 2,
      "chapterId": 1,
      "chapterTitle": "Chapter 1: [Chapter Title]",
      "moduleId": 1,
      "moduleTitle": "Module 1.1: [Module Title]",
      "title": "[Specific Lesson Title 2]",
      "duration": "09:15",
      "status": "locked"
    },
    {
      "id": 3,
      "chapterId": 1,
      "chapterTitle": "Chapter 1: [Chapter Title]",
      "moduleId": 2,
      "moduleTitle": "Module 1.2: [Module Title]",
      "title": "[Specific Lesson Title 3]",
      "duration": "08:45",
      "status": "locked"
    }
  ],
  "quiz": [
    {
      "question": "A multiple-choice question testing understanding of concepts in this course?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 1
    }
  ]
}`;

    const userPrompt = `Document Filename: ${fileName}\nDocument Length: ${docLength} characters\n\nDocument Text Content Preview:\n${textSlice}`;

    try {
      const aiResponse = await this._callLLM(systemPrompt, userPrompt, true);
      const parsed = JSON.parse(aiResponse.replace(/```json/g, '').replace(/```/g, '').trim());
      if (parsed.title && Array.isArray(parsed.lessons) && parsed.lessons.length > 0 && parsed.quiz) {
        // Ensure lessons have clean 1-based sequential IDs and active status for lesson 1
        parsed.lessons = parsed.lessons.map((l, idx) => ({
          ...l,
          id: idx + 1,
          status: idx === 0 ? 'active' : (l.status === 'done' ? 'done' : 'locked'),
          duration: l.duration || '08:00'
        }));
        return parsed;
      }
      throw new Error('Incomplete structure from AI response.');
    } catch (e) {
      console.warn('Fallback triggered for generateCourse:', e.message);
      return this._getMockCourse(fileName, fullText);
    }
  }

  /**
   * Generates dynamic assessment questions for a specific chapter/lesson using RAG context.
   */
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
          question: `What is the primary objective of the chapter "${lessonTitle}"?`,
          options: [
            'To memorize unrelated historical dates and figures',
            `To master foundational concepts and core principles of ${lessonTitle}`,
            'To bypass practical exercises and code reviews',
            'None of the above'
          ],
          answerIndex: 1,
          explanation: `Mastering foundational concepts and core principles provides the essential knowledge needed for ${lessonTitle}.`
        },
        {
          question: `How are principles in "${lessonTitle}" applied in practice?`,
          options: [
            'By ignoring core logic and validation rules',
            'By using deprecated legacy syntax',
            'By skipping validation testing entirely',
            'By applying structured concepts and verifying implementations step by step'
          ],
          answerIndex: 3,
          explanation: 'Applying structured concepts and verifying implementations step-by-step ensures system reliability and prevents execution errors.'
        },
        {
          question: `What is a key best practice emphasized in "${lessonTitle}"?`,
          options: [
            'Writing unorganized code without comments or documentation',
            'Skipping assessment reviews and unit testing',
            'Maintaining clean modular architecture and robust error checking',
            'Hardcoding dynamic credentials into source files'
          ],
          answerIndex: 2,
          explanation: 'Maintaining clean modular architecture and robust error checking is a fundamental software engineering best practice.'
        },
        {
          question: `Which approach ensures successful implementation of "${lessonTitle}"?`,
          options: [
            'Iterative testing, clear documentation, and standard workflow patterns',
            'Randomly guessing configuration settings',
            'Ignoring API status codes and responses',
            'Disabling error logs during execution'
          ],
          answerIndex: 0,
          explanation: 'Iterative testing, clear documentation, and standard workflow patterns ensure maintainable and robust implementations.'
        },
        {
          question: `What is the main takeaway from completing "${lessonTitle}"?`,
          options: [
            'Writing monolithic single-file applications',
            'Skipping assessment reviews',
            'Deleting document references',
            'Understanding underlying mechanics and building scalable solutions'
          ],
          answerIndex: 3,
          explanation: `Understanding the underlying mechanics of ${lessonTitle} enables developers to construct efficient, scalable solutions.`
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
4. Technical Terminology: Keep recognized technical terms (e.g. React, API, Database, Vector, State, Function, Component) in their standard form alongside the explanation in ${language}.
5. Blackboard Presentation Structure:
   Structure your teaching response into these clear, rich pedagogical sections:
   - ### 💡 Overview & Core Motivation (Detailed intuitive breakdown of what this topic is, why it is critical, and where it fits in the broader architecture)
   - #### 🎯 Foundational Principles & Pillars (4-6 comprehensive bullet points detailing essential rules, mechanisms, and properties)
   - #### 🔍 Technical Deep-Dive & Execution Flow (Step-by-step explanation of how the system/process operates from start to finish)
   - #### 🌐 Real-World Analogy & Practical Case (A vivid, memorable real-world analogy and industry practical scenario)
   - #### ⚠️ Common Pitfalls & Best Practices (What mistakes engineers/learners commonly make and how to avoid them)
   - #### 📌 Key Architectural Takeaways (3 high-value bullet points summarizing the core learnings)
   - #### ⚡ Practice Reflection & Challenge (An insightful question for the learner to test their mental model)`;

    const userPrompt = `Retrieved Course Context:\n${contextText}\n\nLesson to teach: "${lessonTitle}"\nSelected Teaching Language: ${language}`;

    try {
      return await this._callLLM(systemPrompt, userPrompt, false);
    } catch (e) {
      console.warn('Fallback triggered for explainLesson:', e.message);
      return this._getMockExplanation(lessonTitle, language);
    }
  }

  /**
   * Fallback: Generates a structured dynamic course mockup using headings extracted from the document
   */
  _getMockCourse(fileName, text) {
    const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    const formattedTitle = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const extractedHeadings = [];
    if (text) {
      const paras = text.split(/\n+/);
      for (let p of paras) {
        p = p.trim();
        if (!p || p.length < 3 || p.length > 70) continue;
        if (p.endsWith('.') || p.endsWith(',') || p.endsWith('?') || p.endsWith(';')) continue;
        const clean = p.replace(/^[\d\.\-\s#\*]+/g, '').trim();
        if (clean.length < 4 || clean.length > 60) continue;
        if (!/^[A-Za-z0-9]/.test(clean)) continue;
        const lower = clean.toLowerCase();
        if (lower.includes('write a') || lower.includes('practice question') || lower.includes('table of contents')) continue;

        if (!extractedHeadings.includes(clean)) {
          extractedHeadings.push(clean);
        }
        if (extractedHeadings.length >= 16) break;
      }
    }

    // Determine target lesson count based on text volume
    const textLen = (text || '').length;
    const targetLessonCount = textLen > 30000 ? Math.min(16, Math.max(8, extractedHeadings.length)) :
                              textLen > 10000 ? Math.min(10, Math.max(6, extractedHeadings.length)) :
                              Math.max(4, Math.min(6, extractedHeadings.length || 4));

    const defaultTopics = [
      'Foundations & Core Scope',
      'Architectural Mechanisms',
      'Component Lifecycles & Flow',
      'Practical Implementation Patterns',
      'Advanced Configuration & Optimization',
      'Error Handling & Reliability',
      'Security & Standard Compliance',
      'End-to-End Case Study Analysis'
    ];

    while (extractedHeadings.length < targetLessonCount) {
      const idx = extractedHeadings.length % defaultTopics.length;
      extractedHeadings.push(`${formattedTitle}: ${defaultTopics[idx]}`);
    }

    // Group into chapters with 2+ modules per chapter
    const chapters = [];
    const flatLessons = [];
    const numChapters = Math.max(2, Math.ceil(targetLessonCount / 4));
    let lessonIndex = 0;

    for (let c = 0; c < numChapters; c++) {
      const chapterId = c + 1;
      const chapterTitle = `Chapter ${chapterId}: ${extractedHeadings[lessonIndex] || `${formattedTitle} Phase ${chapterId}`}`;
      const modules = [];

      // 2 modules per chapter
      for (let m = 0; m < 2; m++) {
        const moduleId = m + 1;
        const moduleLessons = [];
        const lessonsInMod = (c === numChapters - 1 && m === 1) 
          ? Math.max(1, targetLessonCount - lessonIndex)
          : Math.max(1, Math.floor((targetLessonCount - lessonIndex) / (2 * (numChapters - c))));

        const actualTake = Math.min(lessonsInMod, targetLessonCount - lessonIndex);
        const moduleTitle = `Module ${chapterId}.${moduleId}: ${extractedHeadings[lessonIndex] || `Principles Part ${moduleId}`}`;

        for (let l = 0; l < actualTake; l++) {
          const currentLessonTitle = extractedHeadings[lessonIndex] || `Lesson ${lessonIndex + 1}`;
          const lessonObj = {
            id: flatLessons.length + 1,
            chapterId,
            chapterTitle,
            moduleId,
            moduleTitle,
            title: currentLessonTitle,
            duration: `0${Math.floor(6 + (lessonIndex % 7))}:${(lessonIndex * 15) % 60 < 10 ? '0' : ''}${(lessonIndex * 15) % 60}`,
            status: flatLessons.length === 0 ? 'active' : 'locked'
          };
          moduleLessons.push(lessonObj);
          flatLessons.push(lessonObj);
          lessonIndex++;
          if (lessonIndex >= targetLessonCount) break;
        }

        if (moduleLessons.length > 0) {
          modules.push({
            moduleId,
            title: moduleTitle,
            lessons: moduleLessons
          });
        }
        if (lessonIndex >= targetLessonCount) break;
      }

      if (modules.length > 0) {
        chapters.push({
          chapterId,
          title: chapterTitle,
          description: `Master concepts in ${chapterTitle}`,
          modules
        });
      }
      if (lessonIndex >= targetLessonCount) break;
    }

    const curriculumSummary = chapters.map(ch => ({
      title: ch.title,
      lessons: ch.modules.reduce((acc, m) => acc + m.lessons.length, 0),
      duration: `${ch.modules.reduce((acc, m) => acc + m.lessons.length * 8, 0)}m`,
      locked: ch.chapterId > 1
    }));

    return {
      title: `${formattedTitle} Masterclass`,
      description: `Comprehensive interactive curriculum for ${formattedTitle} structured into ${chapters.length} chapters and ${flatLessons.length} sequential lesson modules.`,
      learning: [
        `Master foundational architecture of ${flatLessons[0]?.title || formattedTitle}`,
        `Implement core workflows and verified industry patterns`,
        `Troubleshoot and optimize complex implementations`,
        'Validate full mastery with AI-generated assessments'
      ],
      includes: [
        'Interactive ARIA AI Avatar Tutoring',
        `${flatLessons.length} in-depth sequential lessons`,
        `${chapters.length} structured learning chapters`,
        'Digital verified completion certificate'
      ],
      chapters,
      curriculum: curriculumSummary,
      lessons: flatLessons,
      quiz: [
        {
          question: `What is the primary focus of the document "${fileName}"?`,
          options: [
            `To introduce foundational concepts of ${formattedTitle}`,
            'To provide unrelated historical examples',
            'To document software installation steps only',
            'To list dictionary definitions'
          ],
          answerIndex: 0
        },
        {
          question: `Which of the following describes the AI explanation mode for this course?`,
          options: [
            'Verbatim reading of the PDF content',
            'No explanation provided',
            'Conceptual explanation synthesized in the AI\'s own words',
            'Random sentence extraction'
          ],
          answerIndex: 2
        },
        {
          question: `What makes RAG customized courses highly effective?`,
          options: [
            'They adapt to the uploaded document and synthesize custom learning dynamically',
            'They are fixed and cannot be changed',
            'They bypass exams entirely',
            'They only work with text files under 10 words'
          ],
          answerIndex: 0
        },
        {
          question: `How does ARIA AI Tutor support students in custom courses?`,
          options: [
            'By grading papers manually over 3 weeks',
            'By explaining lessons, answering questions, and offering dynamic quizzes',
            'By providing pre-recorded video lectures only',
            'By sending automated email newsletters'
          ],
          answerIndex: 1
        },
        {
          question: `What is the final step in completing the custom course?`,
          options: [
            'Uploading another document immediately',
            'Re-reading the PDF 10 times',
            'Passing the custom assessment generated by ARIA',
            'Logging out of the application'
          ],
          answerIndex: 2
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
