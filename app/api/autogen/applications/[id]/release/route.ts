import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { releaseClaim } from "@/lib/autogen/claim";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** POST /api/autogen/applications/:id/release — body { claimedAt }. Worker stopped: back to the queue. */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "release", async (user) => {
    const id = await idParam(context);
    const claimedAt = String((await readJson(request)).claimedAt ?? "").trim();
    if (!id || !claimedAt) return corsJson({ ok: false, error: "id and claimedAt are required." }, { status: 400 });
    const updated = await releaseClaim(user.id, id, "queue", { claimedAt });
    return corsJson(updated ? { ok: true, status: "queue" } : { ok: false, claimLost: true });
  });
}
