/**
 * What resume generation needs from a profile's prompt kit, and the rules it
 * holds the kit to. Pure: no I/O, so the tests can run it directly.
 */

/** Top-level fields that are facts about the candidate, copied from the kit into every resume. */
export const LOCKED_TOP_LEVEL_FIELDS = [
  "schema_version",
  "resume_template",
  "template_name",
  "profile",
  "candidate",
  "email",
  "phone_number",
  "current_location",
  "work_authorization",
  "availability",
  "education",
  "placeholder_order",
] as const;

/** Fields of each work_experience.experience_N that are employment facts, copied from the kit. */
export const LOCKED_ROLE_FIELDS = [
  "company",
  "company_url",
  "location",
  "work_arrangement",
  "role_title",
  "start_date",
  "end_date",
  "date_range",
  "employment_type",
] as const;

/** Role facts that must be filled in the kit whenever the kit has the field. */
const REQUIRED_ROLE_FACTS: Array<{ key: (typeof LOCKED_ROLE_FIELDS)[number]; label: string }> = [
  { key: "company", label: "employer" },
  { key: "role_title", label: "job title" },
  { key: "work_arrangement", label: "work arrangement" },
];

export type KitRunMode = "verified_candidate" | "fictional_benchmark" | "unknown";

function extractJsonAfterLabel(text: string, label: string): unknown {
  const idx = text.search(new RegExp(`${label}["'\`]?\\s*:`, "i"));
  if (idx < 0) return null;
  const from = text.indexOf("{", idx);
  if (from < 0) return null;
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(from, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * The kit's run mode: run_settings.mode when the prompt has one; otherwise the
 * prompt's own stated default, so deleting run_settings does not change it.
 */
export function kitRunMode(promptTemplate: string): KitRunMode {
  const text = String(promptTemplate || "");
  const settings = extractJsonAfterLabel(text, "run_settings");
  const mode =
    settings && typeof settings === "object" ? String((settings as { mode?: unknown }).mode ?? "") : "";
  const stated = mode || (/default mode is\s*[`'"]?fictional/i.test(text) ? "fictional_benchmark" : "");
  if (/fictional/i.test(stated)) return "fictional_benchmark";
  if (/verified/i.test(stated)) return "verified_candidate";
  return "unknown";
}

export const PROMPT_RESUME_PLACEHOLDER = "{resume_template_json}";
export const PROMPT_JOB_PLACEHOLDER = "{job_description}";

export type GenerationReadiness = {
  ready: boolean;
  mode: KitRunMode;
  /** Why a profile's kit cannot generate resumes, in the order to fix them. */
  problems: string[];
};

/**
 * Whether a profile's prompt and resume JSON can generate resumes. The server
 * refuses kits that fail; the Resume Builder shows the same list while editing.
 */
export function generationReadiness(template: string, resumeTemplateJson: string): GenerationReadiness {
  const problems: string[] = [];
  const prompt = String(template || "");
  const mode = kitRunMode(prompt);

  if (!prompt.trim()) {
    problems.push("The prompt is empty.");
  } else {
    if (!prompt.includes(PROMPT_RESUME_PLACEHOLDER)) {
      problems.push(`The prompt has no ${PROMPT_RESUME_PLACEHOLDER}, so the model would not see the candidate's resume.`);
    }
    if (!prompt.includes(PROMPT_JOB_PLACEHOLDER)) {
      problems.push(`The prompt has no ${PROMPT_JOB_PLACEHOLDER}, so the model would not see the job.`);
    }
  }
  if (mode === "fictional_benchmark") {
    problems.push(
      "The prompt is in fictional_benchmark mode. Resume generation only runs in verified_candidate mode, with the candidate's real work history.",
    );
  }

  if (!String(resumeTemplateJson || "").trim()) {
    problems.push("The resume JSON is empty.");
  } else {
    const kit = parseKitResumeJson(resumeTemplateJson);
    if (!kit) problems.push("The resume JSON is not a valid JSON object.");
    else problems.push(...kitProblems(kit));
  }
  return { ready: problems.length === 0, mode, problems };
}

export function parseKitResumeJson(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** "text" of a placeholder object, or the string itself. */
export function fieldText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isRecord(value)) return String(value.text ?? "").trim();
  return "";
}

/** experience_1, experience_2, … in numeric order. */
export function experienceKeys(workExperience: unknown): string[] {
  if (!isRecord(workExperience)) return [];
  return Object.keys(workExperience)
    .filter((key) => /^experience_\d+$/.test(key) && isRecord(workExperience[key]))
    .sort((a, b) => Number(a.slice(11)) - Number(b.slice(11)));
}

/**
 * Why this kit cannot generate resumes, or [] when it can. Each role's
 * employer, title and arrangement must already be the candidate's own:
 * generation never fills them in.
 */
export function kitProblems(kit: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (!fieldText(kit.resume_template)) {
    problems.push('The kit\'s resume JSON has no "resume_template" (the json2docx template folder).');
  }
  const roles = experienceKeys(kit.work_experience);
  if (!roles.length) {
    problems.push("The kit's resume JSON has no work_experience.experience_N roles.");
  }
  const work = isRecord(kit.work_experience) ? kit.work_experience : {};
  for (const role of roles) {
    const entry = work[role] as Record<string, unknown>;
    for (const key of LOCKED_ROLE_FIELDS) {
      if (!(key in entry) || fieldText(entry[key])) continue;
      const required = REQUIRED_ROLE_FACTS.find((fact) => fact.key === key);
      // A printed placeholder (<<Company-Location-1>>) left blank would print empty.
      const printed = isRecord(entry[key]) && typeof (entry[key] as { placeholder?: unknown }).placeholder === "string";
      if (required || printed) {
        problems.push(
          `work_experience.${role}.${key} is blank: fill in the candidate's real ${required?.label ?? key.replace(/_/g, " ")} in the kit.`,
        );
      }
    }
  }
  return problems;
}
