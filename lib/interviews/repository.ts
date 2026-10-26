import "server-only";

import { failOn } from "@/lib/integrations/accounts-repository";
import { normalizeRound, type InterviewRound, type InterviewView } from "@/lib/interviews/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const interviews = () => getSupabaseAdminClient().from("interviews");

export type InterviewRow = {
  id: string;
  user_id: string;
  application_id: number | null;
  account_id: string | null;
  company: string | null;
  job_title: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  round: string | null;
  title: string | null;
  meeting_url: string | null;
  location: string | null;
  interviewers: string | null;
  source: InterviewView["source"];
  source_ref: string | null;
  calendar_event_id: string | null;
  status: InterviewView["status"];
  result: InterviewView["result"];
  notes: string | null;
};

export type InterviewFields = Partial<Omit<InterviewRow, "id" | "user_id">>;

const COLUMNS =
  "id, user_id, application_id, account_id, company, job_title, starts_at, ends_at, timezone, round, title, meeting_url, location, interviewers, source, source_ref, calendar_event_id, status, result, notes";

export function asRound(value: string | null | undefined): InterviewRound {
  return normalizeRound(value);
}

export async function getInterviewRow(userId: string, id: string): Promise<InterviewRow | null> {
  const { data, error } = await interviews().select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  failOn(error);
  return (data as InterviewRow | null) ?? null;
}

export async function insertInterview(userId: string, fields: InterviewFields & { starts_at: string; source: InterviewRow["source"] }): Promise<InterviewRow> {
  const { data, error } = await interviews()
    .insert({ ...fields, user_id: userId } as never)
    .select(COLUMNS)
    .single();
  failOn(error);
  return data as unknown as InterviewRow;
}

export async function updateInterview(
  userId: string,
  id: string,
  fields: InterviewFields & { round_source?: "user" | "auto" },
): Promise<InterviewRow | null> {
  const run = (values: Record<string, unknown>) =>
    interviews()
      .update({ ...values, updated_at: new Date().toISOString() } as never)
      .eq("id", id)
      .eq("user_id", userId)
      .select(COLUMNS)
      .maybeSingle();
  let { data, error } = await run(fields);
  // Before the round_source column exists the round still saves.
  if (error && "round_source" in fields && /round_source/.test(error.message)) {
    const { round_source: _ignored, ...rest } = fields;
    ({ data, error } = await run(rest));
  }
  failOn(error);
  return (data as InterviewRow | null) ?? null;
}

export async function deleteInterview(userId: string, id: string): Promise<void> {
  const { error } = await interviews().delete().eq("id", id).eq("user_id", userId);
  failOn(error);
}

/** The same interview seen again: same application (or company) within a few hours. */
export async function findInterviewNear(
  userId: string,
  key: { applicationId: number | null; company: string | null },
  startsAt: string,
  hours = 3,
  /** "unlinkedEmail": only interviews from emails without a calendar event; "calendar": only from the calendar. */
  only: "unlinkedEmail" | "calendar" | null = null,
): Promise<InterviewRow | null> {
  if (!key.applicationId && !key.company) return null;
  const t = new Date(startsAt).getTime();
  let query = interviews()
    .select(COLUMNS)
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .gte("starts_at", new Date(t - hours * 3_600_000).toISOString())
    .lte("starts_at", new Date(t + hours * 3_600_000).toISOString());
  query = key.applicationId ? query.eq("application_id", key.applicationId) : query.ilike("company", key.company!);
  if (only === "unlinkedEmail") query = query.eq("source", "email").is("calendar_event_id", null);
  if (only === "calendar") query = query.eq("source", "calendar");
  const { data, error } = await query.limit(1);
  failOn(error);
  return ((data ?? []) as InterviewRow[])[0] ?? null;
}

/** The next scheduled interview of an application after a time (for reschedules and cancellations). */
export async function findNextScheduled(userId: string, applicationId: number, after: string): Promise<InterviewRow | null> {
  const { data, error } = await interviews()
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .eq("status", "scheduled")
    .gte("starts_at", after)
    .order("starts_at", { ascending: true })
    .limit(1);
  failOn(error);
  return ((data ?? []) as InterviewRow[])[0] ?? null;
}

/**
 * The application's earliest interview (from an email or added by hand) that was still ahead
 * when `at` came: a new confirmation then gives it its new time.
 */
export async function findPendingAt(userId: string, applicationId: number, at: string): Promise<InterviewRow | null> {
  const { data, error } = await interviews()
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .in("source", ["email", "manual"])
    .neq("status", "cancelled")
    .gt("starts_at", at)
    .order("starts_at", { ascending: true })
    .limit(1);
  failOn(error);
  return ((data ?? []) as InterviewRow[])[0] ?? null;
}

export async function findByCalendarEvent(userId: string, eventId: string): Promise<InterviewRow | null> {
  const { data, error } = await interviews().select(COLUMNS).eq("user_id", userId).eq("calendar_event_id", eventId).maybeSingle();
  failOn(error);
  return (data as InterviewRow | null) ?? null;
}

type JoinedRow = InterviewRow & {
  application: { id: number; company: string | null; job_title: string | null; candidate_name: string | null; profile_id: number | null } | null;
};

export async function listInterviews(userId: string, range: { from?: string; to?: string } = {}): Promise<InterviewView[]> {
  let query = interviews()
    .select(`${COLUMNS}, application:resume_db_applications(id, company, job_title, candidate_name, profile_id)`)
    .eq("user_id", userId);
  if (range.from) query = query.gte("starts_at", range.from);
  if (range.to) query = query.lte("starts_at", range.to);
  const { data, error } = await query.order("starts_at", { ascending: true }).limit(500);
  failOn(error);
  const rows = (data ?? []) as unknown as JoinedRow[];

  // Links to the emails the interviews came from.
  const messageIds = rows.filter((r) => r.source === "email" && r.source_ref).map((r) => r.source_ref!);
  const links = new Map<string, string>();
  if (messageIds.length) {
    const { data: messages } = await getSupabaseAdminClient()
      .from("mail_messages")
      .select("id, web_link")
      .eq("user_id", userId)
      .in("id", messageIds);
    for (const m of (messages ?? []) as { id: string; web_link: string | null }[]) if (m.web_link) links.set(m.id, m.web_link);
  }

  return rows.map((r) => ({
    id: r.id,
    application: r.application
      ? {
          id: r.application.id,
          company: r.application.company ?? "",
          jobTitle: r.application.job_title ?? "",
          candidateName: r.application.candidate_name ?? "",
          profileId: r.application.profile_id,
        }
      : null,
    company: r.application?.company || r.company || r.title || "Interview",
    jobTitle: r.application?.job_title || r.job_title || "",
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    timezone: r.timezone,
    round: asRound(r.round),
    title: r.title,
    meetingUrl: r.meeting_url,
    location: r.location,
    interviewers: r.interviewers,
    source: r.source,
    emailLink: r.source === "email" && r.source_ref ? links.get(r.source_ref) ?? null : null,
    inCalendar: Boolean(r.calendar_event_id),
    status: r.status,
    result: r.result,
    notes: r.notes,
  }));
}

/** Next scheduled interview per application (board cards). */
export async function nextInterviewByApplication(userId: string): Promise<Record<number, { startsAt: string; round: InterviewRound }>> {
  const { data, error } = await interviews()
    .select("application_id, starts_at, round")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .gte("starts_at", new Date(Date.now() - 2 * 3_600_000).toISOString())
    .not("application_id", "is", null)
    .order("starts_at", { ascending: true });
  if (error) return {};
  const out: Record<number, { startsAt: string; round: InterviewRound }> = {};
  for (const r of (data ?? []) as { application_id: number; starts_at: string; round: string | null }[]) {
    out[r.application_id] ??= { startsAt: r.starts_at, round: asRound(r.round) };
  }
  return out;
}
