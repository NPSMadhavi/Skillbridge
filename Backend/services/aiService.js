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
   * Generates a complete Course structure (curriculum, lessons, and quiz) from parsed PDF text.
   */
  async generateCourse(fileName, fullText) {
    const textSlice = fullText.slice(0, 15000); 

    const systemPrompt = `You are an expert curriculum designer. 
Analyze the provided document text and structure it into a complete, professional interactive course based ONLY on the actual concepts, chapters, and topics present in the document.
DO NOT use hardcoded lesson templates like "Introduction & Scope", "Core Principles & Frameworks", "Practical Application", "Advanced Analysis", or "Summary & Wrap-up" unless those exact headings literally exist in the document text.
Instead, extract the actual headings, sections, or programming concepts (e.g. if the document discusses Java Variables, Classes, and Objects, then the lessons must be about Java Variables, Classes, and Objects. If it is about React, the lessons must be about React hooks, useState, useEffect).
You must respond with a raw JSON object matching the following structure exactly, and nothing else. No markdown wrapping.
{
  "title": "A short, engaging course title based on the document",
  "description": "A 1-2 sentence description summarizing what the document teaches",
  "learning": ["Objective 1", "Objective 2", "Objective 3", "Objective 4"],
  "includes": ["AI Avatar Instructor", "5 interactive lessons", "Custom Assessment", "Digital Certificate"],
  "curriculum": [
    { "title": "Module 1: [Module Title]", "lessons": 3, "duration": "30m", "locked": false },
    { "title": "Module 2: [Module Title]", "lessons": 2, "duration": "20m", "locked": true }
  ],
  "lessons": [
    { "id": 1, "title": "[Lesson Title 1]", "duration": "01:45", "status": "active" },
    { "id": 2, "title": "[Lesson Title 2]", "duration": "02:10", "status": "locked" },
    { "id": 3, "title": "[Lesson Title 3]", "duration": "01:50", "status": "locked" },
    { "id": 4, "title": "[Lesson Title 4]", "duration": "02:15", "status": "locked" },
    { "id": 5, "title": "[Lesson Title 5]", "duration": "01:30", "status": "locked" }
  ],
  "quiz": [
    {
      "question": "A multiple choice question testing content in this document?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0
    }
  ]
}
Ensure there are exactly 5 lessons in the lessons array. Provide 5 multiple-choice questions in the quiz array based on the text.`;

    const userPrompt = `Document Filename: ${fileName}\n\nDocument Text Preview:\n${textSlice}`;

    try {
      const aiResponse = await this._callLLM(systemPrompt, userPrompt, true);
      const parsed = JSON.parse(aiResponse.replace(/```json/g, '').replace(/```/g, '').trim());
      if (parsed.title && parsed.lessons && parsed.quiz) {
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
   * Synthesizes a conceptual explanation of a lesson using RAG in the user's preferred language.
   * Grounded strictly in the retrieved text chunks.
   */
  async explainLesson(courseTitle, lessonTitle, contextText, language = 'English') {
    const systemPrompt = `You are ARIA, the expert AI Tutor for SkillBridge.
Your student is learning the course: "${courseTitle}".
Current Lesson: "${lessonTitle}".
Active Teaching Language: ${language}.

CRITICAL MULTILINGUAL TEACHING INSTRUCTIONS:
1. Target Teaching Language: You MUST deliver the ENTIRE lesson explanation, headings, concepts, and analogies fluently in ${language} (supported: English, Chinese (中文), Malay (Bahasa Melayu), Tamil (தமிழ்), Bangla (বাংলা)).
2. Explain like an expert human tutor: Break down concepts into simple, intuitive explanations using your own pedagogical words in ${language}. DO NOT recite or copy sentences word-for-word verbatim from the uploaded document, and NEVER mention that you are translating the document.
3. Grounding: Use the provided document context as the source of truth for the lesson's topics and core principles.
4. Technical Terminology: Keep important technical terms (e.g. React, API, Database, State, Function, Loop, Props, Component) in their commonly used English/universal form alongside the explanation in ${language} so the student learns industry-standard terminology.
5. Consistency: Never switch away to English unless citing a commonly recognized technical keyword.
6. Structure your response into clear, engaging sections:
   - ### 💡 Overview & Core Idea (1-2 clear, intuitive sentences explaining what this concept is and why it matters)
   - #### 🎯 Key Principles (3-4 bullet points breaking down the essential rules or components)
   - #### 🌐 Real-World Analogy (A vivid real-world analogy or practical scenario explaining how it works)
   - #### 📌 Summary Takeaways (2 concise bullet points to remember)
   - #### ⚡ Practice Reflection (1 short reflective question for the student to test their understanding)
7. Always provide an encouraging, thorough, and highly pedagogical teaching breakdown in ${language}.`;

    const userPrompt = `Retrieved Course Context:\n${contextText}\n\nLesson to teach: "${lessonTitle}"\nSelected Teaching Language: ${language}`;

    try {
      return await this._callLLM(systemPrompt, userPrompt, false);
    } catch (e) {
      console.warn('Fallback triggered for explainLesson:', e.message);
      return this._getMockExplanation(lessonTitle, language);
    }
  }

  /**
   * Fallback: Generates a structured course mockup using headings extracted from the document
   */
  _getMockCourse(fileName, text) {
    const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    const formattedTitle = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const lessonTitles = [];
    if (text) {
      const paras = text.split(/\n+/);
      for (let p of paras) {
        p = p.trim();
        if (!p || p.length < 3 || p.length > 60) continue;

        // Exclude lines ending with standard body punctuation
        if (p.endsWith('.') || p.endsWith(',') || p.endsWith('?') || p.endsWith(';')) continue;

        // Clean initial numbering/formatting symbols
        const clean = p.replace(/^[\d\.\-\s#\*]+/g, '').trim();
        if (clean.length < 4 || clean.length > 50) continue;

        // Must start with alphanumeric letter
        if (!/^[A-Za-z0-9]/.test(clean)) continue;

        // Exclude descriptions or questions
        const lower = clean.toLowerCase();
        if (lower.includes('write a') || lower.includes('demonstrating this') || lower.includes('practice questions') || lower.includes('example idea')) continue;

        if (!lessonTitles.includes(clean)) {
          lessonTitles.push(clean);
        }
        if (lessonTitles.length >= 5) break;
      }
    }

    const defaultTopics = [
      'Overview & Foundations',
      'Core Implementation & Structure',
      'Key Elements & Functions',
      'Advanced Integration & Testing',
      'Practical Case Study'
    ];
    while (lessonTitles.length < 5) {
      const nextTopic = defaultTopics[lessonTitles.length];
      lessonTitles.push(`${formattedTitle}: ${nextTopic}`);
    }

    return {
      title: `${formattedTitle} Masterclass`,
      description: `Learn the core principles of ${formattedTitle} parsed directly from your uploaded document.`,
      learning: [
        `Understand the fundamental principles of ${lessonTitles[0]}`,
        `Apply core lessons learned in ${lessonTitles[1]} to solve real-world problems`,
        `Synthesize advanced methodologies from ${lessonTitles[2]}`,
        'Verify learning with AI-designed exercises'
      ],
      includes: [
        'ARIA AI Tutor Support',
        '5 conceptual lessons',
        'Dynamic assessment model',
        'Completion certificate'
      ],
      curriculum: [
        { title: 'Module 1: Core Subjects', lessons: 3, duration: '28m', locked: false },
        { title: 'Module 2: Advanced Topics', lessons: 2, duration: '20m', locked: true }
      ],
      lessons: [
        { id: 1, title: lessonTitles[0], duration: '01:45', status: 'active' },
        { id: 2, title: lessonTitles[1], duration: '02:10', status: 'locked' },
        { id: 3, title: lessonTitles[2], duration: '01:50', status: 'locked' },
        { id: 4, title: lessonTitles[3], duration: '02:15', status: 'locked' },
        { id: 5, title: lessonTitles[4], duration: '01:30', status: 'locked' }
      ],
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
