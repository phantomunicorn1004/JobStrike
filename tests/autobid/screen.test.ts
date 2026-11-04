import { describe, expect, it } from "vitest";
import { screenCandidate, siteOf, type ScreenOptions } from "@/lib/autobid/screen";

const citizen: ScreenOptions = {
  ashby: false,
  profile: { citizenship: "US citizen", securityClearance: "No", sponsorshipRequirement: "No" },
};

const GH = "https://job-boards.greenhouse.io/acme/jobs/1";

describe("siteOf", () => {
  it("names the sites Auto-bid applies on", () => {
    expect(siteOf("https://job-boards.greenhouse.io/embed/job_app?for=x&token=1")).toBe("Greenhouse");
    expect(siteOf("https://boards.greenhouse.io/x/jobs/1")).toBe("Greenhouse");
    expect(siteOf("https://jobs.lever.co/x/abc")).toBe("Lever");
    expect(siteOf("https://jobs.ashbyhq.com/x/abc")).toBe("Ashby");
    expect(siteOf("https://x.wd5.myworkdayjobs.com/en-US/jobs/1")).toBe("");
    expect(siteOf("https://clever.com/jobs")).toBe("");
    expect(siteOf("not a link")).toBe("");
  });
});

describe("screenCandidate: lite pass", () => {
  it("passes an engineer role on Greenhouse", () => {
    expect(screenCandidate({ jobLink: GH, jobTitle: "Senior Software Engineer" }, citizen)).toEqual({
      ok: true,
      site: "Greenhouse",
    });
  });

  it("skips other sites, Ashby unless asked, and the European board", () => {
    expect(screenCandidate({ jobLink: "https://x.icims.com/jobs/1", jobTitle: "Engineer" }, citizen)).toMatchObject({ ok: false });
    expect(screenCandidate({ jobLink: "https://jobs.ashbyhq.com/x/1", jobTitle: "Engineer" }, citizen)).toEqual({
      ok: false,
      reason: "Ashby: queued only by hand",
    });
    expect(
      screenCandidate({ jobLink: "https://jobs.ashbyhq.com/x/1", jobTitle: "Engineer" }, { ...citizen, ashby: true }),
    ).toMatchObject({ ok: true, site: "Ashby" });
    expect(
      screenCandidate({ jobLink: "https://job-boards.eu.greenhouse.io/x/jobs/1", jobTitle: "Engineer" }, citizen),
    ).toEqual({ ok: false, reason: "European job board" });
  });

  it("skips titles an engineer profile does not bid on", () => {
    for (const title of ["JD Edwards Data & ERP Consultant", "Sr. Implementation Manager (SFDC)", "AI Product Specialist"]) {
      expect(screenCandidate({ jobLink: GH, jobTitle: title }, citizen)).toMatchObject({ ok: false });
    }
    expect(screenCandidate({ jobLink: GH, jobTitle: "Staff Fullstack Engineer (TypeScript)" }, citizen)).toMatchObject({ ok: true });
  });
});

describe("screenCandidate: with the job description", () => {
  const withJd = (jobDescription: string, options = citizen) =>
    screenCandidate({ jobLink: GH, jobTitle: "Software Engineer", jobDescription }, options);

  it("skips a required active clearance unless the profile holds one", () => {
    expect(withJd("Candidates must hold an active Secret clearance.")).toMatchObject({ ok: false });
    expect(withJd("TS/SCI with polygraph.")).toMatchObject({ ok: false });
    expect(
      withJd("Candidates must hold an active Secret clearance.", {
        ...citizen,
        profile: { ...citizen.profile, securityClearance: "Secret" },
      }),
    ).toMatchObject({ ok: true });
  });

  it("does not skip a clearance the candidate can obtain", () => {
    expect(withJd("Ability to obtain a clearance is a plus.")).toMatchObject({ ok: true });
  });

  it("skips U.S. citizenship only for a profile that is not a citizen", () => {
    const jd = "Applicants must be a U.S. citizen.";
    expect(withJd(jd)).toMatchObject({ ok: true });
    expect(withJd(jd, { ...citizen, profile: { citizenship: "Canadian" } })).toMatchObject({ ok: false });
  });

  it("skips no-sponsorship only for a profile that needs it", () => {
    const jd = "We are unable to sponsor visas for this role.";
    expect(withJd(jd)).toMatchObject({ ok: true });
    expect(withJd(jd, { ...citizen, profile: { ...citizen.profile, sponsorshipRequirement: "Yes" } })).toMatchObject({
      ok: false,
    });
  });

  it("skips night shifts", () => {
    expect(withJd("This position requires working a night shift from 12:00 AM.")).toEqual({ ok: false, reason: "Night shift" });
  });
});
