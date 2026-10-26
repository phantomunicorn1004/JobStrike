import { describe, expect, it } from "vitest";
import { matchApplication, type MatchCandidate, type MatchInput } from "@/lib/mail/match";

const apps: MatchCandidate[] = [
  { id: 1, profileId: 5, company: "Capital One", jobTitle: "Senior Data Engineer", appliedAt: "2026-10-01T10:00:00Z" },
  { id: 2, profileId: 5, company: "Capital One", jobTitle: "Machine Learning Engineer", appliedAt: "2026-10-05T10:00:00Z" },
  { id: 3, profileId: 5, company: "Ten Mile Square Technologies", jobTitle: "Software Engineer", appliedAt: "2026-10-02T10:00:00Z" },
  { id: 4, profileId: 5, company: "Aflac", jobTitle: "Data Analyst", appliedAt: "2026-10-20T10:00:00Z" },
  { id: 5, profileId: 5, company: "Meta Platforms", jobTitle: "Data Engineer", appliedAt: "2026-10-03T10:00:00Z" },
  { id: 6, profileId: 5, company: "Metabase", jobTitle: "Data Engineer", appliedAt: "2026-10-03T10:00:00Z" },
];

const email = (o: Partial<MatchInput>): MatchInput => ({
  fromEmail: "no-reply@greenhouse-mail.io",
  fromName: null,
  receivedAt: "2026-10-22T10:00:00Z",
  company: null,
  jobTitle: null,
  ...o,
});

describe("matching an email to its application", () => {
  it("uses the job title to pick between two applications at a company", () => {
    expect(matchApplication(email({ company: "Capital One", jobTitle: "Sr. Data Engineer" }), apps)).toMatchObject({ applicationId: 1 });
    expect(matchApplication(email({ company: "Capital One", jobTitle: "Machine Learning Engineer - Remote" }), apps)).toMatchObject({
      applicationId: 2,
    });
  });

  it("picks the latest application but stays unsure without a title", () => {
    const m = matchApplication(email({ company: "Capital One" }), apps)!;
    expect(m.applicationId).toBe(2);
    expect(m.score).toBeLessThan(0.6);
  });

  it("matches by the sender's company domain", () => {
    expect(matchApplication(email({ fromEmail: "jane@tenmilesquare.com" }), apps)).toMatchObject({ applicationId: 3 });
  });

  it("never matches an application sent after the email", () => {
    expect(matchApplication(email({ company: "Aflac", receivedAt: "2026-10-10T10:00:00Z" }), apps)).toBeNull();
  });

  it("does not confuse Meta with Metabase", () => {
    expect(matchApplication(email({ company: "Meta", jobTitle: "Data Engineer" }), apps)).toMatchObject({ applicationId: 5 });
  });

  it("finds nothing for an unknown company", () => {
    expect(matchApplication(email({ company: "Globex", jobTitle: "Data Engineer" }), apps)).toBeNull();
  });

  it("is unsure when the only application has another title", () => {
    const m = matchApplication(email({ company: "Aflac", jobTitle: "Product Manager" }), apps)!;
    expect(m.applicationId).toBe(4);
    expect(m.score).toBeLessThan(0.6);
  });
});
