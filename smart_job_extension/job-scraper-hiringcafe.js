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
    dateFetchedPastNDays: 3,
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

  const PLATFORM_RULES = [
    ['Greenhouse', (h) => h.includes('greenhouse.io')],
    ['Lever', (h) => h.includes('lever.co')],
    ['Workday', (h) => h.includes('myworkdayjobs.com') || h.includes('workday.com')],
    ['iCIMS', (h) => h.includes('icims.com')],
    ['Gem', (h) => h.includes('jobs.gem.com')],
    ['Ashby', (h) => h.includes('ashbyhq.com')],
    ['Rippling', (h) => h.includes('rippling.com') || h.includes('atsrecruiting.com')],
    ['Jobvite', (h) => h.includes('jobvite.com')],
    ['SmartRecruiters', (h) => h.includes('smartrecruiters.com')],
    ['BambooHR', (h) => h.includes('bamboohr.com')],
    ['Taleo', (h) => h.includes('taleo.net')],
    ['Indeed', (h) => h.includes('indeed.com')],
    ['LinkedIn', (h) => h.includes('linkedin.com')],
    ['Wellfound', (h) => h.includes('wellfound.com') || h.includes('angel.co')],
    ['Recruitee', (h) => h.includes('recruitee.com')],
    ['Breezy', (h) => h.includes('breezy.hr')],
    ['Workable', (h) => h.includes('workable.com')],
    ['JazzHR', (h) => h.includes('jazz.co') || h.includes('applytojob.com')],
  ];

  function dateWindowFromDays(days) {
    const n = Number(days);
    if (n === 1) return '1d';
    if (n === 7) return '7d';
    return '3d';
  }

  function dateWindowDays(dateWindow) {
    return dateWindow === '1d' ? 1 : dateWindow === '7d' ? 7 : 3;
  }

  function cloneDefaultSearchState(dateWindow) {
    return {
      ...DEFAULT_SEARCH_STATE,
      dateFetchedPastNDays: dateWindowDays(dateWindow || '3d'),
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
    const applyUrl = serializeField(hit?.apply_url);

    return {
      id: serializeField(hit?.id),
      apply_url: applyUrl,
      title: serializeField(jobInfo.title),
      core_job_title: serializeField(processed.core_job_title),
      requirements_summary: serializeField(processed.requirements_summary),
      technical_tools: serializeField(processed.technical_tools),
      job_category: serializeField(processed.job_category),
      estimated_publish_date: serializeField(processed.estimated_publish_date),
      role_activities: serializeField(processed.role_activities),
      company_name: serializeField(company.name),
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
      return (
        Boolean(blocked) &&
        (atsKey === blocked || atsKey.includes(blocked) || blocked.includes(atsKey))
      );
    });
  }

  function companyMatchesBlocked(companyName, blockedCompanies) {
    const matcher = global.SmartJobCompanyName?.companiesMatch;
    if (!matcher || !Array.isArray(blockedCompanies) || !blockedCompanies.length) return false;
    return blockedCompanies.some((blocked) => matcher(companyName, blocked));
  }

  function jobMatchesBlocked(applyUrl, blockedJobs) {
    const linksMatch = global.SmartJobJobUrl?.jobLinksMatch;
    if (!linksMatch || !Array.isArray(blockedJobs) || !blockedJobs.length) return false;
    return blockedJobs.some((blocked) => linksMatch(applyUrl, blocked?.jobLink));
  }

  function normalizeTitle(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase();
  }

  function jobMatchesRegisteredJobRef(job, registered) {
    const linksMatch = global.SmartJobJobUrl?.jobLinksMatch;
    if (linksMatch?.(job?.apply_url, registered?.jobLink)) return true;

    const jobTitle = normalizeTitle(job?.title);
    const registeredTitle = normalizeTitle(registered?.jobTitle);
    const companiesMatch = global.SmartJobCompanyName?.companiesMatch;
    if (
      jobTitle &&
      registeredTitle &&
      jobTitle === registeredTitle &&
      companiesMatch?.(job?.company_name, registered?.company)
    ) {
      return true;
    }
    return false;
  }

  function jobMatchesRegisteredJobs(job, registeredJobs) {
    if (!Array.isArray(registeredJobs) || !registeredJobs.length) return false;
    return registeredJobs.some((registered) => jobMatchesRegisteredJobRef(job, registered));
  }

  function filterJobsByPublishDate(jobs, dateWindow, nowMs = Date.now()) {
    const days = dateWindowDays(dateWindow);
    const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
    let removedByDate = 0;
    const filtered = [];

    for (const job of jobs) {
      const raw = job.estimated_publish_date?.trim?.() || job.estimated_publish_date;
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

    return { filtered, removedByDate };
  }

  function dedupeJobs(jobs) {
    const seenUrls = new Set();
    const seenCompanyTitle = new Set();
    const unique = [];
    const normalizeCompany =
      global.SmartJobCompanyName?.normalizeCompanyName ||
      ((v) =>
        String(v ?? '')
          .trim()
          .toLowerCase());
    const canonical =
      global.SmartJobJobUrl?.canonicalJobUrl ||
      ((v) => String(v ?? '').trim().toLowerCase());

    for (const job of jobs) {
      const urlKey = canonical(job.apply_url);
      if (urlKey && seenUrls.has(urlKey)) continue;

      const companyKey = normalizeCompany(job.company_name);
      const titleKey = String(job.title ?? '')
        .trim()
        .toLowerCase();
      const companyTitleKey = companyKey && titleKey ? `${companyKey}::${titleKey}` : '';
      if (companyTitleKey && seenCompanyTitle.has(companyTitleKey)) continue;

      if (urlKey) seenUrls.add(urlKey);
      if (companyTitleKey) seenCompanyTitle.add(companyTitleKey);
      unique.push(job);
    }

    return unique;
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
      if (excludeBlockedJobs && jobMatchesBlocked(job.apply_url, blockedJobs)) {
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
      if (excludeBlockedAts && atsMatchesList(job.application_site, blockedAts)) {
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
    dateWindowDays,
    dateWindowFromDays,
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
    applyLocalFilters,
    jobsToCsv,
    extractPagePropsInTab,
    jobMatchesRegisteredJobRef,
    jobMatchesRegisteredJobs,
  };
})(typeof window !== 'undefined' ? window : self);
