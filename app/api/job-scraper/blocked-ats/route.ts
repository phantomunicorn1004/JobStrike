import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  addBlockedAts,
  deleteBlockedAts,
  listBlockedAts,
} from "@/lib/job-scraper-repository";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const blockedAts = await listBlockedAts(user.id);
    return corsJson({ blockedAts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load blocked ATS.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const note = String(body.note ?? "").trim() || null;

    const rawNames =
      typeof body.atsText === "string"
        ? body.atsText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [];
    const single = typeof body.atsName === "string" ? body.atsName.trim() : "";
    const names = rawNames.length > 0 ? rawNames : single ? [single] : [];

    if (names.length === 0) {
      return corsJson({ error: "ATS name is required." }, { status: 400 });
    }

    const added = [];
    for (const name of names) {
      try {
        added.push(await addBlockedAts(user.id, name, note));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Add failed.";
        if (!/duplicate/i.test(message)) {
          throw error;
        }
      }
    }

    const blockedAts = await listBlockedAts(user.id);
    return corsJson({ ok: true, added, blockedAts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save blocked ATS.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return corsJson({ error: "Missing id." }, { status: 400 });
    }
    await deleteBlockedAts(user.id, id);
    return corsJson({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete blocked ATS.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
