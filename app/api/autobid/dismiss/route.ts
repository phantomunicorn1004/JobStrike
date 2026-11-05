import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { dismissBids } from "@/lib/autobid/claim";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autobid/dismiss — body { ids }. Needs-you, failed and failed-resume
 * jobs leave Needs you for Finished; nothing picks them up again.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid dismiss", async (user) => {
    const raw = (await readJson(request)).ids;
    const ids = (Array.isArray(raw) ? raw : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 200);
    if (!ids.length) return corsJson({ error: "ids is required." }, { status: 400 });
    return corsJson({ dismissed: await dismissBids(user.id, ids) });
  });
}
