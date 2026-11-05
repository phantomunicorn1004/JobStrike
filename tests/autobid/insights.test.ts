import { describe, expect, it } from "vitest";
import { countByCategory, failureCategory, statsByVersion } from "@/lib/autobid/insights";
import type { AutobidJob } from "@/lib/autobid/stages";

function job(overrides: Partial<AutobidJob>): AutobidJob {
  return {
    id: 1,
    profileId: 1,
    candidate: "",
    company: "",
    jobTitle: "",
    jobLink: "",
    stage: "needs_you",
    sentByRunner: false,
    dryRun: false,
    currentStep: "",
    reason: "",
    submitClicked: false,
    missingFields: [],
    runVersion: "",
    steps: [],
    log: [],
    updatedAt: "",
    ...overrides,
  };
}

describe("failureCategory", () => {
  it.each([
    ["Required field not filled: Website", "missing_field"],
    ["Submit was clicked … “Your form needs corrections · Missing entry for required field: Location”", "ashby"],
    ["The site rejected the form: gdpr_demographic_data_consent_given", "gdpr"],
    ["The site rejected the form: Cover Letter is required.", "cover_letter"],
    ["Dry run: filled and checked, not submitted.", "dry_run"],
    ["The site showed an error after Submit. The page shows: “This position has been filled”.", "site_rejected"],
    ["Something unexpected", "other"],
  ])("%s → %s", (reason, key) => {
    expect(failureCategory(job({ reason })).key).toBe(key);
  });

  it("puts failed resumes in their own group", () => {
    expect(failureCategory(job({ stage: "gen_failed", reason: "anything" })).key).toBe("resume_failed");
  });
});

describe("countByCategory / statsByVersion", () => {
  const jobs = [
    job({ id: 1, reason: "Required field not filled: A", runVersion: "4.44.0" }),
    job({ id: 2, reason: "Required field not filled: B", runVersion: "4.43.3" }),
    job({ id: 3, stage: "registered", sentByRunner: true, runVersion: "4.44.0" }),
    job({ id: 4, stage: "registered", sentByRunner: true, runVersion: "4.44.0" }),
  ];

  it("counts only stopped jobs", () => {
    expect(countByCategory(jobs)).toEqual([
      { key: "missing_field", label: "Required field not filled", count: 2, jobIds: [1, 2] },
    ]);
  });

  it("orders versions newest first with a sent rate", () => {
    expect(statsByVersion(jobs)).toEqual([
      { version: "4.44.0", sent: 2, stopped: 1, rate: 2 / 3 },
      { version: "4.43.3", sent: 0, stopped: 1, rate: 0 },
    ]);
  });
});
