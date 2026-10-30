import { describe, expect, it } from "vitest";
import { generationReadiness, kitProblems, kitRunMode } from "@/lib/autogen/kit";
import { makeKit } from "./fixtures";

const PROMPT = 'run_settings: {"mode": "verified_candidate"}\nJD:\n{job_description}\nResume:\n{resume_template_json}';

describe("generationReadiness", () => {
  it("is ready for a verified prompt with both placeholders and a complete kit", () => {
    expect(generationReadiness(PROMPT, JSON.stringify(makeKit()))).toEqual({
      ready: true,
      mode: "verified_candidate",
      problems: [],
    });
  });

  it("flags a prompt that lost {job_description} or {resume_template_json}", () => {
    const noJob = generationReadiness(PROMPT.replace("{job_description}", ""), JSON.stringify(makeKit()));
    expect(noJob.ready).toBe(false);
    expect(noJob.problems).toEqual([expect.stringContaining("would not see the job")]);
    const noResume = generationReadiness(PROMPT.replace("{resume_template_json}", ""), JSON.stringify(makeKit()));
    expect(noResume.problems).toEqual([expect.stringContaining("would not see the candidate's resume")]);
  });

  it("flags fictional mode", () => {
    const result = generationReadiness(PROMPT.replace("verified_candidate", "fictional_benchmark"), JSON.stringify(makeKit()));
    expect(result.mode).toBe("fictional_benchmark");
    expect(result.problems).toEqual([expect.stringContaining("fictional_benchmark mode")]);
  });

  it("flags an empty prompt, empty or invalid JSON, and kit problems together", () => {
    expect(generationReadiness("", "").problems).toEqual(["The prompt is empty.", "The resume JSON is empty."]);
    expect(generationReadiness(PROMPT, "{not json").problems).toEqual(["The resume JSON is not a valid JSON object."]);
    const kit = makeKit() as any;
    kit.work_experience.experience_1.company.text = "";
    expect(generationReadiness(PROMPT, JSON.stringify(kit)).problems).toEqual([
      expect.stringContaining("experience_1.company is blank"),
    ]);
  });
});

describe("kitRunMode", () => {
  it("reads run_settings.mode", () => {
    expect(kitRunMode('run_settings: {"mode": "fictional_benchmark", "output_mode": "result_only"}')).toBe(
      "fictional_benchmark",
    );
    expect(kitRunMode('`run_settings`: { "mode": "verified_candidate" }')).toBe("verified_candidate");
  });

  it("falls back to the prompt's stated default when run_settings is gone", () => {
    expect(kitRunMode("The default mode is fictional_benchmark and the default output_mode is result_only.")).toBe(
      "fictional_benchmark",
    );
  });

  it("is unknown for a plain prompt", () => {
    expect(kitRunMode("You are an expert resume writer.\n{job_description}\n{resume_template_json}")).toBe("unknown");
  });
});

describe("kitProblems", () => {
  it("accepts a kit whose roles are filled in", () => {
    expect(kitProblems(makeKit())).toEqual([]);
  });

  it("rejects a blank employer, title or arrangement", () => {
    const kit = makeKit() as any;
    kit.work_experience.experience_1.company.text = "";
    kit.work_experience.experience_2.role_title.text = "  ";
    kit.work_experience.experience_2.work_arrangement.text = "";
    const problems = kitProblems(kit);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("experience_1.company");
    expect(problems.join(" ")).toContain("real job title");
  });

  it("rejects any other printed fact placeholder left blank", () => {
    const kit = makeKit() as any;
    kit.work_experience.experience_1.location.text = "";
    expect(kitProblems(kit)).toEqual([
      expect.stringContaining("experience_1.location is blank"),
    ]);
  });

  it("allows a blank plain-string fact that is not printed", () => {
    const kit = makeKit() as any;
    kit.work_experience.experience_1.company_url = "";
    expect(kitProblems(kit)).toEqual([]);
  });

  it("needs a template name and roles", () => {
    const kit = makeKit() as any;
    delete kit.resume_template;
    kit.work_experience = {};
    expect(kitProblems(kit)).toHaveLength(2);
  });
});
