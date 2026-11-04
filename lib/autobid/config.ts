import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  mergeAutobidConfig,
  toAutobidConfig,
  type AutobidConfig,
} from "@/lib/autobid/config-shape";

const MISSING_COLUMN = "The Auto-bid setup column is missing. Run scripts/add-autobid-config-to-app-users.sql in Supabase.";

/** Saves that collide with another save are tried again on the newer setup this many times. */
const SAVE_ATTEMPTS = 5;

function explain(message: string): string {
  return /autobid_config/i.test(message) ? MISSING_COLUMN : message;
}

async function readStored(userId: string): Promise<unknown> {
  const { data, error } = await getSupabaseAdminClient()
    .from("app_users")
    .select("autobid_config")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(explain(error.message));
  return (data as { autobid_config?: unknown } | null)?.autobid_config ?? null;
}

export async function readAutobidConfig(userId: string): Promise<AutobidConfig> {
  return toAutobidConfig(await readStored(userId));
}

/**
 * Saves an edit from the website or the panel. Each save raises the version,
 * so the panel on the VPS applies it exactly once. The write only lands if the
 * stored version is still the one the edit was merged onto; when another save
 * got there first, the edit is merged onto that one instead (last edit wins,
 * and no two saves share a version).
 */
/**
 * Panels up to JobStrike 4.42.5 that could not start (another panel open, AI
 * answers off, json2docx not running) saved the shared setup as stopped with a
 * "Not started: …" note. One panel's own problem must not stop the run for the
 * panels that can work: each job goes to one panel, and a panel that cannot
 * work shows why in its own status instead.
 */
const OLD_PANEL_REFUSAL = /^Not started: /;

export function isOldPanelRefusal(edit: Record<string, unknown>, by: "web" | "panel"): boolean {
  return by === "panel" && edit.running === false && OLD_PANEL_REFUSAL.test(String(edit.note ?? ""));
}

export async function saveAutobidConfig(
  userId: string,
  edit: Record<string, unknown>,
  by: "web" | "panel",
): Promise<{ config: AutobidConfig } | { error: string }> {
  if (isOldPanelRefusal(edit, by)) return { config: toAutobidConfig(await readStored(userId)) };
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
    const stored = await readStored(userId);
    const current = toAutobidConfig(stored);
    const merged = mergeAutobidConfig(current, edit);
    if ("error" in merged) return merged;
    const config: AutobidConfig = {
      ...merged.config,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: by,
    };
    const update = getSupabaseAdminClient()
      .from("app_users")
      .update({ autobid_config: config } as never)
      .eq("id", userId);
    const guarded = stored === null
      ? update.is("autobid_config", null)
      : update.eq("autobid_config->>version", String(current.version));
    const { data, error } = await guarded.select("id");
    if (error) throw new Error(explain(error.message));
    if (Array.isArray(data) && data.length > 0) return { config };
  }
  throw new Error("The Auto-bid setup is being changed elsewhere right now. Try again.");
}
