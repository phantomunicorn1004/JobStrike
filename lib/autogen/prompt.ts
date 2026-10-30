import "server-only";

import { generationReadiness, parseKitResumeJson } from "@/lib/autogen/kit";
import { buildPrompt } from "@/lib/promptBuilder";
import { getProfilePromptKit } from "@/lib/resume-db/prompt-kit-repository";
import type { ResumeDbApplication } from "@/lib/resume-db/types";

export type PromptBlock =
  | "no_profile"
  | "no_kit"
  | "no_job_description"
  | "fictional_kit"
  | "kit_invalid";

export type RenderedPrompt =
  | { ok: true; prompt: string; kit: Record<string, unknown> }
  | { ok: false; reason: PromptBlock; detail: string };

/** A Note this short is a remark, not a job description. */
const MIN_NOTE_AS_JD_CHARS = 80;

export type ReadyKit =
  | { ok: true; template: string; resumeJson: string }
  | { ok: false; reason: Exclude<PromptBlock, "no_job_description">; detail: string };

/**
 * The profile's prompt kit when it can generate (see generationReadiness).
 * Checked when a job is queued, so a profile that cannot generate does not
 * fill the queue, and again for every run, since the kit may change meanwhile.
 */
export async function loadReadyKit(userId: string, profileId: number | null): Promise<ReadyKit> {
  if (profileId == null) {
    return { ok: false, reason: "no_profile", detail: "The application has no profile." };
  }
  const { kit, exists } = await getProfilePromptKit(userId, profileId);
  if (!exists) {
    return {
      ok: false,
      reason: "no_kit",
      detail: "The profile has no saved prompt kit. Save one on the Resume Builder page.",
    };
  }
  const template = String(kit.template ?? "");
  const resumeJson = String(kit.resumeTemplateJson ?? "");
  const readiness = generationReadiness(template, resumeJson);
  if (!readiness.ready) {
    return {
      ok: false,
      reason: readiness.mode === "fictional_benchmark" ? "fictional_kit" : "kit_invalid",
      detail: `Profile kit: ${readiness.problems.join(" ")}`,
    };
  }
  return { ok: true, template, resumeJson };
}

/**
 * The prompt for one application: its profile's own prompt (edited on the
 * Resume Builder page or the extension's Edit kit) filled with the profile's
 * resume JSON and the application's job description, exactly as Copy Prompt
 * builds it. Kits that cannot produce a usable, truthful resume stop here,
 * before any ChatGPT run or API call is spent.
 */
export async function renderGenerationPrompt(
  userId: string,
  app: ResumeDbApplication,
): Promise<RenderedPrompt> {
  const ready = await loadReadyKit(userId, app.profileId);
  if (!ready.ok) return ready;
  const { template, resumeJson } = ready;
  // Rows bid on by hand keep the job description in the Note (the Bid tab puts it there).
  const note = String(app.note ?? "").trim();
  const jobDescription =
    String(app.jobDescription ?? "").trim() || (note.length >= MIN_NOTE_AS_JD_CHARS ? note : "");
  if (!jobDescription) {
    return { ok: false, reason: "no_job_description", detail: "The application has no job description." };
  }
  const { prompt } = buildPrompt(template, resumeJson, jobDescription);
  const kitJson = parseKitResumeJson(resumeJson) as Record<string, unknown>;
  return { ok: true, prompt, kit: kitJson };
}
