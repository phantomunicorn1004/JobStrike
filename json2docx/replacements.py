from __future__ import annotations

import re
from typing import Any, Dict, List

from constants import RESERVED_JSON_KEYS


def normalize_bold_words(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def normalize_replacement(val: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "text": str(val.get("text", "")),
        "bold-words": normalize_bold_words(val.get("bold-words", val.get("bold_words"))),
    }


def sanitize_filename(name: str) -> str:
    s = (name or "").strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r'[<>:"/\\|?*]+', "", s)
    s = s.strip().rstrip(". ")
    for ext in (".docx", ".pdf"):
        if s.lower().endswith(ext):
            s = s[: -len(ext)].rstrip(". ")
    return s or "output"


def section_replacements(section: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for key, value in section.items():
        if key in RESERVED_JSON_KEYS:
            continue
        if not isinstance(value, dict):
            raise ValueError(f"Placeholder {key!r} must be an object with text/bold-words")
        out[key] = normalize_replacement(value)
    return out
