import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { releaseBid } from "@/lib/autobid/claim";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** POST /api/autobid/:id/release — body { claimedAt }. Stopped before Submit: the job waits again. */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "auto-bid release", async (user) => {
    const id = await idParam(context);
    const claimedAt = String((await readJson(request)).claimedAt ?? "").trim();
    if (!id || !claimedAt) return corsJson({ ok: false, error: "id and claimedAt are required." }, { status: 400 });
    return corsJson({ ok: await releaseBid(user.id, id, claimedAt) });
  });
}
