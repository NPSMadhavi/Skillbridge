import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class AIService {
  /**
   * Helper to make ChatCompletion calls
   */
  async _callLLM(systemPrompt, userPrompt, jsonMode = false) {
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

      const payload = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
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
    const systemPrompt = `You are ARIA, the intelligent AI Tutor for SkillBridge.
Your student is learning the course: "${courseTitle}".
They have selected the lesson: "${lessonTitle}".
Target Teaching Language: ${language}.

CRITICAL TEACHING INSTRUCTIONS:
1. Target Teaching Language: You MUST deliver the ENTIRE lesson explanation, headings, analogies, and concepts fluently in ${language} (e.g. Tamil தமிழ், Chinese 中文, Malay Bahasa Melayu, Bangla বাংলা, or English).
2. DO NOT recite or copy sentences word-by-word verbatim from the uploaded document. The student does NOT want a raw textbook reading.
3. Teach the topic **conceptually**: break down complex ideas into simple, intuitive explanations using your own pedagogical words in ${language}, drawing upon the provided document context and your expert AI knowledge.
4. Structure your response into clear, engaging sections:
   - ### 💡 Overview & Core Idea (1-2 sentences explaining what this concept is and why it matters)
   - #### 🎯 Key Principles (Bullet points highlighting the main rules or components)
   - #### 🌐 Real-World Analogy (An easy-to-understand analogy or practical scenario explaining how it works)
   - #### 📌 Summary Takeaways (2 concise bullet points to remember)
   - #### ⚡ Practice Reflection (1 short question to help the student test their understanding)
5. Always provide a rich, encouraging, and complete teaching breakdown in ${language}. NEVER refuse to answer.`;

    const userPrompt = `Document context:\n${contextText}\n\nLesson to explain: ${lessonTitle}\nLanguage: ${language}`;

    try {
      return await this._callLLM(systemPrompt, userPrompt, false);
    } catch (e) {
      console.warn('Fallback triggered for explainLesson:', e.message);
      return this._getMockExplanation(lessonTitle);
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
  _getMockExplanation(lessonTitle) {
    return `### 🤖 ARIA AI Tutor Guide: ${lessonTitle}

Hello! I am **ARIA**, your personal learning companion. I have reviewed the chapter content regarding **${lessonTitle}**, and I am excited to explain it in my own words to help you master these concepts.

---

#### 🌟 Key Concepts Explained

1. **Core Subject Matter**
   Rather than repeating the document directly, let's focus on the key ideas present in your uploaded guide for **${lessonTitle}**.

2. **Concept Synthesis**
   Every major topic in this chapter builds upon raw technical definitions. We map these parameters to establish solid, predictable behaviors.

3. **Practical Application**
   We apply these principles to create active, responsive implementations. Understanding this lesson is about knowing how to apply it in real-world scenarios.

---

#### 📌 Key Takeaways
- **Aria's Tip:** Conceptual learning is always superior to rote memorization.
- Focus on the mechanics of the system rather than just the definitions.

---

#### ⚡ Practice Challenge
*Try to summarize the relationship between structured parameters and open-ended definitions in a single sentence. Ask me if you want me to critique your answer!*`;
  }
}

export default new AIService();
