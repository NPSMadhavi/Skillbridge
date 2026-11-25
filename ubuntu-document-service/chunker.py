import re
from typing import Any, Dict, List

from quality import clean_text, validate_title_against_content


def _split_preserving_sentences(text: str, max_chars: int = 1600) -> List[str]:
    text = clean_text(text)
    if len(text) <= max_chars:
        return [text] if text else []

    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF])", text)
    chunks: List[str] = []
    current = ""
    for sent in sentences:
        if not sent:
            continue
        if len(current) + len(sent) + 1 <= max_chars:
            current = f"{current} {sent}".strip() if current else sent
        else:
            if current:
                chunks.append(current)
            if len(sent) <= max_chars:
                current = sent
            else:
                # Hard wrap only if a single sentence exceeds max_chars
                for i in range(0, len(sent), max_chars):
                    chunks.append(sent[i : i + max_chars].strip())
                current = ""
    if current:
        chunks.append(current)
    return chunks


def build_document_aware_chunks(doc: Dict[str, Any], max_chunk_chars: int = 1600) -> List[Dict[str, Any]]:
    """
    Creates document-aware semantic chunks preserving headings, page/slide/sheet numbers,
    bullet points, tables, and natural ordering.
    """
    file_name = doc.get("fileName", "document")
    file_type = doc.get("fileType", "document")
    slides = doc.get("slides") or []
    pages = doc.get("pages") or []

    chunks: List[Dict[str, Any]] = []

    # 1. PowerPoint: group related consecutive slides (or keep rich slides distinct)
    if slides:
        group_slides: List[Dict[str, Any]] = []
        group_chars = 0

        def flush_slide_group(items: List[Dict[str, Any]]) -> None:
            if not items:
                return
            slide_nums = [s["slideNumber"] for s in items]
            primary_title = validate_title_against_content(
                items[0].get("title", ""),
                items[0].get("fullText", ""),
                f"Module {len(chunks) + 1}",
            )
            combined_text = "\n\n".join(
                f"[Slide {s['slideNumber']}: {s.get('title', '')}]\n{s.get('fullText', '')}"
                for s in items
                if s.get("fullText")
            ).strip()
            if len(combined_text) < 35:
                return
            bullets = []
            for s in items:
                bullets.extend(s.get("bulletPoints") or [])
            chunks.append({
                "chunkIndex": len(chunks),
                "concept": primary_title,
                "topic": primary_title,
                "subtopic": ", ".join(s.get("title", "") for s in items[1:] if s.get("title"))[:120] or primary_title,
                "chunkType": "presentation_slide_group",
                "sourcePage": slide_nums[0],
                "sourceSlides": slide_nums,
                "sourceSection": primary_title,
                "keyPoints": bullets[:8],
                "chunkText": combined_text,
                "semanticSummary": combined_text[:280],
                "metadata": {"fileName": file_name, "fileType": file_type, "slideNumbers": slide_nums},
            })

        for slide in slides:
            txt = (slide.get("fullText") or "").strip()
            if len(txt) < 20:
                continue
            # Start a new group if combining would exceed max_chunk_chars or if slide has a distinct major heading
            if group_slides and (group_chars + len(txt) > max_chunk_chars or len(group_slides) >= 3):
                flush_slide_group(group_slides)
                group_slides = []
                group_chars = 0
            group_slides.append(slide)
            group_chars += len(txt)
        flush_slide_group(group_slides)
        return chunks

    # 2. Pages / Sections / Sheets (PDF, DOCX, XLSX, HTML, TXT, Images)
    for page in pages:
        p_num = page.get("page_number", 1)
        p_text = clean_text(page.get("text", ""))
        if len(p_text) < 25:
            continue
        heading = (page.get("headings") or [page.get("title", "")])[0]
        section_title = validate_title_against_content(heading, p_text, f"Section {p_num}")
        sub_parts = _split_preserving_sentences(p_text, max_chars=max_chunk_chars)

        for part_idx, part in enumerate(sub_parts):
            if len(part) < 30:
                continue
            part_title = section_title if part_idx == 0 else f"{section_title} (Part {part_idx + 1})"
            chunks.append({
                "chunkIndex": len(chunks),
                "concept": part_title,
                "topic": section_title,
                "subtopic": part_title,
                "chunkType": "spreadsheet_sheet" if file_type in ("xls", "xlsx", "csv") else "document_section",
                "sourcePage": p_num,
                "sourceSlides": [p_num],
                "sourceSection": section_title,
                "keyPoints": [line for line in part.split("\n") if line.startswith(("-", "*", "•"))][:6],
                "chunkText": part,
                "semanticSummary": part[:280],
                "metadata": {
                    "fileName": file_name,
                    "fileType": file_type,
                    "pageNumber": p_num,
                    "tablesCount": len(page.get("tables") or []),
                },
            })

    return chunks
