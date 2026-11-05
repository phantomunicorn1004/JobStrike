import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { confirmBid } from "@/lib/autobid/claim";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autobid/:id/confirm — body { confirmedBy, confirmText }.
 * Promotes a needs_you job to submitted after the tab watcher detected a
 * confirmation on a person-check tab (Ashby Submit, CAPTCHA, verification code).
 */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "auto-bid confirm", async (user) => {
    const id = await idParam(context);
    const body = await readJson(request);
    const confirmedBy = String(body.confirmedBy ?? "").trim();
    const confirmText = String(body.confirmText ?? "").trim();
    if (!id || !confirmedBy) {
      return corsJson({ ok: false, error: "id and confirmedBy are required." }, { status: 400 });
    }
    const ok = await confirmBid(user.id, id, confirmedBy, confirmText);
    return corsJson(ok ? { ok: true } : { ok: false, error: "Job not found or not in needs_you state." });
  });
}
