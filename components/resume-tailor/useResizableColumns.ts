"use client";

import { useCallback, useEffect, useState } from "react";
import { COLUMN_ORDER } from "./resumeDbTableConfig";

export const RESUME_DB_COLUMN_DEFAULTS = {
  select: 44,
  no: 52,
  profile: 120,
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

export const RESUME_DB_COLUMN_MIN_PERCENT: Record<ResumeDBColumnId, number> = {
  select: 3,
  no: 3.5,
  profile: 5,
  jobLink: 5,
  company: 6,
  jobTitle: 8,
  resume: 5.5,
  coverLetter: 6.5,
  pipeline: 6,
  applied: 8,
  json: 4,
  actions: 5.5,
};

const STORAGE_KEY = "resume-db-column-widths-v3";

function defaultsToPercent(): Record<ResumeDBColumnId, number> {
  const total = COLUMN_ORDER.reduce((sum, id) => sum + RESUME_DB_COLUMN_DEFAULTS[id], 0);
  const percents = {} as Record<ResumeDBColumnId, number>;
  let assigned = 0;
  COLUMN_ORDER.forEach((id, index) => {
    if (index === COLUMN_ORDER.length - 1) {
      percents[id] = Math.max(RESUME_DB_COLUMN_MIN_PERCENT[id], 100 - assigned);
    } else {
      const value =
        Math.round((RESUME_DB_COLUMN_DEFAULTS[id] / total) * 1000) / 10;
      percents[id] = value;
      assigned += value;
    }
  });
  return percents;
}

function normalizeStoredPercents(
  raw: Partial<Record<ResumeDBColumnId, number>>,
): Record<ResumeDBColumnId, number> {
  const values = COLUMN_ORDER.map((id) => raw[id]).filter(
    (v): v is number => typeof v === "number" && v > 0,
  );
  const sum = values.reduce((a, b) => a + b, 0);

  // Legacy pixel widths (sum > 100)
  if (sum > 100.5) {
    const total = COLUMN_ORDER.reduce((s, id) => s + (raw[id] ?? 0), 0);
    const percents = {} as Record<ResumeDBColumnId, number>;
    let assigned = 0;
    COLUMN_ORDER.forEach((id, index) => {
      if (index === COLUMN_ORDER.length - 1) {
        percents[id] = 100 - assigned;
      } else {
        const value =
          Math.round(((raw[id] ?? RESUME_DB_COLUMN_DEFAULTS[id]) / total) * 1000) /
          10;
        percents[id] = value;
        assigned += value;
      }
    });
    return percents;
  }

  if (Math.abs(sum - 100) < 0.5) {
    return raw as Record<ResumeDBColumnId, number>;
  }

  return defaultsToPercent();
}

function persistPercents(percents: Record<ResumeDBColumnId, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(percents));
  } catch {
    /* ignore */
  }
}

export function useResizableColumns() {
  const [percents, setPercents] = useState<Record<ResumeDBColumnId, number>>(
    defaultsToPercent,
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setPercents(normalizeStoredPercents(JSON.parse(raw)));
        return;
      }
      const legacy = localStorage.getItem("resume-db-column-widths");
      if (legacy) {
        setPercents(normalizeStoredPercents(JSON.parse(legacy)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const resizePair = useCallback(
    (leftId: ResumeDBColumnId, rightId: ResumeDBColumnId, leftPercent: number) => {
      setPercents((prev) => {
        const rightPercent = prev[leftId] + prev[rightId] - leftPercent;
        if (
          leftPercent < RESUME_DB_COLUMN_MIN_PERCENT[leftId] ||
          rightPercent < RESUME_DB_COLUMN_MIN_PERCENT[rightId]
        ) {
          return prev;
        }
        const next = {
          ...prev,
          [leftId]: Math.round(leftPercent * 10) / 10,
          [rightId]: Math.round(rightPercent * 10) / 10,
        };
        persistPercents(next);
        return next;
      });
    },
    [],
  );

  const fitColumn = useCallback(
    (
      columnId: ResumeDBColumnId,
      targetPercent: number,
      flexIds: ResumeDBColumnId[],
    ) => {
      setPercents((prev) => {
        const min = RESUME_DB_COLUMN_MIN_PERCENT[columnId];
        const nextTarget = Math.max(min, Math.min(targetPercent, 45));
        const delta = nextTarget - prev[columnId];
        if (Math.abs(delta) < 0.05) return prev;

        const donors = flexIds.filter((id) => id !== columnId && prev[id] > RESUME_DB_COLUMN_MIN_PERCENT[id]);
        if (donors.length === 0) return prev;

        const next = { ...prev, [columnId]: nextTarget };
        let remaining = -delta;
        const donorTotal = donors.reduce((sum, id) => sum + prev[id], 0);

        for (const donorId of donors) {
          const share = (prev[donorId] / donorTotal) * remaining;
          const newVal = Math.max(
            RESUME_DB_COLUMN_MIN_PERCENT[donorId],
            next[donorId] + share,
          );
          remaining -= newVal - next[donorId];
          next[donorId] = Math.round(newVal * 10) / 10;
        }

        next[columnId] = Math.round(nextTarget * 10) / 10;
        const sum = COLUMN_ORDER.reduce((s, id) => s + next[id], 0);
        const drift = 100 - sum;
        if (Math.abs(drift) > 0.01) {
          const lastFlex = donors[donors.length - 1] ?? columnId;
          next[lastFlex] = Math.round((next[lastFlex] + drift) * 10) / 10;
        }

        persistPercents(next);
        return next;
      });
    },
    [],
  );

  const resetWidths = useCallback(() => {
    const next = defaultsToPercent();
    setPercents(next);
    persistPercents(next);
  }, []);

  return { percents, resizePair, fitColumn, resetWidths };
}
