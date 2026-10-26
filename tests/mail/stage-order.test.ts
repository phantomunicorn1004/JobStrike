import { describe, expect, it } from "vitest";
import { planStageOrder, type StageCall, type StageEmail } from "@/lib/mail/stage-order";

let n = 0;
const email = (receivedAt: string, stage: string | null, o: Partial<StageEmail> = {}): StageEmail => ({
  id: `e${++n}`,
  applicationId: 1,
  category: "interview",
  receivedAt,
  stage,
  userSet: false,
  ...o,
});
const call = (startsAt: string, round: string | null, o: Partial<StageCall> = {}): StageCall => ({
  id: `c${++n}`,
  applicationId: 1,
  startsAt,
  round,
  cancelled: false,
  userSet: false,
  ...o,
});

describe("interview stages in order (the user's model)", () => {
  it("makes the first call Screening, with every email about it", () => {
    const invite = email("2026-10-01T10:00:00Z", "technical"); // AI guessed wrong
    const reminder = email("2026-10-03T08:00:00Z", "hr");
    const first = call("2026-10-03T15:00:00Z", "technical");
    const plan = planStageOrder([invite, reminder], [first]);
    expect(plan.emails.get(invite.id)).toBe("screening");
    expect(plan.emails.get(reminder.id)).toBe("screening");
    expect(plan.calls.get(first.id)).toBe("screening");
  });

  it("never makes a later call Screening", () => {
    const first = call("2026-10-03T15:00:00Z", "screening");
    const second = call("2026-10-10T15:00:00Z", "screening");
    const secondInvite = email("2026-10-06T10:00:00Z", "screening");
    const plan = planStageOrder([secondInvite], [first, second]);
    expect(plan.calls.has(first.id)).toBe(false);
    expect(plan.calls.get(second.id)).toBe("hr");
    expect(plan.emails.get(secondInvite.id)).toBe("hr");
  });

  it("keeps the AI's later stage when it is not Screening", () => {
    const first = call("2026-10-03T15:00:00Z", "screening");
    const tech = call("2026-10-12T15:00:00Z", "technical");
    expect(planStageOrder([], [first, tech]).calls.has(tech.id)).toBe(false);
  });

  it("follows the last stage for an unknown later round", () => {
    const first = call("2026-10-03T15:00:00Z", "screening");
    const hr = call("2026-10-08T15:00:00Z", "hr");
    const unknown = call("2026-10-15T15:00:00Z", "other");
    expect(planStageOrder([], [first, hr, unknown]).calls.get(unknown.id)).toBe("technical");
  });

  it("treats an AI screening as the screening step: the next call is a next step", () => {
    const hirevue = email("2026-10-01T10:00:00Z", "ai_screening", { category: "assessment" });
    const invite = email("2026-10-05T10:00:00Z", "screening");
    const firstCall = call("2026-10-07T15:00:00Z", "screening");
    const plan = planStageOrder([hirevue, invite], [firstCall]);
    expect(plan.emails.get(invite.id)).toBe("hr");
    expect(plan.calls.get(firstCall.id)).toBe("hr");
    expect(plan.emails.has(hirevue.id)).toBe(false);
  });

  it("uses the first week of emails when no call has a date yet", () => {
    const ask = email("2026-10-01T10:00:00Z", "hr");
    const confirm = email("2026-10-04T10:00:00Z", "technical");
    const later = email("2026-10-20T10:00:00Z", "screening");
    const plan = planStageOrder([ask, confirm, later], []);
    expect(plan.emails.get(ask.id)).toBe("screening");
    expect(plan.emails.get(confirm.id)).toBe("screening");
    expect(plan.emails.get(later.id)).toBe("hr");
  });

  it("never changes what the user set", () => {
    const mine = email("2026-10-01T10:00:00Z", "technical", { userSet: true });
    const myCall = call("2026-10-03T15:00:00Z", "technical", { userSet: true });
    const plan = planStageOrder([mine], [myCall]);
    expect(plan.emails.size).toBe(0);
    expect(plan.calls.size).toBe(0);
  });

  it("skips cancelled calls when finding the first one", () => {
    const cancelled = call("2026-10-02T15:00:00Z", "screening", { cancelled: true });
    const real = call("2026-10-04T15:00:00Z", "hr");
    expect(planStageOrder([], [cancelled, real]).calls.get(real.id)).toBe("screening");
  });

  it("keeps applications apart", () => {
    const a = call("2026-10-03T15:00:00Z", "hr", { applicationId: 1 });
    const b = call("2026-10-04T15:00:00Z", "technical", { applicationId: 2 });
    const plan = planStageOrder([], [a, b]);
    expect(plan.calls.get(a.id)).toBe("screening");
    expect(plan.calls.get(b.id)).toBe("screening");
  });
});
