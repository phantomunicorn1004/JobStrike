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
import { QUEUED_APPLY } from "@/lib/resume-db/types";

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
      .neq("apply", QUEUED_APPLY)
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
      .neq("apply", QUEUED_APPLY)
      .gte("applied_at", fromIso)
      .lte("applied_at", toIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/** Only cards whose text holds a link back to Resume DB carry anything the charts read from it. */
const RESUME_DB_MARKER = "%Resume DB #%";

/** Puts each linked card's text back on its row; unlinked rows keep no text (they count as unassigned). */
function withMarkerText<R extends { id?: number }>(
  rows: R[],
  textById: Map<number, string | null>,
  column: "note" | "job_description",
): R[] {
  return rows.map((row) => (row.id != null && textById.has(row.id) ? { ...row, [column]: textById.get(row.id) } : row));
}

/** Pipeline rows for the dashboard: dates for every card, the note only for cards linked to Resume DB. */
export async function listPipelineJobsForDashboard(
  userId: string,
): Promise<PipelineJobRow[]> {
  const supabase = getSupabaseAdminClient();
  const [rows, linked] = await Promise.all([
    fetchAllByRange<PipelineJobRow>((from, to) =>
      supabase
        .from("jobs")
        .select("id, created_at, stage_entered_at, stage_dates")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllByRange<{ id: number; note: string | null }>((from, to) =>
      supabase
        .from("jobs")
        .select("id, note")
        .eq("user_id", userId)
        .like("note", RESUME_DB_MARKER)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  return withMarkerText(rows, new Map(linked.map((row) => [row.id, row.note])), "note");
}

/** Technical-board rows: dates and column for every card, the description only for linked cards. */
export async function listTechnicalJobsForDashboard(
  userId: string,
): Promise<PipelineTechRow[]> {
  const supabase = getSupabaseAdminClient();
  const [rows, linked] = await Promise.all([
    fetchAllByRange<PipelineTechRow>((from, to) =>
      supabase
        .from("technical_jobs")
        .select("id, stage_id, created_at, stage_entered_at, stage_dates")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllByRange<{ id: number; job_description: string | null }>((from, to) =>
      supabase
        .from("technical_jobs")
        .select("id, job_description")
        .eq("user_id", userId)
        .like("job_description", RESUME_DB_MARKER)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  return withMarkerText(rows, new Map(linked.map((row) => [row.id, row.job_description])), "job_description");
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
        .neq("apply", QUEUED_APPLY)
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
        .neq("apply", QUEUED_APPLY)
        .order("id", { ascending: true })
        .range(from, to),
    );
  }
}
