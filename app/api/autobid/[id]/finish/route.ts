import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { finishBid, type BidOutcome } from "@/lib/autobid/claim";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

const OUTCOMES: BidOutcome[] = ["submitted", "needs_you", "failed"];

/**
 * POST /api/autobid/:id/finish — body { claimedAt, outcome, detail, meta }.
 * outcome: submitted (the site confirmed it), needs_you (stopped for the
 * user: detail says why), failed (could not be attempted).
 */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "auto-bid finish", async (user) => {
    const id = await idParam(context);
    const body = await readJson(request);
    const claimedAt = String(body.claimedAt ?? "").trim();
    const outcome = String(body.outcome ?? "") as BidOutcome;
    if (!id || !claimedAt || !OUTCOMES.includes(outcome)) {
      return corsJson({ ok: false, error: "id, claimedAt and outcome are required." }, { status: 400 });
    }
    const meta =
      body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
        ? (body.meta as Record<string, unknown>)
        : {};
    const ok = await finishBid(user.id, id, claimedAt, outcome, String(body.detail ?? ""), meta);
    return corsJson(ok ? { ok: true, outcome } : { ok: false, claimLost: true });
  });
}
