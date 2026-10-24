/** What a job email is about (shared by the server and the Inbox page). */
export const MAIL_CATEGORIES = [
  "interview",
  "assessment",
  "offer",
  "rejection",
  "update",
  "confirmation",
  "outreach",
  "other",
  "not_job",
] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const MAIL_CATEGORY_LABELS: Record<MailCategory | "unclassified", string> = {
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejection: "Rejection",
  update: "Update",
  confirmation: "Application received",
  outreach: "Recruiter",
  other: "Other",
  not_job: "Not job-related",
  unclassified: "Sorting…",
};

export function parseMailCategory(value: unknown): MailCategory | null {
  return MAIL_CATEGORIES.includes(value as MailCategory) ? (value as MailCategory) : null;
}

/** Categories about a specific application (the others need no match). */
export const APPLICATION_CATEGORIES: MailCategory[] = [
  "interview",
  "assessment",
  "offer",
  "rejection",
  "update",
  "confirmation",
  "other",
];

/** Inbox tabs. */
export const INBOX_VIEWS = ["attention", "inbox", "suggested", "review", "interviews", "rejections", "applied", "unmatched", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export type InboxApplication = {
  id: number;
  company: string;
  jobTitle: string;
  candidateName: string;
  jobLink: string;
  appliedAt: string;
};

export type InboxItem = {
  id: string;
  receivedAt: string;
  fromName: string | null;
  fromEmail: string;
  subject: string;
  snippet: string;
  webLink: string | null;
  category: MailCategory | "unclassified";
  categorySource: "ai" | "user";
  confidence: number | null;
  summary: string | null;
  company: string | null;
  jobTitle: string | null;
  /** Interviews and assessments: "ai_screening", "screening", "hr", "technical", "final". */
  interviewStage: string | null;
  application: InboxApplication | null;
  matchScore: number | null;
  matchReason: string | null;
  linkSource: "auto" | "user";
  accountEmail: string;
  profileId: number | null;
  /** A board move this email suggests or made. */
  action: InboxAction | null;
  actionStatus: "none" | "suggested" | "applied" | "dismissed";
};

export type InboxAction = { kind: "move"; toStage: string; fromStage: string | null; reason: string; eventId?: number | null };

/** One logged board move, for the Activity tab. */
export type ActivityEntry = {
  id: number;
  at: string;
  fromStage: string | null;
  toStage: string | null;
  source: "email" | "manual";
  reason: string | null;
  undone: boolean;
  application: { id: number; company: string; jobTitle: string; candidateName: string } | null;
};

export type InboxResponse = {
  items: InboxItem[];
  counts: Record<InboxView, number>;
  /** Emails still waiting to be sorted. */
  pending: number;
  /** Older items exist; pass the last item's receivedAt as `before`. */
  hasMore: boolean;
  hasMailbox: boolean;
  profiles: { id: number; fullName: string }[];
  /** Board columns, for naming moves. */
  stages: { id: string; name: string }[];
  /** Waiting suggestions per target column. */
  suggestions: { toStage: string; count: number }[];
};
