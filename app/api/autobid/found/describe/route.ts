import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { describeFound, skipFound } from "@/lib/autobid/candidates";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** The AI fit check can take most of a minute on a long posting. */
export const maxDuration = 60;

/**
 * POST /api/autobid/found/describe — body { profileId, jobLink, jobDescription } (or { unreadable: true }
 * when the panel could not read the page: the job is skipped).
 * One job from /api/autobid/found's wantJd, with its description: the rule
 * check on the description, then the AI fit check, then the queue if there is
 * room. Answers { status, reason, score? } (status: skipped, passed or queued).
 * 503 when the AI check cannot run; the job stays waiting for the next check.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid describe", async (user) => {
    const body = await readJson(request);
    const profileId = Number(body.profileId ?? body.profile_id);
    const jobLink = String(body.jobLink ?? body.job_link ?? "").trim();
    const jobDescription = String(body.jobDescription ?? body.job_description ?? "").trim();
    const unreadable = body.unreadable === true;
    const missing = [
      !Number.isInteger(profileId) || profileId < 1 ? "profileId" : "",
      jobLink ? "" : "jobLink",
      jobDescription || unreadable ? "" : "jobDescription",
    ].filter(Boolean);
    if (missing.length) return corsJson({ error: `Required: ${missing.join(", ")}.` }, { status: 400 });
    if (unreadable) return corsJson(await skipFound(user, profileId, jobLink, "Could not read the job page"));
    try {
      return corsJson(await describeFound(user, profileId, jobLink, jobDescription));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/OPENAI_API_KEY|cannot generate resumes|rate limit|timed out|timeout/i.test(message)) {
        return corsJson({ error: message, retryLater: true }, { status: 503 });
      }
      throw error;
    }
  });
}
