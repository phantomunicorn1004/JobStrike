import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { retryBids } from "@/lib/autobid/claim";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autobid/retry — body { ids }. Needs-you and failed jobs that were
 * not sent go back to the runner. Submitted jobs are never retried.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid retry", async (user) => {
    const raw = (await readJson(request)).ids;
    const ids = (Array.isArray(raw) ? raw : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 200);
    if (!ids.length) return corsJson({ error: "ids is required." }, { status: 400 });
    return corsJson({ retried: await retryBids(user.id, ids) });
  });
}
