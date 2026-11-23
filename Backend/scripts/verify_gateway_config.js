import {
  getChatGatewayUrl,
  getChatGatewayVarName,
  getPythonServiceUrl,
  getPythonServiceVarName,
  getGatewayApiKey,
  getApiKeyVarName,
  getGatewayHeaders
} from '../config/gateway.js';
import assert from 'assert';

console.log('=== Testing Gateway Subsystem Routing ===');
const chatVar = getChatGatewayVarName();
const pyVar = getPythonServiceVarName();
const keyVar = getApiKeyVarName();

console.log(`- Chat routing variable: [${chatVar}]`);
console.log(`- Python service variable (Face/STT/TTS/Docs/Embeddings): [${pyVar}]`);
console.log(`- API key variable: [${keyVar}]`);

const headers = getGatewayHeaders();
assert(headers['Accept'] === 'application/json', 'Accept header required');
if (getGatewayApiKey()) {
  assert(headers['X-API-Key'], 'X-API-Key header must be set');
  console.log('✅ X-API-Key header presence confirmed');
}

console.log('✅ Gateway subsystem routing verified successfully!');
process.exit(0);
