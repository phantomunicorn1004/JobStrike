import { describe, expect, it } from "vitest";
import { canonicalJobUrl } from "@/lib/job-url";

describe("canonicalJobUrl", () => {
  it("gives a Greenhouse embed and the board's own page the same key", () => {
    const embed = canonicalJobUrl("https://job-boards.greenhouse.io/embed/job_app?for=muckrack&token=8928743002");
    const board = canonicalJobUrl("https://job-boards.greenhouse.io/muckrack/jobs/8928743002");
    const old = canonicalJobUrl("https://boards.greenhouse.io/muckrack/jobs/8928743002?gh_jid=8928743002");
    expect(embed).toBe("boards.greenhouse.io/muckrack/jobs/8928743002");
    expect(board).toBe(embed);
    expect(old).toBe(embed);
  });

  it("keeps different jobs apart", () => {
    expect(canonicalJobUrl("https://job-boards.greenhouse.io/embed/job_app?for=muckrack&token=1")).not.toBe(
      canonicalJobUrl("https://job-boards.greenhouse.io/embed/job_app?for=muckrack&token=2"),
    );
    expect(canonicalJobUrl("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1")).not.toBe(
      canonicalJobUrl("https://job-boards.greenhouse.io/embed/job_app?for=other&token=1"),
    );
  });

  it("leaves an embed without a numeric token as it is", () => {
    expect(canonicalJobUrl("https://job-boards.greenhouse.io/embed/job_app?for=acme")).toBe("boards.greenhouse.io/embed/job_app");
  });

  it("treats a Lever posting and its application form as one job", () => {
    expect(canonicalJobUrl("https://jobs.lever.co/truv/2a05f4f2/apply")).toBe(canonicalJobUrl("https://jobs.lever.co/truv/2a05f4f2"));
  });
});
