import "server-only";

import { createGoogleEvent } from "@/lib/integrations/google/calendar";
import { createMicrosoftEvent } from "@/lib/integrations/microsoft/calendar";
import { CALENDAR_WRITE_SCOPE } from "@/lib/integrations/providers";
import { getInterviewRow, updateInterview, asRound } from "@/lib/interviews/repository";
import { INTERVIEW_ROUND_LABELS, type InterviewResult } from "@/lib/interviews/types";
import { resolveStageRoles } from "@/lib/mail/board-rules";
import { accessTokenFor } from "@/lib/mail/sync";
import { getSyncAccount, listActiveSyncAccounts, type SyncAccount } from "@/lib/mail/sync-repository";
import { recordPipelineEvent } from "@/lib/pipeline-events/repository";
import { listPipelineStages, setApplicationPipelineStage } from "@/lib/resume-db/pipeline-stages";
import { getApplicationById } from "@/lib/resume-db/repository";

/** Without an end time, an interview is entered as this long. */
const DEFAULT_MINUTES = 45;

export type CalendarOutcome = { ok: boolean; message: string };

/** Mailboxes whose calendar JobStrike may write to. */
export async function writableCalendars(userId: string): Promise<SyncAccount[]> {
  return (await listActiveSyncAccounts(userId)).filter((a) => (a.scopes ?? []).includes(CALENDAR_WRITE_SCOPE));
}

/** Adds an interview to the calendar of the candidate's mailbox (once). */
export async function addInterviewToCalendar(userId: string, interviewId: string): Promise<CalendarOutcome> {
  const interview = await getInterviewRow(userId, interviewId);
  if (!interview) return { ok: false, message: "Interview not found." };
  if (interview.calendar_event_id) return { ok: true, message: "Already in your calendar." };

  const app = interview.application_id ? await getApplicationById(interview.application_id, userId) : null;
  const calendars = await writableCalendars(userId);
  // The candidate's own mailbox first, then the one the interview came from.
  const target =
    calendars.find((a) => app?.profileId !== undefined && app?.profileId !== null && a.profile_id === app.profileId) ??
    calendars.find((a) => a.id === interview.account_id) ??
    calendars[0];
  if (!target) return { ok: false, message: "No connected mailbox allows adding calendar events. Reconnect it in Settings." };

  const account = (await getSyncAccount(target.id)) ?? target;
  const company = app?.company || interview.company || "Interview";
  const role = app?.jobTitle || interview.job_title || "";
  const round = INTERVIEW_ROUND_LABELS[asRound(interview.round)];
  const endsAt = interview.ends_at ?? new Date(new Date(interview.starts_at).getTime() + DEFAULT_MINUTES * 60_000).toISOString();
  const lines = [
    `${round} interview — ${company}${role ? `, ${role}` : ""}`,
    app?.candidateName ? `Candidate: ${app.candidateName}` : "",
    interview.meeting_url ? `Join: ${interview.meeting_url}` : "",
    interview.interviewers ? `With: ${interview.interviewers}` : "",
    interview.location ? `Where: ${interview.location}` : "",
    interview.notes ? `\n${interview.notes}` : "",
    "\nAdded by JobStrike.",
  ].filter(Boolean);

  const token = await accessTokenFor(account);
  const event = {
    subject: `Interview: ${company}${role ? ` — ${role}` : ""} (${round})`,
    startsAt: new Date(interview.starts_at).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    location: interview.meeting_url ?? interview.location,
    body: lines.join("\n"),
    interviewId: interview.id,
  };
  const eventId = account.provider === "microsoft" ? await createMicrosoftEvent(token, event) : await createGoogleEvent(token, event);
  await updateInterview(userId, interview.id, { calendar_event_id: eventId, account_id: account.id });
  return { ok: true, message: `Added to ${account.email}'s calendar.` };
}

/** "How did it go?": done, with a result; "rejected" also moves the card to Reject. */
export async function recordInterviewOutcome(userId: string, interviewId: string, result: InterviewResult): Promise<CalendarOutcome> {
  const interview = await getInterviewRow(userId, interviewId);
  if (!interview) return { ok: false, message: "Interview not found." };
  await updateInterview(userId, interviewId, { status: "done", result });

  if (result === "rejected" && interview.application_id) {
    const roles = resolveStageRoles(await listPipelineStages());
    const app = await getApplicationById(interview.application_id, userId);
    const current = app ? app.pipelineStageId ?? (app.pipelineJobId ? "applied" : null) : undefined;
    if (roles.reject && app && current !== roles.reject) {
      await setApplicationPipelineStage(app.id, userId, roles.reject);
      await recordPipelineEvent(userId, {
        applicationId: app.id,
        fromStage: current ?? null,
        toStage: roles.reject,
        source: "manual",
        reason: "Interview outcome: not moving forward",
      });
      return { ok: true, message: "Saved; the card moved to Reject." };
    }
  }
  return { ok: true, message: "Saved." };
}
