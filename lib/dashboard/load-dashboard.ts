import "server-only";

import type { SessionUser } from "@/lib/auth/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { countApplicationsWithFilters } from "@/lib/resume-db/repository";
import { listJobScraperCandidates } from "@/lib/job-scraper-repository";
import { colorForCandidateKey } from "@/lib/dashboard/candidate-colors";
import {
  listApplicationCandidateKeysForDashboard,
  listApplicationsForDashboardRange,
  listPipelineJobsForDashboard,
  listTechnicalJobsForDashboard,
} from "@/lib/dashboard/repository";
import {
  addDaysYmd,
  buildBidSeries,
  buildCandidateCounts,
  buildHourlyActivity,
  buildPipelineCandidateStageSeries,
  buildStackedBidSeries,
  countApplicationsOnDate,
  isoToDayKey,
  localYmd,
  pickStackedCandidateKeys,
  type PipelineStageRow,
  type ResumeApplicationRow,
} from "@/lib/dashboard/stats";
import { normalizeTimeZone } from "@/lib/timezone";

export type DashboardRangeMode = "week" | "month" | "custom";

export type DashboardData = {
  timezone: string;
  today: string;
  rangeMode: DashboardRangeMode;
  appliedDate: string;
  appliedCount: number;
  appliedCountByCandidate: Array<{
    key: string;
    label: string;
    count: number;
    color?: string;
  }>;
  appliedInBidRange: number;
  bidsStackedByDate: Array<Record<string, string | number>>;
  bidSeriesCandidates: Array<{
    key: string;
    label: string;
    count: number;
    color?: string;
  }>;
  bidFrom: string;
  bidTo: string;
  activityDate: string;
  hourlyActivity: Array<{ hour: number; count: number }>;
  stageCounts: Array<{ stageId: string; stageName: string; count: number }>;
  pipelineByStage: Array<Record<string, string | number>>;
  pipelineSeriesCandidates: Array<{
    key: string;
    label: string;
    count: number;
    color?: string;
  }>;
  totalApplications: number;
  totalApplicationsAll: number;
  applicationsByCandidate: Array<{
    key: string;
    label: string;
    count: number;
    color?: string;
  }>;
  candidates: Array<{ key: string; label: string; color?: string }>;
  userId: string;
};

export type LoadDashboardParams = {
  rangeMode?: string | null;
  bidDays?: string | null;
  bidFrom?: string | null;
  bidTo?: string | null;
  activityDate?: string | null;
  date?: string | null;
};

function parseYmd(value: string | null | undefined, fallback: string): string {
  const raw = value?.trim() || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function mergeApplicationRows(
  ...lists: ResumeApplicationRow[][]
): ResumeApplicationRow[] {
  const byId = new Map<number, ResumeApplicationRow>();
  const withoutId: ResumeApplicationRow[] = [];
  for (const list of lists) {
    for (const row of list) {
      if (row.id != null) byId.set(row.id, row);
      else withoutId.push(row);
    }
  }
  return [...byId.values(), ...withoutId];
}

/** Shared dashboard payload for RSC pages and /api/dashboard. */
export async function loadDashboardData(
  user: SessionUser,
  params: LoadDashboardParams = {},
): Promise<DashboardData> {
  const timezone = normalizeTimeZone(user.timezone);
  const today = localYmd(new Date(), timezone);
  const rangeModeRaw = (params.rangeMode || "month").trim();
  const bidDays =
    rangeModeRaw === "week"
      ? 7
      : Math.min(90, Math.max(7, Number(params.bidDays ?? 30) || 30));

  let bidTo = parseYmd(params.bidTo, today);
  let bidFrom = parseYmd(params.bidFrom, addDaysYmd(bidTo, -(bidDays - 1)));
  if (rangeModeRaw === "week") {
    bidTo = today;
    bidFrom = addDaysYmd(today, -6);
  } else if (rangeModeRaw === "month") {
    bidTo = today;
    bidFrom = addDaysYmd(today, -29);
  }
  if (bidFrom > bidTo) {
    const swap = bidFrom;
    bidFrom = bidTo;
    bidTo = swap;
  }

  const activityDateParam = params.activityDate?.trim() || "";
  const appliedDateParam = params.date?.trim() || "";

  const supabase = getSupabaseAdminClient();
  const [
    applicationsInRange,
    allCandidateRows,
    totalApplicationsAll,
    jobs,
    techJobs,
    stagesRes,
    candidates,
  ] = await Promise.all([
    listApplicationsForDashboardRange(user.id, bidFrom, bidTo, timezone),
    listApplicationCandidateKeysForDashboard(user.id),
    countApplicationsWithFilters(user.id, {}),
    listPipelineJobsForDashboard(user.id),
    listTechnicalJobsForDashboard(user.id),
    supabase
      .from("pipeline_stages")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true }),
    listJobScraperCandidates(user.id),
  ]);

  let stages = (stagesRes.data ?? []) as PipelineStageRow[];
  if (stagesRes.error || stages.length === 0) {
    stages = [
      { id: "applied", name: "Applied", sort_order: 0 },
      { id: "technical", name: "Technical", sort_order: 1 },
      { id: "final", name: "Final", sort_order: 2 },
    ];
  }

  const profileLabels = new Map<number, string>();
  for (const candidate of candidates) {
    if (!candidate.key.startsWith("profile-")) continue;
    const id = Number(candidate.key.slice(8));
    if (!Number.isNaN(id)) profileLabels.set(id, candidate.label);
  }

  const applicationsByCandidate = buildCandidateCounts(
    allCandidateRows,
    profileLabels,
  );
  const seriesCandidates = pickStackedCandidateKeys(applicationsByCandidate);

  let activityDate = activityDateParam || today;
  if (!activityDateParam) {
    const todayCount = countApplicationsOnDate(
      applicationsInRange,
      today,
      timezone,
    );
    if (todayCount === 0 && allCandidateRows.length > 0) {
      let latest = "";
      for (const row of allCandidateRows) {
        const day = isoToDayKey(row.applied_at, timezone);
        if (day && day > latest) latest = day;
      }
      if (latest) activityDate = latest;
    }
  }

  const appliedDate = appliedDateParam || activityDate;

  let applicationsForCharts = applicationsInRange;
  const needExtraDays = [activityDate, appliedDate].filter(
    (d) => d && (d < bidFrom || d > bidTo),
  );
  if (needExtraDays.length) {
    const extraFrom = needExtraDays.reduce((a, b) => (a < b ? a : b));
    const extraTo = needExtraDays.reduce((a, b) => (a > b ? a : b));
    const extra = await listApplicationsForDashboardRange(
      user.id,
      extraFrom,
      extraTo,
      timezone,
    );
    applicationsForCharts = mergeApplicationRows(applicationsInRange, extra);
  }

  const appliedDateRows = applicationsForCharts.filter(
    (row) => isoToDayKey(row.applied_at, timezone) === appliedDate,
  );

  const bidsByDate = buildBidSeries(
    applicationsForCharts,
    bidFrom,
    bidTo,
    timezone,
  );
  const appliedInBidRange = bidsByDate.reduce(
    (sum, point) => sum + point.count,
    0,
  );

  const pipelineSeries = buildPipelineCandidateStageSeries(
    jobs,
    techJobs,
    stages,
    allCandidateRows,
    bidFrom,
    bidTo,
    timezone,
    profileLabels,
  );

  const candidatesWithColor = candidates.map((candidate) => ({
    ...candidate,
    color: colorForCandidateKey(candidate.key),
  }));
  for (const item of applicationsByCandidate) {
    if (candidatesWithColor.some((c) => c.key === item.key)) continue;
    candidatesWithColor.push({
      key: item.key,
      label: item.label,
      color: colorForCandidateKey(item.key),
    });
  }

  return {
    timezone,
    today,
    rangeMode:
      rangeModeRaw === "week" || rangeModeRaw === "custom"
        ? rangeModeRaw
        : "month",
    appliedDate,
    appliedCount: countApplicationsOnDate(
      applicationsForCharts,
      appliedDate,
      timezone,
    ),
    appliedCountByCandidate: buildCandidateCounts(
      appliedDateRows,
      profileLabels,
    ),
    appliedInBidRange,
    bidsStackedByDate: buildStackedBidSeries(
      applicationsForCharts,
      bidFrom,
      bidTo,
      timezone,
      seriesCandidates,
    ),
    bidSeriesCandidates: seriesCandidates.map((c) => ({
      ...c,
      color: colorForCandidateKey(c.key),
    })),
    bidFrom,
    bidTo,
    activityDate,
    hourlyActivity: buildHourlyActivity(
      applicationsForCharts,
      activityDate,
      timezone,
    ),
    stageCounts: pipelineSeries.stageCounts,
    pipelineByStage: pipelineSeries.points,
    pipelineSeriesCandidates: pipelineSeries.candidates.map((c) => ({
      ...c,
      color: colorForCandidateKey(c.key),
    })),
    totalApplications: totalApplicationsAll,
    totalApplicationsAll,
    applicationsByCandidate: applicationsByCandidate.map((c) => ({
      ...c,
      color: colorForCandidateKey(c.key),
    })),
    candidates: candidatesWithColor,
    userId: user.id,
  };
}
