import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config({ path: './Backend/.env' });

import { validateDocumentFile, SUPPORTED_DOCUMENT_EXTENSIONS } from '../services/ubuntuDocumentClient.js';
import aiService from '../services/aiService.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

console.log('====================================================');
console.log('CENTRALIZED UBUNTU DOCUMENT PIPELINE VALIDATION');
console.log('====================================================');

const formats = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'csv', 'rtf', 'html', 'png', 'jpg', 'jpeg'];

await test('All 14 required document formats pass client validation', () => {
  for (const ext of formats) {
    assert(SUPPORTED_DOCUMENT_EXTENSIONS.has(ext), `Missing ${ext}`);
    const out = validateDocumentFile({
      originalname: `sample.${ext}`,
      buffer: Buffer.from('sample content'),
    });
    assert.strictEqual(out, ext);
  }
});

await test('Unsupported formats are rejected with HTTP 415', () => {
  for (const badExt of ['exe', 'sh', 'zip', 'dll']) {
    let thrown = null;
    try {
      validateDocumentFile({ originalname: `bad.${badExt}`, buffer: Buffer.from('abc') });
    } catch (e) {
      thrown = e;
    }
    assert(thrown && thrown.status === 415, `Expected 415 for .${badExt}, got ${thrown?.status}`);
  }
});

await test('Empty file is rejected with HTTP 400', () => {
  let thrown = null;
  try {
    validateDocumentFile({ originalname: 'empty.pdf', buffer: Buffer.alloc(0) });
  } catch (e) {
    thrown = e;
  }
  assert(thrown && thrown.status === 400);
});

await test('1024-d embedding aligns to L2-normalized 768-d for pgvector(768)', () => {
  const vec1024 = Array.from({ length: 1024 }, (_, i) => (i % 5) + 0.1);
  const aligned = aiService._alignEmbeddingDimension(vec1024, 768);
  assert.strictEqual(aligned.length, 768);
  const norm = Math.sqrt(aligned.reduce((s, v) => s + v * v, 0));
  assert(Math.abs(norm - 1.0) < 1e-6, `Expected unit norm, got ${norm}`);
});

await test('aiService.getEmbeddings handles >32 chunks via live Ubuntu Gateway and returns 768-d vectors', async () => {
  const inputs = Array.from({ length: 35 }, (_, i) => `Training module ${i + 1}: workplace safety and PPE compliance.`);
  const vectors = await aiService.getEmbeddings(inputs, 768);
  assert.strictEqual(vectors.length, 35);
  for (const v of vectors) {
    assert.strictEqual(v.length, 768);
  }
});

await test('Backend/routes/courses.js imports cleanly', async () => {
  const mod = await import('../routes/courses.js');
  assert(mod && mod.default);
});

console.log(`\nDOCUMENT PIPELINE TESTS COMPLETED: ${passed} Passed, ${failed} Failed`);
if (failed > 0) process.exit(1);
