import base64
import csv
import io
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup

from config import OLLAMA_BASE_URL, OLLAMA_MODEL
from quality import clean_text, heal_bullets_and_sentences, is_garbage_title


async def _vision_ocr_via_ollama(image_bytes: bytes, prompt_hint: str = "") -> str:
    """Runs Qwen Vision through Ollama for scanned pages or image-based content."""
    b64 = base64.b64encode(image_bytes).decode("ascii")
    prompt = (
        "Extract all readable training text, headings, labels, tables, and key visual information "
        "from this image accurately. Preserve headings and bullet structure. Do not invent content."
    )
    if prompt_hint:
        prompt += f" Context: {prompt_hint}"
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [{"role": "user", "content": prompt, "images": [b64]}],
                    "stream": False,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return clean_text(data.get("message", {}).get("content", ""))
    except Exception:
        pass
    return ""


def _tesseract_ocr(image_bytes: bytes) -> str:
    try:
        import pytesseract
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes))
        return clean_text(pytesseract.image_to_string(img))
    except Exception:
        return ""


async def _ocr_image_bytes(image_bytes: bytes, hint: str = "") -> str:
    # Fast local Tesseract first; if sparse/empty, escalate to Qwen Vision on RTX 3090
    text = _tesseract_ocr(image_bytes)
    if len(text) >= 40:
        return text
    vision_text = await _vision_ocr_via_ollama(image_bytes, hint)
    return vision_text if len(vision_text) > len(text) else text


def _convert_via_libreoffice(file_bytes: bytes, ext: str, target_ext: str) -> Optional[bytes]:
    """Converts legacy .doc/.ppt to .docx/.pptx/.pdf using LibreOffice headless on Ubuntu."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    with tempfile.TemporaryDirectory() as tmpdir:
        in_path = Path(tmpdir) / f"input.{ext}"
        in_path.write_bytes(file_bytes)
        subprocess.run(
            [soffice, "--headless", "--convert-to", target_ext, "--outdir", tmpdir, str(in_path)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=90,
        )
        out_path = Path(tmpdir) / f"input.{target_ext}"
        if out_path.exists():
            return out_path.read_bytes()
    return None


async def extract_pdf(file_bytes: bytes, filename: str) -> Dict[str, Any]:
    import fitz  # PyMuPDF
    import pdfplumber

    pages: List[Dict[str, Any]] = []
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    plumber_tables: Dict[int, List[str]] = {}
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for idx, page in enumerate(pdf.pages):
                tbls = page.extract_tables() or []
                formatted_tbls = []
                for tbl in tbls:
                    rows = [" | ".join((cell or "").strip() for cell in row) for row in tbl if any(row)]
                    if rows:
                        formatted_tbls.append("\n".join(rows))
                if formatted_tbls:
                    plumber_tables[idx + 1] = formatted_tbls
    except Exception:
        pass

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        p_num = page_idx + 1
        blocks = page.get_text("dict").get("blocks", [])
        headings: List[str] = []
        paragraphs: List[str] = []

        for blk in blocks:
            if blk.get("type") != 0:
                continue
            blk_lines = []
            max_font = 0.0
            for line in blk.get("lines", []):
                spans_text = "".join(s.get("text", "") for s in line.get("spans", []))
                for s in line.get("spans", []):
                    max_font = max(max_font, float(s.get("size", 0)))
                if spans_text.strip():
                    blk_lines.append(spans_text.strip())
            joined = clean_text(" ".join(blk_lines))
            if not joined:
                continue
            if max_font >= 14.0 and len(joined) <= 120 and not is_garbage_title(joined):
                headings.append(joined)
            else:
                paragraphs.append(joined)

        page_text = clean_text("\n".join(headings + paragraphs))
        tables = plumber_tables.get(p_num, [])

        # OCR fallback for scanned PDF pages
        if len(page_text) < 30 and not tables:
            pix = page.get_pixmap(dpi=180)
            ocr_txt = await _ocr_image_bytes(pix.tobytes("png"), f"{filename} page {p_num}")
            if ocr_txt:
                page_text = ocr_txt
                paragraphs.append(ocr_txt)

        if tables:
            page_text = (page_text + "\n\n" + "\n\n".join(tables)).strip()

        title = headings[0] if headings else (page_text.split("\n")[0][:80] if page_text else f"Page {p_num}")
        pages.append({
            "page_number": p_num,
            "title": title,
            "headings": headings,
            "paragraphs": heal_bullets_and_sentences(paragraphs),
            "tables": tables,
            "text": page_text,
        })

    full_text = "\n\n".join(f"--- Page {p['page_number']}: {p['title']} ---\n{p['text']}" for p in pages if p["text"])
    return {"fileType": "pdf", "fileName": filename, "text": full_text, "pages": pages, "slides": []}


async def extract_docx(file_bytes: bytes, filename: str, ext: str = "docx") -> Dict[str, Any]:
    from docx import Document

    working_bytes = file_bytes
    if ext == "doc":
        converted = _convert_via_libreoffice(file_bytes, "doc", "docx")
        if not converted:
            raise ValueError("Legacy .doc conversion requires LibreOffice on Ubuntu.")
        working_bytes = converted

    doc = Document(io.BytesIO(working_bytes))
    sections: List[Dict[str, Any]] = []
    current_sec = {"page_number": 1, "title": Path(filename).stem, "headings": [], "paragraphs": [], "tables": []}

    for para in doc.paragraphs:
        txt = clean_text(para.text)
        if not txt:
            continue
        style_name = (para.style.name or "").lower() if para.style else ""
        if "heading" in style_name or "title" in style_name:
            if current_sec["paragraphs"] or current_sec["tables"]:
                sections.append(current_sec)
                current_sec = {
                    "page_number": len(sections) + 1,
                    "title": txt[:90],
                    "headings": [txt],
                    "paragraphs": [],
                    "tables": [],
                }
            else:
                current_sec["title"] = txt[:90]
                current_sec["headings"].append(txt)
        else:
            current_sec["paragraphs"].append(txt)

    for tbl in doc.tables:
        rows = [" | ".join(clean_text(c.text) for c in row.cells) for row in tbl.rows]
        rows = [r for r in rows if r.replace("|", "").strip()]
        if rows:
            current_sec["tables"].append("\n".join(rows))

    if current_sec["paragraphs"] or current_sec["tables"] or current_sec["headings"]:
        sections.append(current_sec)

    for s in sections:
        parts = list(s["headings"]) + heal_bullets_and_sentences(s["paragraphs"]) + s["tables"]
        s["text"] = "\n".join(parts).strip()

    full_text = "\n\n".join(f"--- Section {s['page_number']}: {s['title']} ---\n{s['text']}" for s in sections if s["text"])
    return {"fileType": ext, "fileName": filename, "text": full_text, "pages": sections, "slides": []}


async def extract_pptx(file_bytes: bytes, filename: str, ext: str = "pptx") -> Dict[str, Any]:
    from pptx import Presentation

    working_bytes = file_bytes
    if ext == "ppt":
        converted = _convert_via_libreoffice(file_bytes, "ppt", "pptx")
        if not converted:
            raise ValueError("Legacy .ppt conversion requires LibreOffice on Ubuntu.")
        working_bytes = converted

    prs = Presentation(io.BytesIO(working_bytes))
    slides: List[Dict[str, Any]] = []

    for idx, slide in enumerate(prs.slides, start=1):
        title = ""
        headings: List[str] = []
        paragraphs: List[str] = []
        bullet_points: List[str] = []
        tables: List[str] = []
        ocr_texts: List[str] = []

        if slide.shapes.title and slide.shapes.title.text:
            candidate = clean_text(slide.shapes.title.text)
            if not is_garbage_title(candidate):
                title = candidate
                headings.append(candidate)

        for shape in slide.shapes:
            if shape.has_text_frame:
                if slide.shapes.title and shape == slide.shapes.title:
                    continue
                for p in shape.text_frame.paragraphs:
                    line = clean_text(p.text)
                    if not line:
                        continue
                    if p.level > 0 or line.startswith(("-", "*", "•")):
                        bullet_points.append(line)
                    else:
                        paragraphs.append(line)
            if shape.has_table:
                rows = [" | ".join(clean_text(cell.text) for cell in row.cells) for row in shape.table.rows]
                rows = [r for r in rows if r.replace("|", "").strip()]
                if rows:
                    tables.append("\n".join(rows))
            if shape.shape_type == 13 and hasattr(shape, "image"):  # PICTURE
                if len(paragraphs) + len(bullet_points) < 2 and len(shape.image.blob) >= 12000:
                    ocr_txt = await _ocr_image_bytes(shape.image.blob, f"{filename} slide {idx}")
                    if ocr_txt:
                        ocr_texts.append(ocr_txt)

        speaker_notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            speaker_notes = clean_text(slide.notes_slide.notes_text_frame.text)

        paragraphs = heal_bullets_and_sentences(paragraphs)
        if not title:
            for cand in paragraphs + bullet_points + ocr_texts:
                first_line = cand.split("\n")[0].strip()
                if not is_garbage_title(first_line):
                    title = first_line[:90]
                    break
        if not title:
            title = f"Slide {idx}"

        slide_parts = []
        if headings:
            slide_parts.extend(headings)
        slide_parts.extend(paragraphs)
        slide_parts.extend(bullet_points)
        slide_parts.extend(tables)
        slide_parts.extend(ocr_texts)
        if speaker_notes:
            slide_parts.append(f"Speaker Notes: {speaker_notes}")

        slide_text = "\n".join(slide_parts).strip()
        slides.append({
            "slideNumber": idx,
            "title": title,
            "headings": headings,
            "paragraphs": paragraphs,
            "bulletPoints": bullet_points,
            "tables": tables,
            "speakerNotes": speaker_notes,
            "fullText": slide_text,
        })

    full_text = "\n\n".join(f"--- Slide {s['slideNumber']}: {s['title']} ---\n{s['fullText']}" for s in slides if s["fullText"])
    return {"fileType": ext, "fileName": filename, "text": full_text, "pages": [], "slides": slides}


async def extract_spreadsheet(file_bytes: bytes, filename: str, ext: str) -> Dict[str, Any]:
    pages: List[Dict[str, Any]] = []
    if ext == "xlsx":
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
        for s_idx, sheet_name in enumerate(wb.sheetnames, start=1):
            ws = wb[sheet_name]
            rows = []
            headers: List[str] = []
            for r_idx, row in enumerate(ws.iter_rows(values_only=True)):
                vals = [clean_text(str(c)) if c is not None else "" for c in row]
                if not any(vals):
                    continue
                if not headers:
                    headers = vals
                rows.append(" | ".join(vals))
            sheet_text = "\n".join(rows)
            if sheet_text:
                pages.append({
                    "page_number": s_idx,
                    "title": f"Sheet: {sheet_name}",
                    "headings": [sheet_name],
                    "headers": headers,
                    "tables": [sheet_text],
                    "paragraphs": [],
                    "text": f"Sheet: {sheet_name}\n{sheet_text}",
                })
    else:
        import xlrd

        wb = xlrd.open_workbook(file_contents=file_bytes)
        for s_idx in range(wb.nsheets):
            sheet = wb.sheet_by_index(s_idx)
            rows = []
            for r_idx in range(sheet.nrows):
                vals = [clean_text(str(sheet.cell_value(r_idx, c))) for c in range(sheet.ncols)]
                if any(vals):
                    rows.append(" | ".join(vals))
            sheet_text = "\n".join(rows)
            if sheet_text:
                pages.append({
                    "page_number": s_idx + 1,
                    "title": f"Sheet: {sheet.name}",
                    "headings": [sheet.name],
                    "tables": [sheet_text],
                    "paragraphs": [],
                    "text": f"Sheet: {sheet.name}\n{sheet_text}",
                })

    full_text = "\n\n".join(p["text"] for p in pages)
    return {"fileType": ext, "fileName": filename, "text": full_text, "pages": pages, "slides": []}


async def extract_text_like(file_bytes: bytes, filename: str, ext: str) -> Dict[str, Any]:
    raw = file_bytes.decode("utf-8", errors="replace")
    pages: List[Dict[str, Any]] = []

    if ext in ("html", "htm"):
        soup = BeautifulSoup(raw, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        headings = [clean_text(h.get_text()) for h in soup.find_all(["h1", "h2", "h3"]) if clean_text(h.get_text())]
        text = clean_text(soup.get_text(separator="\n"))
        pages.append({"page_number": 1, "title": headings[0] if headings else Path(filename).stem, "headings": headings, "paragraphs": text.split("\n"), "tables": [], "text": text})
    elif ext == "rtf":
        from striprtf.striprtf import rtf_to_text

        text = clean_text(rtf_to_text(raw))
        pages.append({"page_number": 1, "title": Path(filename).stem, "headings": [], "paragraphs": text.split("\n"), "tables": [], "text": text})
    elif ext == "csv":
        reader = csv.reader(io.StringIO(raw))
        rows = [" | ".join(clean_text(c) for c in row) for row in reader if any(row)]
        text = "\n".join(rows)
        pages.append({"page_number": 1, "title": Path(filename).stem, "headings": [], "paragraphs": [], "tables": [text], "text": text})
    else:
        text = clean_text(raw)
        pages.append({"page_number": 1, "title": Path(filename).stem, "headings": [], "paragraphs": heal_bullets_and_sentences(text.split("\n")), "tables": [], "text": text})

    return {"fileType": ext, "fileName": filename, "text": pages[0]["text"] if pages else "", "pages": pages, "slides": []}


async def extract_image(file_bytes: bytes, filename: str, ext: str) -> Dict[str, Any]:
    ocr_txt = await _ocr_image_bytes(file_bytes, filename)
    title = Path(filename).stem.replace("-", " ").replace("_", " ").strip() or "Training Visual"
    if ocr_txt:
        first = ocr_txt.split("\n")[0].strip()
        if 4 <= len(first) <= 90 and not is_garbage_title(first):
            title = first
    pages = [{
        "page_number": 1,
        "title": title,
        "headings": [title],
        "paragraphs": ocr_txt.split("\n") if ocr_txt else [],
        "tables": [],
        "text": ocr_txt,
    }]
    return {"fileType": ext, "fileName": filename, "text": ocr_txt, "pages": pages, "slides": []}


async def extract_universal(file_bytes: bytes, filename: str) -> Dict[str, Any]:
    ext = Path(filename).suffix.lstrip(".").lower()
    if ext == "pdf":
        return await extract_pdf(file_bytes, filename)
    if ext in ("docx", "doc"):
        return await extract_docx(file_bytes, filename, ext)
    if ext in ("pptx", "ppt"):
        return await extract_pptx(file_bytes, filename, ext)
    if ext in ("xlsx", "xls"):
        return await extract_spreadsheet(file_bytes, filename, ext)
    if ext in ("txt", "csv", "rtf", "html", "htm"):
        return await extract_text_like(file_bytes, filename, ext)
    if ext in ("png", "jpg", "jpeg"):
        return await extract_image(file_bytes, filename, ext)
    raise ValueError(f"Unsupported file extension: .{ext}")
