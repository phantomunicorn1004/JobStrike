import "server-only";

import { google, type gmail_v1 } from "googleapis";
import { findMeetingUrl, type CalendarEvent, type NewCalendarEvent } from "@/lib/interviews/calendar-types";

function auth(accessToken: string) {
  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: accessToken });
  return client;
}

/** Events between two times in the primary calendar (recurring ones expanded). */
export async function listGoogleEvents(accessToken: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const calendar = google.calendar({ version: "v3", auth: auth(accessToken) });
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const { data } = await calendar.events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    for (const e of data.items ?? []) {
      const allDay = !e.start?.dateTime;
      const start = e.start?.dateTime ?? e.start?.date;
      if (!e.id || !start) continue;
      const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
      out.push({
        id: e.id,
        subject: e.summary ?? "",
        startsAt: new Date(start).toISOString(),
        endsAt: e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : null,
        isAllDay: allDay,
        isCancelled: e.status === "cancelled",
        organizerEmail: e.organizer?.email?.toLowerCase() ?? null,
        attendeeEmails: (e.attendees ?? []).map((a) => a.email?.toLowerCase() ?? "").filter(Boolean),
        location: e.location ?? null,
        meetingUrl: e.hangoutLink || video || findMeetingUrl(e.location, e.description),
        webLink: e.htmlLink ?? null,
        preview: (e.description ?? "").replace(/<[^>]+>/g, " ").slice(0, 500),
      });
    }
    pageToken = data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
  return out;
}

export async function createGoogleEvent(accessToken: string, event: NewCalendarEvent): Promise<string> {
  const calendar = google.calendar({ version: "v3", auth: auth(accessToken) });
  const { data } = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.subject,
      description: event.body,
      location: event.location ?? undefined,
      start: { dateTime: event.startsAt },
      end: { dateTime: event.endsAt },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      extendedProperties: { private: { jobstrikeInterviewId: event.interviewId } },
    },
  });
  if (!data.id) throw new Error("Google Calendar did not create the event.");
  return data.id;
}

/** The plain text of one message (read on demand; never stored). */
export async function getGoogleMessageText(accessToken: string, messageId: string): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth: auth(accessToken) });
  const { data } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const decode = (b64?: string | null) => (b64 ? Buffer.from(b64, "base64url").toString("utf8") : "");
  let plain = "";
  let html = "";
  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;
    if (part.mimeType === "text/plain" && !plain) plain = decode(part.body?.data);
    else if (part.mimeType === "text/html" && !html) html = decode(part.body?.data);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(data.payload);
  return plain || html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
}
