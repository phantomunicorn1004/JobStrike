/**
 * Turn a model's built resume JSON into the one that is saved: the kit's
 * facts put back, the target job set, and every placeholder checked. The same
 * for the ChatGPT tab and the API, so both engines produce identical shapes.
 * Pure: no I/O.
 */

import {
  LOCKED_ROLE_FIELDS,
  LOCKED_TOP_LEVEL_FIELDS,
  experienceKeys,
  fieldText,
  isRecord,
  kitProblems,
} from "@/lib/autogen/kit";

export type FinalizeTarget = {
  jobTitle: string;
  company: string;
  jobDescription: string;
};

export type FinalizeInput = {
  built: unknown;
  kit: Record<string, unknown>;
  target: FinalizeTarget;
  /** Cover letter date, e.g. "October 29, 2026". */
  todayText: string;
};

export type FinalizeResult = {
  ok: boolean;
  resume: Record<string, unknown> | null;
  /** Reasons the answer cannot be used; a retry may fix them. */
  errors: string[];
  /** Fixed automatically; kept for the generation log. */
  warnings: string[];
  /** Kit facts the model had changed, put back (JSON paths). */
  restored: string[];
};

const LEFTOVER = /<<[^<>]+>>|\{resume_template_json\}|\{job_description\}/;

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type PlaceholderEntry = { path: string; obj: Record<string, unknown> };

/** Every {placeholder, text, …} object, keyed by its placeholder ("<<Summary>>"). */
export function placeholderEntries(root: unknown): Map<string, PlaceholderEntry> {
  const found = new Map<string, PlaceholderEntry>();
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (!isRecord(node)) return;
    const placeholder = typeof node.placeholder === "string" ? node.placeholder.trim() : "";
    if (placeholder && !found.has(placeholder)) found.set(placeholder, { path, obj: node });
    for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
  };
  walk(root, "");
  return found;
}

/** Sets text on a placeholder object or replaces a plain string field. */
function setFieldText(parent: Record<string, unknown>, key: string, text: string) {
  const current = parent[key];
  if (isRecord(current)) current.text = text;
  else if (current !== undefined) parent[key] = text;
}

export function finalizeBuiltResume({ built, kit, target, todayText }: FinalizeInput): FinalizeResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const restored: string[] = [];

  const kitIssues = kitProblems(kit);
  if (kitIssues.length) {
    return { ok: false, resume: null, errors: kitIssues.map((p) => `Kit: ${p}`), warnings, restored };
  }
  if (!isRecord(built)) {
    return { ok: false, resume: null, errors: ["The answer is not a JSON object."], warnings, restored };
  }

  const resume = clone(built);

  // 1. Candidate facts come from the kit, whatever the model wrote.
  for (const key of LOCKED_TOP_LEVEL_FIELDS) {
    if (!(key in kit)) continue;
    if (key in resume && !same(resume[key], kit[key])) restored.push(key);
    resume[key] = clone(kit[key]);
  }

  // 2. So do the employment facts of every role.
  if (!isRecord(resume.work_experience)) resume.work_experience = {};
  const resumeWork = resume.work_experience as Record<string, unknown>;
  const kitWork = kit.work_experience as Record<string, unknown>;
  for (const role of experienceKeys(kitWork)) {
    const kitRole = kitWork[role] as Record<string, unknown>;
    const builtRole = resumeWork[role];
    if (!isRecord(builtRole)) {
      errors.push(`The answer has no work_experience.${role}.`);
      continue;
    }
    for (const field of LOCKED_ROLE_FIELDS) {
      if (!(field in kitRole)) continue;
      if (field in builtRole && !same(builtRole[field], kitRole[field])) {
        restored.push(`work_experience.${role}.${field}`);
      }
      builtRole[field] = clone(kitRole[field]);
    }
  }
  const extraRoles = experienceKeys(resumeWork).filter((role) => !(role in kitWork));
  for (const role of extraRoles) {
    delete resumeWork[role];
    warnings.push(`Removed work_experience.${role}, which the kit does not have.`);
  }

  // 3. The target job, as registered (not as the model read it).
  if (target.jobTitle.trim()) resume.job_title = target.jobTitle.trim();
  if (target.company.trim()) resume.company_name = target.company.trim();
  if (target.jobDescription.trim()) resume.job_description = target.jobDescription.trim();
  if (isRecord(resume.cover_letter)) {
    const letter = resume.cover_letter;
    if ("today_date" in letter) setFieldText(letter, "today_date", todayText);
    if ("company_name" in letter && target.company.trim()) {
      setFieldText(letter, "company_name", target.company.trim());
    }
  }
  for (const key of ["job_title", "company_name"] as const) {
    if (!fieldText(resume[key])) errors.push(`The answer has no ${key}.`);
  }

  // 4. Every placeholder of the kit is present, filled and printable.
  const kitPlaceholders = placeholderEntries(kit);
  const resumePlaceholders = placeholderEntries(resume);
  for (const [placeholder, { path }] of kitPlaceholders) {
    const entry = resumePlaceholders.get(placeholder);
    if (!entry) {
      errors.push(`${placeholder} is missing (kit path ${path}).`);
      continue;
    }
    const text = typeof entry.obj.text === "string" ? entry.obj.text : "";
    if (!text.trim()) errors.push(`${placeholder} is empty.`);
    else if (LEFTOVER.test(text)) errors.push(`${placeholder} still contains an unfilled placeholder.`);
  }

  // 5. Bold words must appear verbatim (json2docx bolds exact, case-sensitive matches).
  let droppedBold = 0;
  for (const { obj } of resumePlaceholders.values()) {
    if (!("bold_words" in obj)) continue;
    const text = typeof obj.text === "string" ? obj.text : "";
    const words = Array.isArray(obj.bold_words) ? obj.bold_words : [];
    const kept = [
      ...new Set(words.map((w) => String(w ?? "")).filter((w) => w.trim() && text.includes(w))),
    ];
    droppedBold += words.length - kept.length;
    obj.bold_words = kept;
  }
  if (droppedBold) warnings.push(`Dropped ${droppedBold} bold word(s) not found in their text.`);
  if (restored.length) warnings.push(`Put back ${restored.length} kit fact(s) the answer had changed.`);

  return errors.length
    ? { ok: false, resume: null, errors, warnings, restored }
    : { ok: true, resume, errors, warnings, restored };
}

/** "October 29, 2026" in the user's time zone. */
export function coverLetterDate(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
}
