from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path


_DOCX_CORE_XML_EMPTY = """<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<cp:coreProperties
  xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\"
  xmlns:dc=\"http://purl.org/dc/elements/1.1/\"
  xmlns:dcterms=\"http://purl.org/dc/terms/\"
  xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\"
  xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">
</cp:coreProperties>
"""

_DOCX_APP_XML_EMPTY = """<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<Properties
  xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"
  xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">
</Properties>
"""

_DOCX_CUSTOM_XML_EMPTY = """<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<Properties
  xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/custom-properties\"
  xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">
</Properties>
"""


def _set_file_times_to_epoch(path: Path) -> None:
    """Best-effort removal of filesystem timestamps.

    - Always sets atime/mtime via os.utime to Unix epoch.
    - On Windows, also attempts to set creation time (ctime) via pywin32 when available.
    """
    p = Path(path)
    if not p.exists():
        return

    try:
        os.utime(p, (0, 0))
    except Exception:
        pass

    # Windows file creation time is not controlled by os.utime.
    try:
        if os.name != "nt":
            return
        import pywintypes  # type: ignore
        import win32con  # type: ignore
        import win32file  # type: ignore

        # Use a deterministic epoch timestamp.
        epoch_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
        ft = pywintypes.Time(epoch_dt)

        handle = win32file.CreateFile(
            str(p),
            win32con.GENERIC_WRITE,
            win32con.FILE_SHARE_READ | win32con.FILE_SHARE_WRITE | win32con.FILE_SHARE_DELETE,
            None,
            win32con.OPEN_EXISTING,
            win32con.FILE_ATTRIBUTE_NORMAL,
            None,
        )
        try:
            # Set creation, access, and modified times.
            win32file.SetFileTime(handle, ft, ft, ft)
        finally:
            handle.Close()
    except Exception:
        # pywin32 not installed or failed; ignore.
        pass


def strip_docx_metadata(docx_path: Path) -> None:
    """Best-effort removal of DOCX metadata.

    DOCX is a zip. We overwrite common metadata parts:
      - docProps/core.xml (author, title, created/modified, etc.)
      - docProps/app.xml  (application, pages, etc.)
      - docProps/custom.xml (custom props) if present

    This is intentionally conservative to avoid breaking the document.
    """
    p = Path(docx_path)
    if not p.exists() or p.suffix.lower() != ".docx":
        return

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / p.name
        shutil.copy2(p, tmp)

        out_tmp = Path(td) / f"stripped_{p.name}"
        with zipfile.ZipFile(tmp, "r") as zin, zipfile.ZipFile(out_tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            names = zin.namelist()
            saw_core = False
            saw_app = False
            saw_custom = False

            for n in names:
                # Replace common metadata parts with empty versions
                if n == "docProps/core.xml":
                    saw_core = True
                    zout.writestr(n, _DOCX_CORE_XML_EMPTY)
                    continue
                if n == "docProps/app.xml":
                    saw_app = True
                    zout.writestr(n, _DOCX_APP_XML_EMPTY)
                    continue
                if n == "docProps/custom.xml":
                    saw_custom = True
                    zout.writestr(n, _DOCX_CUSTOM_XML_EMPTY)
                    continue

                # Keep everything else intact
                with zin.open(n, "r") as f:
                    zout.writestr(n, f.read())

            # Ensure the common metadata parts exist (some generators omit them).
            if not saw_core:
                zout.writestr("docProps/core.xml", _DOCX_CORE_XML_EMPTY)
            if not saw_app:
                zout.writestr("docProps/app.xml", _DOCX_APP_XML_EMPTY)
            if not saw_custom and "docProps/custom.xml.rels" in names:
                # Only add custom.xml if relationships reference it.
                zout.writestr("docProps/custom.xml", _DOCX_CUSTOM_XML_EMPTY)

            # If docProps/custom.xml did not exist but relationships reference it, leaving it absent is fine.
            # We do not attempt to edit rels here to avoid accidental corruption.

        # Overwrite the file with stripped content.
        shutil.copyfile(out_tmp, p)
        _set_file_times_to_epoch(p)


def strip_pdf_metadata(pdf_path: Path) -> None:
    """Best-effort removal of PDF metadata using PyPDF2.

    Rewrites the PDF, clearing the Info dictionary and removing XMP metadata
    stream when present.
    """
    p = Path(pdf_path)
    if not p.exists() or p.suffix.lower() != ".pdf":
        return

    try:
        from PyPDF2 import PdfReader, PdfWriter  # type: ignore
        from PyPDF2.generic import NameObject  # type: ignore
    except Exception:
        # Dependencies not present; do nothing.
        return

    reader = PdfReader(str(p))
    writer = PdfWriter()

    for page in reader.pages:
        writer.add_page(page)

    # Remove the Info dictionary keys entirely (including CreationDate/ModDate).
    try:
        info = writer._info.get_object()  # type: ignore[attr-defined]
        for k in list(info.keys()):
            info.pop(k, None)
    except Exception:
        pass

    # Add back a minimal, non-identifying set (no dates).
    try:
        writer.add_metadata(
            {
                "/Title": "",
                "/Author": "",
                "/Subject": "",
                "/Keywords": "",
                "/Creator": "",
                "/Producer": "",
            }
        )
    except Exception:
        pass

    # Remove XMP metadata stream if present
    try:
        root = writer._root_object  # type: ignore[attr-defined]
        if root is not None:
            root.pop(NameObject("/Metadata"), None)
    except Exception:
        pass

    with tempfile.TemporaryDirectory() as td:
        out_tmp = Path(td) / p.name
        with out_tmp.open("wb") as f:
            writer.write(f)
        shutil.copyfile(out_tmp, p)
        _set_file_times_to_epoch(p)
