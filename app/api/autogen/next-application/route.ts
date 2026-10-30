import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { claimNextApplication } from "@/lib/autogen/claim";
import { autogenRoute, claimedResponse } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * GET /api/autogen/next-application — claims the oldest queued row (or an
 * abandoned claim) and returns it with its prompt. Rows whose kit cannot be
 * used are marked failed and the next one is tried.
 */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "next-application", async (user) => {
    const skipped: Array<{ id: number; reason: string }> = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const claimed = await claimNextApplication(user.id);
      if (!claimed) return corsJson({ application: null, skipped });
      const response = await claimedResponse(user.id, claimed);
      if (response.application) return corsJson({ ...response, skipped });
      skipped.push({ id: claimed.id, reason: response.reason });
    }
    return corsJson({ application: null, skipped });
  });
}
