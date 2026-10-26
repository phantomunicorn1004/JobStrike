import { describe, expect, it } from "vitest";
import { findMeetingUrl } from "@/lib/interviews/calendar-types";
import { parseInterviewBody } from "@/lib/interviews/validate";
import { zonedLocalToUtcIso } from "@/lib/timezone";

describe("interview times", () => {
  it.each([
    ["2 PM ET before the US clock change", "2026-10-28T14:00", "America/New_York", "2026-10-28T18:00:00.000Z"],
    ["2 PM ET after the US clock change", "2026-11-03T14:00", "America/New_York", "2026-11-03T19:00:00.000Z"],
    ["9:30 AM PT", "2026-10-29T09:30", "America/Los_Angeles", "2026-10-29T16:30:00.000Z"],
    ["8 PM in Ho Chi Minh City", "2026-10-28T20:00", "Asia/Ho_Chi_Minh", "2026-10-28T13:00:00.000Z"],
  ])("%s", (_name, local, zone, utc) => {
    expect(zonedLocalToUtcIso(local, zone)).toBe(utc);
  });

  it("refuses text that is not a time", () => {
    expect(zonedLocalToUtcIso("next Tuesday", "America/New_York")).toBeNull();
    expect(zonedLocalToUtcIso("2026-10-28T25:00", "UTC")).toBeNull();
  });
});

describe("meeting links", () => {
  it("finds Zoom and Teams links and trims punctuation", () => {
    expect(findMeetingUrl("https://us02web.zoom.us/j/123456?pwd=abc.")).toBe("https://us02web.zoom.us/j/123456?pwd=abc");
    expect(findMeetingUrl(null, "Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d. See you")).toBe(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d",
    );
  });

  it("finds nothing in a phone call", () => {
    expect(findMeetingUrl("Phone call")).toBeNull();
  });
});

describe("interview form", () => {
  it("rejects an end before the start", () => {
    expect("error" in parseInterviewBody({ startsAt: "2026-10-28T18:00:00Z", endsAt: "2026-10-28T17:00:00Z" }, true)).toBe(true);
  });

  it("rejects a meeting link that is not http(s)", () => {
    expect("error" in parseInterviewBody({ startsAt: "2026-10-28T18:00:00Z", meetingUrl: "javascript:alert(1)" }, true)).toBe(true);
  });

  it("keeps only the given fields, trimmed", () => {
    expect(parseInterviewBody({ startsAt: "2026-10-28T18:00:00Z", round: "technical", notes: "  bring ID  " }, true)).toEqual({
      fields: { starts_at: "2026-10-28T18:00:00.000Z", round: "technical", notes: "bring ID" },
    });
  });
});
