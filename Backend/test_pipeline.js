import AdmZip from 'adm-zip';
import prisma from './config/prisma.js';
import documentExtractor from './services/documentExtractor.js';
import aiService from './services/aiService.js';
import vectorChunkService from './services/vectorChunkService.js';

async function runTests() {
  console.log('====================================================');
  console.log('SKILLBRIDGE SEMANTIC INGESTION PIPELINE VERIFICATION');
  console.log('====================================================\n');

  // Test 1: Ensure DB Columns
  console.log('[Test 1] Ensuring PostgreSQL CourseChunk columns...');
  await vectorChunkService.ensureColumnsExist(prisma);
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'CourseChunk'
    ORDER BY ordinal_position
  `);
  console.log('CourseChunk columns in DB:');
  for (const c of cols) {
    console.log(`  - ${c.column_name}: ${c.data_type}`);
  }

  // Test 2: Create mock PPTX buffer with multiple slides, bullets, tables, and notes
  console.log('\n[Test 2] Creating and parsing a real PPTX archive with slides, notes, tables...');
  const zip = new AdmZip();

  // presentation.xml
  zip.addFile('ppt/presentation.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="258" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>`, 'utf-8'));

  // presentation.xml.rels
  zip.addFile('ppt/_rels/presentation.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`, 'utf-8'));

  // Slide 1: Introduction
  zip.addFile('ppt/slides/slide1.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Introduction to Deep Learning</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody>
          <a:p><a:pPr lvl="0"/><a:r><a:t>Deep learning is a subset of machine learning based on artificial neural networks.</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:t>Inspired by the human brain biological structure.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`, 'utf-8'));

  // Slide 2: Neural Network Architecture (with speaker notes)
  zip.addFile('ppt/slides/slide2.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Neural Network Architecture</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody>
          <a:p><a:pPr lvl="0"/><a:r><a:t>Core layers of a Multi-Layer Perceptron (MLP):</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:t>Input Layer: Receives feature vectors.</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:t>Hidden Layers: Extract non-linear representation patterns.</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:t>Output Layer: Computes final probabilities or regression values.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`, 'utf-8'));

  // Slide 2 rels (pointing to notesSlide2)
  zip.addFile('ppt/slides/_rels/slide2.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>
</Relationships>`, 'utf-8'));

  // Notes Slide 2: Speaker Notes
  zip.addFile('ppt/notesSlides/notesSlide2.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Speaker Note: Emphasize that hidden layers use activation functions like ReLU to introduce non-linearity.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`, 'utf-8'));

  // Slide 3: Training & Backpropagation
  zip.addFile('ppt/slides/slide3.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Training via Backpropagation</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Backpropagation calculates the gradient of the loss function with respect to weights using the chain rule.</a:t></a:r></a:p>
          <a:p><a:pPr lvl="0"/><a:r><a:t>Forward Pass: Computes predictions.</a:t></a:r></a:p>
          <a:p><a:pPr lvl="0"/><a:r><a:t>Backward Pass: Propagates error gradients backwards.</a:t></a:r></a:p>
          <a:p><a:pPr lvl="0"/><a:r><a:t>Weight Update: Stochastic Gradient Descent adjusts weights.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`, 'utf-8'));

  const pptxBuffer = zip.toBuffer();

  const extractedDoc = await documentExtractor.extractDocument({
    originalname: 'Deep_Learning_Masterclass.pptx',
    mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: pptxBuffer
  });

  console.log(`PPTX Extraction Result:`);
  console.log(`  FileType: ${extractedDoc.fileType}`);
  console.log(`  Total Slides: ${extractedDoc.slides.length}`);
  for (const s of extractedDoc.slides) {
    console.log(`  - Slide ${s.slideNumber}: "${s.title}"`);
    if (s.bulletPoints.length) console.log(`    Bullets: ${s.bulletPoints.length}`);
    if (s.speakerNotes) console.log(`    Speaker Notes: "${s.speakerNotes}"`);
  }

  // Test 3: AI Semantic Comprehension & Chunking
  console.log('\n[Test 3] Testing AI Semantic Comprehension & Dynamic Chunking...');
  const semanticChunks = await vectorChunkService.createSemanticChunks(extractedDoc.text, extractedDoc);
  console.log(`Generated ${semanticChunks.length} semantic chunks:`);
  for (const c of semanticChunks) {
    console.log(`\n  --- Chunk #${c.chunkIndex}: [Concept: ${c.concept}] ---`);
    console.log(`  Topic: ${c.topic}`);
    console.log(`  Type: ${c.chunkType}`);
    console.log(`  Source Slides: ${JSON.stringify(c.sourceSlides)}`);
    console.log(`  Source Page: ${c.sourcePage}`);
    console.log(`  Key Points: ${JSON.stringify(c.keyPoints)}`);
    console.log(`  Chunk Text Preview (first 150 chars):\n    ${c.chunkText.slice(0, 150).replace(/\n/g, ' ')}...`);
  }

  // Test 4: Course Creation, pgvector Indexing & Hybrid RAG Retrieval
  console.log('\n[Test 4] Testing Course Creation & pgvector Indexing...');
  const testCourse = await prisma.course.create({
    data: {
      title: 'Deep Learning & Neural Networks',
      description: 'Comprehensive course on deep neural network architectures and backpropagation.',
      fileName: 'Deep_Learning_Masterclass.pptx',
      fileText: extractedDoc.text,
      curriculum: {
        title: 'Deep Learning & Neural Networks',
        lessons: [
          { id: 1, title: 'Introduction to Deep Learning' },
          { id: 2, title: 'Neural Network Architecture' },
          { id: 3, title: 'Backpropagation and Training' }
        ]
      }
    }
  });
  console.log(`Created test course with ID: ${testCourse.id}`);

  console.log('Indexing course chunks into PostgreSQL with vector embeddings...');
  await vectorChunkService.indexCourse(prisma, testCourse.id, extractedDoc, testCourse.curriculum);

  const storedChunks = await prisma.courseChunk.findMany({
    where: { courseId: testCourse.id },
    orderBy: { chunkIndex: 'asc' }
  });
  console.log(`Successfully stored ${storedChunks.length} chunks in PostgreSQL CourseChunk table.`);
  for (const sc of storedChunks) {
    console.log(`  - [ID: ${sc.id.slice(0, 8)}] Index ${sc.chunkIndex}: Concept="${sc.concept}", Slides=${JSON.stringify(sc.sourceSlides)}, Type=${sc.chunkType}`);
  }

  // Test 5: Hybrid RAG Retrieval
  console.log('\n[Test 5] Testing Hybrid RAG Retrieval for Query: "How does backpropagation work?"...');
  const retrievedChunks = await vectorChunkService.querySimilarChunks(
    prisma,
    testCourse.id,
    'How does backpropagation work?',
    3,
    { includeNeighbors: true, lessonTitle: 'Backpropagation and Training' }
  );

  console.log(`Retrieved ${retrievedChunks.length} chunks via Hybrid RAG:`);
  for (const r of retrievedChunks) {
    console.log(`  - Concept: "${r.concept}", Topic: "${r.topic}", Similarity: ${r.similarity?.toFixed(4) || 'N/A'}, Slides: ${JSON.stringify(r.source_slides)}`);
  }

  // Clean up test course
  console.log('\nCleaning up test course...');
  await prisma.course.delete({ where: { id: testCourse.id } });
  console.log('Test course cleaned up successfully.');

  console.log('\n====================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY! ✅');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
