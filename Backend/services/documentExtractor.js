import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import axios from 'axios';
import FormData from 'form-data';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import aiService from './aiService.js';
import { enrichDocumentVisuals, extractEmbeddedRasterImages, analyzeImageWithQwen, ocrFallback } from './visualTextService.js';
import { isGarbageTitle, isBinaryNoiseText, firstUsefulTitleLine } from '../utils/contentQuality.js';

const execPromise = util.promisify(exec);

/**
 * Renders every page in a Word document (DOCX/DOC) into high-resolution PNG images.
 * Uses Word COM automation on Windows to export to PDF, then renders PDF pages using pypdfium2.
 */
async function renderDocxPagesToImages(fileBuffer, originalname) {
  const ext = originalname.split('.').pop()?.toLowerCase() || 'docx';
  const tmpDir = path.join(os.tmpdir(), `docx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const tmpFile = path.join(tmpDir, `document.${ext}`);
  const pdfOut = path.join(tmpDir, 'document.pdf');

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpFile, fileBuffer);

    const psScript = `
$fullDoc = "${tmpFile.replace(/\\\\/g, '\\\\\\\\')}"
$fullPdf = "${pdfOut.replace(/\\\\/g, '\\\\\\\\')}"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  $doc = $word.Documents.Open($fullDoc, $false, $true)
  $doc.SaveAs([ref]$fullPdf, [ref]17)
  $doc.Close([ref]0)
} finally {
  $word.Quit([ref]0)
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
`;
    const psFile = path.join(tmpDir, 'export_word.ps1');
    fs.writeFileSync(psFile, psScript);

    await execPromise(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 60000 });

    if (fs.existsSync(pdfOut)) {
      const pdfBuffer = fs.readFileSync(pdfOut);
      const pageImages = await renderPdfPagesToImages(pdfBuffer);
      return { pageImages, pdfBuffer };
    }
    return { pageImages: [], pdfBuffer: null };
  } catch (err) {
    console.warn('[Doc Extractor] Word COM document rendering notice:', err.message);
    return { pageImages: [], pdfBuffer: null };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) { }
  }
}

/**
 * Renders every slide in a PowerPoint presentation (PPTX/PPT) into high-resolution PNG images.
 * Uses PowerPoint COM automation on Windows.
 */
async function renderPptSlidesToImages(fileBuffer, originalname) {
  const ext = originalname.split('.').pop()?.toLowerCase() || 'pptx';
  const tmpDir = path.join(os.tmpdir(), `ppt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const tmpFile = path.join(tmpDir, `presentation.${ext}`);
  const outDir = path.join(tmpDir, 'slides');

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(tmpFile, fileBuffer);

    const psScript = `
$fullPpt = "${tmpFile.replace(/\\/g, '\\\\')}"
$fullOut = "${outDir.replace(/\\/g, '\\\\')}"
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open($fullPpt, 1, 0, 0)
  $pres.SaveAs($fullOut, 18)
  $pres.Close()
} finally {
  $ppt.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
`;
    const psFile = path.join(tmpDir, 'export.ps1');
    fs.writeFileSync(psFile, psScript);

    await execPromise(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 60000 });

    if (!fs.existsSync(outDir)) return [];
    const files = fs.readdirSync(outDir);
    const slideImages = [];

    const sortedFiles = files
      .filter(f => /^Slide\d+\.png$/i.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
        return numA - numB;
      });

    for (let i = 0; i < sortedFiles.length; i++) {
      const fileName = sortedFiles[i];
      const slideNum = parseInt(fileName.match(/\d+/)?.[0] || `${i + 1}`, 10);
      const imgBuffer = fs.readFileSync(path.join(outDir, fileName));
      const dataUrl = `data:image/png;base64,${imgBuffer.toString('base64')}`;

      slideImages.push({
        id: `full_slide_${slideNum}`,
        dataUrl,
        fileName,
        mimetype: 'image/png',
        sourceSlide: slideNum,
        name: `Slide ${slideNum}`,
        descr: `Full slide presentation graphic for slide ${slideNum}`,
        purpose: `Exact PowerPoint Presentation Slide ${slideNum}`,
        sizeBytes: imgBuffer.length
      });
    }

    return slideImages;
  } catch (err) {
    console.warn('[Doc Extractor] PowerPoint COM slide rendering notice:', err.message);
    return [];
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) { }
  }
}

/**
 * Renders every page in a PDF document into high-resolution PNG images using pypdfium2.
 */
async function renderPdfPagesToImages(fileBuffer) {
  const tmpDir = path.join(os.tmpdir(), `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const tmpFile = path.join(tmpDir, 'document.pdf');
  const outDir = path.join(tmpDir, 'pages');

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(tmpFile, fileBuffer);

    const pyScript = `
import pypdfium2 as pdfium, sys, os
pdf = pdfium.PdfDocument(r"${tmpFile}")
out_dir = r"${outDir}"
for i, page in enumerate(pdf):
    image = page.render(scale=2).to_pil()
    image.save(os.path.join(out_dir, f"Page{i+1}.png"))
`;
    const pyFile = path.join(tmpDir, 'render.py');
    fs.writeFileSync(pyFile, pyScript);

    const pythonExe = fs.existsSync('c:\\prem\\Netopsys\\Skill-Bridge\\ai-service\\.venv\\Scripts\\python.exe')
      ? 'c:\\prem\\Netopsys\\Skill-Bridge\\ai-service\\.venv\\Scripts\\python.exe'
      : 'python';

    await execPromise(`"${pythonExe}" "${pyFile}"`, { timeout: 60000 });

    if (!fs.existsSync(outDir)) return [];
    const files = fs.readdirSync(outDir);
    const pageImages = [];
    const sortedFiles = files
      .filter(f => /^Page\d+\.png$/i.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
        return numA - numB;
      });

    for (let i = 0; i < sortedFiles.length; i++) {
      const fileName = sortedFiles[i];
      const pageNum = parseInt(fileName.match(/\d+/)?.[0] || `${i + 1}`, 10);
      const imgBuffer = fs.readFileSync(path.join(outDir, fileName));
      const dataUrl = `data:image/png;base64,${imgBuffer.toString('base64')}`;

      pageImages.push({
        id: `full_page_${pageNum}`,
        dataUrl,
        fileName,
        mimetype: 'image/png',
        sourcePage: pageNum,
        name: `Page ${pageNum}`,
        descr: `Full document page visual for page ${pageNum}`,
        purpose: `Exact Document Page ${pageNum}`,
        sizeBytes: imgBuffer.length
      });
    }

    return pageImages;
  } catch (err) {
    console.warn('[Doc Extractor] PDF page rendering notice:', err.message);
    return [];
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) { }
  }
}

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
              if (['wmf', 'emf', 'mp3', 'wav', 'm4a', 'wma', 'mp4', 'bin'].includes(ext)) return;

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
      if (slideImages.length > 1) {
        slideImages.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
        const largest = slideImages[0];
        if ((largest.sizeBytes || 0) >= 60000) {
          const photos = slideImages.filter(img => (img.sizeBytes || 0) >= 50000);
          slideImages.length = 0;
          slideImages.push(...photos);
        }
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
 * When PowerPoint COM exports real slide PNGs, those files are the true slide count.
 * Binary OLE scraping often invents hundreds of fake "slides" from font/metadata noise.
 */
function alignSlidesToRendered(slides, renderedSlides) {
  if (!Array.isArray(renderedSlides) || renderedSlides.length === 0) {
    return { slides: slides || [], rebuilt: false };
  }

  const existing = Array.isArray(slides) ? slides : [];
  const garbageCount = existing.filter(s => isGarbageTitle(s?.title)).length;
  const garbageRatio = garbageCount / Math.max(1, existing.length);
  const countMismatch = existing.length > renderedSlides.length * 1.3
    || existing.length === 0
    || renderedSlides.length > existing.length * 1.5;

  const shouldRebuild = countMismatch || garbageRatio > 0.35;
  if (!shouldRebuild) {
    for (const rImg of renderedSlides) {
      const targetSlide = existing.find(s => s.slideNumber === rImg.sourceSlide) || existing[rImg.sourceSlide - 1];
      if (targetSlide) {
        targetSlide.images = [rImg, ...(targetSlide.images || []).filter(img => img.id !== rImg.id)];
        targetSlide.fullSlideImage = rImg;
      }
    }
    return { slides: existing, rebuilt: false };
  }

  const byNum = new Map(existing.map(s => [s.slideNumber, s]));
  const rebuilt = renderedSlides.map((rImg) => {
    const prev = byNum.get(rImg.sourceSlide);
    const keepTitle = prev && !isGarbageTitle(prev.title);
    return {
      slideNumber: rImg.sourceSlide,
      title: keepTitle ? prev.title : `Slide ${rImg.sourceSlide}`,
      headings: (prev?.headings || []).filter(h => !isGarbageTitle(h)),
      bulletPoints: prev?.bulletPoints || [],
      paragraphs: prev?.paragraphs || [],
      tables: prev?.tables || [],
      images: [rImg],
      fullSlideImage: rImg,
      speakerNotes: prev?.speakerNotes || '',
      fullText: keepTitle && prev.fullText
        ? prev.fullText
        : `--- Slide ${rImg.sourceSlide}: Visual training slide ---\n[Visual Content on Slide ${rImg.sourceSlide}]: Full slide presentation`
    };
  });

  console.log(`[Doc Extractor] Rebuilt ${rebuilt.length} real slides from PowerPoint render (was ${existing.length} extracted fragments).`);
  return { slides: rebuilt, rebuilt: true };
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
    if (decoded.length >= 8 && !isBinaryNoiseText(decoded)) {
      textMatches.push(decoded);
    }
  }

  // Also collect ASCII strings
  const asciiRegex = /[\x20-\x7E\t\r\n]{8,}/g;
  while ((match = asciiRegex.exec(rawStr)) !== null) {
    const clean = match[0].replace(/\0/g, '').trim();
    if (clean.length >= 12 && !textMatches.includes(clean) && !isBinaryNoiseText(clean)) {
      textMatches.push(clean);
    }
  }

  // Segment into approximate slides. Cap hard so OLE noise cannot become 200+ lessons.
  const MAX_HINT_SLIDES = 80;
  let currentSlideNum = 1;
  let currentTexts = [];

  for (const t of textMatches) {
    if (currentSlideNum > MAX_HINT_SLIDES) break;
    currentTexts.push(t);
    if (currentTexts.join(' ').length > 800) {
      const rawTitle = currentTexts.find(line => !isGarbageTitle(line)) || `Slide ${currentSlideNum}`;
      const slideTitle = isGarbageTitle(rawTitle) ? `Slide ${currentSlideNum}` : rawTitle.slice(0, 80);
      slides.push({
        slideNumber: currentSlideNum,
        title: slideTitle,
        headings: [],
        bulletPoints: currentTexts.slice(1, 8).map(b => `- ${b}`),
        paragraphs: currentTexts.slice(0, 8),
        tables: [],
        speakerNotes: '',
        fullText: `--- Slide ${currentSlideNum}: ${slideTitle} ---\n` + currentTexts.slice(0, 8).join('\n')
      });
      currentSlideNum++;
      currentTexts = [];
    }
  }

  if (currentTexts.length > 0 && currentSlideNum <= MAX_HINT_SLIDES) {
    const rawTitle = currentTexts.find(line => !isGarbageTitle(line)) || `Slide ${currentSlideNum}`;
    const slideTitle = isGarbageTitle(rawTitle) ? `Slide ${currentSlideNum}` : rawTitle.slice(0, 80);
    slides.push({
      slideNumber: currentSlideNum,
      title: slideTitle,
      headings: [],
      bulletPoints: currentTexts.slice(1, 8).map(b => `- ${b}`),
      paragraphs: currentTexts.slice(0, 8),
      tables: [],
      speakerNotes: '',
      fullText: `--- Slide ${currentSlideNum}: ${slideTitle} ---\n` + currentTexts.slice(0, 8).join('\n')
    });
  }

  const embeddedImages = extractEmbeddedRasterImages(buffer);
  if (embeddedImages.length > 0 && slides.length === 0) {
    const imageCap = Math.min(embeddedImages.length, 80);
    for (let i = 0; i < imageCap; i++) {
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
 * Transcribes an uploaded audio or video file using Whisper and structures it into
 * coherent, high-value learning chunks using LLM intelligence.
 */
async function extractAudioFile(buffer, originalname, mimetype) {
  const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
  let transcription = '';
  let detectedLanguage = 'en';

  // 1. Try local Python faster-whisper microservice
  try {
    const form = new FormData();
    form.append('file', buffer, {
      filename: originalname || 'audio.mp3',
      contentType: mimetype || 'audio/mpeg'
    });

    const pyRes = await axios.post(`${PYTHON_SERVICE_URL}/api/v1/transcribe`, form, {
      headers: form.getHeaders(),
      timeout: 120000
    });

    if (pyRes.data?.text && typeof pyRes.data.text === 'string' && pyRes.data.text.trim().length > 0) {
      transcription = pyRes.data.text.trim();
      detectedLanguage = pyRes.data.detected_language || 'en';
      console.log(`[Doc Extractor:Audio] Python faster-whisper transcribed ${transcription.length} chars (detected: ${detectedLanguage})`);
    }
  } catch (pyErr) {
    console.warn(`[Doc Extractor:Audio] Python whisper offline or failed: ${pyErr.message}`);
  }

  // 2. Try OpenAI Whisper fallback if API key is configured
  if (!transcription) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
    if (apiKey) {
      try {
        const form = new FormData();
        form.append('file', buffer, {
          filename: originalname || 'audio.mp3',
          contentType: mimetype || 'audio/mpeg'
        });
        form.append('model', 'whisper-1');

        const oaRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...form.getHeaders()
          },
          timeout: 120000
        });

        if (oaRes.data?.text) {
          transcription = oaRes.data.text.trim();
          console.log(`[Doc Extractor:Audio] OpenAI Whisper transcribed ${transcription.length} chars.`);
        }
      } catch (oaErr) {
        console.warn('[Doc Extractor:Audio] OpenAI Whisper failed:', oaErr.message);
      }
    }
  }

  if (!transcription || transcription.length < 15) {
    throw new Error('Unable to transcribe audio file. Please ensure the audio contains clear speech and that the AI Whisper service is running.');
  }

  // 3. Take LLM help to extract meaning, analyze topics, and synthesize structured knowledge chunks
  let chunks = [];
  try {
    const cleanName = originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const systemPrompt = `You are a Master Instructional Designer and Audio Content Architect.
Analyze the transcribed audio recording from "${cleanName}".
Extract all key procedures, safety protocols, operational facts, and training instructions.
Divide the material into sequential, comprehensive learning chunks.
For each chunk, provide:
- page_number: sequential integer (1, 2, 3...)
- title: concise, specific topic title representing this audio segment
- text: comprehensive, detailed transcript and clear teaching explanation for this section
- bulletPoints: array of 3-5 crucial procedural takeaways or verified rules
- duration: estimated duration string (e.g. "06:30")

Return ONLY valid JSON matching:
{
  "chunks": [
    {
      "page_number": 1,
      "title": "Clear Topic Title",
      "text": "Detailed transcript and thorough conceptual explanation...",
      "bulletPoints": ["Point 1", "Point 2", "Point 3"],
      "duration": "06:30"
    }
  ]
}`;
    const userPrompt = `Audio Recording: "${cleanName}"\n\nFull Transcription:\n${transcription.slice(0, 32000)}`;
    const llmRes = await aiService._callLLM(systemPrompt, userPrompt, true);
    const parsed = aiService._parseJsonObject(llmRes);
    if (parsed && Array.isArray(parsed.chunks) && parsed.chunks.length > 0) {
      chunks = parsed.chunks.map((c, i) => ({
        page_number: i + 1,
        title: c.title || `Audio Segment ${i + 1}`,
        text: c.text || '',
        bulletPoints: Array.isArray(c.bulletPoints) ? c.bulletPoints : [],
        duration: c.duration || '07:00'
      }));
      console.log(`[Doc Extractor:Audio] LLM structured audio into ${chunks.length} distinct knowledge chunks.`);
    }
  } catch (llmErr) {
    console.warn(`[Doc Extractor:Audio] LLM audio chunking fallback: ${llmErr.message}`);
  }

  // Fallback: segment raw transcript into structured chunks if LLM was unavailable
  if (chunks.length === 0) {
    const rawPages = splitTextIntoPages(transcription);
    chunks = rawPages.map((p, i) => {
      const sentences = p.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
      return {
        page_number: i + 1,
        title: p.title || `Audio Segment ${i + 1}`,
        text: p.text,
        bulletPoints: sentences.slice(0, 4),
        duration: '06:00'
      };
    });
  }

  return { text: transcription, chunks, detectedLanguage };
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

    // Render exact high-resolution slide presentation images (PowerPoint COM)
    try {
      const renderedSlides = await renderPptSlidesToImages(buffer, originalname);
      if (renderedSlides.length > 0) {
        console.log(`[Doc Extractor] Rendered ${renderedSlides.length} exact PowerPoint presentation slide images.`);
        const aligned = alignSlidesToRendered(slides, renderedSlides);
        slides = aligned.slides;
        text = slides.map(s => s.fullText).join('\n\n');
        images = [...renderedSlides, ...(images || []).filter(img => !String(img.id || '').startsWith('full_slide_'))];
      }
    } catch (rErr) {
      console.warn('[Doc Extractor] Notice rendering slide images:', rErr.message);
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

    // Render exact high-resolution slide presentation images (PowerPoint COM)
    try {
      const renderedSlides = await renderPptSlidesToImages(buffer, originalname);
      if (renderedSlides.length > 0) {
        console.log(`[Doc Extractor] Rendered ${renderedSlides.length} exact PowerPoint presentation slide images.`);
        const aligned = alignSlidesToRendered(slides, renderedSlides);
        slides = aligned.slides;
        text = slides.map(s => s.fullText).join('\n\n');
        images = [...renderedSlides, ...(images || []).filter(img => !String(img.id || '').startsWith('full_slide_'))];
      }
    } catch (rErr) {
      console.warn('[Doc Extractor] Notice rendering slide images:', rErr.message);
    }
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

    // Render exact high-resolution PDF document page images
    try {
      const renderedPages = await renderPdfPagesToImages(buffer);
      if (renderedPages.length > 0) {
        console.log(`[Doc Extractor] Rendered ${renderedPages.length} exact PDF document page images.`);
        for (const rImg of renderedPages) {
          const targetPage = pages.find(p => p.page_number === rImg.sourcePage) || pages[rImg.sourcePage - 1];
          if (targetPage) {
            targetPage.images = [rImg, ...(targetPage.images || []).filter(img => img.id !== rImg.id)];
            targetPage.pageImage = rImg;
          }
        }
        images = [...renderedPages, ...images];
      }
    } catch (rErr) {
      console.warn('[Doc Extractor] Notice rendering PDF page images:', rErr.message);
    }
  }
  // 4. DOCX / DOC Extraction
  else if (
    ext === 'docx' ||
    ext === 'doc' ||
    mimetype.includes('wordprocessingml') ||
    mimetype.includes('msword')
  ) {
    fileType = ext === 'doc' ? 'doc' : 'docx';

    // 4a. Attempt Word COM rendering to convert Word doc to exact high-res page images
    let renderedDoc = null;
    try {
      renderedDoc = await renderDocxPagesToImages(buffer, originalname);
      if (renderedDoc.pageImages && renderedDoc.pageImages.length > 0) {
        images = renderedDoc.pageImages;
        console.log(`[Doc Extractor] Rendered ${images.length} exact Word document page images via Word COM.`);
      }
    } catch (wErr) {
      console.warn('[Doc Extractor] Word COM rendering notice:', wErr.message);
    }

    // 4b. If Word COM produced a PDF buffer, parse per-page text from the PDF for exact page alignment
    if (renderedDoc?.pdfBuffer) {
      try {
        const collectedPages = [];
        const pdfData = await pdfParse(new Uint8Array(renderedDoc.pdfBuffer), {
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
        if (collectedPages.length > 0) {
          pages = collectedPages;
          text = (pdfData.text || pages.map(p => p.text).join('\n\n')).replace(/\r\n/g, '\n');
        }
      } catch (pdfErr) {
        console.warn('[Doc Extractor] Word-to-PDF page text parse notice:', pdfErr.message);
      }
    }

    // 4c. Mammoth fallback for text if not already extracted
    if (!text || text.trim().length === 0) {
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value || '';
      } catch (docxErr) {
        console.warn(`[Doc Extractor] Mammoth parsing failed for ${originalname}, trying text fallback:`, docxErr.message);
        text = buffer.toString('utf-8').replace(/[^\x20-\x7E\t\r\n]/g, ' ');
      }
    }

    // 4d. Ensure pages exist and attach rendered page images
    if (pages.length === 0 && text.trim().length > 0) {
      pages = splitTextIntoPages(text);
    }
    if (images.length > 0) {
      if (pages.length === 0) {
        pages = images.map((img, idx) => ({
          page_number: idx + 1,
          title: `Page ${idx + 1}`,
          text: `--- Page ${idx + 1} ---\n[Visual Content on Page ${idx + 1}]: Word document page ${idx + 1}`,
          images: [img],
          pageImage: img
        }));
      } else {
        for (const rImg of images) {
          const targetPage = pages.find(p => p.page_number === rImg.sourcePage) || pages[rImg.sourcePage - 1];
          if (targetPage) {
            targetPage.images = [rImg, ...(targetPage.images || []).filter(img => img.id !== rImg.id)];
            targetPage.pageImage = rImg;
          }
        }
      }
    }

    console.log(`[Doc Extractor] Word document extracted: ${pages.length} pages, ${images.length} page images, ${text.length} characters.`);
  }
  // 5. Image Training Files (PNG, JPG, JPEG, WEBP, BMP, TIFF)
  else if (
    ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'].includes(ext) ||
    mimetype.startsWith('image/')
  ) {
    fileType = ext || 'image';
    const mimeMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tiff: 'image/tiff'
    };
    const finalMime = mimeMap[ext] || mimetype || 'image/png';
    const dataUrl = `data:${finalMime};base64,${buffer.toString('base64')}`;
    const cleanName = originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const pageImage = {
      id: 'full_page_1',
      dataUrl,
      fileName: originalname,
      mimetype: finalMime,
      sourcePage: 1,
      name: cleanName,
      descr: `Training visual graphic: ${originalname}`,
      purpose: `Original uploaded training visual`,
      sizeBytes: buffer.length
    };

    images = [pageImage];

    // Try Qwen Vision to read and explain the image
    let visualText = '';
    try {
      console.log(`[Doc Extractor] Running Qwen Vision analysis on uploaded image: ${originalname}...`);
      visualText = await analyzeImageWithQwen(pageImage, 1);
    } catch (vErr) {
      console.warn('[Doc Extractor] Qwen Vision image analysis notice:', vErr.message);
    }

    // OCR fallback if Qwen vision text is not available
    if (!visualText || visualText.length < 30) {
      try {
        const ocrImages = [{ ...pageImage, buffer }];
        await ocrFallback(ocrImages);
        if (ocrImages[0]?.ocrText) {
          visualText = ocrImages[0].ocrText;
        }
      } catch (ocrErr) {
        console.warn('[Doc Extractor] OCR image notice:', ocrErr.message);
      }
    }

    const pageTitle = (visualText && firstUsefulTitleLine(visualText)) || cleanName || 'Training Visual';
    text = visualText
      ? `--- Page 1: ${pageTitle} ---\n\n[Visual Content on Page 1]:\n${visualText}`
      : `--- Page 1: ${pageTitle} ---\n\n[Visual Content on Page 1]: Training graphic ${originalname}`;

    pages = [
      {
        page_number: 1,
        title: pageTitle,
        text,
        images: [pageImage],
        pageImage
      }
    ];
    console.log(`[Doc Extractor] Image document parsed: 1 page visual, ${text.length} characters.`);
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
  }
  // 6. Audio and Video Files (MP3, WAV, M4A, OGG, AAC, WEBM, MP4)
  else if (
    ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4', 'm4v'].includes(ext) ||
    mimetype.startsWith('audio/') ||
    mimetype.startsWith('video/')
  ) {
    fileType = ext || 'audio';
    console.log(`[Doc Extractor] Audio/Video file detected: "${originalname}" (Size: ${(buffer.length / 1024).toFixed(1)} KB). Transcribing speech and extracting learning chunks...`);
    const audioRes = await extractAudioFile(buffer, originalname, mimetype);
    text = audioRes.text;
    pages = audioRes.chunks || [];
    console.log(`[Doc Extractor] Audio transcribed successfully: ${text.length} characters divided into ${pages.length} structured learning chunks.`);
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
