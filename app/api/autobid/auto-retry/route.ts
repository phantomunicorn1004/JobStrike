import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { autoRetryBids } from "@/lib/autobid/claim";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autobid/auto-retry — body { version }.
 * Retries eligible needs_you jobs whose errors look fixable.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid auto-retry", async (user) => {
    const body = await readJson(request);
    const version = String(body.version ?? "");
    if (!version) return corsJson({ error: "version is required." }, { status: 400 });
    const result = await autoRetryBids(user.id, version);
    return corsJson(result);
  });
}
