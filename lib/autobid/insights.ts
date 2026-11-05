/**
 * Why jobs stop, how each extension version does, and a day's summary, worked
 * out from the Auto-bid job list. Pure: shared by the page and the digest API.
 */

import type { AutobidJob } from "@/lib/autobid/stages";

export type FailureCategory = { key: string; label: string };

const CATEGORIES: Array<FailureCategory & { re: RegExp }> = [
  { key: "bot_check", label: "Asks to confirm no automation/AI", re: /real human|human being|own words|automated tool/i },
  { key: "spam", label: "Refused as spam", re: /spam/i },
  { key: "captcha", label: "CAPTCHA", re: /captcha/i },
  { key: "verify_code", label: "Email verification code", re: /verification code/i },
  { key: "ashby", label: "Ashby: form needs corrections", re: /form needs corrections/i },
  { key: "gdpr", label: "GDPR / demographic consent", re: /gdpr|demographic.{0,40}consent/i },
  { key: "missing_field", label: "Required field not filled", re: /required fields? not filled|missing entry for required field/i },
  { key: "cover_letter", label: "Cover letter required", re: /cover letter/i },
  { key: "site_rejected", label: "Site rejected the form", re: /site rejected the form|site showed an error/i },
  { key: "no_confirmation", label: "No confirmation after Submit", re: /no confirmation was recognised|not confirmed/i },
  { key: "no_form", label: "No form / no Submit button", re: /no application form found|could not be read just before submit|no submit button/i },
  { key: "unsupported", label: "Not Greenhouse, Lever or Ashby", re: /auto-submit covers/i },
  { key: "runner_lost", label: "Runner lost mid-application", re: /runner was lost/i },
  { key: "closed", label: "Posting closed", re: /no longer (accepting|available)|(position|job|role|opening)[^.]{0,30}(closed|been filled)|(job|page) not found/i },
  { key: "dry_run", label: "Dry run (not submitted)", re: /dry run/i },
];

const RESUME_FAILED: FailureCategory = { key: "resume_failed", label: "Resume generation failed" };
const OTHER: FailureCategory = { key: "other", label: "Other" };

export function failureCategory(job: Pick<AutobidJob, "stage" | "reason">): FailureCategory {
  if (job.stage === "gen_failed") return RESUME_FAILED;
  const hit = CATEGORIES.find((c) => c.re.test(job.reason));
  return hit ? { key: hit.key, label: hit.label } : OTHER;
}

const STOPPED = new Set(["needs_you", "failed", "gen_failed"]);

export function isStopped(job: Pick<AutobidJob, "stage">): boolean {
  return STOPPED.has(job.stage);
}

export type CategoryCount = FailureCategory & { count: number; jobIds: number[] };

export function countByCategory(jobs: AutobidJob[]): CategoryCount[] {
  const map = new Map<string, CategoryCount>();
  for (const job of jobs) {
    if (!isStopped(job)) continue;
    const cat = failureCategory(job);
    const entry = map.get(cat.key) ?? { ...cat, count: 0, jobIds: [] };
    entry.count += 1;
    entry.jobIds.push(job.id);
    map.set(cat.key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export type VersionStats = { version: string; sent: number; stopped: number; rate: number };

/** Per extension version: sent and stopped by the runner (jobs it finished on that version). */
export function statsByVersion(jobs: AutobidJob[]): VersionStats[] {
  const map = new Map<string, VersionStats>();
  for (const job of jobs) {
    if (!job.runVersion) continue;
    const sent = job.sentByRunner || job.stage === "sent";
    const stopped = job.stage === "needs_you" || job.stage === "failed";
    if (!sent && !stopped) continue;
    const entry = map.get(job.runVersion) ?? { version: job.runVersion, sent: 0, stopped: 0, rate: 0 };
    if (sent) entry.sent += 1;
    else entry.stopped += 1;
    map.set(job.runVersion, entry);
  }
  const cmp = (a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pb[i] || 0) - (pa[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  return [...map.values()]
    .map((v) => ({ ...v, rate: v.sent + v.stopped ? v.sent / (v.sent + v.stopped) : 0 }))
    .sort((a, b) => cmp(a.version, b.version));
}

const at = (job: AutobidJob, key: AutobidJob["steps"][number]["key"]) => {
  const value = job.steps.find((s) => s.key === key)?.at;
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? null : ms;
};

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export type Digest = {
  sinceIso: string;
  untilIso: string;
  sent: number;
  stopped: number;
  resumesWritten: number;
  resumesFailed: number;
  byCategory: Array<{ label: string; count: number }>;
  /** Minutes, averaged over the jobs that had both times in the window. */
  avgQueueToResumeMin: number | null;
  avgApplyMin: number | null;
};

/** What happened between `sinceMs` and `untilMs`. */
export function digestOf(jobs: AutobidJob[], sinceMs: number, untilMs: number): Digest {
  const inWindow = (ms: number | null) => ms !== null && ms >= sinceMs && ms < untilMs;
  const sentJobs = jobs.filter((job) => (job.sentByRunner || job.stage === "sent") && inWindow(at(job, "sent")));
  const stoppedJobs = jobs.filter((job) => {
    if (!isStopped(job)) return false;
    return inWindow(job.stage === "gen_failed" ? Date.parse(job.updatedAt) : at(job, "apply"));
  });
  const written = jobs.filter((job) => job.steps.find((s) => s.key === "resume")?.state === "done" && inWindow(at(job, "resume")));
  const queueToResume = written
    .map((job) => {
      const q = at(job, "queued");
      const r = at(job, "resume");
      return q !== null && r !== null && r >= q ? (r - q) / 60_000 : null;
    })
    .filter((v): v is number => v !== null);
  const apply = sentJobs
    .map((job) => {
      const a = at(job, "apply");
      const s = at(job, "sent");
      return a !== null && s !== null && s >= a ? (s - a) / 60_000 : null;
    })
    .filter((v): v is number => v !== null);
  return {
    sinceIso: new Date(sinceMs).toISOString(),
    untilIso: new Date(untilMs).toISOString(),
    sent: sentJobs.length,
    stopped: stoppedJobs.length,
    resumesWritten: written.length,
    resumesFailed: stoppedJobs.filter((job) => job.stage === "gen_failed").length,
    byCategory: countByCategory(stoppedJobs).map(({ label, count }) => ({ label, count })),
    avgQueueToResumeMin: average(queueToResume),
    avgApplyMin: average(apply),
  };
}
