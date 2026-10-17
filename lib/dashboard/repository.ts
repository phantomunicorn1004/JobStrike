import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";
import type {
  PipelineJobRow,
  PipelineTechRow,
  ResumeApplicationRow,
} from "@/lib/dashboard/stats";
import { endOfDayUtcIso, startOfDayUtcIso } from "@/lib/timezone";
import type { ResponseApplicationRow } from "@/lib/dashboard/response-stats";

/**
 * Thin all-time rows for candidate breakdowns (no applied_at needed beyond optional id).
 */
export async function listApplicationCandidateKeysForDashboard(
  userId: string,
): Promise<ResumeApplicationRow[]> {
  const supabase = getSupabaseAdminClient();
  return fetchAllByRange<ResumeApplicationRow>((from, to) =>
    supabase
      .from("resume_db_applications")
      .select("id, profile_id, candidate_name, applied_at")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/** Applications in a calendar date range (timezone-aware bounds). */
export async function listApplicationsForDashboardRange(
  userId: string,
  dateFrom: string,
  dateTo: string,
  timeZone: string,
): Promise<ResumeApplicationRow[]> {
  const supabase = getSupabaseAdminClient();
  const fromIso = startOfDayUtcIso(dateFrom, timeZone);
  const toIso = endOfDayUtcIso(dateTo, timeZone);
  return fetchAllByRange<ResumeApplicationRow>((from, to) =>
    supabase
      .from("resume_db_applications")
      .select("id, applied_at, profile_id, candidate_name")
      .eq("user_id", userId)
      .gte("applied_at", fromIso)
      .lte("applied_at", toIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/** Lightweight pipeline rows for dashboard charts (no company/title fluff). */
export async function listPipelineJobsForDashboard(
  userId: string,
): Promise<PipelineJobRow[]> {
  const supabase = getSupabaseAdminClient();
  return fetchAllByRange<PipelineJobRow>((from, to) =>
    supabase
      .from("jobs")
      .select("id, note, created_at, stage_entered_at, stage_dates")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export async function listTechnicalJobsForDashboard(
  userId: string,
): Promise<PipelineTechRow[]> {
  const supabase = getSupabaseAdminClient();
  return fetchAllByRange<PipelineTechRow>((from, to) =>
    supabase
      .from("technical_jobs")
      .select(
        "id, stage_id, job_description, created_at, stage_entered_at, stage_dates",
      )
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/**
 * Every application with its link and current pipeline column, for the response
 * statistics. Older databases without pipeline_stage_id count every bid as unanswered.
 */
export async function listApplicationsForResponseStats(
  userId: string,
): Promise<ResponseApplicationRow[]> {
  const supabase = getSupabaseAdminClient();
  try {
    return await fetchAllByRange<ResponseApplicationRow>((from, to) =>
      supabase
        .from("resume_db_applications")
        .select("id, job_link, applied_at, pipeline_stage_id, profile_id, candidate_name")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    if (!/pipeline_stage_id/i.test(String((error as Error)?.message || ""))) throw error;
    return fetchAllByRange<ResponseApplicationRow>((from, to) =>
      supabase
        .from("resume_db_applications")
        .select("id, job_link, applied_at, profile_id, candidate_name")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  }
}

/** @deprecated Prefer range-scoped helpers above. */
export async function listAllApplicationsForDashboard(
  userId: string,
): Promise<ResumeApplicationRow[]> {
  return listApplicationCandidateKeysForDashboard(userId);
}

/** @deprecated Prefer listPipelineJobsForDashboard. */
export async function listAllPipelineJobsForDashboard(
  userId: string,
): Promise<PipelineJobRow[]> {
  return listPipelineJobsForDashboard(userId);
}

/** @deprecated Prefer listTechnicalJobsForDashboard. */
export async function listAllTechnicalJobsForDashboard(
  userId: string,
): Promise<PipelineTechRow[]> {
  return listTechnicalJobsForDashboard(userId);
}
