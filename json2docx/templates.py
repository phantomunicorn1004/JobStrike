from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple

from constants import (
    COVER_LETTER_DOCX_NAME,
    FILL_SCHEMA_NAME,
    RESERVED_JSON_KEYS,
    RESUME_DOCX_NAME,
    SECTION_COVER_LETTER,
    SECTION_RESUME,
    TEMPLATE_ROOT_NAME,
)
from docx_utils import extract_placeholders_from_docx


@dataclass(frozen=True)
class TemplateBundle:
    dir: Path
    resume_path: Path
    cover_path: Path
    resume_placeholders: List[str]
    cover_placeholders: List[str]


def _template_root(root: Path) -> Path:
    base = root / TEMPLATE_ROOT_NAME
    if not base.is_dir():
        raise FileNotFoundError(f"Template root not found: {base}")
    return base


def _missing_template_files(template_dir: Path) -> List[str]:
    missing: List[str] = []
    for name in (RESUME_DOCX_NAME, COVER_LETTER_DOCX_NAME):
        if not (template_dir / name).is_file():
            missing.append(name)
    return missing


def scan_template_dirs(root: Path) -> List[Tuple[Path, List[str]]]:
    """Return subfolders under resume_template/ with any missing required files."""
    base = _template_root(root)
    dirs = sorted(
        (p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")),
        key=lambda p: p.name.casefold(),
    )
    return [(p, _missing_template_files(p)) for p in dirs]


def list_template_dirs(root: Path) -> List[Path]:
    scanned = scan_template_dirs(root)
    ready = [p for p, missing in scanned if not missing]
    if not ready:
        if scanned:
            details = "; ".join(
                f"{p.name} (missing {', '.join(missing)})" for p, missing in scanned if missing
            )
            raise FileNotFoundError(
                f"No complete template folders under {_template_root(root)}. Found: {details}"
            )
        raise FileNotFoundError(f"No template folders found under: {_template_root(root)}")
    return ready


def choose_template_dir(dirs: List[Path]) -> Path:
    print(f"\nScanned {len(dirs)} template folder(s):")
    for i, p in enumerate(dirs, start=1):
        print(f"  {i}. {p.name}  ({TEMPLATE_ROOT_NAME}/{p.name}/)")
    while True:
        raw = input("Choose by number or candidate name: ").strip()
        if not raw:
            print("Invalid selection. Try again.")
            continue
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(dirs):
                return dirs[idx - 1]
        else:
            matches = [p for p in dirs if p.name.casefold() == raw.casefold()]
            if len(matches) == 1:
                return matches[0]
            if len(matches) > 1:
                print("Ambiguous name. Use the number instead.")
                continue
        print("Invalid selection. Try again.")


def resolve_template_dir(root: Path, arg_template: str | None) -> Path:
    dirs = list_template_dirs(root)
    if arg_template:
        name = str(arg_template).strip()
        if name.isdigit():
            idx = int(name)
            if 1 <= idx <= len(dirs):
                return dirs[idx - 1]
        matches = [p for p in dirs if p.name.casefold() == name.casefold()]
        if len(matches) == 1:
            return matches[0]
        available = ", ".join(p.name for p in dirs)
        raise FileNotFoundError(
            f"Template folder {TEMPLATE_ROOT_NAME}/{name}/ not found. Available: {available}"
        )
    return choose_template_dir(dirs)


def load_template_bundle(template_dir: Path) -> TemplateBundle:
    resume_path = template_dir / RESUME_DOCX_NAME
    cover_path = template_dir / COVER_LETTER_DOCX_NAME

    missing = [
        name
        for name, path in (
            (RESUME_DOCX_NAME, resume_path),
            (COVER_LETTER_DOCX_NAME, cover_path),
        )
        if not path.is_file()
    ]
    if missing:
        raise FileNotFoundError(
            f"Template load failed in {template_dir}: missing {', '.join(missing)}"
        )

    return TemplateBundle(
        dir=template_dir,
        resume_path=resume_path,
        cover_path=cover_path,
        resume_placeholders=extract_placeholders_from_docx(resume_path),
        cover_placeholders=extract_placeholders_from_docx(cover_path),
    )


def _build_section_schema(placeholders: List[str]) -> Dict[str, Any]:
    section: Dict[str, Any] = {"filename": "<output basename without extension>"}
    for ph in placeholders:
        section[ph] = {"text": "", "bold-words": []}
    return section


def build_fill_schema(resume_phs: List[str], cover_phs: List[str]) -> Dict[str, Any]:
    return {
        SECTION_RESUME: _build_section_schema(resume_phs),
        SECTION_COVER_LETTER: _build_section_schema(cover_phs),
    }


def _validate_fill_schema_keys(
    schema: Dict[str, Any],
    resume_phs: List[str],
    cover_phs: List[str],
) -> None:
    for section_name, expected in (
        (SECTION_RESUME, resume_phs),
        (SECTION_COVER_LETTER, cover_phs),
    ):
        section = schema.get(section_name)
        if not isinstance(section, dict):
            raise ValueError(f'"{section_name}" must be an object')
        keys = {k for k in section if k not in RESERVED_JSON_KEYS}
        missing = [ph for ph in expected if ph not in keys]
        extra = [k for k in keys if k not in expected]
        if missing:
            raise ValueError(f"{FILL_SCHEMA_NAME} {section_name} missing: {', '.join(missing)}")
        if extra:
            raise ValueError(f"{FILL_SCHEMA_NAME} {section_name} unexpected keys: {', '.join(extra)}")


def load_fill_schema(bundle: TemplateBundle) -> Tuple[Dict[str, Any], Path | None]:
    schema_path = bundle.dir / FILL_SCHEMA_NAME
    if schema_path.is_file():
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        _validate_fill_schema_keys(
            schema, bundle.resume_placeholders, bundle.cover_placeholders
        )
        return schema, schema_path
    return build_fill_schema(bundle.resume_placeholders, bundle.cover_placeholders), None


def downloads_dir() -> Path:
    path = Path.home() / "Downloads"
    path.mkdir(parents=True, exist_ok=True)
    return path
