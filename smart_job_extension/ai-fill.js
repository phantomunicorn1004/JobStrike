// OpenAI-assisted field value generation for Smart Job Autofill Assistant.
(function (root) {
  'use strict';

  const DEFAULT_MODEL = 'gpt-4o-mini';

  function trim(s) {
    return String(s || '').trim();
  }

  function summarizeWorkExperience(kit) {
    if (!kit || !Array.isArray(kit.workExperience) || !kit.workExperience.length) return '';
    return kit.workExperience
      .slice(0, 6)
      .map((role, i) => {
        const title = trim(role.role_title || role.title || `Role ${i + 1}`);
        const bullets = (role.role_bullets || role.bullets || [])
          .map((b) => trim(b))
          .filter(Boolean)
          .slice(0, 4);
        return `${title}${bullets.length ? `\n  - ${bullets.join('\n  - ')}` : ''}`;
      })
      .join('\n\n');
  }

  function summarizeCustomQuestions(questions, limit) {
    const max = limit || 12;
    const items = (questions || []).slice(0, max);
    if (!items.length) return '';
    return items
      .map((q) => {
        const title = trim(q.title || q.questionPatterns?.[0] || 'Question');
        const answer = trim(q.answer || '');
        return answer ? `Q: ${title}\nA: ${answer}` : `Q: ${title}\nA: (no saved answer)`;
      })
      .join('\n\n');
  }

  function buildCandidateContext(profile, questions, kit, jobInfo) {
    const p = profile || {};
    const lines = [];
    const push = (label, val) => {
      const v = trim(val);
      if (v) lines.push(`${label}: ${v}`);
    };
    push('Name', p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' '));
    push('Preferred name', p.preferredName);
    push('Suffix', p.suffixName);
    push('Email', p.email);
    push('Date of birth', p.dateOfBirth);
    push('Phone', p.phone);
    push('Location', p.location || [p.city, p.state, p.country].filter(Boolean).join(', '));
    push('Address', p.address);
    push('Address line 2', p.addressLine2);
    push('Address line 3', p.addressLine3);
    push('Postal code', p.zip);
    push('LinkedIn', p.linkedin);
    push('GitHub', p.github);
    push('Portfolio', p.portfolio);
    push('Current title', p.currentTitle);
    push('Current company', p.currentCompany);
    push('Years of experience', p.yearsOfExperience);
    push('Education', p.highestEducation);
    push('Degree', p.degree);
    push('Major', p.major);
    push('School', p.school);
    push('GPA', p.gpa);
    if (p.educationStartMonth || p.educationStartYear) {
      push('Education start', [p.educationStartMonth, p.educationStartYear].filter(Boolean).join(' '));
    }
    if (p.educationEndMonth || p.educationEndYear || p.graduationYear) {
      push('Education end', [p.educationEndMonth, p.educationEndYear || p.graduationYear].filter(Boolean).join(' '));
    }
    push('Graduation year', p.graduationYear || p.educationEndYear);
    push('Work authorization (US)', p.workAuthorizationUS || p.workAuthorization);
    push('Work authorization (Canada)', p.workAuthorizationCanada);
    push('Work authorization (UK)', p.workAuthorizationUK);
    push('Sponsorship', p.sponsorshipRequirement);
    push('LGBTQ+', p.lgbtqIdentity);
    push('Desired salary', p.desiredSalary);
    push('Notice period', p.noticePeriod);
    push('Remote preference', p.remotePreference);
    push('Relocation', p.relocationPreference);
    push('Gender (EEO)', p.gender);
    push('Gender identity', p.genderIdentity);
    push('Sexual orientation', p.sexualOrientation);
    push('Race / ethnicity', p.race);
    push('Hispanic / Latino', p.hispanicLatino);
    push('Transgender', p.transgender);
    push('Veteran status', p.veteranStatus);
    push('Disability status', p.disabilityStatus);

    const work = summarizeWorkExperience(kit);
    const custom = summarizeCustomQuestions(questions);
    const job = jobInfo || {};
    const jobLines = [];
    if (trim(job.job_title)) jobLines.push(`Job title: ${trim(job.job_title)}`);
    if (trim(job.company_name)) jobLines.push(`Company: ${trim(job.company_name)}`);

    return [
      jobLines.length ? `## Job posting\n${jobLines.join('\n')}` : '',
      lines.length ? `## Candidate profile\n${lines.join('\n')}` : '',
      work ? `## Work experience (default kit)\n${work}` : '',
      custom ? `## Saved custom Q&A\n${custom}` : ''
    ].filter(Boolean).join('\n\n');
  }

  function buildFieldUserPrompt(field, row) {
    const question = trim(
      field.questionText || field.labelText || field.nearbyText || field.placeholder || field.name || 'Unknown field'
    );
    const fieldType = trim(field.fieldType || field.inputType || 'text');
    const category = trim(field.fieldCategory || 'unknown');
    const options = Array.isArray(field.options) ? field.options.filter(Boolean) : [];
    const currentValue = trim(row?.suggestedValue || '');

    const parts = [
      `## Form field`,
      `Question / label: ${question}`,
      `Detected category: ${category}`,
      `Widget type: ${fieldType}`,
      currentValue ? `Current draft value in panel: ${currentValue}` : 'Current draft value: (empty)'
    ];

    if (options.length) {
      parts.push(`Allowed options (pick exactly one when applicable):\n${options.map((o) => `- ${o}`).join('\n')}`);
    } else if (field.isCombobox || /combobox|dropdown|select|yes-no|radio|checkbox/.test(fieldType)) {
      parts.push('Note: options may appear when the control opens; answer with the best likely choice text.');
    }

  if (fieldType === 'file' || category === 'resume_upload' || category === 'cover_letter_upload') {
      parts.push('This is a file upload field. Return JSON {"value":""} — files are handled separately.');
    }

    parts.push('\nReturn JSON only: {"value":"your answer"}');
    return parts.join('\n');
  }

  function parseAiJson(content) {
    const raw = trim(content);
    if (!raw) throw new Error('OpenAI returned an empty response.');
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.value === 'string') return trim(parsed.value);
      if (typeof parsed === 'string') return trim(parsed);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed.value === 'string') return trim(parsed.value);
      }
    }
    throw new Error('Could not parse AI response as JSON.');
  }

  async function suggestFieldValue(apiKey, model, field, row, contextBlock) {
    const key = trim(apiKey);
    if (!key) throw new Error('OpenAI API key is not set.');

    const system = [
      'You help complete job application form fields accurately.',
      'Use ONLY facts from the candidate profile, work experience, and saved answers provided.',
      'Do not invent employers, degrees, or credentials.',
      'For multiple-choice fields, the "value" must exactly match one listed option when options are given.',
      'For yes/no questions, answer with Yes or No unless options specify otherwise.',
      'Keep answers concise (one short paragraph or a few words unless a textarea needs more).',
      'Respond with valid JSON only: {"value":"..."}.'
    ].join(' ');

    const user = `${contextBlock}\n\n${buildFieldUserPrompt(field, row)}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: trim(model) || DEFAULT_MODEL,
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data?.error?.message || `OpenAI API error (${response.status})`;
      if (response.status === 401) {
        throw new Error('Invalid OpenAI API key. Check the key in Settings → AI autofill.');
      }
      if (response.status === 403) {
        throw new Error('OpenAI rejected this request. Verify your API key and billing.');
      }
      if (response.status === 429) {
        throw new Error('OpenAI rate limit reached. Wait a moment and try again.');
      }
      throw new Error(msg);
    }

    const content = data?.choices?.[0]?.message?.content;
    return parseAiJson(content);
  }

  root.SmartJobAiFill = {
    DEFAULT_MODEL,
    buildCandidateContext,
    buildFieldUserPrompt,
    suggestFieldValue
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
