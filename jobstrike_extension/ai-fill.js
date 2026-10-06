// OpenAI-compatible chat completions for JobStrike (OpenAI, Model Gate, etc.).
(function (root) {
  'use strict';

  const DEFAULT_MODEL = 'gpt-4o-mini';
  const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

  function trim(s) {
    return String(s || '').trim();
  }

  /** Normalize to …/v1 so callers can pass host root or /v1. */
  function normalizeChatBaseUrl(value) {
    let base = trim(value) || DEFAULT_BASE_URL;
    base = base.replace(/\/+$/, '');
    if (!/\/v1$/i.test(base)) base = `${base}/v1`;
    return base;
  }

  function chatCompletionsUrl(baseUrl) {
    return `${normalizeChatBaseUrl(baseUrl)}/chat/completions`;
  }

  function providerErrorMessage(status, data, baseUrl) {
    const msg = data?.error?.message || `API error (${status})`;
    const viaGateway = !/api\.openai\.com/i.test(String(baseUrl || ''));
    if (status === 401) {
      return viaGateway
        ? 'Invalid API key. Check the key and base URL in Settings → AI autofill.'
        : 'Invalid OpenAI API key. Check the key in Settings → AI autofill.';
    }
    if (status === 403) {
      return 'API rejected this request. Verify your API key, billing, and base URL.';
    }
    if (status === 429) {
      return 'API rate limit reached. Wait a moment and try again.';
    }
    return msg;
  }

  const DEFAULT_TIMEOUT_MS = 60000;

  /** Reasoning models reject a custom temperature. */
  function isReasoningModel(model) {
    return /^(o\d|gpt-5)/i.test(trim(model));
  }

  async function chatCompletion(apiKey, {
    model,
    messages,
    temperature,
    responseFormat,
    baseUrl,
    timeoutMs,
  } = {}) {
    const key = trim(apiKey);
    if (!key) throw new Error('API key is not set.');
    const endpoint = chatCompletionsUrl(baseUrl);
    const body = {
      model: trim(model) || DEFAULT_MODEL,
      messages: messages || [],
    };
    if (!isReasoningModel(body.model)) {
      body.temperature = typeof temperature === 'number' ? temperature : 0.35;
    }
    if (responseFormat) body.response_format = responseFormat;

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('AI request timed out. Try again.');
      }
      throw error;
    }

    const data = await response.json().catch((error) => {
      // The timeout also covers reading the body; say so instead of "could not parse".
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('AI request timed out. Try again.');
      }
      return {};
    });
    if (!response.ok) {
      throw new Error(providerErrorMessage(response.status, data, endpoint));
    }
    return data;
  }

  function summarizeWorkExperience(kit) {
    if (!kit || !Array.isArray(kit.workExperience) || !kit.workExperience.length) return '';
    return kit.workExperience
      .slice(0, 6)
      .map((role, i) => {
        const title = trim(role.role_title || role.title || `Role ${i + 1}`);
        const employer = trim(role.employer_name || '');
        const header = employer && !new RegExp(`\\bat\\s+${employer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title)
          ? `${title} — ${employer}`
          : title;
        const dates = [trim(role.start_date), trim(role.end_date || (role.is_current ? 'Present' : ''))]
          .filter(Boolean)
          .join(' – ');
        const bullets = (role.role_bullets || role.bullets || [])
          .map((b) => trim(b))
          .filter(Boolean)
          .slice(0, 6);
        const lines = [header + (dates ? ` (${dates})` : '')];
        if (bullets.length) lines.push(...bullets.map((b) => `  - ${b}`));
        return lines.join('\n');
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
    push('Citizenship', p.citizenship);
    push('Active security clearance', p.securityClearance);
    push('Spoken languages', p.languages);
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
    push('How they heard about the job', p.howDidYouHear);
    const extraFacts = trim(p.extraFacts);

    const work = summarizeWorkExperience(kit);
    const experienceLabel = trim(kit?.sourceLabel) || 'Work experience';
    const custom = summarizeCustomQuestions(questions);
    const job = jobInfo || {};
    const jobLines = [];
    if (trim(job.job_title)) jobLines.push(`Job title: ${trim(job.job_title)}`);
    if (trim(job.company_name)) jobLines.push(`Company: ${trim(job.company_name)}`);
    const description = trim(job.job_description);
    if (description) {
      const clipped = description.length > 12000 ? `${description.slice(0, 11997)}...` : description;
      jobLines.push(`Job description:\n${clipped}`);
    }

    return [
      jobLines.length ? `## Job posting\n${jobLines.join('\n')}` : '',
      lines.length ? `## Profile\n${lines.join('\n')}` : '',
      extraFacts ? `## Additional facts from the candidate\n${extraFacts}` : '',
      work ? `## ${experienceLabel}\n${work}` : '',
      custom ? `## Saved custom Q&A\n${custom}` : ''
    ].filter(Boolean).join('\n\n');
  }

  // ── Behavioral question classification ────────────────────────────────────
  /** Matches explicit behavioral/situational question cues. */
  const BEHAVIORAL_RE =
    /\b(tell me about a time|describe a (time|situation|moment|scenario|experience)|give (me )?an example|share an example|when (did|have|were) you|how (did|have|do) you handle|what did you do when|walk me through|have you (ever )?faced|how have you dealt|can you share a)\b/i;

  /** Matches weakness / failure / growth question cues. */
  const GROWTH_RE =
    /\b(weakness(es)?|fail(ure|ed)?|mistake|area[^.]{0,30}(improv|develop|grow)|constructive (feedback|criticism)|what (would|could) you (have done |do )?different(ly)?|most challenging|struggled? (with|to)\b|difficult (time|situation|aspect|moment)\b|biggest challenge|hard(est)? (thing|moment|decision)|short.{0,10}coming|blind.{0,10}spot|opportunity for (growth|improvement)|what.{0,15}improve)\b/i;

  /**
   * Classify a field for prompt-style selection.
   * @param {object} field
   * @returns {'behavioral'|'growth'|'normal'|'structured'}
   */
  function classifyQuestionType(field) {
    const fieldType = trim(field.fieldType || field.inputType || '').toLowerCase();

    // Hard-structured widgets — always keep exact-match behavior
    if (/select|radio|checkbox|combobox|yes.no|file/i.test(fieldType)) return 'structured';

    const questionText = [
      field.questionText,
      field.labelText,
      field.nearbyText,
      field.placeholder,
    ]
      .filter(Boolean)
      .join(' ');

    if (GROWTH_RE.test(questionText)) return 'growth';
    if (BEHAVIORAL_RE.test(questionText)) return 'behavioral';
    return 'normal';
  }

  // "Select...", "Choose one", "-- Please select --". Not "Choose not to disclose": that is an answer.
  const PLACEHOLDER_OPTION_RE =
    /^[-–—\s]*(?:(?:please\s+)?(?:select|choose)(?:\s+(?:one|an?\b.*|your\b.*|the\b.*|from\b.*|option.*))?[-–—\s.…:]*|[-–—.\s]+)$/i;

  function buildFieldUserPrompt(field, row) {
    const question = trim(
      field.questionText || field.labelText || field.nearbyText || field.placeholder || field.name || 'Unknown field'
    );
    const fieldType = trim(field.fieldType || field.inputType || 'text');
    const category = trim(field.fieldCategory || 'unknown');
    // A placeholder such as "Select..." is not an answer the model may choose.
    const options = (Array.isArray(field.options) ? field.options : [])
      .map((o) => trim(o))
      .filter((o) => o && !PLACEHOLDER_OPTION_RE.test(o));
    const currentValue = trim(row?.suggestedValue || '');
    const qType = classifyQuestionType(field);

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

    if (qType === 'behavioral') {
      parts.push(
        '\nThis is a behavioral/situational question — use STAR format.',
        'Structure:',
        '  Situation (~10%) — brief context (1-2 sentences).',
        '  Task (~10%)     — your specific responsibility or goal.',
        '  Action (~55%)   — concrete steps YOU took; be specific, name tools/processes, include a number or metric if true.',
        '  Result (~25%)   — measurable or qualitative outcome with impact.',
        'Separate each component with a blank line (\\n\\n). No S:/T:/A:/R: labels.',
        'Spoken, first-person, natural. Total: UNDER 140 words.',
        'Use a UNIQUE work experience — do not repeat a story used for any other question.'
      );
    } else if (qType === 'growth') {
      parts.push(
        '\nThis is a negative/growth question — use STAR+L format.',
        'Structure:',
        '  Situation (~10%) — brief context.',
        '  Task (~10%)     — what you were accountable for.',
        '  Action (~50%)   — what you tried; be honest, including the misstep.',
        '  Result (~20%)   — honest, real outcome (even if imperfect).',
        '  Learned (~10%)  — specific insight or concrete habit you adopted afterward.',
        'Separate each component with a blank line (\\n\\n). No labels.',
        'Spoken, reflective, first-person. Total: UNDER 140 words.',
        'Use a UNIQUE experience — do not repeat a story used for any other question.'
      );
    } else if (qType === 'normal') {
      parts.push(
        '\nAnswer this question directly and conversationally. First-person. Under 100 words.'
      );
    }

    parts.push('\nReturn JSON only: {"value":"your answer"}');
    return parts.join('\n');
  }

  /**
   * Parse AI JSON response into { value, needsInput }.
   * Accepts {"value":"..."} and optional {"needs_input":true}.
   */
  function parseAiJson(content) {
    const raw = trim(content);
    if (!raw) throw new Error('OpenAI returned an empty response.');

    const normalize = (parsed) => {
      if (parsed == null) return null;
      if (typeof parsed === 'string') {
        return { value: trim(parsed), needsInput: false };
      }
      if (typeof parsed === 'object') {
        const needsInput = Boolean(parsed.needs_input || parsed.needsInput);
        let value = '';
        if (typeof parsed.value === 'string') value = trim(parsed.value);
        else if (typeof parsed.answer === 'string') value = trim(parsed.answer);
        return { value, needsInput };
      }
      return null;
    };

    try {
      const parsed = JSON.parse(raw);
      const result = normalize(parsed);
      if (result) return result;
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const result = normalize(parsed);
        if (result) return result;
      }
    }
    throw new Error('Could not parse AI response as JSON.');
  }

  async function suggestFieldValue(apiKey, model, field, row, contextBlock, options = {}) {
    const key = trim(apiKey);
    if (!key) throw new Error('API key is not set.');

    const qType = classifyQuestionType(field);

    // ── Adaptive system prompt ─────────────────────────────────────────────
    const systemParts = [
      'You help complete job application form fields accurately.',
      'Use ONLY facts from the profile, work experience, job description, and saved answers provided.',
      'Do not invent employers, degrees, dates, credentials, salary numbers, or personal facts.',
      'Prefer matching a Saved custom Q&A answer when the question is substantially the same.',
      'For multiple-choice fields, the "value" must exactly match one listed option when options are given.',
      'For yes/no questions, answer with Yes or No unless options specify otherwise.',
      'If the context does not contain enough facts to answer honestly, set "needs_input": true and "value": "".',
      'Never guess just to fill a blank.',
    ];

    if (qType === 'behavioral') {
      systemParts.push(
        'For behavioral questions write in a natural spoken first-person voice.',
        'Apply STAR structure (Situation → Task → Action → Result) — each component as its own short paragraph, separated by a blank line; no S:/T:/A:/R: labels.',
        'Word budget: Situation ≈10%, Task ≈10%, Action ≈55%, Result ≈25%. Total UNDER 140 words.',
        'Ground Situation/Action in a real role from Work experience; do not invent a company or project.',
        'Include an exact number or metric in Action or Result ONLY when that metric appears in the provided experience.',
        'Each question must use a DIFFERENT specific work experience; never reuse the same story.'
      );
    } else if (qType === 'growth') {
      systemParts.push(
        'For negative/growth questions write in a natural spoken first-person voice.',
        'Apply STAR+L structure (Situation → Task → Action → Result → Learned) — each component as its own short paragraph, separated by a blank line; no labels.',
        'Word budget: S ≈10%, T ≈10%, A ≈50%, R ≈20%, L ≈10%. Total UNDER 140 words.',
        'Ground the story in provided experience; do not invent employers or outcomes.',
        'Be honest about the difficulty. End with a genuine, specific insight or habit change.',
        'Each question must use a DIFFERENT specific experience; never reuse the same story.'
      );
    } else if (qType === 'normal') {
      systemParts.push(
        'For open-ended questions answer directly and conversationally in the first person. Under 100 words.',
        'Only claim skills, tools, or outcomes that appear in the provided context.'
      );
    } else {
      systemParts.push(
        'Keep answers concise and accurate; a few words to one short paragraph.',
        'For name, contact, education, authorization, and demographic fields, copy profile values exactly when present.'
      );
    }

    // Inject previously-used scenario fingerprints so the AI avoids repetition
    const prevExamples = Array.isArray(options.usedExamples) ? options.usedExamples : [];
    if (prevExamples.length > 0) {
      systemParts.push(
        `Do NOT reuse any of these scenario openings already used in this session: ${prevExamples.join(' | ')}`
      );
    }

    systemParts.push('Respond with valid JSON only: {"value":"...","needs_input":false}.');
    const system = systemParts.join(' ');

    // Adaptive temperature: creativity for essay questions, precision for structured
    const temperature =
      qType === 'structured' ? 0.15 :
      qType === 'behavioral' ? 0.68 :
      qType === 'growth'     ? 0.60 :
      0.40; // normal

    const user = `${contextBlock}\n\n${buildFieldUserPrompt(field, row)}`;
    const data = await chatCompletion(key, {
      model,
      temperature,
      responseFormat: { type: 'json_object' },
      baseUrl: options.baseUrl,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const content = data?.choices?.[0]?.message?.content;
    return parseAiJson(content);
  }

  /**
   * Trim a long JD to sentences that look location/travel-related so geo checks stay cheap.
   * Includes one sentence before and after each matching sentence so the AI has enough
   * context to distinguish "hard requirement" language from "preference" or company-info.
   */
  const GEO_HINT =
    /\b(remote|hybrid|onsite|on[\s-]?site|reside|residents?|located|based|hiring|hire|state|states|office|hub|timezone|time zone|PST|EST|CST|MST|canada|ontario|toronto|uk|united kingdom|emea|apac|nationwide|anywhere|united states|u\.s\.|usa|must live|must be|travel|commute|retreat|location\s*type)\b|\d+\s*%/i;

  /** Geo hints plus the other hard-blocker topics (clearance, sponsorship, eligibility). */
  const COMPAT_HINT = new RegExp(
    `${GEO_HINT.source}|\\b(clearance|ts\\/sci|sponsor\\w*|visa|citizen\\w*|authoriz\\w*|eligib\\w*|licen[sc]\\w*|certifi\\w*)\\b`,
    'i'
  );

  function extractGeoRelevantText(jd, maxChars, hint) {
    const text = String(jd || '').trim();
    if (!text) return '';
    const limit = Math.max(800, Number(maxChars) || 4500);
    const locationHint = hint instanceof RegExp ? hint : GEO_HINT;
    const sentences = text.split(/(?<=[.!?;:\n])\s+/);

    // Collect indices of matching sentences plus their immediate neighbours.
    const indices = new Set();
    sentences.forEach((s, i) => {
      if (locationHint.test(s)) {
        if (i > 0) indices.add(i - 1);
        indices.add(i);
        if (i < sentences.length - 1) indices.add(i + 1);
      }
    });

    const pickedSentences = indices.size
      ? [...indices].sort((a, b) => a - b).map((i) => sentences[i])
      : sentences;

    const body = pickedSentences.join(' ').trim();
    if (body.length <= limit) return body;
    return `${body.slice(0, limit - 3)}...`;
  }

  /** Categories the model may claim as a hard blocker. */
  const COMPAT_CATEGORIES = [
    'location',
    'onsite',
    'sponsorship',
    'clearance',
    'occupation',
    'eligibility',
    'language',
  ];

  /** Compatibility needs whole-posting context, capped to keep the call cheap. */
  const COMPAT_MAX_JD_CHARS = 9000;
  /** Share of the cap spent on the start of an over-long posting. */
  const COMPAT_HEAD_CHARS = 6000;
  const COMPAT_TIMEOUT_MS = 30000;

  /**
   * Fit a posting into the cap. Location and eligibility terms often sit at
   * the end, so an over-long posting keeps its head plus the sentences from
   * the remainder that touch a hard-blocker topic.
   */
  function clipJobDescriptionForCompat(jdFull) {
    if (jdFull.length <= COMPAT_MAX_JD_CHARS) return jdFull;
    const head = jdFull.slice(0, COMPAT_HEAD_CHARS);
    const tail = extractGeoRelevantText(
      jdFull.slice(COMPAT_HEAD_CHARS),
      COMPAT_MAX_JD_CHARS - COMPAT_HEAD_CHARS,
      COMPAT_HINT
    );
    return tail ? `${head}\n[...]\n${tail}` : head;
  }

  /**
   * Render the candidate's hard constraints.
   *
   * Fixed product defaults (always known):
   *   - US citizen → no sponsorship needed
   *   - No active security clearance → reject jobs that require one
   *   - Remote work arrangement
   *
   * Salary, travel %, and employment type are intentionally omitted.
   */
  function describeCandidateConstraints(c = {}) {
    const lines = [];
    const known = [];
    const unknown = [];

    const push = (label, value, note) => {
      const v = trim(value);
      if (v) {
        known.push(`  • ${label}: ${v}${note ? ` (${note})` : ''}`);
      } else {
        unknown.push(label);
      }
    };

    const location = [trim(c.city), trim(c.state)].filter(Boolean).join(', ');
    push('Location', location ? `${location}, USA` : '', 'works remotely from here');
    push('Years of experience', c.yearsOfExperience);
    push(
      'Needs visa sponsorship',
      trim(c.sponsorshipRequirement) || 'No',
      'US citizen — does not require sponsorship'
    );
    push('Citizenship', trim(c.citizenship) || 'US citizen');
    push(
      'Authorized to work in the US',
      trim(c.workAuthorizationUS) || 'Yes',
      'not authorized to work in any other country'
    );
    push(
      'Spoken languages',
      trim(c.languages) || 'English only',
      'reject jobs that require any other spoken language'
    );
    push('Willing to relocate', c.relocationPreference);
    push('Work arrangement required', trim(c.remotePreference) || 'Remote');
    push(
      'Active security clearance',
      trim(c.securityClearance) || 'No',
      'reject jobs that require an active clearance'
    );

    lines.push('KNOWN CANDIDATE FACTS:');
    lines.push(known.length ? known.join('\n') : '  • (none recorded)');
    if (unknown.length) {
      lines.push('');
      lines.push(`UNKNOWN (never treat as a conflict): ${unknown.join(', ')}`);
    }
    return lines.join('\n');
  }

  /**
   * Decide whether a posting is worth applying to.
   *
   * The model may only reject a job by naming an explicit requirement from the
   * posting that a KNOWN candidate fact contradicts, quoted verbatim. Callers
   * must still run the returned blockers through
   * SmartJobBidFitPreflight.validateHardBlockers, which re-checks the quote
   * against the posting and enforces the confidence floor.
   *
   * @returns {{
   *   verdict: 'pass'|'warn'|'fail',
   *   blockers: Array<{category:string,candidate_conflict:string,evidence:string,confidence:number}>,
   *   warnings: Array<{category:string,note:string}>,
   *   summary: string
   * }}
   */
  async function evaluateJobCompatibility(apiKey, model, {
    jobDescription,
    constraints,
    baseUrl,
    signals,
  } = {}) {
    const key = trim(apiKey);
    if (!key) throw new Error('API key is not set.');
    const flagged = (Array.isArray(signals) ? signals : []).filter((s) => s && trim(s.sentence));

    const jdFull = String(jobDescription || '').trim();
    if (!jdFull) throw new Error('No job description to check.');
    const jd = clipJobDescriptionForCompat(jdFull);

    const system = [
      'You screen job postings for a US-citizen candidate who works remotely, speaks only English, needs no visa sponsorship, and has no active security clearance.',
      'Discard only postings the candidate CANNOT possibly be hired for. Keep every posting with any plausible chance.',
      '',
      'Reply with JSON only:',
      '{',
      '  "verdict": "pass" | "warn" | "fail",',
      '  "hard_blockers": [{ "category": "...", "candidate_conflict": "...", "evidence": "...", "confidence": 0.0-1.0 }],',
      '  "warnings": [{ "category": "...", "note": "..." }],',
      '  "signal_reviews": [{ "index": 1, "decision": "hard_blocker" | "not_blocker", "reason": "..." }],',
      '  "summary": "one sentence"',
      '}',
      '',
      '=== FLAGGED SENTENCES ===',
      'The user message may list sentences that simple rules flagged. They are leads, not conclusions:',
      'most are harmless. Rule on EVERY one in "signal_reviews", using its number as "index".',
      'A sentence you decide is a hard blocker must ALSO appear in "hard_blockers" with its quote.',
      'Read the whole posting as well — a blocker may sit in a sentence that was not flagged.',
      '',
      '=== A HARD BLOCKER REQUIRES ALL FOUR ===',
      '1. The posting states the requirement as MANDATORY (must / required / only).',
      '2. A KNOWN candidate fact directly contradicts it.',
      '3. You quote the requirement VERBATIM from the posting in "evidence".',
      '4. Your confidence is at least 0.90.',
      'If any one of these is missing, it is NOT a hard blocker. Put it in "warnings" instead.',
      '',
      `Allowed "category" values: ${COMPAT_CATEGORIES.join(', ')}.`,
      'Never invent a category. Never claim a blocker for an UNKNOWN candidate fact.',
      'Do NOT evaluate salary, travel percentage, or employment type (W2/contract) as hard blockers.',
      '',
      '=== HARD BLOCKER EXAMPLES (verdict: fail) ===',
      '  • location — "Candidates must reside in Washington State" and candidate lives in Florida.',
      '  • onsite — "This role requires 3 days per week in our Boston office" and candidate requires remote.',
      '  • sponsorship — ONLY if candidate Needs visa sponsorship = Yes AND JD refuses sponsorship. This candidate is a US citizen (Needs visa sponsorship = No), so sponsorship refusal is NOT a conflict.',
      '  • clearance — "Active TS/SCI clearance required" or "Must currently hold Secret clearance" and candidate has Active security clearance = No.',
      '  • occupation — Posting is for a registered nurse, CDL driver, attorney, or commission-only sales role.',
      '  • eligibility — A mandatory license or legal eligibility the candidate provably lacks, including the right to work in another country ("Must be authorized to work in Canada", "EU work permit required").',
      '  • language — A spoken language other than English is MANDATORY: "Fluent German required", "Must be bilingual in English and Spanish", "Native-level Japanese is a must".',
      '',
      '=== NEVER A HARD BLOCKER (verdict: warn at most, keep the job) ===',
      '  • "Must be clearable" / "able to obtain clearance" — that is NOT an active-clearance requirement.',
      '  • "Clearance preferred" or clearance not mentioned.',
      '  • "Unable to sponsor visas" when candidate does not need sponsorship (US citizen).',
      '  • "Must be authorized to work in the US" — citizen satisfies this.',
      '  • Missing or "preferred" / "ideally" / "nice to have" / "bonus" skills.',
      '  • More years of experience than the candidate has; one-level seniority stretch.',
      '  • Degree requirements, unless a legally mandatory professional license.',
      '  • Staffing agency, recruiting firm, or contract-to-hire posting.',
      '  • Hub preference ("prefer candidates near Austin").',
      '  • Ambiguous hybrid / travel wording with no stated office-day mandate.',
      '  • Salary, travel %, W2/contract/1099 language.',
      '  • Another spoken language that is only "a plus", "preferred", "nice to have", or "an advantage".',
      '  • English proficiency requirements — the candidate speaks English.',
      '  • Programming languages (Python, Java, Go, Swift…) — those are skills, never a "language" blocker.',
      '  • "US citizenship required" or "US persons only" — the candidate is a US citizen.',
      '  • Anything you are unsure about.',
      '',
      '=== DECISION RULES ===',
      '  • Missing information is NEVER incompatibility. Silence means PASS.',
      '  • Compensation Geo bands are pay tiers, not hiring allowlists.',
      '  • Offices in a city ≠ attendance required.',
      '  • "Remote" plus a city name usually means the team base, not a residence mandate.',
      '  • When you hesitate between fail and warn, choose warn.',
      '  • verdict is "fail" only if hard_blockers is non-empty; otherwise "warn" if warnings exist, else "pass".',
    ].join('\n');

    const user = [
      describeCandidateConstraints(constraints),
      '',
      'JOB POSTING:',
      jd,
      '',
      ...(flagged.length
        ? [
            'FLAGGED SENTENCES (rule on each in "signal_reviews"):',
            ...flagged.map((s) => `${s.index}. [${s.category}] "${trim(s.sentence)}"`),
            '',
          ]
        : []),
      'Screen this posting. Remember: reject only on an explicit mandatory requirement that a KNOWN candidate fact contradicts, quoted verbatim. Otherwise keep it.',
    ].join('\n');

    const data = await chatCompletion(key, {
      model,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      baseUrl,
      timeoutMs: COMPAT_TIMEOUT_MS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const content = data?.choices?.[0]?.message?.content;
    let parsed = null;
    try {
      parsed = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (_) {
      const match = String(content || '').match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (_) {
          parsed = null;
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Could not parse AI compatibility response.');
    }

    const blockers = (Array.isArray(parsed.hard_blockers) ? parsed.hard_blockers : [])
      .map((b) => ({
        category: String(b?.category || '').trim().toLowerCase(),
        candidate_conflict: trim(b?.candidate_conflict || b?.conflict),
        evidence: trim(b?.evidence || b?.quote),
        confidence: Number(b?.confidence),
      }))
      .filter((b) => b.category && b.evidence);

    const warnings = (Array.isArray(parsed.warnings) ? parsed.warnings : [])
      .map((w) => (typeof w === 'string'
        ? { category: 'other', note: trim(w) }
        : { category: String(w?.category || 'other').trim().toLowerCase(), note: trim(w?.note) }))
      .filter((w) => w.note);

    // Verdict is derived, not trusted: a "fail" with no surviving blocker is a warn.
    const verdict = blockers.length ? 'fail' : warnings.length ? 'warn' : 'pass';
    const summary = trim(parsed.summary) || 'Compatibility check completed.';

    const signalReviews = (Array.isArray(parsed.signal_reviews) ? parsed.signal_reviews : [])
      .map((r) => ({
        index: Number(r?.index),
        decision: /block/i.test(String(r?.decision || '')) && !/not/i.test(String(r?.decision || ''))
          ? 'hard_blocker'
          : 'not_blocker',
        reason: trim(r?.reason),
      }))
      .filter((r) => Number.isFinite(r.index));

    return { verdict, blockers, warnings, summary, signalReviews };
  }

  root.SmartJobAiFill = {
    DEFAULT_MODEL,
    DEFAULT_BASE_URL,
    normalizeChatBaseUrl,
    buildCandidateContext,
    buildFieldUserPrompt,
    classifyQuestionType,
    suggestFieldValue,
    evaluateJobCompatibility,
    describeCandidateConstraints,
    COMPAT_CATEGORIES,
    extractGeoRelevantText,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
