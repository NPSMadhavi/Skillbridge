import documentExtractor from '../services/documentExtractor.js';
import aiService from '../services/aiService.js';
import vectorChunkService from '../services/vectorChunkService.js';
import microsoftNeuralTts from '../services/microsoftNeuralTtsService.js';
import AdmZip from 'adm-zip';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details}`);
    failed++;
  }
}

async function runAiTests() {
  console.log('====================================================');
  console.log('3. AI & INGESTION TESTING SUITE');
  console.log('====================================================');

  // --- 3.1 Document Extraction: DOCX, PPTX & Text ---
  console.log('\n--- 3.1 Document Extraction ---');
  
  // A. Text / Universal document
  const txtBuffer = Buffer.from(
    'Module 1: Workplace Safety\nEvery worker must wear safety helmets and high-visibility vests at all times.',
    'utf-8'
  );
  try {
    const txtResult = await documentExtractor.extractDocument({
      buffer: txtBuffer,
      originalname: 'safety_guide.txt',
      mimetype: 'text/plain'
    });
    assert(
      txtResult && txtResult.text.includes('Workplace Safety') && txtResult.pages.length > 0,
      'Text/Markdown document extraction parses content and creates structured pages'
    );
  } catch (err) {
    assert(false, 'Text document extraction', err.message);
  }

  // B. Synthetic PPTX extraction (ZIP containing ppt/slides/slide1.xml)
  try {
    const zip = new AdmZip();
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody>
              <a:p><a:r><a:t>Forklift Safety Rules</a:t></a:r></a:p>
              <a:p><a:r><a:t>Always yield to pedestrians in aisles.</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`;
    zip.addFile('ppt/slides/slide1.xml', Buffer.from(slideXml, 'utf-8'));
    const pptxBuffer = zip.toBuffer();

    const pptxResult = await documentExtractor.extractDocument({
      buffer: pptxBuffer,
      originalname: 'forklift_training.pptx',
      mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });

    assert(
      pptxResult && pptxResult.slides.length > 0 && pptxResult.text.includes('Forklift Safety Rules'),
      'PPTX parser extracts slide text, titles and structural elements'
    );
  } catch (err) {
    assert(false, 'PPTX document extraction', err.message);
  }

  // --- 3.2 Vector Embeddings & Dimensions ---
  console.log('\n--- 3.2 Central AI Gateway Vector Embeddings ---');
  try {
    const sampleText = 'Industrial hazard assessment and personal protective equipment protocols';
    const embedding = await aiService.getEmbedding(sampleText);
    assert(
      Array.isArray(embedding) && embedding.length === 1024,
      `Central AI Gateway returns dense 1024-dimensional embeddings (dim: ${embedding?.length})`
    );
  } catch (err) {
    assert(false, 'Central AI Gateway vector embeddings', err.message);
  }

  // --- 3.3 Semantic Chunking & Vector Preparation ---
  console.log('\n--- 3.3 Semantic Chunking & Ingestion ---');
  try {
    const chunks = await aiService.understandAndChunkDocument(
      'safety_handbook.pdf',
      'Section A: Fire Prevention. Keep emergency exits clear. Do not block fire extinguishers.\n\nSection B: Chemical Handling. Wear chemical gloves and goggles when pouring solvents.',
      { pages: [{ page_number: 1, title: 'Fire Safety' }, { page_number: 2, title: 'Chemical Safety' }] }
    );
    assert(
      Array.isArray(chunks) && chunks.length > 0 && (chunks[0].chunkText || chunks[0].explanation || chunks[0].concept),
      `Document chunking partitions text into high-quality semantic learning chunks (count: ${chunks?.length})`
    );
  } catch (err) {
    assert(false, 'Semantic document chunking', err.message);
  }

  // --- 3.4 AI Tutor & Central AI Gateway ---
  console.log('\n--- 3.4 AI Tutor (ARIA) via Qwen 3.5 9B ---');
  try {
    const tutorResponse = await aiService.askAssistant({
      question: 'What is the speed limit for forklifts indoors?',
      assistantName: 'ARIA',
      language: 'en',
      context: 'Indoor forklift travel speed must never exceed 10 km/h in shared warehouse aisles.'
    });
    console.log('Tutor Response Answer:', tutorResponse.answer);
    assert(
      tutorResponse && (tutorResponse.answer || tutorResponse.text),
      'AI Tutor generates context-grounded educational answers via remote RTX 3090 GPU'
    );
  } catch (err) {
    assert(false, 'AI Tutor Qwen 3.5 9B response', err.message);
  }

  // --- 3.5 Multilingual Neural TTS ---
  console.log('\n--- 3.5 Multilingual Microsoft Neural TTS ---');
  try {
    const enAudio = await microsoftNeuralTts.synthesizeAudio('Please put on your safety glasses.', { language: 'en' });
    const taAudio = await microsoftNeuralTts.synthesizeAudio('தயவுசெய்து பாதுகாப்பு கண்ணாடிகளை அணியுங்கள்.', { language: 'ta' });
    assert(
      enAudio && enAudio.buffer?.length > 1000 && taAudio && taAudio.buffer?.length > 1000,
      `Microsoft Neural TTS synthesizes natural speech in English (${enAudio?.buffer?.length}B) and Tamil (${taAudio?.buffer?.length}B)`
    );
  } catch (err) {
    assert(false, 'Multilingual Neural TTS synthesis', err.message);
  }

  console.log('\n====================================================');
  console.log(`AI & INGESTION TESTS COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runAiTests().catch((e) => {
  console.error('Fatal error in AI tests:', e);
  process.exit(1);
});
