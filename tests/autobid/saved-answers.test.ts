import { describe, expect, it } from "vitest";
import { formatSavedAnswers, mergeSavedAnswers, missingFieldsOf, parseSavedAnswers } from "@/lib/autobid/saved-answers";

describe("saved answers", () => {
  it("parses Q/A pairs and skips unanswered questions", () => {
    const text = "Q: What pronouns do you use?\nA: He/Him\n\nQ: Website\n\nq: Start date\na: Immediately";
    expect(parseSavedAnswers(text)).toEqual([
      { question: "What pronouns do you use?", answer: "He/Him" },
      { question: "Start date", answer: "Immediately" },
    ]);
  });

  it("replaces the answer for the same question and appends new ones", () => {
    const before = formatSavedAnswers([{ question: "Website", answer: "https://a.example" }]);
    const after = mergeSavedAnswers(before, [
      { question: "website?", answer: "https://b.example" },
      { question: "Pronouns", answer: "She/Her" },
    ]);
    expect(parseSavedAnswers(after)).toEqual([
      { question: "website?", answer: "https://b.example" },
      { question: "Pronouns", answer: "She/Her" },
    ]);
  });
});

describe("missingFieldsOf", () => {
  it("prefers the run's open fields", () => {
    expect(missingFieldsOf("Required field not filled: Website", { openFields: ["Website"] })).toEqual(["Website"]);
  });

  it("reads a not-filled stop reason", () => {
    expect(missingFieldsOf("Required fields not filled: A; B", null)).toEqual(["A", "B"]);
  });

  it("reads Ashby's corrections banner without the VERIFY button", () => {
    const error =
      "Submit was clicked but no confirmation was recognised. The page shows: “Your form needs corrections · Missing entry for required field: What pronouns do you use? · Missing entry for required field: Location · VERIFY”.";
    expect(missingFieldsOf(error, {})).toEqual(["What pronouns do you use?", "Location"]);
  });
});
