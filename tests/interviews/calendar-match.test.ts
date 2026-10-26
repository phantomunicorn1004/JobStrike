import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/interviews/calendar-types";
import { matchEvent } from "@/lib/interviews/process";
import type { MatchCandidate } from "@/lib/mail/match";

const apps: MatchCandidate[] = [
  { id: 1, profileId: 5, company: "Capital One", jobTitle: "Data Engineer", appliedAt: "2026-10-01T00:00:00Z" },
  { id: 2, profileId: 5, company: "Ten Mile Square Technologies", jobTitle: "Engineer", appliedAt: "2026-10-02T00:00:00Z" },
  { id: 3, profileId: 5, company: "Aflac", jobTitle: "Analyst", appliedAt: "2026-10-03T00:00:00Z" },
];
const senders = new Map([["recruiter@gem.com", 3]]);
const me = "cand@outlook.com";

const event = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e",
  subject: "",
  startsAt: "2026-10-28T18:00:00.000Z",
  endsAt: null,
  isAllDay: false,
  isCancelled: false,
  organizerEmail: null,
  attendeeEmails: [],
  location: null,
  meetingUrl: null,
  webLink: null,
  preview: "",
  ...o,
});

describe("which calendar events are interviews", () => {
  it("someone who already wrote about an application", () => {
    expect(matchEvent(event({ organizerEmail: "recruiter@gem.com", attendeeEmails: [me] }), me, apps, senders)?.applicationId).toBe(3);
  });

  it("an attendee from a company applied to", () => {
    expect(matchEvent(event({ organizerEmail: me, attendeeEmails: ["jane@tenmilesquare.com"] }), me, apps, senders)?.applicationId).toBe(2);
  });

  it("an interview-like title naming a company", () => {
    expect(matchEvent(event({ subject: "Capital One - Phone Screen", organizerEmail: "noreply@calendly.com" }), me, apps, senders)?.applicationId).toBe(1);
  });

  it.each([
    ["a company name without interview words", event({ subject: "Capital One card payment due" })],
    ["a personal event", event({ subject: "Dentist", organizerEmail: me })],
    ["a free-mail attendee", event({ subject: "Coffee", attendeeEmails: ["friend@gmail.com"] })],
  ])("not %s", (_name, e) => {
    expect(matchEvent(e, me, apps, senders)).toBeNull();
  });
});
