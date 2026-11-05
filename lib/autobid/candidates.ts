import "server-only";

import type { SessionUser } from "@/lib/auth/types";
import { countSentSince } from "@/lib/autobid/claim";
import { readAutobidConfig } from "@/lib/autobid/config";
import { checkJobFit } from "@/lib/autobid/fit";
import { openAiFitModel } from "@/lib/autobid/fit-openai";
import { companyKey, freshCutoffIso, isStale, queueRoom } from "@/lib/autobid/queue-rules";
import { screenCandidate, siteOf } from "@/lib/autobid/screen";
import { loadReadyKit } from "@/lib/autogen/prompt";
import { canonicalJobUrl } from "@/lib/job-url";
import { createApplication, findApplicationByJobLink, getProfileById } from "@/lib/resume-db/repository";
import { newEntryId } from "@/lib/resume-db/storage";
import { QUEUED_APPLY } from "@/lib/resume-db/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { startOfDayUtcIso, todayInTimeZone } from "@/lib/timezone";

/**
 * Jobs Live found, and the server's decisions about them
 * (docs/AUTOBID_PLAN.md, phase 1):
 *   recordFound    lite rows in; the rule check on site and title; which need a description
 *   describeFound  a description in; the rule check on it, then the AI fit check
 *   fillQueue      the freshest passed jobs into the AutoGen queue, within the day's room
 */

const TABLE = "autobid_candidates";
const APPS = "resume_db_applications";
const MISSING_TABLE = "The Auto-bid candidates table is missing. Run scripts/add-autobid-candidates.sql in Supabase.";
/** One Live check rarely finds more; a larger batch is cut here. */
const MAX_BATCH = 300;

export type CandidateStatus = "found" | "skipped" | "passed" | "queued" | "expired";

export type FoundJob = {
  jobLink: string;
  jobTitle: string;
  company: string;
  source: string;
  postedAt: string | null;
};

type CandidateRow = {
  id: number;
  profile_id: number;
  url_key: string;
  job_link: string;
  job_title: string;
  company: string;
  site: string;
  posted_at: string | null;
  found_at: string;
  status: CandidateStatus;
  reason: string;
  job_description: string | null;
};

const COLUMNS = "id, profile_id, url_key, job_link, job_title, company, site, posted_at, found_at, status, reason";

function rethrow(message: string): never {
  throw new Error(/autobid_candidates|posted_at/i.test(message) ? MISSING_TABLE : message);
}

function db() {
  return getSupabaseAdminClient();
}

function validIso(value: unknown): string | null {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function loadProfile(user: SessionUser, profileId: number) {
  const profile = await getProfileById(user.id, profileId);
  if (!profile) throw new Error("Selected profile not found.");
  return profile;
}

/** Moves rows to a final status, grouped so each reason is one update. */
async function decide(ids: Map<string, number[]>, status: CandidateStatus) {
  const at = new Date().toISOString();
  await Promise.all(
    [...ids].map(async ([reason, list]) => {
      const { error } = await db()
        .from(TABLE)
        .update({ status, reason, decided_at: at } as never)
        .in("id", list);
      if (error) rethrow(error.message);
    }),
  );
}

/**
 * A Live check's new jobs for one profile. Each job is stored once per
 * profile; jobs seen before keep their decision. Returns the links whose job
 * description the server needs next (they passed the site and title check).
 */
export async function recordFound(
  user: SessionUser,
  profileId: number,
  jobs: FoundJob[],
): Promise<{ received: number; skipped: Array<{ jobLink: string; reason: string }>; wantJd: string[] }> {
  const [profile, config] = await Promise.all([loadProfile(user, profileId), readAutobidConfig(user.id)]);

  const byKey = new Map<string, FoundJob & { urlKey: string }>();
  for (const job of jobs.slice(0, MAX_BATCH)) {
    const urlKey = canonicalJobUrl(job.jobLink);
    if (urlKey && job.jobTitle && !byKey.has(urlKey)) byKey.set(urlKey, { ...job, urlKey });
  }
  if (!byKey.size) return { received: 0, skipped: [], wantJd: [] };

  const rows = [...byKey.values()].map((job) => ({
    user_id: user.id,
    profile_id: profileId,
    url_key: job.urlKey,
    job_link: job.jobLink,
    job_title: job.jobTitle.slice(0, 300),
    company: job.company.slice(0, 200),
    site: siteOf(job.jobLink),
    source: job.source.slice(0, 40),
    posted_at: job.postedAt,
  }));
  const { error: insertError } = await db()
    .from(TABLE)
    .upsert(rows as never, { onConflict: "user_id,profile_id,url_key", ignoreDuplicates: true });
  if (insertError) rethrow(insertError.message);

  // Every row of this batch still waiting for a decision: new ones, and ones whose description never came.
  const { data, error } = await db()
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", user.id)
    .eq("profile_id", profileId)
    .eq("status", "found")
    .in("url_key", [...byKey.keys()]);
  if (error) rethrow(error.message);

  const skipped = new Map<string, number[]>();
  const skippedJobs: Array<{ jobLink: string; reason: string }> = [];
  const wantJd: string[] = [];
  const now = Date.now();
  for (const row of (data ?? []) as CandidateRow[]) {
    const verdict = isStale(row.posted_at, row.found_at, now)
      ? { ok: false as const, reason: "Posted more than 24 h ago" }
      : screenCandidate(
          { jobLink: row.job_link, jobTitle: row.job_title },
          { profile: profile.autofill ?? {} },
        );
    if (verdict.ok) {
      wantJd.push(row.job_link);
    } else {
      skipped.set(verdict.reason, [...(skipped.get(verdict.reason) ?? []), row.id]);
      skippedJobs.push({ jobLink: row.job_link, reason: verdict.reason });
    }
  }
  await decide(skipped, "skipped");
  return { received: byKey.size, skipped: skippedJobs, wantJd };
}

/** A job whose page could not be read (closed, apply-only, blocked): it will not be read again. */
export async function skipFound(user: SessionUser, profileId: number, jobLink: string, reason: string): Promise<DescribeResult> {
  const { error } = await db()
    .from(TABLE)
    .update({ status: "skipped", reason, decided_at: new Date().toISOString() } as never)
    .eq("user_id", user.id)
    .eq("profile_id", profileId)
    .eq("url_key", canonicalJobUrl(jobLink))
    .eq("status", "found");
  if (error) rethrow(error.message);
  return { status: "skipped", reason };
}

export type DescribeResult = { status: CandidateStatus; reason: string; score?: number };

/**
 * A job's description: the rule check on it, one company at a time, then the
 * AI fit check. A passing job waits as "passed" until there is room in the
 * queue; fillQueue runs right after, so it is usually queued at once.
 * Throws (and leaves the job "found", to be tried on the next check) when the
 * AI check cannot run.
 */
export async function describeFound(
  user: SessionUser,
  profileId: number,
  jobLink: string,
  jobDescription: string,
): Promise<DescribeResult> {
  const urlKey = canonicalJobUrl(jobLink);
  const { data, error } = await db()
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", user.id)
    .eq("profile_id", profileId)
    .eq("url_key", urlKey)
    .maybeSingle();
  if (error) rethrow(error.message);
  const row = data as CandidateRow | null;
  if (!row) throw new Error("This job was not posted to /api/autobid/found first.");
  if (row.status !== "found") return { status: row.status, reason: row.reason };

  const skip = async (reason: string, extra: Record<string, unknown> = {}): Promise<DescribeResult> => {
    const { error: updateError } = await db()
      .from(TABLE)
      .update({ status: "skipped", reason, decided_at: new Date().toISOString(), ...extra } as never)
      .eq("id", row.id)
      .eq("status", "found");
    if (updateError) rethrow(updateError.message);
    return { status: "skipped", reason, ...(typeof extra.fit_score === "number" && { score: extra.fit_score }) };
  };

  const [profile, config] = await Promise.all([loadProfile(user, profileId), readAutobidConfig(user.id)]);
  if (isStale(row.posted_at, row.found_at)) return skip("Posted more than 24 h ago");
  const screened = screenCandidate(
    { jobLink: row.job_link, jobTitle: row.job_title, jobDescription },
    { profile: profile.autofill ?? {} },
  );
  if (!screened.ok) return skip(screened.reason);

  // One application per company and profile at a time.
  const key = companyKey(row.company);
  if (key && (await companyInPipeline(user.id, profileId, key, row.id))) {
    return skip(`Already a job at ${row.company} in the queue`);
  }

  const kit = await loadReadyKit(user.id, profileId);
  if (!kit.ok) throw new Error(`${profile.full_name} cannot generate resumes yet. ${kit.detail}`);

  const fit = await checkJobFit(
    {
      jobTitle: row.job_title,
      company: row.company,
      jobDescription,
      autofill: profile.autofill ?? {},
      resumeTemplateJson: kit.resumeJson,
    },
    openAiFitModel,
  );
  const fitColumns = {
    fit_score: fit.score,
    fit: { summary: fit.summary, blockers: fit.blockers, rejectedBlockers: fit.rejectedBlockers },
  };
  if (!fit.ok) return skip(fit.reason, fitColumns);

  const { error: passError } = await db()
    .from(TABLE)
    .update({
      status: "passed",
      reason: fit.reason,
      decided_at: new Date().toISOString(),
      job_description: jobDescription,
      ...fitColumns,
    } as never)
    .eq("id", row.id)
    .eq("status", "found");
  if (passError) rethrow(passError.message);

  await fillQueue(user);
  const { data: after } = await db().from(TABLE).select("status, reason").eq("id", row.id).maybeSingle();
  const now = (after as { status: CandidateStatus; reason: string } | null) ?? { status: "passed", reason: fit.reason };
  return { ...now, score: fit.score };
}

/**
 * Another job at this company is still on its way for this profile: passed
 * and waiting for room (while fresh), or queued with an application that has
 * not been sent, failed or expired yet. A candidate stays "queued" forever, so
 * the application's own state decides, not the candidate's.
 */
async function companyInPipeline(userId: string, profileId: number, key: string, exceptId: number): Promise<boolean> {
  const { data, error } = await db()
    .from(TABLE)
    .select("id, company, status, application_id, posted_at, found_at")
    .eq("user_id", userId)
    .eq("profile_id", profileId)
    .in("status", ["passed", "queued"])
    .gte("found_at", freshCutoffIso())
    .neq("id", exceptId);
  if (error) rethrow(error.message);
  const same = ((data ?? []) as Array<Pick<CandidateRow, "status" | "company" | "posted_at" | "found_at"> & { application_id: number | null }>)
    .filter((other) => companyKey(other.company) === key);
  const now = Date.now();
  if (same.some((other) => other.status === "passed" && !isStale(other.posted_at, other.found_at, now))) return true;
  const applicationIds = same.flatMap((other) => (other.status === "queued" && other.application_id ? [other.application_id] : []));
  if (!applicationIds.length) return false;
  const { count, error: appsError } = await db()
    .from(APPS)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("id", applicationIds)
    .eq("apply", QUEUED_APPLY)
    .in("bid_state", ["none", "bidding"])
    .in("generation_status", ["queue", "generating", "completed"]);
  if (appsError) rethrow(appsError.message);
  return (count ?? 0) > 0;
}

/** Sent since the user's midnight, and what is queued, generating or ready to apply. */
async function pipelineCounts(user: SessionUser): Promise<{ sentToday: number; inPipeline: number }> {
  const dayStart = startOfDayUtcIso(todayInTimeZone(user.timezone), user.timezone);
  const [sentToday, pipeline] = await Promise.all([
    countSentSince(user.id, dayStart),
    db()
      .from(APPS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("apply", QUEUED_APPLY)
      .in("bid_state", ["none", "bidding"])
      .in("generation_status", ["queue", "generating", "completed"]),
  ]);
  if (pipeline.error) rethrow(pipeline.error.message);
  return { sentToday, inPipeline: pipeline.count ?? 0 };
}

/**
 * The freshest passed jobs into the AutoGen queue, as many as the day has room
 * for. Passed jobs that grew too old waiting are expired. A job is taken by
 * moving it from passed to queued first, so two calls never queue it twice.
 */
export async function fillQueue(user: SessionUser): Promise<{ queued: number[]; expired: number }> {
  const { data: waiting, error } = await db()
    .from(TABLE)
    .select(`${COLUMNS}, job_description`)
    .eq("user_id", user.id)
    .eq("status", "passed")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("found_at", { ascending: false })
    .limit(100);
  if (error) rethrow(error.message);

  const now = Date.now();
  const stale = ((waiting ?? []) as CandidateRow[]).filter((row) => isStale(row.posted_at, row.found_at, now));
  if (stale.length) {
    await decide(new Map([["No room in the queue before it was 24 h old", stale.map((row) => row.id)]]), "expired");
  }
  const fresh = ((waiting ?? []) as CandidateRow[]).filter((row) => !stale.includes(row));
  if (!fresh.length) return { queued: [], expired: stale.length };

  const [config, counts] = await Promise.all([readAutobidConfig(user.id), pipelineCounts(user)]);
  const room = queueRoom({ dailyLimit: config.dailyLimit, ...counts });

  const queued: number[] = [];
  const profiles = new Map<number, Awaited<ReturnType<typeof getProfileById>>>();
  for (const row of fresh.slice(0, room)) {
    const { data: taken, error: takeError } = await db()
      .from(TABLE)
      .update({ status: "queued", reason: "", decided_at: new Date().toISOString() } as never)
      .eq("id", row.id)
      .eq("status", "passed")
      .select("id");
    if (takeError) rethrow(takeError.message);
    if (!taken?.length) continue;

    const setBack = async (status: CandidateStatus, reason: string) => {
      await db().from(TABLE).update({ status, reason } as never).eq("id", row.id);
    };
    try {
      if (!profiles.has(row.profile_id)) profiles.set(row.profile_id, await getProfileById(user.id, row.profile_id));
      const profile = profiles.get(row.profile_id);
      if (!profile) {
        await setBack("skipped", "The profile was deleted");
        continue;
      }
      const duplicate = await findApplicationByJobLink(user.id, row.profile_id, row.job_link);
      if (duplicate) {
        await setBack("skipped", `Already in Resume DB (#${duplicate.id})`);
        continue;
      }
      const application = await createApplication(user.id, {
        entryId: newEntryId(),
        profileId: row.profile_id,
        candidateName: profile.full_name,
        jobLink: row.job_link,
        jobTitle: row.job_title,
        company: row.company,
        apply: QUEUED_APPLY,
        resumeUrl: "",
        jobDescription: row.job_description ?? "",
        generationStatus: "queue",
        postedAt: row.posted_at ?? row.found_at,
      });
      await db().from(TABLE).update({ application_id: application.id } as never).eq("id", row.id);
      queued.push(row.id);
    } catch (queueError) {
      await setBack("passed", "");
      throw queueError;
    }
  }
  return { queued, expired: stale.length };
}

/** Normalizes a found job from the extension; null when it lacks a link or title. */
export function toFoundJob(value: unknown): FoundJob | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = raw[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const jobLink = pick("jobLink", "job_link", "apply_url");
  const jobTitle = pick("jobTitle", "job_title", "title");
  if (!/^https?:\/\//i.test(jobLink) || !jobTitle) return null;
  return {
    jobLink,
    jobTitle,
    company: pick("company", "company_name"),
    source: pick("source", "origin"),
    postedAt: validIso(raw.postedAt ?? raw.posted_at),
  };
}

/** One found job for the Auto-bid page (no description: it is large). */
export type FoundListEntry = {
  id: number;
  profileId: number;
  jobLink: string;
  jobTitle: string;
  company: string;
  site: string;
  source: string;
  postedAt: string | null;
  foundAt: string;
  status: CandidateStatus;
  reason: string;
  fitScore: number | null;
  applicationId: number | null;
};

/** Jobs Live found in the last `hours`, newest first, with the server's decision. */
export async function listFound(userId: string, hours = 24): Promise<FoundListEntry[]> {
  const { data, error } = await db()
    .from(TABLE)
    .select("id, profile_id, job_link, job_title, company, site, source, posted_at, found_at, status, reason, fit_score, application_id")
    .eq("user_id", userId)
    .gte("found_at", new Date(Date.now() - hours * 3600_000).toISOString())
    .order("found_at", { ascending: false })
    .limit(500);
  if (error) rethrow(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    profileId: Number(row.profile_id),
    jobLink: String(row.job_link ?? ""),
    jobTitle: String(row.job_title ?? ""),
    company: String(row.company ?? ""),
    site: String(row.site ?? ""),
    source: String(row.source ?? ""),
    postedAt: (row.posted_at as string | null) ?? null,
    foundAt: String(row.found_at ?? ""),
    status: row.status as CandidateStatus,
    reason: String(row.reason ?? ""),
    fitScore: typeof row.fit_score === "number" ? row.fit_score : null,
    applicationId: row.application_id == null ? null : Number(row.application_id),
  }));
}
