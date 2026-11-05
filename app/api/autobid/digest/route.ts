import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { listAutobidJobs } from "@/lib/autobid/claim";
import { digestOf } from "@/lib/autobid/insights";
import { autogenRoute } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** GET /api/autobid/digest?since=ISO&until=ISO — what Auto-bid did in that window (default: the last 24 h). */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "auto-bid digest", async (user) => {
    const params = request.nextUrl.searchParams;
    const until = Date.parse(params.get("until") ?? "") || Date.now();
    const since = Date.parse(params.get("since") ?? "") || until - 24 * 60 * 60 * 1000;
    if (since >= until) return corsJson({ error: "since must be before until." }, { status: 400 });
    return corsJson({ digest: digestOf(await listAutobidJobs(user.id), since, until) });
  });
}
