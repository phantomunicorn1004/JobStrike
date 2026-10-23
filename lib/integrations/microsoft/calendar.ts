import "server-only";

import { findMeetingUrl, type CalendarEvent, type NewCalendarEvent } from "@/lib/interviews/calendar-types";
import { graph } from "@/lib/integrations/microsoft/mail";

/** Fixed id of JobStrike's own event property (Graph single-value extended property). */
const INTERVIEW_PROPERTY = "String {6b1c7c1e-3b0a-4c52-9a51-5f0b1f7a7d21} Name JobStrikeInterviewId";

type GraphDateTime = { dateTime: string; timeZone: string };
type GraphEvent = {
  id: string;
  subject?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  organizer?: { emailAddress?: { address?: string } };
  attendees?: { emailAddress?: { address?: string } }[];
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  bodyPreview?: string;
};

/** Graph gives "2026-10-28T14:00:00.0000000" in the timezone asked for (UTC here). */
function utc(value: GraphDateTime | undefined): string | null {
  if (!value?.dateTime) return null;
  const iso = value.dateTime.replace(/\.\d+$/, "");
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).toISOString();
}

/** Events between two times (recurring ones expanded), times in UTC. */
export async function listMicrosoftEvents(accessToken: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const select = "id,subject,start,end,isAllDay,isCancelled,organizer,attendees,location,onlineMeeting,webLink,bodyPreview";
  let url: string | null =
    `/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$select=${select}&$top=100`;
  const out: CalendarEvent[] = [];
  for (let page = 0; url && page < 5; page++) {
    const body: { value: GraphEvent[]; "@odata.nextLink"?: string } | null = await graph(accessToken, url, {
      headers: { Prefer: 'odata.maxpagesize=100, outlook.timezone="UTC"' },
    });
    for (const e of body?.value ?? []) {
      const startsAt = utc(e.start);
      if (!startsAt) continue;
      const location = e.location?.displayName?.trim() || null;
      out.push({
        id: e.id,
        subject: e.subject ?? "",
        startsAt,
        endsAt: utc(e.end),
        isAllDay: Boolean(e.isAllDay),
        isCancelled: Boolean(e.isCancelled),
        organizerEmail: e.organizer?.emailAddress?.address?.toLowerCase() ?? null,
        attendeeEmails: (e.attendees ?? []).map((a) => a.emailAddress?.address?.toLowerCase() ?? "").filter(Boolean),
        location,
        meetingUrl: e.onlineMeeting?.joinUrl || findMeetingUrl(location, e.bodyPreview),
        webLink: e.webLink ?? null,
        preview: (e.bodyPreview ?? "").slice(0, 500),
      });
    }
    url = body?.["@odata.nextLink"] ?? null;
  }
  return out;
}

/** Adds an interview to the user's Outlook calendar, with reminders. Returns the event id. */
export async function createMicrosoftEvent(accessToken: string, event: NewCalendarEvent): Promise<string> {
  const created = await graph<{ id: string }>(accessToken, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: event.subject,
      start: { dateTime: event.startsAt.replace(/Z$/, ""), timeZone: "UTC" },
      end: { dateTime: event.endsAt.replace(/Z$/, ""), timeZone: "UTC" },
      body: { contentType: "text", content: event.body },
      ...(event.location ? { location: { displayName: event.location } } : {}),
      isReminderOn: true,
      reminderMinutesBeforeStart: 60,
      showAs: "busy",
      categories: ["JobStrike"],
      singleValueExtendedProperties: [{ id: INTERVIEW_PROPERTY, value: event.interviewId }],
    }),
  });
  if (!created?.id) throw new Error("Outlook did not create the event.");
  return created.id;
}

/** The plain text of one message (read on demand; never stored). */
export async function getMicrosoftMessageText(accessToken: string, messageId: string): Promise<string> {
  const message = await graph<{ body?: { content?: string } }>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}?$select=body`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  return message?.body?.content ?? "";
}
