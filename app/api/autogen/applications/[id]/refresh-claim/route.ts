import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { refreshClaim } from "@/lib/autogen/claim";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autogen/applications/:id/refresh-claim — body { claimedAt }.
 * Keeps a long generation from looking abandoned. { ok: false } means another
 * worker has taken the row over: stop working on it.
 */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "refresh-claim", async (user) => {
    const id = await idParam(context);
    const claimedAt = String((await readJson(request)).claimedAt ?? "").trim();
    if (!id || !claimedAt) return corsJson({ ok: false }, { status: 400 });
    return corsJson(await refreshClaim(user.id, id, claimedAt));
  });
}
