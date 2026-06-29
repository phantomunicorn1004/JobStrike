const PLACEHOLDER_RESUME_TEMPLATE_JSON = "{resume_template_json}";
const PLACEHOLDER_JOB_DESCRIPTION = "{job_description}";

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
4. Maintain the original structure and format.
5. Ensure all content is truthful and accurate.

Return valid JSON only.`;
