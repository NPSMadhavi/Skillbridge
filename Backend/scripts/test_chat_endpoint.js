import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

async function testChatEndpoint() {
  const token = jwt.sign(
    { id: 'b6e087ed-ed34-474d-ac7f-0a58640bf1a6', email: 'premsai@gmail.com', role: 'STUDENT', companyCode: 'default' },
    process.env.JWT_SECRET || 'super-secret-key-change-in-prod',
    { expiresIn: '1h' }
  );

  const courseId = '1dae2738-516c-4dc3-950a-d9465f0de7d2';
  console.log(`Testing POST http://localhost:5000/api/v1/courses/${courseId}/chat...`);

  try {
    const start = Date.now();
    const res = await axios.post(`http://localhost:5000/api/v1/courses/${courseId}/chat`, {
      message: 'What should a driver inspect before operating?',
      lessonTitle: 'Introduction to NatSteel Driver Training',
      currentConcept: 'NatSteel Driver Training Program',
      language: 'en',
      conversationHistory: []
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-tenant-id': 'default'
      },
      timeout: 30000
    });
    console.log(`[SUCCESS] Chat response in ${Date.now() - start}ms:`, res.status, res.data);
  } catch (err) {
    console.error('[FAILED] Chat error:', err.response?.status, err.response?.data || err.message);
  }
}

testChatEndpoint().catch(console.error);
