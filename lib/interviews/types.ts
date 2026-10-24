/** Shared by the server and the Calendar page. */

/**
 * Interview stages, in order. AI screening: an AI interviewer, one-way video or automated
 * screening (HireVue, Spark Hire, chat screening). Screening: the first call with a recruiter.
 * HR: an HR or hiring-manager interview. Technical: technical interviews and coding tests.
 * Final: final round, onsite, panel. "other" when the email does not say.
 */
export const INTERVIEW_STAGES = ["ai_screening", "screening", "hr", "technical", "final"] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

export const INTERVIEW_ROUNDS = [...INTERVIEW_STAGES, "other"] as const;
export type InterviewRound = (typeof INTERVIEW_ROUNDS)[number];

export const INTERVIEW_ROUND_LABELS: Record<InterviewRound, string> = {
  ai_screening: "AI screening",
  screening: "Screening",
  hr: "HR",
  technical: "Technical",
  final: "Final",
  other: "Interview",
};

/** A stored stage or round, including the older names ("screen"). */
export function normalizeRound(value: string | null | undefined): InterviewRound {
  if (value === "screen") return "screening";
  return INTERVIEW_ROUNDS.includes(value as InterviewRound) ? (value as InterviewRound) : "other";
}

export type InterviewStatus = "scheduled" | "done" | "cancelled";
export type InterviewResult = "passed" | "waiting" | "rejected";

export type InterviewView = {
  id: string;
  application: { id: number; company: string; jobTitle: string; candidateName: string; profileId: number | null } | null;
  /** Shown name: the application's, or what the email or event said. */
  company: string;
  jobTitle: string;
  startsAt: string;
  endsAt: string | null;
  /** The timezone the recruiter wrote the time in, when it differs from the user's. */
  timezone: string | null;
  round: InterviewRound;
  title: string | null;
  meetingUrl: string | null;
  location: string | null;
  interviewers: string | null;
  source: "email" | "calendar" | "manual";
  /** Opens the email the interview came from. */
  emailLink: string | null;
  inCalendar: boolean;
  status: InterviewStatus;
  result: InterviewResult | null;
  notes: string | null;
};

export type InterviewsResponse = {
  interviews: InterviewView[];
  /** The user's timezone (Settings), for showing times. */
  timezone: string;
  /** A connected mailbox allows adding events. */
  canAddToCalendar: boolean;
  profiles: { id: number; fullName: string }[];
};

/** A finished interview waits this long for "How did it go?". */
export const OUTCOME_PROMPT_DAYS = 14;
