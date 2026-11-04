import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Which extension a report comes from. */
export type RunnerKind = "autobid" | "autogen";

const COLUMN: Record<RunnerKind, string> = { autobid: "autobid_status", autogen: "autogen_status" };
const MISSING_COLUMNS = "Runner status columns are missing. Run scripts/add-runner-status-to-app-users.sql in Supabase.";
/** A report is a small summary; anything larger is refused rather than stored. */
const MAX_REPORT_CHARS = 32_000;

/** One machine's latest report: each JobStrike panel and each AutoGen has its own. */
export type WorkerReport = {
  instanceId: string;
  kind: "panel" | "autogen";
  reportedAt: string;
  status: Record<string, unknown>;
};

/** Machines that reported within this long are listed. */
const WORKER_RECENT_MS = 10 * 60 * 1000;

export type RunnerStatuses = {
  autobid: Record<string, unknown> | null;
  autogen: Record<string, unknown> | null;
  /** Every machine that reported recently, newest first. */
  workers: WorkerReport[];
  /** Set when the migration has not run: the page says so instead of failing. */
  setupError?: string;
};

function explain(message: string): string {
  return /autobid_status|autogen_status/i.test(message) ? MISSING_COLUMNS : message;
}

/** Who wrote a report and when: a panel sees from it that another one is open. */
export type ReportStamp = { instanceId: string | null; reportedAt: string | null };

/**
 * Saves an extension's latest report, stamped with the server's time, and
 * returns the stamp of the report it replaced (null when there was none).
 */
export async function saveRunnerStatus(
  userId: string,
  kind: RunnerKind,
  report: Record<string, unknown>,
): Promise<ReportStamp | null> {
  const value = { ...report, reportedAt: new Date().toISOString() };
  if (JSON.stringify(value).length > MAX_REPORT_CHARS) throw new Error("Status report is too large.");
  const supabase = getSupabaseAdminClient();
  const before = await supabase.from("app_users").select(COLUMN[kind]).eq("id", userId).maybeSingle();
  if (before.error) throw new Error(explain(before.error.message));
  const { error } = await supabase
    .from("app_users")
    .update({ [COLUMN[kind]]: value } as never)
    .eq("id", userId);
  if (error) throw new Error(explain(error.message));
  await saveWorker(userId, kind, value);
  const previous = (before.data as Record<string, unknown> | null)?.[COLUMN[kind]] as Record<string, unknown> | null | undefined;
  if (!previous || typeof previous !== "object") return null;
  return {
    instanceId: typeof previous.instanceId === "string" ? previous.instanceId : null,
    reportedAt: typeof previous.reportedAt === "string" ? previous.reportedAt : null,
  };
}

/**
 * The machine's own row (scripts/add-autobid-candidates.sql). A report without
 * an instance id (an older extension) is kept under one id per kind. Never
 * fails the report: before the migration the single report above still works.
 */
async function saveWorker(userId: string, kind: RunnerKind, value: Record<string, unknown>) {
  const instanceId = typeof value.instanceId === "string" && value.instanceId ? value.instanceId : `${kind}-default`;
  const { error } = await getSupabaseAdminClient()
    .from("autobid_workers")
    .upsert(
      {
        user_id: userId,
        instance_id: instanceId.slice(0, 80),
        kind: kind === "autobid" ? "panel" : "autogen",
        reported_at: value.reportedAt,
        status: value,
      } as never,
      { onConflict: "user_id,instance_id" },
    );
  if (error && !/autobid_workers/i.test(error.message)) throw new Error(error.message);
}

async function readWorkers(userId: string): Promise<WorkerReport[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from("autobid_workers")
    .select("instance_id, kind, reported_at, status")
    .eq("user_id", userId)
    .gte("reported_at", new Date(Date.now() - WORKER_RECENT_MS).toISOString())
    .order("reported_at", { ascending: false });
  if (error) return []; // before the migration
  return ((data ?? []) as Array<{ instance_id: string; kind: "panel" | "autogen"; reported_at: string; status: Record<string, unknown> }>).map(
    (row) => ({ instanceId: row.instance_id, kind: row.kind, reportedAt: row.reported_at, status: row.status }),
  );
}

export async function readRunnerStatuses(userId: string): Promise<RunnerStatuses> {
  const { data, error } = await getSupabaseAdminClient()
    .from("app_users")
    .select("autobid_status, autogen_status")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    const message = explain(error.message);
    if (message === MISSING_COLUMNS) return { autobid: null, autogen: null, workers: [], setupError: message };
    throw new Error(message);
  }
  const row = (data ?? {}) as { autobid_status?: unknown; autogen_status?: unknown };
  const asObject = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  return { autobid: asObject(row.autobid_status), autogen: asObject(row.autogen_status), workers: await readWorkers(userId) };
}
