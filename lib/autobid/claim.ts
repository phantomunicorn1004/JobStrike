import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { QUEUED_APPLY } from "@/lib/resume-db/types";
import { STAGE_GROUP, stageOf, toAutobidJob, type AutobidGroup, type AutobidJob, type AutobidRowInput } from "@/lib/autobid/stages";
import { FRESH_HOURS, freshCutoffIso } from "@/lib/autobid/queue-rules";
import { jobAnswers, type JobAnswers } from "@/lib/autobid/job-answers";
import { missingFieldsOf } from "@/lib/autobid/saved-answers";
import { livesInUs, nonUsLocation, siteOf } from "@/lib/autobid/screen";

/** A claim this old is abandoned (panel closed, crash): the row can be taken again. */
export const BID_STALE_MS = 20 * 60 * 1000;

const TABLE = "resume_db_applications";
const MISSING_COLUMNS = "Auto-bid columns are missing. Run scripts/add-autobid-to-resume-db.sql in Supabase.";

export const BID_STATES = ["none", "bidding", "submitted", "needs_you", "failed", "expired"] as const;
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

/**
 * Auto-bid applies on these ATS platforms. Jobs queued by hand on other sites
 * stay in Resume DB for the Bid tab. A coarse SQL match; the exact host is
 * checked with siteOf wherever a row is used.
 */
const ON_AUTOBID_SITE = "job_link.ilike.*.greenhouse.io/*,job_link.ilike.*.lever.co/*,job_link.ilike.*.ashbyhq.com/*,job_link.ilike.*.rippling.com/*,job_link.ilike.*.workable.com/*,job_link.ilike.*.bamboohr.com/*,job_link.ilike.*.smartrecruiters.com/*,job_link.ilike.*.pinpointhq.com/*,job_link.ilike.*.myworkdayjobs.com/*,job_link.ilike.*.myworkdaysite.com/*,job_link.ilike.*.icims.com/*";

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
  /** Per-job form answers (current company and title from the resume, desired salary from the posting). */
  answers: JobAnswers;
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
  const jobDescription = String(row.job_description || row.note || "");
  return {
    id: Number(row.id),
    profile_id: row.profile_id ?? null,
    candidate: row.candidate_name ?? "",
    job_link: row.job_link ?? "",
    job_title: row.job_title ?? "",
    company: row.company ?? "",
    job_description: jobDescription,
    built_resume_json: row.built_resume_json ?? "",
    claimed_at: row.bid_claimed_at ?? "",
    answers: jobAnswers(row.built_resume_json ?? "", jobDescription),
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
    .eq("bid_state", "none")
    .or(ON_AUTOBID_SITE);
}

/**
 * Compare-and-swap: a ready row, or a bidding row whose claim went stale,
 * becomes bidding with a fresh claim. Two runners can never both win.
 */
/** Marks a ready row open only outside the U.S. as not applied; true when it did. */
async function setAsideAbroad(userId: string, id: number, profileId: number | null, jobDescription: string): Promise<boolean> {
  const abroad = nonUsLocation(jobDescription);
  if (!abroad) return false;
  const supabase = getSupabaseAdminClient();
  if (profileId) {
    const { data } = await supabase.from("profiles").select("autofill").eq("id", profileId).maybeSingle();
    const autofill = ((data as { autofill?: Record<string, unknown> } | null)?.autofill ?? {}) as Record<string, string>;
    if (!livesInUs(autofill)) return false;
  }
  const { error } = await supabase
    .from(TABLE)
    .update({ bid_state: "expired", bid_error: `Not applied: the posting is open only outside the U.S. (${abroad}).` } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", "none");
  if (error) rethrow(error.message);
  return true;
}

async function tryClaimBid(userId: string, id: number): Promise<BidJob | null> {
  const supabase = getSupabaseAdminClient();
  const { data: current, error: readError } = await supabase
    .from(TABLE)
    .select("id, profile_id, bid_state, bid_claimed_at, generation_status, apply, job_link, job_description, bid_meta")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) rethrow(readError.message);
  const row = current as
    | {
        profile_id: number | null;
        bid_state: string;
        bid_claimed_at: string | null;
        generation_status: string;
        apply: string;
        job_link: string | null;
        job_description: string | null;
        bid_meta: unknown;
      }
    | null;
  if (!row || row.generation_status !== "completed" || row.apply !== QUEUED_APPLY || !siteOf(row.job_link ?? "")) return null;
  const ready = row.bid_state === "none";
  const abandoned =
    row.bid_state === "bidding" &&
    (!row.bid_claimed_at || Date.now() - new Date(row.bid_claimed_at).getTime() >= BID_STALE_MS);
  if (!ready && !abandoned) return null;
  // A job queued again by hand skipped the screen Live's jobs get: one open only
  // outside the U.S. is not applied for a candidate in the U.S.
  if (ready && (await setAsideAbroad(userId, id, row.profile_id, row.job_description ?? ""))) return null;

  const prev: Record<string, unknown> =
    row.bid_meta && typeof row.bid_meta === "object" ? (row.bid_meta as Record<string, unknown>) : {};
  const now = new Date().toISOString();
  // Compare-and-swap on the state (and, for a stale claim, its stamp) the row had when read.
  const guard = { id, user_id: userId, bid_state: row.bid_state, ...(abandoned && row.bid_claimed_at && { bid_claimed_at: row.bid_claimed_at }) };
  const nullStamp = abandoned && !row.bid_claimed_at;

  // The lost runner had already pressed Submit: applying again would send the
  // application twice. Left for the user to check the site.
  if (abandoned && prev.submitClicked === true) {
    const note = "Runner was lost after Submit was clicked — check the site before retrying";
    let park = supabase
      .from(TABLE)
      .update({
        bid_state: "needs_you",
        bid_claimed_at: null,
        bid_error: note,
        bid_meta: { ...withLoggedStep(prev, note, now), step: "", finishedAt: now },
      } as never)
      .match(guard);
    if (nullStamp) park = park.is("bid_claimed_at", null);
    const { error } = await park;
    if (error) rethrow(error.message);
    return null;
  }

  // A reclaim or a retry keeps the earlier attempt's steps so the page can show both.
  const taken = abandoned ? "Taken again by the runner (the earlier claim went stale)" : "Taken by the runner";
  let update = supabase
    .from(TABLE)
    .update({
      bid_state: "bidding",
      bid_claimed_at: now,
      bid_error: "",
      bid_meta: {
        ...withLoggedStep({ steps: prev.steps }, taken, now),
        startedAt: now,
        step: taken,
        submitClicked: false,
      },
    } as never)
    .match(guard);
  if (nullStamp) update = update.is("bid_claimed_at", null);
  const { data, error } = await update
    .select(
      "id, profile_id, candidate_name, job_link, job_title, company, job_description, note, built_resume_json, bid_state, bid_claimed_at",
    )
    .maybeSingle();
  if (error) rethrow(error.message);
  return data ? toBidJob(data as BidRow) : null;
}

/**
 * Rows Auto-bid queued (they carry the posting time) that were not sent within
 * 24 hours of posting: no longer worth a resume or an application. A row being
 * generated or applied to is never interrupted, and rows queued by hand (no
 * posting time) never expire.
 */
export async function expireStaleQueued(userId: string): Promise<number> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ bid_state: "expired", bid_error: `Not sent within ${FRESH_HOURS} h of posting.` } as never)
    .eq("user_id", userId)
    .eq("apply", QUEUED_APPLY)
    .eq("bid_state", "none")
    .in("generation_status", ["queue", "completed"])
    .lt("posted_at", freshCutoffIso())
    .or(ON_AUTOBID_SITE)
    .select("id");
  if (error) rethrow(error.message);

  // Fail bids stuck in "bidding" longer than BID_STALE_MS (runner crashed or extension reloaded).
  const stuckCutoff = new Date(Date.now() - BID_STALE_MS).toISOString();
  const { data: stuck, error: stuckErr } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ bid_state: "failed", bid_error: "Timed out (stuck in bidding state)." } as never)
    .eq("user_id", userId)
    .eq("bid_state", "bidding")
    .lt("bid_claimed_at", stuckCutoff)
    .select("id");
  if (stuckErr) rethrow(stuckErr.message);

  return (data ?? []).length + (stuck ?? []).length;
}

/** Applications sent (and confirmed) since `sinceIso`. */
export async function countSentSince(userId: string, sinceIso: string): Promise<number> {
  const { count, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("bid_state", "submitted")
    .gte("bid_meta->>finishedAt", sinceIso);
  if (error) rethrow(error.message);
  return count ?? 0;
}

/**
 * Claims the oldest ready row (oldest posting first so nothing expires while
 * newer jobs keep jumping the queue), then the oldest abandoned claim.
 */
export async function claimNextBid(userId: string): Promise<BidJob | null> {
  await expireStaleQueued(userId);
  const { data: ready, error } = await readyRows(userId)
    .order("posted_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(10);
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

/**
 * What the runner is doing now, for the Auto-bid page. Only the claim holder
 * can write it. `submitClicked` is written just before the runner presses
 * Submit, so a runner lost right after can never apply to the job twice.
 */
export async function recordBidStep(
  userId: string,
  id: number,
  claimedAt: string,
  step: string,
  submitClicked?: boolean,
): Promise<boolean> {
  const current = await heldBidMeta(userId, id, claimedAt);
  if (!current) return false;
  const at = new Date().toISOString();
  const logged = step ? { ...withLoggedStep(current, step, at), step: step.slice(0, 300) } : current;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ bid_meta: { ...logged, ...(submitClicked !== undefined && { submitClicked }) } } as never)
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

/** A form rarely has more; the report is cut here (scripts/add-autobid-field-report.sql). */
const MAX_REPORTED_FIELDS = 80;

/**
 * Records the outcome, only while the caller still holds the claim. Keeps the
 * step history. The per-field report (meta.fieldReport) goes to its own
 * column, read only when the job is opened on the Auto-bid page.
 */
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
  const { steps: _ignored, step: _current, fieldReport, ...reported } = meta;
  const fields = Array.isArray(fieldReport) ? fieldReport.slice(0, MAX_REPORTED_FIELDS) : null;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({
      ...(fields && { bid_fields: fields }),
      bid_state: outcome,
      bid_claimed_at: null,
      // applied_at defaults to the insert, which for an auto-bid row is when the
      // scraper queued it — hours before Submit. Restamp it with the real send time.
      ...(outcome === "submitted" && { applied_at: at }),
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

/**
 * Promotes a needs_you job to submitted: the user took the required action
 * (clicked Submit on Ashby, solved a CAPTCHA, entered a verification code)
 * and the tab watcher saw the confirmation. Reads the current meta first so
 * the step history is kept.
 */
export async function confirmBid(
  userId: string,
  id: number,
  confirmedBy: string,
  confirmText: string,
): Promise<boolean> {
  const at = new Date().toISOString();
  const { data: raw } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("bid_meta")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", "needs_you")
    .maybeSingle();
  if (!raw) return false;
  const prev: Record<string, unknown> = ((raw as { bid_meta: unknown }).bid_meta as Record<string, unknown>) ?? {};
  const { error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({
      bid_state: "submitted",
      bid_error: "",
      applied_at: at,
      bid_meta: {
        ...prev,
        confirmedAt: at,
        confirmedBy,
        confirmText: String(confirmText || "").slice(0, 400),
        tabWatcher: true,
      },
    } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("bid_state", "needs_you");
  if (error) rethrow(error.message);
  return true;
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

/**
 * Needs-you and failed rows, still not sent, go back to the runner. Submitted
 * ones never do, nor ones where Submit was pressed without a confirmation.
 */
export async function retryBids(userId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .update({ bid_state: "none", bid_error: "", bid_claimed_at: null } as never)
    .eq("user_id", userId)
    .in("id", ids)
    .in("bid_state", ["needs_you", "failed"])
    .eq("apply", QUEUED_APPLY)
    // Once Submit was pressed the site may have the application: never again.
    .or("bid_meta->>submitClicked.is.null,bid_meta->>submitClicked.neq.true")
    .select("id");
  if (error) rethrow(error.message);
  return (data ?? []).length;
}

/**
 * Removes jobs from Needs you: needs-you, failed and failed-resume rows move to
 * Finished as expired, so neither the runner nor AutoGen picks them up again.
 * The row and its resume stay; the reason it stopped is kept in bid_meta.
 */
export async function dismissBids(userId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const supabase = getSupabaseAdminClient();
  const { data: rows, error } = await supabase
    .from(TABLE)
    .select("id, bid_state, bid_error, generation_error, bid_meta")
    .eq("user_id", userId)
    .in("id", ids)
    .eq("apply", QUEUED_APPLY)
    .or("bid_state.in.(needs_you,failed,submitted),and(bid_state.eq.none,generation_status.eq.failed)");
  if (error) rethrow(error.message);

  const at = new Date().toISOString();
  let dismissed = 0;
  for (const row of (rows ?? []) as Array<{
    id: number;
    bid_state: string;
    bid_error: string | null;
    generation_error: string | null;
    bid_meta: Record<string, unknown> | null;
  }>) {
    const reason = row.bid_state === "none" ? row.generation_error : row.bid_error;
    const { data, error: updateError } = await supabase
      .from(TABLE)
      .update({
        bid_state: "expired",
        bid_claimed_at: null,
        bid_error: "Dismissed from Needs you.",
        bid_meta: {
          ...withLoggedStep(row.bid_meta ?? {}, "Dismissed from Needs you", at),
          dismissedAt: at,
          dismissedReason: String(reason ?? "").slice(0, 1000),
        },
      } as never)
      .eq("id", row.id)
      .eq("user_id", userId)
      .eq("bid_state", row.bid_state)
      .select("id")
      .maybeSingle();
    if (updateError) rethrow(updateError.message);
    if (data) dismissed += 1;
  }
  return dismissed;
}

const PERMANENT_BID_ERROR_RE =
  /real human|human being|not (?:a )?bot|not (?:using|submitted by).*automated|in my own words|own words.*AI|captcha|CAPTCHA|no longer (?:accepting|available)|position.*(?:closed|filled)|job.*(?:closed|filled|not found)|Auto-submit covers|covers Greenhouse, Lever and Ashby/i;

/**
 * Auto-retries eligible needs_you jobs: not yet submitted, error looks fixable,
 * and auto-retried fewer than `maxRetries` times. Returns the count retried.
 */
export async function autoRetryBids(
  userId: string,
  extensionVersion: string,
  maxRetries = 2,
): Promise<{ retried: number; ids: number[] }> {
  const supabase = getSupabaseAdminClient();
  const { data: candidates, error } = await supabase
    .from(TABLE)
    .select("id, bid_error, bid_meta")
    .eq("user_id", userId)
    .eq("bid_state", "needs_you")
    .eq("apply", QUEUED_APPLY)
    .or(ON_AUTOBID_SITE)
    .or("bid_meta->>submitClicked.is.null,bid_meta->>submitClicked.neq.true")
    .order("id", { ascending: false })
    .limit(50);
  if (error) rethrow(error.message);
  if (!candidates?.length) return { retried: 0, ids: [] };

  const eligible = (candidates as Array<{ id: number; bid_error: string | null; bid_meta: Record<string, unknown> | null }>)
    .filter((row) => {
      const err = row.bid_error ?? "";
      if (PERMANENT_BID_ERROR_RE.test(err)) return false;
      const reason = String(row.bid_meta?.needsYouReason ?? "");
      const limit = reason === "missing_field" ? maxRetries + 1 : maxRetries;
      const count = Number(row.bid_meta?.autoRetryCount ?? 0);
      if (count >= limit) return false;
      const lastVersion = String(row.bid_meta?.lastRunVersion ?? "");
      if (lastVersion === extensionVersion && count > 0) return false;
      return true;
    });
  if (!eligible.length) return { retried: 0, ids: [] };

  const ids = eligible.map((r) => r.id);
  const results: number[] = [];
  for (const row of eligible) {
    const prevMeta = (row.bid_meta ?? {}) as Record<string, unknown>;
    const count = Number(prevMeta.autoRetryCount ?? 0);
    const { error: upErr } = await supabase
      .from(TABLE)
      .update({
        bid_state: "none",
        bid_error: "",
        bid_claimed_at: null,
        bid_meta: { ...prevMeta, autoRetryCount: count + 1, autoRetryAt: new Date().toISOString(), autoRetryVersion: extensionVersion },
      } as never)
      .eq("id", row.id)
      .eq("user_id", userId)
      .eq("bid_state", "needs_you");
    if (!upErr) results.push(row.id);
  }
  return { retried: results.length, ids: results };
}

export type BidSummary = {
  ready: number;
  submittedSince: number;
  needsYou: Array<{
    id: number;
    candidate: string;
    jobTitle: string;
    company: string;
    jobLink: string;
    reason: string;
    needsYouReason: string;
    missingFields: string[];
  }>;
};

/** For the runner's card: how many are waiting, sent since `sinceIso`, and what needs the user. */
export async function bidSummary(userId: string, sinceIso: string): Promise<BidSummary> {
  const supabase = getSupabaseAdminClient();
  const [ready, submittedSince, needs] = await Promise.all([
    getSupabaseAdminClient()
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("generation_status", "completed")
      .eq("apply", QUEUED_APPLY)
      .eq("bid_state", "none")
      .or(ON_AUTOBID_SITE),
    countSentSince(userId, sinceIso),
    supabase
      .from(TABLE)
      .select("id, candidate_name, job_title, company, job_link, bid_error, bid_meta->openFields, bid_meta->needsYouReason")
      .eq("user_id", userId)
      .eq("bid_state", "needs_you")
      .eq("apply", QUEUED_APPLY)
      .or(ON_AUTOBID_SITE)
      .order("id", { ascending: false })
      .limit(50),
  ]);
  for (const result of [ready, needs]) if (result.error) rethrow(result.error.message);
  return {
    ready: ready.count ?? 0,
    submittedSince,
    needsYou: ((needs.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      candidate: String(row.candidate_name ?? ""),
      jobTitle: String(row.job_title ?? ""),
      company: String(row.company ?? ""),
      jobLink: String(row.job_link ?? ""),
      reason: String(row.bid_error ?? ""),
      needsYouReason: String(row.needsYouReason ?? ""),
      missingFields: missingFieldsOf(String(row.bid_error ?? ""), { openFields: row.openFields }),
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
    .or(ON_AUTOBID_SITE)
    .order("id", { ascending: false })
    .limit(MONITOR_LIMIT);
  if (error) rethrow(error.message);
  return ((data ?? []) as AutobidRowInput[]).filter((row) => siteOf(String(row.job_link ?? ""))).map(toAutobidJob);
}

/** How many of the same jobs fall in each page tab, reading only the three state columns. */
export async function countAutobidGroups(userId: string): Promise<Record<AutobidGroup, number>> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("apply, generation_status, bid_state, job_link")
    .eq("user_id", userId)
    .or(`apply.eq.${QUEUED_APPLY},bid_state.neq.none`)
    .or(ON_AUTOBID_SITE)
    .order("id", { ascending: false })
    .limit(MONITOR_LIMIT);
  if (error) rethrow(error.message);
  const counts: Record<AutobidGroup, number> = { active: 0, attention: 0, done: 0 };
  for (const row of (data ?? []) as Array<Pick<AutobidRowInput, "apply" | "generation_status" | "bid_state"> & { job_link: string | null }>) {
    if (siteOf(row.job_link ?? "")) counts[STAGE_GROUP[stageOf(row)]] += 1;
  }
  return counts;
}

/** One job's per-field report from its last attempt; [] when there is none. */
export async function readBidFields(userId: string, id: number): Promise<unknown[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .select("bid_fields")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) rethrow(error.message);
  const fields = (data as { bid_fields?: unknown } | null)?.bid_fields;
  return Array.isArray(fields) ? fields : [];
}
