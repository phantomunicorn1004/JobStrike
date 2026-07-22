import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { countApplicationsWithFilters } from "@/lib/resume-db/repository";
import { listJobScraperCandidates } from "@/lib/job-scraper-repository";
import {
  listAllApplicationsForDashboard,
  listAllPipelineJobsForDashboard,
  listAllTechnicalJobsForDashboard,
} from "@/lib/dashboard/repository";
import {
  addDaysYmd,
  buildBidSeries,
  buildCandidateCounts,
  buildStackedBidSeries,
  buildStageCounts,
  countApplicationsOnDate,
  filterApplicationsByCandidate,
  isoToDayKey,
  localYmd,
  pickStackedCandidateKeys,
  type PipelineStageRow,
  type PipelineJobRow,
  type PipelineTechRow,
} from "@/lib/dashboard/stats";
import { normalizeTimeZone } from "@/lib/timezone";

export function OPTIONS() {
  return corsOptions();
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
    const dateParam = searchParams.get("date")?.trim() || "";
    const candidateFilter = searchParams.get("candidateFilter")?.trim() || "";
    const bidDays = Math.min(
      90,
      Math.max(7, Number(searchParams.get("bidDays") ?? 30) || 30),
    );
    const stageFromParam = searchParams.get("stageFrom")?.trim() || "";
    const stageToParam = searchParams.get("stageTo")?.trim() || "";

    const supabase = getSupabaseAdminClient();
    const [
      applications,
      totalApplicationsAll,
      jobs,
      techJobs,
      stagesRes,
      candidates,
    ] = await Promise.all([
      listAllApplicationsForDashboard(user.id),
      countApplicationsWithFilters(user.id, {}),
      listAllPipelineJobsForDashboard(user.id),
      listAllTechnicalJobsForDashboard(user.id),
      supabase
        .from("pipeline_stages")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true }),
      listJobScraperCandidates(user.id),
    ]);

    const typedJobs = jobs as PipelineJobRow[];
    const typedTechJobs = techJobs as PipelineTechRow[];

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

    const filteredApplications = filterApplicationsByCandidate(
      applications,
      candidateFilter,
    );

    const bidTo = today;
    const bidFrom = addDaysYmd(today, -(bidDays - 1));

    // Prefer an explicit date; otherwise use today, or the most recent day with
    // applications if today has none (avoids a misleading 0 right after midnight).
    let appliedDate = dateParam || today;
    if (!dateParam) {
      const todayCount = countApplicationsOnDate(filteredApplications, today, timezone);
      if (todayCount === 0 && filteredApplications.length > 0) {
        let latest = "";
        for (const row of filteredApplications) {
          const day = isoToDayKey(row.applied_at, timezone);
          if (day && day > latest) latest = day;
        }
        if (latest) appliedDate = latest;
      }
    }

    const stageFrom = stageFromParam || addDaysYmd(today, -(bidDays - 1));
    const stageTo = stageToParam || today;

    const applicationsByCandidate = buildCandidateCounts(applications, profileLabels);
    const appliedDateRows = filteredApplications.filter(
      (row) => isoToDayKey(row.applied_at, timezone) === appliedDate,
    );
    const appliedCountByCandidate = buildCandidateCounts(appliedDateRows, profileLabels);

    const seriesCandidates = pickStackedCandidateKeys(
      candidateFilter
        ? buildCandidateCounts(filteredApplications, profileLabels)
        : applicationsByCandidate,
    );

    const totalApplications = candidateFilter
      ? await countApplicationsWithFilters(user.id, { candidateFilter })
      : totalApplicationsAll;

    const bidsByDate = buildBidSeries(filteredApplications, bidFrom, bidTo, timezone);
    const appliedInBidRange = bidsByDate.reduce((sum, point) => sum + point.count, 0);

    const stageCounts = buildStageCounts(
      typedJobs,
      typedTechJobs,
      stages,
      stageFrom,
      stageTo,
      timezone,
      "applied",
      false,
    );

    return corsJson({
      appliedDate,
      appliedCount: countApplicationsOnDate(filteredApplications, appliedDate, timezone),
      appliedCountByCandidate,
      appliedInBidRange,
      bidsByDate,
      bidsStackedByDate: buildStackedBidSeries(
        filteredApplications,
        bidFrom,
        bidTo,
        timezone,
        seriesCandidates,
      ),
      bidSeriesCandidates: seriesCandidates,
      bidFrom,
      bidTo,
      stageCounts,
      stageFrom,
      stageTo,
      timezone,
      totalApplications,
      totalApplicationsAll,
      applicationsByCandidate,
      candidates,
      candidateFilter: candidateFilter || null,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard.";
    return corsJson({ error: message }, { status: 500 });
  }
}
