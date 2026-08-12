from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from constants import SECTION_COVER_LETTER, SECTION_RESUME
from replacements import sanitize_filename, section_replacements
from template_json_converter import convert_template_json_to_fill, is_template_json


def extract_json(text: str) -> Dict[str, Any]:
    s = (text or "").strip()
    if not s:
        raise ValueError("Empty JSON input")
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        start = s.find("{")
        end = s.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(s[start : end + 1])
        raise


def _validate_section(
    section_name: str,
    section: Any,
    expected_placeholders: List[str],
) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    if not isinstance(section, dict):
        raise ValueError(f'"{section_name}" must be an object')

    filename = section.get("filename")
    if not isinstance(filename, str) or not filename.strip():
        raise ValueError(f'"{section_name}.filename" is required')

    replacements = section_replacements(section)
    missing = [ph for ph in expected_placeholders if ph not in replacements]
    if missing:
        raise ValueError(
            f'"{section_name}" is missing placeholders: {", ".join(missing)}'
        )

    return sanitize_filename(filename), replacements


@dataclass(frozen=True)
class GenerationPlan:
    resume_name: str
    resume_repl: Dict[str, Dict[str, Any]]
    cover_name: str | None
    cover_repl: Dict[str, Dict[str, Any]] | None
    used_template_json: bool
    cover_skipped: bool
    raw_data: Dict[str, Any]
    fill_data: Dict[str, Any]


def prepare_generation_plan(
    data: Dict[str, Any],
    resume_phs: List[str],
    cover_phs: List[str],
) -> GenerationPlan:
    if is_template_json(data):
        fill_data, cover_skipped = convert_template_json_to_fill(data, resume_phs, cover_phs)
        used_template = True
    else:
        fill_data, cover_skipped, used_template = data, False, False

    if SECTION_RESUME not in fill_data:
        raise ValueError(f'JSON must include "{SECTION_RESUME}"')

    resume_name, resume_repl = _validate_section(
        SECTION_RESUME, fill_data[SECTION_RESUME], resume_phs
    )

    cover_name: str | None = None
    cover_repl: Dict[str, Dict[str, Any]] | None = None
    if SECTION_COVER_LETTER in fill_data:
        cover_name, cover_repl = _validate_section(
            SECTION_COVER_LETTER, fill_data[SECTION_COVER_LETTER], cover_phs
        )
    elif not cover_skipped:
        raise ValueError(f'JSON must include "{SECTION_COVER_LETTER}"')

    return GenerationPlan(
        resume_name=resume_name,
        resume_repl=resume_repl,
        cover_name=cover_name,
        cover_repl=cover_repl,
        used_template_json=used_template,
        cover_skipped=cover_skipped,
        raw_data=data,
        fill_data=fill_data,
    )
