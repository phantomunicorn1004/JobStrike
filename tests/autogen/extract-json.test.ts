import { describe, expect, it } from "vitest";
import { AnswerParseError, extractBuiltResumeJson, sanitizeChatGptJson } from "@/lib/autogen/extract-json";

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

  it("handles ChatGPT HTML entities and line-continuation backslashes", () => {
    const garbled = '{\\  \n&#x20; "resume_template": "Jacob",\\\n&#x20; "job_title": "Engineer",\\\n&#x20; "company_name": "Initech",\\\n&#x20; "job_description": "JD",\\\n&#x20; "summary": "hello"\\\n}';
    const result = extractBuiltResumeJson(garbled);
    expect(result.resume_template).toBe("Jacob");
    expect(result.company_name).toBe("Initech");
  });

  it("fixes unnecessary backslash escapes from ChatGPT", () => {
    const raw = '{"resume_template":"Jacob","job_title":"Eng","company_name":"Co","job_description":"JD","summary":"x","contact":{"email":"jacob\\.matthew\\.pribisco\\@outlook\\.com"}}';
    const result = extractBuiltResumeJson(raw);
    expect((result.contact as { email: string }).email).toBe("jacob.matthew.pribisco@outlook.com");
  });

  it("fixes double-escaped quotes from ChatGPT", () => {
    const raw = '{"resume_template":"Jacob","job_title":"Eng","company_name":"Co","job_description":"audit on \\\\"Decision Tools\\\\"","summary":"x"}';
    const result = extractBuiltResumeJson(raw);
    expect(result.job_description).toBe('audit on "Decision Tools"');
  });
});

describe("sanitizeChatGptJson", () => {
  it("replaces &#x20; with spaces", () => {
    expect(sanitizeChatGptJson('&#x20;"name": "test"')).toBe(' "name": "test"');
  });

  it("removes line-continuation backslashes", () => {
    expect(sanitizeChatGptJson('"hello",\\\n"world"')).toBe('"hello",\n"world"');
  });

  it("strips unnecessary backslash escapes", () => {
    expect(sanitizeChatGptJson('jacob\\.matthew\\@outlook\\.com')).toBe("jacob.matthew@outlook.com");
  });

  it("preserves valid JSON escapes", () => {
    expect(sanitizeChatGptJson('say \\"hi\\" and use \\\\')).toBe('say \\"hi\\" and use \\\\');
  });

  it("reduces double-escaped quotes to single-escaped", () => {
    expect(sanitizeChatGptJson('on \\\\"Decision Tools\\\\"')).toBe('on \\"Decision Tools\\"');
  });
});
