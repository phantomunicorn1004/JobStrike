import { describe, expect, it } from "vitest";
import { nonUsLocation, screenCandidate, siteOf, type ScreenOptions } from "@/lib/autobid/screen";

const citizen: ScreenOptions = {
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

  it("skips other sites and the European board, passes Ashby", () => {
    expect(screenCandidate({ jobLink: "https://x.icims.com/jobs/1", jobTitle: "Engineer" }, citizen)).toMatchObject({ ok: false });
    expect(
      screenCandidate({ jobLink: "https://jobs.ashbyhq.com/x/1", jobTitle: "Engineer" }, citizen),
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

describe("nonUsLocation", () => {
  const jd = (location: string) => `## Job details Location: ${location} Employment Type: Remote\n## Description ...`;

  it("flags postings open only outside the U.S.", () => {
    expect(nonUsLocation(jd("Cyprus; Montenegro; Georgia; Serbia; Armenia; Italy; Portugal; Poland; Spain"))).toMatch(/^Cyprus/);
    expect(nonUsLocation(jd("Canada - Remote"))).toBe("Canada - Remote");
    expect(nonUsLocation(jd("Canada (Remote)"))).toBe("Canada (Remote)");
    expect(nonUsLocation(jd("Turkey; Tirana; remote; Nairobi, Kenya; Kampala, Uganda"))).not.toBe("");
    expect(nonUsLocation("Location: United Kingdom\nAbout us")).toBe("United Kingdom");
  });

  it("passes anything open to the U.S., and what it cannot tell", () => {
    for (const location of [
      "Remote - US",
      "United States (Remote)",
      "Remote, Canada; Remote, United States",
      "San Francisco, CA, New York, NY, Portland, OR, or Remote within Canada or United States",
      "Home Based - Americas",
      "Billings, MT",
      "Missouri - Kansas City",
      "New York, NY; USA Remote",
      "Remote (US)",
      "Remote",
      "Georgia",
      "Chicago, IL or Remote",
    ]) {
      expect(nonUsLocation(jd(location)), location).toBe("");
    }
    expect(nonUsLocation("No location line here. We have an office in London.")).toBe("");
  });
});

describe("screenCandidate: location", () => {
  it("skips a Europe-only remote role for a U.S. candidate", () => {
    const result = screenCandidate(
      { jobLink: "https://jobs.lever.co/truv/1", jobTitle: "FrontEnd Engineer", jobDescription: "Location: Spain / Cyprus / Poland\nRemote" },
      citizen,
    );
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.reason).toMatch(/^Outside the U\.S\./);
  });

  it("does not apply the rule to a candidate abroad", () => {
    const abroad: ScreenOptions = { ...citizen, profile: { ...citizen.profile, country: "Spain" } };
    expect(
      screenCandidate({ jobLink: GH, jobTitle: "Engineer", jobDescription: "Location: Spain; Portugal" }, abroad),
    ).toMatchObject({ ok: true });
  });
});

describe("screenCandidate: overnight hours", () => {
  const job = (jobDescription: string) => ({ jobLink: GH, jobTitle: "Cloud Engineer", jobDescription });

  it("skips night shifts and hours that run through the night", () => {
    for (const jd of [
      "Location: US\nWork hours will be 11 PM-8am EST",
      "Location: US\nThis is a night shift role.",
      "Location: US\nOvernight shift, 10:00 p.m. to 6:30 a.m.",
      "Location: US\nSchedule: 11pm to 7am",
    ]) {
      expect(screenCandidate(job(jd), citizen), jd).toEqual({ ok: false, reason: "Night shift" });
    }
  });

  it("passes day hours and evening meetups", () => {
    for (const jd of [
      "Location: US\nCore hours 9am-5pm ET",
      "Location: US\nOccasional calls until 9 PM with the APAC team.",
      "Location: US\nOn-call rotation one week a month.",
    ]) {
      expect(screenCandidate(job(jd), citizen), jd).toMatchObject({ ok: true });
    }
  });
});

describe("nonUsLocation: working hours abroad", () => {
  it("flags an unclear location whose hours are set in Europe or Asia", () => {
    expect(
      nonUsLocation("Location: Georgia\nAre you available to work from 2 PM to 11 PM EET (Eastern European Time)?"),
    ).toBe("Georgia, hours in EET");
    expect(nonUsLocation("Location: Remote\nWorking hours: 9:00-18:00 CET")).toBe("Remote, hours in CET");
  });

  it("leaves U.S. locations and U.S. time zones alone", () => {
    expect(nonUsLocation("Location: Remote - US\nOverlap with our team in CET for one hour a day.")).toBe("");
    expect(nonUsLocation("Location: Remote\nCore hours 9am-5pm EST")).toBe("");
    expect(nonUsLocation("Location: Georgia\nOffice in Atlanta.")).toBe("");
  });
});

describe("screenCandidate: European boards", () => {
  it("skips Lever's EU board like Greenhouse's", () => {
    expect(screenCandidate({ jobLink: "https://jobs.eu.lever.co/xm/709e495a", jobTitle: "Senior Angular Developer" }, citizen)).toEqual({
      ok: false,
      reason: "European job board",
    });
    expect(nonUsLocation("Location: Nicosia; Athens; Remote; Thessaloniki; Limassol")).toMatch(/^Nicosia/);
  });
});
