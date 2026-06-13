import type { ResumeDBColumnId } from "./useResizableColumns";

type ResumeDbRowForMeasure = {
  candidate: string;
  company: string;
  jobTitle: string;
  appliedAt: string;
  date: string;
};

export const COLUMN_ORDER: ResumeDBColumnId[] = [
  "select",
  "no",
  "profile",
  "jobLink",
  "company",
  "jobTitle",
  "resume",
  "coverLetter",
  "pipeline",
  "applied",
  "json",
  "actions",
];

export const COLUMN_HEADERS: Record<ResumeDBColumnId, string> = {
  select: "",
  no: "No",
  profile: "Profile",
  jobLink: "Job link",
  company: "Company",
  jobTitle: "Job title",
  resume: "Resume",
  coverLetter: "Cover letter",
  pipeline: "Pipeline",
  applied: "Applied",
  json: "JSON",
  actions: "Actions",
};

const FIXED_FIT_PX: Partial<Record<ResumeDBColumnId, number>> = {
  select: 44,
  no: 48,
  profile: 88,
  jobLink: 72,
  resume: 76,
  coverLetter: 88,
  pipeline: 88,
  json: 56,
  actions: 88,
};

let measureCanvas: CanvasRenderingContext2D | null = null;

function measureText(text: string, font = "600 12px system-ui, sans-serif"): number {
  if (typeof document === "undefined") return text.length * 7;
  if (!measureCanvas) {
    const canvas = document.createElement("canvas");
    measureCanvas = canvas.getContext("2d");
  }
  if (!measureCanvas) return text.length * 7;
  measureCanvas.font = font;
  return measureCanvas.measureText(text).width;
}

function formatAppliedShort(iso: string, fallback: string): string {
  if (!iso) return fallback || "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback || "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function measureColumnFitPx(
  columnId: ResumeDBColumnId,
  rows: ResumeDbRowForMeasure[],
): number {
  const fixed = FIXED_FIT_PX[columnId];
  if (fixed) return fixed + 20;

  const header = COLUMN_HEADERS[columnId];
  let max = measureText(header.toUpperCase(), "600 12px system-ui, sans-serif") + 28;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let text = "";
    switch (columnId) {
      case "profile":
        text = row.candidate || "—";
        break;
      case "company":
        text = row.company || "—";
        break;
      case "jobTitle":
        text = row.jobTitle || "—";
        break;
      case "jobLink":
        text = "Open";
        break;
      case "applied":
        text = formatAppliedShort(row.appliedAt, row.date);
        break;
      default:
        break;
    }
    if (text) {
      max = Math.max(max, measureText(text, "400 14px system-ui, sans-serif") + 20);
    }
  }

  return Math.ceil(max);
}

export function getNeighborColumnId(columnId: ResumeDBColumnId): ResumeDBColumnId | null {
  const idx = COLUMN_ORDER.indexOf(columnId);
  if (idx < 0 || idx >= COLUMN_ORDER.length - 1) return null;
  return COLUMN_ORDER[idx + 1];
}

/** Columns that absorb shrink/grow when another column is auto-fitted */
export const FLEX_COLUMN_IDS: ResumeDBColumnId[] = ["jobTitle", "company", "profile", "applied"];
