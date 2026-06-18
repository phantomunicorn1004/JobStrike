import "server-only";

import { mergeStageDate, type StageDates } from "@/lib/jobs/pipelineCardUtils";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ResumeDbApplication } from "@/lib/resume-db/types";
import {
  addApplicationToPipeline,
  removeApplicationFromPipeline,
  resumeDbMarker,
} from "@/lib/resume-db/pipeline";
import {
  getApplicationById,
  updateApplication,
} from "@/lib/resume-db/repository";

export type PipelineStage = {
  id: string;
  name: string;
  sort_order: number;
};

const DEFAULT_STAGES: PipelineStage[] = [
  { id: "applied", name: "Applied", sort_order: 0 },
  { id: "technical", name: "Technical", sort_order: 1 },
  { id: "final", name: "Final", sort_order: 2 },
];

type JobRow = {
  id: number;
  note?: string | null;
  name?: string;
  title?: string;
  company_name?: string;
  resume_link?: string;
  stage_entered_at?: string | null;
  stage_dates?: unknown;
  created_at?: string;
  recruiter_name?: string | null;
  recruiter_contact?: string | null;
};

type TechnicalJobRow = {
  id: number;
  stage_id?: string | null;
  job_description?: string | null;
  name?: string;
  title?: string;
  company_name?: string;
  resume_link?: string;
  stage_entered_at?: string | null;
  stage_dates?: unknown;
  created_at?: string;
  recruiter_name?: string | null;
  recruiter_contact?: string | null;
};

function buildCardNotes(app: ResumeDbApplication): string {
  const parts: string[] = [];
  if (app.coverLetterUrl) {
    parts.push(`Cover letter: ${app.coverLetterUrl}`);
  }
  parts.push(resumeDbMarker(app.id));
  return parts.join("\n");
}

function parseApplicationIdFromMarker(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/Resume DB #(\d+)/);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isNaN(id) ? null : id;
}

export async function listPipelineStages(): Promise<PipelineStage[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (error || !data?.length) return DEFAULT_STAGES;
  return data as PipelineStage[];
}

export async function buildPipelineStageMap(
  applications: ResumeDbApplication[],
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  for (const app of applications) {
    map.set(app.id, null);
  }
  if (applications.length === 0) return map;

  const supabase = getSupabaseAdminClient();
  const pipelineJobIds = applications
    .map((app) => app.pipelineJobId)
    .filter((id): id is number => id != null);

  if (pipelineJobIds.length) {
    const { data: linkedJobs } = await supabase
      .from("jobs")
      .select("id")
      .in("id", pipelineJobIds);
    const linkedSet = new Set(
      ((linkedJobs ?? []) as Pick<JobRow, "id">[]).map((row) => row.id),
    );
    for (const app of applications) {
      if (app.pipelineJobId && linkedSet.has(app.pipelineJobId)) {
        map.set(app.id, "applied");
      }
    }
  }

  const [{ data: markedJobs }, { data: markedTech }] = await Promise.all([
    supabase.from("jobs").select("id, note").ilike("note", "%Resume DB #%"),
    supabase
      .from("technical_jobs")
      .select("id, stage_id, job_description")
      .ilike("job_description", "%Resume DB #%"),
  ]);

  for (const job of (markedJobs ?? []) as Pick<JobRow, "id" | "note">[]) {
    const appId = parseApplicationIdFromMarker(job.note);
    if (appId != null && map.has(appId)) {
      map.set(appId, "applied");
    }
  }

  for (const tech of (markedTech ?? []) as Pick<
    TechnicalJobRow,
    "id" | "stage_id" | "job_description"
  >[]) {
    const appId = parseApplicationIdFromMarker(tech.job_description);
    if (appId != null && map.has(appId)) {
      map.set(appId, tech.stage_id ?? "technical");
    }
  }

  return map;
}

type PipelineCard = {
  source: "jobs" | "technical_jobs" | null;
  jobId: number | null;
  stageId: string | null;
};

async function getPipelineCardForApplication(
  app: ResumeDbApplication,
): Promise<PipelineCard> {
  const supabase = getSupabaseAdminClient();
  const marker = resumeDbMarker(app.id);

  if (app.pipelineJobId) {
    const { data } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", app.pipelineJobId)
      .maybeSingle();
    if (data) {
      const job = data as Pick<JobRow, "id">;
      return { source: "jobs", jobId: job.id, stageId: "applied" };
    }
  }

  const { data: jobByMarker } = await supabase
    .from("jobs")
    .select("id")
    .ilike("note", `%${marker}%`)
    .maybeSingle();
  if (jobByMarker) {
    const job = jobByMarker as Pick<JobRow, "id">;
    return { source: "jobs", jobId: job.id, stageId: "applied" };
  }

  const { data: tech } = await supabase
    .from("technical_jobs")
    .select("id, stage_id")
    .ilike("job_description", `%${marker}%`)
    .maybeSingle();
  if (tech) {
    const techJob = tech as Pick<TechnicalJobRow, "id" | "stage_id">;
    return {
      source: "technical_jobs",
      jobId: techJob.id,
      stageId: techJob.stage_id ?? "technical",
    };
  }

  return { source: null, jobId: null, stageId: null };
}

function asStageDates(raw: unknown): StageDates | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as StageDates;
  }
  return undefined;
}

export async function setApplicationPipelineStage(
  applicationId: number,
  userId: string,
  targetStageId: string | null,
): Promise<void> {
  const app = await getApplicationById(applicationId, userId);
  if (!app) throw new Error("Application not found.");

  const target = targetStageId?.trim() || null;
  const current = await getPipelineCardForApplication(app);

  if (!target) {
    if (current.source) {
      await removeApplicationFromPipeline(applicationId, userId);
    }
    return;
  }

  const stages = await listPipelineStages();
  if (!stages.some((stage) => stage.id === target)) {
    throw new Error("Unknown pipeline stage.");
  }

  if (current.stageId === target) {
    if (target === "applied" && current.jobId && app.pipelineJobId !== current.jobId) {
      await updateApplication(applicationId, userId, {
        pipelineJobId: current.jobId,
        apply: "In Pipeline",
      });
    }
    return;
  }

  const supabase = getSupabaseAdminClient();
  const enteredAt = new Date().toISOString();
  const notes = buildCardNotes(app);

  if (!current.source) {
    if (target === "applied") {
      await addApplicationToPipeline(applicationId, userId);
      return;
    }

    const status = target === "final" ? "success" : "ongoing";
    const { error } = await supabase.from("technical_jobs").insert({
      name: app.candidateName || "Candidate",
      company_name: app.company || "Company",
      title: app.jobTitle || "Role",
      resume_link: app.resumeUrl || "",
      job_description: notes,
      stage_id: target,
      status,
      stage_entered_at: enteredAt,
      stage_dates: { [target]: enteredAt },
    } as never);
    if (error) throw new Error(error.message);

    await updateApplication(applicationId, userId, {
      apply: "In Pipeline",
      pipelineJobId: null,
    });
    return;
  }

  if (current.source === "jobs" && current.jobId) {
    if (target === "applied") return;

    const { data: job, error: loadError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", current.jobId)
      .single();
    if (loadError || !job) throw new Error(loadError?.message || "Pipeline job not found.");

    const jobRow = job as JobRow;
    const stageDates = mergeStageDate(
      mergeStageDate(
        asStageDates(jobRow.stage_dates),
        "applied",
        jobRow.stage_entered_at ?? jobRow.created_at ?? enteredAt,
      ),
      target,
      enteredAt,
    );
    const status = target === "final" ? "success" : "ongoing";
    const { error: insertError } = await supabase.from("technical_jobs").insert({
      name: jobRow.name,
      company_name: jobRow.company_name,
      title: jobRow.title,
      resume_link: jobRow.resume_link,
      job_description: notes,
      stage_id: target,
      status,
      stage_entered_at: enteredAt,
      stage_dates: stageDates,
      recruiter_name: jobRow.recruiter_name ?? null,
      recruiter_contact: jobRow.recruiter_contact ?? null,
    } as never);
    if (insertError) throw new Error(insertError.message);

    const { error: deleteError } = await supabase
      .from("jobs")
      .delete()
      .eq("id", current.jobId);
    if (deleteError) throw new Error(deleteError.message);

    await updateApplication(applicationId, userId, {
      pipelineJobId: null,
      apply: "In Pipeline",
    });
    return;
  }

  if (current.source === "technical_jobs" && current.jobId) {
    const { data: job, error: loadError } = await supabase
      .from("technical_jobs")
      .select("*")
      .eq("id", current.jobId)
      .single();
    if (loadError || !job) {
      throw new Error(loadError?.message || "Pipeline job not found.");
    }

    if (target === "applied") {
      const jobRow = job as TechnicalJobRow;
      const sourceStageId = jobRow.stage_id ?? "technical";
      const stageDates = mergeStageDate(
        mergeStageDate(
          asStageDates(jobRow.stage_dates),
          sourceStageId,
          jobRow.stage_entered_at ?? jobRow.created_at ?? enteredAt,
        ),
        "applied",
        enteredAt,
      );
      const { data: inserted, error: insertError } = await supabase
        .from("jobs")
        .insert({
          name: jobRow.name,
          title: jobRow.title,
          company_name: jobRow.company_name,
          job_link: app.jobLink || "",
          resume_link: jobRow.resume_link,
          note: notes,
          stage_entered_at: enteredAt,
          stage_dates: stageDates,
          recruiter_name: jobRow.recruiter_name ?? null,
          recruiter_contact: jobRow.recruiter_contact ?? null,
        } as never)
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);

      const { error: deleteError } = await supabase
        .from("technical_jobs")
        .delete()
        .eq("id", current.jobId);
      if (deleteError) throw new Error(deleteError.message);

      const insertedJob = inserted as Pick<JobRow, "id">;
      await updateApplication(applicationId, userId, {
        pipelineJobId: insertedJob.id,
        apply: "In Pipeline",
      });
      return;
    }

    const jobRow = job as TechnicalJobRow;
    const stageDates = mergeStageDate(asStageDates(jobRow.stage_dates), target, enteredAt);
    const status = target === "final" ? "success" : "ongoing";
    const { error } = await supabase
      .from("technical_jobs")
      .update({
        stage_id: target,
        status,
        stage_entered_at: enteredAt,
        stage_dates: stageDates,
      } as never)
      .eq("id", current.jobId);
    if (error) throw new Error(error.message);
  }
}
