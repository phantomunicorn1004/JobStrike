import "server-only";

import { findUserById } from "@/lib/auth/repository";
import { failOn } from "@/lib/integrations/accounts-repository";
import { getGoogleMessageText, listGoogleEvents } from "@/lib/integrations/google/calendar";
import { getMicrosoftMessageText, listMicrosoftEvents } from "@/lib/integrations/microsoft/calendar";
import { CALENDAR_WRITE_SCOPE } from "@/lib/integrations/providers";
import type { CalendarEvent } from "@/lib/interviews/calendar-types";
import { extractInterviewDetails, type InterviewDetails } from "@/lib/interviews/extract";
import {
  findByCalendarEvent,
  findInterviewNear,
  findNextScheduled,
  findPendingAt,
  insertInterview,
  updateInterview,
  type InterviewFields,
  type InterviewRow,
} from "@/lib/interviews/repository";
import { interviewRole } from "@/lib/mail/board-rules";
import { listMatchCandidates } from "@/lib/mail/inbox-repository";
import type { MatchCandidate } from "@/lib/mail/match";
import { organisationMatchesCompany, senderOrganisation } from "@/lib/mail/prefilter";
import { accessTokenFor } from "@/lib/mail/sync";
import { getSyncAccount, saveCalendarReadAt, type SyncAccount } from "@/lib/mail/sync-repository";
import { normalizeCompanyName } from "@/lib/company-name";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE, isValidTimeZone, normalizeTimeZone, zonedLocalToUtcIso } from "@/lib/timezone";

/** An interview this long ago is stored as done (no "How did it go?" for old backlog). */
const PAST_AS_DONE_MS = 24 * 3_600_000;

function statusFor(startsAt: string, endsAt: string | null): "scheduled" | "done" {
  return new Date(endsAt ?? startsAt).getTime() < Date.now() - PAST_AS_DONE_MS ? "done" : "scheduled";
}

/** Fills only what is new: a later email adds the link without erasing earlier details. */
function merge(fields: InterviewFields): InterviewFields {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)) as InterviewFields;
}

// --- From interview emails ---------------------------------------------------------------------

type InterviewEmail = {
  id: string;
  user_id: string;
  account_id: string;
  application_id: number | null;
  provider_id: string;
  thread_id: string | null;
  subject: string | null;
  from_name: string | null;
  from_email: string;
  received_at: string;
  extracted: { company?: string | null; jobTitle?: string | null; interviewStage?: string | null } | null;
};

/**
 * The interview an earlier email of the same conversation created (not cancelled). Recruiters
 * send reminders, updated invitations and new times in the same thread.
 */
async function findThreadInterview(email: InterviewEmail): Promise<InterviewRow | null> {
  if (!email.thread_id) return null;
  const db = getSupabaseAdminClient();
  const { data: messages } = await db
    .from("mail_messages")
    .select("id")
    .eq("user_id", email.user_id)
    .eq("account_id", email.account_id)
    .eq("thread_id", email.thread_id)
    .neq("id", email.id);
  const ids = ((messages ?? []) as { id: string }[]).map((m) => m.id);
  if (ids.length === 0) return null;
  let query = db
    .from("interviews")
    .select("id, starts_at, application_id")
    .eq("user_id", email.user_id)
    .eq("source", "email")
    .neq("status", "cancelled")
    .in("source_ref", ids);
  // A thread about one application never moves another application's interview.
  if (email.application_id) query = query.eq("application_id", email.application_id);
  const { data } = await query.order("created_at", { ascending: false }).limit(1);
  return ((data ?? []) as InterviewRow[])[0] ?? null;
}

/** Two rounds can be the same interview ("other" is unknown, so it fits any). */
function sameRound(a: string | null | undefined, b: string | null | undefined): boolean {
  return !a || !b || a === b || a === "other" || b === "other";
}

const ROUND_FROM_STAGE: Record<string, InterviewDetails["round"]> = { hr: "screen", technical: "technical", final: "final" };

/** Stores, moves or cancels the interview an email describes. */
async function applyDetails(email: InterviewEmail, details: InterviewDetails, userTimeZone: string): Promise<string> {
  const company = email.extracted?.company ?? null;
  const key = { applicationId: email.application_id, company };

  if (details.kind === "cancelled") {
    if (!email.application_id) return "skipped";
    const target = await findNextScheduled(email.user_id, email.application_id, new Date(new Date(email.received_at).getTime() - 86_400_000).toISOString());
    if (!target) return "skipped";
    await updateInterview(email.user_id, target.id, { status: "cancelled" });
    return "cancelled";
  }
  if ((details.kind !== "scheduled" && details.kind !== "rescheduled") || !details.startLocal) return "skipped";
  // "T00:00" is how a date without a time comes back; nobody interviews at midnight.
  if (/T00:00/.test(details.startLocal)) return "skipped";

  const zone = details.timezone && isValidTimeZone(details.timezone) ? details.timezone : userTimeZone;
  const startsAt = zonedLocalToUtcIso(details.startLocal, zone);
  if (!startsAt) return "skipped";
  const received = new Date(email.received_at).getTime();
  const start = new Date(startsAt).getTime();
  // A time before the email (or a year out) is a misreading.
  if (start < received - 86_400_000 || start > received + 365 * 86_400_000) return "skipped";

  let endsAt = details.endLocal ? zonedLocalToUtcIso(details.endLocal, zone) : null;
  if (!endsAt && details.durationMinutes) endsAt = new Date(start + details.durationMinutes * 60_000).toISOString();
  if (endsAt && new Date(endsAt).getTime() <= start) endsAt = null;

  const round =
    details.round ??
    ROUND_FROM_STAGE[interviewRole(email.extracted?.interviewStage, `${email.subject ?? ""}`)] ??
    "other";
  const fields: InterviewFields = {
    application_id: email.application_id,
    account_id: email.account_id,
    company,
    job_title: email.extracted?.jobTitle ?? null,
    starts_at: startsAt,
    ends_at: endsAt,
    // Shown next to the user's own time when the recruiter wrote another timezone.
    timezone: zone !== userTimeZone ? zone : null,
    round,
    meeting_url: details.meetingUrl,
    location: details.location,
    interviewers: details.interviewers,
  };

  const inThread = await findThreadInterview(email);
  if (inThread) {
    await updateInterview(email.user_id, inThread.id, { ...merge(fields), status: statusFor(startsAt, endsAt) });
    return inThread.starts_at === startsAt ? "updated" : "rescheduled";
  }
  const same = await findInterviewNear(email.user_id, key, startsAt);
  if (same) {
    await updateInterview(email.user_id, same.id, merge(fields));
    return "updated";
  }
  // Already in the calendar (an invite within two days, same round): the invite's time stands;
  // the email adds what the invite lacks.
  if (email.application_id) {
    const invite = await findInterviewNear(email.user_id, key, startsAt, 48, "calendar");
    if (invite && sameRound(invite.round, round)) {
      await updateInterview(email.user_id, invite.id, merge({
        meeting_url: invite.meeting_url ? null : details.meetingUrl,
        interviewers: invite.interviewers ? null : details.interviewers,
        location: invite.location ? null : details.location,
      }));
      return "updated";
    }
  }
  // Applicant systems send each new confirmation as its own email: one that arrives while an
  // interview of the same round is still ahead gives that interview its new time.
  if (email.application_id) {
    const pending = await findPendingAt(email.user_id, email.application_id, email.received_at);
    if (pending && sameRound(pending.round, round)) {
      await updateInterview(email.user_id, pending.id, { ...merge(fields), status: statusFor(startsAt, endsAt) });
      return "rescheduled";
    }
  }
  if (details.kind === "rescheduled" && email.application_id) {
    const previous = await findNextScheduled(email.user_id, email.application_id, new Date(received - 86_400_000).toISOString());
    if (previous) {
      await updateInterview(email.user_id, previous.id, { ...merge(fields), status: statusFor(startsAt, endsAt) });
      return "rescheduled";
    }
  }
  await insertInterview(email.user_id, {
    ...fields,
    starts_at: startsAt,
    source: "email",
    source_ref: email.id,
    status: statusFor(startsAt, endsAt),
  });
  return "created";
}

export type InterviewExtractResult = { read: number; created: number; updated: number; cancelled: number };

/**
 * Reads interview emails not read yet (oldest first, so a reschedule comes after its original):
 * fetches the text from the mailbox, extracts the details, and stores the interview.
 */
export async function extractInterviewsFromEmails(userId: string | null, deadline: number): Promise<InterviewExtractResult> {
  const result: InterviewExtractResult = { read: 0, created: 0, updated: 0, cancelled: 0 };
  const accounts = new Map<string, { account: SyncAccount; token: string } | null>();
  const zones = new Map<string, string>();
  const db = getSupabaseAdminClient();

  while (Date.now() < deadline - 15_000) {
    let query = db
      .from("mail_messages")
      .select("id, user_id, account_id, application_id, provider_id, thread_id, subject, from_name, from_email, received_at, extracted")
      .eq("category", "interview")
      .is("interview_checked_at", null);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.order("received_at", { ascending: true }).limit(8);
    failOn(error);
    const rows = (data ?? []) as InterviewEmail[];
    if (rows.length === 0) break;

    const { data: claimedRows, error: claimError } = await db
      .from("mail_messages")
      .update({ interview_checked_at: new Date().toISOString() } as never)
      .in("id", rows.map((r) => r.id))
      .is("interview_checked_at", null)
      .select("id");
    failOn(claimError);
    const claimed = new Set(((claimedRows ?? []) as { id: string }[]).map((r) => r.id));
    if (claimed.size === 0) break;

    // Read in parallel (text and AI), store in email order.
    const read = await Promise.all(
      rows
        .filter((r) => claimed.has(r.id))
        .map(async (email) => {
          try {
            if (!accounts.has(email.account_id)) {
              const account = await getSyncAccount(email.account_id);
              accounts.set(
                email.account_id,
                account && account.status === "active" ? { account, token: await accessTokenFor(account) } : null,
              );
            }
            const source = accounts.get(email.account_id);
            if (!source) return null;
            if (!zones.has(email.user_id)) {
              zones.set(email.user_id, normalizeTimeZone((await findUserById(email.user_id))?.timezone ?? DEFAULT_TIMEZONE));
            }
            const body =
              source.account.provider === "microsoft"
                ? await getMicrosoftMessageText(source.token, email.provider_id)
                : await getGoogleMessageText(source.token, email.provider_id);
            const details = await extractInterviewDetails({
              subject: email.subject ?? "",
              fromName: email.from_name,
              fromEmail: email.from_email,
              receivedAt: email.received_at,
              userTimeZone: zones.get(email.user_id)!,
              body,
            });
            return details ? { email, details } : null;
          } catch (err) {
            console.error(`Reading interview email ${email.id} failed:`, err instanceof Error ? err.message : err);
            return null;
          }
        }),
    );
    for (const item of read) {
      if (!item) continue;
      result.read++;
      try {
        const outcome = await applyDetails(item.email, item.details, zones.get(item.email.user_id) ?? DEFAULT_TIMEZONE);
        if (outcome === "created") result.created++;
        else if (outcome === "updated" || outcome === "rescheduled") result.updated++;
        else if (outcome === "cancelled") result.cancelled++;
      } catch (err) {
        console.error(`Storing interview from email ${item.email.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return result;
}

// --- From the calendar --------------------------------------------------------------------------

/** The calendar is read at most this often per mailbox. */
const CALENDAR_EVERY_MS = 10 * 60_000;
const INTERVIEW_WORDS_RE = /\b(interview|screen|screening|phone call|intro call|technical|onsite|on-site|round|assessment|recruit|hiring|panel|chat with)\b/i;

type EventMatch = { applicationId: number | null; company: string | null };

/** Which application an event is about, from its people and its title. */
export function matchEvent(
  event: CalendarEvent,
  ownEmail: string,
  candidates: MatchCandidate[],
  senders: Map<string, number>,
): EventMatch | null {
  const people = [event.organizerEmail, ...event.attendeeEmails].filter((p): p is string => Boolean(p) && p !== ownEmail);
  const latest = (apps: MatchCandidate[]) =>
    [...apps].sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())[0];

  // Someone who already wrote about an application.
  for (const person of people) {
    const appId = senders.get(person);
    if (appId) return { applicationId: appId, company: null };
  }
  // Someone from a company applied to.
  for (const person of people) {
    const org = senderOrganisation(person);
    if (!org) continue;
    const apps = candidates.filter((c) => organisationMatchesCompany(org, c.company));
    if (apps.length) return { applicationId: latest(apps).id, company: null };
  }
  // An interview-like title naming a company applied to.
  if (INTERVIEW_WORDS_RE.test(event.subject)) {
    const title = ` ${normalizeCompanyName(event.subject)} `;
    const apps = candidates.filter((c) => {
      const name = normalizeCompanyName(c.company);
      return name.length >= 4 && title.includes(` ${name} `);
    });
    if (apps.length) return { applicationId: latest(apps).id, company: null };
  }
  return null;
}

/** Senders of job emails → their application (latest email wins). */
async function jobSenders(userId: string): Promise<Map<string, number>> {
  const { data } = await getSupabaseAdminClient()
    .from("mail_messages")
    .select("from_email, application_id")
    .eq("user_id", userId)
    .in("category", ["interview", "assessment", "update", "other", "offer"])
    .not("application_id", "is", null)
    .order("received_at", { ascending: true })
    .limit(2000);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { from_email: string; application_id: number }[]) out.set(r.from_email, r.application_id);
  return out;
}

export type CalendarSyncResult = { events: number; created: number; updated: number };

/** Reads the mailbox's calendar (2 weeks back, 2 months ahead) and keeps its interviews. */
export async function syncCalendar(account: SyncAccount, force = false): Promise<CalendarSyncResult | null> {
  if (account.status !== "active" || !(account.scopes ?? []).includes(CALENDAR_WRITE_SCOPE)) return null;
  const last = account.calendar_cursor ? new Date(account.calendar_cursor).getTime() : 0;
  if (!force && Number.isFinite(last) && Date.now() - last < CALENDAR_EVERY_MS) return null;

  const token = await accessTokenFor(account);
  const from = new Date(Date.now() - 14 * 86_400_000);
  const to = new Date(Date.now() + 60 * 86_400_000);
  const events =
    account.provider === "microsoft" ? await listMicrosoftEvents(token, from, to) : await listGoogleEvents(token, from, to);
  // Both readers stop after 5 pages; a full last page may mean more events exist.
  const complete = events.length < 500;

  const all = await listMatchCandidates(account.user_id);
  const candidates = account.profile_id === null ? all : all.filter((c) => c.profileId === account.profile_id);
  const senders = await jobSenders(account.user_id);
  const result: CalendarSyncResult = { events: events.length, created: 0, updated: 0 };

  for (const event of events) {
    if (event.isAllDay) continue;
    const known = await findByCalendarEvent(account.user_id, event.id);
    if (known) {
      if (event.isCancelled && known.status !== "cancelled") {
        await updateInterview(account.user_id, known.id, { status: "cancelled" });
        result.updated++;
      } else if (!event.isCancelled && (known.starts_at !== event.startsAt || known.ends_at !== event.endsAt)) {
        // Moved in the calendar.
        await updateInterview(account.user_id, known.id, merge({ starts_at: event.startsAt, ends_at: event.endsAt, meeting_url: event.meetingUrl }));
        result.updated++;
      }
      continue;
    }
    if (event.isCancelled) continue;

    const match = matchEvent(event, account.email, candidates, senders);
    if (!match) continue;
    // The same interview from an email: within hours, or within two days when the email's time
    // was off; the calendar invite's time wins.
    const role = interviewRole(null, `${event.subject} ${event.preview}`);
    let near = await findInterviewNear(account.user_id, match, event.startsAt);
    if (!near) {
      const candidate = await findInterviewNear(account.user_id, match, event.startsAt, 48, "unlinkedEmail");
      if (candidate && sameRound(candidate.round, ROUND_FROM_STAGE[role] ?? "other")) near = candidate;
    }
    if (near) {
      if (!near.calendar_event_id) {
        // The same interview as an email: link the event and fill in what the email lacked.
        await updateInterview(account.user_id, near.id, {
          calendar_event_id: event.id,
          starts_at: event.startsAt,
          ...merge({ ends_at: near.ends_at ?? event.endsAt, meeting_url: near.meeting_url ?? event.meetingUrl, location: near.location ?? event.location }),
        });
        result.updated++;
      }
      continue;
    }
    await insertInterview(account.user_id, {
      application_id: match.applicationId,
      account_id: account.id,
      company: match.company,
      title: event.subject.slice(0, 300) || null,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      round: ROUND_FROM_STAGE[role] ?? "other",
      meeting_url: event.meetingUrl,
      location: event.location,
      source: "calendar",
      source_ref: event.id,
      calendar_event_id: event.id,
      status: statusFor(event.startsAt, event.endsAt),
    });
    result.created++;
  }
  // Events that are gone from the calendar (a cancelled invitation is usually just removed).
  // Only when the whole window was read: a cut-off list would look like deletions.
  if (complete) {
    const seen = new Set(events.map((e) => e.id));
    const { data: linked } = await getSupabaseAdminClient()
      .from("interviews")
      .select("id, source, calendar_event_id")
      .eq("user_id", account.user_id)
      .eq("account_id", account.id)
      .eq("status", "scheduled")
      .not("calendar_event_id", "is", null)
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString());
    for (const row of (linked ?? []) as { id: string; source: string; calendar_event_id: string }[]) {
      if (seen.has(row.calendar_event_id)) continue;
      // From the calendar: it was cancelled. Added by JobStrike or from an email: only the
      // calendar copy was removed, so the interview stays and can be added again.
      await updateInterview(account.user_id, row.id, row.source === "calendar" ? { status: "cancelled" } : { calendar_event_id: null });
      result.updated++;
    }
  }

  await saveCalendarReadAt(account.id, new Date().toISOString());
  return result;
}

/** For the Calendar page's refresh: reads the calendars of the user's mailboxes now. */
export async function syncUserCalendars(userId: string): Promise<void> {
  const { data } = await getSupabaseAdminClient().from("mail_accounts").select("id").eq("user_id", userId).eq("status", "active");
  for (const { id } of (data ?? []) as { id: string }[]) {
    const account = await getSyncAccount(id);
    if (account) await syncCalendar(account, true).catch((err) => console.error(`Calendar read for ${id} failed:`, err instanceof Error ? err.message : err));
  }
}
