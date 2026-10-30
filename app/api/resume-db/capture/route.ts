import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { explainMissingColumns } from "@/lib/autogen/claim";
import { loadReadyKit } from "@/lib/autogen/prompt";
import { autogenRoute, readJson } from "@/lib/autogen/route";
import {
  createApplication,
  findApplicationByJobLink,
  getProfileById,
} from "@/lib/resume-db/repository";
import { newEntryId } from "@/lib/resume-db/storage";
import { QUEUED_APPLY } from "@/lib/resume-db/types";

export function OPTIONS() {
  return corsOptions();
}

function text(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * POST /api/resume-db/capture — body { profileId, jobLink, jobTitle, company, jobDescription, note? }.
 * Adds a job to Resume DB with no files yet and queues it for resume
 * generation. apply is "Queued" until the application is sent, so it is not
 * counted as a bid. 409 { duplicateId } when the profile already has the link;
 * 422 { kitBlocked } when the profile's kit cannot generate (nothing is queued).
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "capture", async (user) => {
    const body = await readJson(request);
    const profileId = Number(body.profileId ?? body.profile_id);
    const jobLink = text(body, "jobLink", "job_link");
    const jobTitle = text(body, "jobTitle", "job_title");
    const company = text(body, "company", "companyName", "company_name");
    const jobDescription = text(body, "jobDescription", "job_description");
    const missing = [
      !Number.isInteger(profileId) || profileId < 1 ? "profileId" : "",
      jobLink ? "" : "jobLink",
      jobTitle ? "" : "jobTitle",
      company ? "" : "company",
      jobDescription ? "" : "jobDescription",
    ].filter(Boolean);
    if (missing.length) {
      return corsJson({ error: `Required: ${missing.join(", ")}.` }, { status: 400 });
    }

    const [profile, duplicate] = await Promise.all([
      getProfileById(user.id, profileId),
      findApplicationByJobLink(user.id, profileId, jobLink),
    ]);
    if (!profile) return corsJson({ error: "Selected profile not found." }, { status: 400 });
    const kit = await loadReadyKit(user.id, profileId);
    if (!kit.ok) {
      return corsJson(
        {
          error: `${profile.full_name} cannot generate resumes yet, so the job was not queued. ${kit.detail}`,
          kitBlocked: true,
          reason: kit.reason,
        },
        { status: 422 },
      );
    }
    if (duplicate) {
      return corsJson(
        {
          error: `Duplicate job link — already in Resume DB for this profile (#${duplicate.id}).`,
          duplicateId: duplicate.id,
        },
        { status: 409 },
      );
    }

    const application = await createApplication(user.id, {
      entryId: newEntryId(),
      profileId,
      candidateName: profile.full_name,
      jobLink,
      jobTitle,
      company,
      note: text(body, "note"),
      apply: QUEUED_APPLY,
      resumeUrl: "",
      jobDescription,
      generationStatus: "queue",
    }).catch((error: unknown) => {
      throw new Error(explainMissingColumns(error instanceof Error ? error.message : String(error)));
    });
    return corsJson({ ok: true, id: application.id, generationStatus: "queue" }, { status: 201 });
  });
}
