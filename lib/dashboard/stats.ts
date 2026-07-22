import { normalizeStageDates } from "@/lib/jobs/pipelineCardUtils";
import { getDayKeyInTimeZone, getHourInTimeZone } from "@/lib/timezone";

export type ResumeApplicationRow = {
  id?: number;
  applied_at: string;
  profile_id?: number | null;
  candidate_name?: string | null;
};

export type PipelineJobRow = {
  id?: number;
  name?: string | null;
  title?: string | null;
  company_name?: string | null;
  note?: string | null;
  created_at: string;
  stage_entered_at?: string | null;
  stage_dates?: unknown;
};

export type PipelineTechRow = PipelineJobRow & {
  stage_id?: string | null;
  job_description?: string | null;
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

export type HourlyActivityPoint = {
  hour: number;
  count: number;
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

export function filterApplicationsByCandidates(
  rows: ResumeApplicationRow[],
  candidateKeys?: Iterable<string> | null,
): ResumeApplicationRow[] {
  if (!candidateKeys) return rows;
  const allowed = candidateKeys instanceof Set ? candidateKeys : new Set(candidateKeys);
  if (allowed.size === 0) return rows;
  return rows.filter((row) => allowed.has(resolveCandidateKey(row)));
}

export function filterApplicationsByCandidate(
  rows: ResumeApplicationRow[],
  candidateFilter?: string | null,
): ResumeApplicationRow[] {
  const raw = candidateFilter?.trim();
  if (!raw) return rows;
  return filterApplicationsByCandidates(rows, [raw]);
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

export function pickStackedCandidateKeys(
  candidateCounts: CandidateCount[],
  maxSeries = 12,
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

export function buildHourlyActivity(
  rows: ResumeApplicationRow[],
  date: string,
  timeZone: string,
): HourlyActivityPoint[] {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    if (isoToDayKey(row.applied_at, timeZone) !== date) continue;
    const hour = getHourInTimeZone(row.applied_at, timeZone);
    if (hour < 0 || hour > 23) continue;
    counts[hour] += 1;
  }
  return counts.map((count, hour) => ({ hour, count }));
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

function parseResumeDbIds(text: string | null | undefined): number[] {
  if (!text) return [];
  const out: number[] = [];
  const re = /Resume DB #(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const id = Number(match[1]);
    if (!Number.isNaN(id)) out.push(id);
  }
  return out;
}

/**
 * Pipeline stage counts per candidate (via Resume DB markers), for line chart.
 * X = stage, series = candidate.
 */
export function buildPipelineCandidateStageSeries(
  jobRows: PipelineJobRow[],
  techRows: PipelineTechRow[],
  stages: PipelineStageRow[],
  applications: ResumeApplicationRow[],
  from: string,
  to: string,
  timeZone: string,
  profileLabels: Map<number, string> = new Map(),
  appliedStageId = "applied",
): {
  points: Array<Record<string, string | number>>;
  candidates: CandidateCount[];
  stageCounts: StageCount[];
} {
  const appById = new Map<number, ResumeApplicationRow>();
  for (const app of applications) {
    if (app.id != null) appById.set(app.id, app);
  }

  const candidateTotals = new Map<string, number>();
  const stageCandidateCounts = new Map<string, Map<string, number>>();
  for (const stage of stages) {
    stageCandidateCounts.set(stage.id, new Map());
  }
  const stageTotals = new Map<string, number>();
  for (const stage of stages) stageTotals.set(stage.id, 0);

  const bump = (stageId: string, candidateKey: string) => {
    if (!stageCandidateCounts.has(stageId)) return;
    const bucket = stageCandidateCounts.get(stageId)!;
    bucket.set(candidateKey, (bucket.get(candidateKey) ?? 0) + 1);
    candidateTotals.set(candidateKey, (candidateTotals.get(candidateKey) ?? 0) + 1);
    stageTotals.set(stageId, (stageTotals.get(stageId) ?? 0) + 1);
  };

  for (const row of jobRows) {
    const day = stageEntryDay(row, appliedStageId, timeZone);
    if (!isDayInRange(day, from, to)) continue;
    const ids = parseResumeDbIds(row.note);
    if (ids.length === 0) {
      bump(appliedStageId, UNASSIGNED_CANDIDATE_KEY);
      continue;
    }
    for (const id of ids) {
      const app = appById.get(id);
      bump(appliedStageId, app ? resolveCandidateKey(app) : UNASSIGNED_CANDIDATE_KEY);
    }
  }

  for (const row of techRows) {
    const stageId = row.stage_id ?? "technical";
    const day = stageEntryDay(row, stageId, timeZone);
    if (!isDayInRange(day, from, to)) continue;
    const ids = parseResumeDbIds(row.job_description);
    if (ids.length === 0) {
      bump(stageId, UNASSIGNED_CANDIDATE_KEY);
      continue;
    }
    for (const id of ids) {
      const app = appById.get(id);
      bump(stageId, app ? resolveCandidateKey(app) : UNASSIGNED_CANDIDATE_KEY);
    }
  }

  const candidates = Array.from(candidateTotals.entries())
    .map(([key, count]) => ({
      key,
      label: resolveCandidateLabel(key, profileLabels),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const seriesCandidates = pickStackedCandidateKeys(candidates);
  const allowed = new Set(seriesCandidates.map((c) => c.key));
  const hasOther = allowed.has(OTHER_CANDIDATE_KEY);

  const points = stages.map((stage) => {
    const bucket = stageCandidateCounts.get(stage.id) ?? new Map();
    const point: Record<string, string | number> = {
      stageId: stage.id,
      stageName: stage.name,
      total: stageTotals.get(stage.id) ?? 0,
    };
    for (const candidate of seriesCandidates) {
      point[candidate.key] = 0;
    }
    for (const [key, count] of bucket.entries()) {
      if (allowed.has(key)) {
        point[key] = Number(point[key] ?? 0) + count;
      } else if (hasOther) {
        point[OTHER_CANDIDATE_KEY] =
          Number(point[OTHER_CANDIDATE_KEY] ?? 0) + count;
      }
    }
    return point;
  });

  const stageCounts = stages
    .map((stage) => ({
      stageId: stage.id,
      stageName: stage.name,
      count: stageTotals.get(stage.id) ?? 0,
    }))
    .filter((item) => item.count > 0);

  return { points, candidates: seriesCandidates, stageCounts };
}
