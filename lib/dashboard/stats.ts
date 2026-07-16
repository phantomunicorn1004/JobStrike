import { normalizeStageDates } from "@/lib/jobs/pipelineCardUtils";
import { getDayKeyInTimeZone } from "@/lib/timezone";

export type ResumeApplicationRow = {
  applied_at: string;
};

export type PipelineJobRow = {
  created_at: string;
  stage_entered_at?: string | null;
  stage_dates?: unknown;
};

export type PipelineTechRow = PipelineJobRow & {
  stage_id?: string | null;
};

export type PipelineStageRow = {
  id: string;
  name: string;
  sort_order: number;
};

export type BidPoint = { date: string; count: number };

export type StageCount = {
  stageId: string;
  stageName: string;
  count: number;
};

export function localYmd(d = new Date(), timeZone?: string): string {
  return getDayKeyInTimeZone(d.toISOString(), timeZone || "UTC");
}

export function isoToDayKey(iso: string, timeZone: string): string {
  return getDayKeyInTimeZone(iso, timeZone);
}

export function isDayInRange(day: string, from: string, to: string): boolean {
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return localYmd(date);
}

export function countApplicationsOnDate(
  rows: ResumeApplicationRow[],
  date: string,
  timeZone: string,
): number {
  return rows.filter((row) => isoToDayKey(row.applied_at, timeZone) === date).length;
}

export function buildBidSeries(
  rows: ResumeApplicationRow[],
  from: string,
  to: string,
  timeZone: string,
): BidPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = isoToDayKey(row.applied_at, timeZone);
    if (!day || !isDayInRange(day, from, to)) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const series: BidPoint[] = [];
  let cursor = from;
  while (cursor <= to) {
    series.push({ date: cursor, count: counts.get(cursor) ?? 0 });
    cursor = addDaysYmd(cursor, 1);
  }
  return series;
}

function stageEntryDay(
  row: PipelineJobRow,
  stageId: string,
  timeZone: string,
): string {
  const fallback = row.stage_entered_at ?? row.created_at;
  const dates = normalizeStageDates(row.stage_dates, stageId, fallback);
  const iso = dates[stageId] ?? fallback;
  return isoToDayKey(iso, timeZone);
}

export function buildStageCounts(
  jobRows: PipelineJobRow[],
  techRows: PipelineTechRow[],
  stages: PipelineStageRow[],
  from: string,
  to: string,
  timeZone: string,
  appliedStageId = "applied",
): StageCount[] {
  const counts = new Map<string, number>();
  for (const stage of stages) {
    counts.set(stage.id, 0);
  }

  for (const row of jobRows) {
    const day = stageEntryDay(row, appliedStageId, timeZone);
    if (!isDayInRange(day, from, to)) continue;
    counts.set(appliedStageId, (counts.get(appliedStageId) ?? 0) + 1);
  }

  for (const row of techRows) {
    const stageId = row.stage_id ?? "technical";
    const day = stageEntryDay(row, stageId, timeZone);
    if (!isDayInRange(day, from, to)) continue;
    counts.set(stageId, (counts.get(stageId) ?? 0) + 1);
  }

  return stages
    .map((stage) => ({
      stageId: stage.id,
      stageName: stage.name,
      count: counts.get(stage.id) ?? 0,
    }))
    .filter((item) => item.count > 0);
}
