import { describe, expect, it } from "vitest";
import { stageOf, toAutobidJob, type AutobidRowInput } from "@/lib/autobid/stages";

function row(overrides: Partial<AutobidRowInput> = {}): AutobidRowInput {
  return {
    id: 7,
    profile_id: 1,
    candidate_name: "Donald",
    company: "Acme",
    job_title: "Engineer",
    job_link: "https://job-boards.greenhouse.io/acme/jobs/1",
    apply: "Queued",
    created_at: "2026-10-30T10:00:00.000Z",
    generation_status: "queue",
    generation_error: "",
    generation_meta: null,
    autogen_claimed_at: null,
    bid_state: "none",
    bid_error: "",
    bid_meta: null,
    bid_claimed_at: null,
    ...overrides,
  };
}

const stepStates = (input: AutobidRowInput) => toAutobidJob(input).steps.map((step) => `${step.key}:${step.state}`);

describe("stageOf", () => {
  it("follows a job from the queue to Register", () => {
    expect(stageOf(row())).toBe("queued");
    expect(stageOf(row({ generation_status: "generating" }))).toBe("generating");
    expect(stageOf(row({ generation_status: "failed" }))).toBe("gen_failed");
    expect(stageOf(row({ generation_status: "completed" }))).toBe("ready");
    expect(stageOf(row({ generation_status: "completed", bid_state: "bidding" }))).toBe("applying");
    expect(stageOf(row({ generation_status: "completed", bid_state: "needs_you" }))).toBe("needs_you");
    expect(stageOf(row({ generation_status: "completed", bid_state: "submitted" }))).toBe("sent");
    expect(stageOf(row({ generation_status: "completed", bid_state: "submitted", apply: "Registered" }))).toBe(
      "registered",
    );
  });

  it("counts a job registered by hand after a stop as registered", () => {
    expect(stageOf(row({ generation_status: "completed", bid_state: "needs_you", apply: "Registered" }))).toBe(
      "registered",
    );
  });
});

describe("toAutobidJob", () => {
  it("shows the runner's current step and history while applying", () => {
    const job = toAutobidJob(
      row({
        generation_status: "completed",
        generation_meta: { completedAt: "2026-10-30T10:05:00.000Z" },
        bid_state: "bidding",
        bid_claimed_at: "2026-10-30T10:10:00.000Z",
        bid_meta: {
          startedAt: "2026-10-30T10:10:00.000Z",
          step: "Filling the form (AI)…",
          steps: [
            { at: "2026-10-30T10:10:00.000Z", text: "Taken by the runner" },
            { at: "2026-10-30T10:11:00.000Z", text: "Filling the form (AI)…" },
          ],
        },
      }),
    );
    expect(job.stage).toBe("applying");
    expect(job.currentStep).toBe("Filling the form (AI)…");
    expect(job.log).toHaveLength(2);
    expect(job.updatedAt).toBe("2026-10-30T10:11:00.000Z");
    expect(job.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "queued:done",
      "resume:done",
      "apply:current",
      "sent:pending",
      "registered:pending",
    ]);
    expect(job.steps[1].at).toBe("2026-10-30T10:05:00.000Z");
  });

  it("marks a sent job whose Register did not save", () => {
    const job = toAutobidJob(
      row({
        generation_status: "completed",
        bid_state: "submitted",
        bid_meta: { method: "auto", confirmedAt: "2026-10-30T10:12:00.000Z", finishedAt: "2026-10-30T10:12:01.000Z" },
      }),
    );
    expect(job.stage).toBe("sent");
    expect(job.sentByRunner).toBe(true);
    expect(job.reason).toMatch(/Register/);
    expect(stepStates(row({ generation_status: "completed", bid_state: "submitted" }))).toEqual([
      "queued:done",
      "resume:done",
      "apply:done",
      "sent:done",
      "registered:failed",
    ]);
  });

  it("gives the reason a job stopped, and flags a clicked Submit and a dry run", () => {
    const job = toAutobidJob(
      row({
        generation_status: "completed",
        bid_state: "needs_you",
        bid_error: "A CAPTCHA appeared after Submit.",
        bid_meta: { method: "dry_run", submitClicked: true, finishedAt: "2026-10-30T10:12:00.000Z" },
      }),
    );
    expect(job.stage).toBe("needs_you");
    expect(job.reason).toBe("A CAPTCHA appeared after Submit.");
    expect(job.submitClicked).toBe(true);
    expect(job.dryRun).toBe(true);
    expect(job.currentStep).toBe("");
    expect(job.steps[2]).toMatchObject({ key: "apply", state: "failed", at: "2026-10-30T10:12:00.000Z" });
  });

  it("ignores malformed step history", () => {
    const job = toAutobidJob(row({ bid_meta: { steps: [null, { at: "nope", text: "x" }, { at: "2026-10-30T10:00:00Z" }] } }));
    expect(job.log).toEqual([]);
  });
});
