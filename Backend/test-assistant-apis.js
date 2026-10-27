import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000/api/v1';

console.log('====================================================');
console.log('      BACKEND ASSISTANT APIS END-TO-END TEST        ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  try {
    // 1. GET initial assistant settings
    console.log('--- 1. Testing GET /api/assistant/settings ---');
    const getRes = await fetch(`${BASE_URL}/assistant/settings`);
    assert(getRes.ok, `GET /api/assistant/settings returned status ${getRes.status}`);
    const initialSettings = await getRes.json();
    console.log('Current Assistant Settings:', initialSettings);
    assert(Boolean(initialSettings.assistantName), `Found assistantName: "${initialSettings.assistantName}"`);
    assert(Boolean(initialSettings.wakeWord), `Found wakeWord: "${initialSettings.wakeWord}"`);

    // 2. PUT update assistant name to "Veda"
    console.log('\n--- 2. Testing PUT /api/assistant/settings (Update to "Veda") ---');
    const putRes1 = await fetch(`${BASE_URL}/assistant/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantName: 'Veda',
        wakeWord: 'Hey Veda'
      })
    });
    assert(putRes1.ok, `PUT /api/assistant/settings returned status ${putRes1.status}`);
    const putData1 = await putRes1.json();
    console.log('Update Response:', putData1.message);
    assert(putData1.settings.assistantName === 'Veda', 'Updated assistantName is "Veda"');
    assert(putData1.settings.wakeWord === 'Hey Veda', 'Updated wakeWord is "Hey Veda"');

    // Verify GET now returns "Veda"
    const getResVeda = await fetch(`${BASE_URL}/assistant/settings`);
    const vedaSettings = await getResVeda.json();
    assert(vedaSettings.assistantName === 'Veda', 'GET immediately returns "Veda" without server restart');

    // 3. Test POST /api/voice/ask with identity question "What is your name?"
    console.log('\n--- 3. Testing POST /api/voice/ask ("What is your name?") ---');
    const nameRes = await fetch(`${BASE_URL}/voice/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'What is your name?'
      })
    });
    assert(nameRes.ok, `POST /api/voice/ask returned status ${nameRes.status}`);
    const nameData = await nameRes.json();
    console.log('AI Answer to "What is your name?":\n  ->', nameData.text);
    assert(nameData.text.toLowerCase().includes('veda'), 'Answer introduces self as "Veda"');

    // 4. Test POST /api/voice/ask with general knowledge question
    console.log('\n--- 4. Testing POST /api/voice/ask ("What is artificial intelligence?") ---');
    const aiRes = await fetch(`${BASE_URL}/voice/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'What is artificial intelligence in one brief sentence?'
      })
    });
    assert(aiRes.ok, `POST /api/voice/ask returned status ${aiRes.status}`);
    const aiData = await aiRes.json();
    console.log('AI Answer:\n  ->', aiData.text);
    assert(aiData.text && aiData.text.length > 10, 'Received valid answer from LLM/Qwen pipeline');

    // 5. PUT update assistant name to "Maya"
    console.log('\n--- 5. Testing PUT /api/assistant/settings (Update to "Maya") ---');
    const putRes2 = await fetch(`${BASE_URL}/assistant/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantName: 'Maya',
        wakeWord: 'Hey Maya'
      })
    });
    assert(putRes2.ok, `PUT returned status ${putRes2.status}`);
    const mayaSettings = (await putRes2.json()).settings;
    assert(mayaSettings.assistantName === 'Maya', 'Assistant name switched to "Maya"');

    // Verify identity query now reflects "Maya"
    const mayaAskRes = await fetch(`${BASE_URL}/voice/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Who are you?'
      })
    });
    const mayaAskData = await mayaAskRes.json();
    console.log('AI Answer to "Who are you?":\n  ->', mayaAskData.text);
    assert(mayaAskData.text.toLowerCase().includes('maya'), 'Answer introduces self as "Maya"');

    console.log(`\n====================================================`);
    console.log(`Total Passed: ${passed}, Total Failed: ${failed}`);
    console.log(`====================================================\n`);
    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
