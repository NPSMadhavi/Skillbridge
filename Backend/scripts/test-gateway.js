import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getGatewayBaseUrl, getGatewayApiKey } from '../config/gateway.js';

// Resolve environment variables from Backend/.env or .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'Backend', '.env')
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

const baseUrl = getGatewayBaseUrl();
const apiKey = getGatewayApiKey();

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

  // 4. Every AI feature must be served by this same gateway.
  // A GET on a POST-only route returns 405 when the route exists on the gateway;
  // an HTML 404 means the route is not exposed on this gateway address.
  const featureRoutes = [
    ['Face extraction (Face ID login)', '/api/v1/face/extract'],
    ['Speech to text (voice input)', '/api/v1/stt/transcribe'],
    ['Embeddings (course RAG)', '/api/v1/embeddings'],
    ['TTS fallback (ARIA voice)', '/api/v1/tts/synthesize'],
    ['OCR (document visuals)', '/api/v1/ocr'],
  ];

  console.log('\nGateway route availability:');
  for (const [label, route] of featureRoutes) {
    try {
      const res = await fetch(`${baseUrl}${route}`, { method: 'GET', headers });
      const contentType = res.headers.get('content-type') || '';
      const exposed = res.status !== 404 || !contentType.includes('text/html');
      console.log(`  ${label} ${route}: ${res.status} ${exposed ? 'EXPOSED' : 'NOT EXPOSED on this gateway address'}`);
    } catch (err) {
      console.log(`  ${label} ${route}: ${err.cause?.code || err.code || err.message}`);
    }
  }
}

run();
