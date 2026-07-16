import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser, resolveRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { findUserById, updateAppUser } from "@/lib/auth/repository";
import { DEFAULT_TIMEZONE, getTimeZoneOptionLabel, isValidTimeZone, normalizeTimeZone, TIMEZONE_OPTIONS } from "@/lib/timezone";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }
    const current = await findUserById(user.id);
    const timezone = normalizeTimeZone(current?.timezone ?? user.timezone ?? DEFAULT_TIMEZONE);
    return corsJson({
      timezone,
      label: getTimeZoneOptionLabel(timezone),
      options: TIMEZONE_OPTIONS.map((id) => ({
        id,
        label: getTimeZoneOptionLabel(id),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load timezone.";
    return corsJson({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const raw = String(body.timezone ?? "").trim();
    if (!isValidTimeZone(raw)) {
      return corsJson({ error: "Invalid timezone." }, { status: 400 });
    }
    const updated = await updateAppUser(user.id, { timezone: raw });
    const timezone = normalizeTimeZone(updated.timezone);
    return corsJson({
      ok: true,
      timezone,
      label: getTimeZoneOptionLabel(timezone),
      options: TIMEZONE_OPTIONS.map((id) => ({
        id,
        label: getTimeZoneOptionLabel(id),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update timezone.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
