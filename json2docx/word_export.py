from __future__ import annotations

import os
import subprocess
import shutil
import tempfile
import time
from pathlib import Path
from typing import Optional, Tuple


def _try_unblock_file_windows(path: str) -> None:
    """Best-effort: remove Mark-of-the-Web so Word won't force Protected View."""
    if os.name != "nt":
        return
    # Unblock-File works on the Zone.Identifier ADS when present.
    try:
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                f"Unblock-File -LiteralPath '{path}' -ErrorAction SilentlyContinue",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass
    # Extra belt-and-suspenders: attempt to remove the ADS directly.
    try:
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                f"Remove-Item -LiteralPath '{path}:Zone.Identifier' -ErrorAction SilentlyContinue",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass


def _open_doc_in_word(word, abs_docx: str):
    """Open DOCX robustly and return (doc, protected_view_window, last_exception)."""
    last_exc: Optional[BaseException] = None

    # Snapshot counts so we can recover the document even if COM returns None.
    try:
        doc_count_before = int(word.Documents.Count)
    except Exception:
        doc_count_before = 0

    pv_supported = hasattr(word, "ProtectedViewWindows")
    try:
        pv_count_before = int(word.ProtectedViewWindows.Count) if pv_supported else 0
    except Exception:
        pv_count_before = 0

    open_variants = [
        # Most robust in practice: try repair + no UI
        dict(
            FileName=abs_docx,
            ReadOnly=True,
            AddToRecentFiles=False,
            ConfirmConversions=False,
            OpenAndRepair=True,
        ),
        # Fewer args (some Word versions are picky)
        dict(
            FileName=abs_docx,
            ReadOnly=True,
            AddToRecentFiles=False,
        ),
        # Minimal
        dict(FileName=abs_docx),
    ]

    def _recover_doc_if_opened() -> Optional[object]:
        """If Word opened a document but COM didn't return it, recover it from Documents collection."""
        try:
            current = int(word.Documents.Count)
            if current > doc_count_before and current >= 1:
                return word.Documents(current)  # last opened
        except Exception:
            pass
        return None

    def _recover_from_protected_view() -> Tuple[Optional[object], Optional[object]]:
        """If a ProtectedViewWindow appeared, Edit() it to get a Document."""
        if not pv_supported:
            return None, None
        try:
            current_pv = int(word.ProtectedViewWindows.Count)
            if current_pv > pv_count_before and current_pv >= 1:
                pv = word.ProtectedViewWindows(current_pv)  # last PV window
                doc = pv.Edit()
                return doc, pv
        except Exception:
            pass
        return None, None

    # Try normal open variants
    for kwargs in open_variants:
        doc = None
        try:
            doc = word.Documents.Open(**kwargs)
        except Exception as e:
            last_exc = e
            doc = None

        # Some environments return None even when the doc actually opens.
        if doc is None:
            doc = _recover_doc_if_opened()

        if doc is None:
            doc, pv = _recover_from_protected_view()
            if doc is not None:
                return doc, pv, last_exc

        if doc is not None:
            return doc, None, last_exc

    # If still not opened, explicitly try Protected View open (common for MOTW files)
    if pv_supported:
        try:
            pv = word.ProtectedViewWindows.Open(abs_docx)
            doc = pv.Edit()
            return doc, pv, last_exc
        except Exception as e:
            last_exc = e

    return None, None, last_exc


def _is_pdf_file(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return f.read(5) == b"%PDF-"
    except Exception:
        return False


def _find_pdf_like_file(folder: Path) -> Optional[Path]:
    """Find a PDF-like file (PDF header) inside folder, including *.tmp leftovers."""
    try:
        candidates = list(folder.glob("*.pdf")) + list(folder.glob("*.tmp"))
    except Exception:
        return None
    candidates = [p for p in candidates if p.is_file()]
    try:
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    except Exception:
        pass
    for p in candidates:
        if _is_pdf_file(p):
            return p
    return None


def _win_long_path(p: Path) -> str:
    """Return a Windows long-path-safe string when needed."""
    s = str(p.resolve()).replace("/", "\\")
    if not s:
        return s
    if s.startswith("\\\\?\\"):
        return s
    # Word/Win32 can be picky; only apply when path is getting long.
    if len(s) >= 240:
        return "\\\\?\\" + s
    return s


def _safe_replace(src: Path, dst: Path) -> None:
    """Replace/move src -> dst robustly.

    - Uses os.replace when possible (atomic on same volume).
    - Falls back to copy+delete when moving across drives (Windows WinError 17 / POSIX EXDEV).
    - Applies long-path handling on Windows when needed.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)

    if os.name == "nt":
        s_src = _win_long_path(src)
        s_dst = _win_long_path(dst)
        try:
            os.replace(s_src, s_dst)
            return
        except OSError as e:
            # Cross-volume move (e.g., C: -> E:) cannot be done with os.replace/os.rename.
            if getattr(e, "winerror", None) == 17 or "different disk drive" in str(e).lower():
                # Ensure dst is clear, then copy+delete.
                try:
                    if dst.exists():
                        dst.unlink()
                except Exception:
                    pass
                shutil.copy2(s_src, s_dst)
                try:
                    os.remove(s_src)
                except Exception:
                    pass
                return
            raise
    else:
        try:
            os.replace(src, dst)
            return
        except OSError as e:
            # POSIX cross-device link error
            if getattr(e, "errno", None) == 18:  # EXDEV
                try:
                    if dst.exists():
                        dst.unlink()
                except Exception:
                    pass
                shutil.copy2(src, dst)
                try:
                    src.unlink()
                except Exception:
                    pass
                return
            raise



def export_docx_to_pdf(docx_path: Path, pdf_path: Path) -> None:
    """Export DOCX -> PDF using installed Microsoft Word (Windows).

    Why this fixes the intermittent *.tmp outputs:
      - Word/COM can silently fall back to writing a PDF payload into a *.tmp file
        (especially when the output path is long or contains edge-case characters).
      - Word is also more reliable when working on short paths.

    Strategy:
      1) Copy the source DOCX into a short temp folder.
      2) Export to a short temp PDF path.
      3) If Word produced a *.tmp instead, detect it by PDF header and recover it.
      4) Move the resulting PDF to the requested destination path.
    """
    try:
        import pythoncom  # type: ignore
        import win32com.client  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "pywin32 is required for PDF export. Install with: pip install pywin32"
        ) from e

    docx_path = Path(docx_path)
    pdf_path = Path(pdf_path)

    if os.name != "nt":
        raise RuntimeError("PDF export via Word is supported only on Windows.")

    if not docx_path.exists():
        raise FileNotFoundError(f"DOCX not found: {docx_path}")

    # Ensure destination folder exists
    pdf_path.parent.mkdir(parents=True, exist_ok=True)

    # Work on a short temp path to avoid Word/Win32 path limits
    work_dir = Path(tempfile.mkdtemp(prefix="docx2pdf_"))
    tmp_docx = work_dir / "src.docx"
    tmp_pdf = work_dir / "out.pdf"

    # Clean up any previous temp artifacts in this new folder (belt & suspenders)
    for p in (tmp_docx, tmp_pdf):
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass

    try:
        shutil.copy2(docx_path, tmp_docx)
    except Exception as e:
        # If copy fails (e.g., very long paths), surface a clear error.
        raise RuntimeError(f"Failed to stage DOCX for export: {e}") from e

    # Best-effort: remove Mark-of-the-web on the staged file
    _try_unblock_file_windows(str(tmp_docx))

    # Remove any existing destination PDF to avoid Word prompts
    try:
        if pdf_path.exists():
            pdf_path.unlink()
    except Exception:
        pass

    # COM init (must be per-thread)
    try:
        pythoncom.CoInitializeEx(pythoncom.COINIT_APARTMENTTHREADED)  # type: ignore[attr-defined]
    except Exception:
        pythoncom.CoInitialize()

    word = None
    doc = None
    pv = None

    try:
        dispatch_fn = getattr(win32com.client, "DispatchEx", win32com.client.Dispatch)
        word = dispatch_fn("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0

        # Reduce macro / protected prompts where possible
        try:
            # msoAutomationSecurityForceDisable = 3
            word.AutomationSecurity = 3
        except Exception:
            pass

        doc, pv, last_exc = _open_doc_in_word(word, str(tmp_docx.resolve()))

        if doc is None:
            details = f" Last error: {repr(last_exc)}" if last_exc is not None else ""
            raise RuntimeError(
                "Failed to open DOCX in Word for PDF export."
                " If this file came from the internet/email, try unblocking it "
                "(Right click → Properties → 'Unblock') and retry."
                + details
            )

        abs_tmp_pdf = str(tmp_pdf.resolve())

        # Prefer ExportAsFixedFormat; fall back to SaveAs(FileFormat=17)
        try:
            doc.ExportAsFixedFormat(OutputFileName=abs_tmp_pdf, ExportFormat=17)  # wdExportFormatPDF = 17
        except Exception:
            # wdFormatPDF = 17
            doc.SaveAs(abs_tmp_pdf, FileFormat=17)

        # Give Word a moment to flush (some builds return before the file finalizes)
        deadline = time.time() + 5.0
        while time.time() < deadline:
            if tmp_pdf.exists() and _is_pdf_file(tmp_pdf):
                break
            time.sleep(0.1)

        # Recover if Word wrote a PDF payload into a *.tmp instead of out.pdf
        if not (tmp_pdf.exists() and _is_pdf_file(tmp_pdf)):
            recovered = _find_pdf_like_file(work_dir)
            if recovered and recovered != tmp_pdf:
                try:
                    _safe_replace(recovered, tmp_pdf)
                except Exception:
                    # If replace fails, try a copy+remove
                    try:
                        shutil.copy2(recovered, tmp_pdf)
                        recovered.unlink(missing_ok=True)  # type: ignore[arg-type]
                    except Exception:
                        pass

        if not (tmp_pdf.exists() and _is_pdf_file(tmp_pdf)):
            raise RuntimeError(
                "Word did not produce a valid PDF. "
                "If you see a leftover *.tmp file, it may contain the PDF payload."
            )

        # Close without saving changes
        try:
            doc.Close(False)
        except Exception:
            pass
        doc = None

    finally:
        if pv is not None:
            try:
                pv.Close()
            except Exception:
                pass
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:
                pass
        if word is not None:
            try:
                word.Quit()
            except Exception:
                pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass

    # Move the validated PDF to its final destination
    try:
        _safe_replace(tmp_pdf, pdf_path)
    except Exception as e:
        raise RuntimeError(f"Failed to move PDF to destination: {e}") from e
    finally:
        # Clean temp folder
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
