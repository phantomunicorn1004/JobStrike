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
