import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { mapApplicationRow } from "@/lib/resume-db/repository";
import type { ResumeDbApplication } from "@/lib/resume-db/types";

/** A claim nobody has refreshed for this long is abandoned (window closed, crash) and claimable again. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/** How often a worker re-stamps a claim it is still working on. */
export const CLAIM_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

const TABLE = "resume_db_applications";
const MISSING_COLUMNS = "Resume generation columns are missing. Run scripts/add-autogen-to-resume-db.sql in Supabase.";

/** The error to show when a query failed because the migration has not run, else the original. */
export function explainMissingColumns(message: string): string {
  return /generation_status|autogen_claimed_at|generation_error|built_resume_json|generation_meta|job_description/i.test(
    message,
  )
    ? MISSING_COLUMNS
    : message;
}

function rethrow(message: string): never {
  throw new Error(explainMissingColumns(message));
}

function staleCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - STALE_CLAIM_MS).toISOString();
}

export function isClaimStale(claimedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!claimedAt) return true;
  const ts = new Date(claimedAt).getTime();
  return !Number.isFinite(ts) || nowMs - ts >= STALE_CLAIM_MS;
}

/** Queued rows, newest first, for the worker's list. */
export async function listQueuedApplications(userId: string): Promise<ResumeDbApplication[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .in("generation_status", ["queue", "generating", "failed"])
    .order("id", { ascending: false })
    .limit(200);
  if (error) rethrow(error.message);
  return (data ?? []).map((row) => mapApplicationRow(row as Record<string, unknown>));
}

export type ClaimResult =
  | { ok: true; application: ResumeDbApplication }
  | { ok: false; reason: "not_found" | "not_claimable" };

/**
 * Compare-and-swap: a queued row, or a generating row whose claim went stale,
 * becomes generating with a fresh claim stamp. Two workers can never both win.
 */
export async function tryClaimApplication(userId: string, applicationId: number): Promise<ClaimResult> {
  const supabase = getSupabaseAdminClient();
  const { data: current, error: readError } = await supabase
    .from(TABLE)
    .select("id, generation_status, autogen_claimed_at")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) rethrow(readError.message);
  if (!current) return { ok: false, reason: "not_found" };

  const row = current as { generation_status: string; autogen_claimed_at: string | null };
  const queued = row.generation_status === "queue";
  const abandoned = row.generation_status === "generating" && isClaimStale(row.autogen_claimed_at);
  if (!queued && !abandoned) return { ok: false, reason: "not_claimable" };

  let update = supabase
    .from(TABLE)
    .update({
      generation_status: "generating",
      autogen_claimed_at: new Date().toISOString(),
      generation_error: "",
    } as never)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("generation_status", row.generation_status);
  update = abandoned
    ? row.autogen_claimed_at
      ? update.eq("autogen_claimed_at", row.autogen_claimed_at)
      : update.is("autogen_claimed_at", null)
    : update;

  const { data, error } = await update.select("*").maybeSingle();
  if (error) rethrow(error.message);
  if (!data) return { ok: false, reason: "not_claimable" };
  return { ok: true, application: mapApplicationRow(data as Record<string, unknown>) };
}

/** Claims the oldest queued row, else the oldest abandoned claim; null when there is none. */
export async function claimNextApplication(userId: string): Promise<ResumeDbApplication | null> {
  const supabase = getSupabaseAdminClient();
  const { data: queued, error } = await supabase
    .from(TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("generation_status", "queue")
    .order("id", { ascending: true })
    .limit(20);
  if (error) rethrow(error.message);

  const { data: stale, error: staleError } = await supabase
    .from(TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("generation_status", "generating")
    .lt("autogen_claimed_at", staleCutoffIso())
    .order("id", { ascending: true })
    .limit(10);
  if (staleError) rethrow(staleError.message);

  for (const { id } of [...(queued ?? []), ...(stale ?? [])] as Array<{ id: number }>) {
    const claimed = await tryClaimApplication(userId, Number(id));
    if (claimed.ok) return claimed.application;
  }
  return null;
}

/** Re-stamps a claim the caller still holds; { ok: false } once another worker has taken it over. */
export async function refreshClaim(
  userId: string,
  applicationId: number,
  claimedAt: string,
): Promise<{ ok: true; claimedAt: string } | { ok: false }> {
  const next = new Date().toISOString();
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ autogen_claimed_at: next } as never)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("generation_status", "generating")
    .eq("autogen_claimed_at", claimedAt)
    .select("id")
    .maybeSingle();
  if (error) rethrow(error.message);
  return data ? { ok: true, claimedAt: next } : { ok: false };
}

/** Saves the checked resume, only while the caller still holds the claim. */
export async function completeClaim(
  userId: string,
  applicationId: number,
  claimedAt: string,
  builtResumeJson: string,
  meta: Record<string, unknown>,
): Promise<ResumeDbApplication | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({
      generation_status: "completed",
      generation_error: "",
      autogen_claimed_at: null,
      built_resume_json: builtResumeJson,
      generation_meta: meta,
    } as never)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("generation_status", "generating")
    .eq("autogen_claimed_at", claimedAt)
    .select("*")
    .maybeSingle();
  if (error) rethrow(error.message);
  return data ? mapApplicationRow(data as Record<string, unknown>) : null;
}

/**
 * Ends a claim: back to the queue (worker stopped) or failed with the reason.
 * With claimedAt, only the holder can do it; without, any generating row (Resume DB UI).
 */
export async function releaseClaim(
  userId: string,
  applicationId: number,
  to: "queue" | "failed",
  options: { claimedAt?: string; detail?: string } = {},
): Promise<ResumeDbApplication | null> {
  let update = getSupabaseAdminClient()
    .from(TABLE)
    .update({
      generation_status: to,
      autogen_claimed_at: null,
      generation_error: to === "failed" ? String(options.detail || "Generation failed.").slice(0, 4000) : "",
    } as never)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("generation_status", "generating");
  if (options.claimedAt) update = update.eq("autogen_claimed_at", options.claimedAt);
  const { data, error } = await update.select("*").maybeSingle();
  if (error) rethrow(error.message);
  return data ? mapApplicationRow(data as Record<string, unknown>) : null;
}

/**
 * Takes a still-queued row out of the queue (it was bid on by hand). Only a
 * row nobody has claimed: one being generated keeps its claim.
 */
export async function dequeueIfQueued(userId: string, applicationId: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ generation_status: "none" } as never)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .eq("generation_status", "queue")
    .select("id")
    .maybeSingle();
  if (error) rethrow(error.message);
  return Boolean(data);
}

export type GenerationState = { status: string; error: string };

/**
 * Generation state of the given rows, for the Resume DB list (rows never
 * queued are left out). Empty, not an error, before the migration has run.
 */
export async function listGenerationStates(
  userId: string,
  ids: number[],
): Promise<Map<number, GenerationState>> {
  const states = new Map<number, GenerationState>();
  if (!ids.length) return states;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("id, generation_status, generation_error")
    .eq("user_id", userId)
    .in("id", ids)
    .neq("generation_status", "none");
  if (error) {
    if (explainMissingColumns(error.message) === MISSING_COLUMNS) return states;
    rethrow(error.message);
  }
  for (const row of (data ?? []) as Array<{ id: number; generation_status: string; generation_error: string | null }>) {
    states.set(Number(row.id), { status: row.generation_status, error: row.generation_error ?? "" });
  }
  return states;
}

/** Puts rows (back) in the queue: new captures, failed rows retried, completed rows regenerated. */
export async function enqueueApplications(userId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ generation_status: "queue", generation_error: "", autogen_claimed_at: null } as never)
    .eq("user_id", userId)
    .in("id", ids)
    .neq("generation_status", "generating")
    .select("id");
  if (error) rethrow(error.message);
  return (data ?? []).length;
}
