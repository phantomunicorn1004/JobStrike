import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { autogenRoute } from "@/lib/autogen/route";
import { fetchVerificationCode } from "@/lib/mail/verify-code";

export function OPTIONS() {
  return corsOptions();
}

/**
 * GET /api/autobid/verify-code?profileId=1
 *
 * Fetches the most recent Greenhouse verification code email for the profile's
 * connected mailbox (last 10 minutes). Returns { code, receivedAt, subject }
 * or { code: null } when nothing is found yet.
 */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "verify-code", async (user) => {
    const profileId = Number(request.nextUrl.searchParams.get("profileId"));
    if (!profileId || !Number.isInteger(profileId)) {
      return corsJson({ error: "profileId is required" }, { status: 400 });
    }
    const result = await fetchVerificationCode(user.id, profileId);
    return corsJson(result);
  });
}
