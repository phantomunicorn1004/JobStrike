import "server-only";

import { serverOpenAI } from "@/lib/ai/server-openai";
import { formatIsoInTimeZone } from "@/lib/timezone";

/**
 * Reads an interview email's text (in memory only) and returns when, where and which round.
 * Times come back as written ("2026-10-28T14:00" + "America/New_York"); the caller converts.
 */

export type InterviewDetails = {
  kind: "scheduled" | "rescheduled" | "cancelled" | "availability_request" | "other";
  startLocal: string | null;
  endLocal: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  meetingUrl: string | null;
  location: string | null;
  interviewers: string | null;
  round: "screen" | "technical" | "final" | "other" | null;
};

const MODEL = process.env.MAIL_AI_MODEL?.trim() || "gpt-4o-mini";

const SYSTEM_PROMPT = `You read one email about a job interview and extract the interview's details.

kind:
- "scheduled": the email sets or confirms one specific interview date and time (also invitations and reminders for a fixed time).
- "rescheduled": an interview that was already set moves to a new date and time.
- "cancelled": an interview is cancelled (and not given a new time).
- "availability_request": the candidate is asked for availability, to pick a slot, or offered several options; no single time is fixed yet.
- "other": anything else.

start_local / end_local: "YYYY-MM-DDTHH:mm" as written in the email, in the email's own timezone. Resolve relative dates ("tomorrow", "Tuesday") from the date the email was received. null when not fixed.
duration_minutes: when only a length is given ("30-minute call"). null otherwise.
timezone: IANA name of the timezone the time is written in (ET/EST/EDT → America/New_York, CT → America/Chicago, MT → America/Denver, PT → America/Los_Angeles, GMT/BST → Europe/London, IST → Asia/Kolkata, UTC → UTC). null when the email names none.
meeting_url: the video-call or assessment link (Zoom, Teams, Google Meet, Webex, HireVue…), exactly as written. null if none.
location: the address or "Phone" when it is a phone call; null if none.
interviewers: names (and titles) of the people the candidate meets, comma-separated; null if none.
round: "screen" (recruiter, HR, hiring-manager intro), "technical" (technical, coding, system design, skills), "final" (final round, onsite, panel, executive), "other"; null when unclear.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "interview_details",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "start_local", "end_local", "duration_minutes", "timezone", "meeting_url", "location", "interviewers", "round"],
      properties: {
        kind: { type: "string", enum: ["scheduled", "rescheduled", "cancelled", "availability_request", "other"] },
        start_local: { type: ["string", "null"] },
        end_local: { type: ["string", "null"] },
        duration_minutes: { type: ["number", "null"] },
        timezone: { type: ["string", "null"] },
        meeting_url: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        interviewers: { type: ["string", "null"] },
        round: { type: ["string", "null"], enum: ["screen", "technical", "final", "other", null] },
      },
    },
  },
};

/** Email text sent to the AI is capped; interview details are near the top. */
const MAX_BODY = 6000;

export async function extractInterviewDetails(input: {
  subject: string;
  fromName: string | null;
  fromEmail: string;
  receivedAt: string;
  /** The user's timezone, to describe when the email arrived. */
  userTimeZone: string;
  body: string;
}): Promise<InterviewDetails | null> {
  const openai = serverOpenAI();
  if (!openai) return null;

  const received = formatIsoInTimeZone(input.receivedAt, input.userTimeZone, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const text = input.body.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY);

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Received: ${received}`,
          `From: ${input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail}`,
          `Subject: ${input.subject}`,
          "",
          text,
        ].join("\n"),
      },
    ],
  });

  const r = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
    kind: InterviewDetails["kind"];
    start_local: string | null;
    end_local: string | null;
    duration_minutes: number | null;
    timezone: string | null;
    meeting_url: string | null;
    location: string | null;
    interviewers: string | null;
    round: InterviewDetails["round"];
  };
  return {
    kind: r.kind,
    startLocal: r.start_local,
    endLocal: r.end_local,
    durationMinutes: r.duration_minutes && r.duration_minutes > 0 && r.duration_minutes <= 600 ? r.duration_minutes : null,
    timezone: r.timezone,
    meetingUrl: r.meeting_url?.startsWith("http") ? r.meeting_url.slice(0, 1000) : null,
    location: r.location?.slice(0, 300) ?? null,
    interviewers: r.interviewers?.slice(0, 300) ?? null,
    round: r.round,
  };
}
