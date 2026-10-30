import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { releaseClaim } from "@/lib/autogen/claim";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** POST /api/autogen/applications/:id/report-failure — body { claimedAt, detail }. Out of retries: failed. */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "report-failure", async (user) => {
    const id = await idParam(context);
    const body = await readJson(request);
    const claimedAt = String(body.claimedAt ?? "").trim();
    if (!id || !claimedAt) return corsJson({ ok: false, error: "id and claimedAt are required." }, { status: 400 });
    const updated = await releaseClaim(user.id, id, "failed", { claimedAt, detail: String(body.detail ?? "") });
    return corsJson(updated ? { ok: true, status: "failed" } : { ok: false, claimLost: true });
  });
}
