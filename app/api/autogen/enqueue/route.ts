import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { enqueueApplications } from "@/lib/autogen/claim";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autogen/enqueue — body { ids: number[] } (up to 200). Queues
 * existing Resume DB rows for generation: retry failed ones, regenerate
 * completed ones. Rows being generated right now are left alone.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "enqueue", async (user) => {
    const raw = (await readJson(request)).ids;
    const ids = (Array.isArray(raw) ? raw : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 200);
    if (!ids.length) return corsJson({ error: "ids is required." }, { status: 400 });
    return corsJson({ queued: await enqueueApplications(user.id, ids) });
  });
}
