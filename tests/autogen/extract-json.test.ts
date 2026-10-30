import { describe, expect, it } from "vitest";
import { AnswerParseError, extractBuiltResumeJson } from "@/lib/autogen/extract-json";

const resume = (extra: Record<string, unknown> = {}) => ({
  resume_template: "William",
  job_title: "Engineer",
  company_name: "Initech",
  job_description: "JD",
  summary: { placeholder: "<<Summary>>", text: "Hello" },
  ...extra,
});

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof AnswerParseError ? error.reason : "other";
  }
  return "none";
}

describe("extractBuiltResumeJson", () => {
  it("parses a bare JSON answer", () => {
    expect(extractBuiltResumeJson(JSON.stringify(resume())).company_name).toBe("Initech");
  });

  it("finds JSON inside fences and prose", () => {
    const raw = "Here is your resume:\n```json\n" + JSON.stringify(resume()) + "\n```\nGood luck!";
    expect(extractBuiltResumeJson(raw).job_title).toBe("Engineer");
  });

  it("keeps typographic quotes inside strings", () => {
    const raw = JSON.stringify(resume({ summary: { placeholder: "<<Summary>>", text: "Known as “the fixer”." } }));
    const parsed = extractBuiltResumeJson(raw) as { summary: { text: string } };
    expect(parsed.summary.text).toBe("Known as “the fixer”.");
  });

  it("prefers the later answer over an earlier example with the same fields", () => {
    const example = JSON.stringify(resume({ company_name: "Example Co" }));
    const answer = JSON.stringify(resume());
    expect(extractBuiltResumeJson(`Example: ${example}\n\nAnswer: ${answer}`).company_name).toBe("Initech");
  });

  it("prefers the object with more registration fields", () => {
    const partial = JSON.stringify({ summary: { text: "x" }, job_title: "Only title" });
    const full = JSON.stringify(resume());
    expect(extractBuiltResumeJson(`${full}\n${partial}`).company_name).toBe("Initech");
  });

  it("ignores JSON that is not a resume", () => {
    expect(reason(() => extractBuiltResumeJson('{"status":"ok","count":3}'))).toBe("malformed");
  });

  it("repairs an unescaped quote inside a string", () => {
    const raw = '{"resume_template":"William","job_title":"Engineer","company_name":"Initech","job_description":"Say "hi" daily","summary":{"text":"x"}}';
    expect(extractBuiltResumeJson(raw).job_description).toBe('Say "hi" daily');
  });

  it("brace characters inside strings do not split the object", () => {
    const raw = JSON.stringify(resume({ job_description: "Use {curly} braces and } alone" }));
    expect(extractBuiltResumeJson(raw).job_description).toBe("Use {curly} braces and } alone");
  });

  it("reports empty, missing and truncated answers distinctly", () => {
    expect(reason(() => extractBuiltResumeJson("   "))).toBe("empty");
    expect(reason(() => extractBuiltResumeJson("Sorry, I can't help with that."))).toBe("no_json");
    expect(reason(() => extractBuiltResumeJson(JSON.stringify(resume()).slice(0, 60)))).toBe("malformed");
  });
});
