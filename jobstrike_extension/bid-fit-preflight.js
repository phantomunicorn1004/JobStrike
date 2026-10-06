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
    compatibility: 30,
    arrangement: 14,
    domain: 12,
    geo: 10,
    seniority: 4,
    stack_overlap: 5,
    policy: 4,
  };

  /**
   * Categories an AI hard blocker may claim. Anything outside this list is
   * downgraded to a warning, no matter how confident the model is.
   *
   * Each entry is a conflict the candidate provably cannot satisfy — never a
   * preference, a "nice to have", or a missing-information guess.
   */
  const APPROVED_HARD_BLOCKERS = new Set([
    'location',     // explicit residence/state/country restriction excluding candidate
    'onsite',       // explicit onsite/hybrid attendance candidate cannot satisfy
    'sponsorship',  // employer refuses sponsorship AND candidate requires it
    'clearance',    // mandatory active clearance the candidate lacks
    'occupation',   // clearly unrelated occupation (nurse, driver, attorney, sales)
    'eligibility',  // mandatory licence / right to work the candidate cannot meet
    'language',     // a spoken language other than English is mandatory
  ]);

  /** A hard blocker must clear this confidence bar to be honoured as a FAIL. */
  const HARD_BLOCKER_MIN_CONFIDENCE = 0.9;

  /** Evidence must be a real quote from the posting, not a paraphrase stub. */
  const HARD_BLOCKER_MIN_EVIDENCE_CHARS = 12;

  /**
   * Gate AI-claimed hard blockers. A blocker is only honoured when all five
   * conditions hold: approved category, explicit evidence quote, a named
   * candidate conflict, sufficient confidence, and the quote actually appears
   * in the posting (guards against hallucinated evidence).
   *
   * @returns {{ accepted: Array<object>, rejected: Array<object> }}
   */
  function validateHardBlockers(blockers, jd) {
    const accepted = [];
    const rejected = [];
    const haystack = normalizeQuote(jd);

    for (const raw of Array.isArray(blockers) ? blockers : []) {
      if (!raw || typeof raw !== 'object') continue;

      const category = String(raw.category || '').trim().toLowerCase();
      const evidence = String(raw.evidence || '').trim();
      const conflict = String(raw.candidate_conflict || '').trim();
      const confidence = Number(raw.confidence);
      const blocker = { category, evidence, conflict, confidence };

      if (!APPROVED_HARD_BLOCKERS.has(category)) {
        rejected.push({ ...blocker, why: 'category not on approved hard-blocker list' });
        continue;
      }
      if (evidence.length < HARD_BLOCKER_MIN_EVIDENCE_CHARS) {
        rejected.push({ ...blocker, why: 'no explicit evidence quote' });
        continue;
      }
      if (!conflict) {
        rejected.push({ ...blocker, why: 'no named candidate conflict' });
        continue;
      }
      if (!Number.isFinite(confidence) || confidence < HARD_BLOCKER_MIN_CONFIDENCE) {
        rejected.push({ ...blocker, why: 'confidence below threshold' });
        continue;
      }
      // Evidence must be traceable to the posting. Compare on normalized text so
      // whitespace, casing, and punctuation variants don't cause false rejections.
      // `validated` is set by the panel when the quote was found in the text the
      // model actually read; the Note may since hold a reworded copy of it.
      if (raw.validated !== true && !evidenceInPosting(evidence, haystack)) {
        rejected.push({ ...blocker, why: 'evidence quote not found in posting' });
        continue;
      }

      accepted.push(blocker);
    }

    return { accepted, rejected };
  }

  const US_STATES = {
    al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
    co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
    hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
    ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
    ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri',
    mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey',
    nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio',
    ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
    sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
    va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
    dc: 'district of columbia',
  };

  const STATE_TIME_ZONE = {
    pacific: ['ca', 'wa', 'or', 'nv'],
    mountain: ['az', 'co', 'ut', 'nm', 'mt', 'wy', 'id'],
    central: ['tx', 'il', 'mn', 'wi', 'ia', 'mo', 'ar', 'la', 'ok', 'ks', 'ne', 'sd', 'nd', 'ms', 'al', 'tn'],
    eastern: ['fl', 'ny', 'nj', 'pa', 'ma', 'ct', 'ri', 'nh', 'vt', 'me', 'md', 'de', 'va', 'wv', 'nc', 'sc', 'ga', 'oh', 'mi', 'in', 'ky', 'dc'],
  };

  /** Phrases that put the whole US in scope, so a hub mention is not a trap. */
  const NATIONWIDE_REMOTE =
    /\b(all 50 states|any(?:where)? in the (?:us|u\.s\.|usa|united states)|anywhere in the country|nationwide remote|remote[\s-]?first|work from anywhere|fully (?:distributed|remote) company|100%\s*remote|us[\s-]?wide)\b/i;

  /**
   * Location verbs near a constraint — covers "must reside in", "can be based only in",
   * "currently hiring in", "available only in", etc.
   */
  const RESIDENCY_SCOPE =
    /\b(?:must\s+(?:reside|live|be\s+located|be\s+based)|residents?\s+of|only\s+(?:accepting|considering)|candidates\s+must\s+be\s+located|employment\s+is\s+limited\s+to|restricted\s+to\s+candidates|open\s+only\s+to|able\s+to\s+be\s+hired\s+in|we\s+can(?:not|'t)\s+(?:hire|employ)|unable\s+to\s+(?:hire|employ)|do(?:es)?\s+not\s+hire\s+in|(?:can\s+be\s+)?based\s+only\s+in|based\s+only\s+in|available\s+only\s+in|hiring\s+only\s+in|currently\s+hiring\s+in|eligible\s+only\s+in|open\s+to\s+candidates\s+in|role\s+(?:is\s+)?limited\s+to|this\s+role\s+can\s+be\s+based\s+only\s+in)\b/i;

  /** Same sentence, but the state list is a deny list instead of an allow list. */
  const EXCLUSION_SCOPE =
    /\b(unable to (?:hire|employ)|can(?:not|'t) (?:hire|employ)|not (?:currently )?hiring in|do(?:es)? not hire in|excluding|with the exception of|except (?:in|for))\b/i;

  /** Sentences that are pay bands / travel / HQ facts — not hire allowlists. */
  const STATE_LIST_NOISE =
    /\b(\$|salary|compensation|pay\s*range|geo\s*[123]|travel\s+to|clients?\s+in|customers?\s+in|offices?\s+in|headquarters?\s+in|hq\s+in|based\s+out\s+of)\b/i;

  const HUB_CITIES =
    /\b(san francisco|bay area|new york city|nyc|manhattan|brooklyn|seattle|austin|boston|chicago|los angeles|denver|atlanta|dallas|houston|san diego|san jose|palo alto|mountain view|sunnyvale|miami|philadelphia|portland|raleigh|nashville|washington,?\s*d\.?c\.?|toronto|greater toronto)\b/i;

  const HUB_PREFERENCE =
    /\b(priorit(?:y|ize|ises?)|prefer(?:red|ence)?|ideally\s+located|close\s+proximity|near\s+(?:our\s+)?(?:office|hub|hq)|office\s+hubs?|core\s+markets?|in[\s-]?person\s+collaboration|come\s+into\s+(?:the\s+)?office)\b/i;

  /** "Remote" now, office later — Stealth Hybrid FAIL. */
  const REMOTE_BAIT =
    /\b(remote to start|remote for now|hybrid potential|potentially hybrid|return to (?:the )?office|post[\s-]?covid|occasionally? (?:travel|visit)[^.]{0,40}(?:hq|headquarters|office)|quarterly (?:travel|onsite|on-site)|travel to (?:hq|headquarters))\b/i;

  /** Required office presence (days/week or Location Type: Hybrid). */
  const OFFICE_DAYS =
    /\b(?:location\s*type\s*:\s*hybrid|(?:\d\s*[-–to]+\s*)?\d\s*days?\s+(?:a|per)\s+week\s+(?:in|at|on)[\s-]?(?:the\s+)?(?:office|site)|(?:in[\s-]?office|onsite|on[\s-]?site)\s+\d|must\s+(?:be|work|come)\s+(?:in[\s-]?office|on[\s-]?site|to\s+(?:the\s+)?office)|required\s+to\s+be\s+(?:in[\s-]?office|on[\s-]?site))\b/i;

  /**
   * Travel / office language that is explicitly harmless under the rubric
   * (0%, optional, rare annual retreat).
   */
  const GEO_CONTEXTUAL_EXCEPTION =
    /\b(?:0\s*%|zero\s*%|no\s+travel|travel[\s-]?free|entirely\s+optional|optional(?:ly)?|rare\s+annual|annual\s+(?:company\s+)?retreat|once\s+(?:a|per)\s+year|one\s+time\s+per\s+year)\b/i;

  const TIME_ZONE_CONSTRAINT =
    /\b(?:must (?:work|be available|reside|live|be located)[^.]{0,40}?)(pacific|eastern|central|mountain)\b|\b(PST|PDT|EST|EDT|CST|CDT|MST|MDT)\s+(?:hours|time zone|timezone|only)\b|\b(?:PST|PDT)\s+only\b/i;

  /** Non-US locations that imply the posting is not for a US-only applicant. */
  const NON_US_SCOPE =
    /\b(canada|canadian|ontario|quebec|british columbia|greater toronto|toronto|vancouver|montreal|united kingdom|\buk\b|england|london(?!,?\s*(?:on|ontario))|emea|apac|australia|sydney|melbourne|eu[\s-]?only|european union|germany|berlin|france|paris|india|bangalore|bengaluru|hyderabad|singapore|remote[\s-]?in[\s-]?canada|hiring\s+in\s+canada)\b/i;

  const US_SCOPE =
    /\b(united states|u\.s\.a?\.?|usa|america|us[\s-]?based|us[\s-]?only|nationwide|all 50 states)\b/i;


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

  /**
   * Like normalizeText, but also folds the punctuation variants a model tends
   * to rewrite when quoting (curly quotes, dashes, ellipsis, nbsp).
   */
  function normalizeQuote(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Shortest fragment of an elided quote that still counts as evidence. */
  const EVIDENCE_MIN_FRAGMENT_CHARS = 8;

  /**
   * True when the quote appears in the posting. A quote elided with "..." must
   * have every fragment present, in order, so invented evidence still fails.
   *
   * @param {string} evidence - raw quote from the model
   * @param {string} haystack - posting text already passed through normalizeQuote
   */
  function evidenceInPosting(evidence, haystack) {
    const parts = normalizeQuote(evidence)
      .replace(/^["']+|["'.]+$/g, '')
      .split(/\s*\.{3,}\s*/)
      .filter(Boolean);
    if (!parts.length) return false;

    let from = 0;
    for (const part of parts) {
      if (part.length < EVIDENCE_MIN_FRAGMENT_CHARS) return false;
      const at = haystack.indexOf(part, from);
      if (at === -1) return false;
      from = at + part.length;
    }
    return true;
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

  /**
   * Arrangement signal from regex. Evidence only — never FAIL.
   * The AI compatibility pass owns every hard reject decision, because regex
   * cannot tell a mandate ("must be onsite") from context ("hybrid cloud").
   */
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

    if (hybrid && radius) {
      pushCriterion(
        criteria,
        'arrangement',
        'warn',
        'JD reads hybrid with an office-radius requirement; confirm remote is possible.'
      );
      return;
    }
    if (radius && !remoteYes) {
      pushCriterion(
        criteria,
        'arrangement',
        'warn',
        'JD mentions living near an office; confirm whether that is required.'
      );
      return;
    }
    if (onsite) {
      pushCriterion(
        criteria,
        'arrangement',
        'warn',
        'JD looks onsite-only, but template roles are Remote.'
      );
      return;
    }
    if (hybrid && !remoteYes) {
      pushCriterion(
        criteria,
        'arrangement',
        'warn',
        'JD mentions hybrid; confirm office attendance is not mandatory.'
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

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function titleCaseState(key) {
    return String(US_STATES[key] || key).replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Accepts "FL", "Florida", or "Bradenton, FL". */
  function normalizeUsState(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const last = raw.split(',').pop().trim();
    if (US_STATES[last]) return last;
    if (US_STATES[raw]) return raw;
    for (const [abbr, full] of Object.entries(US_STATES)) {
      if (raw === full || last === full) return abbr;
    }
    return '';
  }

  function sentencesMatching(jd, pattern) {
    return String(jd || '')
      .split(/(?<=[.!?;:\n])\s+/)
      .filter((sentence) => pattern.test(sentence));
  }

  /**
   * States named in a fragment. Abbreviations must be upper-case in the source
   * so ordinary words like "in", "or", and "me" are not read as states.
   */
  function statesMentioned(text) {
    const found = new Set();
    const source = String(text || '');
    for (const [abbr, full] of Object.entries(US_STATES)) {
      if (new RegExp(`\\b${full}\\b`, 'i').test(source)) found.add(abbr);
    }
    for (const token of source.match(/\b[A-Z]{2}\b/g) || []) {
      const key = token.toLowerCase();
      if (US_STATES[key]) found.add(key);
    }
    return found;
  }

  function timeZoneOfState(stateKey) {
    for (const [zone, states] of Object.entries(STATE_TIME_ZONE)) {
      if (states.includes(stateKey)) return zone;
    }
    return '';
  }

  /** Higher = stricter. AI may tighten heuristic, never loosen warn/fail. */
  const GEO_STATUS_RANK = { fail: 3, warn: 2, pending: 1, info: 1, pass: 0 };

  function geoStatusRank(status) {
    return GEO_STATUS_RANK[status] || 0;
  }

  /**
   * True when a sentence's office/travel wording is explicitly optional / 0% / annual retreat.
   */
  function sentenceHasGeoException(sentence) {
    return GEO_CONTEXTUAL_EXCEPTION.test(String(sentence || ''));
  }

  /**
   * Surface travel expectations as a warning. Regex never rejects a job — the
   * AI pass decides whether a stated percentage actually exceeds the
   * candidate's configured maximum.
   * @returns {{ status:'warn', message:string }|null}
   */
  function evaluateTravelPercent(jd) {
    const text = String(jd || '');
    const sentences = text.split(/(?<=[.!?;:\n])\s+/);
    for (const sentence of sentences) {
      if (!/\btravel\b/i.test(sentence)) continue;
      if (sentenceHasGeoException(sentence)) continue;

      const pctMatches = [
        ...sentence.matchAll(/(\d{1,3})\s*%/g),
        ...sentence.matchAll(/(?:up\s+to|approximately|about|around)\s+(\d{1,3})\s*%/gi),
      ];
      for (const m of pctMatches) {
        const pct = Number(m[1]);
        if (!Number.isFinite(pct)) continue;
        if (pct > 10) {
          return { status: 'warn', message: `JD mentions ${pct}% travel; confirm it is acceptable.` };
        }
      }

      if (
        /\b(?:extensive|significant|frequent|heavy|substantial)\s+travel\b/i.test(sentence) ||
        /\btravel\s+(?:extensively|frequently|often|regularly)\b/i.test(sentence)
      ) {
        return { status: 'warn', message: 'JD mentions frequent travel; verify the actual percentage.' };
      }
    }
    return null;
  }

  /**
   * Heuristic geo evaluation with two tiers:
   *
   * FAIL (hard — returned immediately, AI cannot override):
   *   explicit office-days, RESIDENCY_SCOPE mandate, REMOTE_BAIT, residency radius,
   *   state exclusion, timezone-only restriction, travel >25%, non-US scope.
   *
   * WARN (soft — accumulated, AI may resolve to PASS or FAIL):
   *   plain "hybrid" without explicit office days, hub-city preference language,
   *   hub cities in location line, state density without mandate, travel 10-25%,
   *   soft state fallback (states named but not profile's without hard mandate).
   *
   * PASS: nationwide remote signal, or no disqualifying signals.
   */
  function evaluateGeoFitHeuristic(jd, profileState, profileCity, criteria) {
    if (!jd) {
      pushCriterion(criteria, 'geo', 'pass', 'Skipped (no JD).');
      return;
    }
    const stateKey = normalizeUsState(profileState);
    if (!stateKey) {
      pushCriterion(criteria, 'geo', 'info', 'Profile has no US state saved; geo screen skipped.');
      return;
    }
    const stateLabel = titleCaseState(stateKey);
    const city = String(profileCity || '').trim();
    const nearHub = city && new RegExp(`\\b${escapeRegExp(city)}\\b`, 'i').test(jd);

    // Every signal below is a hint for the reader and a prompt for the AI pass.
    // The first one found wins, so the card shows the most specific concern.
    let warnMsg = null;
    const note = (msg) => {
      if (!warnMsg) warnMsg = msg;
    };

    const travelResult = evaluateTravelPercent(jd);
    if (travelResult) note(travelResult.message);

    if (NON_US_SCOPE.test(jd) && !US_SCOPE.test(jd) && !statesMentioned(jd).size) {
      note(`JD may be scoped outside the US; this profile is in ${stateLabel}.`);
    }

    for (const sentence of sentencesMatching(jd, RESIDENCY_SCOPE)) {
      if (STATE_LIST_NOISE.test(sentence) && /\$|salary|compensation|geo\s*[123]/i.test(sentence)) {
        continue;
      }
      const states = statesMentioned(sentence);
      if (!states.size) continue;

      if (EXCLUSION_SCOPE.test(sentence)) {
        if (states.has(stateKey)) note(`JD may exclude hiring in ${stateLabel}.`);
        continue;
      }
      if (!states.has(stateKey)) {
        const listed = [...states].slice(0, 6).map(titleCaseState).join(', ');
        note(`JD names a hiring scope of ${listed}; this profile is in ${stateLabel}.`);
      }
      break;
    }

    for (const sentence of String(jd || '').split(/(?<=[.!?;:\n])\s+/)) {
      if (!sentence || STATE_LIST_NOISE.test(sentence)) continue;
      const states = statesMentioned(sentence);
      if (states.size < 2 || states.has(stateKey)) continue;
      const listed = [...states].slice(0, 6).map(titleCaseState).join(', ');
      note(`JD lists states (${listed}) without ${stateLabel}; verify hiring scope.`);
      break;
    }

    for (const sentence of String(jd || '').split(/(?<=[.!?;:\n])\s+/)) {
      if (!sentence || sentenceHasGeoException(sentence)) continue;
      if (OFFICE_DAYS.test(sentence)) {
        note('JD mentions in-office days; confirm attendance is not mandatory.');
        break;
      }
      if (REMOTE_BAIT.test(sentence)) {
        note('JD hints at remote-to-start or a return-to-office plan.');
        break;
      }
      if (HYBRID.test(sentence)) {
        note('JD mentions "hybrid"; verify whether office attendance is required.');
      }
    }

    if (RESIDENCY_RADIUS.test(jd) && !nearHub) {
      const radiusSentence = sentencesMatching(jd, RESIDENCY_RADIUS)[0] || '';
      if (!sentenceHasGeoException(radiusSentence)) {
        note(`JD mentions living near an office; this profile is in ${city || stateLabel}.`);
      }
    }

    if (HUB_CITIES.test(jd) && HUB_PREFERENCE.test(jd) && !nearHub) {
      note('JD references hub cities with proximity language; likely a preference.');
    }

    if (HUB_CITIES.test(jd) && !NATIONWIDE_REMOTE.test(jd) && !nearHub) {
      const locLine = /\blocation(?:\s*type)?\s*:\s*[^\n]{0,120}/i.exec(jd);
      if (locLine && HUB_CITIES.test(locLine[0]) && !/\bremote\b/i.test(locLine[0])) {
        note('JD location line lists hub cities without "remote".');
      }
    }

    const zoneMatch = jd.match(TIME_ZONE_CONSTRAINT);
    if (zoneMatch) {
      const named = String(zoneMatch[1] || zoneMatch[2] || zoneMatch[0] || '').toLowerCase();
      const zone = /pacific|pst|pdt/.test(named) ? 'pacific'
        : /eastern|est|edt/.test(named) ? 'eastern'
        : /central|cst|cdt/.test(named) ? 'central'
        : /mountain|mst|mdt/.test(named) ? 'mountain'
        : '';
      if (zone && zone !== timeZoneOfState(stateKey)) {
        note(`JD mentions ${zone} time zone; this profile is in ${stateLabel}.`);
      }
    }

    const allStates = statesMentioned(jd);
    if (allStates.size > 0 && !allStates.has(stateKey) && !NATIONWIDE_REMOTE.test(jd)) {
      const listed = [...allStates].slice(0, 6).map(titleCaseState).join(', ');
      note(`JD mentions ${listed} but not ${stateLabel}; verify hiring scope.`);
    }

    if (warnMsg) {
      pushCriterion(criteria, 'geo', 'warn', warnMsg);
      return;
    }

    if (NATIONWIDE_REMOTE.test(jd)) {
      pushCriterion(criteria, 'geo', 'pass', 'JD reads as nationwide / work-from-anywhere US remote.');
      return;
    }

    pushCriterion(criteria, 'geo', 'pass', `Location/travel rules pass for ${stateLabel}.`);
  }

  /**
   * Geo row: regex evidence, resolved by the AI compatibility pass when present.
   *
   * Hard rejects live in the `compatibility` criterion, which requires an
   * evidence quote. This row therefore tops out at WARN so a regex hint can
   * never discard a job on its own.
   */
  function evaluateGeoFit(jd, profileState, profileCity, criteria, aiCompat) {
    if (aiCompat && aiCompat.status === 'pending') {
      pushCriterion(criteria, 'geo', 'info', 'Location check in progress…');
      return;
    }

    const heuristic = [];
    evaluateGeoFitHeuristic(jd, profileState, profileCity, heuristic);
    const h = heuristic.find((c) => c.id === 'geo') || { status: 'pass', message: 'No geo signal.' };

    // When the AI has looked at this posting and raised no location blocker,
    // its judgment supersedes the regex hint.
    if (h.status === 'warn' && aiCompat && aiCompat.status === 'done') {
      const locationBlocked = (aiCompat.blockers || []).some(
        (b) => b.category === 'location' || b.category === 'onsite'
      );
      if (!locationBlocked) {
        pushCriterion(criteria, 'geo', 'pass', 'Location reviewed by AI; no blocking requirement found.');
        return;
      }
    }

    pushCriterion(criteria, 'geo', h.status, h.message);
  }

  /** Wording that makes a clearance a requirement rather than a mention. */
  const CLEARANCE_REQUIRED =
    /\b(?:active|current|existing)\b[^.\n]{0,40}\bclearance\b|\b(?:ts\/sci|top secret|secret|public trust)\b[^.\n]{0,30}\bclearance\b[^.\n]{0,40}\b(?:required|must|needed|necessary)\b|\bmust\s+(?:hold|have|possess|maintain)\b[^.\n]{0,60}\bclearance\b|\bclearance\s+(?:is\s+)?required\b/i;

  /**
   * In-office days where the office is named ("3 days per week in our Seattle
   * office", "in the office two days a week"), which OFFICE_DAYS does not reach.
   */
  const OFFICE_DAYS_NAMED =
    /\b(?:\d|one|two|three|four|five)\s*(?:[-–]|to)?\s*(?:\d|two|three|four|five)?\s*days?\s+(?:a|per|each|every)\s+week\b[^.\n]{0,50}\b(?:office|on[\s-]?site|in[\s-]?person|hq|headquarters)\b|\b(?:office|on[\s-]?site|in[\s-]?person)\b[^.\n]{0,30}\b(?:\d|one|two|three|four|five)\s*days?\s+(?:a|per|each|every)\s+week\b/i;

  /**
   * Spoken languages a posting may demand. Programming languages are
   * deliberately absent, and the match is case-sensitive so "polish the UI"
   * is not read as Polish.
   */
  const SPOKEN_LANGUAGE =
    /\b(Spanish|French|German|Mandarin|Chinese|Cantonese|Japanese|Korean|Portuguese|Italian|Dutch|Arabic|Hindi|Russian|Polish|Hebrew|Turkish|Vietnamese|Thai|Swedish|Danish|Norwegian|Finnish|Czech|Greek|Ukrainian|Romanian|Hungarian|Indonesian|Malay|Tagalog|Bengali|Urdu|Punjabi)\b/;
  const LANGUAGE_DEMAND =
    /\b(fluen\w*|proficien\w*|native|bilingual|multilingual|speak\w*|spoken|written|business[\s-]level|professional[\s-]working|command of|required|must|mandatory|essential)\b/i;
  const LANGUAGE_OPTIONAL =
    /\b(a plus|is a plus|plus\b|preferred|nice to have|bonus|advantage|desirable|helpful|optional|not required|ideally|asset)\b/i;

  /** Right to work somewhere other than the US ("authorized to work in Canada"). */
  const WORK_AUTH_PHRASE =
    /\b(?:authori[sz]ed|authori[sz]ation|eligib\w+|right|permit|visa|legally (?:able|entitled))\b[^.\n]{0,50}\bwork\b|\bwork\b[^.\n]{0,20}\b(?:permit|authori[sz]ation|visa)\b/i;

  const SIGNAL_MAX = 8;
  const SIGNAL_MAX_CHARS = 320;

  function splitSentences(text) {
    return String(text || '')
      .split(/(?<=[.!?;])\s+|\n+/)
      .map((s) => s.replace(/^[-•*·]\s+/, '').trim())
      .filter(Boolean);
  }

  /**
   * Sentences the local rules consider possible hard blockers, for the AI to
   * rule on one by one.
   *
   * The AI is the judge, but left alone it can skim past a requirement buried
   * in a long posting. Pointing it at each candidate sentence — and treating a
   * strong one it never answered as unresolved — closes that gap without
   * letting a regex reject a job by itself.
   *
   * @returns {Array<{ index:number, category:string, strength:'strong'|'weak', sentence:string }>}
   */
  function collectHardSignals(jd, { profileState } = {}) {
    const stateKey = normalizeUsState(profileState);
    const out = [];
    const seen = new Set();
    const add = (category, strength, sentence) => {
      const text = String(sentence || '').replace(/\s+/g, ' ').trim().slice(0, SIGNAL_MAX_CHARS);
      if (text.length < 12 || out.length >= SIGNAL_MAX) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ index: out.length + 1, category, strength, sentence: text });
    };

    const sentences = splitSentences(jd);
    // Strong signals first so the cap never crowds them out.
    for (const s of sentences) {
      if (CLEARANCE_REQUIRED.test(s)) add('clearance', 'strong', s);
    }
    for (const s of sentences) {
      if (sentenceHasGeoException(s)) continue;
      if (OFFICE_DAYS.test(s) || OFFICE_DAYS_NAMED.test(s) || ONSITE_ONLY.test(s)) {
        add('onsite', 'strong', s);
      } else if (RESIDENCY_RADIUS.test(s) && !(stateKey && statesMentioned(s).has(stateKey))) {
        // "Must reside in <the candidate's own state>" is satisfied, not a lead.
        add('location', 'strong', s);
      }
    }
    for (const s of sentences) {
      if (!RESIDENCY_SCOPE.test(s)) continue;
      if (STATE_LIST_NOISE.test(s) && /\$|salary|compensation|geo\s*[123]/i.test(s)) continue;
      const states = statesMentioned(s);
      const excludesProfile = EXCLUSION_SCOPE.test(s) && stateKey && states.has(stateKey);
      const omitsProfile = !EXCLUSION_SCOPE.test(s) && states.size > 0 && stateKey && !states.has(stateKey);
      if (excludesProfile || omitsProfile) add('location', 'strong', s);
      else if (NON_US_SCOPE.test(s) && !US_SCOPE.test(s)) add('location', 'strong', s);
    }
    for (const s of sentences) {
      // The candidate speaks only English, so a demanded second language is a lead.
      if (SPOKEN_LANGUAGE.test(s) && LANGUAGE_DEMAND.test(s)) {
        add('language', LANGUAGE_OPTIONAL.test(s) ? 'weak' : 'strong', s);
      } else if (/\bbilingual\b/i.test(s)) {
        add('language', LANGUAGE_OPTIONAL.test(s) ? 'weak' : 'strong', s);
      }
      // Authorised to work in the US only.
      if (WORK_AUTH_PHRASE.test(s) && NON_US_SCOPE.test(s) && !US_SCOPE.test(s)) {
        add('eligibility', 'strong', s);
      }
    }
    for (const s of sentences) {
      if (sentenceHasGeoException(s)) continue;
      if (REMOTE_BAIT.test(s)) add('onsite', 'weak', s);
      else if (HYBRID.test(s)) add('onsite', 'weak', s);
      else if (TIME_ZONE_CONSTRAINT.test(s)) add('location', 'weak', s);
    }
    return out;
  }

  /**
   * Strong signals the AI neither ruled on nor quoted in a blocker. They are
   * surfaced as warnings: an unanswered requirement is not a cleared one.
   */
  function unresolvedSignals(aiCompat) {
    const signals = Array.isArray(aiCompat?.signals) ? aiCompat.signals : [];
    if (!signals.length) return [];
    // Only a "not a blocker" ruling clears a signal. A "hard_blocker" ruling
    // that never made it into the blockers list is still an open question.
    const reviewed = new Set(
      (Array.isArray(aiCompat.signalReviews) ? aiCompat.signalReviews : [])
        .filter((r) => r?.decision !== 'hard_blocker')
        .map((r) => Number(r?.index))
        .filter(Number.isFinite)
    );
    const quoted = (Array.isArray(aiCompat.blockers) ? aiCompat.blockers : [])
      .map((b) => normalizeQuote(b?.evidence))
      .filter((q) => q.length >= EVIDENCE_MIN_FRAGMENT_CHARS);
    return signals.filter((signal) => {
      if (signal.strength !== 'strong' || reviewed.has(signal.index)) return false;
      const sentence = normalizeQuote(signal.sentence);
      return !quoted.some((q) => sentence.includes(q) || q.includes(sentence));
    });
  }

  /**
   * 'pending' = call in flight, 'done' = verdict available, 'error' = call
   * failed, 'unavailable' = never ran (no API key, or nothing cached).
   */
  function aiCompatStatus(aiCompat) {
    const status = aiCompat?.status;
    return status === 'pending' || status === 'done' || status === 'error'
      ? status
      : 'unavailable';
  }

  /**
   * The only criterion allowed to reject a job outright.
   *
   * Accepts a FAIL only for an evidence-backed hard blocker that passed
   * `validateHardBlockers`. Everything the model was unsure about, every
   * preference, and every missing-information case lands on WARN so the job
   * stays copyable and the user decides.
   */
  function evaluateCompatibility(jd, criteria, aiCompat) {
    if (!jd) {
      pushCriterion(criteria, 'compatibility', 'pass', 'Skipped (no JD).');
      return;
    }
    const status = aiCompatStatus(aiCompat);
    if (status === 'pending') {
      pushCriterion(criteria, 'compatibility', 'info', 'Checking compatibility…');
      return;
    }
    // No AI verdict is not a verdict: say so and let the local rules speak.
    if (status === 'error') {
      pushCriterion(
        criteria,
        'compatibility',
        'info',
        `AI check failed: ${aiCompat.message || 'unknown error'}`
      );
      return;
    }
    if (status === 'unavailable') {
      pushCriterion(criteria, 'compatibility', 'info', 'AI check not run — local rules only.');
      return;
    }

    const { accepted, rejected } = validateHardBlockers(aiCompat.blockers, jd);

    // One clear row per issue (no truncated "+N more") so users can decide on Copy Prompt.
    // Only the first row keeps the compatibility weight so the score is not multiplied.
    if (accepted.length) {
      accepted.forEach((b, i) => {
        const evidence = String(b.evidence || '').replace(/\s+/g, ' ').trim();
        const msg = evidence
          ? `${b.conflict} — JD states: “${evidence}”`
          : String(b.conflict || 'Hard blocker');
        pushCriterion(criteria, 'compatibility', 'fail', msg, {
          blockers: i === 0 ? accepted : undefined,
          weight: i === 0 ? WEIGHTS.compatibility : 0,
        });
      });
      return;
    }

    // A claimed blocker that failed the evidence gate is still worth surfacing,
    // but only as something to check — never as a reject.
    const warnings = Array.isArray(aiCompat.warnings) ? aiCompat.warnings : [];
    const softNotes = [
      ...rejected.map((r) => r.conflict || r.category).filter(Boolean),
      ...warnings
        .map((w) => (typeof w === 'string' ? w : w?.note || w?.category))
        .filter(Boolean),
      ...unresolvedSignals(aiCompat).map(
        (signal) => `AI did not rule on this ${signal.category} requirement — check it: “${signal.sentence}”`
      ),
    ];

    if (softNotes.length) {
      softNotes.forEach((note, i) => {
        pushCriterion(criteria, 'compatibility', 'warn', String(note), {
          softNotes: i === 0 ? softNotes : undefined,
          weight: i === 0 ? WEIGHTS.compatibility : 0,
        });
      });
      return;
    }

    pushCriterion(
      criteria,
      'compatibility',
      'pass',
      aiCompat.summary || 'No blocking requirement found for this profile.'
    );
  }

  function truncate(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
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
        'warn',
        'JD domain may not be a software/engineering role for this template.'
      );
      return;
    }
    if (analyst && !swe) {
      pushCriterion(
        criteria,
        'domain',
        'warn',
        'JD reads like reporting/ops analyst work rather than an SWE template fit.'
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
    const geo = criteria.find((c) => c.id === 'geo');
    const compat = criteria.find((c) => c.id === 'compatibility');
    if (arr?.status === 'pass') score += 4;
    if (dom?.status === 'pass') score += 4;
    if (geo?.status === 'pass') score += 3;
    // An AI pass on compatibility is the strongest single signal available.
    if (compat?.status === 'pass') score += 8;

    // A hard fail means "skip", so the headline number must not read like a pass.
    if (weightFail > 0) score = Math.min(score, 45);
    // A warn (e.g. hub/hybrid) means "risky" — never show 100.
    else if (weightWarn > 0) score = Math.min(score, 72);

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
    profileState,
    profileCity,
    aiCompat,
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
    evaluateCompatibility(jd, criteria, aiCompat);

    // Until AI settles, hide regex geo/arrangement/domain noise so the card
    // does not flash a temporary heuristic verdict that AI later replaces.
    const aiStatus = aiCompatStatus(aiCompat);
    const aiWaiting = Boolean(jd) && aiStatus === 'pending';
    if (!aiWaiting) {
      evaluateArrangement(jd, roles, isV9, isFictional, criteria);
      evaluateGeoFit(jd, profileState, profileCity, criteria, aiCompat);
      evaluateDomain(jd, roles, criteria);
    }

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

    // Gate the warning UI on AI compatibility (plus hard fails like missing JD/kit).
    // Soft heuristic warns (geo/arrangement/domain) must not show "Weak" when AI is clean.
    const aiCompatFail = criteria.some((c) => c.id === 'compatibility' && c.status === 'fail');
    const aiCompatWarn = criteria.some((c) => c.id === 'compatibility' && c.status === 'warn');
    const aiCompatChecking = aiWaiting;
    const aiFailed = aiStatus === 'error';
    // With no AI verdict to supersede them, the soft heuristic warns are the
    // only screen left, so they must reach the user.
    const aiMissing = aiFailed || aiStatus === 'unavailable';
    const heuristicWarn =
      aiMissing &&
      criteria.some(
        (c) => (c.id === 'geo' || c.id === 'arrangement' || c.id === 'domain') && c.status === 'warn'
      );

    let level = 'ready';
    if (hasFail) level = 'blocked';
    else if (aiCompatWarn || heuristicWarn) level = 'risky';

    // Problems only: clear blocker/warning reasons. Clean AI → no warning list.
    let displayReasons = [];
    if (level === 'blocked' || level === 'risky') {
      const blocks = reasons.filter((r) => r.severity === 'block');
      const warns = reasons.filter((r) => r.severity === 'warn');
      // Prefer AI compatibility rows first, then other hard fails.
      const compatBlocks = blocks.filter((r) => r.criterion === 'compatibility');
      const otherBlocks = blocks.filter((r) => r.criterion !== 'compatibility');
      const compatWarns = warns.filter((r) => r.criterion === 'compatibility');
      const otherWarns =
        level === 'blocked' || aiMissing ? warns.filter((r) => r.criterion !== 'compatibility') : [];
      displayReasons = [...compatBlocks, ...otherBlocks, ...compatWarns, ...otherWarns];
      // If somehow empty, fall back to all block/warn rows.
      if (!displayReasons.length) {
        displayReasons = [...blocks, ...warns];
      }
    }
    // After a failed call, carry the provider's error so the user can act on it.
    if (aiFailed) {
      const notice = reasons.find(
        (r) => r.criterion === 'compatibility' && r.severity === 'info'
      );
      if (notice) displayReasons = [...displayReasons, notice];
    }

    // A wrong AI blocker must not strand the user; missing JD / broken kit stay hard.
    const failed = criteria.filter((c) => c.status === 'fail');
    const overridable = failed.length > 0 && failed.every((c) => c.id === 'compatibility');

    return {
      level,
      score,
      reasons: displayReasons,
      criteria,
      canCopy: !hasFail,
      overridable,
      requireConfirm: level === 'risky',
      aiChecking: aiCompatChecking,
      aiFailed,
      aiRan: aiStatus === 'done',
      aiHasProblem: aiCompatFail || aiCompatWarn,
      flavor,
      mode: runSettings.mode,
      overlap: keywordOverlapScore(jdNorm, roles),
    };
  }

  function summarizeFit(result) {
    if (!result) return 'Preflight: —';
    if (result.aiChecking) return 'Checking compatibility…';
    if (result.level === 'blocked') return 'Skip — don’t waste a ChatGPT run';
    if (result.level === 'risky') return 'Review before Copy Prompt';
    if (result.aiFailed) return 'Local rules passed';
    return 'OK — copy to ChatGPT';
  }

  global.SmartJobBidFitPreflight = {
    evaluateBidFit,
    summarizeFit,
    detectKitFlavor,
    parseRunSettings,
    parseResumeTemplate,
    validateHardBlockers,
    collectHardSignals,
    unresolvedSignals,
    APPROVED_HARD_BLOCKERS,
    HARD_BLOCKER_MIN_CONFIDENCE,
    WEIGHTS,
    MIN_JD_CHARS,
  };
})(typeof window !== 'undefined' ? window : self);
