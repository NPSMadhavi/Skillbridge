import re
from typing import List

PLACEHOLDER_RE = re.compile(
    r"\b(?:Text|Date|Footer|Slide(?:\s*Number)?|Title|Header|Sub-Title|Picture|Object|Shape|Media|Table|Content)?\s*Placeholder(?:\s*\d+)?\b",
    re.IGNORECASE,
)
TEMPLATE_PROMPT_RE = re.compile(
    r"^Click\s+to\s+(?:add|edit)\s+(?:text|title|subtitle|master|header|footer)",
    re.IGNORECASE,
)
PATH_NOISE_RE = re.compile(r"(?:[A-Za-z]:\\(?:Users|Windows|Program|AppData|Local|Temp)|Content\.MSO|\.tmp\b)", re.IGNORECASE)
FONT_NOISE_RE = re.compile(
    r"(?:Adobe\s*Photoshop|MS\s*PGothic|Myriad\s*Pro|Times\s*New\s*Roman|PowerPoint\s*Document|DocumentSummaryInformation|SummaryInformation)",
    re.IGNORECASE,
)


def is_garbage_title(title: str) -> bool:
    t = (title or "").strip()
    if not t or len(t) < 3 or len(t) > 120:
        return True
    if PLACEHOLDER_RE.search(t) or TEMPLATE_PROMPT_RE.search(t) or PATH_NOISE_RE.search(t) or FONT_NOISE_RE.search(t):
        return True
    if re.match(r"^(?:slide|page|sheet)\s+\d+$", t, re.IGNORECASE):
        return True
    letters = len(re.findall(r"[A-Za-z\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u4E00-\u9FFF]", t))
    if letters < 3:
        return True
    if len(re.sub(r"[A-Za-z0-9\s]", "", t)) > letters * 0.6 and letters < 12:
        return True
    return False


STANDALONE_SUBHEADING_RE = re.compile(
    r"^(?:definition|definitions|advantage|advantages|disadvantage|disadvantages|"
    r"benefit|benefits|limitation|limitations|drawback|drawbacks|example|examples|"
    r"syntax|properties|characteristics|features|applications|summary|conclusion|"
    r"note|notes|output|input|algorithm|pseudocode|working|architecture|components|types)[:\s]*$",
    re.IGNORECASE,
)
DANGLING_END_RE = re.compile(
    r"(?:,|\b(?:for|and|or|of|to|in|on|with|from|by|as|the|a|an|that|which|is|are|was|were|into|using))$",
    re.IGNORECASE,
)


def is_standalone_subheading(title: str) -> bool:
    t = (title or "").strip()
    return bool(STANDALONE_SUBHEADING_RE.match(t))


def is_incomplete_heading(title: str) -> bool:
    t = (title or "").strip()
    if not t:
        return True
    if is_standalone_subheading(t):
        return True
    if t[0].islower():
        return True
    if DANGLING_END_RE.search(t):
        return True
    return False


def clean_text(text: str) -> str:
    if not text:
        return ""
    lines = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            lines.append("")
            continue
        if PLACEHOLDER_RE.search(line) or TEMPLATE_PROMPT_RE.search(line) or PATH_NOISE_RE.search(line) or FONT_NOISE_RE.search(line):
            continue
        line = re.sub(r"[^\S\n]+", " ", line)
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def heal_bullets_and_sentences(lines: List[str]) -> List[str]:
    """Merges broken line wraps and dangling continuations while keeping distinct bullets/headings intact."""
    healed: List[str] = []
    for raw in lines:
        line = clean_text(raw)
        if not line:
            continue
        is_bullet = bool(re.match(r"^[-*•▪▸►→\d.)]+\s+", line))
        is_unit_heading = bool(re.match(r"^(?:unit|chapter|module|section|topic)\s+\d+", line, re.IGNORECASE))
        if healed and not is_bullet and not is_unit_heading:
            prev = healed[-1]
            if prev and not re.search(r"[.!?:;]$", prev) and (line[0].islower() or DANGLING_END_RE.search(prev)):
                healed[-1] = f"{prev} {line}"
                continue
        healed.append(line)
    return healed


def validate_title_against_content(title: str, content: str, fallback: str) -> str:
    candidate = clean_text(title)
    if is_garbage_title(candidate) or is_incomplete_heading(candidate):
        # Try first meaningful complete heading/line from content
        for line in (content or "").split("\n"):
            l = re.sub(r"^[-*•#\d.)\s]+", "", line).strip()
            if 5 <= len(l) <= 95 and not is_garbage_title(l) and not is_incomplete_heading(l):
                return l
        return fallback
    return candidate
