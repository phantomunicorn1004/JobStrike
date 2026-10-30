import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { QUEUED_APPLY } from "@/lib/resume-db/types";
import { toAutobidJob, type AutobidJob, type AutobidRowInput } from "@/lib/autobid/stages";

/** A claim this old is abandoned (panel closed, crash): the row can be taken again. */
export const BID_STALE_MS = 20 * 60 * 1000;

const TABLE = "resume_db_applications";
const MISSING_COLUMNS = "Auto-bid columns are missing. Run scripts/add-autobid-to-resume-db.sql in Supabase.";

export const BID_STATES = ["none", "bidding", "submitted", "needs_you", "failed"] as const;
export type BidState = (typeof BID_STATES)[number];
/** What the runner reports when it is done with a row. */
export type BidOutcome = "submitted" | "needs_you" | "failed";

/** The error to show when a query failed because the migration has not run, else the original. */
export function explainMissingBidColumns(message: string): string {
  return /bid_state|bid_claimed_at|bid_error|bid_meta/i.test(message) ? MISSING_COLUMNS : message;
}

function rethrow(message: string): never {
  throw new Error(explainMissingBidColumns(message));
}

/** One job for the runner: everything it needs to apply, with the claim it holds. */
export type BidJob = {
  id: number;
  profile_id: number | null;
  candidate: string;
  job_link: string;
  job_title: string;
  company: string;
  job_description: string;
  built_resume_json: string;
  claimed_at: string;
};

type BidRow = {
  id: number;
  profile_id: number | null;
  candidate_name: string | null;
  job_link: string | null;
  job_title: string | null;
  company: string | null;
  job_description: string | null;
  note: string | null;
  built_resume_json: string | null;
  bid_state: string;
  bid_claimed_at: string | null;
};

function toBidJob(row: BidRow): BidJob {
  return {
    id: Number(row.id),
    profile_id: row.profile_id ?? null,
    candidate: row.candidate_name ?? "",
    job_link: row.job_link ?? "",
    job_title: row.job_title ?? "",
    company: row.company ?? "",
    job_description: String(row.job_description || row.note || ""),
    built_resume_json: row.built_resume_json ?? "",
    claimed_at: row.bid_claimed_at ?? "",
  };
}

function staleCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - BID_STALE_MS).toISOString();
}

/** Rows ready to be applied to: resume generated, not sent, never attempted. */
function readyRows(userId: string) {
  return getSupabaseAdminClient()
    .from(TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("generation_status", "completed")
    .eq("apply", QUEUED_APPLY)
    .eq("bid_state", "none");
}

/**
 * Compare-and-swap: a ready row, or a bidding row whose claim went stale,
 * becomes bidding with a fresh claim. Two runners can never both win.
 */
async function tryClaimBid(userId: string, id: number): Promise<BidJob | null> {
  const supabase = getSupabaseAdminClient();
  const { data: current, error: readError } = await supabase
    .from(TABLE)
    .select("id, bid_state, bid_claimed_at, generation_status, apply")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) rethrow(readError.message);
  const row = current as
    | { bid_state: string; bid_claimed_at: string | null; generation_status: string; apply: string }
    | null;
  if (!row || row.generation_status !== "completed" || row.apply !== QUEUED_APPLY) return null;
  const ready = row.bid_state === "none";
  const abandoned =
    row.bid_state === "bidding" &&
    (!row.bid_claimed_at || Date.now() - new Date(row.bid_claimed_at).getTime() >= BID_STALE_MS);
  if (!ready && !abandoned) return null;

  const now = new Date().toISOString();
  let update = supabase
    .from(TABLE)
    .update({
      bid_state: "bidding",
      bid_claimed_at: now,
      bid_error: "",
      bid_meta: { startedAt: now, step: "Taken by the runner", steps: [{ at: now, text: "Taken by the runner" }] },
    } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", row.bid_state);
  if (abandoned) {
    update = row.bid_claimed_at ? update.eq("bid_claimed_at", row.bid_claimed_at) : update.is("bid_claimed_at", null);
  }
  const { data, error } = await update
    .select(
      "id, profile_id, candidate_name, job_link, job_title, company, job_description, note, built_resume_json, bid_state, bid_claimed_at",
    )
    .maybeSingle();
  if (error) rethrow(error.message);
  return data ? toBidJob(data as BidRow) : null;
}

/** Claims the oldest ready row (then the oldest abandoned claim); null when there is none. */
export async function claimNextBid(userId: string): Promise<BidJob | null> {
  const { data: ready, error } = await readyRows(userId).order("id", { ascending: true }).limit(10);
  if (error) rethrow(error.message);
  const { data: stale, error: staleError } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("bid_state", "bidding")
    .lt("bid_claimed_at", staleCutoffIso())
    .order("id", { ascending: true })
    .limit(5);
  if (staleError) rethrow(staleError.message);
  for (const { id } of [...(ready ?? []), ...(stale ?? [])] as Array<{ id: number }>) {
    const job = await tryClaimBid(userId, Number(id));
    if (job) return job;
  }
  return null;
}

const MAX_LOGGED_STEPS = 40;

/** The claimed row's bid_meta, while the caller still holds the claim; null when it does not. */
async function heldBidMeta(userId: string, id: number, claimedAt: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("bid_meta")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", "bidding")
    .eq("bid_claimed_at", claimedAt)
    .maybeSingle();
  if (error) rethrow(error.message);
  if (!data) return null;
  const meta = (data as { bid_meta: unknown }).bid_meta;
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

function withLoggedStep(meta: Record<string, unknown>, text: string, at: string): Record<string, unknown> {
  const steps = Array.isArray(meta.steps) ? meta.steps : [];
  return { ...meta, steps: [...steps, { at, text: text.slice(0, 300) }].slice(-MAX_LOGGED_STEPS) };
}

/** What the runner is doing now, for the Auto-bid page. Only the claim holder can write it. */
export async function recordBidStep(userId: string, id: number, claimedAt: string, step: string): Promise<boolean> {
  const current = await heldBidMeta(userId, id, claimedAt);
  if (!current) return false;
  const at = new Date().toISOString();
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ bid_meta: { ...withLoggedStep(current, step, at), step: step.slice(0, 300) } } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", "bidding")
    .eq("bid_claimed_at", claimedAt)
    .select("id")
    .maybeSingle();
  if (error) rethrow(error.message);
  return Boolean(data);
}

const OUTCOME_STEP: Record<BidOutcome, string> = {
  submitted: "Sent: the site confirmed the application",
  needs_you: "Stopped: needs you",
  failed: "Failed",
};

/** Records the outcome, only while the caller still holds the claim. Keeps the step history. */
export async function finishBid(
  userId: string,
  id: number,
  claimedAt: string,
  outcome: BidOutcome,
  detail: string,
  meta: Record<string, unknown>,
): Promise<boolean> {
  const current = await heldBidMeta(userId, id, claimedAt);
  if (!current) return false;
  const at = new Date().toISOString();
  const { steps: _ignored, step: _current, ...reported } = meta;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({
      bid_state: outcome,
      bid_claimed_at: null,
      bid_error: outcome === "submitted" ? "" : String(detail || "Stopped.").slice(0, 4000),
      bid_meta: {
        ...withLoggedStep(current, detail && outcome !== "submitted" ? `${OUTCOME_STEP[outcome]} — ${detail}` : OUTCOME_STEP[outcome], at),
        ...reported,
        step: "",
        finishedAt: at,
      },
    } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", "bidding")
    .eq("bid_claimed_at", claimedAt)
    .select("id")
    .maybeSingle();
  if (error) rethrow(error.message);
  return Boolean(data);
}

/** Gives a claimed row back untouched (the runner stopped before Submit). */
export async function releaseBid(userId: string, id: number, claimedAt: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ bid_state: "none", bid_claimed_at: null } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", "bidding")
    .eq("bid_claimed_at", claimedAt)
    .select("id")
    .maybeSingle();
  if (error) rethrow(error.message);
  return Boolean(data);
}

/**
 * A queued row was just registered (by the runner after Submit, or by hand):
 * notes when, for the Auto-bid page. Rows the runner never touched are left alone.
 */
export async function noteBidRegistered(userId: string, id: number): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("bid_state, bid_meta")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) rethrow(error.message);
  const row = data as { bid_state: string; bid_meta: Record<string, unknown> | null } | null;
  if (!row || row.bid_state === "none" || row.bid_state === "bidding") return;
  const at = new Date().toISOString();
  const { error: updateError } = await supabase
    .from(TABLE)
    .update({ bid_meta: { ...withLoggedStep(row.bid_meta ?? {}, "Registered in Resume DB", at), registeredAt: at } } as never)
    .eq("id", id)
    .eq("user_id", userId);
  if (updateError) rethrow(updateError.message);
}

/** Needs-you and failed rows, still not sent, go back to the runner. Submitted ones never do. */
export async function retryBids(userId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ bid_state: "none", bid_error: "", bid_claimed_at: null } as never)
    .eq("user_id", userId)
    .in("id", ids)
    .in("bid_state", ["needs_you", "failed"])
    .eq("apply", QUEUED_APPLY)
    .select("id");
  if (error) rethrow(error.message);
  return (data ?? []).length;
}

export type BidSummary = {
  ready: number;
  submittedSince: number;
  needsYou: Array<{ id: number; candidate: string; jobTitle: string; company: string; jobLink: string; reason: string }>;
};

/** For the runner's card: how many are waiting, sent since `sinceIso`, and what needs the user. */
export async function bidSummary(userId: string, sinceIso: string): Promise<BidSummary> {
  const supabase = getSupabaseAdminClient();
  const [ready, submitted, needs] = await Promise.all([
    getSupabaseAdminClient()
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("generation_status", "completed")
      .eq("apply", QUEUED_APPLY)
      .eq("bid_state", "none"),
    supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("bid_state", "submitted")
      .gte("bid_meta->>finishedAt", sinceIso),
    supabase
      .from(TABLE)
      .select("id, candidate_name, job_title, company, job_link, bid_error")
      .eq("user_id", userId)
      .eq("bid_state", "needs_you")
      .eq("apply", QUEUED_APPLY)
      .order("id", { ascending: false })
      .limit(50),
  ]);
  for (const result of [ready, submitted, needs]) if (result.error) rethrow(result.error.message);
  return {
    ready: ready.count ?? 0,
    submittedSince: submitted.count ?? 0,
    needsYou: ((needs.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      candidate: String(row.candidate_name ?? ""),
      jobTitle: String(row.job_title ?? ""),
      company: String(row.company ?? ""),
      jobLink: String(row.job_link ?? ""),
      reason: String(row.bid_error ?? ""),
    })),
  };
}

export type BidStateEntry = { state: string; error: string; submitClicked: boolean };

/** Bid state of the given rows, for the Resume DB list. Empty before the migration has run. */
export async function listBidStates(userId: string, ids: number[]): Promise<Map<number, BidStateEntry>> {
  const states = new Map<number, BidStateEntry>();
  if (!ids.length) return states;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("id, bid_state, bid_error, bid_meta")
    .eq("user_id", userId)
    .in("id", ids)
    .neq("bid_state", "none");
  if (error) {
    if (explainMissingBidColumns(error.message) === MISSING_COLUMNS) return states;
    rethrow(error.message);
  }
  for (const row of (data ?? []) as Array<{
    id: number;
    bid_state: string;
    bid_error: string | null;
    bid_meta: Record<string, unknown> | null;
  }>) {
    states.set(Number(row.id), {
      state: row.bid_state,
      error: row.bid_error ?? "",
      submitClicked: Boolean(row.bid_meta?.submitClicked),
    });
  }
  return states;
}

/** How many jobs the Auto-bid page shows (newest first). */
const MONITOR_LIMIT = 300;

/**
 * The jobs in the automatic chain, newest first: still queued (Applied =
 * Queued), or touched by the runner. Rows only ever bid by hand are left out.
 */
export async function listAutobidJobs(userId: string): Promise<AutobidJob[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select(
      "id, profile_id, candidate_name, company, job_title, job_link, apply, created_at, generation_status, generation_error, generation_meta, autogen_claimed_at, bid_state, bid_error, bid_meta, bid_claimed_at",
    )
    .eq("user_id", userId)
    .or(`apply.eq.${QUEUED_APPLY},bid_state.neq.none`)
    .order("id", { ascending: false })
    .limit(MONITOR_LIMIT);
  if (error) rethrow(error.message);
  return ((data ?? []) as AutobidRowInput[]).map(toAutobidJob);
}
