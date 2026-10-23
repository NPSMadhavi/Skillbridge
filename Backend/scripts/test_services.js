import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testServices() {
  console.log('--- Testing Services Connectivity ---');

  // 1. Test SKILLBRIDGE_LLM_GATEWAY_URL
  const gatewayUrl = process.env.SKILLBRIDGE_LLM_GATEWAY_URL;
  console.log(`1. Testing LLM Gateway at: ${gatewayUrl}`);
  try {
    const res = await axios.get(`${gatewayUrl}/health`, {
      timeout: 5000,
      headers: {
        'Authorization': `Bearer ${process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY}`
      }
    });
    console.log(`   [SUCCESS] Gateway /health responded:`, res.status, res.data);
  } catch (err) {
    console.error(`   [FAILED] Gateway /health error:`, err.code || err.message);
  }

  // 2. Test PYTHON_SERVICE_URL
  const pyUrl = process.env.PYTHON_SERVICE_URL;
  console.log(`2. Testing Python AI Service at: ${pyUrl}`);
  try {
    const res = await axios.get(`${pyUrl}/health`, { timeout: 5000 });
    console.log(`   [SUCCESS] Python /health responded:`, res.status, res.data);
  } catch (err) {
    console.error(`   [FAILED] Python /health error:`, err.code || err.message);
  }

  // 3. Test OpenAI
  console.log(`3. Testing OpenAI API key: ${process.env.OPENAI_API_KEY ? 'Present' : 'Missing'}`);
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await axios.get('https://api.openai.com/v1/models', {
        timeout: 5000,
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        }
      });
      console.log(`   [SUCCESS] OpenAI responded:`, res.status);
    } catch (err) {
      console.error(`   [FAILED] OpenAI error:`, err.code || err.message, err.response?.data);
    }
  }
}

testServices().catch(console.error);
