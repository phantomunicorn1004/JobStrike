/** A calendar event as both providers give it, times in UTC. */
export type CalendarEvent = {
  id: string;
  subject: string;
  startsAt: string;
  endsAt: string | null;
  isAllDay: boolean;
  isCancelled: boolean;
  organizerEmail: string | null;
  attendeeEmails: string[];
  location: string | null;
  meetingUrl: string | null;
  webLink: string | null;
  /** A short preview of the description, for finding the company and the meeting link. */
  preview: string;
};

/** An interview added to the user's calendar by JobStrike. */
export type NewCalendarEvent = {
  subject: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  body: string;
  /** Stored on the event, so the same interview is never added twice. */
  interviewId: string;
};

/** Video-call links in event locations and descriptions. */
const MEETING_URL_RE =
  /https?:\/\/(?:[\w-]+\.)*(?:zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com|chime\.aws|bluejeans\.com|whereby\.com|gotomeeting\.com|meet\.goto\.com|hirevue\.com|karat\.(?:io|com)|coderpad\.io|codesignal\.com|hackerrank\.com)\/[^\s<>"')\]]*/i;

export function findMeetingUrl(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    const match = text ? MEETING_URL_RE.exec(text) : null;
    if (match) return match[0].replace(/[.,;]+$/, "");
  }
  return null;
}
