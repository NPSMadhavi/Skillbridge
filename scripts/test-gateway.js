const fs = require('fs');
const path = require('path');

// Resolve environment variables from Backend/.env or .env
const envCandidates = [
  path.join(__dirname, '..', 'Backend', '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), 'Backend', '.env'),
  path.join(process.cwd(), '.env')
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const k = trimmed.slice(0, eqIdx).trim();
          let v = trimmed.slice(eqIdx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!(k in process.env)) {
            process.env[k] = v;
          }
        }
      }
    } catch {
      // Ignore env read errors
    }
  }
}

const baseUrl = (
  process.env.SKILLBRIDGE_LLM_GATEWAY_URL ||
  process.env.LLM_GATEWAY_URL ||
  'https://rtxsvr.tail59469f.ts.net'
).trim().replace(/\/+$/, '');

const apiKey = (
  process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY ||
  process.env.LLM_GATEWAY_API_KEY ||
  ''
).trim();

const headers = {
  'Accept': 'application/json'
};
if (apiKey) {
  headers['X-API-Key'] = apiKey;
}

async function run() {
  // 1. GET /health
  try {
    const res = await fetch(`${baseUrl}/health`, { method: 'GET', headers });
    console.log(`GET /health: ${res.status}`);
  } catch (err) {
    console.log(`GET /health: ${err.cause?.code || err.code || err.message}`);
  }

  // 2. GET /api/v1/models
  try {
    const res = await fetch(`${baseUrl}/api/v1/models`, { method: 'GET', headers });
    console.log(`GET /api/v1/models: ${res.status}`);
  } catch (err) {
    console.log(`GET /api/v1/models: ${err.cause?.code || err.code || err.message}`);
  }

  // 3. POST /api/v1/chat
  try {
    const postHeaders = { ...headers, 'Content-Type': 'application/json' };
    const res = await fetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({ message: 'Hello' })
    });
    console.log(`POST /api/v1/chat: ${res.status}`);

    if (res.ok) {
      const data = await res.json();
      const rawText = data?.response || data?.message || data?.reply || '';
      const cleanText = String(rawText)
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\r?\n/g, ' ')
        .trim();
      console.log(`Answer (first 80 chars): ${cleanText.slice(0, 80)}`);
    } else {
      console.log(`Answer: [HTTP ${res.status}]`);
    }
  } catch (err) {
    console.log(`POST /api/v1/chat: ${err.cause?.code || err.code || err.message}`);
  }
}

run();
