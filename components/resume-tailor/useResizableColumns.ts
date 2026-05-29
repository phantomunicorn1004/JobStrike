"use client";

import { useCallback, useEffect, useState } from "react";

export const RESUME_DB_COLUMN_DEFAULTS = {
  select: 44,
  no: 52,
  jobLink: 96,
  company: 132,
  jobTitle: 220,
  resume: 92,
  coverLetter: 112,
  pipeline: 100,
  applied: 156,
  json: 64,
  actions: 92,
} as const;

export type ResumeDBColumnId = keyof typeof RESUME_DB_COLUMN_DEFAULTS;

export const RESUME_DB_COLUMN_MIN: Record<ResumeDBColumnId, number> = {
  select: 40,
  no: 44,
  jobLink: 72,
  company: 88,
  jobTitle: 120,
  resume: 76,
  coverLetter: 88,
  pipeline: 80,
  applied: 120,
  json: 52,
  actions: 72,
};

const STORAGE_KEY = "resume-db-column-widths";

export function useResizableColumns() {
  const [widths, setWidths] = useState<Record<ResumeDBColumnId, number>>(() => ({
    ...RESUME_DB_COLUMN_DEFAULTS,
  }));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<ResumeDBColumnId, number>>;
      setWidths((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(RESUME_DB_COLUMN_DEFAULTS) as ResumeDBColumnId[]) {
          const value = parsed[key];
          if (typeof value === "number" && value >= RESUME_DB_COLUMN_MIN[key]) {
            next[key] = value;
          }
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  }, []);

  const setColumnWidth = useCallback((id: ResumeDBColumnId, width: number) => {
    setWidths((prev) => {
      const next = {
        ...prev,
        [id]: Math.max(RESUME_DB_COLUMN_MIN[id], Math.round(width)),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetWidths = useCallback(() => {
    setWidths({ ...RESUME_DB_COLUMN_DEFAULTS });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { widths, setColumnWidth, resetWidths };
}
