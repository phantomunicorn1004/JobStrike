import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ResumeDbApplication } from "@/lib/resume-db/types";
import { deleteApplicationFiles } from "@/lib/resume-db/delete-application-files";
import {
  deleteApplication,
  getApplicationById,
  updateApplication,
} from "@/lib/resume-db/repository";

export function resumeDbMarker(applicationId: number): string {
  return `Resume DB #${applicationId}`;
}

/** Remove all pipeline cards created from or linked to a Resume DB application. */
export async function deletePipelineCardsForApplication(
  applicationId: number,
  pipelineJobId: number | null,
  userId: string,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const marker = resumeDbMarker(applicationId);

  if (pipelineJobId) {
    const { error } = await supabase
      .from("jobs")
      .delete()
      .eq("id", pipelineJobId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  const { error: techError } = await supabase
    .from("technical_jobs")
    .delete()
    .eq("user_id", userId)
    .ilike("job_description", `%${marker}%`);

  if (techError) throw new Error(techError.message);

  const { error: jobsNoteError } = await supabase
    .from("jobs")
    .delete()
    .eq("user_id", userId)
    .ilike("note", `%${marker}%`);

  if (jobsNoteError) throw new Error(jobsNoteError.message);
}

export async function deleteApplicationWithPipeline(
  applicationId: number,
  userId: string,
  origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
): Promise<void> {
  const app = await getApplicationById(applicationId, userId);
  if (!app) throw new Error("Application not found.");

  await deletePipelineCardsForApplication(applicationId, app.pipelineJobId, userId);
  await deleteApplicationFiles(userId, origin, app);
  await deleteApplication(applicationId, userId);
}

export async function addApplicationToPipeline(
  applicationId: number,
  userId: string,
): Promise<{ pipelineJobId: number }> {
  const app = await getApplicationById(applicationId, userId);
  if (!app) throw new Error("Application not found.");

  if (app.pipelineJobId) {
    return { pipelineJobId: app.pipelineJobId };
  }

  const supabase = getSupabaseAdminClient();
  const noteParts: string[] = [];
  if (app.coverLetterUrl) {
    noteParts.push(`Cover letter: ${app.coverLetterUrl}`);
  }
  noteParts.push(resumeDbMarker(app.id));

  const enteredAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      name: app.candidateName || "Profile",
      title: app.jobTitle || "Role",
      company_name: app.company || "Company",
      job_link: app.jobLink || "",
      resume_link: app.resumeUrl || "",
      note: noteParts.join("\n"),
      stage_entered_at: enteredAt,
      stage_dates: { applied: enteredAt },
    } as never)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const pipelineJobId = (data as { id: number }).id;
  await updateApplication(applicationId, userId, {
    apply: "In Pipeline",
    pipelineJobId,
    pipelineStageId: "applied",
  });

  return { pipelineJobId };
}

export async function removeApplicationFromPipeline(
  applicationId: number,
  userId: string,
): Promise<void> {
  const app = await getApplicationById(applicationId, userId);
  if (!app) throw new Error("Application not found.");

  await deletePipelineCardsForApplication(applicationId, app.pipelineJobId, userId);

  await updateApplication(applicationId, userId, {
    apply: "Registered",
    pipelineJobId: null,
    pipelineStageId: null,
  });
}

export function isInPipeline(app: Pick<ResumeDbApplication, "pipelineJobId" | "apply">): boolean {
  return app.pipelineJobId != null || app.apply === "In Pipeline";
}

/** Keep denormalized pipeline_stage_id in sync when board cards move. */
export async function syncApplicationStageFromCardNotes(
  userId: string,
  notes: string | null | undefined,
  stageId: string | null,
  pipelineJobId: number | null = null,
): Promise<void> {
  if (!notes) return;
  const match = notes.match(/Resume DB #(\d+)/);
  if (!match?.[1]) return;
  const applicationId = Number(match[1]);
  if (!Number.isFinite(applicationId)) return;
  try {
    const patch: Parameters<typeof updateApplication>[2] = {
      pipelineStageId: stageId,
      apply: stageId ? "In Pipeline" : "Registered",
    };
    if (stageId === "applied" && pipelineJobId != null) {
      patch.pipelineJobId = pipelineJobId;
    } else if (stageId !== "applied") {
      patch.pipelineJobId = null;
    }
    await updateApplication(applicationId, userId, patch);
  } catch {
    /* non-fatal: card move already succeeded */
  }
}

export async function syncPipelineJobFromApplication(
  applicationId: number,
  userId: string,
): Promise<void> {
  const app = await getApplicationById(applicationId, userId);
  if (!app?.pipelineJobId) return;

  const supabase = getSupabaseAdminClient();
  const noteParts: string[] = [];
  if (app.coverLetterUrl) {
    noteParts.push(`Cover letter: ${app.coverLetterUrl}`);
  }
  noteParts.push(resumeDbMarker(app.id));

  const { error } = await supabase
    .from("jobs")
    .update({
      title: app.jobTitle || "Role",
      company_name: app.company || "Company",
      job_link: app.jobLink || "",
      resume_link: app.resumeUrl || "",
      note: noteParts.join("\n"),
    } as never)
    .eq("id", app.pipelineJobId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}
