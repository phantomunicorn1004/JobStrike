import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  mergeAutobidConfig,
  toAutobidConfig,
  type AutobidConfig,
} from "@/lib/autobid/config-shape";

const MISSING_COLUMN = "The Auto-bid setup column is missing. Run scripts/add-autobid-config-to-app-users.sql in Supabase.";

function explain(message: string): string {
  return /autobid_config/i.test(message) ? MISSING_COLUMN : message;
}

export async function readAutobidConfig(userId: string): Promise<AutobidConfig> {
  const { data, error } = await getSupabaseAdminClient()
    .from("app_users")
    .select("autobid_config")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(explain(error.message));
  return toAutobidConfig((data as { autobid_config?: unknown } | null)?.autobid_config);
}

/**
 * Saves an edit from the website or the panel. Each save raises the version,
 * so the panel on the VPS applies it exactly once. A save based on an older
 * version is still taken (last edit wins): both sides show the result.
 */
export async function saveAutobidConfig(
  userId: string,
  edit: Record<string, unknown>,
  by: "web" | "panel",
): Promise<{ config: AutobidConfig } | { error: string }> {
  const current = await readAutobidConfig(userId);
  const merged = mergeAutobidConfig(current, edit);
  if ("error" in merged) return merged;
  const config: AutobidConfig = {
    ...merged.config,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  const { error } = await getSupabaseAdminClient()
    .from("app_users")
    .update({ autobid_config: config } as never)
    .eq("id", userId);
  if (error) throw new Error(explain(error.message));
  return { config };
}
