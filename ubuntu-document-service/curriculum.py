import json
import math
from typing import Any, Dict, List

import httpx

from config import OLLAMA_BASE_URL, OLLAMA_MODEL
from quality import (
    clean_text,
    is_garbage_title,
    is_incomplete_heading,
    validate_title_against_content,
)


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
        if is_garbage_title(c.get("concept", ""))
        or is_incomplete_heading(c.get("concept", ""))
        or c.get("concept", "").startswith(("Module ", "Section ", "Slide ", "Page "))
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
    modules: List[Dict[str, Any]] = []
    current_mod_lessons: List[Dict[str, Any]] = []
    current_mod_topic = ""

    for idx, chunk in enumerate(chunks):
        title = validate_title_against_content(
            refined_titles[idx] if idx < len(refined_titles) else chunk.get("concept", ""),
            chunk.get("chunkText", ""),
            f"Lesson {idx + 1}",
        )
        chunk["concept"] = title
        topic = clean_text(chunk.get("topic") or "") or title

        # Start a new module when the parent topic changes (after >= 2 lessons) or every 4 lessons
        should_split_mod = (
            current_mod_lessons
            and (
                (topic.lower() != current_mod_topic.lower() and len(current_mod_lessons) >= 2)
                or len(current_mod_lessons) >= 4
            )
        )
        if should_split_mod:
            mod_num = len(modules) + 1
            mod_title = current_mod_topic or current_mod_lessons[0]["title"]
            modules.append({
                "id": f"mod_{mod_num}",
                "title": mod_title,
                "description": f"Covers {', '.join(l['title'] for l in current_mod_lessons[:3])}",
                "lessons": [{"id": l["id"], "title": l["title"], "duration": l["duration"]} for l in current_mod_lessons],
            })
            current_mod_lessons = []
            current_mod_topic = ""

        if not current_mod_topic:
            current_mod_topic = topic

        mod_num = len(modules) + 1
        lesson_obj = {
            "id": idx + 1,
            "title": title,
            "duration": _estimate_duration(chunk.get("chunkText", "")),
            "moduleId": f"mod_{mod_num}",
            "moduleTitle": current_mod_topic or f"Module {mod_num}: {resolved_title}",
            "chapterTitle": chunk.get("sourceSection") or title,
            "sourcePage": chunk.get("sourcePage"),
            "sourceSlides": chunk.get("sourceSlides") or [],
            "explanation": chunk.get("chunkText", ""),
            "explanations": {"en": chunk.get("chunkText", "")},
        }
        lessons.append(lesson_obj)
        current_mod_lessons.append(lesson_obj)

    if current_mod_lessons:
        mod_num = len(modules) + 1
        mod_title = current_mod_topic or current_mod_lessons[0]["title"]
        modules.append({
            "id": f"mod_{mod_num}",
            "title": mod_title,
            "description": f"Covers {', '.join(l['title'] for l in current_mod_lessons[:3])}",
            "lessons": [{"id": l["id"], "title": l["title"], "duration": l["duration"]} for l in current_mod_lessons],
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
