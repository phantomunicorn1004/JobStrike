from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import List

from constants import SECTION_COVER_LETTER, SECTION_RESUME
from generator import generate_document
from json_io import extract_json, prepare_generation_plan
from output_mode import OutputMode
from progress import Progress
from template_json_converter import is_template_json, summarize_template_json
from templates import TemplateBundle, downloads_dir

# Step weights (must sum to 100 per workflow variant).
_WEIGHTS_RESUME_ONLY = (
    ("JSON received", 8),
    ("Parse and convert", 22),
    ("Validate", 15),
    ("Generate resume", 55),
)
_WEIGHTS_WITH_COVER = (
    ("JSON received", 6),
    ("Parse and convert", 19),
    ("Validate", 15),
    ("Generate resume", 35),
    ("Generate cover letter", 25),
)


@dataclass
class SavedOutput:
    kind: str  # "resume" | "cover_letter"
    path: Path


@dataclass
class ProcessResult:
    ok: bool
    saved_files: List[Path]
    error: str | None = None
    outputs: List[SavedOutput] = field(default_factory=list)


def _placeholder_count(section: dict) -> int:
    return len([k for k in section if k != "filename"])


def process_json(
    raw: str,
    bundle: TemplateBundle,
    *,
    output_mode: OutputMode,
) -> ProcessResult:
    if not raw.strip():
        return ProcessResult(ok=False, saved_files=[], error="Empty JSON input")

    line_count = raw.count("\n") + 1
    size_kb = len(raw.encode("utf-8")) / 1024
    progress = Progress()
    progress_started = False

    try:
        data = extract_json(raw)
        plan = prepare_generation_plan(
            data, bundle.resume_placeholders, bundle.cover_placeholders
        )
        will_cover = bool(plan.cover_name and plan.cover_repl)
        weights = _WEIGHTS_WITH_COVER if will_cover else _WEIGHTS_RESUME_ONLY

        progress.begin(f"JSON to DOCX generation ({output_mode.label()})")
        progress_started = True
        label, weight = weights[0]
        progress.step(f"{label} ({line_count} lines, {size_kb:.1f} KB)", weight=weight)

        label, weight = weights[1]
        progress.step(label, weight=weight)
        fmt = (
            f"template JSON - {summarize_template_json(data)}"
            if is_template_json(data)
            else "fill JSON (flat resume / cover_letter)"
        )
        resume_keys = _placeholder_count(plan.fill_data[SECTION_RESUME])
        if plan.used_template_json and will_cover:
            cover_keys = _placeholder_count(plan.fill_data[SECTION_COVER_LETTER])
            progress.ok(f"{fmt} | {resume_keys} resume + {cover_keys} cover placeholders")
        elif plan.cover_skipped:
            progress.ok(f"{fmt} | {resume_keys} resume placeholders (cover letter skipped)")
        else:
            progress.ok(fmt)

        label, weight = weights[2]
        progress.step(label, weight=weight)
        progress.ok(f"resume -> {plan.resume_name}")
        if plan.cover_name:
            progress.ok(f"cover letter -> {plan.cover_name}")
        elif plan.cover_skipped:
            progress.warn("cover letter skipped")
        if (
            plan.used_template_json
            and will_cover
            and SECTION_COVER_LETTER not in plan.raw_data
        ):
            progress.detail("cover letter mapped to simplified cover-letter.docx")

    except Exception as exc:
        if not progress_started:
            progress.begin(f"JSON to DOCX generation ({output_mode.label()})")
            progress.step(f"JSON received ({line_count} lines, {size_kb:.1f} KB)", weight=0)
        progress.fail(str(exc))
        progress.aborted("generation aborted")
        return ProcessResult(ok=False, saved_files=[], error=str(exc))

    out_dir = downloads_dir()
    saved: List[Path] = []
    outputs: List[SavedOutput] = []
    try:
        resume_idx = 3
        label, weight = weights[resume_idx]
        progress.step(label, weight=weight)
        resume_paths = generate_document(
            bundle.resume_path,
            plan.resume_repl,
            plan.resume_name,
            out_dir,
            output_mode=output_mode,
            label="Resume",
            progress=progress,
        )
        saved.extend(resume_paths)
        outputs.extend(SavedOutput(kind="resume", path=p) for p in resume_paths)
        if plan.cover_name and plan.cover_repl:
            cover_idx = 4
            label, weight = weights[cover_idx]
            progress.step(label, weight=weight)
            cover_paths = generate_document(
                bundle.cover_path,
                plan.cover_repl,
                plan.cover_name,
                out_dir,
                output_mode=output_mode,
                label="Cover letter",
                progress=progress,
            )
            saved.extend(cover_paths)
            outputs.extend(SavedOutput(kind="cover_letter", path=p) for p in cover_paths)
    except Exception as exc:
        progress.fail(str(exc))
        progress.aborted("generation failed")
        return ProcessResult(ok=False, saved_files=[], error=str(exc))

    docx_count = sum(1 for p in saved if p.suffix.lower() == ".docx")
    pdf_count = sum(1 for p in saved if p.suffix.lower() == ".pdf")
    progress.done(f"{docx_count} DOCX, {pdf_count} PDF saved to Downloads ({output_mode.label()})")
    return ProcessResult(ok=True, saved_files=saved, outputs=outputs)
