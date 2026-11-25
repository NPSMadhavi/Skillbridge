import json
import math
from typing import Any, Dict, List

import httpx

from config import OLLAMA_BASE_URL, OLLAMA_MODEL
from quality import clean_text, is_garbage_title, validate_title_against_content


def _estimate_duration(text: str) -> str:
    words = len((text or "").split())
    secs = max(75, min(360, round(words / 2.15)))
    return f"{secs // 60:02d}:{secs % 60:02d}"


async def _refine_titles_with_qwen(chunks: List[Dict[str, Any]], doc_title: str) -> List[str]:
    """
    Uses Qwen via Ollama ONLY for chunks that lack a clean document heading.
    Never invents unsupported lessons.
    """
    needs_title = [
        (idx, c.get("chunkText", "")[:500])
        for idx, c in enumerate(chunks)
        if is_garbage_title(c.get("concept", "")) or c.get("concept", "").startswith(("Module ", "Section ", "Slide ", "Page "))
    ]
    titles = [c.get("concept", f"Lesson {i + 1}") for i, c in enumerate(chunks)]
    if not needs_title:
        return titles

    prompt_items = "\n".join(f"[{idx}] {snippet}" for idx, snippet in needs_title[:15])
    prompt = (
        f"Document: {doc_title}\n"
        "Generate a concise, factual 3-7 word training lesson title for each numbered excerpt below. "
        "Use the exact terminology from the excerpt. Return JSON object {\"titles\": {\"<idx>\": \"<title>\"}} only.\n\n"
        f"{prompt_items}"
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "format": "json",
                    "stream": False,
                },
            )
            if resp.status_code == 200:
                raw = resp.json().get("message", {}).get("content", "{}")
                parsed = json.loads(raw).get("titles", {})
                for idx, _ in needs_title:
                    cand = clean_text(str(parsed.get(str(idx), "")))
                    if cand and not is_garbage_title(cand):
                        titles[idx] = cand
    except Exception:
        pass
    return titles


async def build_grounded_curriculum(
    doc: Dict[str, Any],
    chunks: List[Dict[str, Any]],
    course_title: str = "",
    course_description: str = "",
) -> Dict[str, Any]:
    file_name = doc.get("fileName", "Course")
    file_type = doc.get("fileType", "document")
    resolved_title = clean_text(course_title) or file_name.rsplit(".", 1)[0].replace("_", " ").replace("-", " ")

    refined_titles = await _refine_titles_with_qwen(chunks, resolved_title)

    lessons: List[Dict[str, Any]] = []
    for idx, chunk in enumerate(chunks):
        title = validate_title_against_content(
            refined_titles[idx] if idx < len(refined_titles) else chunk.get("concept", ""),
            chunk.get("chunkText", ""),
            f"Lesson {idx + 1}",
        )
        chunk["concept"] = title
        mod_num = (idx // 4) + 1
        lessons.append({
            "id": idx + 1,
            "title": title,
            "duration": _estimate_duration(chunk.get("chunkText", "")),
            "moduleId": f"mod_{mod_num}",
            "moduleTitle": f"Module {mod_num}: {chunk.get('topic') or resolved_title}",
            "chapterTitle": chunk.get("sourceSection") or title,
            "sourcePage": chunk.get("sourcePage"),
            "sourceSlides": chunk.get("sourceSlides") or [],
            "explanation": chunk.get("chunkText", ""),
            "explanations": {"en": chunk.get("chunkText", "")},
        })

    modules: List[Dict[str, Any]] = []
    num_modules = max(1, math.ceil(len(lessons) / 4)) if lessons else 0
    for m_idx in range(num_modules):
        mod_lessons = lessons[m_idx * 4 : (m_idx + 1) * 4]
        mod_title = mod_lessons[0]["title"] if mod_lessons else f"Module {m_idx + 1}"
        modules.append({
            "id": f"mod_{m_idx + 1}",
            "title": mod_title,
            "description": f"Covers {', '.join(l['title'] for l in mod_lessons[:3])}",
            "lessons": [{"id": l["id"], "title": l["title"], "duration": l["duration"]} for l in mod_lessons],
        })

    return {
        "title": resolved_title,
        "description": clean_text(course_description) or f"Structured training curriculum extracted from {file_name}",
        "fileType": file_type,
        "fileName": file_name,
        "slides": doc.get("slides") or [],
        "pages": doc.get("pages") or [],
        "curriculum": modules,
        "lessons": lessons,
        "isAiGenerating": False,
    }
