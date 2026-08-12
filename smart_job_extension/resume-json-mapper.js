/**
 * Map built resume JSON → Register / Resume DB draft fields.
 * Prefer top-level job_title, company_name, job_description, resume_template.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SmartJobResumeJsonMapper = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  function nestedText(obj, path) {
    let cur = obj;
    for (const key of path) {
      if (!cur || typeof cur !== 'object') return '';
      cur = cur[key];
    }
    if (typeof cur === 'string') return trim(cur);
    if (cur && typeof cur === 'object' && 'text' in cur) return trim(cur.text);
    return '';
  }

  function companyFromJson(data) {
    if (!data || typeof data !== 'object') return '';
    const top = data.company_name;
    if (typeof top === 'string' && trim(top)) return trim(top);
    if (top && typeof top === 'object' && trim(top.text)) return trim(top.text);
    return (
      nestedText(data, ['cover_letter', 'company_name']) ||
      nestedText(data, ['company']) ||
      ''
    );
  }

  function jobTitleFromJson(data) {
    if (!data || typeof data !== 'object') return '';
    return (
      trim(data.job_title) ||
      nestedText(data, ['profile_title']) ||
      nestedText(data, ['jobTitle']) ||
      ''
    );
  }

  function jobDescriptionFromJson(data) {
    if (!data || typeof data !== 'object') return '';
    return (
      trim(data.job_description) ||
      trim(data.jobDescription) ||
      nestedText(data, ['job_description']) ||
      ''
    );
  }

  function resumeTemplateFromJson(data) {
    if (!data || typeof data !== 'object') return '';
    return trim(data.resume_template) || trim(data.resumeTemplate) || '';
  }

  /**
   * @param {object} data parsed resume JSON
   * @returns {{
   *   jobTitle: string,
   *   companyName: string,
   *   jobDescription: string,
   *   resumeTemplate: string,
   *   hasRegisterFields: boolean
   * }}
   */
  function extractRegisterFieldsFromResumeJson(data) {
    const jobTitle = jobTitleFromJson(data);
    const companyName = companyFromJson(data);
    const jobDescription = jobDescriptionFromJson(data);
    const resumeTemplate = resumeTemplateFromJson(data);
    return {
      jobTitle,
      companyName,
      jobDescription,
      resumeTemplate,
      hasRegisterFields: Boolean(jobTitle || companyName || jobDescription),
    };
  }

  /**
   * Parse raw paste text into a JSON object (supports fenced/extra prose around JSON).
   * @param {string} text
   * @returns {{ ok: true, data: object } | { ok: false, error: string }}
   */
  function parseResumeJsonText(text) {
    const raw = trim(text);
    if (!raw) return { ok: false, error: 'Empty JSON' };

    const tryParse = (s) => {
      const data = JSON.parse(s);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('JSON must be an object');
      }
      return data;
    };

    try {
      return { ok: true, data: tryParse(raw) };
    } catch (_) {
      // continue
    }

    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fenced?.[1]) {
      try {
        return { ok: true, data: tryParse(fenced[1].trim()) };
      } catch (_) {
        // continue
      }
    }

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return { ok: true, data: tryParse(raw.slice(start, end + 1)) };
      } catch (err) {
        return { ok: false, error: err.message || 'Invalid JSON' };
      }
    }

    return { ok: false, error: 'Invalid JSON' };
  }

  /**
   * @param {string} text
   * @returns {{
   *   ok: boolean,
   *   error?: string,
   *   fields?: ReturnType<typeof extractRegisterFieldsFromResumeJson>,
   *   data?: object
   * }}
   */
  function extractRegisterFieldsFromResumeJsonText(text) {
    const parsed = parseResumeJsonText(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const fields = extractRegisterFieldsFromResumeJson(parsed.data);
    return { ok: true, fields, data: parsed.data };
  }

  return {
    extractRegisterFieldsFromResumeJson,
    extractRegisterFieldsFromResumeJsonText,
    parseResumeJsonText,
  };
});
