/**
 * Per-profile prompt kit: server API (source of truth) + chrome.storage.local cache.
 */
(function (global) {
  'use strict';

  const KIT_PREFIX = 'promptKit_v1_';
  const BACKEND_URL_KEY = 'resume_db_backend_url';
  const EXTENSION_API_KEY_KEY = 'resume_db_extension_api_key';
  const LEGACY_API_KEY_KEY = 'resume_db_api_key';
  const DEFAULT_BACKEND = 'https://remote-work-helper.vercel.app';
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

  function normalizeBackendUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_BACKEND;
  }

  async function getRemoteAuth() {
    const result = await storageGet([
      BACKEND_URL_KEY,
      EXTENSION_API_KEY_KEY,
      LEGACY_API_KEY_KEY,
    ]);
    const extensionApiKey = String(
      result[EXTENSION_API_KEY_KEY] || result[LEGACY_API_KEY_KEY] || ''
    ).trim();
    if (!extensionApiKey) return null;
    return {
      baseUrl: normalizeBackendUrl(result[BACKEND_URL_KEY]),
      extensionApiKey,
    };
  }

  function localKitHasDraft(kit) {
    const defaults = emptyKit();
    return Boolean(
      trim(kit.resumeTemplateJson) ||
        trim(kit.jobDescription) ||
        trim(kit.output) ||
        trim(kit.template) !== trim(defaults.template)
    );
  }

  async function readLocalKit(profileId) {
    const key = kitStorageKey(profileId);
    const result = await storageGet([key]);
    const raw = result[key];
    if (!raw) return { kit: emptyKit(), exists: false };
    return { kit: normalizeKit(raw), exists: true };
  }

  /** Counts local writes from this panel so the storage listener can ignore them. */
  const ownKitWriteCounts = new Map();

  function markOwnKitWrite(profileId) {
    const key = kitStorageKey(profileId);
    ownKitWriteCounts.set(key, (ownKitWriteCounts.get(key) || 0) + 1);
  }

  function takeOwnKitWrite(storageKey) {
    const count = ownKitWriteCounts.get(storageKey) || 0;
    if (count <= 0) return false;
    if (count === 1) ownKitWriteCounts.delete(storageKey);
    else ownKitWriteCounts.set(storageKey, count - 1);
    return true;
  }

  function kitUpdatedMs(kit) {
    const ms = Date.parse(kit?.updatedAt || '');
    return Number.isFinite(ms) ? ms : 0;
  }

  function kitContentKey(kit) {
    const normalized = normalizeKit(kit);
    return [
      normalized.template,
      normalized.resumeTemplateJson,
      normalized.jobDescription,
      normalized.output,
    ].join('\u0001');
  }

  async function writeLocalKit(profileId, kit) {
    const next = normalizeKit(kit);
    markOwnKitWrite(profileId);
    await storageSet({ [kitStorageKey(profileId)]: next });
    return next;
  }

  async function fetchRemoteKit(profileId) {
    const auth = await getRemoteAuth();
    if (!auth) return { available: false, exists: false, kit: emptyKit() };

    const res = await fetch(`${auth.baseUrl}/api/profiles/${profileId}/prompt-kit`, {
      method: 'GET',
      headers: { 'X-Extension-Key': auth.extensionApiKey },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Failed to load prompt kit (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return {
      available: true,
      exists: Boolean(data.exists),
      kit: normalizeKit(data.kit || {}),
    };
  }

  async function putRemoteKit(profileId, kit) {
    const auth = await getRemoteAuth();
    if (!auth) throw new Error('Sign in under Settings to sync prompt kits.');

    const res = await fetch(`${auth.baseUrl}/api/profiles/${profileId}/prompt-kit`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': auth.extensionApiKey,
      },
      body: JSON.stringify({
        template: kit.template,
        resumeTemplateJson: kit.resumeTemplateJson,
        jobDescription: kit.jobDescription,
        output: kit.output,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to save prompt kit (${res.status})`);
    }
    return normalizeKit(data.kit || kit);
  }

  async function getPromptKitLocal(profileId) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1) {
      return { kit: emptyKit(), exists: false, source: 'empty' };
    }
    const local = await readLocalKit(id);
    return { ...local, source: local.exists ? 'local' : 'empty' };
  }

  /**
   * @param {string|number} profileId
   * @param {{ preferLocal?: boolean }} [options]
   */
  async function getPromptKit(profileId, options = {}) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1) {
      return { kit: emptyKit(), exists: false, source: 'empty' };
    }

    const local = await readLocalKit(id);
    if (options.preferLocal && local.exists) {
      return { kit: local.kit, exists: true, source: 'local' };
    }

    try {
      const remote = await fetchRemoteKit(id);
      if (!remote.available) {
        return { kit: local.kit, exists: local.exists, source: 'local' };
      }

      if (!remote.exists && local.exists && localKitHasDraft(local.kit)) {
        const seeded = await putRemoteKit(id, local.kit);
        const kept = normalizeKit({ ...local.kit, updatedAt: seeded.updatedAt || local.kit.updatedAt });
        if (kitContentKey(local.kit) !== kitContentKey(kept)) {
          await writeLocalKit(id, kept);
        }
        return { kit: local.kit, exists: true, source: 'local' };
      }

      if (remote.exists) {
        const localMs = local.exists ? kitUpdatedMs(local.kit) : 0;
        const remoteMs = kitUpdatedMs(remote.kit);
        const sameContent = local.exists && kitContentKey(local.kit) === kitContentKey(remote.kit);
        // A newer local draft wins. Never write an older website kit back over it.
        if (sameContent || (local.exists && localKitHasDraft(local.kit) && localMs >= remoteMs)) {
          return { kit: local.kit, exists: true, source: 'local' };
        }
        await writeLocalKit(id, remote.kit);
        return { kit: remote.kit, exists: true, source: 'remote' };
      }

      return { kit: emptyKit(), exists: false, source: 'empty' };
    } catch (_) {
      return { kit: local.kit, exists: local.exists, source: 'local' };
    }
  }

  /**
   * @param {string|number} profileId
   * @param {object} kit
   * @param {{ localOnly?: boolean, swallowRemoteError?: boolean }} [options]
   */
  async function savePromptKit(profileId, kit, options = {}) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1) {
      throw new Error('Select a profile first.');
    }

    const draft = normalizeKit({
      ...kit,
      updatedAt: new Date().toISOString(),
    });

    await writeLocalKit(id, draft);

    if (options.localOnly) {
      return draft;
    }

    try {
      const saved = await putRemoteKit(id, draft);
      // Keep the text we just saved. The response must not replace it with an older kit.
      const kept = normalizeKit({
        ...draft,
        updatedAt: saved.updatedAt || draft.updatedAt,
      });
      // Same text, but stamped by the server: later comparisons with the
      // account's copy then use one clock instead of this machine's.
      if (kept.updatedAt !== draft.updatedAt) {
        await writeLocalKit(id, kept);
      }
      return kept;
    } catch (err) {
      if (options.swallowRemoteError) {
        return draft;
      }
      throw err;
    }
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

  function resolveJobDescription({ noteText, kit }) {
    return resolveJobDescriptionForCompat({ noteText, kit, posting: null });
  }

  function resolveJobDescriptionForCompat({ noteText, kit, posting }) {
    // Non-empty Note always wins (plain paste OK — no ## headers required).
    // Do not prepend stale scrape excerpts onto user paste.
    const note = trim(noteText);
    if (note) return note;
    const fromPosting = trim(posting?.rawFullText);
    if (fromPosting) return fromPosting;
    const excerpt = trim(posting?.compatExcerptText);
    if (excerpt) return excerpt;
    return trim(kit?.jobDescription);
  }

  function resolveJobDescriptionForResume({ noteText, kit, posting }) {
    // Non-empty Note always wins over last scrape's resumePromptText.
    const note = trim(noteText);
    if (note) {
      if (typeof SmartJobPostingIngest !== 'undefined') {
        const split = SmartJobPostingIngest.splitJobDescription(note);
        const resume = trim(split.resumePromptText);
        if (resume && resume.length >= note.length * 0.35) return resume;
      }
      return note;
    }
    const fromPosting = trim(posting?.resumePromptText);
    if (fromPosting) return fromPosting;
    const rawPosting = trim(posting?.rawFullText);
    if (rawPosting) {
      if (typeof SmartJobPostingIngest !== 'undefined') {
        const split = SmartJobPostingIngest.splitJobDescription(rawPosting);
        return trim(split.resumePromptText) || rawPosting;
      }
      return rawPosting;
    }
    const kitJd = trim(kit?.jobDescription);
    if (kitJd && typeof SmartJobPostingIngest !== 'undefined') {
      const split = SmartJobPostingIngest.splitJobDescription(kitJd);
      return trim(split.resumePromptText) || kitJd;
    }
    return kitJd;
  }

  global.SmartJobPromptKit = {
    DEFAULT_PROMPT_TEMPLATE,
    emptyKit,
    normalizeKit,
    getPromptKit,
    getPromptKitLocal,
    savePromptKit,
    takeOwnKitWrite,
    buildPrompt,
    kitStatusSummary,
    resolveJobDescription,
    resolveJobDescriptionForCompat,
    resolveJobDescriptionForResume,
    kitStorageKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
