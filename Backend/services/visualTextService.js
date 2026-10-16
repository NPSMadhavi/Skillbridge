import { createWorker } from 'tesseract.js';
import axios from 'axios';
import FormData from 'form-data';

const MIN_IMAGE_BYTES = 12000;
const MIN_TEACHING_IMAGE_BYTES = 25000;
const MAX_VISION_IMAGES = 40;

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

function gatewayBaseUrl() {
  return String(process.env.SKILLBRIDGE_LLM_GATEWAY_URL || '').trim().replace(/\/+$/, '');
}

function gatewayHeaders(extra = {}) {
  const headers = { ...extra };
  const apiKey = (
    process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY ||
    process.env.LLM_GATEWAY_API_KEY ||
    process.env.VEDA_API_KEY ||
    ''
  ).trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

function cleanOcrText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[|¦]/g, 'I')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 1 && !/^[\W_]+$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isUsefulText(text) {
  const t = String(text || '').trim();
  if (t.length < 24) return false;
  const tokens = t.split(/\s+/).filter(w => w.length >= 2);
  if (tokens.length >= 4) return true;
  return /[\u0980-\u09FF\u0B80-\u0BFF\u4E00-\u9FFF]/.test(t);
}

export function extractEmbeddedRasterImages(buffer) {
  const images = [];
  if (!buffer || !Buffer.isBuffer(buffer)) return images;

  const pushJpeg = (start, end) => {
    const slice = buffer.subarray(start, end);
    if (slice.length < MIN_IMAGE_BYTES) return;
    images.push({
      id: `img_embedded_${images.length + 1}`,
      fileName: `embedded-${images.length + 1}.jpg`,
      mimetype: 'image/jpeg',
      buffer: Buffer.from(slice),
      dataUrl: `data:image/jpeg;base64,${slice.toString('base64')}`,
      name: `Embedded visual ${images.length + 1}`,
      descr: '',
      sizeBytes: slice.length
    });
  };

  const pushPng = (start, end) => {
    const slice = buffer.subarray(start, end);
    if (slice.length < MIN_IMAGE_BYTES) return;
    images.push({
      id: `img_embedded_${images.length + 1}`,
      fileName: `embedded-${images.length + 1}.png`,
      mimetype: 'image/png',
      buffer: Buffer.from(slice),
      dataUrl: `data:image/png;base64,${slice.toString('base64')}`,
      name: `Embedded visual ${images.length + 1}`,
      descr: '',
      sizeBytes: slice.length
    });
  };

  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
      for (let j = i + 2; j < buffer.length - 1; j++) {
        if (buffer[j] === 0xff && buffer[j + 1] === 0xd9) {
          pushJpeg(i, j + 2);
          i = j + 1;
          break;
        }
      }
    }
  }

  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngEnd = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  let searchFrom = 0;
  while (searchFrom < buffer.length) {
    const start = buffer.indexOf(pngSig, searchFrom);
    if (start < 0) break;
    const end = buffer.indexOf(pngEnd, start + 8);
    if (end < 0) break;
    pushPng(start, end + 8);
    searchFrom = end + 8;
  }

  return images;
}

function teachingImagesForSlide(slide) {
  const images = Array.isArray(slide?.images) ? slide.images : [];
  const unique = [];
  for (const img of images) {
    const key = img.mediaPath || img.id || img.fileName;
    if (!key || unique.some(u => (u.mediaPath || u.id || u.fileName) === key)) continue;
    unique.push(img);
  }
  const large = unique
    .filter(img => (img.sizeBytes || 0) >= MIN_TEACHING_IMAGE_BYTES || (img.dataUrl && img.dataUrl.length > 40000))
    .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  if (large.length > 0) return large;
  return unique.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)).slice(0, 1);
}

async function analyzeImageWithQwen(img, slideNumber) {
  const gateway = gatewayBaseUrl();
  if (!gateway) return null;
  const buf = img.buffer || dataUrlToBuffer(img.dataUrl);
  if (!buf) return null;

  const form = new FormData();
  form.append('image', buf, {
    filename: img.fileName || `slide-${slideNumber || 'x'}.png`,
    contentType: img.mimetype || 'image/png'
  });
  form.append(
    'question',
    `This is ONLY slide ${slideNumber || '?'} of a training PowerPoint. ` +
    `Read every visible word (any language) and describe only this one slide: title, diagrams, posters, checklists, people, and what a trainer should teach from THIS picture. ` +
    `Do not reuse content from other slides. Do not invent a generic safety lecture.`
  );

  const response = await axios.post(`${gateway}/analyze-image`, form, {
    headers: gatewayHeaders(form.getHeaders()),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 180000
  });

  const explanation = cleanOcrText(response.data?.explanation);
  return explanation && explanation.length > 30 ? explanation : null;
}

async function ocrFallback(images) {
  const pending = images.filter(img => !img.ocrText && !img.visionText);
  if (pending.length === 0) return;

  let worker = null;
  try {
    worker = await createWorker('eng');
    for (const img of pending) {
      const buf = img.buffer || dataUrlToBuffer(img.dataUrl);
      if (!buf) continue;
      try {
        const result = await worker.recognize(buf);
        const text = cleanOcrText(result?.data?.text);
        if (isUsefulText(text)) {
          img.ocrText = text;
        }
      } catch (err) {
        console.warn(`[VisualText] OCR failed for ${img.fileName || img.id}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[VisualText] OCR worker could not start:', err.message);
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
}

export async function ocrImageBuffers(images = []) {
  const candidates = images
    .filter(img => img && (img.mimetype || '').startsWith('image/') && img.mimetype !== 'image/svg+xml')
    .filter(img => (img.sizeBytes || 0) >= MIN_IMAGE_BYTES || (img.dataUrl && img.dataUrl.length > 20000))
    .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
    .slice(0, MAX_VISION_IMAGES);

  if (candidates.length === 0) return images;
  await ocrFallback(candidates);
  return images;
}

export async function enrichDocumentVisuals(doc) {
  if (!doc) return doc;

  const slides = Array.isArray(doc.slides) ? doc.slides : [];
  const visionCache = new Map();

  const analyzeSlideImages = async (slide) => {
    const candidates = teachingImagesForSlide(slide);
    for (const img of candidates) {
      const cacheKey = img.mediaPath || `${img.sizeBytes}:${(img.fileName || '')}`;
      if (visionCache.has(cacheKey)) {
        img.visionText = visionCache.get(cacheKey);
        img.ocrText = img.ocrText || img.visionText;
        continue;
      }
      try {
        const explanation = await analyzeImageWithQwen(img, slide.slideNumber);
        if (explanation) {
          visionCache.set(cacheKey, explanation);
          img.visionText = explanation;
          img.ocrText = explanation;
          img.descr = explanation.slice(0, 280);
          console.log(`[VisualText] Qwen analyzed slide ${slide.slideNumber} image ${img.fileName || img.id} (${explanation.length} chars)`);
        }
      } catch (err) {
        console.warn(`[VisualText] Qwen analyze-image failed for slide ${slide.slideNumber}:`, err.message);
      }
    }
  };

  if (slides.length > 0) {
    console.log(`[VisualText] Analyzing ${slides.length} slide(s) with Qwen vision (one unique image set per slide)...`);
    for (const slide of slides) {
      await analyzeSlideImages(slide);
    }
  } else {
    const images = Array.isArray(doc.images) ? doc.images : [];
    await analyzeSlideImages({ slideNumber: 1, images });
  }

  const stillNeedOcr = [];
  for (const slide of slides) {
    for (const img of teachingImagesForSlide(slide)) {
      if (!img.visionText && !img.ocrText) stillNeedOcr.push(img);
    }
  }
  for (const img of doc.images || []) {
    if (!img.visionText && !img.ocrText) stillNeedOcr.push(img);
  }
  if (stillNeedOcr.length > 0) {
    await ocrFallback(stillNeedOcr);
  }

  for (const slide of slides) {
    const primary = teachingImagesForSlide(slide);
    const visualBits = primary
      .map(img => img.visionText || img.ocrText)
      .filter(t => t && t.length > 5);

    if (visualBits.length === 0) continue;

    const visualText = visualBits.join('\n\n');
    if (!slide.paragraphs) slide.paragraphs = [];
    const already = slide.paragraphs.some(p => p === visualText);
    if (!already) slide.paragraphs.push(visualText);

    const marker = `[Text understood from Slide ${slide.slideNumber} image]`;
    const header = `--- Slide ${slide.slideNumber}: ${slide.title} ---`;
    slide.fullText = `${header}\n\n${marker}:\n${visualText}`.trim();

    if (/^Slide \d+$/i.test(slide.title || '')) {
      const firstLine = visualText.split('\n').find(line => line.length > 3 && line.length < 90);
      if (firstLine) {
        slide.title = firstLine.replace(/^[#\-*]+\s*/, '').trim();
        slide.fullText = slide.fullText.replace(header, `--- Slide ${slide.slideNumber}: ${slide.title} ---`);
      }
    }
  }

  if (slides.length > 0) {
    doc.text = slides.map(s => s.fullText).filter(Boolean).join('\n\n');
  } else {
    const loose = (doc.images || []).map(img => img.visionText || img.ocrText).filter(Boolean).join('\n\n');
    if (loose && (!doc.text || doc.text.length < loose.length)) {
      doc.text = [doc.text, loose].filter(Boolean).join('\n\n');
    }
  }

  doc.images = slides.length > 0 ? slides.flatMap(s => s.images || []) : (doc.images || []);

  for (const img of doc.images) {
    delete img.buffer;
  }

  const analyzed = (doc.images || []).filter(img => img.visionText || img.ocrText).length;
  console.log(`[VisualText] Unique visual teaching text attached for ${analyzed} image(s) across ${slides.length} slide(s).`);
  return doc;
}

export function formatSlideVisualsForPrompt(slide) {
  if (!slide?.images?.length) return '';
  return teachingImagesForSlide(slide).map(img => {
    const text = img.visionText || img.ocrText;
    const ocr = text ? `\nVisible content in this visual:\n${text}` : '';
    return `[Visual ${img.id || img.fileName}] ${img.name || 'Slide image'}${ocr}`;
  }).join('\n');
}
