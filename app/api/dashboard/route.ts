import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
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

export function OPTIONS() {
  return corsOptions();
}

function parseYmd(value: string | null, fallback: string): string {
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

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }
    const timezone = normalizeTimeZone(user.timezone);

    const { searchParams } = new URL(request.url);
    const today = localYmd(new Date(), timezone);
    const rangeMode = (searchParams.get("rangeMode") || "month").trim();
    const bidDays =
      rangeMode === "week"
        ? 7
        : Math.min(90, Math.max(7, Number(searchParams.get("bidDays") ?? 30) || 30));

    let bidTo = parseYmd(searchParams.get("bidTo"), today);
    let bidFrom = parseYmd(
      searchParams.get("bidFrom"),
      addDaysYmd(bidTo, -(bidDays - 1)),
    );
    if (rangeMode === "week") {
      bidTo = today;
      bidFrom = addDaysYmd(today, -6);
    } else if (rangeMode === "month") {
      bidTo = today;
      bidFrom = addDaysYmd(today, -29);
    }
    if (bidFrom > bidTo) {
      const swap = bidFrom;
      bidFrom = bidTo;
      bidTo = swap;
    }

    const activityDateParam = searchParams.get("activityDate")?.trim() || "";
    const appliedDateParam = searchParams.get("date")?.trim() || "";

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

    // Ensure activity/applied day rows are present even if outside bid range.
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
    const appliedInBidRange = bidsByDate.reduce((sum, point) => sum + point.count, 0);

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

    return corsJson({
      timezone,
      today,
      rangeMode: rangeMode === "week" || rangeMode === "custom" ? rangeMode : "month",
      appliedDate,
      appliedCount: countApplicationsOnDate(
        applicationsForCharts,
        appliedDate,
        timezone,
      ),
      appliedCountByCandidate: buildCandidateCounts(appliedDateRows, profileLabels),
      appliedInBidRange,
      bidsByDate,
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
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard.";
    return corsJson({ error: message }, { status: 500 });
  }
}
