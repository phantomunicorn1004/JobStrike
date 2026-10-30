/**
 * Where a job is in the automatic chain (Live → AutoGen → Auto-bid → Register),
 * from its Resume DB columns. Pure: shared by the API and the Auto-bid page.
 */

export const QUEUED = "Queued";

export type AutobidStage =
  | "queued" // waiting for AutoGen
  | "generating"
  | "gen_failed"
  | "ready" // resume generated, waiting for the Auto-bid runner
  | "applying"
  | "needs_you"
  | "failed"
  | "sent" // confirmed by the site, Register did not save it
  | "registered";

/** The page's tabs. */
export type AutobidGroup = "active" | "attention" | "done";

export const STAGE_GROUP: Record<AutobidStage, AutobidGroup> = {
  queued: "active",
  generating: "active",
  ready: "active",
  applying: "active",
  gen_failed: "attention",
  needs_you: "attention",
  failed: "attention",
  sent: "attention",
  registered: "done",
};

export type StepState = "done" | "current" | "failed" | "pending";

/** One of the five steps shown for each job, with when it happened. */
export type AutobidStep = {
  key: "queued" | "resume" | "apply" | "sent" | "registered";
  label: string;
  state: StepState;
  at: string | null;
};

export type BidLogEntry = { at: string; text: string };

export type AutobidJob = {
  id: number;
  profileId: number | null;
  candidate: string;
  company: string;
  jobTitle: string;
  jobLink: string;
  stage: AutobidStage;
  /** Sent by the runner (false: registered by hand after AutoGen). */
  sentByRunner: boolean;
  dryRun: boolean;
  /** What the runner is doing now, while applying. */
  currentStep: string;
  reason: string;
  submitClicked: boolean;
  steps: AutobidStep[];
  log: BidLogEntry[];
  updatedAt: string;
};

/** The columns read for the page (no resume JSON or job description: they are large). */
export type AutobidRowInput = {
  id: number;
  profile_id: number | null;
  candidate_name: string | null;
  company: string | null;
  job_title: string | null;
  job_link: string | null;
  apply: string | null;
  created_at: string | null;
  generation_status: string | null;
  generation_error: string | null;
  generation_meta: Record<string, unknown> | null;
  autogen_claimed_at: string | null;
  bid_state: string | null;
  bid_error: string | null;
  bid_meta: Record<string, unknown> | null;
  bid_claimed_at: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string | null {
  const s = text(value);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
}

export function stageOf(row: Pick<AutobidRowInput, "apply" | "generation_status" | "bid_state">): AutobidStage {
  if ((row.apply ?? "") !== QUEUED) return "registered";
  switch (row.bid_state) {
    case "bidding":
      return "applying";
    case "submitted":
      return "sent";
    case "needs_you":
      return "needs_you";
    case "failed":
      return "failed";
  }
  switch (row.generation_status) {
    case "generating":
      return "generating";
    case "failed":
      return "gen_failed";
    case "completed":
      return "ready";
    default:
      return "queued";
  }
}

export function toAutobidJob(row: AutobidRowInput): AutobidJob {
  const stage = stageOf(row);
  const gen = row.generation_meta ?? {};
  const bid = row.bid_meta ?? {};
  const bidState = row.bid_state ?? "none";
  const log = (Array.isArray(bid.steps) ? bid.steps : [])
    .map((entry) => ({ at: iso((entry as BidLogEntry)?.at) ?? "", text: text((entry as BidLogEntry)?.text) }))
    .filter((entry) => entry.at && entry.text);

  const generatedAt = iso(gen.completedAt);
  const startedAt = iso(bid.startedAt) ?? (bidState === "bidding" ? iso(row.bid_claimed_at) : null);
  const confirmedAt = iso(bid.confirmedAt) ?? (bidState === "submitted" ? iso(bid.finishedAt) : null);
  const finishedAt = iso(bid.finishedAt);
  const registeredAt = iso(bid.registeredAt);
  const sentByRunner = bidState === "submitted";

  const resume: AutobidStep = {
    key: "resume",
    label: "Resume",
    at: null,
    state: "pending",
  };
  if (row.generation_status === "completed") Object.assign(resume, { state: "done", at: generatedAt });
  else if (row.generation_status === "generating") Object.assign(resume, { state: "current", at: iso(row.autogen_claimed_at) });
  else if (row.generation_status === "failed") resume.state = "failed";
  else if (stage === "registered") resume.state = "done"; // bid by hand before AutoGen ran

  const apply: AutobidStep = { key: "apply", label: "Apply", at: startedAt, state: "pending" };
  if (bidState === "bidding") apply.state = "current";
  else if (bidState === "submitted" || stage === "registered") apply.state = "done"; // by hand after a stop, too
  else if (bidState === "needs_you" || bidState === "failed") Object.assign(apply, { state: "failed", at: finishedAt ?? startedAt });

  const sent: AutobidStep = {
    key: "sent",
    label: "Sent",
    at: confirmedAt,
    state: sentByRunner || stage === "registered" ? "done" : "pending",
  };

  const registered: AutobidStep = {
    key: "registered",
    label: "Registered",
    at: registeredAt,
    state: stage === "registered" ? "done" : stage === "sent" ? "failed" : "pending",
  };

  let reason = "";
  if (stage === "gen_failed") reason = text(row.generation_error) || "Resume generation failed.";
  else if (stage === "needs_you" || stage === "failed") reason = text(row.bid_error) || "Stopped for you.";
  else if (stage === "sent") reason = "Sent and confirmed, but Register did not save it. Register it from the Bid tab.";

  const times = [row.created_at, generatedAt, startedAt, finishedAt, registeredAt, log.at(-1)?.at]
    .map(iso)
    .filter((value): value is string => Boolean(value));

  return {
    id: Number(row.id),
    profileId: row.profile_id ?? null,
    candidate: text(row.candidate_name),
    company: text(row.company),
    jobTitle: text(row.job_title),
    jobLink: text(row.job_link),
    stage,
    sentByRunner,
    dryRun: bid.method === "dry_run",
    currentStep: bidState === "bidding" ? text(bid.step) : "",
    reason,
    submitClicked: Boolean(bid.submitClicked),
    steps: [
      { key: "queued", label: "Queued", state: "done", at: iso(row.created_at) },
      resume,
      apply,
      sent,
      registered,
    ],
    log,
    updatedAt: times.sort().at(-1) ?? "",
  };
}
