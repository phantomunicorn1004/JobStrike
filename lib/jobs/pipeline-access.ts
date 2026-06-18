import "server-only";

import { mergeStageDate, normalizeStageDates, type StageDates } from "@/lib/jobs/pipelineCardUtils";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type PipelineCardSource = "jobs" | "technical_jobs";

export type PipelineAppliedRow = {
  id: number;
  source: "jobs";
  name: string;
  title: string;
  company_name: string;
  job_link: string;
  resume_link: string;
  note: string;
  created_at: string;
  stage_entered_at: string;
  stage_dates: StageDates;
  recruiter_name: string | null;
  recruiter_contact: string | null;
};

export type PipelineTechnicalRow = {
  id: number;
  source: "technical_jobs";
  stage_id: string;
  name: string;
  company_name: string;
  title: string;
  resume_link: string;
  job_description: string | null;
  recruiter_name: string | null;
  recruiter_contact: string | null;
  first_round_date: string | null;
  first_round_result: string | null;
  second_round_date: string | null;
  second_round_result: string | null;
  third_round_date: string | null;
  third_round_result: string | null;
  status: string | null;
  created_at: string;
  stage_entered_at: string;
  stage_dates: StageDates;
};

export type PipelineCardDetailsUpdate = {
  stage_dates: StageDates;
  recruiter_name: string;
  recruiter_contact: string;
  notes: string;
};

export type PipelineMovePayload = {
  source: PipelineCardSource;
  id: number;
  stageId: string;
};

type JobDbRow = Record<string, unknown>;
type TechDbRow = Record<string, unknown>;

function mapAppliedRow(row: JobDbRow): PipelineAppliedRow {
  const createdAt = row.created_at as string;
  const stageEnteredAt = (row.stage_entered_at as string | null) ?? createdAt;
  return {
    id: row.id as number,
    source: "jobs",
    name: row.name as string,
    title: row.title as string,
    company_name: row.company_name as string,
    job_link: row.job_link as string,
    resume_link: row.resume_link as string,
    note: (row.note as string) ?? "",
    created_at: createdAt,
    stage_entered_at: stageEnteredAt,
    stage_dates: normalizeStageDates(row.stage_dates, "applied", stageEnteredAt),
    recruiter_name: (row.recruiter_name as string | null) ?? null,
    recruiter_contact: (row.recruiter_contact as string | null) ?? null,
  };
}

function mapTechnicalRow(row: TechDbRow): PipelineTechnicalRow {
  const stageId = (row.stage_id as string | null) ?? "technical";
  const createdAt = row.created_at as string;
  const stageEnteredAt = (row.stage_entered_at as string | null) ?? createdAt;
  return {
    id: row.id as number,
    source: "technical_jobs",
    stage_id: stageId,
    name: row.name as string,
    company_name: row.company_name as string,
    title: row.title as string,
    resume_link: row.resume_link as string,
    job_description: (row.job_description as string | null) ?? null,
    recruiter_name: row.recruiter_name as string | null,
    recruiter_contact: row.recruiter_contact as string | null,
    first_round_date: row.first_round_date as string | null,
    first_round_result: row.first_round_result as string | null,
    second_round_date: row.second_round_date as string | null,
    second_round_result: row.second_round_result as string | null,
    third_round_date: row.third_round_date as string | null,
    third_round_result: row.third_round_result as string | null,
    status: row.status as string | null,
    created_at: createdAt,
    stage_entered_at: stageEnteredAt,
    stage_dates: normalizeStageDates(row.stage_dates, stageId, stageEnteredAt),
  };
}

function cardNotesFromJob(job: {
  source: PipelineCardSource;
  note?: string;
  job_description?: string | null;
}): string {
  if (job.source === "jobs") return job.note ?? "";
  return job.job_description ?? "";
}

async function getOwnedAppliedJob(
  userId: string,
  id: number,
): Promise<PipelineAppliedRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapAppliedRow(data as JobDbRow);
}

async function getOwnedTechnicalJob(
  userId: string,
  id: number,
): Promise<PipelineTechnicalRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("technical_jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapTechnicalRow(data as TechDbRow);
}

export async function listUserPipelineBoard(userId: string): Promise<{
  applied: PipelineAppliedRow[];
  technicalJobs: PipelineTechnicalRow[];
}> {
  const supabase = getSupabaseAdminClient();
  const [jobsRes, techRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: false }),
    supabase
      .from("technical_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: false }),
  ]);

  if (jobsRes.error) throw new Error(jobsRes.error.message);
  if (techRes.error) throw new Error(techRes.error.message);

  return {
    applied: (jobsRes.data ?? []).map((row) => mapAppliedRow(row as JobDbRow)),
    technicalJobs: (techRes.data ?? []).map((row) =>
      mapTechnicalRow(row as TechDbRow),
    ),
  };
}

export async function updatePipelineCardDetails(
  userId: string,
  source: PipelineCardSource,
  id: number,
  currentStageId: string,
  update: PipelineCardDetailsUpdate,
): Promise<PipelineAppliedRow | PipelineTechnicalRow> {
  const stageEnteredAt =
    update.stage_dates[currentStageId] ??
    (source === "jobs"
      ? (await getOwnedAppliedJob(userId, id))?.stage_entered_at
      : (await getOwnedTechnicalJob(userId, id))?.stage_entered_at) ??
    new Date().toISOString();

  const supabase = getSupabaseAdminClient();

  if (source === "jobs") {
    const { data, error } = await supabase
      .from("jobs")
      .update({
        stage_dates: update.stage_dates,
        recruiter_name: update.recruiter_name || null,
        recruiter_contact: update.recruiter_contact || null,
        note: update.notes,
        stage_entered_at: stageEnteredAt,
      } as never)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "Application not found.");
    return mapAppliedRow(data as JobDbRow);
  }

  const { data, error } = await supabase
    .from("technical_jobs")
    .update({
      stage_dates: update.stage_dates,
      recruiter_name: update.recruiter_name || null,
      recruiter_contact: update.recruiter_contact || null,
      job_description: update.notes,
      stage_entered_at: stageEnteredAt,
    } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "Application not found.");
  return mapTechnicalRow(data as TechDbRow);
}

export async function movePipelineCard(
  userId: string,
  payload: PipelineMovePayload,
  targetStageId: string,
): Promise<{ source: PipelineCardSource; id: number }> {
  if (payload.stageId === targetStageId) {
    return { source: payload.source, id: payload.id };
  }

  const isTargetApplied = targetStageId === "applied";
  const isSourceApplied = payload.source === "jobs";

  if (isSourceApplied && isTargetApplied) {
    return { source: payload.source, id: payload.id };
  }

  const supabase = getSupabaseAdminClient();
  const enteredAt = new Date().toISOString();

  if (isSourceApplied) {
    const job = await getOwnedAppliedJob(userId, payload.id);
    if (!job) throw new Error("Application not found.");

    const stageDates = mergeStageDate(
      mergeStageDate(
        job.stage_dates,
        payload.stageId,
        job.stage_entered_at ?? job.created_at,
      ),
      targetStageId,
      enteredAt,
    );
    const status = targetStageId === "final" ? "success" : "ongoing";

    const { data, error } = await supabase
      .from("technical_jobs")
      .insert({
        user_id: userId,
        name: job.name ?? "",
        company_name: job.company_name ?? "",
        title: job.title ?? "",
        resume_link: job.resume_link ?? "",
        stage_id: targetStageId,
        status,
        stage_entered_at: enteredAt,
        stage_dates: stageDates,
        job_description: cardNotesFromJob(job),
        recruiter_name: job.recruiter_name ?? null,
        recruiter_contact: job.recruiter_contact ?? null,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: deleteError } = await supabase
      .from("jobs")
      .delete()
      .eq("id", job.id)
      .eq("user_id", userId);
    if (deleteError) throw new Error(deleteError.message);

    return {
      source: "technical_jobs",
      id: (data as { id: number }).id,
    };
  }

  if (isTargetApplied) {
    const job = await getOwnedTechnicalJob(userId, payload.id);
    if (!job) throw new Error("Application not found.");

    const stageDates = mergeStageDate(
      mergeStageDate(
        job.stage_dates,
        payload.stageId,
        job.stage_entered_at ?? job.created_at ?? enteredAt,
      ),
      targetStageId,
      enteredAt,
    );

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        name: job.name,
        title: job.title,
        company_name: job.company_name,
        job_link: "",
        resume_link: job.resume_link,
        note: cardNotesFromJob(job),
        recruiter_name: job.recruiter_name ?? null,
        recruiter_contact: job.recruiter_contact ?? null,
        stage_entered_at: enteredAt,
        stage_dates: stageDates,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: deleteError } = await supabase
      .from("technical_jobs")
      .delete()
      .eq("id", job.id)
      .eq("user_id", userId);
    if (deleteError) throw new Error(deleteError.message);

    return { source: "jobs", id: (data as { id: number }).id };
  }

  const job = await getOwnedTechnicalJob(userId, payload.id);
  if (!job) throw new Error("Application not found.");

  const stageDates = mergeStageDate(job.stage_dates, targetStageId, enteredAt);
  const status = targetStageId === "final" ? "success" : "ongoing";

  const { error } = await supabase
    .from("technical_jobs")
    .update({
      stage_id: targetStageId,
      status,
      stage_entered_at: enteredAt,
      stage_dates: stageDates,
    } as never)
    .eq("id", job.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  return { source: "technical_jobs", id: job.id };
}

export async function reassignUserTechnicalJobsStage(
  userId: string,
  fromStageId: string,
  toStageId: string,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("technical_jobs")
    .update({ stage_id: toStageId } as never)
    .eq("user_id", userId)
    .eq("stage_id", fromStageId);
  if (error) throw new Error(error.message);
}
