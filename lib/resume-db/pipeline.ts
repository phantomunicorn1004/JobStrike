import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ResumeDbApplication } from "@/lib/resume-db/types";
import { getApplicationById, updateApplication } from "@/lib/resume-db/repository";

export async function addApplicationToPipeline(
  applicationId: number,
): Promise<{ pipelineJobId: number }> {
  const app = await getApplicationById(applicationId);
  if (!app) throw new Error("Application not found.");

  if (app.pipelineJobId) {
    return { pipelineJobId: app.pipelineJobId };
  }

  const supabase = getSupabaseAdminClient();
  const noteParts: string[] = [];
  if (app.coverLetterUrl) {
    noteParts.push(`Cover letter: ${app.coverLetterUrl}`);
  }
  noteParts.push(`Resume DB #${app.id}`);

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      name: app.candidateName || "Candidate",
      title: app.jobTitle || "Role",
      company_name: app.company || "Company",
      job_link: app.jobLink || "",
      resume_link: app.resumeUrl || "",
      note: noteParts.join("\n"),
    } as never)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const pipelineJobId = (data as { id: number }).id;
  await updateApplication(applicationId, {
    apply: "In Pipeline",
    pipelineJobId,
  });

  return { pipelineJobId };
}

export async function removeApplicationFromPipeline(
  applicationId: number,
): Promise<void> {
  const app = await getApplicationById(applicationId);
  if (!app) throw new Error("Application not found.");

  if (!app.pipelineJobId) {
    await updateApplication(applicationId, { apply: "Registered", pipelineJobId: null });
    return;
  }

  const supabase = getSupabaseAdminClient();
  const { error: deleteError } = await supabase
    .from("jobs")
    .delete()
    .eq("id", app.pipelineJobId);

  if (deleteError) throw new Error(deleteError.message);

  await updateApplication(applicationId, {
    apply: "Registered",
    pipelineJobId: null,
  });
}

export function isInPipeline(app: Pick<ResumeDbApplication, "pipelineJobId" | "apply">): boolean {
  return app.pipelineJobId != null || app.apply === "In Pipeline";
}
