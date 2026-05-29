import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  addDaysYmd,
  buildBidSeries,
  buildStageCounts,
  countApplicationsOnDate,
  localYmd,
  type PipelineStageRow,
  type PipelineJobRow,
  type PipelineTechRow,
  type ResumeApplicationRow,
} from "@/lib/dashboard/stats";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const today = localYmd();
    const appliedDate = searchParams.get("date") || today;
    const bidDays = Math.min(
      90,
      Math.max(7, Number(searchParams.get("bidDays") ?? 30) || 30),
    );
    const stageFrom =
      searchParams.get("stageFrom") || addDaysYmd(today, -(bidDays - 1));
    const stageTo = searchParams.get("stageTo") || today;

    const supabase = getSupabaseAdminClient();
    const [applicationsRes, jobsRes, techRes, stagesRes] = await Promise.all([
      supabase.from("resume_db_applications").select("applied_at"),
      supabase
        .from("jobs")
        .select("created_at, stage_entered_at, stage_dates"),
      supabase
        .from("technical_jobs")
        .select("created_at, stage_entered_at, stage_dates, stage_id"),
      supabase
        .from("pipeline_stages")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true }),
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

    const bidTo = today;
    const bidFrom = addDaysYmd(today, -(bidDays - 1));

    return corsJson({
      appliedDate,
      appliedCount: countApplicationsOnDate(applications, appliedDate),
      bidsByDate: buildBidSeries(applications, bidFrom, bidTo),
      bidFrom,
      bidTo,
      stageCounts: buildStageCounts(jobs, techJobs, stages, stageFrom, stageTo),
      stageFrom,
      stageTo,
      totalApplications: applications.length,
      totalPipelineCards: jobs.length + techJobs.length,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard.";
    return corsJson({ error: message }, { status: 500 });
  }
}
