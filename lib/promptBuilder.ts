const PLACEHOLDER_RESUME_TEMPLATE_JSON = "{resume_template_json}";
const PLACEHOLDER_JOB_DESCRIPTION = "{job_description}";

/** Top-level fields the extension / json2docx / Resume DB draft expect on built resume JSON. */
export const REQUIRED_BUILT_RESUME_JSON_FIELDS = [
  "resume_template",
  "job_title",
  "company_name",
  "job_description",
] as const;

export type RequiredBuiltResumeJsonField =
  (typeof REQUIRED_BUILT_RESUME_JSON_FIELDS)[number];

export type BuildPromptResult = {
  prompt: string;
  missingPlaceholders: string[];
};

export function buildPrompt(
  template: string,
  resumeTemplateJson: string,
  jobDescription: string,
): BuildPromptResult {
  const missingPlaceholders: string[] = [];
  const resumeValue = resumeTemplateJson ?? "";
  const jobDescriptionValue = jobDescription ?? "";

  if (template.includes(PLACEHOLDER_RESUME_TEMPLATE_JSON) && !resumeValue.trim()) {
    missingPlaceholders.push(PLACEHOLDER_RESUME_TEMPLATE_JSON);
  }
  if (template.includes(PLACEHOLDER_JOB_DESCRIPTION) && !jobDescriptionValue.trim()) {
    missingPlaceholders.push(PLACEHOLDER_JOB_DESCRIPTION);
  }

  const prompt = template
    .split(PLACEHOLDER_RESUME_TEMPLATE_JSON)
    .join(resumeValue)
    .split(PLACEHOLDER_JOB_DESCRIPTION)
    .join(jobDescriptionValue);

  return { prompt, missingPlaceholders };
}

/**
 * Returns which required top-level registration/generation fields are missing
 * from a built resume JSON object (or parsed paste).
 */
export function getMissingBuiltResumeJsonFields(
  data: unknown,
): RequiredBuiltResumeJsonField[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [...REQUIRED_BUILT_RESUME_JSON_FIELDS];
  }
  const obj = data as Record<string, unknown>;
  return REQUIRED_BUILT_RESUME_JSON_FIELDS.filter((key) => {
    const value = obj[key];
    if (typeof value === "string") return !value.trim();
    if (value && typeof value === "object" && "text" in (value as object)) {
      return !String((value as { text?: unknown }).text ?? "").trim();
    }
    return value == null || value === "";
  });
}

export const PROMPT_BUILDER_STORAGE_KEYS = {
  template: "promptBuilder_template",
  resumeTemplateJson: "promptBuilder_resumeTemplateJson",
  jobDescription: "promptBuilder_jobDescription",
  output: "promptBuilder_output",
} as const;

export const DEFAULT_PROMPT_TEMPLATE = `You are an expert resume writer specializing in ATS optimization.

Job Description:
{job_description}

Current resume (JSON):
{resume_template_json}

Instructions:
1. Analyze the job description to identify key skills, technologies, and requirements.
2. Tailor the resume JSON to highlight relevant experience and achievements.
3. Use keywords from the job description naturally throughout the resume.
4. Maintain the original structure, placeholders, and format of the input resume JSON.
5. Ensure all content is truthful and accurate.
6. You MUST include these top-level string fields on the output JSON (used by Resume DB + local DOCX generation):
   - "resume_template": DOCX template folder name under resume_template/ (copy from input JSON if present; examples: "Jose", "Oscar")
   - "job_title": the target job title from the job description
   - "company_name": the hiring company name from the job description
   - "job_description": the full job description text provided above (or a faithful copy suitable for application notes)
7. Also keep resume_filename / cover_letter_filename (or section filenames) so generated files are named clearly.
8. Do not omit placeholder objects (placeholder / text / bold_words) required by the resume template.

Return valid JSON only. No markdown fences, no commentary.`;
