from __future__ import annotations

from typing import Any, Dict, List, Tuple

from constants import SECTION_COVER_LETTER, SECTION_RESUME
from replacements import normalize_bold_words

COVER_LETTER_BODY_PLACEHOLDERS = (
    "<<Cover-Letter-Opening>>",
    "<<Cover-Letter-Body-1>>",
    "<<Cover-Letter-Body-2>>",
    "<<Cover-Letter-Closing>>",
)

COVER_PLACEHOLDER_ALIASES: Dict[str, List[str]] = {
    "<<Profile-title>>": ["<<Profile-title>>", "<<Profile_title>>"],
    "<<Small-title>>": ["<<Small-title>>", "<<Small_title>>"],
}


def is_template_json(data: Dict[str, Any]) -> bool:
    if not isinstance(data, dict):
        return False
    if SECTION_RESUME in data and isinstance(data[SECTION_RESUME], dict):
        if any(str(k).startswith("<<") for k in data[SECTION_RESUME]):
            return False
    return any(k in data for k in ("schema_version", "template_name", "placeholder_order", "profile_title"))


def extract_placeholder_entries(
    obj: Any,
    found: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, Dict[str, Any]]:
    if found is None:
        found = {}
    if isinstance(obj, dict):
        placeholder = obj.get("placeholder")
        if isinstance(placeholder, str) and placeholder.strip():
            ph = placeholder.strip()
            found[ph] = {
                "text": str(obj.get("text", "")),
                "bold-words": normalize_bold_words(obj.get("bold_words", obj.get("bold-words"))),
            }
        for value in obj.values():
            extract_placeholder_entries(value, found)
    elif isinstance(obj, list):
        for item in obj:
            extract_placeholder_entries(item, found)
    return found


def _entry_text(entries: Dict[str, Dict[str, Any]], placeholder: str) -> str:
    return str(entries.get(placeholder, {}).get("text", "")).strip()


def _default_resume_filename(data: Dict[str, Any], entries: Dict[str, Dict[str, Any]]) -> str:
    explicit = str(data.get("resume_filename", "")).strip()
    if explicit:
        return explicit
    parts = [
        str(data.get("candidate", "")).strip(),
        _entry_text(entries, "<<Profile_title>>"),
        _entry_text(entries, "<<Small_title>>"),
        "Resume",
    ]
    return "_".join(p for p in parts if p) or "resume"


def _default_cover_letter_filename(data: Dict[str, Any], entries: Dict[str, Dict[str, Any]]) -> str:
    explicit = str(data.get("cover_letter_filename", "")).strip()
    if explicit:
        return explicit
    parts = [
        str(data.get("candidate", "")).strip(),
        _entry_text(entries, "<<Profile-title>>") or _entry_text(entries, "<<Profile_title>>"),
        _entry_text(entries, "<<Small-title>>") or _entry_text(entries, "<<Small_title>>"),
        "Cover-Letter",
    ]
    return "_".join(p for p in parts if p) or "cover-letter"


def _build_section(
    entries: Dict[str, Dict[str, Any]],
    placeholders: List[str],
    filename: str,
) -> Dict[str, Any]:
    section: Dict[str, Any] = {"filename": filename}
    for ph in placeholders:
        if ph not in entries:
            raise ValueError(f"Template JSON missing placeholder: {ph}")
        section[ph] = entries[ph]
    return section


def _lookup_entry(entries: Dict[str, Dict[str, Any]], placeholder: str) -> Dict[str, Any] | None:
    for alias in COVER_PLACEHOLDER_ALIASES.get(placeholder, [placeholder]):
        if alias in entries:
            return entries[alias]
    return None


def _synthesize_cover_letter_body(entries: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    paragraphs: List[str] = []
    bold_words: List[str] = []
    seen_bold: set[str] = set()
    for ph in COVER_LETTER_BODY_PLACEHOLDERS:
        entry = entries.get(ph)
        if not entry:
            continue
        text = str(entry.get("text", "")).strip()
        if text:
            paragraphs.append(text)
        for word in normalize_bold_words(entry.get("bold-words", entry.get("bold_words"))):
            if word not in seen_bold:
                seen_bold.add(word)
                bold_words.append(word)
    return {"text": "\n\n".join(paragraphs), "bold-words": bold_words}


def _build_simplified_cover_section(
    entries: Dict[str, Dict[str, Any]],
    cover_placeholders: List[str],
    filename: str,
) -> Dict[str, Any] | None:
    section: Dict[str, Any] = {"filename": filename}
    for ph in cover_placeholders:
        if ph == "<<Cover-Letter>>":
            body = _synthesize_cover_letter_body(entries)
            if not body["text"].strip():
                return None
            section[ph] = body
            continue
        entry = _lookup_entry(entries, ph)
        if entry is None:
            return None
        section[ph] = entry
    return section


def convert_template_json_to_fill(
    data: Dict[str, Any],
    resume_placeholders: List[str],
    cover_placeholders: List[str],
) -> Tuple[Dict[str, Any], bool]:
    entries = extract_placeholder_entries(data)
    fill: Dict[str, Any] = {
        SECTION_RESUME: _build_section(
            entries, resume_placeholders, _default_resume_filename(data, entries)
        )
    }
    if not [ph for ph in cover_placeholders if ph not in entries]:
        fill[SECTION_COVER_LETTER] = _build_section(
            entries, cover_placeholders, _default_cover_letter_filename(data, entries)
        )
        return fill, False
    simplified = _build_simplified_cover_section(
        entries, cover_placeholders, _default_cover_letter_filename(data, entries)
    )
    if simplified is not None:
        fill[SECTION_COVER_LETTER] = simplified
        return fill, False
    return fill, True


def summarize_template_json(data: Dict[str, Any]) -> str:
    name = str(data.get("template_name", "template")).strip() or "template"
    version = str(data.get("schema_version", "")).strip()
    candidate = str(data.get("candidate", "")).strip()
    bits = [name]
    if version:
        bits.append(f"v{version}")
    if candidate:
        bits.append(candidate)
    return " / ".join(bits)
