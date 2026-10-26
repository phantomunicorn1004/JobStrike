import "server-only";

import { planStageOrder, type StageCall, type StageEmail } from "@/lib/mail/stage-order";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type EmailRow = {
  id: string;
  category: "interview" | "assessment";
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

export type SequenceResult = { emails: number; interviews: number };

/**
 * Puts interview stages in order for the user's applications (rules in stage-order.ts). Emails
 * whose stage changed and that wait for a board decision are checked again by the next board pass.
 */
export async function sequenceInterviewStages(userId: string): Promise<SequenceResult> {
  const db = getSupabaseAdminClient();
  const result: SequenceResult = { emails: 0, interviews: 0 };

  const { data: emailData, error: emailError } = await db
    .from("mail_messages")
    .select("id, category, application_id, received_at, extracted, category_source, action_status")
    .eq("user_id", userId)
    // Assessments only tell when an AI screening happened; their stage is left alone.
    .in("category", ["interview", "assessment"])
    .not("application_id", "is", null)
    .order("received_at", { ascending: true })
    .limit(5000);
  if (emailError) throw new Error(emailError.message);
  const emailRows = (emailData ?? []) as EmailRow[];

  // round_source exists once scripts/add-mail-calendar-integration.sql has run again.
  const ivColumns = "id, application_id, starts_at, round, status, source";
  const ivQuery = (columns: string) =>
    db.from("interviews").select(columns).eq("user_id", userId).not("application_id", "is", null).order("starts_at", { ascending: true }).limit(5000);
  let ivRes = await ivQuery(`${ivColumns}, round_source`);
  if (ivRes.error) ivRes = await ivQuery(ivColumns);
  if (ivRes.error) throw new Error(ivRes.error.message);
  const ivRows = (ivRes.data ?? []) as unknown as InterviewRow[];

  const emails: StageEmail[] = emailRows.map((e) => ({
    id: e.id,
    applicationId: e.application_id,
    category: e.category,
    receivedAt: e.received_at,
    stage: (e.extracted?.interviewStage as string | null) ?? null,
    userSet: e.category_source === "user",
  }));
  const calls: StageCall[] = ivRows.map((i) => ({
    id: i.id,
    applicationId: i.application_id,
    startsAt: i.starts_at,
    round: i.round,
    cancelled: i.status === "cancelled",
    userSet: i.source === "manual" || i.round_source === "user",
  }));

  const plan = planStageOrder(emails, calls);
  const byId = new Map(emailRows.map((e) => [e.id, e]));
  for (const [id, stage] of plan.emails) {
    const row = byId.get(id)!;
    const patch: Record<string, unknown> = { extracted: { ...(row.extracted ?? {}), interviewStage: stage } };
    // A suggestion made for the old stage is worked out again.
    if (row.action_status === "suggested" || row.action_status === "none") {
      Object.assign(patch, { action: null, action_status: "none", action_checked_at: null });
    }
    const { error } = await db.from("mail_messages").update(patch as never).eq("id", id).eq("user_id", userId);
    if (!error) result.emails++;
  }
  for (const [id, round] of plan.calls) {
    const { error } = await db.from("interviews").update({ round } as never).eq("id", id).eq("user_id", userId);
    if (!error) result.interviews++;
  }
  return result;
}
