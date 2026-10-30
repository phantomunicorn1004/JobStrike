import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { bidSummary } from "@/lib/autobid/claim";
import { autogenRoute } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * GET /api/autobid/summary?since=ISO — { ready, submittedSince, needsYou[] }:
 * jobs waiting for the runner, sent since `since` (the runner's local midnight,
 * for its daily limit), and the ones stopped for the user.
 */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "auto-bid summary", async (user) => {
    const raw = new URL(request.url).searchParams.get("since") ?? "";
    const since = Number.isNaN(Date.parse(raw)) ? new Date(Date.now() - 86_400_000).toISOString() : new Date(raw).toISOString();
    return corsJson(await bidSummary(user.id, since));
  });
}
