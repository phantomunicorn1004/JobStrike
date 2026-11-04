import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
require_("../../jobstrike_extension/field-registry.js");
const fr = (globalThis as unknown as {
  SmartJobFieldRegistry: {
    getDemographicCandidates: (category: string, value: string) => string[];
    demographicOptionScore: (option: string, target: string, category: string) => number;
  };
}).SmartJobFieldRegistry;

/** The option the filler would choose (cut-off 0.45, as for self-ID dropdowns), or "". */
function pick(category: string, value: string, options: string[]): string {
  const candidates = fr.getDemographicCandidates(category, value);
  let best = "";
  let bestScore = 0;
  for (const option of options) {
    const score = Math.max(...candidates.map((c) => fr.demographicOptionScore(option, c, category)));
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return bestScore >= 0.45 ? best : "";
}

const GREENHOUSE = ["Yes", "No", "Decline To Self Identify"];

describe("self-identification answers", () => {
  it("answers No with No, not with Decline (Greenhouse's Hispanic/Latino list)", () => {
    expect(pick("hispanic_latino", "No", GREENHOUSE)).toBe("No");
    expect(pick("hispanic_latino", "No", ["Hispanic or Latino", "Not Hispanic or Latino", "Decline to self-identify"])).toBe(
      "Not Hispanic or Latino",
    );
  });

  it("never takes 'Hispanic or Latino' for a No ('no' inside 'Latino')", () => {
    expect(pick("hispanic_latino", "No", ["Hispanic or Latino", "Decline to self-identify"])).toBe("");
  });

  it("keeps Yes and Decline apart from No", () => {
    expect(pick("hispanic_latino", "Yes", GREENHOUSE)).toBe("Yes");
    expect(pick("hispanic_latino", "Decline to self-identify", GREENHOUSE)).toBe("Decline To Self Identify");
  });

  it("answers veteran and disability No with the option that says no", () => {
    expect(pick("veteran_status", "No", GREENHOUSE)).toBe("No");
    expect(
      pick("veteran_status", "No", [
        "I am not a protected veteran",
        "I identify as one or more of the classifications of protected veteran",
        "I don't wish to answer",
      ]),
    ).toBe("I am not a protected veteran");
    expect(
      pick("disability_status", "No", [
        "Yes, I have a disability (or previously had a disability)",
        "No, I do not have a disability and have not had one in the past",
        "I do not want to answer",
      ]),
    ).toBe("No, I do not have a disability and have not had one in the past");
  });

  it("still matches race and gender wording", () => {
    expect(pick("race", "Asian", ["Hispanic or Latino", "Asian (Not Hispanic or Latino)", "Decline To Self Identify"])).toBe(
      "Asian (Not Hispanic or Latino)",
    );
    expect(pick("gender_identity", "Man", ["Female", "Male", "Non-binary"])).toBe("Male");
  });
});
