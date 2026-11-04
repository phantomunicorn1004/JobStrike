import { describe, expect, it } from "vitest";
import {
  buildFitUserPrompt,
  checkJobFit,
  clipPosting,
  decideFit,
  describeExperience,
  evidenceInPosting,
  type FitInput,
  type FitModelReply,
} from "@/lib/autobid/fit";

const KIT = JSON.stringify({
  current_location: "Pensacola, FL",
  education: { degree: "Bachelor of Science in Computer Science" },
  technology_stack: { skill_items_1: { text: "TypeScript, Go, Postgres" }, skill_items_2: { text: "" } },
  work_experience: {
    heading: "EXPERIENCE",
    experience_2: { company: { text: "Acme" }, role_title: { text: "Software Engineer" }, start_date: "2019", end_date: "2023" },
    experience_1: { company: { text: "SOURCEGRAPH" }, role_title: { text: "Senior Software Engineer" }, start_date: "Oct 2023", end_date: "Jun 2026" },
  },
});

const POSTING =
  "We build developer tools. This role requires 3 days per week in our Boston office. You will write Go services.";

const input: FitInput = {
  jobTitle: "Senior Backend Engineer",
  company: "Acme",
  jobDescription: POSTING,
  autofill: { citizenship: "US citizen", securityClearance: "No", highestEducation: "Bachelor's degree" },
  resumeTemplateJson: KIT,
};

const reply = (overrides: Partial<FitModelReply> = {}): FitModelReply => ({
  hard_blockers: [],
  role_fit: 85,
  role_fit_reason: "Backend engineering; candidate is a senior software engineer.",
  summary: "Good fit.",
  ...overrides,
});

describe("candidate facts", () => {
  it("lists the kit's real roles in order, the degree and the skills", () => {
    expect(describeExperience(KIT)).toBe(
      [
        "Roles held:",
        "  • Senior Software Engineer at SOURCEGRAPH (Oct 2023 – Jun 2026)",
        "  • Software Engineer at Acme (2019 – 2023)",
        "Degree: Bachelor of Science in Computer Science",
        "Skills: TypeScript, Go, Postgres",
      ].join("\n"),
    );
  });

  it("puts the candidate's location and the posting in the prompt", () => {
    const prompt = buildFitUserPrompt(input);
    expect(prompt).toContain("Location: Pensacola, FL, USA");
    expect(prompt).toContain("JOB: Senior Backend Engineer at Acme");
    expect(prompt).toContain(POSTING);
  });

  it("keeps the end of an over-long posting when it holds a blocker topic", () => {
    const long = `${"Filler sentence about the team. ".repeat(400)}Candidates must reside in Texas.`;
    const clipped = clipPosting(long);
    expect(clipped.length).toBeLessThanOrEqual(9100);
    expect(clipped).toContain("Candidates must reside in Texas.");
  });
});

describe("decideFit", () => {
  it("passes a good fit with no blockers", () => {
    expect(decideFit(reply(), POSTING)).toMatchObject({ ok: true, score: 85 });
  });

  it("skips on a proven blocker", () => {
    const result = decideFit(
      reply({
        hard_blockers: [
          {
            category: "onsite",
            candidate_conflict: "Candidate works remotely",
            evidence: "This role requires 3 days per week in our Boston office",
            confidence: 0.95,
          },
        ],
      }),
      POSTING,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^onsite: "This role requires 3 days/);
  });

  it("ignores a blocker whose quote is not in the posting, or that is unsure", () => {
    const invented = { category: "onsite", candidate_conflict: "remote", evidence: "Must work from our Denver office daily", confidence: 0.99 };
    const unsure = { category: "onsite", candidate_conflict: "remote", evidence: "3 days per week in our Boston office", confidence: 0.6 };
    const result = decideFit(reply({ hard_blockers: [invented, unsure] }), POSTING);
    expect(result.ok).toBe(true);
    expect(result.rejectedBlockers.map((b) => b.why)).toEqual(["quote not found in the posting", "confidence below threshold"]);
  });

  it("overrules a clearance that only needs to be obtainable", () => {
    const posting = "Must have the ability to obtain a Secret clearance.";
    const result = decideFit(
      reply({
        hard_blockers: [{ category: "clearance", candidate_conflict: "No clearance", evidence: "ability to obtain a Secret clearance", confidence: 0.95 }],
      }),
      posting,
    );
    expect(result.ok).toBe(true);
  });

  it("skips a low role fit with its reason", () => {
    const result = decideFit(reply({ role_fit: 30, role_fit_reason: "ERP functional consulting; candidate is a developer." }), POSTING);
    expect(result).toMatchObject({ ok: false, score: 30 });
    expect(result.reason).toBe("Role fit 30: ERP functional consulting; candidate is a developer.");
  });
});

describe("checkJobFit", () => {
  it("sends the prompts to the model and decides on its reply", async () => {
    let seen = "";
    const result = await checkJobFit(input, async ({ user }) => {
      seen = user;
      return reply();
    });
    expect(seen).toContain("CANDIDATE EXPERIENCE:");
    expect(result.ok).toBe(true);
  });

  it("does not call the model without a description", async () => {
    const result = await checkJobFit({ ...input, jobDescription: "  " }, async () => {
      throw new Error("called");
    });
    expect(result).toMatchObject({ ok: false, reason: "No job description" });
  });
});

describe("evidenceInPosting", () => {
  it("matches across quote styles and ellipses", () => {
    expect(evidenceInPosting("“requires 3 days per week” ... “write Go services”", POSTING)).toBe(true);
    expect(evidenceInPosting("requires 5 days per week", POSTING)).toBe(false);
  });
});
