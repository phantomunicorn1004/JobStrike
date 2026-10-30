import "server-only";

import type { ResumeDbApplication } from "@/lib/resume-db/types";

/** What the AutoGen worker sees of an application. */
export type AutogenApplicationDto = {
  id: number;
  profile_id: number | null;
  candidate: string;
  role: string;
  company_name: string;
  job_link: string;
  job_description: string;
  created_at: string;
  status: string;
  autogen_claimed_at: string | null;
  generation_error: string;
  rendered_prompt?: string;
};

export function toAutogenDto(app: ResumeDbApplication, renderedPrompt?: string): AutogenApplicationDto {
  return {
    id: app.id,
    profile_id: app.profileId,
    candidate: app.candidateName,
    role: app.jobTitle,
    company_name: app.company,
    job_link: app.jobLink,
    job_description: app.jobDescription ?? "",
    created_at: app.createdAt || app.appliedAt,
    status: app.generationStatus ?? "none",
    autogen_claimed_at: app.autogenClaimedAt ?? null,
    generation_error: app.generationError ?? "",
    ...(renderedPrompt !== undefined && { rendered_prompt: renderedPrompt }),
  };
}

export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  return Number.isFinite(ta) && ta === Date.parse(b);
}
