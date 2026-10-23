import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** One board move (docs/EMAIL_CALENDAR_INTEGRATION.md, section 3, pipeline_events). */
export type PipelineEvent = {
  id: number;
  applicationId: number;
  fromStage: string | null;
  toStage: string | null;
  source: "email" | "manual";
  refId: string | null;
  reason: string | null;
  at: string;
  undoneAt: string | null;
};

type EventRow = {
  id: number;
  application_id: number;
  from_stage: string | null;
  to_stage: string | null;
  source: PipelineEvent["source"];
  ref_id: string | null;
  reason: string | null;
  at: string;
  undone_at: string | null;
};

const COLUMNS = "id, application_id, from_stage, to_stage, source, ref_id, reason, at, undone_at";

function toEvent(row: EventRow): PipelineEvent {
  return {
    id: row.id,
    applicationId: row.application_id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    source: row.source,
    refId: row.ref_id,
    reason: row.reason,
    at: row.at,
    undoneAt: row.undone_at,
  };
}

const events = () => getSupabaseAdminClient().from("pipeline_events");

/** Records a move. Returns its id, or null when the table is not there yet (moves still happen). */
export async function recordPipelineEvent(
  userId: string,
  event: { applicationId: number; fromStage: string | null; toStage: string | null; source: PipelineEvent["source"]; refId?: string | null; reason?: string | null },
): Promise<number | null> {
  const { data, error } = await events()
    .insert({
      user_id: userId,
      application_id: event.applicationId,
      from_stage: event.fromStage,
      to_stage: event.toStage,
      source: event.source,
      ref_id: event.refId ?? null,
      reason: event.reason?.slice(0, 300) ?? null,
    } as never)
    .select("id")
    .single();
  if (error) {
    console.warn("Pipeline event not recorded:", error.message);
    return null;
  }
  return (data as { id: number }).id;
}

export async function getPipelineEvent(userId: string, id: number): Promise<PipelineEvent | null> {
  const { data, error } = await events().select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toEvent(data as EventRow) : null;
}

export async function markPipelineEventUndone(userId: string, id: number): Promise<void> {
  const { error } = await events().update({ undone_at: new Date().toISOString() } as never).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function listPipelineEvents(
  userId: string,
  page: { before: string | null; limit: number; source?: PipelineEvent["source"] },
): Promise<{ events: PipelineEvent[]; hasMore: boolean }> {
  let query = events().select(COLUMNS).eq("user_id", userId);
  if (page.source) query = query.eq("source", page.source);
  if (page.before) query = query.lt("at", page.before);
  const { data, error } = await query.order("at", { ascending: false }).limit(page.limit + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EventRow[];
  return { events: rows.slice(0, page.limit).map(toEvent), hasMore: rows.length > page.limit };
}
