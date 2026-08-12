/**
 * Per-profile prompt kit (chrome.storage.local) + Build & Copy helpers.
 * Mirrors website Resume Builder localStorage shape (not shared across origins).
 */
(function (global) {
  'use strict';

  const KIT_PREFIX = 'promptKit_v1_';
  const PLACEHOLDER_RESUME_TEMPLATE_JSON = '{resume_template_json}';
  const PLACEHOLDER_JOB_DESCRIPTION = '{job_description}';

  const DEFAULT_PROMPT_TEMPLATE = `You are an expert resume writer specializing in ATS optimization.

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

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  function kitStorageKey(profileId) {
    return `${KIT_PREFIX}${profileId}`;
  }

  function emptyKit(overrides) {
    return Object.assign(
      {
        template: DEFAULT_PROMPT_TEMPLATE,
        resumeTemplateJson: '',
        jobDescription: '',
        output: '',
        updatedAt: null,
      },
      overrides || {}
    );
  }

  function normalizeKit(raw) {
    if (!raw || typeof raw !== 'object') return emptyKit();
    return emptyKit({
      template:
        typeof raw.template === 'string' && raw.template.length
          ? raw.template
          : DEFAULT_PROMPT_TEMPLATE,
      resumeTemplateJson:
        typeof raw.resumeTemplateJson === 'string' ? raw.resumeTemplateJson : '',
      jobDescription:
        typeof raw.jobDescription === 'string' ? raw.jobDescription : '',
      output: typeof raw.output === 'string' ? raw.output : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, resolve);
    });
  }

  async function getPromptKit(profileId) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1) {
      return { kit: emptyKit(), exists: false };
    }
    const key = kitStorageKey(id);
    const result = await storageGet([key]);
    const raw = result[key];
    if (!raw) return { kit: emptyKit(), exists: false };
    return { kit: normalizeKit(raw), exists: true };
  }

  async function savePromptKit(profileId, kit) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1) {
      throw new Error('Select a profile first.');
    }
    const next = normalizeKit({
      ...kit,
      updatedAt: new Date().toISOString(),
    });
    await storageSet({ [kitStorageKey(id)]: next });
    return next;
  }

  function buildPrompt(template, resumeTemplateJson, jobDescription) {
    const missingPlaceholders = [];
    const resumeValue = resumeTemplateJson ?? '';
    const jobDescriptionValue = jobDescription ?? '';
    const tpl = template ?? '';

    if (tpl.includes(PLACEHOLDER_RESUME_TEMPLATE_JSON) && !trim(resumeValue)) {
      missingPlaceholders.push(PLACEHOLDER_RESUME_TEMPLATE_JSON);
    }
    if (tpl.includes(PLACEHOLDER_JOB_DESCRIPTION) && !trim(jobDescriptionValue)) {
      missingPlaceholders.push(PLACEHOLDER_JOB_DESCRIPTION);
    }

    const prompt = tpl
      .split(PLACEHOLDER_RESUME_TEMPLATE_JSON)
      .join(resumeValue)
      .split(PLACEHOLDER_JOB_DESCRIPTION)
      .join(jobDescriptionValue);

    return { prompt, missingPlaceholders };
  }

  function kitStatusSummary(kit, exists) {
    if (!exists) return 'No saved kit — using default template. Edit kit to add resume JSON.';
    const parts = [];
    if (trim(kit.resumeTemplateJson)) parts.push('resume JSON set');
    else parts.push('resume JSON empty');
    if (kit.updatedAt) {
      try {
        parts.push(`saved ${new Date(kit.updatedAt).toLocaleString()}`);
      } catch (_) {
        /* ignore */
      }
    }
    return parts.join(' · ');
  }

  /**
   * Resolve JD for build: live Register Note wins, then kit.jobDescription.
   */
  function resolveJobDescription({ noteText, kit }) {
    const note = trim(noteText);
    if (note) return note;
    return trim(kit?.jobDescription);
  }

  global.SmartJobPromptKit = {
    DEFAULT_PROMPT_TEMPLATE,
    emptyKit,
    normalizeKit,
    getPromptKit,
    savePromptKit,
    buildPrompt,
    kitStatusSummary,
    resolveJobDescription,
    kitStorageKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
