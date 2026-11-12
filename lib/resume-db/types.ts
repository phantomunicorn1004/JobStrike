export type ResumeDbApplication = {
  id: number;
  entryId: string;
  profileId: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  /** "Greenhouse", "Workday", …; a hostname for sites that are no known platform. */
  atsPlatform: string;
  note: string;
  apply: string;
  resumeUrl: string;
  coverLetterUrl: string;
  appliedAt: string;
  createdAt: string;
  pipelineJobId: number | null;
  /** Cached pipeline stage; null = Registered (not in pipeline). */
  pipelineStageId?: string | null;
  resumeStoragePath?: string | null;
  coverLetterStoragePath?: string | null;
  resumeDriveFileId?: string | null;
  coverDriveFileId?: string | null;
  /** The posting text resume generation works from; "" before scripts/add-autogen-to-resume-db.sql. */
  jobDescription?: string;
  /** Resume generation (AutoGen); "none" for rows that are not part of it. */
  generationStatus?: GenerationStatus;
  autogenClaimedAt?: string | null;
  generationError?: string;
  generationMeta?: Record<string, unknown> | null;
  builtResumeJson?: string | null;
  /** Auto-bid runner state; "none" for rows the runner never took. */
  bidState?: BidState;
  bidError?: string;
};

export const BID_STATES = [
  "none",
  "bidding",
  "submitted",
  "needs_you",
  "failed",
  "expired",
] as const;

export type BidState = (typeof BID_STATES)[number];

/** Table and filter labels; "bidding"/"submitted" read as the pipeline names users see. */
export const BID_STATE_LABELS: Record<BidState, string> = {
  none: "Not attempted",
  bidding: "Applying",
  submitted: "Sent",
  needs_you: "Needs you",
  failed: "Failed",
  expired: "Expired",
};

export function toBidState(value: unknown): BidState {
  const raw = String(value ?? "").trim().toLowerCase();
  return (BID_STATES as readonly string[]).includes(raw) ? (raw as BidState) : "none";
}

/**
 * Columns the Resume DB table can sort by. Shared so the table head, the route's
 * query parsing and the repository cannot drift out of step.
 */
export const RESUME_DB_SORT_KEYS = [
  "company",
  "jobTitle",
  "pipeline",
  "applied",
  "bid",
] as const;

export type ResumeDbSortKey = (typeof RESUME_DB_SORT_KEYS)[number];

export type ResumeDbSortDir = "asc" | "desc";

/**
 * Where the first click on a header lands. A date column reads newest-first, which
 * is what people want from "Applied"; names read A→Z.
 */
export const RESUME_DB_SORT_FIRST_DIR: Record<ResumeDbSortKey, ResumeDbSortDir> = {
  company: "asc",
  jobTitle: "asc",
  pipeline: "asc",
  applied: "desc",
  bid: "asc",
};

/** null for anything unrecognised, which the callers read as "default order". */
export function toSortKey(value: unknown): ResumeDbSortKey | null {
  const raw = String(value ?? "").trim();
  return (RESUME_DB_SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as ResumeDbSortKey)
    : null;
}

export function toSortDir(value: unknown): ResumeDbSortDir {
  return String(value ?? "").trim().toLowerCase() === "desc" ? "desc" : "asc";
}

export type ResumeDbSortState = {
  key: ResumeDbSortKey | null;
  dir: ResumeDbSortDir;
};

/**
 * Where a click on `key` lands, given the sort now in effect. Three stops per
 * column: the direction that reads naturally for it, the reverse, then off. That
 * third stop is what makes the default order reachable without editing the URL.
 */
export function nextSortState(
  current: ResumeDbSortState,
  key: ResumeDbSortKey,
): ResumeDbSortState {
  const firstDir = RESUME_DB_SORT_FIRST_DIR[key];
  if (current.key !== key) return { key, dir: firstDir };
  if (current.dir === firstDir) {
    return { key, dir: firstDir === "asc" ? "desc" : "asc" };
  }
  return { key: null, dir: firstDir };
}

/** apply value of a job queued for resume generation and not yet sent: not a bid, so not counted. */
export const QUEUED_APPLY = "Queued";

export const GENERATION_STATUSES =["none", "queue", "generating", "completed", "failed"] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export type ResumeDbApplicationInput = {
  entryId: string;
  profileId?: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  /** Left out, it is worked out from the job link. */
  atsPlatform?: string;
  note?: string;
  apply?: string;
  resumeUrl: string;
  coverLetterUrl?: string;
  resumeStoragePath?: string;
  coverLetterStoragePath?: string;
  resumeDriveFileId?: string;
  coverDriveFileId?: string;
  pipelineJobId?: number | null;
  pipelineStageId?: string | null;
  /** Written only when given (needs scripts/add-autogen-to-resume-db.sql). */
  jobDescription?: string;
  generationStatus?: GenerationStatus;
  /** When the job was posted, for Auto-bid's newest-first order (needs scripts/add-autobid-candidates.sql). */
  postedAt?: string | null;
};

export type ResumeDbJobExport = {
  entryId: string;
  id: number;
  profileId: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  note: string;
  resumeUrl: string;
  coverLetterUrl: string;
  apply: string;
  appliedAt: string;
  exportedAt: string;
  /** The resume JSON AutoGen built (checked against the kit), when there is one. */
  builtResume?: unknown;
};

export type ProfileListItem = {
  id: number;
  full_name: string;
};
