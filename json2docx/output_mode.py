from __future__ import annotations

from enum import Enum


class OutputMode(str, Enum):
    DOCX_ONLY = "docx"
    PDF_ONLY = "pdf"
    BOTH = "both"

    @classmethod
    def from_menu_choice(cls, choice: str) -> "OutputMode | None":
        return {
            "1": cls.DOCX_ONLY,
            "2": cls.PDF_ONLY,
            "3": cls.BOTH,
        }.get(choice)

    @classmethod
    def from_cli(cls, raw: str) -> "OutputMode":
        s = (raw or "").strip().lower()
        for mode in cls:
            if mode.value == s:
                return mode
        raise ValueError(f"Invalid output mode: {raw!r} (use docx, pdf, or both)")

    def label(self) -> str:
        return {
            OutputMode.DOCX_ONLY: "DOCX only",
            OutputMode.PDF_ONLY: "PDF only",
            OutputMode.BOTH: "DOCX + PDF",
        }[self]
