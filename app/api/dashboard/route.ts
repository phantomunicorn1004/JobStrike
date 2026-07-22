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
  addDaysYmd,
  buildBidSeries,
  buildCandidateCounts,
  buildStackedBidSeries,
  buildStageCounts,
  buildStalePipelineCards,
  countApplicationsOnDate,
  filterApplicationsByCandidate,
  isoToDayKey,
  localYmd,
  pickStackedCandidateKeys,
  type PipelineStageRow,
  type PipelineJobRow,
  type PipelineTechRow,
  type ResumeApplicationRow,
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
    const appliedDate = searchParams.get("date") || today;
    const candidateFilter = searchParams.get("candidateFilter")?.trim() || "";
    const bidDays = Math.min(
      90,
      Math.max(7, Number(searchParams.get("bidDays") ?? 30) || 30),
    );
    const stageFrom =
      searchParams.get("stageFrom") || addDaysYmd(today, -(bidDays - 1));
    const stageTo = searchParams.get("stageTo") || today;

    const supabase = getSupabaseAdminClient();
    const [
      applicationsRes,
      totalApplicationsAll,
      jobsRes,
      techRes,
      stagesRes,
      candidates,
    ] = await Promise.all([
      supabase
        .from("resume_db_applications")
        .select("applied_at, profile_id, candidate_name")
        .eq("user_id", user.id),
      countApplicationsWithFilters(user.id, {}),
      supabase
        .from("jobs")
        .select("id, name, title, company_name, created_at, stage_entered_at, stage_dates")
        .eq("user_id", user.id),
      supabase
        .from("technical_jobs")
        .select(
          "id, name, title, company_name, created_at, stage_entered_at, stage_dates, stage_id",
        )
        .eq("user_id", user.id),
      supabase
        .from("pipeline_stages")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true }),
      listJobScraperCandidates(user.id),
    ]);

    if (applicationsRes.error) throw applicationsRes.error;
    if (jobsRes.error) throw jobsRes.error;
    if (techRes.error) throw techRes.error;

    const applications = (applicationsRes.data ?? []) as ResumeApplicationRow[];
    const jobs = (jobsRes.data ?? []) as PipelineJobRow[];
    const techJobs = (techRes.data ?? []) as PipelineTechRow[];

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

    const bidTo = today;
    const bidFrom = addDaysYmd(today, -(bidDays - 1));

    const totalApplications = candidateFilter
      ? await countApplicationsWithFilters(user.id, { candidateFilter })
      : totalApplicationsAll;

    const stageCounts = buildStageCounts(
      jobs,
      techJobs,
      stages,
      stageFrom,
      stageTo,
      timezone,
      "applied",
      false,
    );
    const funnelCounts = buildStageCounts(
      jobs,
      techJobs,
      stages,
      stageFrom,
      stageTo,
      timezone,
      "applied",
      true,
    );

    return corsJson({
      appliedDate,
      appliedCount: countApplicationsOnDate(filteredApplications, appliedDate, timezone),
      appliedCountByCandidate,
      bidsByDate: buildBidSeries(filteredApplications, bidFrom, bidTo, timezone),
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
      funnelCounts,
      stageFrom,
      stageTo,
      timezone,
      totalApplications,
      totalApplicationsAll,
      applicationsByCandidate,
      totalPipelineCards: jobs.length + techJobs.length,
      stalePipelineCards: buildStalePipelineCards(jobs, techJobs, stages, timezone),
      candidates,
      candidateFilter: candidateFilter || null,
      pipelineIsAccountWide: true,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard.";
    return corsJson({ error: message }, { status: 500 });
  }
}
