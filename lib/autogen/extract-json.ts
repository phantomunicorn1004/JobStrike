/**
 * Pull the built resume JSON out of a model reply (ChatGPT tab or API).
 *
 * The reply is tried as written first, so typographic quotes inside strings
 * survive. Only when nothing parses are fences removed, curly quotes
 * straightened and stray quotes inside strings escaped. Among several JSON
 * objects (a prompt example and the answer), the one with the most
 * registration fields wins, and on a tie the later one.
 */

const REGISTRATION_KEYS = ["resume_template", "job_title", "company_name", "job_description"] as const;

function fieldFilled(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (value && typeof value === "object" && "text" in value) {
    return Boolean(String((value as { text?: unknown }).text ?? "").trim());
  }
  return value != null && value !== "";
}

/** -1 for anything that is not a resume-like object. */
function scoreResumeJson(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return -1;
  const obj = value as Record<string, unknown>;
  const resumeLike =
    "work_experience" in obj || "summary" in obj || "technology_stack" in obj || "resume_template" in obj;
  if (!resumeLike) return -1;
  return REGISTRATION_KEYS.reduce((score, key) => score + (fieldFilled(obj[key]) ? 1 : 0), 0);
}

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
}

function straightenQuotes(text: string): string {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/** A quote closes a string only when the next non-space character is a JSON delimiter. */
function escapeStrayQuotes(text: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }
    if (ch !== '"') {
      out += ch;
      continue;
    }
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    const next = text[j] || "";
    if (!next || next === "," || next === "}" || next === "]" || next === ":") {
      out += '"';
      inString = false;
    } else {
      out += '\\"';
    }
  }
  return out;
}

/** Top-level balanced {…} slices, ignoring braces inside strings. */
function balancedObjectSlices(text: string): string[] {
  const slices: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      if (depth > 0) inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        slices.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return slices;
}

function bestCandidate(source: string): { obj: Record<string, unknown>; score: number } | null {
  let best: { obj: Record<string, unknown>; score: number } | null = null;
  const slices = balancedObjectSlices(source);
  for (const slice of slices.length ? slices : [source]) {
    let obj: unknown;
    try {
      obj = JSON.parse(slice);
    } catch {
      continue;
    }
    const score = scoreResumeJson(obj);
    if (score < 0) continue;
    // >= so a later answer beats an earlier example with the same fields.
    if (!best || score >= best.score) best = { obj: obj as Record<string, unknown>, score };
  }
  return best;
}

export class AnswerParseError extends Error {
  constructor(
    message: string,
    readonly reason: "empty" | "no_json" | "malformed",
  ) {
    super(message);
    this.name = "AnswerParseError";
  }
}

export function extractBuiltResumeJson(raw: string): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  if (!text) throw new AnswerParseError("The answer is empty.", "empty");

  const unfenced = stripFences(text);
  const straightened = straightenQuotes(unfenced);
  const attempts = [text, unfenced, escapeStrayQuotes(unfenced), straightened, escapeStrayQuotes(straightened)];
  const seen = new Set<string>();
  for (const source of attempts) {
    if (seen.has(source)) continue;
    seen.add(source);
    const best = bestCandidate(source);
    if (best) return best.obj;
  }

  if (!/[{]/.test(text)) {
    throw new AnswerParseError(`The answer has no JSON (${text.length} characters).`, "no_json");
  }
  throw new AnswerParseError(
    `The answer's JSON is incomplete or malformed (${text.length} characters).`,
    "malformed",
  );
}
