import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";
import type {
  PipelineJobRow,
  PipelineTechRow,
  ResumeApplicationRow,
} from "@/lib/dashboard/stats";

/**
 * Fetch every Resume DB application row for dashboard aggregations.
 * PostgREST/Supabase defaults to a 1000-row cap, so we page until exhausted.
 */
export async function listAllApplicationsForDashboard(
  userId: string,
): Promise<ResumeApplicationRow[]> {
  const supabase = getSupabaseAdminClient();
  return fetchAllByRange<ResumeApplicationRow>((from, to) =>
    supabase
      .from("resume_db_applications")
      .select("id, applied_at, profile_id, candidate_name")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export async function listAllPipelineJobsForDashboard(
  userId: string,
): Promise<PipelineJobRow[]> {
  const supabase = getSupabaseAdminClient();
  return fetchAllByRange<PipelineJobRow>((from, to) =>
    supabase
      .from("jobs")
      .select(
        "id, name, title, company_name, note, created_at, stage_entered_at, stage_dates",
      )
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export async function listAllTechnicalJobsForDashboard(
  userId: string,
): Promise<PipelineTechRow[]> {
  const supabase = getSupabaseAdminClient();
  return fetchAllByRange<PipelineTechRow>((from, to) =>
    supabase
      .from("technical_jobs")
      .select(
        "id, name, title, company_name, job_description, created_at, stage_entered_at, stage_dates, stage_id",
      )
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}
