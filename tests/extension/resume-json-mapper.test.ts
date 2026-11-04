import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const mapper = require_("../../jobstrike_extension/resume-json-mapper.js") as {
  extractWorkExperienceForAi: (data: unknown) => Array<Record<string, unknown>>;
  extractResumeOverviewForAi: (data: unknown) => { summary: string; competencies: string; skills: string };
};

/** The shape AutoGen's generated resumes have (bullets as numbered objects). */
const GENERATED = {
  summary: { heading: "SUMMARY", text: "Senior software engineer with 8+ years." },
  core_competencies: { text: "Async APIs · Vector Retrieval" },
  technology_stack: {
    heading: "SKILLS",
    skill_group_1: { text: "Languages & APIs" },
    skill_items_1: { text: "Python, Go" },
    skill_group_2: { text: "Generative AI" },
    skill_items_2: { text: "RAG, Embeddings" },
  },
  work_experience: {
    heading: "EXPERIENCE",
    experience_1: {
      company: { text: "SOURCEGRAPH" },
      role_title: { text: "Senior Software Engineer" },
      extra_role_title: { text: "AI Infrastructure" },
      start_date: "Oct 2023",
      end_date: "Jun 2026",
      role_summary_1: { text: "Built streaming inference APIs." },
      technologies_1: { text: "Python, FastAPI" },
      bullets: {
        bullet_10: { text: "Tenth." },
        bullet_2: { text: "Second." },
        bullet_1: { text: "First." },
      },
    },
  },
};

describe("extractWorkExperienceForAi", () => {
  it("reads numbered bullet objects, the role summary, technologies and focus", () => {
    const [role] = mapper.extractWorkExperienceForAi(GENERATED);
    expect(role).toMatchObject({
      role_title: "Senior Software Engineer (AI Infrastructure) at SOURCEGRAPH",
      employer_name: "SOURCEGRAPH",
      role_summary: "Built streaming inference APIs.",
      technologies: "Python, FastAPI",
      role_bullets: ["First.", "Second.", "Tenth."],
      start_date: "Oct 2023",
      end_date: "Jun 2026",
    });
  });

  it("still reads bullets given as a list", () => {
    const [role] = mapper.extractWorkExperienceForAi({
      work_experience: { experience_1: { company: "Acme", role_title: "Engineer", bullets: ["One", { text: "Two" }] } },
    });
    expect(role.role_bullets).toEqual(["One", "Two"]);
  });
});

describe("extractResumeOverviewForAi", () => {
  it("reads the summary, competencies and skill groups", () => {
    expect(mapper.extractResumeOverviewForAi(GENERATED)).toEqual({
      summary: "Senior software engineer with 8+ years.",
      competencies: "Async APIs · Vector Retrieval",
      skills: "Languages & APIs: Python, Go; Generative AI: RAG, Embeddings",
    });
  });
});
