import { INTERVIEW_STAGES, normalizeRound, type InterviewStage } from "@/lib/interviews/types";

/**
 * Interview stages by order, per application (no database here; see stage-sequence.ts):
 * - The first scheduled call is the Screening, and so is every email about it (availability
 *   request, confirmation, reminder, reschedule): it ends 12 hours after that call starts.
 *   Unless an AI screening came first: that was the screening, so the first call is a next step.
 * - Later calls are never Screening: the AI's HR / Technical / Final stays; "screening" or
 *   unknown becomes HR, the step after screening.
 * - AI screenings (one-way video, AI interviewer) and assessments are not calls; left as they are.
 * - Whatever the user set (stage picker on an email, round edited in the Calendar) is never changed.
 */

/** Without any scheduled interview, the emails of the first week are about the first call. */
export const FIRST_CALL_WITHOUT_DATE_MS = 7 * 86_400_000;
/** The first call is over this long after it starts. */
export const FIRST_CALL_AFTER_START_MS = 12 * 3_600_000;

export type StageEmail = {
  id: string;
  applicationId: number;
  category: "interview" | "assessment";
  receivedAt: string;
  stage: string | null;
  /** Set by the user: never changed, but still counts for the order. */
  userSet: boolean;
};

export type StageCall = {
  id: string;
  applicationId: number;
  startsAt: string;
  round: string | null;
  cancelled: boolean;
  /** Added or edited by the user: never changed. */
  userSet: boolean;
};

export type StagePlan = { emails: Map<string, InterviewStage>; calls: Map<string, InterviewStage> };

const after = (stage: InterviewStage): InterviewStage =>
  INTERVIEW_STAGES[Math.min(INTERVIEW_STAGES.length - 1, Math.max(INTERVIEW_STAGES.indexOf(stage) + 1, INTERVIEW_STAGES.indexOf("hr")))];

/** The stage a later call gets: the AI's, unless that is Screening (or unknown). */
function laterStage(current: string | null | undefined): InterviewStage {
  const s = normalizeRound(current);
  return s === "screening" || s === "other" ? "hr" : s;
}

const time = (iso: string) => new Date(iso).getTime();

/** The stages that should change (emails and calls), from all of the user's interview data. */
export function planStageOrder(allEmails: StageEmail[], allCalls: StageCall[]): StagePlan {
  const plan: StagePlan = { emails: new Map(), calls: new Map() };
  const appIds = new Set([...allEmails.map((e) => e.applicationId), ...allCalls.map((c) => c.applicationId)]);

  for (const appId of appIds) {
    const live = allCalls
      .filter((c) => c.applicationId === appId && !c.cancelled)
      .sort((a, b) => time(a.startsAt) - time(b.startsAt));
    const calls = live.filter((c) => normalizeRound(c.round) !== "ai_screening");
    const emails = allEmails.filter((e) => e.applicationId === appId).sort((a, b) => time(a.receivedAt) - time(b.receivedAt));
    const interviewEmails = emails.filter((e) => e.category === "interview");
    const firstHumanEmail = interviewEmails.find((e) => normalizeRound(e.stage) !== "ai_screening");

    // An AI screening before the first call was the screening step.
    const firstHumanAt = calls[0] ? time(calls[0].startsAt) : firstHumanEmail ? time(firstHumanEmail.receivedAt) : Infinity;
    const screenedByAi = [
      ...emails.filter((e) => normalizeRound(e.stage) === "ai_screening").map((e) => time(e.receivedAt)),
      ...live.filter((c) => normalizeRound(c.round) === "ai_screening").map((c) => time(c.startsAt)),
    ].some((t) => t < firstHumanAt);

    // When the first call is over.
    const firstCallEnd = calls[0]
      ? time(calls[0].startsAt) + FIRST_CALL_AFTER_START_MS
      : firstHumanEmail
        ? time(firstHumanEmail.receivedAt) + FIRST_CALL_WITHOUT_DATE_MS
        : 0;

    for (const e of interviewEmails) {
      if (e.userSet || normalizeRound(e.stage) === "ai_screening") continue;
      const wanted: InterviewStage = !screenedByAi && time(e.receivedAt) < firstCallEnd ? "screening" : laterStage(e.stage);
      if (normalizeRound(e.stage) !== wanted) plan.emails.set(e.id, wanted);
    }

    let highest: InterviewStage | null = null;
    calls.forEach((call, index) => {
      const current = normalizeRound(call.round);
      if (call.userSet) {
        if (current !== "other") highest = current as InterviewStage;
        return;
      }
      // The first call is the Screening; later ones follow the last stage reached.
      const wanted: InterviewStage =
        index === 0 && !screenedByAi ? "screening" : current === "other" && highest ? after(highest) : laterStage(current);
      highest = wanted;
      if (current !== wanted) plan.calls.set(call.id, wanted);
    });
  }
  return plan;
}
