import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { enrichDocumentVisuals, extractEmbeddedRasterImages } from './visualTextService.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true
});

/**
 * Robust, deep extractor for PPTX files.
 * Extracts slide order, slide numbers, slide titles, headings, bullet hierarchies,
 * body paragraphs, tables, group shapes, and presenter speaker notes.
 */
function extractPptx(buffer) {
  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries();
  const entryMap = new Map();

  for (const entry of zipEntries) {
    entryMap.set(entry.entryName.toLowerCase(), entry);
  }

  // 1. Determine slide order from ppt/presentation.xml and ppt/_rels/presentation.xml.rels
  let slidePaths = [];
  try {
    const presEntry = entryMap.get('ppt/presentation.xml');
    const presRelsEntry = entryMap.get('ppt/_rels/presentation.xml.rels');

    if (presEntry && presRelsEntry) {
      const presXml = xmlParser.parse(presEntry.getData().toString('utf-8'));
      const relsXml = xmlParser.parse(presRelsEntry.getData().toString('utf-8'));

      const relsList = Array.isArray(relsXml?.Relationships?.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml?.Relationships?.Relationship].filter(Boolean);

      const rIdToTarget = new Map();
      for (const rel of relsList) {
        if (rel['@_Id'] && rel['@_Target']) {
          let target = rel['@_Target'];
          if (!target.startsWith('ppt/')) {
            target = 'ppt/' + target.replace(/^\.\.\//, '').replace(/^\//, '');
          }
          rIdToTarget.set(rel['@_Id'], target.toLowerCase());
        }
      }

      const sldIdList = presXml?.['p:presentation']?.['p:sldIdLst']?.['p:sldId'];
      const slideNodes = Array.isArray(sldIdList) ? sldIdList : [sldIdList].filter(Boolean);

      for (const sNode of slideNodes) {
        const rId = sNode['@_r:id'];
        if (rId && rIdToTarget.has(rId)) {
          slidePaths.push(rIdToTarget.get(rId));
        }
      }
    }
  } catch (err) {
    console.warn('[Doc Extractor] Notice while reading PPTX presentation.xml order:', err.message);
  }

  // Fallback if presentation.xml parsing produced no slides: sort slide entries numerically
  if (slidePaths.length === 0) {
    const rawSlideEntries = zipEntries
      .filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => {
        const numA = parseInt(a.entryName.match(/\d+/)?.[0] || '0', 10);
        const numB = parseInt(b.entryName.match(/\d+/)?.[0] || '0', 10);
        return numA - numB;
      });
    slidePaths = rawSlideEntries.map(e => e.entryName.toLowerCase());
  }

  // Helper: recursively extract text runs and bullet items from shape trees
  function collectTextFromShape(shape, bullets, paragraphs, tables) {
    if (!shape) return;

    // Handle Table
    if (shape['a:tbl'] || shape['p:graphic']?.['a:graphic']?.['a:graphicData']?.['a:tbl']) {
      const tbl = shape['a:tbl'] || shape['p:graphic']?.['a:graphic']?.['a:graphicData']?.['a:tbl'];
      const rows = Array.isArray(tbl['a:tr']) ? tbl['a:tr'] : [tbl['a:tr']].filter(Boolean);
      const tableRows = [];

      for (const row of rows) {
        const cells = Array.isArray(row['a:tc']) ? row['a:tc'] : [row['a:tc']].filter(Boolean);
        const rowCells = [];
        for (const cell of cells) {
          const txBody = cell['a:txBody'];
          if (txBody) {
            const paras = Array.isArray(txBody['a:p']) ? txBody['a:p'] : [txBody['a:p']].filter(Boolean);
            const cellText = paras.map(p => extractParagraphText(p)).filter(Boolean).join(' ');
            rowCells.push(cellText.trim());
          } else {
            rowCells.push('');
          }
        }
        if (rowCells.some(c => c.length > 0)) {
          tableRows.push(rowCells);
        }
      }

      if (tableRows.length > 0) {
        // Format table as Markdown
        let mdTable = '\n';
        const colCount = Math.max(...tableRows.map(r => r.length));
        const header = tableRows[0];
        mdTable += '| ' + header.concat(Array(Math.max(0, colCount - header.length)).fill('')).join(' | ') + ' |\n';
        mdTable += '| ' + Array(colCount).fill('---').join(' | ') + ' |\n';
        for (let r = 1; r < tableRows.length; r++) {
          const row = tableRows[r];
          mdTable += '| ' + row.concat(Array(Math.max(0, colCount - row.length)).fill('')).join(' | ') + ' |\n';
        }
        tables.push(mdTable.trim());
      }
      return;
    }

    // Handle Group Shape
    if (shape['p:grpSp'] || shape['p:spTree']) {
      const tree = shape['p:grpSp'] || shape['p:spTree'];
      const subShapes = Array.isArray(tree['p:sp']) ? tree['p:sp'] : [tree['p:sp']].filter(Boolean);
      for (const sub of subShapes) {
        collectTextFromShape(sub, bullets, paragraphs, tables);
      }
      return;
    }

    // Handle Standard Text Box / Shape
    const txBody = shape['p:txBody'] || shape['a:txBody'];
    if (!txBody) return;

    const paras = Array.isArray(txBody['a:p']) ? txBody['a:p'] : [txBody['a:p']].filter(Boolean);
    for (const p of paras) {
      const pText = extractParagraphText(p);
      if (!pText) continue;

      const lvl = parseInt(p['a:pPr']?.['@_lvl'] || '0', 10);
      const isBullet = p['a:pPr']?.['a:buChar'] || p['a:pPr']?.['a:buAutoNum'] || lvl > 0;

      if (isBullet || lvl > 0) {
        const indent = '  '.repeat(lvl);
        bullets.push(`${indent}- ${pText}`);
      } else {
        paragraphs.push(pText);
      }
    }
  }

  function extractParagraphText(p) {
    if (!p) return '';
    let text = '';

    // Walk all child elements preserving text order
    const runs = Array.isArray(p['a:r']) ? p['a:r'] : [p['a:r']].filter(Boolean);
    for (const r of runs) {
      if (r['a:t']) {
        const tVal = typeof r['a:t'] === 'object' ? r['a:t']['#text'] : r['a:t'];
        if (tVal) text += tVal;
      }
    }

    // Also check direct text node or field nodes <a:fld>
    if (p['a:fld'] && p['a:fld']['a:t']) {
      const fVal = typeof p['a:fld']['a:t'] === 'object' ? p['a:fld']['a:t']['#text'] : p['a:fld']['a:t'];
      if (fVal) text += fVal;
    }

    return text.trim();
  }

  const slides = [];
  let slideIndex = 1;

  for (const slidePath of slidePaths) {
    const slideEntry = entryMap.get(slidePath);
    if (!slideEntry) continue;

    try {
      const slideXml = xmlParser.parse(slideEntry.getData().toString('utf-8'));
      const spTree = slideXml?.['p:sld']?.['p:cSld']?.['p:spTree'];
      if (!spTree) continue;

      let slideTitle = '';
      const headings = [];
      const bulletPoints = [];
      const paragraphs = [];
      const tables = [];

      const shapes = Array.isArray(spTree['p:sp']) ? spTree['p:sp'] : [spTree['p:sp']].filter(Boolean);

      // Identify title shape first
      for (const shape of shapes) {
        const phType = shape?.['p:nvSpPr']?.['p:nvPr']?.['p:ph']?.['@_type'];
        if (phType === 'title' || phType === 'ctrTitle') {
          const txBody = shape['p:txBody'];
          if (txBody) {
            const paras = Array.isArray(txBody['a:p']) ? txBody['a:p'] : [txBody['a:p']].filter(Boolean);
            slideTitle = paras.map(p => extractParagraphText(p)).filter(Boolean).join(' ');
          }
        }
      }

      // Extract all shapes and text
      for (const shape of shapes) {
        const phType = shape?.['p:nvSpPr']?.['p:nvPr']?.['p:ph']?.['@_type'];
        if (phType === 'title' || phType === 'ctrTitle') continue; // Already extracted
        if (phType === 'subTitle') {
          const txBody = shape['p:txBody'];
          if (txBody) {
            const paras = Array.isArray(txBody['a:p']) ? txBody['a:p'] : [txBody['a:p']].filter(Boolean);
            const subTitle = paras.map(p => extractParagraphText(p)).filter(Boolean).join(' ');
            if (subTitle) headings.push(subTitle);
          }
          continue;
        }

        collectTextFromShape(shape, bulletPoints, paragraphs, tables);
      }

      // Check for group shapes <p:grpSp>
      const grpShapes = Array.isArray(spTree['p:grpSp']) ? spTree['p:grpSp'] : [spTree['p:grpSp']].filter(Boolean);
      for (const grp of grpShapes) {
        collectTextFromShape(grp, bulletPoints, paragraphs, tables);
      }

      // Check for standalone graphics / tables
      const graphicFrames = Array.isArray(spTree['p:graphicFrame']) ? spTree['p:graphicFrame'] : [spTree['p:graphicFrame']].filter(Boolean);
      for (const gf of graphicFrames) {
        collectTextFromShape(gf, bulletPoints, paragraphs, tables);
      }

      // Extract Speaker Notes if available
      let speakerNotes = '';
      const relsPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/').replace('.xml', '.xml.rels');
      const relsEntry = entryMap.get(relsPath);

      if (relsEntry) {
        try {
          const sRelsXml = xmlParser.parse(relsEntry.getData().toString('utf-8'));
          const sRels = Array.isArray(sRelsXml?.Relationships?.Relationship)
            ? sRelsXml.Relationships.Relationship
            : [sRelsXml?.Relationships?.Relationship].filter(Boolean);

          const notesRel = sRels.find(r => (r['@_Type'] || '').includes('notesSlide'));
          if (notesRel && notesRel['@_Target']) {
            let notesTarget = notesRel['@_Target'];
            if (!notesTarget.startsWith('ppt/')) {
              notesTarget = 'ppt/notesSlides/' + notesTarget.replace(/^\.\.\/notesSlides\//, '').replace(/^\//, '');
            }
            const notesEntry = entryMap.get(notesTarget.toLowerCase());
            if (notesEntry) {
              const notesXml = xmlParser.parse(notesEntry.getData().toString('utf-8'));
              const noteShapes = notesXml?.['p:notes']?.['p:cSld']?.['p:spTree']?.['p:sp'];
              const noteShapeList = Array.isArray(noteShapes) ? noteShapes : [noteShapes].filter(Boolean);

              const noteTexts = [];
              for (const nSp of noteShapeList) {
                const phType = nSp?.['p:nvSpPr']?.['p:nvPr']?.['p:ph']?.['@_type'];
                // Ignore slide image shape and slide number shape in notes view
                if (phType === 'sldImg' || phType === 'sldNum') continue;

                const txBody = nSp['p:txBody'];
                if (txBody) {
                  const paras = Array.isArray(txBody['a:p']) ? txBody['a:p'] : [txBody['a:p']].filter(Boolean);
                  for (const p of paras) {
                    const nt = extractParagraphText(p);
                    if (nt && nt.length > 2 && !nt.startsWith('Slide ') && !/^\d+$/.test(nt)) {
                      noteTexts.push(nt);
                    }
                  }
                }
              }
              speakerNotes = noteTexts.join('\n');
            }
          }
        } catch (nErr) {
          // Ignore notes parsing failure
        }
      }

      // Extract images actually drawn on THIS slide (pics, grouped pics, fills, background).
      // Do not attach every media relationship — that copies the same images onto every chunk.
      const slideImages = [];
      if (relsEntry) {
        try {
          const sRelsXml = xmlParser.parse(relsEntry.getData().toString('utf-8'));
          const sRels = Array.isArray(sRelsXml?.Relationships?.Relationship)
            ? sRelsXml.Relationships.Relationship
            : [sRelsXml?.Relationships?.Relationship].filter(Boolean);

          const rIdToMedia = new Map();
          for (const rel of sRels) {
            const type = rel['@_Type'] || '';
            const target = rel['@_Target'] || '';
            if (rel['@_Id'] && target && (type.includes('image') || target.includes('media/'))) {
              let cleanTarget = target.replace(/\\/g, '/');
              if (!cleanTarget.toLowerCase().startsWith('ppt/')) {
                cleanTarget = 'ppt/' + cleanTarget.replace(/^\.\.\//, '').replace(/^\//, '');
              }
              rIdToMedia.set(rel['@_Id'], cleanTarget.toLowerCase());
            }
          }

          const collectBlipRIds = (node, out = []) => {
            if (!node || typeof node !== 'object') return out;
            if (Array.isArray(node)) {
              for (const item of node) collectBlipRIds(item, out);
              return out;
            }
            const blip = node['a:blip'];
            if (blip) {
              const rId = blip['@_r:embed'] || blip['@_r:link'];
              if (rId && !out.includes(rId)) out.push(rId);
            }
            for (const key of Object.keys(node)) {
              if (key === 'a:blip') continue;
              collectBlipRIds(node[key], out);
            }
            return out;
          };

          if (rIdToMedia.size > 0) {
            const addImageFromRel = (rId, name = '', descr = '') => {
              if (!rId || !rIdToMedia.has(rId)) return;
              const mediaPath = rIdToMedia.get(rId);
              const mediaEntry = entryMap.get(mediaPath);
              if (!mediaEntry) return;

              const imgBuffer = mediaEntry.getData();
              if (!imgBuffer || imgBuffer.length < 120) return;

              const ext = mediaPath.split('.').pop().toLowerCase();
              if (ext === 'wmf' || ext === 'emf') return;

              const mimeMap = {
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                webp: 'image/webp',
                bmp: 'image/bmp'
              };
              const mimetype = mimeMap[ext] || 'image/png';
              const dataUrl = `data:${mimetype};base64,${imgBuffer.toString('base64')}`;
              const imgId = `img_s${slideIndex}_${slideImages.length + 1}`;

              if (!slideImages.some(img => img.mediaPath === mediaPath)) {
                slideImages.push({
                  id: imgId,
                  fileName: mediaPath.split('/').pop(),
                  mediaPath,
                  mimetype,
                  buffer: imgBuffer,
                  dataUrl,
                  name: name || `Slide ${slideIndex} Visual`,
                  descr: descr || '',
                  slideNumber: slideIndex,
                  slideTitle: slideTitle || `Slide ${slideIndex}`,
                  sizeBytes: imgBuffer.length
                });
              }
            };

            const usedRIds = collectBlipRIds(spTree);
            const bgTree = slideXml?.['p:sld']?.['p:cSld']?.['p:bg'];
            collectBlipRIds(bgTree, usedRIds);

            if (usedRIds.length > 0) {
              for (const rId of usedRIds) {
                addImageFromRel(rId, `Slide ${slideIndex} Visual`, '');
              }
            } else {
              // Last resort: only the largest unique photo on this slide, never every shared logo.
              const ranked = [...rIdToMedia.entries()]
                .map(([rId, path]) => {
                  const entry = entryMap.get(path);
                  const size = entry ? entry.getData().length : 0;
                  return { rId, path, size };
                })
                .filter(item => item.size >= 25000)
                .sort((a, b) => b.size - a.size);
              if (ranked[0]) {
                addImageFromRel(ranked[0].rId, `Slide ${slideIndex} Visual`, '');
              }
            }
          }
        } catch (imgErr) {
          console.warn(`[Doc Extractor] Notice extracting slide ${slideIndex} visuals:`, imgErr.message);
        }
      }

      // If title was not identified via placeholder, use first short heading or paragraph
      if (!slideTitle && headings.length > 0) {
        slideTitle = headings.shift();
      } else if (!slideTitle && paragraphs.length > 0 && paragraphs[0].length < 80) {
        slideTitle = paragraphs.shift();
      }

      if (!slideTitle) {
        slideTitle = `Slide ${slideIndex}`;
      }

      // Assemble full structured text representation for this slide
      let slideText = `--- Slide ${slideIndex}: ${slideTitle} ---\n`;
      if (headings.length > 0) {
        slideText += `Headings: ${headings.join(' | ')}\n`;
      }
      if (paragraphs.length > 0) {
        slideText += paragraphs.join('\n\n') + '\n';
      }
      if (bulletPoints.length > 0) {
        slideText += bulletPoints.join('\n') + '\n';
      }
      if (tables.length > 0) {
        slideText += '\n' + tables.join('\n\n') + '\n';
      }
      if (slideImages.length > 0) {
        slideText += `\n[Visual Content on Slide ${slideIndex}]: ` +
          slideImages.map(img => `${img.name}${img.descr ? ` (${img.descr})` : ''}`).join(', ') + '\n';
      }
      if (speakerNotes) {
        slideText += `\n[Speaker Notes for Slide ${slideIndex}]:\n${speakerNotes}\n`;
      }

      slides.push({
        slideNumber: slideIndex,
        title: slideTitle.trim(),
        headings,
        bulletPoints,
        paragraphs,
        tables,
        images: slideImages,
        speakerNotes: speakerNotes.trim(),
        fullText: slideText.trim()
      });

      slideIndex++;
    } catch (sErr) {
      console.warn(`[Doc Extractor] Warning parsing slide ${slidePath}:`, sErr.message);
    }
  }

  const fullText = slides.map(s => s.fullText).join('\n\n');
  const allImages = slides.flatMap(s => s.images || []);
  return { slides, fullText, images: allImages };
}

/**
 * Binary PPT extractor fallback (reads ASCII/UTF-16 text streams from legacy .ppt files)
 */
function extractPptBinary(buffer) {
  const rawStr = buffer.toString('binary');
  const slides = [];
  const textMatches = [];

  // Scan for UTF-16LE text blocks and ASCII text runs
  const utf16Regex = /(?:[\x20-\x7E]\x00){4,}/g;
  let match;
  while ((match = utf16Regex.exec(rawStr)) !== null) {
    const decoded = Buffer.from(match[0], 'binary').toString('utf16le').trim();
    if (decoded.length >= 4 && !/^\s+$/.test(decoded)) {
      textMatches.push(decoded);
    }
  }

  // Also collect ASCII strings
  const asciiRegex = /[\x20-\x7E\t\r\n]{8,}/g;
  while ((match = asciiRegex.exec(rawStr)) !== null) {
    const clean = match[0].replace(/\0/g, '').trim();
    if (clean.length >= 8 && !textMatches.includes(clean)) {
      // Filter out binary metadata noise
      if (!clean.includes('Microsoft') && !clean.includes('Font') && !clean.includes('Theme')) {
        textMatches.push(clean);
      }
    }
  }

  // Segment into approximate slides
  let currentSlideNum = 1;
  let currentTexts = [];

  for (const t of textMatches) {
    currentTexts.push(t);
    if (currentTexts.join(' ').length > 600) {
      const slideTitle = currentTexts[0] || `Slide ${currentSlideNum}`;
      slides.push({
        slideNumber: currentSlideNum,
        title: slideTitle.slice(0, 80),
        headings: [],
        bulletPoints: currentTexts.slice(1).map(b => `- ${b}`),
        paragraphs: currentTexts,
        tables: [],
        speakerNotes: '',
        fullText: `--- Slide ${currentSlideNum}: ${slideTitle} ---\n` + currentTexts.join('\n')
      });
      currentSlideNum++;
      currentTexts = [];
    }
  }

  if (currentTexts.length > 0) {
    const slideTitle = currentTexts[0] || `Slide ${currentSlideNum}`;
    slides.push({
      slideNumber: currentSlideNum,
      title: slideTitle.slice(0, 80),
      headings: [],
      bulletPoints: currentTexts.slice(1).map(b => `- ${b}`),
      paragraphs: currentTexts,
      tables: [],
      speakerNotes: '',
      fullText: `--- Slide ${currentSlideNum}: ${slideTitle} ---\n` + currentTexts.join('\n')
    });
  }

  const embeddedImages = extractEmbeddedRasterImages(buffer);
  if (embeddedImages.length > 0 && slides.length === 0) {
    for (let i = 0; i < embeddedImages.length; i++) {
      const img = embeddedImages[i];
      img.slideNumber = i + 1;
      img.slideTitle = `Slide ${i + 1}`;
      slides.push({
        slideNumber: i + 1,
        title: `Slide ${i + 1}`,
        headings: [],
        bulletPoints: [],
        paragraphs: [],
        tables: [],
        images: [img],
        speakerNotes: '',
        fullText: `--- Slide ${i + 1}: Visual training slide ---\n[Visual Content on Slide ${i + 1}]: ${img.name}`
      });
    }
  } else if (embeddedImages.length > 0) {
    for (let i = 0; i < Math.min(embeddedImages.length, slides.length); i++) {
      const target = slides[i];
      target.images = target.images || [];
      embeddedImages[i].slideNumber = target.slideNumber;
      target.images.push(embeddedImages[i]);
    }
  }

  const fullText = slides.map(s => s.fullText).join('\n\n');
  return { slides, fullText, images: slides.flatMap(s => s.images || []) };
}

/**
 * Renders a single PDF page to plain text with line breaks preserved.
 */
async function renderPdfPageText(pageData) {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  });
  let lastY;
  let text = '';
  for (const item of textContent.items || []) {
    if (lastY == item.transform[5] || !lastY) {
      text += item.str;
    } else {
      text += '\n' + item.str;
    }
    lastY = item.transform[5];
  }
  return text;
}

function splitTextIntoPages(text, startPage = 1) {
  const pages = [];
  const paragraphs = String(text || '').split(/\n\s*\n/);
  let currentPageText = '';
  let pageNumber = startPage;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (currentPageText.length + trimmed.length > 1400 && currentPageText.length > 0) {
      pages.push({
        page_number: pageNumber,
        text: currentPageText.trim(),
        title: currentPageText.split('\n')[0]?.slice(0, 80) || `Section ${pageNumber}`
      });
      pageNumber += 1;
      currentPageText = trimmed + '\n\n';
    } else {
      currentPageText += trimmed + '\n\n';
    }
  }
  if (currentPageText.trim().length > 0) {
    pages.push({
      page_number: pageNumber,
      text: currentPageText.trim(),
      title: currentPageText.split('\n')[0]?.slice(0, 80) || `Section ${pageNumber}`
    });
  }
  return pages;
}

/**
 * Universal document extraction entry point.
 * Extracts structured text, pages, slides, and metadata from all supported formats.
 *
 * @param {object} file - Multer uploaded file object { originalname, mimetype, buffer }
 * @returns {Promise<{ fileType: string, fileName: string, text: string, pages: Array, slides: Array }>}
 */
export async function extractDocument(file) {
  const { originalname = 'document', mimetype = '', buffer } = file;
  const ext = originalname.split('.').pop()?.toLowerCase() || '';

  let fileType = ext;
  let text = '';
  let pages = [];
  let slides = [];
  let images = [];

  console.log(`[Doc Extractor] Extracting document "${originalname}" (Type: ${ext || mimetype}, Size: ${(buffer.length / 1024).toFixed(1)} KB)...`);

  // 1. PPTX Extraction
  if (ext === 'pptx' || mimetype.includes('presentationml')) {
    fileType = 'pptx';
    try {
      const pptxRes = extractPptx(buffer);
      slides = pptxRes.slides;
      text = pptxRes.fullText;
      images = pptxRes.images || [];
      console.log(`[Doc Extractor] PPTX extracted: ${slides.length} slides, ${images.length} visuals/images, ${text.length} characters.`);
    } catch (pptxErr) {
      console.warn('[Doc Extractor] PPTX zip extraction failed, attempting fallback:', pptxErr.message);
      const binRes = extractPptBinary(buffer);
      slides = binRes.slides;
      text = binRes.fullText;
      images = binRes.images || [];
    }
  }
  // 2. Legacy PPT Extraction
  else if (ext === 'ppt' || mimetype.includes('ms-powerpoint')) {
    fileType = 'ppt';
    const pptRes = extractPptBinary(buffer);
    slides = pptRes.slides;
    text = pptRes.fullText;
    images = pptRes.images || [];
    console.log(`[Doc Extractor] PPT extracted: ${slides.length} slides, ${images.length} visuals/images, ${text.length} characters.`);
  }
  // 3. PDF Extraction — collect real per-page text. Try newer pdf.js first;
  // v1.10.100 rejects many modern Word/Chrome PDFs with "bad XRef entry".
  else if (ext === 'pdf' || mimetype === 'application/pdf') {
    fileType = 'pdf';
    const pdfVersions = ['v2.0.550', 'v1.10.100', 'v1.10.88', 'v1.9.426'];
    let lastPdfErr = null;
    let parsed = false;
    for (const version of pdfVersions) {
      try {
        const collectedPages = [];
        const pdfData = await pdfParse(new Uint8Array(buffer), {
          version,
          pagerender: async (pageData) => {
            const pageText = await renderPdfPageText(pageData);
            const cleanText = (pageText || '').trim();
            if (cleanText.length > 0) {
              collectedPages.push({
                page_number: collectedPages.length + 1,
                text: cleanText,
                title: cleanText.split('\n').find(l => l.trim())?.slice(0, 80) || `Page ${collectedPages.length + 1}`
              });
            }
            return pageText || '';
          }
        });
        pages = collectedPages;
        text = (pdfData.text || pages.map(p => p.text).join('\n\n')).replace(/\r\n/g, '\n');
        if (pages.length === 0 && text.trim().length > 10) {
          const formFeedPages = text.split(/\f|\u000c/).map(p => p.trim()).filter(p => p.length > 10);
          pages = formFeedPages.length > 1
            ? formFeedPages.map((cleanText, idx) => ({
                page_number: idx + 1,
                text: cleanText,
                title: cleanText.split('\n')[0]?.slice(0, 80) || `Page ${idx + 1}`
              }))
            : splitTextIntoPages(text);
        }
        parsed = true;
        console.log(`[Doc Extractor] PDF extracted with ${version}: ${pages.length} pages, ${text.length} characters.`);
        break;
      } catch (pdfErr) {
        lastPdfErr = pdfErr;
        console.warn(`[Doc Extractor] PDF parse with ${version} failed:`, pdfErr.message);
      }
    }
    if (!parsed) {
      throw new Error('Failed to extract text from PDF. The file may be scanned, encrypted, or corrupted.');
    }
  }
  // 4. DOCX / DOC Extraction
  else if (
    ext === 'docx' ||
    ext === 'doc' ||
    mimetype.includes('wordprocessingml') ||
    mimetype.includes('msword')
  ) {
    fileType = 'docx';
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } catch (docxErr) {
      console.warn(`[Doc Extractor] Mammoth parsing failed for ${originalname}, trying text fallback:`, docxErr.message);
      text = buffer.toString('utf-8').replace(/[^\x20-\x7E\t\r\n]/g, ' ');
    }
    console.log(`[Doc Extractor] Word document extracted: ${text.length} characters.`);
  }
  // 5. Plain Text, Markdown, CSV, JSON, HTML, RTF
  else if (
    ['txt', 'text', 'md', 'markdown', 'csv', 'json', 'log', 'xml'].includes(ext) ||
    mimetype.startsWith('text/') ||
    mimetype.includes('json') ||
    mimetype.includes('csv')
  ) {
    fileType = ext || 'txt';
    text = buffer.toString('utf-8');
  } else if (ext === 'html' || ext === 'htm' || mimetype === 'text/html') {
    fileType = 'html';
    const rawHtml = buffer.toString('utf-8');
    text = rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else if (ext === 'rtf' || mimetype.includes('rtf')) {
    fileType = 'rtf';
    const rawRtf = buffer.toString('utf-8');
    text = rawRtf
      .replace(/\{\*?\\[^{}]+}|[{}]|\\\n?[A-Za-z]+\n?(?:-?\d+)?[ ]?/g, ' ')
      .trim();
  } else {
    // Universal fallback
    try {
      const result = await mammoth.extractRawText({ buffer });
      if (result.value && result.value.trim().length > 30) {
        text = result.value;
      }
    } catch {
      // Ignore
    }
    if (!text || text.trim().length === 0) {
      text = buffer.toString('utf-8').replace(/[^\x20-\x7E\t\r\n]/g, ' ');
    }
  }

  text = text.trim();

  // If pages/slides are not already structured, build structured page segments (~1200-1500 chars)
  if (pages.length === 0 && slides.length === 0 && text.length > 0) {
    pages = splitTextIntoPages(text);
  }

  const doc = {
    fileType,
    fileName: originalname,
    text,
    pages,
    slides,
    images
  };

  // Image-only PPT/PDF slides: read visible text from pictures so ARIA can teach from them
  const hasVisuals = (slides || []).some(s => (s.images || []).length > 0) || (images || []).length > 0;
  if (hasVisuals) {
    await enrichDocumentVisuals(doc);
  }

  return doc;
}

export default {
  extractDocument,
  extractPptx,
  extractPptBinary
};
