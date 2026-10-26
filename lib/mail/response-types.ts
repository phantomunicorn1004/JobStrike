import type { InterviewStage } from "@/lib/interviews/types";

/**
 * Where an application stands, from its emails (and board moves):
 * - not_responded: applied; no interview, rejection or offer yet ("application received" does not count)
 * - interviewing: invited to an interview or assessment; `stage` is the furthest one
 * - rejected / offer: the employer decided
 */
export type ResponseStatus = "not_responded" | "interviewing" | "rejected" | "offer";

export const RESPONSE_STATUS_LABELS: Record<ResponseStatus, string> = {
  not_responded: "Not responded",
  interviewing: "Interview",
  rejected: "Rejected",
  offer: "Offer",
};

export type ApplicationResponse = {
  applicationId: number;
  company: string;
  jobTitle: string;
  candidateName: string;
  profileId: number | null;
  appliedAt: string;
  status: ResponseStatus;
  stage: InterviewStage | null;
  /** Set by the user (wins until a newer reply email). */
  manual: boolean;
  /** An "application received" email came. */
  received: boolean;
  /** The last interview, rejection or offer. */
  lastResponseAt: string | null;
  lastSummary: string | null;
  emails: number;
};

export type ResponsesSummary = {
  applied: number;
  responded: number;
  interviewing: number;
  byStage: Record<InterviewStage, number>;
  rejected: number;
  offer: number;
  notResponded: number;
};

export type ResponsesResponse = {
  summary: ResponsesSummary;
  items: ApplicationResponse[];
  hasMore: boolean;
  /** Applications from this date on are tracked (the mailboxes' first scan reaches back to it). */
  trackingSince: string | null;
};

/** Accuracy check scores: the share JobStrike got right (0–1), null before any review. */
export type ReviewStats = {
  reviewed: number;
  type: number | null;
  stage: number | null;
  link: number | null;
};
