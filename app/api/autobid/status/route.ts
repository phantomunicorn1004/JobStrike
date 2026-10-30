import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { readRunnerStatuses, saveRunnerStatus } from "@/lib/autobid/status";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** GET /api/autobid/status — { autobid, autogen }: the extensions' latest reports, for the Auto-bid page. */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "runner status", async (user) => corsJson(await readRunnerStatuses(user.id)));
}

/**
 * POST /api/autobid/status — body { kind: "autobid" | "autogen", status }.
 * The JobStrike panel (Auto-bid, Live) and AutoGen report what they are doing.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "runner status", async (user) => {
    const body = await readJson(request);
    const kind = body.kind === "autogen" ? "autogen" : body.kind === "autobid" ? "autobid" : null;
    const status = body.status;
    if (!kind || !status || typeof status !== "object" || Array.isArray(status)) {
      return corsJson({ ok: false, error: "kind and status are required." }, { status: 400 });
    }
    await saveRunnerStatus(user.id, kind, status as Record<string, unknown>);
    return corsJson({ ok: true });
  });
}
