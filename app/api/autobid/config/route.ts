import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { readAutobidConfig, saveAutobidConfig } from "@/lib/autobid/config";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** GET /api/autobid/config — { config }: the Auto-bid setup the VPS panel follows. */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "auto-bid setup", async (user) => corsJson({ config: await readAutobidConfig(user.id) }));
}

/**
 * PUT /api/autobid/config — body { ...changes, by?: "panel" }. Start/Stop and
 * settings from the website or the JobStrike panel. 400 with { error } when
 * the change cannot be saved (no profile, bad hours).
 */
export async function PUT(request: NextRequest) {
  return autogenRoute(request, "auto-bid setup", async (user) => {
    const { by, ...edit } = await readJson(request);
    const result = await saveAutobidConfig(user.id, edit, by === "panel" ? "panel" : "web");
    if ("error" in result) return corsJson({ error: result.error }, { status: 400 });
    return corsJson({ config: result.config });
  });
}
