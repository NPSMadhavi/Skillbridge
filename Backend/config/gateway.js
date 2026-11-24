/**
 * Central SkillBridge Gateway configuration.
 *
 * Routing Rules:
 * - Chat calls (/api/v1/chat, /health, /api/v1/models) use SKILLBRIDGE_LLM_GATEWAY_URL / LLM_GATEWAY_URL
 * - Face, STT, TTS, Document/OCR and Embeddings calls use PYTHON_SERVICE_URL (with fallback)
 * - Headers send X-API-Key using SKILLBRIDGE_LLM_GATEWAY_API_KEY first, then LLM_GATEWAY_API_KEY
 */

export function getChatGatewayUrl() {
  const url = process.env.SKILLBRIDGE_LLM_GATEWAY_URL || process.env.LLM_GATEWAY_URL || '';
  return String(url).trim().replace(/\/+$/, '');
}

export function getChatGatewayVarName() {
  if (process.env.SKILLBRIDGE_LLM_GATEWAY_URL) return 'SKILLBRIDGE_LLM_GATEWAY_URL';
  if (process.env.LLM_GATEWAY_URL) return 'LLM_GATEWAY_URL';
  return '(not set)';
}

export function getPythonServiceUrl() {
  const url = process.env.PYTHON_SERVICE_URL || process.env.SKILLBRIDGE_PYTHON_SERVICE_URL || process.env.SKILLBRIDGE_LLM_GATEWAY_URL || process.env.LLM_GATEWAY_URL || '';
  if (String(url).trim()) {
    return String(url).trim().replace(/\/+$/, '');
  }
  return 'https://rtxsvr.tail59469f.ts.net';
}

export function getPythonServiceVarName() {
  if (process.env.PYTHON_SERVICE_URL) return 'PYTHON_SERVICE_URL';
  if (process.env.SKILLBRIDGE_PYTHON_SERVICE_URL) return 'SKILLBRIDGE_PYTHON_SERVICE_URL';
  if (process.env.SKILLBRIDGE_LLM_GATEWAY_URL) return 'SKILLBRIDGE_LLM_GATEWAY_URL (fallback)';
  if (process.env.LLM_GATEWAY_URL) return 'LLM_GATEWAY_URL (fallback)';
  return 'default fallback (http://localhost:8000)';
}

export function getGatewayApiKey() {
  const key =
    process.env.SKILLBRIDGE_API_KEY ||
    process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY ||
    process.env.LLM_GATEWAY_API_KEY ||
    '';
  return String(key).trim();
}

export function getApiKeyVarName() {
  if (process.env.SKILLBRIDGE_API_KEY) return 'SKILLBRIDGE_API_KEY';
  if (process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY) return 'SKILLBRIDGE_LLM_GATEWAY_API_KEY';
  if (process.env.LLM_GATEWAY_API_KEY) return 'LLM_GATEWAY_API_KEY';
  return '(not set)';
}

export function getGatewayHeaders(extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  const apiKey = getGatewayApiKey();
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

// Backward compatibility alias for chat calls
export function getGatewayBaseUrl() {
  return getChatGatewayUrl();
}

export default {
  getChatGatewayUrl,
  getChatGatewayVarName,
  getPythonServiceUrl,
  getPythonServiceVarName,
  getGatewayBaseUrl,
  getGatewayApiKey,
  getApiKeyVarName,
  getGatewayHeaders
};
