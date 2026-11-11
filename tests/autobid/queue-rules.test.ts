import { describe, expect, it } from "vitest";
import { companyKey, isStale, jobTimeMs, queueRoom } from "@/lib/autobid/queue-rules";

const NOW = Date.parse("2026-11-04T12:00:00Z");

describe("freshness", () => {
  it("uses the posting time, else when the job was found", () => {
    expect(jobTimeMs("2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z")).toBe(Date.parse("2026-11-04T10:00:00Z"));
    expect(jobTimeMs(null, "2026-11-04T11:00:00Z")).toBe(Date.parse("2026-11-04T11:00:00Z"));
  });

  it("is stale after 48 hours, or with no time at all", () => {
    expect(isStale("2026-11-03T13:00:00Z", null, NOW)).toBe(false);
    expect(isStale("2026-11-02T13:00:00Z", null, NOW)).toBe(false);
    expect(isStale("2026-11-02T11:00:00Z", null, NOW)).toBe(true);
    expect(isStale(null, null, NOW)).toBe(true);
  });
});

describe("queueRoom", () => {
  it("is the day's limit less what was sent and what is on its way", () => {
    expect(queueRoom({ dailyLimit: 25, sentToday: 5, inPipeline: 8 })).toBe(12);
    expect(queueRoom({ dailyLimit: 25, sentToday: 20, inPipeline: 9 })).toBe(0);
  });
});

describe("companyKey", () => {
  it("treats legal suffixes and punctuation as the same company", () => {
    expect(companyKey("Acme, Inc.")).toBe(companyKey("ACME"));
    expect(companyKey("Linda Werner & Associates, Inc")).toBe("linda werner associates");
    expect(companyKey("Nextdoor")).not.toBe(companyKey("Northbeam"));
  });
});
