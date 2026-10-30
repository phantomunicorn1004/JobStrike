import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { recordBidStep } from "@/lib/autobid/claim";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** POST /api/autobid/:id/step — body { claimedAt, step }. What the runner is doing now, for the Auto-bid page. */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "auto-bid step", async (user) => {
    const id = await idParam(context);
    const body = await readJson(request);
    const claimedAt = String(body.claimedAt ?? "").trim();
    const step = String(body.step ?? "").trim();
    if (!id || !claimedAt || !step) {
      return corsJson({ ok: false, error: "id, claimedAt and step are required." }, { status: 400 });
    }
    return corsJson({ ok: await recordBidStep(user.id, id, claimedAt, step) });
  });
}
