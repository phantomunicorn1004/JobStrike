/**
 * Bridge: website Resume Builder ↔ extension prompt kits (chrome.storage.local).
 * Listens for window.postMessage from the same origin page.
 */
(function () {
  'use strict';

  const SOURCE = 'rwh-resume-builder';
  const KIT_PREFIX = 'promptKit_v1_';
  const WEBSITE_KIT_PREFIX = 'resumeBuilder_promptKit_v1_';

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

  function isLikelyAppOrigin() {
    const host = String(location.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.endsWith('.vercel.app')) return true;
    return false;
  }

  if (!isLikelyAppOrigin()) return;

  function kitStorageKey(profileId) {
    return `${KIT_PREFIX}${profileId}`;
  }

  function websiteKitStorageKey(profileId) {
    return `${WEBSITE_KIT_PREFIX}${profileId}`;
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

  function reply(payload) {
    window.postMessage(
      Object.assign({ source: SOURCE }, payload),
      window.location.origin
    );
  }

  function mirrorToWebsiteLocalStorage(profileId, kit) {
    try {
      localStorage.setItem(websiteKitStorageKey(profileId), JSON.stringify(kit));
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  async function handleSave(data) {
    const profileId = Number(data.profileId);
    const requestId = data.requestId;
    if (!Number.isFinite(profileId) || profileId < 1) {
      reply({
        type: 'prompt-kit-save-result',
        requestId,
        ok: false,
        error: 'Invalid profile id.',
      });
      return;
    }
    try {
      const next = normalizeKit({
        ...data.kit,
        updatedAt: new Date().toISOString(),
      });
      await storageSet({ [kitStorageKey(profileId)]: next });
      mirrorToWebsiteLocalStorage(profileId, next);
      reply({
        type: 'prompt-kit-save-result',
        requestId,
        ok: true,
        kit: next,
      });
    } catch (err) {
      reply({
        type: 'prompt-kit-save-result',
        requestId,
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  async function handleGet(data) {
    const profileId = Number(data.profileId);
    const requestId = data.requestId;
    if (!Number.isFinite(profileId) || profileId < 1) {
      reply({
        type: 'prompt-kit-get-result',
        requestId,
        ok: false,
        exists: false,
        error: 'Invalid profile id.',
      });
      return;
    }
    try {
      const key = kitStorageKey(profileId);
      const result = await storageGet([key]);
      const raw = result[key];
      if (!raw) {
        reply({
          type: 'prompt-kit-get-result',
          requestId,
          ok: true,
          exists: false,
          kit: emptyKit(),
        });
        return;
      }
      const kit = normalizeKit(raw);
      reply({
        type: 'prompt-kit-get-result',
        requestId,
        ok: true,
        exists: true,
        kit,
      });
    } catch (err) {
      reply({
        type: 'prompt-kit-get-result',
        requestId,
        ok: false,
        exists: false,
        error: err?.message || String(err),
      });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin && event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'prompt-kit-save') {
      void handleSave(data);
      return;
    }
    if (data.type === 'prompt-kit-get') {
      void handleGet(data);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!String(location.pathname || '').includes('/resume-builder')) return;

    Object.keys(changes).forEach((key) => {
      if (!key.startsWith(KIT_PREFIX)) return;
      const profileId = Number(key.slice(KIT_PREFIX.length));
      if (!Number.isFinite(profileId) || profileId < 1) return;
      const change = changes[key];
      if (!change || change.newValue == null) return;
      const kit = normalizeKit(change.newValue);
      mirrorToWebsiteLocalStorage(profileId, kit);
      reply({
        type: 'prompt-kit-changed',
        profileId,
        kit,
      });
    });
  });
})();
