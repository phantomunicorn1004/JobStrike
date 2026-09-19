/**
 * Bid fit preflight — multi-criteria scorecard before Copy Prompt.
 * Tuned toward ChatGPT V9 waste (Unresolved / bad align), not title vanity.
 * Local heuristics only; does not run employer research.
 */
(function (global) {
  const MIN_JD_CHARS = 80;

  /** Weights: higher = more predictive of GPT Unresolved / wasted runs. */
  const WEIGHTS = {
    jd_quality: 25,
    kit_integrity: 20,
    arrangement: 22,
    domain: 20,
    seniority: 4,
    stack_overlap: 5,
    policy: 4,
  };

  const SWE_SIGNALS =
    /\b(software|engineer|developer|fullstack|full[\s-]?stack|backend|front[\s-]?end|devops|sre|platform engineer|security engineer|product engineer|technical product|ml engineer|data engineer|ai engineer|agentic|automation engineer|typescript|javascript|react|node\.?js|python|java|golang|kubernetes|terraform|api[s]?|llm|gen(?:erative)? ai)\b/i;

  const NON_SWE_STRONG =
    /\b(registered nurse|nursing|physician|dentist|pharmacist|truck driver|cdl|warehouse associate|cashier|barista|hair stylist|real estate agent|paralegal|attorney at law|dental hygienist|market data reporting analyst|statutory accounting|insurance commissioner)\b/i;

  const ANALYST_OPS =
    /\b(data reporting analyst|reporting analyst|business analyst|market analyst|operations analyst|compliance analyst|claims analyst|sql queries|biographic and demographic)\b/i;

  const ONSITE_ONLY =
    /\b(on[\s-]?site only|onsite only|in[\s-]?office only|must (be|work) (on[\s-]?site|in[\s-]?office)|no remote|not remote|5 days (a|per) week in (?:the )?office|on[\s-]?prem(?:ise)?s only)\b/i;

  const REMOTE_POSITIVE =
    /\b(remote(?: type)?\s*:\s*yes|remote type:\s*remote|\bremote\b|work from home|wfh|distributed|anywhere in (the )?us|us[\s-]?based remote)\b/i;

  const HYBRID =
    /\b(hybrid position|hybrid role|\bhybrid\b)/i;

  const RESIDENCY_RADIUS =
    /\b(residency within|within a?\s*\d{2,3}[\s-]?mile|must (live|reside) (within|near|in)|commutable distance|radius of .{0,40}office)\b/i;

  /** Extreme eng ladder only — not every "Principal …" product title. */
  const EXTREME_ENG_SENIORITY =
    /\b((staff|principal|distinguished)\s+(software|swe|sde|engineer)|staff engineer|principal engineer|distinguished engineer|engineering (director|fellow)|cto|vp\s+engineering|vice president of engineering)\b/i;

  const EXEC_NON_IC =
    /\b(director of|vp of|vice president|head of (engineering|product|security)|chief (technology|information|product) officer)\b/i;

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractJsonAfterLabel(template, label) {
    const text = String(template || '');
    const idx = text.search(new RegExp(`${label}\\s*:`, 'i'));
    if (idx < 0) return null;
    const from = text.indexOf('{', idx);
    if (from < 0) return null;
    let depth = 0;
    for (let i = from; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(from, i + 1));
          } catch (_) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function detectKitFlavor(template) {
    const t = String(template || '');
    if (/<resume_task>|Prompt version:\s*V9|fictional_benchmark|verified_candidate/i.test(t)) {
      return 'v9';
    }
    return 'simple';
  }

  function parseRunSettings(template) {
    const parsed = extractJsonAfterLabel(template, 'run_settings');
    if (!parsed || typeof parsed !== 'object') {
      return { mode: 'unknown', employer_policy: {}, raw: null };
    }
    return {
      mode: String(parsed.mode || 'unknown'),
      employer_policy:
        parsed.employer_policy && typeof parsed.employer_policy === 'object'
          ? parsed.employer_policy
          : {},
      raw: parsed,
    };
  }

  function parseResumeTemplate(resumeTemplateJson) {
    if (!resumeTemplateJson) return null;
    if (typeof resumeTemplateJson === 'object') return resumeTemplateJson;
    try {
      return JSON.parse(String(resumeTemplateJson));
    } catch (_) {
      return null;
    }
  }

  function collectFixedRoles(templateObj) {
    const we = templateObj?.work_experience;
    if (!we || typeof we !== 'object') return [];
    const roles = [];
    for (const key of Object.keys(we)) {
      if (!/^experience_\d+$/i.test(key)) continue;
      const exp = we[key];
      if (!exp || typeof exp !== 'object') continue;
      const title =
        (typeof exp.role_title === 'object' ? exp.role_title.text : exp.role_title) || '';
      roles.push({
        key,
        title: String(title || '').trim(),
        arrangement: String(exp.work_arrangement || '').trim(),
        start: String(exp.start_date || '').trim(),
        end: String(exp.end_date || '').trim(),
        companyFixed: Boolean(
          typeof exp.company === 'object' ? String(exp.company.text || '').trim() : ''
        ),
      });
    }
    return roles;
  }

  function keywordOverlapScore(jdNorm, roles) {
    const titleBlob = normalizeText(roles.map((r) => r.title).join(' '));
    if (!jdNorm || !titleBlob) return 50;
    const tokens = titleBlob.split(' ').filter((t) => t.length > 2);
    if (!tokens.length) return 50;
    let hits = 0;
    for (const token of tokens) {
      if (jdNorm.includes(token)) hits += 1;
    }
    return Math.round((hits / tokens.length) * 100);
  }

  function parseYearMonth(value) {
    const m = String(value || '').match(
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i
    );
    if (!m) return null;
    const months = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const month = months[m[1].slice(0, 3).toLowerCase()];
    const year = Number(m[2]);
    if (month == null || !Number.isFinite(year)) return null;
    return new Date(year, month, 1).getTime();
  }

  function pushCriterion(criteria, id, status, message, extra) {
    criteria.push({
      id,
      status, // pass | warn | fail | info
      message,
      weight: WEIGHTS[id] || 0,
      ...(extra || {}),
    });
  }

  function evaluateJdQuality(jd, criteria) {
    if (!jd) {
      pushCriterion(criteria, 'jd_quality', 'fail', 'Add a job description in Note before Copy Prompt.');
      return;
    }
    if (jd.length < MIN_JD_CHARS) {
      pushCriterion(
        criteria,
        'jd_quality',
        'fail',
        `JD looks too short (${jd.length} chars). Paste the full posting.`
      );
      return;
    }
    pushCriterion(criteria, 'jd_quality', 'pass', 'JD length looks usable.');
  }

  function evaluateKitIntegrity(template, resumeTemplateJson, resumeObj, criteria) {
    if (!String(template || '').trim()) {
      pushCriterion(criteria, 'kit_integrity', 'fail', 'Prompt kit template is empty.');
      return;
    }
    if (!String(resumeTemplateJson || '').trim()) {
      pushCriterion(
        criteria,
        'kit_integrity',
        'fail',
        'Prompt kit is missing resume_template_json for this profile.'
      );
      return;
    }
    if (!resumeObj) {
      pushCriterion(criteria, 'kit_integrity', 'fail', 'resume_template_json is not valid JSON.');
      return;
    }
    pushCriterion(criteria, 'kit_integrity', 'pass', 'Kit template + resume JSON present.');
  }

  function evaluateArrangement(jd, roles, isV9, isFictional, criteria) {
    if (!jd) {
      pushCriterion(criteria, 'arrangement', 'pass', 'Skipped (no JD).');
      return;
    }
    const allRemote =
      roles.length > 0 && roles.every((r) => /remote/i.test(r.arrangement || ''));
    if (!allRemote) {
      pushCriterion(criteria, 'arrangement', 'pass', 'Template is not all-Remote; arrangement check soft.');
      return;
    }

    const onsite = ONSITE_ONLY.test(jd);
    const hybrid = HYBRID.test(jd);
    const radius = RESIDENCY_RADIUS.test(jd);
    const remoteYes = REMOTE_POSITIVE.test(jd);

    // Hybrid + office radius is a common V9 Unresolved / wasted run vs Remote fictional kit.
    if (hybrid && radius) {
      pushCriterion(
        criteria,
        'arrangement',
        'fail',
        'JD is hybrid with a residency/office-radius requirement; template roles are Remote.'
      );
      return;
    }
    if (radius && !remoteYes) {
      pushCriterion(
        criteria,
        'arrangement',
        'fail',
        'JD requires living near an office; template roles are Remote.'
      );
      return;
    }
    if (onsite) {
      pushCriterion(
        criteria,
        'arrangement',
        isV9 || isFictional ? 'fail' : 'warn',
        'JD looks onsite-only, but template roles are Remote.'
      );
      return;
    }
    if (hybrid && !remoteYes) {
      pushCriterion(
        criteria,
        'arrangement',
        'warn',
        'JD looks hybrid; Remote-only template may Unresolved or misalign.'
      );
      return;
    }
    if (remoteYes) {
      pushCriterion(criteria, 'arrangement', 'pass', 'JD supports remote; matches Remote template.');
      return;
    }
    pushCriterion(
      criteria,
      'arrangement',
      'info',
      'Work arrangement unclear in JD; Remote template assumed.'
    );
  }

  function evaluateDomain(jd, roles, criteria) {
    if (!jd) {
      pushCriterion(criteria, 'domain', 'pass', 'Skipped (no JD).');
      return;
    }
    const swe = SWE_SIGNALS.test(jd);
    const nonSwe = NON_SWE_STRONG.test(jd);
    const analyst = ANALYST_OPS.test(jd);
    const templateSwe = roles.some((r) => /engineer|developer/i.test(r.title));

    if (nonSwe && !swe) {
      pushCriterion(
        criteria,
        'domain',
        'fail',
        'JD domain does not look like a software/engineering role for this template.'
      );
      return;
    }
    if (analyst && !swe) {
      pushCriterion(
        criteria,
        'domain',
        'fail',
        'JD looks like reporting/ops analyst work, not an SWE-style template fit.'
      );
      return;
    }
    if (templateSwe && !swe) {
      pushCriterion(
        criteria,
        'domain',
        'warn',
        'Weak software/engineering signals in the JD vs fixed engineer titles.'
      );
      return;
    }
    if (swe) {
      pushCriterion(criteria, 'domain', 'pass', 'JD has software/engineering-relevant signals.');
      return;
    }
    pushCriterion(criteria, 'domain', 'info', 'Domain signals mixed; GPT may still Unresolved.');
  }

  function evaluateSeniority(jd, roles, criteria) {
    if (!jd || !roles.length) {
      pushCriterion(criteria, 'seniority', 'pass', 'Skipped.');
      return;
    }
    const templateTitles = normalizeText(roles.map((r) => r.title).join(' '));
    const templateHasExtreme = EXTREME_ENG_SENIORITY.test(templateTitles);
    const templateHasSenior = /\b(senior|sr\.?|lead)\b/i.test(templateTitles);

    // Extreme IC ladder only — Principal Product Engineer / TPE should NOT warn.
    if (EXTREME_ENG_SENIORITY.test(jd) && !templateHasExtreme) {
      pushCriterion(
        criteria,
        'seniority',
        templateHasSenior ? 'info' : 'warn',
        'JD asks for Staff/Principal Engineer ladder; template titles are lower.'
      );
      return;
    }
    if (EXEC_NON_IC.test(jd) && !templateHasExtreme) {
      pushCriterion(
        criteria,
        'seniority',
        'info',
        'JD looks director/VP-level; GPT may still draft but fit can be stretchy.'
      );
      return;
    }
    pushCriterion(criteria, 'seniority', 'pass', 'Seniority not a hard mismatch.');
  }

  function evaluateStackOverlap(jdNorm, roles, criteria) {
    if (!jdNorm || !roles.length) {
      pushCriterion(criteria, 'stack_overlap', 'pass', 'Skipped.');
      return;
    }
    const overlap = keywordOverlapScore(jdNorm, roles);
    if (overlap < 20 && SWE_SIGNALS.test(jdNorm)) {
      pushCriterion(
        criteria,
        'stack_overlap',
        'info',
        'Low wording overlap with fixed role titles (soft signal).'
      );
      return;
    }
    pushCriterion(criteria, 'stack_overlap', 'pass', `Title/keyword overlap ~${overlap}.`, {
      overlap,
    });
  }

  function evaluatePolicy(jd, runSettings, isV9, isFictional, criteria) {
    const policy = runSettings.employer_policy || {};
    const remoteFirst = Boolean(policy.remote_first_entire_period);
    if (!jd || !isV9 || !remoteFirst) {
      pushCriterion(criteria, 'policy', 'pass', 'No extra employer-policy pressure.');
      return;
    }
    if (REMOTE_POSITIVE.test(jd)) {
      pushCriterion(criteria, 'policy', 'pass', 'JD remote signal OK for remote-first kit policy.');
      return;
    }
    if (HYBRID.test(jd) || RESIDENCY_RADIUS.test(jd) || ONSITE_ONLY.test(jd)) {
      // Arrangement criterion already covers hard fails.
      pushCriterion(
        criteria,
        'policy',
        'info',
        'V9 remote-first policy + non-remote JD increases Unresolved risk.'
      );
      return;
    }
    pushCriterion(
      criteria,
      'policy',
      isFictional ? 'info' : 'pass',
      'Kit remote-first policy; JD arrangement unclear.'
    );
  }

  function criteriaToReasons(criteria) {
    const severityMap = { fail: 'block', warn: 'warn', info: 'info', pass: 'info' };
    return criteria
      .filter((c) => c.status !== 'pass')
      .map((c) => ({
        code: String(c.id || '').toUpperCase(),
        criterion: c.id,
        severity: severityMap[c.status] || 'info',
        message: c.message,
      }));
  }

  function scoreFromCriteria(criteria) {
    let score = 100;
    let weightFail = 0;
    let weightWarn = 0;
    let totalWeight = 0;

    for (const c of criteria) {
      const w = Number(c.weight) || 0;
      if (!w) continue;
      totalWeight += w;
      if (c.status === 'fail') {
        score -= w;
        weightFail += w;
      } else if (c.status === 'warn') {
        score -= Math.round(w * 0.45);
        weightWarn += w;
      } else if (c.status === 'info') {
        score -= Math.round(w * 0.08);
      }
    }

    // Bonuses for strong passes on high-weight axes
    const arr = criteria.find((c) => c.id === 'arrangement');
    const dom = criteria.find((c) => c.id === 'domain');
    if (arr?.status === 'pass') score += 4;
    if (dom?.status === 'pass') score += 4;

    score = Math.max(0, Math.min(100, score));
    return { score, weightFail, weightWarn, totalWeight };
  }

  /**
   * @returns {{
   *   level: 'ready'|'risky'|'blocked',
   *   score: number,
   *   reasons: Array<{code:string,severity:'block'|'warn'|'info',message:string}>,
   *   criteria: Array<object>,
   *   canCopy: boolean,
   *   requireConfirm: boolean,
   *   flavor: string,
   *   mode: string,
   *   overlap: number
   * }}
   */
  function evaluateBidFit({
    jobDescription,
    template,
    resumeTemplateJson,
  } = {}) {
    const jd = String(jobDescription || '').trim();
    const jdNorm = normalizeText(jd);
    const flavor = detectKitFlavor(template);
    const runSettings = parseRunSettings(template);
    const resumeObj = parseResumeTemplate(resumeTemplateJson);
    const roles = collectFixedRoles(resumeObj || {});
    const isV9 = flavor === 'v9';
    const isFictional = /fictional/i.test(runSettings.mode);

    const criteria = [];
    evaluateJdQuality(jd, criteria);
    evaluateKitIntegrity(template, resumeTemplateJson, resumeObj, criteria);
    evaluateArrangement(jd, roles, isV9, isFictional, criteria);
    evaluateDomain(jd, roles, criteria);
    evaluateSeniority(jd, roles, criteria);
    evaluateStackOverlap(jdNorm, roles, criteria);
    evaluatePolicy(jd, runSettings, isV9, isFictional, criteria);

    if (isV9 && isFictional && roles.length) {
      const latest = roles[0];
      const endMs = parseYearMonth(latest?.end);
      if (endMs && endMs > Date.now() + 45 * 24 * 60 * 60 * 1000) {
        criteria.push({
          id: 'template_dates',
          status: 'info',
          weight: 0,
          message: `Latest role end date (${latest.end}) is in the future.`,
        });
      }
    }

    const reasons = criteriaToReasons(criteria);
    const { score } = scoreFromCriteria(criteria);
    const hasFail = criteria.some((c) => c.status === 'fail');
    const hasWarn = criteria.some((c) => c.status === 'warn');

    let level = 'ready';
    if (hasFail) level = 'blocked';
    else if (hasWarn || score < 55) level = 'risky';

    // Surface at most one info when ready (avoid noisy fictional disclaimer).
    let displayReasons = reasons;
    if (level === 'ready') {
      displayReasons = reasons.filter((r) => r.severity === 'info').slice(0, 1);
    } else {
      displayReasons = [
        ...reasons.filter((r) => r.severity === 'block'),
        ...reasons.filter((r) => r.severity === 'warn'),
        ...reasons.filter((r) => r.severity === 'info').slice(0, 1),
      ];
    }

    return {
      level,
      score,
      reasons: displayReasons,
      criteria,
      canCopy: !hasFail,
      requireConfirm: level === 'risky',
      flavor,
      mode: runSettings.mode,
      overlap: keywordOverlapScore(jdNorm, roles),
    };
  }

  function summarizeFit(result) {
    if (!result) return 'Preflight: —';
    if (result.level === 'blocked') return 'Skip — don’t waste a ChatGPT run';
    if (result.level === 'risky') return 'Weak — copy only if you still want to try';
    return 'OK — copy to ChatGPT';
  }

  global.SmartJobBidFitPreflight = {
    evaluateBidFit,
    summarizeFit,
    detectKitFlavor,
    parseRunSettings,
    parseResumeTemplate,
    WEIGHTS,
    MIN_JD_CHARS,
  };
})(typeof window !== 'undefined' ? window : self);
