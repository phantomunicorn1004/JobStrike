/**
 * HiringCafe scrape helpers for the extension (browser-side).
 * Mirrors website search defaults + field mapping; fetch happens via a real tab.
 */
(function (global) {
  const HIRING_CAFE_BASE = 'https://hiringcafe.com/';

  const DEFAULT_SEARCH_STATE = {
    locations: [
      {
        id: 'FxY1yZQBoEtHp_8UEq7V',
        types: ['country'],
        address_components: [
          {
            long_name: 'United States',
            short_name: 'US',
            types: ['country'],
          },
        ],
        formatted_address: 'United States',
        population: 327167434,
        workplace_types: ['Remote'],
        options: {
          flexible_regions: ['anywhere_in_world', 'anywhere_in_continent'],
        },
      },
    ],
    commitmentTypes: ['Full Time', 'Part Time', 'Contract', 'Temporary', 'Seasonal'],
    dateFetchedPastNDays: 1,
    departments: [
      'Engineering',
      'Software Development',
      'Information Technology',
      'Data and Analytics',
    ],
    excludeAllLicensesAndCertifications: true,
    securityClearances: ['None'],
    sortBy: 'date',
    jobTitleQuery:
      'NOT ("Consultant" OR "Manager" OR "Director") AND ("Software" OR "Data" OR "AI" OR "Developer" OR "Engineer")',
  };

  /** Host is the domain or a subdomain of it — "lever.co" must not claim clever.com. */
  const on = (host, domain) => host === domain || host.endsWith(`.${domain}`);

  const PLATFORM_RULES = [
    ['Greenhouse', (h) => on(h, 'greenhouse.io')],
    ['Lever', (h) => on(h, 'lever.co')],
    ['Workday', (h) => on(h, 'myworkdayjobs.com') || on(h, 'myworkdaysite.com') || on(h, 'workday.com')],
    ['iCIMS', (h) => on(h, 'icims.com')],
    ['Gem', (h) => on(h, 'jobs.gem.com')],
    ['Ashby', (h) => on(h, 'ashbyhq.com')],
    ['Rippling', (h) => on(h, 'rippling.com') || on(h, 'atsrecruiting.com')],
    ['Jobvite', (h) => on(h, 'jobvite.com')],
    ['SmartRecruiters', (h) => on(h, 'smartrecruiters.com')],
    ['BambooHR', (h) => on(h, 'bamboohr.com')],
    ['Taleo', (h) => on(h, 'taleo.net')],
    ['Indeed', (h) => on(h, 'indeed.com')],
    ['LinkedIn', (h) => on(h, 'linkedin.com')],
    ['Wellfound', (h) => on(h, 'wellfound.com') || on(h, 'angel.co')],
    ['Recruitee', (h) => on(h, 'recruitee.com')],
    ['Breezy', (h) => on(h, 'breezy.hr')],
    ['Workable', (h) => on(h, 'workable.com')],
    ['JazzHR', (h) => on(h, 'jazz.co') || on(h, 'applytojob.com')],
    ['Oracle HCM', (h) => on(h, 'oraclecloud.com')],
    ['SuccessFactors', (h) => on(h, 'successfactors.com') || on(h, 'sapsf.com') || on(h, 'successfactors.eu') || on(h, 'hr.cloud.sap') || on(h, 'jobs2web.com')],
    ['ADP', (h) => on(h, 'adp.com')],
    ['UKG', (h) => on(h, 'ultipro.com') || on(h, 'ukg.com') || on(h, 'ukg.net') || on(h, 'entertimeonline.com')],
    ['Dayforce', (h) => on(h, 'dayforcehcm.com')],
    ['Paylocity', (h) => on(h, 'paylocity.com')],
    ['Paycom', (h) => on(h, 'paycomonline.net')],
    ['Avature', (h) => on(h, 'avature.net')],
    ['Eightfold', (h) => on(h, 'eightfold.ai')],
    ['Njoyn', (h) => on(h, 'njoyn.com')],
    ['Teamtailor', (h) => on(h, 'teamtailor.com')],
    ['Pinpoint', (h) => on(h, 'pinpointhq.com')],
    // Seen as bare hostnames in real exports.
    ['Paycor', (h) => on(h, 'recruitingbypaycor.com') || on(h, 'paycor.com')],
    ['Personio', (h) => on(h, 'personio.com') || on(h, 'personio.de')],
    ['Dover', (h) => on(h, 'dover.com')],
    ['Jibe', (h) => on(h, 'jibeapply.com')],
    ['isolved', (h) => on(h, 'isolvedhire.com')],
    ['BrassRing', (h) => on(h, 'brassring.com')],
    ['CATS', (h) => on(h, 'catsone.com')],
    ['HiringThing', (h) => on(h, 'hiringthing.com')],
    ['Comeet', (h) => on(h, 'comeet.com')],
    ['JOIN', (h) => on(h, 'join.com')],
    ['Kula', (h) => on(h, 'kula.ai')],
    ['Recruiterflow', (h) => on(h, 'recruiterflow.com')],
    ['JobDiva', (h) => on(h, 'jobdiva.com')],
    ['Fountain', (h) => on(h, 'fountain.com')],
    ['Infor', (h) => on(h, 'inforcloudsuite.com')],
    ['RippleHire', (h) => on(h, 'ripplehire.com')],
    ['Jobsoid', (h) => on(h, 'jobsoid.com')],
    ['Ceipal', (h) => on(h, 'ceipal.com')],
    ['Manatal', (h) => on(h, 'careers-page.com')],
  ];

  /**
   * Freshness window: `2h` / `4h` / `8h` / `1d` / `3d` / …
   * HC API only accepts whole days (`dateFetchedPastNDays`); hour windows
   * use hcDays=1 server-side, then a local ms cutoff.
   */
  function parseFreshnessWindow(dateWindow) {
    if (typeof dateWindow === 'number' && Number.isFinite(dateWindow)) {
      const days = Math.max(1, Math.round(dateWindow));
      return { kind: 'days', amount: days, label: `${days}d`, hcDays: days };
    }
    const raw = String(dateWindow || '').trim().toLowerCase();
    const hourMatch = raw.match(/^(\d+)\s*h$/);
    if (hourMatch) {
      const hours = Math.max(1, Number(hourMatch[1]));
      return { kind: 'hours', amount: hours, label: `${hours}h`, hcDays: 1 };
    }
    const dayMatch = raw.match(/^(\d+)\s*d$/);
    if (dayMatch) {
      const days = Math.max(1, Number(dayMatch[1]));
      return { kind: 'days', amount: days, label: `${days}d`, hcDays: days };
    }
    const bare = raw.match(/^(\d+)$/);
    if (bare) {
      const days = Math.max(1, Number(bare[1]));
      return { kind: 'days', amount: days, label: `${days}d`, hcDays: days };
    }
    return { kind: 'days', amount: 3, label: '3d', hcDays: 3 };
  }

  function dateWindowFromDays(days) {
    const n = Math.max(1, Math.round(Number(days) || 3));
    if (n === 1) return '1d';
    if (n === 2) return '2d';
    if (n === 7) return '7d';
    if (n === 3) return '3d';
    return `${n}d`;
  }

  /** Days to send to HiringCafe (hour windows → 1). */
  /**
   * Days for HiringCafe's search. It returns almost nothing for exactly 2
   * (8 jobs, against 19,494 for 1, 3 or 7 in a test), so 2 days searches 3;
   * the panel then keeps only jobs inside the 2-day window.
   */
  function dateWindowDays(dateWindow) {
    const days = parseFreshnessWindow(dateWindow).hcDays;
    return days === 2 ? 3 : days;
  }

  function dateWindowLabel(dateWindow) {
    return parseFreshnessWindow(dateWindow).label;
  }

  function dateWindowCutoffMs(dateWindow, nowMs = Date.now()) {
    const parsed = parseFreshnessWindow(dateWindow);
    if (parsed.kind === 'hours') {
      return nowMs - parsed.amount * 60 * 60 * 1000;
    }
    return nowMs - parsed.amount * 24 * 60 * 60 * 1000;
  }

  function cloneDefaultSearchState(dateWindow) {
    return {
      ...DEFAULT_SEARCH_STATE,
      dateFetchedPastNDays: dateWindowDays(dateWindow || '8h'),
    };
  }

  function buildSearchState(dateWindow, customSearchState) {
    if (customSearchState && typeof customSearchState === 'object') {
      return {
        ...customSearchState,
        dateFetchedPastNDays: dateWindowDays(dateWindow),
      };
    }
    return cloneDefaultSearchState(dateWindow);
  }

  /**
   * Remote contract jobs open to candidates in one country. HiringCafe's own
   * default search names the visitor's country the same way (id "user_country"),
   * and its flexible regions add jobs open to that continent or the world.
   */
  function countryLocation(code, name) {
    const country = String(code || '').trim().toUpperCase();
    const label = String(name || country).trim();
    return {
      formatted_address: label,
      types: ['country'],
      geometry: { location: { lat: 0, lon: 0 } },
      id: 'user_country',
      address_components: [{ long_name: label, short_name: country, types: ['country'] }],
      workplace_types: ['Remote'],
      options: { flexible_regions: ['anywhere_in_continent', 'anywhere_in_world'] },
    };
  }

  function countrySearchState(code, name) {
    return {
      ...DEFAULT_SEARCH_STATE,
      locations: [countryLocation(code, name)],
      commitmentTypes: ['Contract'],
    };
  }

  /**
   * "Any country": every continent, through the largest remote-contract markets.
   * Each adds jobs open to its continent or the world. Listing all countries
   * makes an address HiringCafe refuses (37 KB); these 18 make 9 KB.
   */
  const ANY_COUNTRY_CODES = ['GB', 'DE', 'PL', 'UA', 'RO', 'BR', 'AR', 'CO', 'MX', 'CA', 'IN', 'PK', 'PH', 'VN', 'ZA', 'NG', 'EG', 'AU'];
  function anyCountrySearchState() {
    let names = null;
    try {
      names = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch (_) {
      names = null;
    }
    return {
      ...DEFAULT_SEARCH_STATE,
      locations: ANY_COUNTRY_CODES.map((code) => countryLocation(code, names?.of(code) || code)),
      commitmentTypes: ['Contract'],
    };
  }

  function buildHiringCafeUrl(dateWindow, page, customSearchState) {
    const url = new URL(HIRING_CAFE_BASE);
    url.searchParams.set(
      'searchState',
      JSON.stringify(buildSearchState(dateWindow, customSearchState))
    );
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  /**
   * Parse searchState from a HiringCafe URL, pasted query, or raw JSON object string.
   * @returns {{ ok: true, searchState: object, sourceUrl: string } | { ok: false, error: string }}
   */
  function parseSearchStateFromInput(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
      return { ok: false, error: 'Paste a HiringCafe URL that includes searchState.' };
    }

    let searchStateRaw = '';
    let sourceUrl = '';

    // Raw JSON object
    if (raw.startsWith('{')) {
      searchStateRaw = raw;
      sourceUrl = '';
    } else {
      try {
        let url;
        if (/^https?:\/\//i.test(raw)) {
          url = new URL(raw);
        } else if (/^(?:www\.)?(?:hiringcafe\.com|hiring\.cafe)\b/i.test(raw)) {
          // Copied without the scheme.
          url = new URL(`https://${raw}`);
        } else if (raw.includes('searchState=')) {
          url = new URL(raw.startsWith('?') ? raw : `?${raw}`, HIRING_CAFE_BASE);
        } else {
          return {
            ok: false,
            error: 'Paste a full HiringCafe URL, or text containing searchState=…',
          };
        }

        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if (
          host &&
          host !== 'hiringcafe.com' &&
          host !== 'hiring.cafe' &&
          !host.endsWith('.hiringcafe.com')
        ) {
          return {
            ok: false,
            error: 'URL must be from hiringcafe.com (or hiring.cafe).',
          };
        }

        searchStateRaw = url.searchParams.get('searchState') || '';
        sourceUrl = url.toString();
        if (!searchStateRaw) {
          return {
            ok: false,
            error: 'No searchState found in that URL. Set filters on HiringCafe, then copy the address bar URL.',
          };
        }
      } catch (_) {
        return { ok: false, error: 'Could not parse that URL.' };
      }
    }

    try {
      const parsed = JSON.parse(searchStateRaw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'searchState must be a JSON object.' };
      }
      return { ok: true, searchState: parsed, sourceUrl };
    } catch (err) {
      return {
        ok: false,
        error: `Invalid searchState JSON: ${err?.message || String(err)}`,
      };
    }
  }

  function summarizeSearchState(searchState) {
    if (!searchState || typeof searchState !== 'object') return 'Built-in default search';

    const parts = [];
    const days = Number(searchState.dateFetchedPastNDays);
    if (Number.isFinite(days) && days > 0) parts.push(`${days}d`);

    const loc = Array.isArray(searchState.locations) ? searchState.locations[0] : null;
    const workplace = Array.isArray(loc?.workplace_types)
      ? loc.workplace_types.join('/')
      : Array.isArray(searchState.workplaceTypes)
        ? searchState.workplaceTypes.join('/')
        : '';
    if (workplace) parts.push(workplace);

    const place =
      loc?.formatted_address ||
      loc?.address_components?.[0]?.short_name ||
      '';
    if (place) parts.push(place);

    const depts = Array.isArray(searchState.departments) ? searchState.departments : [];
    if (depts.length) {
      parts.push(
        depts.length <= 2
          ? depts.join(', ')
          : `${depts.slice(0, 2).join(', ')} +${depts.length - 2}`
      );
    }

    if (searchState.sortBy) parts.push(`sort:${searchState.sortBy}`);

    const title = String(searchState.jobTitleQuery || searchState.searchQuery || '').trim();
    if (title) {
      parts.push(title.length > 42 ? `${title.slice(0, 42)}…` : title);
    }

    const tech = String(searchState.technologyKeywordsQuery || '').trim();
    if (tech) parts.push('tech keywords');

    const hide = Array.isArray(searchState.hideJobTypes) ? searchState.hideJobTypes : [];
    if (hide.length) parts.push(`hide ${hide.join('/')}`);

    return parts.length ? parts.join(' · ') : 'Custom searchState imported';
  }

  function serializeField(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function detectPlatform(url) {
    if (!url || !String(url).trim()) return 'Unknown';
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const path = parsed.pathname.toLowerCase();
      for (const [name, rule] of PLATFORM_RULES) {
        if (rule(host, path)) return name;
      }
      return host || 'Unknown';
    } catch (_) {
      return 'Unknown';
    }
  }

  function extractJobFields(hit) {
    const jobInfo = hit?.job_information && typeof hit.job_information === 'object'
      ? hit.job_information
      : {};
    const processed =
      hit?.v5_processed_job_data && typeof hit.v5_processed_job_data === 'object'
        ? hit.v5_processed_job_data
        : {};
    const company =
      hit?.enriched_company_data && typeof hit.enriched_company_data === 'object'
        ? hit.enriched_company_data
        : {};
    // Open the posting, not its application form (Lever ".../apply").
    const applyUrl = (globalThis.SmartJobJobUrl?.postingPageUrl || ((link) => link))(serializeField(hit?.apply_url));

    return {
      id: serializeField(hit?.id),
      apply_url: applyUrl,
      title: serializeField(jobInfo.title),
      core_job_title: serializeField(processed.core_job_title),
      requirements_summary: serializeField(processed.requirements_summary),
      technical_tools: serializeField(processed.technical_tools),
      job_category: serializeField(processed.job_category),
      // The millisecond stamp is exact; the text form is the fallback.
      estimated_publish_date:
        typeof processed.estimated_publish_date_millis === 'number' &&
        Number.isFinite(processed.estimated_publish_date_millis) &&
        processed.estimated_publish_date_millis > 0
          ? new Date(processed.estimated_publish_date_millis).toISOString()
          : serializeField(processed.estimated_publish_date),
      is_expired: hit?.is_expired === true,
      // HiringCafe's own reading of the posting. Values seen in real runs:
      // security_clearance "None"; degree requirements "Required" / "Preferred" /
      // "Not Mentioned"; language_requirements ["English"]; workplace countries ["US", "CA"].
      security_clearance: serializeField(processed.security_clearance),
      masters_degree_requirement: serializeField(processed.masters_degree_requirement),
      doctorate_degree_requirement: serializeField(processed.doctorate_degree_requirement),
      language_requirements: Array.isArray(processed.language_requirements)
        ? processed.language_requirements.map((x) => String(x || '').trim()).filter(Boolean)
        : [],
      worldwide_ok: processed.is_workplace_worldwide_ok === true,
      workplace_countries: Array.isArray(processed.boundless_workplace_countries)
        ? processed.boundless_workplace_countries.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean)
        : [],
      role_activities: serializeField(processed.role_activities),
      // "Full Time", "Contract", "Part Time"…; a job can have several.
      employment_type: Array.isArray(processed.commitment)
        ? processed.commitment.map((x) => String(x || '').trim()).filter(Boolean).join(', ') || null
        : serializeField(processed.commitment),
      company_name:
        serializeField(company.name) ||
        serializeField(processed.company_name) ||
        serializeField(jobInfo.company_name) ||
        serializeField(hit?.company_name),
      company_tagline: serializeField(company.tagline),
      application_site: detectPlatform(applyUrl),
    };
  }

  function normalizeAtsName(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  function atsMatchesList(jobAts, atsList) {
    const atsKey = normalizeAtsName(jobAts);
    if (!atsKey || !Array.isArray(atsList) || atsList.length === 0) return false;
    return atsList.some((ats) => {
      const blocked = normalizeAtsName(ats);
      if (!blocked) return false;
      if (atsKey === blocked) return true;
      // An unrecognised ATS is stored as its host: match a whole domain or a whole
      // label of it ("adp" → workforcenow.adp.com), never a fragment (roadpass.com).
      if (!atsKey.includes('.')) return false;
      return on(atsKey, blocked) || atsKey.split('.').includes(blocked);
    });
  }

  function fallbackNormalizeCompanyName(value) {
    let name = String(value ?? '')
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (name.startsWith('the ')) name = name.slice(4).trim();
    return name;
  }

  function fallbackCompaniesMatch(a, b) {
    const left = fallbackNormalizeCompanyName(a);
    const right = fallbackNormalizeCompanyName(b);
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length < 4 || right.length < 4) return false;
    return left.includes(right) || right.includes(left);
  }

  function companiesMatch(a, b) {
    const matcher = global.SmartJobCompanyName?.companiesMatch || fallbackCompaniesMatch;
    return Boolean(matcher(a, b));
  }

  function companyMatchesBlocked(companyName, companyList) {
    if (!Array.isArray(companyList) || !companyList.length) return false;
    const name = String(companyName ?? '').trim();
    if (!name) return false;
    return companyList.some((blocked) => {
      const blockedName =
        typeof blocked === 'string'
          ? blocked
          : blocked?.companyName || blocked?.company || blocked?.name || '';
      return companiesMatch(name, blockedName);
    });
  }

  function normalizeTitle(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  function jobTitleCompanyMatch(job, ref) {
    const jobTitle = normalizeTitle(job?.title);
    const refTitle = normalizeTitle(ref?.jobTitle || ref?.title);
    const refCompany = ref?.companyName || ref?.company || '';
    if (!jobTitle || !refTitle || jobTitle !== refTitle) return false;
    return companiesMatch(job?.company_name, refCompany);
  }

  function jobMatchesBlocked(jobOrUrl, blockedJobs) {
    if (!Array.isArray(blockedJobs) || !blockedJobs.length) return false;
    const linksMatch = global.SmartJobJobUrl?.jobLinksMatch;
    const applyUrl =
      typeof jobOrUrl === 'string' || jobOrUrl == null
        ? jobOrUrl
        : jobOrUrl.apply_url;
    const job =
      typeof jobOrUrl === 'object' && jobOrUrl
        ? jobOrUrl
        : { apply_url: applyUrl, title: '', company_name: '' };

    return blockedJobs.some((blocked) => {
      if (linksMatch?.(applyUrl, blocked?.jobLink)) return true;
      return jobTitleCompanyMatch(job, blocked);
    });
  }

  function jobMatchesRegisteredJobRef(job, registered) {
    const linksMatch = global.SmartJobJobUrl?.jobLinksMatch;
    if (linksMatch?.(job?.apply_url, registered?.jobLink)) return true;
    return jobTitleCompanyMatch(job, registered);
  }

  function jobMatchesRegisteredJobs(job, registeredJobs) {
    if (!Array.isArray(registeredJobs) || !registeredJobs.length) return false;
    return registeredJobs.some((registered) => jobMatchesRegisteredJobRef(job, registered));
  }

  function filterJobsByPublishDate(jobs, dateWindow, nowMs = Date.now()) {
    const parsed = parseFreshnessWindow(dateWindow);
    const cutoffMs = dateWindowCutoffMs(dateWindow, nowMs);
    let removedByDate = 0;
    const filtered = [];

    for (const job of jobs) {
      const raw =
        String(job.estimated_publish_date || job.posted_at || '').trim() || '';
      if (!raw) {
        removedByDate += 1;
        continue;
      }
      const publishedMs = Date.parse(raw);
      if (Number.isNaN(publishedMs) || publishedMs < cutoffMs) {
        removedByDate += 1;
        continue;
      }
      filtered.push(job);
    }

    return {
      filtered,
      removedByDate,
      dateWindowDays: parsed.hcDays,
      dateWindowLabel: parsed.label,
      cutoffMs,
    };
  }

  function dedupeJobs(jobs) {
    const seenUrls = new Set();
    const titleIndex = new Map();
    const unique = [];
    const originOf = (job) => String(job?.origin || job?.source || '').trim().toLowerCase();
    // A jobright.ai info link (or none) is a pointer to the posting, not the posting.
    const viaAggregator = (url) => !url || /(^|\.)jobright\.ai\//i.test(String(url).replace(/^https?:\/\//i, ''));
    const normalizeCompany =
      global.SmartJobCompanyName?.normalizeCompanyName ||
      ((v) =>
        String(v ?? '')
          .trim()
          .toLowerCase());
    const canonical =
      global.SmartJobJobUrl?.canonicalJobUrl ||
      ((v) => String(v ?? '').trim().toLowerCase());

    const identifies = global.SmartJobJobUrl?.urlIdentifiesJob;

    // One posting seen by two sources keeps the earlier posting time: a source
    // that re-lists a job (Jobright) can show it as just posted.
    const DAY_MS = 24 * 3600 * 1000;
    const dateMerge = { pairs: 0, movedEarlier: 0, hoursMoved: [] };
    const postedAt = (job) => {
      const raw = String(job?.estimated_publish_date || '').trim();
      const ms = Date.parse(raw);
      if (!raw || Number.isNaN(ms)) return null;
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw) || /T00:00:00(\.0+)?(Z|[+-]00:?00)$/.test(raw);
      // A date without a time could be any moment of that day.
      return { ms, latest: dateOnly ? ms + DAY_MS - 1 : ms, dateOnly };
    };
    // Where the job may be done from: HiringCafe states it, Jobright does not.
    const statesPlaces = (job) =>
      job?.worldwide_ok === true ||
      (Array.isArray(job?.workplace_countries) && job.workplace_countries.length > 0);
    const withEarlierDate = (keptJob, other) => {
      if (originOf(keptJob) === originOf(other)) return keptJob;
      const kept =
        !statesPlaces(keptJob) && statesPlaces(other)
          ? { ...keptJob, workplace_countries: other.workplace_countries || [], worldwide_ok: other.worldwide_ok === true }
          : keptJob;
      const mine = postedAt(kept);
      const theirs = postedAt(other);
      if (!theirs) return kept;
      dateMerge.pairs += 1;
      // Only a time surely before ours replaces it.
      if (mine && theirs.latest >= mine.ms) return kept;
      if (mine) {
        dateMerge.movedEarlier += 1;
        dateMerge.hoursMoved.push((mine.ms - theirs.ms) / 3600000);
      }
      return {
        ...kept,
        // A date-only time reads as the middle of that day.
        estimated_publish_date: theirs.dateOnly
          ? new Date(theirs.ms + DAY_MS / 2).toISOString()
          : other.estimated_publish_date,
        posted_at: other.posted_at || kept.posted_at,
        posted_by: originOf(other),
      };
    };
    const urlIndex = new Map();

    for (const job of jobs) {
      // Only a link that names one posting may merge two rows; otherwise compare
      // the full link, so two jobs on one careers page stay two jobs.
      const urlKey =
        !identifies || identifies(job.apply_url)
          ? canonical(job.apply_url)
          : String(job.apply_url ?? '').trim().toLowerCase();
      if (urlKey && seenUrls.has(urlKey)) {
        const at = urlIndex.get(urlKey);
        if (at != null) unique[at] = withEarlierDate(unique[at], job);
        continue;
      }

      const companyKey = normalizeCompany(job.company_name);
      const titleKey = String(job.title ?? '')
        .trim()
        .toLowerCase();
      const companyTitleKey = companyKey && titleKey ? `${companyKey}::${titleKey}` : '';
      if (companyTitleKey && titleIndex.has(companyTitleKey)) {
        const at = titleIndex.get(companyTitleKey);
        const kept = unique[at];
        // Two direct links from one source are separate openings (locations,
        // requisitions). Otherwise it is one posting seen twice.
        const separateOpenings =
          originOf(kept) === originOf(job) &&
          !viaAggregator(kept.apply_url) &&
          !viaAggregator(job.apply_url);
        if (!separateOpenings) {
          // Keep the copy that links straight to the employer's form.
          if (viaAggregator(kept.apply_url) && !viaAggregator(job.apply_url)) {
            unique[at] = withEarlierDate(job, kept);
            if (urlKey) {
              seenUrls.add(urlKey);
              urlIndex.set(urlKey, at);
            }
          } else {
            unique[at] = withEarlierDate(kept, job);
          }
          continue;
        }
      }

      if (urlKey) {
        seenUrls.add(urlKey);
        urlIndex.set(urlKey, unique.length);
      }
      if (companyTitleKey && !titleIndex.has(companyTitleKey)) {
        titleIndex.set(companyTitleKey, unique.length);
      }
      unique.push(job);
    }

    const moved = [...dateMerge.hoursMoved].sort((a, b) => a - b);
    // For the run report; not part of the list.
    Object.defineProperty(unique, 'dateMerge', {
      value: {
        pairs: dateMerge.pairs,
        movedEarlier: dateMerge.movedEarlier,
        medianHoursMoved: moved.length ? Math.round(moved[Math.floor(moved.length / 2)] * 10) / 10 : null,
        maxHoursMoved: moved.length ? Math.round(moved[moved.length - 1] * 10) / 10 : null,
      },
      enumerable: false,
    });
    return unique;
  }

  function hostOfLink(url) {
    try {
      return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  function applyLocalFilters(jobs, options = {}) {
    const {
      excludeBlockedCompanies = true,
      excludeBlockedAts = true,
      excludeBlockedJobs = true,
      excludeRegisteredJobs = false,
      excludeRegisteredCompanies = false,
      blockedCompanies = [],
      blockedAts = [],
      blockedJobs = [],
      registeredJobs = [],
      registeredCompanies = [],
    } = options;

    let removedBlockedJobs = 0;
    let removedBlockedCompanies = 0;
    let removedAts = 0;
    let removedRegisteredJobs = 0;
    let removedRegisteredCompanies = 0;
    const filtered = [];

    for (const job of jobs) {
      if (excludeBlockedJobs && jobMatchesBlocked(job, blockedJobs)) {
        removedBlockedJobs += 1;
        continue;
      }
      if (excludeRegisteredJobs && jobMatchesRegisteredJobs(job, registeredJobs)) {
        removedRegisteredJobs += 1;
        continue;
      }
      if (
        excludeRegisteredCompanies &&
        companyMatchesBlocked(job.company_name, registeredCompanies)
      ) {
        removedRegisteredCompanies += 1;
        continue;
      }
      if (
        excludeBlockedAts &&
        (atsMatchesList(job.application_site, blockedAts) || atsMatchesList(hostOfLink(job.apply_url), blockedAts))
      ) {
        removedAts += 1;
        continue;
      }
      if (
        excludeBlockedCompanies &&
        companyMatchesBlocked(job.company_name, blockedCompanies)
      ) {
        removedBlockedCompanies += 1;
        continue;
      }
      filtered.push(job);
    }

    return {
      filtered,
      stats: {
        removedBlockedJobs,
        removedBlockedCompanies,
        removedAts,
        removedRegisteredJobs,
        removedRegisteredCompanies,
      },
    };
  }

  function jobsToCsv(jobs) {
    const headers = [
      'apply_url',
      'title',
      'core_job_title',
      'requirements_summary',
      'technical_tools',
      'job_category',
      'estimated_publish_date',
      'role_activities',
      'company_name',
      'company_tagline',
      'application_site',
      'applicants_count',
    ];

    const escape = (value) => {
      const text = value ?? '';
      return /[",\n]/.test(text) ? `"${String(text).replace(/"/g, '""')}"` : String(text);
    };

    return [
      headers.join(','),
      ...jobs.map((job) => headers.map((header) => escape(job[header])).join(',')),
    ].join('\n');
  }

  /** Injected into the HiringCafe tab — keep self-contained. */
  function extractPagePropsInTab() {
    const el = document.querySelector('script#__NEXT_DATA__');
    const title = document.title || '';
    const bodyText = document.body?.innerText?.slice(0, 2000) || '';
    const challenge =
      /just a moment/i.test(title) ||
      /just a moment/i.test(bodyText) ||
      /cf-browser-verification|challenge-platform|turnstile/i.test(
        document.documentElement?.innerHTML?.slice(0, 8000) || ''
      );

    if (!el?.textContent) {
      return { ok: false, challenge, title, url: location.href };
    }

    try {
      const data = JSON.parse(el.textContent);
      const pageProps = data?.props?.pageProps;
      if (!pageProps) {
        return { ok: false, challenge: false, title, url: location.href, missingPageProps: true };
      }
      return {
        ok: true,
        url: location.href,
        pageProps: {
          ssrHits: Array.isArray(pageProps.ssrHits) ? pageProps.ssrHits : [],
          // False means the page had no result list at all (error page, changed shape).
          hasHits: Array.isArray(pageProps.ssrHits),
          ssrIsLastPage: Boolean(pageProps.ssrIsLastPage),
          ssrTotalCount:
            typeof pageProps.ssrTotalCount === 'number' ? pageProps.ssrTotalCount : null,
        },
      };
    } catch (err) {
      return {
        ok: false,
        challenge,
        title,
        url: location.href,
        error: err?.message || String(err),
      };
    }
  }

  global.SmartJobHiringCafeScraper = {
    HIRING_CAFE_BASE,
    DEFAULT_SEARCH_STATE,
    parseFreshnessWindow,
    dateWindowDays,
    dateWindowFromDays,
    dateWindowLabel,
    dateWindowCutoffMs,
    cloneDefaultSearchState,
    buildSearchState,
    buildHiringCafeUrl,
    parseSearchStateFromInput,
    summarizeSearchState,
    extractJobFields,
    detectPlatform,
    normalizeAtsName,
    atsMatchesList,
    filterJobsByPublishDate,
    dedupeJobs,
    countrySearchState,
    anyCountrySearchState,
    applyLocalFilters,
    jobsToCsv,
    extractPagePropsInTab,
    jobMatchesRegisteredJobRef,
    jobMatchesRegisteredJobs,
  };
})(typeof window !== 'undefined' ? window : self);
