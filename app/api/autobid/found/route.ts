import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { listFound, recordFound, toFoundJob, type FoundJob } from "@/lib/autobid/candidates";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** GET /api/autobid/found — { found }: jobs Live found in the last 24 hours, with the server's decision. */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "auto-bid found list", async (user) => corsJson({ found: await listFound(user.id) }));
}

/**
 * POST /api/autobid/found — body { profileId, jobs: [{ jobLink, jobTitle, company, source, postedAt }] }.
 * Live's new jobs for a profile, without descriptions. The server keeps each
 * job once, skips what fails the site and title check, and answers
 * { received, skipped: [{ jobLink, reason }], wantJd: [jobLink] }: wantJd are
 * the jobs whose description it needs next, sent one at a time to
 * /api/autobid/found/describe.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid found", async (user) => {
    const body = await readJson(request);
    const profileId = Number(body.profileId ?? body.profile_id);
    if (!Number.isInteger(profileId) || profileId < 1) {
      return corsJson({ error: "Required: profileId." }, { status: 400 });
    }
    const jobs = (Array.isArray(body.jobs) ? body.jobs : []).map(toFoundJob).filter((job): job is FoundJob => job !== null);
    return corsJson(await recordFound(user, profileId, jobs));
  });
}
