import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { tryClaimApplication } from "@/lib/autogen/claim";
import { autogenRoute, claimedResponse, idParam, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** POST /api/autogen/applications/:id/claim — claims one chosen row and returns its prompt. */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "claim", async (user) => {
    const id = await idParam(context);
    if (!id) return corsJson({ application: null, reason: "not_found" }, { status: 400 });
    const claimed = await tryClaimApplication(user.id, id);
    if (!claimed.ok) return corsJson({ application: null, reason: claimed.reason });
    return corsJson(await claimedResponse(user.id, claimed.application));
  });
}
