import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Which extension a report comes from. */
export type RunnerKind = "autobid" | "autogen";

const COLUMN: Record<RunnerKind, string> = { autobid: "autobid_status", autogen: "autogen_status" };
const MISSING_COLUMNS = "Runner status columns are missing. Run scripts/add-runner-status-to-app-users.sql in Supabase.";
/** A report is a small summary; anything larger is refused rather than stored. */
const MAX_REPORT_CHARS = 32_000;

export type RunnerStatuses = {
  autobid: Record<string, unknown> | null;
  autogen: Record<string, unknown> | null;
  /** Set when the migration has not run: the page says so instead of failing. */
  setupError?: string;
};

function explain(message: string): string {
  return /autobid_status|autogen_status/i.test(message) ? MISSING_COLUMNS : message;
}

/** Saves an extension's latest report, stamped with the server's time. */
export async function saveRunnerStatus(userId: string, kind: RunnerKind, report: Record<string, unknown>): Promise<void> {
  const value = { ...report, reportedAt: new Date().toISOString() };
  if (JSON.stringify(value).length > MAX_REPORT_CHARS) throw new Error("Status report is too large.");
  const { error } = await getSupabaseAdminClient()
    .from("app_users")
    .update({ [COLUMN[kind]]: value } as never)
    .eq("id", userId);
  if (error) throw new Error(explain(error.message));
}

export async function readRunnerStatuses(userId: string): Promise<RunnerStatuses> {
  const { data, error } = await getSupabaseAdminClient()
    .from("app_users")
    .select("autobid_status, autogen_status")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    const message = explain(error.message);
    if (message === MISSING_COLUMNS) return { autobid: null, autogen: null, setupError: message };
    throw new Error(message);
  }
  const row = (data ?? {}) as { autobid_status?: unknown; autogen_status?: unknown };
  const asObject = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  return { autobid: asObject(row.autobid_status), autogen: asObject(row.autogen_status) };
}
