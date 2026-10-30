import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { corsJson } from "@/lib/api/extensionCors";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import type { SessionUser } from "@/lib/auth/types";
import { releaseClaim } from "@/lib/autogen/claim";
import { toAutogenDto } from "@/lib/autogen/dto";
import { renderGenerationPrompt } from "@/lib/autogen/prompt";
import type { ResumeDbApplication } from "@/lib/resume-db/types";

export type IdContext = { params: Promise<{ id: string }> };

/** Runs an AutoGen route for the signed-in user (session or extension key), with CORS and 401s. */
export async function autogenRoute(
  request: NextRequest,
  label: string,
  handler: (user: SessionUser) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const user = await requireRequestUser(request);
    return await handler(user);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} failed.`;
    if (message === "Unauthorized") return corsJson(unauthorizedJson(), { status: 401 });
    console.error(`AutoGen ${label} error:`, error);
    return corsJson({ error: message }, { status: 500 });
  }
}

export async function idParam(context: IdContext): Promise<number | null> {
  const id = Number((await context.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/**
 * The response for a freshly claimed row: its prompt, or, when the kit or the
 * row cannot produce one, the row moved to failed with the reason (so it is
 * not claimed again on every tick) and { application: null, reason }.
 */
export async function claimedResponse(userId: string, app: ResumeDbApplication) {
  const rendered = await renderGenerationPrompt(userId, app);
  if (rendered.ok) return { application: toAutogenDto(app, rendered.prompt) };
  await releaseClaim(userId, app.id, "failed", {
    claimedAt: app.autogenClaimedAt ?? undefined,
    detail: rendered.detail,
  });
  return { application: null, reason: rendered.reason, detail: rendered.detail, id: app.id };
}
