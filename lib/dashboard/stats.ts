import { normalizeStageDates } from "@/lib/jobs/pipelineCardUtils";
import { getDayKeyInTimeZone } from "@/lib/timezone";

export type ResumeApplicationRow = {
  applied_at: string;
  profile_id?: number | null;
  candidate_name?: string | null;
};

export type PipelineJobRow = {
  id?: number;
  name?: string | null;
  title?: string | null;
  company_name?: string | null;
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

export type CandidateCount = {
  key: string;
  label: string;
  count: number;
};

export type StalePipelineCard = {
  id: number;
  source: "jobs" | "technical_jobs";
  title: string;
  companyName: string;
  stageId: string;
  stageName: string;
  daysInStage: number;
  enteredAt: string;
};

export const UNASSIGNED_CANDIDATE_KEY = "unassigned";
export const OTHER_CANDIDATE_KEY = "other";

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
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + delta);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveCandidateKey(row: ResumeApplicationRow): string {
  if (row.profile_id != null && Number.isFinite(Number(row.profile_id))) {
    return `profile-${row.profile_id}`;
  }
  const name = row.candidate_name?.trim();
  if (name) return `name-${encodeURIComponent(name)}`;
  return UNASSIGNED_CANDIDATE_KEY;
}

export function resolveCandidateLabel(
  key: string,
  profileLabels: Map<number, string> = new Map(),
): string {
  if (key === UNASSIGNED_CANDIDATE_KEY) return "Unassigned";
  if (key === OTHER_CANDIDATE_KEY) return "Other";
  if (key.startsWith("profile-")) {
    const id = Number(key.slice(8));
    return profileLabels.get(id) ?? `Profile ${id}`;
  }
  if (key.startsWith("name-")) {
    try {
      return decodeURIComponent(key.slice(5));
    } catch {
      return key.slice(5);
    }
  }
  return key;
}

export function filterApplicationsByCandidate(
  rows: ResumeApplicationRow[],
  candidateFilter?: string | null,
): ResumeApplicationRow[] {
  const raw = candidateFilter?.trim();
  if (!raw) return rows;
  return rows.filter((row) => resolveCandidateKey(row) === raw);
}

export function countApplicationsOnDate(
  rows: ResumeApplicationRow[],
  date: string,
  timeZone: string,
): number {
  return rows.filter((row) => isoToDayKey(row.applied_at, timeZone) === date).length;
}

export function buildCandidateCounts(
  rows: ResumeApplicationRow[],
  profileLabels: Map<number, string> = new Map(),
): CandidateCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = resolveCandidateKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      label: resolveCandidateLabel(key, profileLabels),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
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

/** Top N candidates keep their own series; the rest roll into "other". */
export function pickStackedCandidateKeys(
  candidateCounts: CandidateCount[],
  maxSeries = 8,
): CandidateCount[] {
  if (candidateCounts.length <= maxSeries) return candidateCounts;
  const top = candidateCounts.slice(0, maxSeries - 1);
  const otherCount = candidateCounts
    .slice(maxSeries - 1)
    .reduce((sum, item) => sum + item.count, 0);
  return [
    ...top,
    { key: OTHER_CANDIDATE_KEY, label: "Other", count: otherCount },
  ];
}

export function buildStackedBidSeries(
  rows: ResumeApplicationRow[],
  from: string,
  to: string,
  timeZone: string,
  seriesCandidates: CandidateCount[],
): Array<Record<string, string | number>> {
  const allowed = new Set(seriesCandidates.map((c) => c.key));
  const hasOther = allowed.has(OTHER_CANDIDATE_KEY);
  const dayMaps = new Map<string, Map<string, number>>();

  let cursor = from;
  while (cursor <= to) {
    const empty = new Map<string, number>();
    for (const candidate of seriesCandidates) empty.set(candidate.key, 0);
    dayMaps.set(cursor, empty);
    cursor = addDaysYmd(cursor, 1);
  }

  for (const row of rows) {
    const day = isoToDayKey(row.applied_at, timeZone);
    if (!day || !isDayInRange(day, from, to)) continue;
    const bucket = dayMaps.get(day);
    if (!bucket) continue;
    let key = resolveCandidateKey(row);
    if (!allowed.has(key)) {
      if (!hasOther) continue;
      key = OTHER_CANDIDATE_KEY;
    }
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }

  const points: Array<Record<string, string | number>> = [];
  cursor = from;
  while (cursor <= to) {
    const bucket = dayMaps.get(cursor) ?? new Map();
    const point: Record<string, string | number> = { date: cursor, total: 0 };
    for (const candidate of seriesCandidates) {
      const value = bucket.get(candidate.key) ?? 0;
      point[candidate.key] = value;
      point.total = Number(point.total) + value;
    }
    points.push(point);
    cursor = addDaysYmd(cursor, 1);
  }
  return points;
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
  includeEmpty = false,
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
    .filter((item) => includeEmpty || item.count > 0);
}

function daysBetweenIsoAndToday(iso: string, timeZone: string, today: string): number {
  const enteredDay = isoToDayKey(iso, timeZone);
  if (!enteredDay) return 0;
  const start = new Date(`${enteredDay}T12:00:00`);
  const end = new Date(`${today}T12:00:00`);
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

export function buildStalePipelineCards(
  jobRows: PipelineJobRow[],
  techRows: PipelineTechRow[],
  stages: PipelineStageRow[],
  timeZone: string,
  staleAfterDays = 7,
  limit = 8,
): StalePipelineCard[] {
  const today = localYmd(new Date(), timeZone);
  const stageNameById = new Map(stages.map((stage) => [stage.id, stage.name]));
  const items: StalePipelineCard[] = [];

  for (const row of jobRows) {
    const enteredAt = row.stage_entered_at ?? row.created_at;
    const daysInStage = daysBetweenIsoAndToday(enteredAt, timeZone, today);
    if (daysInStage < staleAfterDays) continue;
    items.push({
      id: row.id ?? 0,
      source: "jobs",
      title: (row.title || row.name || "Untitled").trim() || "Untitled",
      companyName: (row.company_name || "").trim() || "—",
      stageId: "applied",
      stageName: stageNameById.get("applied") ?? "Applied",
      daysInStage,
      enteredAt,
    });
  }

  for (const row of techRows) {
    const stageId = row.stage_id ?? "technical";
    const enteredAt = row.stage_entered_at ?? row.created_at;
    const daysInStage = daysBetweenIsoAndToday(enteredAt, timeZone, today);
    if (daysInStage < staleAfterDays) continue;
    items.push({
      id: row.id ?? 0,
      source: "technical_jobs",
      title: (row.title || row.name || "Untitled").trim() || "Untitled",
      companyName: (row.company_name || "").trim() || "—",
      stageId,
      stageName: stageNameById.get(stageId) ?? stageId,
      daysInStage,
      enteredAt,
    });
  }

  return items
    .sort((a, b) => b.daysInStage - a.daysInStage || a.title.localeCompare(b.title))
    .slice(0, limit);
}
