import { INTERVIEW_ROUND_LABELS, normalizeRound, type InterviewStage } from "@/lib/interviews/types";
import type { MailCategory } from "@/lib/mail/categories";

/**
 * Which board column an email moves its application to (docs/EMAIL_CALENDAR_INTEGRATION.md,
 * section 6). The board's columns can be renamed, so their roles are found by id and name.
 * Cards only move forward; a rejection moves from anywhere; nothing moves a card out of Reject.
 */

export type BoardStage = { id: string; name: string; sort_order: number };

export type StageRoles = {
  /** Columns in board order, Reject left out. Index = how far along. */
  ladder: string[];
  reject: string | null;
  screening: string | null;
  hr: string | null;
  technical: string | null;
  final: string | null;
};

/** Same words the dashboard uses for rejection columns. */
const REJECT_RE = /reject|declin|not selected|no offer|ghost|withdraw/i;

export function resolveStageRoles(stages: BoardStage[]): StageRoles {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const label = (s: BoardStage) => `${s.id} ${s.name}`;
  const reject = sorted.find((s) => REJECT_RE.test(label(s))) ?? null;
  const ladder = sorted.filter((s) => s !== reject);

  const screening = ladder.find((s) => s.id === "applied") ?? ladder[0] ?? null;
  const later = ladder.filter((s) => s !== screening);
  const pick = (re: RegExp, fallbackIndex: number) =>
    later.find((s) => re.test(label(s))) ?? ladder[fallbackIndex] ?? null;

  const final = pick(/final|onsite|on-site|panel|offer/i, ladder.length - 1);
  const technical = pick(/tech|coding|assess|skill/i, Math.min(2, ladder.length - 1));
  // No HR-like column: a screening call belongs in the first column.
  const hr = later.find((s) => /\bhr\b|hr-|recruit|phone|manager|intro|screen/i.test(label(s))) ?? screening;

  return {
    ladder: ladder.map((s) => s.id),
    reject: reject?.id ?? null,
    screening: screening?.id ?? null,
    hr: hr?.id ?? null,
    technical: technical?.id ?? null,
    final: final?.id ?? null,
  };
}

/** -1 = Registered (no card). Null for a column the rules do not know (left alone). */
function level(roles: StageRoles, stage: string | null): number | null {
  if (stage === null) return -1;
  const index = roles.ladder.indexOf(stage);
  return index >= 0 ? index : null;
}

/** The interview stage from the AI, or from the wording when the AI did not say. */
export function interviewStageOf(stageHint: string | null | undefined, text: string): InterviewStage {
  const hint = normalizeRound(stageHint);
  if (hint !== "other") return hint;
  if (/\b(final|onsite|on-site|panel|superday|last round|executive)\b/i.test(text)) return "final";
  if (/\b(technical|coding|system design|live cod|pair program|tech screen|engineering interview|hackerrank|codesignal|codility)\b/i.test(text)) {
    return "technical";
  }
  if (/\b(hirevue|one-way|one way|video interview|ai interview|ai interviewer|asynchronous|spark hire|paradox|olivia)\b/i.test(text)) {
    return "ai_screening";
  }
  if (/\b(hiring manager|hr interview|human resources)\b/i.test(text)) return "hr";
  return "screening";
}

/** The board column role for an interview stage. */
export function interviewRole(stageHint: string | null | undefined, text: string): "screening" | "hr" | "technical" | "final" {
  const stage = interviewStageOf(stageHint, text);
  return stage === "ai_screening" ? "screening" : stage;
}

/** A stored suggestion still makes sense: forward, or a rejection of a card not yet rejected. */
export function isStillAMove(roles: StageRoles, currentStage: string | null, toStage: string): boolean {
  if (toStage === roles.reject) return currentStage !== roles.reject;
  if (currentStage !== null && currentStage === roles.reject) return false;
  const now = level(roles, currentStage);
  const next = level(roles, toStage);
  return now !== null && next !== null && next > now;
}

export type PlannedMove = { toStage: string; fromStage: string | null; reason: string };

export function planMove(input: {
  category: MailCategory;
  interviewStage: string | null;
  text: string;
  currentStage: string | null;
  roles: StageRoles;
  company: string;
  receivedAt: string;
}): PlannedMove | null {
  const { roles, currentStage } = input;
  const day = new Date(input.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const from = input.company ? ` from ${input.company}` : "";

  if (input.category === "rejection") {
    if (!roles.reject || currentStage === roles.reject) return null;
    return { toStage: roles.reject, fromStage: currentStage, reason: `Rejection email${from} (${day})` };
  }
  // Out of Reject only by hand.
  if (currentStage !== null && currentStage === roles.reject) return null;

  let target: string | null = null;
  let what = "";
  if (input.category === "offer") {
    target = roles.final;
    what = "Offer email";
  } else if (input.category === "interview" || input.category === "assessment") {
    const stage = interviewStageOf(input.interviewStage, input.text);
    // An assessment is at most a technical step; it never skips to the final column.
    const role = stage === "ai_screening" ? "screening" : input.category === "assessment" && stage === "final" ? "technical" : stage;
    target = roles[role];
    what =
      input.category === "assessment"
        ? input.interviewStage
          ? `${INTERVIEW_ROUND_LABELS[role === "screening" ? stage : role]} assessment`
          : "Assessment"
        : `${INTERVIEW_ROUND_LABELS[stage]} interview`;
  }
  if (!target) return null;

  const now = level(roles, currentStage);
  const next = level(roles, target);
  if (now === null || next === null || next <= now) return null;
  return { toStage: target, fromStage: currentStage, reason: `${what}${from} (${day})` };
}
