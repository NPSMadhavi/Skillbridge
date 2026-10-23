import prisma from '../config/prisma.js';
import aiService from '../services/aiService.js';

async function testChat() {
  console.log('Testing LLM Chat directly...');
  const course = await prisma.course.findUnique({
    where: { id: '73e5eb3a-68a8-45c3-a2e9-45ff24676e29' }
  });

  console.log('Course found:', course.id, course.title);

  const systemPrompt = `You are ARIA, a patient and accurate AI Tutor for SkillBridge.
You explain concepts clearly, use appropriate examples, and adapt explanations to the learner's level.
You are actively teaching the course: "${course.title}".
Selected Teaching Language: English.

CRITICAL CONCISE & UNDERSTANDABLE TUTORING RULES:
1. SHORT & DIRECT (MAX 2-3 SENTENCES): Keep your answer SHORT, CONCISE, and TO THE POINT.
2. SIMPLE & INTUITIVE.`;

  const userPrompt = `Student Question:
What is the first step of 5S?

Selected Response Language:
English`;

  try {
    const start = Date.now();
    const reply = await aiService._callLLM(systemPrompt, userPrompt, false, []);
    console.log(`[SUCCESS] LLM Chat response (${Date.now() - start}ms):`, reply);
  } catch (err) {
    console.error(`[FAILED] LLM Chat error:`, err.status, err.message);
  }
}

testChat().catch(console.error).finally(() => prisma.$disconnect());
