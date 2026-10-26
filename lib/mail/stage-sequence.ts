import "server-only";

import { INTERVIEW_STAGES, normalizeRound, type InterviewStage } from "@/lib/interviews/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Interview stages by order, per application:
 * - The first scheduled call is the Screening, and so is every email about it (availability
 *   request, confirmation, reminder, reschedule): it ends 12 hours after that call starts.
 *   Unless an AI screening came first: that was the screening, so the first call is a next step.
 * - Later calls are never Screening: the AI's HR / Technical / Final stays; "screening" or
 *   unknown becomes HR, the step after screening.
 * - AI screenings (one-way video, AI interviewer) and assessments are not calls; left as they are.
 * - Whatever the user set (stage picker on an email, round edited in the Calendar) is never changed.
 */

/** Without any scheduled interview, the emails of the first week are about the first call. */
const FIRST_CALL_WITHOUT_DATE_MS = 7 * 86_400_000;
/** The first call is over this long after it starts. */
const FIRST_CALL_AFTER_START_MS = 12 * 3_600_000;

type EmailRow = {
  id: string;
  category: string;
  application_id: number;
  received_at: string;
  extracted: Record<string, unknown> | null;
  category_source: string;
  action_status: string;
};
type InterviewRow = {
  id: string;
  application_id: number;
  starts_at: string;
  round: string | null;
  status: string;
  source: string;
  round_source?: string;
};

const after = (stage: InterviewStage): InterviewStage =>
  INTERVIEW_STAGES[Math.min(INTERVIEW_STAGES.length - 1, Math.max(INTERVIEW_STAGES.indexOf(stage) + 1, INTERVIEW_STAGES.indexOf("hr")))];

/** The stage a later call gets: the AI's, unless that is Screening (or unknown). */
function laterStage(current: string | null | undefined): InterviewStage {
  const s = normalizeRound(current);
  return s === "screening" || s === "other" ? "hr" : s;
}

export type SequenceResult = { emails: number; interviews: number };

/**
 * Puts interview stages in order for the user's applications (or some). Emails whose stage
 * changed and that wait for a board decision are checked again by the caller's next board pass.
 */
export async function sequenceInterviewStages(userId: string, applicationIds?: number[]): Promise<SequenceResult> {
  const db = getSupabaseAdminClient();
  const result: SequenceResult = { emails: 0, interviews: 0 };

  let emailQuery = db
    .from("mail_messages")
    .select("id, category, application_id, received_at, extracted, category_source, action_status")
    .eq("user_id", userId)
    // Assessments only tell when an AI screening happened; their stage is left alone.
    .in("category", ["interview", "assessment"])
    .not("application_id", "is", null);
  if (applicationIds) emailQuery = emailQuery.in("application_id", applicationIds.length ? applicationIds : [-1]);
  const { data: emailData, error: emailError } = await emailQuery.order("received_at", { ascending: true }).limit(5000);
  if (emailError) throw new Error(emailError.message);
  const emails = (emailData ?? []) as EmailRow[];

  // round_source exists once scripts/add-mail-calendar-integration.sql has run again.
  const ivColumns = "id, application_id, starts_at, round, status, source";
  const ivQuery = (columns: string) => {
    let q = db.from("interviews").select(columns).eq("user_id", userId).not("application_id", "is", null);
    if (applicationIds) q = q.in("application_id", applicationIds.length ? applicationIds : [-1]);
    return q.order("starts_at", { ascending: true }).limit(5000);
  };
  let ivRes = await ivQuery(`${ivColumns}, round_source`);
  const roundSourceKnown = !ivRes.error;
  if (ivRes.error) ivRes = await ivQuery(ivColumns);
  if (ivRes.error) throw new Error(ivRes.error.message);
  const interviews = (ivRes.data ?? []) as unknown as InterviewRow[];

  const appIds = new Set([...emails.map((e) => e.application_id), ...interviews.map((i) => i.application_id)]);
  for (const appId of appIds) {
    const calls = interviews.filter(
      (i) => i.application_id === appId && i.status !== "cancelled" && normalizeRound(i.round) !== "ai_screening",
    );
    const appEmails = emails.filter((e) => e.application_id === appId && e.category === "interview");
    const firstHumanEmail = appEmails.find((e) => normalizeRound(e.extracted?.interviewStage as string) !== "ai_screening");

    // An AI screening before the first call was the screening step.
    const aiTimes = [
      ...emails
        .filter((e) => e.application_id === appId && normalizeRound(e.extracted?.interviewStage as string) === "ai_screening")
        .map((e) => new Date(e.received_at).getTime()),
      ...interviews
        .filter((i) => i.application_id === appId && i.status !== "cancelled" && normalizeRound(i.round) === "ai_screening")
        .map((i) => new Date(i.starts_at).getTime()),
    ];
    const firstHumanAt = calls[0]
      ? new Date(calls[0].starts_at).getTime()
      : firstHumanEmail
        ? new Date(firstHumanEmail.received_at).getTime()
        : Infinity;
    const screenedByAi = aiTimes.some((t) => t < firstHumanAt);

    // When the first call is over.
    const firstCallEnd = calls[0]
      ? new Date(calls[0].starts_at).getTime() + FIRST_CALL_AFTER_START_MS
      : firstHumanEmail
        ? new Date(firstHumanEmail.received_at).getTime() + FIRST_CALL_WITHOUT_DATE_MS
        : 0;

    for (const e of appEmails) {
      const stage = e.extracted?.interviewStage as string | null | undefined;
      if (e.category_source === "user" || normalizeRound(stage) === "ai_screening") continue;
      const wanted: InterviewStage =
        !screenedByAi && new Date(e.received_at).getTime() < firstCallEnd ? "screening" : laterStage(stage);
      if (normalizeRound(stage) === wanted) continue;
      const patch: Record<string, unknown> = { extracted: { ...(e.extracted ?? {}), interviewStage: wanted } };
      // A suggestion made for the old stage is worked out again.
      if (e.action_status === "suggested" || e.action_status === "none") {
        Object.assign(patch, { action: null, action_status: "none", action_checked_at: null });
      }
      const { error } = await db.from("mail_messages").update(patch as never).eq("id", e.id).eq("user_id", userId);
      if (!error) result.emails++;
    }

    let highest: InterviewStage | null = null;
    for (const [index, call] of calls.entries()) {
      const current = normalizeRound(call.round);
      if (call.source === "manual" || (roundSourceKnown && call.round_source === "user")) {
        if (current !== "other") highest = current;
        continue;
      }
      // The first call is the Screening; later ones follow the last stage reached.
      const wanted: InterviewStage =
        index === 0 && !screenedByAi ? "screening" : current === "other" && highest ? after(highest) : laterStage(current);
      highest = wanted;
      if (current === wanted) continue;
      const { error } = await db.from("interviews").update({ round: wanted } as never).eq("id", call.id).eq("user_id", userId);
      if (!error) result.interviews++;
    }
  }
  return result;
}
