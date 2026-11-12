from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List

from docx_utils import replace_placeholders_in_docx
from metadata_utils import strip_docx_metadata, strip_pdf_metadata
from output_mode import OutputMode
from progress import Progress
from word_export import export_docx_to_pdf

# Short unique suffix so concurrent generations never share a filename.
_GEN_TAG_LEN = 8


def _unique_basename(basename: str) -> str:
    tag = uuid.uuid4().hex[:_GEN_TAG_LEN]
    return f"{basename}_{tag}"


def generate_document(
    template_docx: Path,
    replacements: Dict[str, Dict],
    basename: str,
    downloads: Path,
    *,
    output_mode: OutputMode,
    label: str,
    progress: Progress,
) -> List[Path]:
    safe_basename = _unique_basename(basename)
    saved: List[Path] = []
    with tempfile.TemporaryDirectory(prefix="json2docx_") as td:
        work = Path(td)
        out_docx = work / f"{safe_basename}.docx"

        progress.detail(f"{label}: filling {template_docx.name} ({len(replacements)} placeholders)")
        replace_placeholders_in_docx(template_docx, replacements, out_docx)

        progress.detail("stripping DOCX metadata")
        strip_docx_metadata(out_docx)

        save_docx = output_mode in {OutputMode.DOCX_ONLY, OutputMode.BOTH}
        save_pdf = output_mode in {OutputMode.PDF_ONLY, OutputMode.BOTH}

        if save_docx:
            final_docx = downloads / f"{safe_basename}.docx"
            progress.detail("saving DOCX to Downloads")
            shutil.copy2(out_docx, final_docx)
            saved.append(final_docx)
            progress.ok(str(final_docx))
        else:
            progress.detail("DOCX kept in temp (PDF-only mode)")

        if not save_pdf:
            progress.warn(f"{label}: PDF export skipped ({output_mode.label()})")
            return saved

        out_pdf = work / f"{safe_basename}.pdf"
        progress.detail("exporting PDF via Microsoft Word")
        try:
            export_docx_to_pdf(out_docx, out_pdf)
            strip_pdf_metadata(out_pdf)
            final_pdf = downloads / f"{safe_basename}.pdf"
            shutil.copy2(out_pdf, final_pdf)
            saved.append(final_pdf)
            progress.ok(str(final_pdf))
        except Exception as exc:
            progress.fail(f"{label} PDF export failed: {exc}")

    return saved
