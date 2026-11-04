import type { ProfileAutofill } from "@/lib/resume-db/profile-autofill";
import { experienceKeys, fieldText, isRecord, parseKitResumeJson } from "@/lib/autogen/kit";

/**
 * The AI fit check on a job that passed the rule check (screen.ts), before
 * ChatGPT spends a resume on it. Two questions, one call:
 *  - hard blockers: a mandatory requirement a known candidate fact rules out,
 *    quoted from the posting (ported from the extension's compatibility check,
 *    with the same safeguards: allowed categories, verbatim quote, confidence);
 *  - role fit: whether the candidate's real roles make this occupation and level
 *    credible (an "ERP consultant" or "mechanical designer" for a software engineer is not).
 * The model call is injected, so everything here is pure and testable.
 */

export const FIT_CATEGORIES = [
  "location",
  "onsite",
  "sponsorship",
  "clearance",
  "occupation",
  "eligibility",
  "language",
  "education",
] as const;

export type FitCategory = (typeof FIT_CATEGORIES)[number];

/** Below this role fit, the job is skipped. */
export const MIN_ROLE_FIT = 50;
const BLOCKER_MIN_CONFIDENCE = 0.9;
const BLOCKER_MIN_EVIDENCE_CHARS = 12;
const EVIDENCE_MIN_FRAGMENT_CHARS = 8;

/** The posting is capped to keep the call cheap; location and eligibility often sit at the end. */
const MAX_JD_CHARS = 9000;
const HEAD_CHARS = 6000;

export type FitBlocker = {
  category: string;
  candidate_conflict: string;
  evidence: string;
  confidence: number;
};

export type FitModelReply = {
  hard_blockers: FitBlocker[];
  role_fit: number;
  role_fit_reason: string;
  summary: string;
};

export type FitResult = {
  ok: boolean;
  /** Role fit, 0–100. */
  score: number;
  /** Why it was skipped, or the summary when it passed. */
  reason: string;
  blockers: FitBlocker[];
  rejectedBlockers: Array<FitBlocker & { why: string }>;
  summary: string;
};

export type FitInput = {
  jobTitle: string;
  company: string;
  jobDescription: string;
  autofill: ProfileAutofill;
  /** The profile's prompt kit resume JSON (its real roles, education, location). */
  resumeTemplateJson: string;
};

// ── Candidate facts ───────────────────────────────────────────────────────

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** The candidate's real roles, education and skills from the kit, in a few lines. */
export function describeExperience(resumeTemplateJson: string): string {
  const kit = parseKitResumeJson(resumeTemplateJson);
  if (!kit) return "";
  const lines: string[] = [];
  const work = isRecord(kit.work_experience) ? kit.work_experience : {};
  for (const key of experienceKeys(work).slice(0, 6)) {
    const role = work[key] as Record<string, unknown>;
    const title = fieldText(role.role_title);
    const company = fieldText(role.company);
    const dates = [text(role.start_date), text(role.end_date)].filter(Boolean).join(" – ");
    if (title || company) lines.push(`  • ${[title, company].filter(Boolean).join(" at ")}${dates ? ` (${dates})` : ""}`);
  }
  const education = isRecord(kit.education) ? text(kit.education.degree) : "";
  const stack = isRecord(kit.technology_stack) ? kit.technology_stack : {};
  const skills = Object.keys(stack)
    .filter((key) => /^skill_items_\d+$/.test(key))
    .map((key) => fieldText(stack[key]))
    .filter(Boolean)
    .join("; ")
    .slice(0, 600);
  return [
    lines.length ? `Roles held:\n${lines.join("\n")}` : "",
    education ? `Degree: ${education}` : "",
    skills ? `Skills: ${skills}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Known facts the posting may contradict; unknown ones are never a conflict. */
export function describeConstraints(autofill: ProfileAutofill, resumeTemplateJson: string): string {
  const kit = parseKitResumeJson(resumeTemplateJson);
  const location = text(kit?.current_location);
  const known: string[] = [];
  const unknown: string[] = [];
  const push = (label: string, value: string, note = "") => {
    if (value) known.push(`  • ${label}: ${value}${note ? ` (${note})` : ""}`);
    else unknown.push(label);
  };
  push("Location", location ? `${location}, USA` : "", "works remotely from here");
  push("Highest education completed", text(autofill.highestEducation), "reject jobs that REQUIRE a higher degree");
  push("Needs visa sponsorship", text(autofill.sponsorshipRequirement) || "No");
  push("Citizenship", text(autofill.citizenship) || "US citizen");
  push("Authorized to work in the US", text(autofill.workAuthorizationUS) || "Yes", "not authorized in any other country");
  push("Spoken languages", text(autofill.languages) || "English only", "reject jobs that require another spoken language");
  push("Willing to relocate", text(autofill.relocationPreference));
  push("Work arrangement required", "Remote");
  push("Active security clearance", text(autofill.securityClearance) || "No", "reject jobs that require an active clearance");
  return [
    "KNOWN CANDIDATE FACTS:",
    known.join("\n"),
    unknown.length ? `\nUNKNOWN (never treat as a conflict): ${unknown.join(", ")}` : "",
  ].join("\n");
}

// ── Posting ───────────────────────────────────────────────────────────────

const BLOCKER_TOPIC_RE =
  /\b(remote|hybrid|onsite|on[\s-]?site|reside|residents?|located|based|office|timezone|time zone|united states|u\.s\.|usa|must live|travel|commute|clearance|ts\/sci|sponsor\w*|visa|citizen\w*|authoriz\w*|eligib\w*|licen[sc]\w*|degree|master'?s|ph\.?\s?d|doctora\w*|bilingual|fluen\w*|language\w*)\b/i;

/** An over-long posting keeps its head plus the later sentences that touch a blocker topic. */
export function clipPosting(jd: string): string {
  const full = jd.trim();
  if (full.length <= MAX_JD_CHARS) return full;
  const head = full.slice(0, HEAD_CHARS);
  const sentences = full.slice(HEAD_CHARS).split(/(?<=[.!?;:\n])\s+/);
  const picked = new Set<number>();
  sentences.forEach((sentence, i) => {
    if (!BLOCKER_TOPIC_RE.test(sentence)) return;
    if (i > 0) picked.add(i - 1);
    picked.add(i);
    if (i < sentences.length - 1) picked.add(i + 1);
  });
  const tail = [...picked]
    .sort((a, b) => a - b)
    .map((i) => sentences[i])
    .join(" ")
    .slice(0, MAX_JD_CHARS - HEAD_CHARS);
  return tail ? `${head}\n[...]\n${tail}` : head;
}

// ── Prompt ────────────────────────────────────────────────────────────────

export const FIT_SYSTEM_PROMPT = [
  "You screen job postings for one candidate before a tailored resume is written for them. Answer two questions.",
  "",
  "=== 1. HARD BLOCKERS ===",
  "Discard only postings the candidate CANNOT be hired for. A hard blocker requires ALL FOUR:",
  "1. The posting states the requirement as MANDATORY (must / required / only).",
  "2. A KNOWN candidate fact directly contradicts it.",
  '3. You quote the requirement VERBATIM from the posting in "evidence".',
  "4. Your confidence is at least 0.90.",
  `Allowed categories: ${FIT_CATEGORIES.join(", ")}. Never claim a blocker for an UNKNOWN fact.`,
  "Examples: \"Candidates must reside in Washington State\" for a candidate in Florida (location); \"3 days per week in our Boston office\" for a remote-only candidate (onsite);",
  "\"Active TS/SCI clearance required\" with no clearance (clearance); \"Fluent German required\" (language); \"Master's degree required\" for a Bachelor's (education);",
  "\"Must be authorized to work in Canada\" (eligibility); a nurse, driver, attorney or commission-only sales posting (occupation).",
  "NOT blockers, never list them: \"able to obtain a clearance\"; anything preferred / a plus / nice to have; years of experience;",
  "\"unable to sponsor\" when the candidate needs no sponsorship; \"US citizenship required\" for a US citizen; a degree the candidate holds,",
  "or one with an alternative (\"BS/MS\", \"or equivalent experience\"); salary, travel %, contract or W2; programming languages; offices in a city without an attendance rule;",
  "\"Remote\" plus a city name. Missing information is never a blocker.",
  "",
  "=== 2. ROLE FIT (0–100) ===",
  "How credible this candidate is for the posting's occupation and level, judged from the roles they actually held.",
  "The resume will be tailored to the posting, so missing tools or skills within the same occupation barely matter.",
  "  80–100: the same occupation and about the same level as their recent roles.",
  "  50–79: an adjacent role their experience credibly stretches to (software engineer → DevOps, data, platform or ML engineer; one level up).",
  "  20–49: a different specialty that needs experience they do not have (ERP or CRM functional consulting, mechanical or hardware design,",
  "         security operations for a pure developer), or a jump of two or more levels (e.g. to Director).",
  "  0–19: a different occupation (sales, recruiting, product or project management, customer support, marketing, legal, medical).",
  "Be consistent: the same posting and candidate must always get the same score.",
  "",
  'Reply with JSON only. "summary" is one short sentence. "role_fit_reason" names the occupation of the posting and of the candidate.',
].join("\n");

export function buildFitUserPrompt(input: FitInput): string {
  return [
    describeConstraints(input.autofill, input.resumeTemplateJson),
    "",
    "CANDIDATE EXPERIENCE:",
    describeExperience(input.resumeTemplateJson) || "  (none recorded)",
    text(input.autofill.extraFacts) ? `\nMORE FACTS FROM THE CANDIDATE:\n${text(input.autofill.extraFacts).slice(0, 1500)}` : "",
    "",
    `JOB: ${text(input.jobTitle)}${input.company ? ` at ${text(input.company)}` : ""}`,
    "POSTING:",
    clipPosting(input.jobDescription),
  ].join("\n");
}

export const FIT_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "job_fit",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["hard_blockers", "role_fit", "role_fit_reason", "summary"],
      properties: {
        hard_blockers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["category", "candidate_conflict", "evidence", "confidence"],
            properties: {
              category: { type: "string", enum: [...FIT_CATEGORIES] },
              candidate_conflict: { type: "string" },
              evidence: { type: "string" },
              confidence: { type: "number" },
            },
          },
        },
        role_fit: { type: "number" },
        role_fit_reason: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
};

// ── Checking the reply ────────────────────────────────────────────────────

export function normalizeQuote(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The quote, split at "...", appears in the posting in order. */
export function evidenceInPosting(evidence: string, posting: string): boolean {
  const haystack = normalizeQuote(posting);
  const parts = normalizeQuote(evidence)
    .split(/\s*(?:\.{3,}|…)\s*/)
    .map((part) => part.replace(/^["']+|["'.]+$/g, "").trim())
    .filter(Boolean);
  if (!parts.length) return false;
  let from = 0;
  for (const part of parts) {
    if (part.length < EVIDENCE_MIN_FRAGMENT_CHARS) return false;
    const at = haystack.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

const OPTIONAL_WORDING =
  /\b(preferred|a plus|is a plus|nice to have|bonus|desired|desirable|ideally|advantage|helpful|optional|not required|asset)\b/i;
const CLEARANCE_OBTAINABLE =
  /\b(ab(le|ility) to (obtain|get|acquire|secure|be granted)|eligib(le|ility) (to obtain|for)|obtainable|clearable|willing(ness)? to (obtain|undergo))\b/i;
const ADVANCED_DEGREE =
  /\b(master'?s|m\.?sc\b|ph\.?\s?d\b|doctorate|doctoral|advanced degree|graduate degree|post[\s-]?graduate degree)/i;
const DEGREE_ESCAPE =
  /\b(preferred|a plus|nice to have|desired|ideally|bonus|or equivalent|equivalent (work |practical |professional )?experience|bachelor'?s?\s*(degree\s*)?(or|\/)|b\.?s\.?\s*(or|\/)|bs\/ms|or \d+\+? years)\b/i;

/** Why the quote does not state a hard requirement, or "" when it does. */
function softenedReason(category: string, evidence: string): string {
  if (category === "education") {
    if (!ADVANCED_DEGREE.test(evidence)) return "quote does not name a degree above a Bachelor's";
    if (DEGREE_ESCAPE.test(evidence)) return "degree is preferred or has an alternative";
  }
  if (category === "clearance") {
    if (CLEARANCE_OBTAINABLE.test(evidence)) return "clearance only needs to be obtainable";
    if (OPTIONAL_WORDING.test(evidence)) return "clearance is preferred, not required";
  }
  if (category === "language" && OPTIONAL_WORDING.test(evidence)) return "language is preferred, not required";
  return "";
}

/** Keeps only blockers the posting proves: allowed, quoted verbatim, named conflict, confident, truly mandatory. */
export function validateBlockers(blockers: FitBlocker[], posting: string) {
  const accepted: FitBlocker[] = [];
  const rejected: Array<FitBlocker & { why: string }> = [];
  for (const raw of blockers) {
    const blocker = {
      category: text(raw.category).toLowerCase(),
      candidate_conflict: text(raw.candidate_conflict),
      evidence: text(raw.evidence),
      confidence: Number(raw.confidence),
    };
    const why = !(FIT_CATEGORIES as readonly string[]).includes(blocker.category)
      ? "category not allowed"
      : blocker.evidence.length < BLOCKER_MIN_EVIDENCE_CHARS
        ? "no evidence quote"
        : !blocker.candidate_conflict
          ? "no named candidate conflict"
          : !Number.isFinite(blocker.confidence) || blocker.confidence < BLOCKER_MIN_CONFIDENCE
            ? "confidence below threshold"
            : !evidenceInPosting(blocker.evidence, posting)
              ? "quote not found in the posting"
              : softenedReason(blocker.category, blocker.evidence);
    if (why) rejected.push({ ...blocker, why });
    else accepted.push(blocker);
  }
  return { accepted, rejected };
}

/** The decision from the model's reply: a proven blocker, or too low a role fit, skips the job. */
export function decideFit(reply: FitModelReply, posting: string): FitResult {
  const { accepted, rejected } = validateBlockers(Array.isArray(reply.hard_blockers) ? reply.hard_blockers : [], posting);
  const score = Math.max(0, Math.min(100, Math.round(Number(reply.role_fit) || 0)));
  const summary = text(reply.summary);
  const base = { score, blockers: accepted, rejectedBlockers: rejected, summary };
  if (accepted.length) {
    const first = accepted[0];
    return { ...base, ok: false, reason: `${first.category}: "${first.evidence.slice(0, 120)}"` };
  }
  if (score < MIN_ROLE_FIT) {
    return { ...base, ok: false, reason: `Role fit ${score}: ${text(reply.role_fit_reason).slice(0, 160)}` };
  }
  return { ...base, ok: true, reason: summary };
}

/** The model call: the system and user prompt in, the parsed JSON reply out. */
export type FitModel = (messages: { system: string; user: string }) => Promise<FitModelReply>;

export async function checkJobFit(input: FitInput, model: FitModel): Promise<FitResult> {
  const posting = clipPosting(input.jobDescription);
  if (!posting) return { ok: false, score: 0, reason: "No job description", blockers: [], rejectedBlockers: [], summary: "" };
  const reply = await model({ system: FIT_SYSTEM_PROMPT, user: buildFitUserPrompt(input) });
  // Quotes are checked against the text the model read.
  return decideFit(reply, posting);
}
