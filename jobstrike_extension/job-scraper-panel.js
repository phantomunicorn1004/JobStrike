/**
 * Job Scraper tab: HiringCafe scrape in a real browser tab + website-synced filters/export.
 */
(function () {
  const STORAGE = {
    prefs: 'job_scraper_prefs',
    blockedCompanies: 'job_scraper_blocked_companies',
    blockedAts: 'job_scraper_blocked_ats',
    blockedJobs: 'job_scraper_blocked_jobs',
    lastResults: 'job_scraper_last_results',
    scrapeTabId: 'job_scraper_tab_id',
    customSearch: 'job_scraper_custom_search',
    seen: 'job_scraper_seen_v1',
    jrGuard: 'job_scraper_jobright_guard_v1',
    registered: 'job_scraper_registered_v1',
    scrapedNames: 'job_scraper_names_by_link_v1',
    live: 'job_scraper_live_v1',
  };

  /**
   * Scrape modes. "us": remote US jobs (the original setup). "intl": remote
   * contract jobs open to candidates in another country. Each mode keeps its own
   * filters, profile, HiringCafe search, results and "new" marks; the block
   * lists, the Jobright request budget and the Bid tab's names are shared.
   */
  const MODE_KEY = 'job_scraper_mode_v1';
  const MODE_STORAGE_FIELDS = ['prefs', 'lastResults', 'customSearch', 'seen', 'registered', 'live'];
  const US_STORAGE_KEYS = Object.fromEntries(MODE_STORAGE_FIELDS.map((f) => [f, STORAGE[f]]));
  function applyModeStorageKeys(mode) {
    for (const f of MODE_STORAGE_FIELDS) {
      STORAGE[f] = mode === 'intl' ? `${US_STORAGE_KEYS[f]}_intl` : US_STORAGE_KEYS[f];
    }
  }

  /** Countries a worldwide-contract candidate can be in (the US is the other mode). */
  const CANDIDATE_COUNTRIES = [
    'CA', 'MX', 'BR', 'AR', 'CO', 'CL', 'PE', 'UY', 'CR', 'GT', 'DO', 'EC', 'VE',
    'GB', 'IE', 'DE', 'FR', 'ES', 'PT', 'IT', 'NL', 'BE', 'CH', 'AT', 'PL', 'RO', 'BG', 'UA', 'RS',
    'HR', 'CZ', 'SK', 'HU', 'GR', 'SE', 'NO', 'DK', 'FI', 'EE', 'LV', 'LT', 'MD', 'GE', 'AM', 'AZ',
    'TR', 'IL', 'AE', 'SA', 'EG', 'MA', 'TN', 'ZA', 'NG', 'KE', 'GH',
    'IN', 'PK', 'BD', 'LK', 'NP', 'PH', 'VN', 'ID', 'MY', 'TH', 'SG', 'KR', 'JP', 'TW', 'HK', 'CN',
    'KZ', 'UZ', 'AU', 'NZ',
  ];
  /** Worldwide mode's "Any country": candidates anywhere outside the US. */
  const ANY_COUNTRY = 'ANY';

  function countryName(code) {
    if (code === ANY_COUNTRY) return 'any country';
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
    } catch (_) {
      return code;
    }
  }

  /** How many scraped jobs' names are remembered for the Bid tab. */
  const SCRAPED_NAMES_MAX = 4000;

  function scrapedNameKey(url) {
    const canonical = window.SmartJobJobUrl?.canonicalJobUrl?.(url);
    return String(canonical || url || '').trim().toLowerCase();
  }

  /**
   * Remember each ready job's company and title by its link. The Bid tab reads
   * this when the job's page is opened, so the company registered is the one
   * the scrape compared against the applied and blocked lists.
   */
  async function rememberScrapedNames(jobs) {
    const stored = (await storageGet([STORAGE.scrapedNames]))[STORAGE.scrapedNames];
    const names = stored && typeof stored === 'object' ? stored : {};
    const now = Date.now();
    for (const job of Array.isArray(jobs) ? jobs : []) {
      const key = scrapedNameKey(job?.apply_url);
      const company = String(job?.company_name || '').trim();
      if (!key || !company) continue;
      names[key] = { c: company, t: String(job?.title || '').trim(), at: now };
    }
    const keys = Object.keys(names);
    if (keys.length > SCRAPED_NAMES_MAX) {
      keys
        .sort((a, b) => (names[a].at || 0) - (names[b].at || 0))
        .slice(0, keys.length - SCRAPED_NAMES_MAX)
        .forEach((key) => delete names[key]);
    }
    await storageSet({ [STORAGE.scrapedNames]: names });
  }

  /**
   * The job ids in a link: a UUID (Lever, Ashby), a long number (Greenhouse,
   * SmartRecruiters), or a short number / requisition (iCIMS, Workday "_R-12345")
   * that only counts on the same site. Redirects change the address but keep the id.
   */
  function scrapedJobIds(key) {
    const text = String(key || '').toLowerCase();
    // Short ids are only unique within one employer's site: they carry the host.
    const host = text.split('/')[0];
    const ids = new Set();
    for (const m of text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)) ids.add(m[0]);
    for (const m of text.matchAll(/\d{5,}/g)) ids.add(m[0].length >= 7 ? m[0] : `${host}#${m[0]}`);
    for (const m of text.matchAll(/(?:^|[^a-z0-9])(?:r|jr|req)[-_]?(\d{4,})(?![0-9])/g)) ids.add(`${host}#r${m[1]}`);
    return ids;
  }

  /** Two titles name the same role: most words of the shorter one appear in the other. */
  function titlesAgree(a, b) {
    const words = (t) =>
      new Set(
        String(t || '')
          .toLowerCase()
          .replace(/[^a-z0-9+#]+/g, ' ')
          .split(' ')
          .filter((w) => w.length > 1 && !/^(and|the|of|for|to|in|at|remote|us|usa|hybrid|onsite)$/.test(w))
      );
    const left = words(a);
    const right = words(b);
    if (!left.size || !right.size) return false;
    let common = 0;
    left.forEach((w) => {
      if (right.has(w)) common += 1;
    });
    return common / Math.min(left.size, right.size) >= 0.6;
  }

  /**
   * The scraped company and title for a job link, or null when it was not scraped.
   * The exact link first; failing that (the page redirected to another address),
   * the one scraped job with the same job id and a matching title.
   */
  async function lookupScrapedJob(url, { title = '' } = {}) {
    const key = scrapedNameKey(url);
    if (!key) return null;
    const stored = (await storageGet([STORAGE.scrapedNames]))[STORAGE.scrapedNames];
    if (!stored || typeof stored !== 'object') return null;
    const hit = stored[key];
    if (hit && hit.c) return { company: hit.c, title: hit.t || '', matchedBy: 'link' };

    const ids = scrapedJobIds(key);
    if (!ids.size || !String(title || '').trim()) return null;
    let found = null;
    for (const [storedKey, entry] of Object.entries(stored)) {
      if (!entry?.c) continue;
      const shared = [...scrapedJobIds(storedKey)].some((id) => ids.has(id));
      if (!shared || !titlesAgree(entry.t, title)) continue;
      // Two different companies behind one id: not sure enough to pick either.
      if (found && found.c.toLowerCase() !== entry.c.toLowerCase()) return null;
      found = entry;
    }
    return found ? { company: found.c, title: found.t || '', matchedBy: 'job id' } : null;
  }

  window.SmartJobScrapedNames = { lookup: lookupScrapedJob };

  const DEFAULT_PREFS = {
    excludeBlockedCompanies: true,
    excludeBlockedAts: true,
    excludeBlockedJobs: true,
    excludeRegisteredJobs: true,
    excludeRegisteredCompanies: true,
    candidateFilter: '',
    maxPages: 8,
    delayMs: 700,
    /** Per-source freshness (legacy `freshnessWindow` migrates into both). */
    freshnessWindowJr: '1d',
    freshnessWindowHc: '8h',
    /** Hide jobs whose apply link stays on a job board (easy apply) instead of the employer. */
    directLinksOnly: true,
    /** Keep each company's jobs together in the list and export, best first. */
    onePerCompany: true,
    /** Hide jobs the source marks as requiring a security clearance. */
    hideClearanceRequired: true,
    /** Hide jobs the source marks as reposted: older openings put up again, already seen by many. */
    hideReposts: true,
    /** Hide jobs the source places in another country (authorised to work in the US only). */
    usOnly: true,
    /** Hide jobs the source marks as requiring a Master's or doctorate. */
    hideAdvancedDegree: true,
    /** Hide jobs the source marks as requiring a language other than English. */
    hideForeignLanguage: true,
    /** Job types to show; a job whose type the source does not state is always shown. */
    showFullTime: true,
    showContract: true,
    showPartTime: true,
    showTemporary: true,
    showInternship: true,
    /** Which sources a scrape reads. HiringCafe needs no account; Jobright uses yours. */
    useJobright: true,
    useHiringCafe: true,
    /** Worldwide mode: the candidate's country (ISO code), and hide jobs not open to it. */
    candidateCountry: '',
    openToCountryOnly: true,
    /** Live mode: checks on a schedule during working hours, new jobs added to the list. */
    liveEnabled: false,
    liveHours: '10:00-20:30, 01:00-07:30',
    liveHcMinutes: 30,
    liveNotify: true,
    /** New Live jobs are read and queued for AutoGen (the Bid tab's profile). */
    liveAutoQueue: false,
    liveAutoQueueProfileId: '',
    liveAutoQueueProfileName: '',
    liveAutoQueueSupported: true,
    liveHideOpened: false,
  };

  /** Defaults of the worldwide-contract mode: contract only, no US filter, HiringCafe only. */
  const DEFAULT_PREFS_INTL = {
    ...DEFAULT_PREFS,
    usOnly: false,
    showFullTime: false,
    showPartTime: false,
    showTemporary: false,
    showInternship: false,
    showContract: true,
    // Jobright's Recommend feed is US jobs; it can be switched on if yours is not.
    useJobright: false,
    // Contract jobs are posted less often and often dated by day only: 3 days fills a list.
    freshnessWindowHc: '3d',
    candidateCountry: ANY_COUNTRY,
  };

  function defaultPrefs() {
    return state.mode === 'intl' ? DEFAULT_PREFS_INTL : DEFAULT_PREFS;
  }

  const state = {
    mode: 'us',
    /** Live mode: when HiringCafe was last read, the status line, and whether a live check runs. */
    live: { lastHcAt: 0, lastCheckAt: 0, lastAdded: 0, status: '', running: false },
    /** Set for one run: which sources it reads (Live decides), and that it is a live check. */
    runSources: null,
    liveRun: false,
    prefs: { ...DEFAULT_PREFS },
    blockedCompanies: [],
    blockedAts: [],
    blockedJobs: [],
    candidates: [],
    registeredCompanies: [],
    registeredJobs: [],
    profileLoading: false,
    listsSyncedAt: null,
    listsSyncError: '',
    openListEditor: null,
    customSearchState: null,
    customSearchSourceUrl: '',
    rawJobs: [],
    filteredJobs: [],
    selectedKeys: new Set(),
    /** Jobs already collected by an earlier run: key → first seen (ms). */
    seen: new Map(),
    /** Today's Jobright usage: { day, requests, lastRunAt, cooldownUntil }. */
    jrGuard: null,
    scraping: false,
    /** True while a run's code is actually executing (not while paused for the user). */
    runActive: false,
    stopRequested: false,
    runStartedAt: 0,
    pausedForChallenge: false,
    scrapeCursor: null,
    combinedRun: null,
    status: '',
    lastScrapedAt: null,
    stats: null,
  };

  const LIST_EDITOR_META = {
    company: {
      title: 'Blocked companies',
      placeholder: 'Company name',
      inputType: 'text',
    },
    ats: {
      title: 'Blocked ATS',
      placeholder: 'e.g. Workday',
      inputType: 'text',
    },
    job: {
      title: 'Blocked jobs',
      placeholder: 'https://… apply URL',
      inputType: 'url',
    },
  };

  function api() {
    return window.SmartJobHiringCafeScraper;
  }

  function jrApi() {
    return window.SmartJobJobrightScraper;
  }

  function activeSource() {
    return 'both';
  }

  function sourceLabel(phase) {
    if (phase === 'jobright') return 'Jobright';
    if (phase === 'hiringcafe') return 'HiringCafe';
    return 'HiringCafe + Jobright';
  }

  function isCombinedMode() {
    return true;
  }

  function showToast(message, type) {
    if (typeof window.showStatus === 'function') {
      window.showStatus(message, type || 'info');
      return;
    }
    console.log(`[job-scraper] ${type || 'info'}: ${message}`);
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function storageSet(payload) {
    return new Promise((resolve) => {
      chrome.storage.local.set(payload, () => resolve());
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Jobright is read with the user's own account, so it is asked for little and
  // left alone at the first sign of a limit.
  // Five full reads of the feed (a full read is about 30 requests).
  const JR_DAILY_REQUESTS = 150;
  // What one full read needs; a run with less than this left is asked about first.
  // A full read of the unordered feed: 50 pages of 20 rows, one request each.
  const JR_FULL_READ_REQUESTS = 52;
  const JR_MIN_GAP_MS = 3 * 60 * 60 * 1000;
  const JR_COOLDOWN_MS = 4 * 60 * 60 * 1000;

  function localDayKey(ms = Date.now()) {
    const d = new Date(ms);
    const two = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  }

  /** Today's Jobright usage. The request count starts again each day; a cooldown does not. */
  function jobrightGuard() {
    const g = state.jrGuard || {};
    const today = localDayKey();
    if (g.day !== today) {
      state.jrGuard = {
        day: today,
        requests: 0,
        lastRunAt: Number(g.lastRunAt) || 0,
        cooldownUntil: Number(g.cooldownUntil) || 0,
      };
    }
    return state.jrGuard;
  }

  /** Another panel may have scraped since this one loaded: read the saved count. */
  async function loadJobrightGuard() {
    const result = await storageGet([STORAGE.jrGuard]);
    const saved = result[STORAGE.jrGuard];
    if (saved && typeof saved === 'object') {
      state.jrGuard = {
        day: String(saved.day || ''),
        requests: Number(saved.requests) || 0,
        lastRunAt: Number(saved.lastRunAt) || 0,
        cooldownUntil: Number(saved.cooldownUntil) || 0,
      };
    }
    return jobrightGuard();
  }

  async function persistJobrightGuard() {
    await storageSet({ [STORAGE.jrGuard]: jobrightGuard() });
  }

  /** This run's Jobright requests by kind, for the run report. */
  let jobrightRequestKinds = {};
  /**
   * Set once in a run when the in-tab fetch failed and the extension's own fetch
   * worked: from then on the extension asks first, instead of spending two failed
   * requests on every page.
   */
  let jobrightPreferExtension = false;

  async function noteJobrightRequests(count, kind = 'other') {
    const sent = Math.max(0, Number(count) || 0);
    if (!sent) return;
    jobrightRequestKinds[kind] = (jobrightRequestKinds[kind] || 0) + sent;
    jobrightGuard().requests += sent;
    await persistJobrightGuard();
  }

  function jobrightRequestsLeft() {
    return Math.max(0, JR_DAILY_REQUESTS - jobrightGuard().requests);
  }

  function clockTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /** Jobright said to slow down: leave it alone for a few hours. Returns when it ends. */
  async function startJobrightCooldown() {
    const until = Date.now() + JR_COOLDOWN_MS;
    jobrightGuard().cooldownUntil = until;
    await persistJobrightGuard();
    renderFeedStatus();
    return clockTime(until);
  }

  /** Why Jobright sits this run out, or '' when it may be read. */
  function jobrightHoldReason() {
    const g = jobrightGuard();
    if (g.cooldownUntil > Date.now()) {
      return `Jobright asked to slow down earlier, so it is skipped until ${clockTime(g.cooldownUntil)}.`;
    }
    if (jobrightRequestsLeft() <= 0) {
      return `Today's Jobright limit (${JR_DAILY_REQUESTS} requests) is used up, so it is skipped until tomorrow.`;
    }
    return '';
  }

  const SEEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const SEEN_MAX = 30000;

  /** A job is remembered by its source id and by its normalised apply link. */
  function seenKeysFor(job, origin) {
    const keys = [];
    const src = origin || jobOriginKey(job);
    const id = String(job?.id || '').trim();
    if (id && src) keys.push(`${src === 'jobright' ? 'jr' : 'hc'}:${id}`);
    // A link is a key only when it names one posting. A shared careers page
    // would otherwise mark every later job on it as "already seen".
    const urlApi = window.SmartJobJobUrl;
    for (const url of [job?.apply_url, job?.listed_url]) {
      if (!url || !urlApi?.canonicalJobUrl) continue;
      if (urlApi.urlIdentifiesJob && !urlApi.urlIdentifiesJob(url)) continue;
      const urlKey = urlApi.canonicalJobUrl(url);
      if (urlKey) keys.push(`u:${urlKey}`);
    }
    // Nothing else to go on (a card read off the page): company + title.
    if (!keys.length && job?.company_name && job?.title) {
      keys.push(`t:${String(job.company_name).trim().toLowerCase()}::${String(job.title).trim().toLowerCase()}`);
    }
    return keys;
  }

  function isSeenJob(job, origin) {
    return seenKeysFor(job, origin).some((key) => state.seen.has(key));
  }

  function markJobsSeen(jobs, atMs = Date.now()) {
    for (const job of jobs || []) {
      for (const key of seenKeysFor(job)) {
        if (!state.seen.has(key)) state.seen.set(key, atMs);
      }
    }
  }

  /** Old entries go first; a job that old has left both feeds' freshness windows. */
  function pruneSeen(nowMs = Date.now()) {
    for (const [key, at] of state.seen) {
      if (nowMs - at > SEEN_TTL_MS) state.seen.delete(key);
    }
    if (state.seen.size > SEEN_MAX) {
      const oldestFirst = [...state.seen.entries()].sort((a, b) => a[1] - b[1]);
      for (const [key] of oldestFirst.slice(0, state.seen.size - SEEN_MAX)) state.seen.delete(key);
    }
  }

  async function persistSeen() {
    pruneSeen();
    await storageSet({ [STORAGE.seen]: Object.fromEntries(state.seen) });
  }

  // Job boards and aggregators: applying there means their easy-apply flow (or a
  // second hop), not the employer's own form that the tailored resume and autofill are for.
  const AGGREGATOR_HOSTS = [
    'dice.com',
    'linkedin.com',
    'indeed.com',
    'ziprecruiter.com',
    'glassdoor.com',
    'monster.com',
    'careerbuilder.com',
    'simplyhired.com',
    'jobright.ai',
    'hiringcafe.com',
    'hiring.cafe',
    'wellfound.com',
    'angel.co',
    'builtin.com',
    'talent.com',
    'jooble.org',
    'adzuna.com',
    'lensa.com',
    'theladders.com',
    'snagajob.com',
    'flexjobs.com',
    'remoteok.com',
    'weworkremotely.com',
    'otta.com',
    'welcometothejungle.com',
    'jobot.com',
    'cybercoders.com',
    'google.com',
  ];

  /** True when the link is missing or stays on a job board. */
  function isAggregatorLink(url) {
    const raw = String(url || '').trim();
    if (!raw) return true;
    try {
      const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
      return AGGREGATOR_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch (_) {
      return true;
    }
  }

  /**
   * What "Direct employer links only" hides: easy-apply flows and listings whose
   * link stays on a job board, LinkedIn included. A job the scraper found on the
   * employer's own board has had its link replaced before this runs, so it stays.
   */
  function hiddenByDirectLinks(job) {
    if (job?.easy_apply === true) return true;
    return isAggregatorLink(job?.apply_url);
  }

  // The employer-board lookup found 1 posting in 306 tries over three runs (the
  // job-board listings are mostly agency posts) and cost minutes per scrape, so it
  // no longer runs. Raise this to switch it back on.
  const EMPLOYER_LOOKUP_MAX = 0;

  /**
   * Staffing and recruiting firms. Their postings are for someone else's job,
   * so the firm has no careers board holding it and a lookup can only miss.
   */
  const STAFFING_NAME_RE =
    /\b(staffing|recruit(ing|ment|ers)|talent (solutions|partners|group)|search (group|partners|firm)|placements?|workforce solutions|cybercoders|kforce|robert half|teksystems|insight global|randstad|aerotek|apex systems|motion recruitment|jobot|hays|harnham|hunter bond|radley james|goliath partners|calance|beaconfire|xforia|biztech|tricom technical|mbo partners|henderson scott|strativ group|burtch works|revature|akkodis|modis|collabera|mindlance|diverse lynx|kelly services|adecco|manpower|experis|signature consultants|beacon hill|vaco|matlen silver|infojini|jefferson frank|nigel frank|mason frank|lorien|oliver bernard|crossing hurdles|dice)\b/i;

  /** A job-board listing whose employer board is worth looking up. */
  function worthEmployerLookup(job) {
    if (job.recruiter_named === true) return false;
    return !STAFFING_NAME_RE.test(String(job.company_name || ''));
  }

  /**
   * For jobs that only have a job-board link, look the posting up on the
   * employer's own careers board and use that link instead. Each job is tried
   * once; the ones not found stay as they are (and stay hidden by the
   * direct-links filter).
   */
  async function resolveEmployerLinks(jobs) {
    const resolver = window.SmartJobLinkResolver;
    const outcome = { tried: 0, found: 0, duplicates: 0 };
    if (!resolver?.resolveMany || !state.prefs.directLinksOnly) return outcome;
    const targets = (jobs || [])
      .filter(
        (job) =>
          !job.link_checked &&
          job.company_name &&
          job.title &&
          isAggregatorLink(job.apply_url) &&
          worthEmployerLookup(job)
      )
      .slice(0, EMPLOYER_LOOKUP_MAX);
    outcome.skippedAgencies = (jobs || []).filter(
      (job) => !job.link_checked && isAggregatorLink(job.apply_url) && job.company_name && !worthEmployerLookup(job)
    ).length;
    if (!targets.length) return outcome;

    const show = (done, found) =>
      setProgress({
        text: 'Finding employer links…',
        detail: `${done} of ${targets.length} job-board listings checked · ${found} found on the employer's site`,
        kind: 'info',
        current: done,
        total: targets.length,
        phase: 'hiringcafe',
        showTrust: false,
      });
    show(0, 0);
    const hits = await resolver.resolveMany(targets, {
      concurrency: 8,
      onProgress: (done, total, found) => show(done, found),
      shouldStop: () => state.stopRequested,
    });
    targets.forEach((job, index) => {
      const hit = hits.get(index);
      // Not reached (stopped) or could not be checked (offline, timeout): try
      // again next run. Only a clean answer settles a job.
      if (!hit && (state.stopRequested || hits.uncertain?.has(index))) return;
      job.link_checked = true;
      if (!hit) return;
      job.listed_url = job.apply_url || null;
      job.apply_url = hit.url;
      job.application_site = hit.ats;
      outcome.found += 1;
    });
    outcome.tried = targets.length;
    outcome.couldNotCheck = hits.uncertain?.size || 0;
    outcome.notFoundSample = targets
      .filter((job, index) => !hits.get(index) && !hits.uncertain?.has(index))
      .slice(0, 12)
      .map((job) => `${job.company_name} | ${job.title} | ${String(job.apply_url || '').slice(0, 60)}`);
    return outcome;
  }

  /**
   * When a job was posted, for filtering and for display.
   *
   * HiringCafe gives some jobs a date with no time of day. Parsed plainly that is
   * midnight UTC, which can make a job posted an hour ago look most of a day old
   * and fall outside a short freshness window. For those: `latestMs` is the end
   * of that day (used to decide whether a job is inside the window, so a possibly
   * fresh job is never dropped) and `ms` is the middle of it (used for age and rank).
   *
   * @returns {{ ms:number, latestMs:number, approximate:boolean } | null}
   */
  function jobPostedTimes(job, nowMs = Date.now()) {
    const raw = String(job?.estimated_publish_date || job?.posted_at || '').trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return null;
    const dateOnly =
      jobOriginKey(job) !== 'jobright' &&
      (/^\d{4}-\d{2}-\d{2}$/.test(raw) || /T00:00:00(\.0+)?(Z|[+-]00:?00)$/.test(raw));
    if (!dateOnly) return { ms, latestMs: ms, approximate: false };
    const day = 24 * 3600 * 1000;
    return {
      // Middle of the part of that day that has already happened.
      ms: ms + Math.max(0, Math.min(nowMs - ms, day)) / 2,
      latestMs: Math.min(nowMs, ms + day - 1),
      approximate: true,
    };
  }

  /** Added by the most recent run. */
  function isNewJob(job) {
    return Boolean(job?.is_new);
  }

  function jobKey(job, index) {
    const urlApi = window.SmartJobJobUrl?.canonicalJobUrl;
    const urlKey = urlApi ? urlApi(job.apply_url) : String(job.apply_url || '');
    return urlKey || `idx:${index}:${job.title || ''}:${job.company_name || ''}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return String(iso).slice(0, 10);
    return new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  function downloadTextFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Jobright jobs saved before its times were read as UTC are off by the local
   * UTC offset. Shift them back once. Only when the saved list proves the error:
   * at least one of its Jobright jobs was "posted" after the scrape that found it.
   */
  function repairLegacyJobrightTimes(jobs, scrapedAtMs) {
    const legacy = (jobs || []).filter(
      (job) =>
        jobOriginKey(job) === 'jobright' &&
        job.time_v !== 2 &&
        !Number.isNaN(Date.parse(job.estimated_publish_date || ''))
    );
    if (!legacy.length) return false;
    const reference = Number.isNaN(scrapedAtMs) ? Date.now() : scrapedAtMs;
    const proven = legacy.some(
      (job) => Date.parse(job.estimated_publish_date) > reference + 5 * 60 * 1000
    );
    for (const job of legacy) {
      if (proven) {
        const stored = new Date(job.estimated_publish_date);
        const fixed = new Date(stored.getTime() - stored.getTimezoneOffset() * 60000);
        job.estimated_publish_date = fixed.toISOString();
        job.posted_at = formatBidPostedAt(job.estimated_publish_date);
      }
      job.time_v = 2;
    }
    return true;
  }

  async function loadState() {
    const result = await storageGet([
      STORAGE.prefs,
      STORAGE.blockedCompanies,
      STORAGE.blockedAts,
      STORAGE.blockedJobs,
      STORAGE.lastResults,
      STORAGE.customSearch,
      STORAGE.seen,
      STORAGE.registered,
    ]);
    await loadJobrightGuard();

    const storedSeen = result[STORAGE.seen];
    state.seen = new Map(
      Object.entries(storedSeen && typeof storedSeen === 'object' ? storedSeen : {}).map(
        ([key, at]) => [key, Number(at) || 0]
      )
    );
    pruneSeen();

    const storedPrefs = result[STORAGE.prefs] || {};
    state.prefs = { ...defaultPrefs(), ...storedPrefs };
    // Migrate single freshnessWindow → per-source only when that source was never set.
    const legacyFresh = normalizeFreshnessPref(
      storedPrefs.freshnessWindow || storedPrefs.dateWindow
    );
    if (legacyFresh) {
      if (!normalizeFreshnessPref(storedPrefs.freshnessWindowJr)) {
        state.prefs.freshnessWindowJr = legacyFresh;
      }
      if (!normalizeFreshnessPref(storedPrefs.freshnessWindowHc)) {
        state.prefs.freshnessWindowHc = legacyFresh;
      }
    }
    if (!normalizeFreshnessPref(state.prefs.freshnessWindowJr)) {
      state.prefs.freshnessWindowJr = DEFAULT_PREFS.freshnessWindowJr;
    }
    if (!normalizeFreshnessPref(state.prefs.freshnessWindowHc)) {
      state.prefs.freshnessWindowHc = DEFAULT_PREFS.freshnessWindowHc;
    }

    applyWebsiteBlockedLists({
      blockedCompanies: Array.isArray(result[STORAGE.blockedCompanies])
        ? result[STORAGE.blockedCompanies]
        : [],
      blockedAts: Array.isArray(result[STORAGE.blockedAts])
        ? result[STORAGE.blockedAts]
        : [],
      blockedJobs: Array.isArray(result[STORAGE.blockedJobs])
        ? result[STORAGE.blockedJobs]
        : [],
    });

    // The applied jobs and companies from the last successful sync, for the
    // profile they belong to. If the next sync fails, what was known is still
    // hidden, instead of nothing.
    const savedRegistered = result[STORAGE.registered];
    if (
      savedRegistered &&
      savedRegistered.profile &&
      savedRegistered.profile === state.prefs.candidateFilter
    ) {
      state.registeredJobs = Array.isArray(savedRegistered.jobs) ? savedRegistered.jobs : [];
      state.registeredCompanies = Array.isArray(savedRegistered.companies)
        ? savedRegistered.companies
        : [];
    }

    const savedLive = (await storageGet([STORAGE.live]))[STORAGE.live];
    state.live = {
      lastHcAt: Number(savedLive?.lastHcAt) || 0,
      lastCheckAt: Number(savedLive?.lastCheckAt) || 0,
      lastAdded: Number(savedLive?.lastAdded) || 0,
      status: '',
      running: false,
    };

    const custom = result[STORAGE.customSearch];
    if (custom && custom.searchState && typeof custom.searchState === 'object') {
      state.customSearchState = custom.searchState;
      state.customSearchSourceUrl = String(custom.sourceUrl || '');
    } else {
      state.customSearchState = null;
      state.customSearchSourceUrl = '';
    }

    const last = result[STORAGE.lastResults];
    if (last && Array.isArray(last.jobs)) {
      state.rawJobs = last.rawJobs || last.jobs;
      state.lastScrapedAt = last.scrapedAt || null;
      state.stats = last.stats || null;
      if (repairLegacyJobrightTimes(state.rawJobs, Date.parse(state.lastScrapedAt || ''))) {
        recomputeFiltered();
        await persistResults();
      }
      // Whatever is pending counts as seen, including lists saved before this memory existed.
      markJobsSeen(state.rawJobs, Date.parse(state.lastScrapedAt || '') || Date.now());
      recomputeFiltered();
    }
  }

  async function persistPrefs() {
    await storageSet({ [STORAGE.prefs]: state.prefs });
  }

  async function persistCustomSearch() {
    if (state.customSearchState) {
      await storageSet({
        [STORAGE.customSearch]: {
          searchState: state.customSearchState,
          sourceUrl: state.customSearchSourceUrl || '',
          importedAt: new Date().toISOString(),
        },
      });
    } else {
      await chrome.storage.local.remove(STORAGE.customSearch);
    }
  }

  /** The hide rules that are switched off, by the name of what they would hide. */
  function hideRulesSwitchedOff() {
    return [
      ['excludeRegisteredJobs', 'jobs you applied to'],
      ['excludeRegisteredCompanies', 'companies you applied to'],
      ['excludeBlockedJobs', 'blocked jobs'],
      ['excludeBlockedCompanies', 'blocked companies'],
      ['excludeBlockedAts', 'blocked ATS'],
      ['directLinksOnly', 'easy-apply listings'],
    ]
      .filter(([key]) => state.prefs[key] === false)
      .map(([, label]) => label);
  }

  async function persistBlockLists() {
    await storageSet({
      [STORAGE.blockedCompanies]: state.blockedCompanies,
      [STORAGE.blockedAts]: state.blockedAts,
      [STORAGE.blockedJobs]: state.blockedJobs,
    });
  }

  function blockedRecordId(item) {
    if (!item || typeof item === 'string') return '';
    return String(item.id || '').trim();
  }

  function blockedCompanyName(item) {
    if (typeof item === 'string') return item.trim();
    return String(item?.companyName || '').trim();
  }

  function blockedAtsName(item) {
    if (typeof item === 'string') return item.trim();
    return String(item?.atsName || '').trim();
  }

  function normalizeBlockedCompany(item) {
    if (typeof item === 'string') {
      return item.trim() ? { id: '', companyName: item.trim() } : null;
    }
    const companyName = String(item?.companyName || '').trim();
    if (!companyName) return null;
    return { id: String(item.id || '').trim(), companyName };
  }

  function normalizeBlockedAts(item) {
    if (typeof item === 'string') {
      return item.trim() ? { id: '', atsName: item.trim() } : null;
    }
    const atsName = String(item?.atsName || '').trim();
    if (!atsName) return null;
    return { id: String(item.id || '').trim(), atsName };
  }

  function normalizeBlockedJob(item) {
    if (typeof item === 'string') {
      return item.trim() ? { id: '', jobLink: item.trim(), jobTitle: '', companyName: '' } : null;
    }
    const jobLink = String(item?.jobLink || item?.apply_url || '').trim();
    if (!jobLink) return null;
    return {
      id: String(item.id || '').trim(),
      jobLink,
      jobTitle: String(item.jobTitle || item.title || '').trim(),
      companyName: String(item.companyName || item.company_name || '').trim(),
    };
  }

  function blockedCompanyNames() {
    return state.blockedCompanies.map(blockedCompanyName).filter(Boolean);
  }

  function blockedAtsNames() {
    return state.blockedAts.map(blockedAtsName).filter(Boolean);
  }

  function blockedJobRefs() {
    return state.blockedJobs.map(normalizeBlockedJob).filter(Boolean);
  }

  function applyWebsiteBlockedLists(data) {
    if (Array.isArray(data.blockedCompanies)) {
      state.blockedCompanies = data.blockedCompanies.map(normalizeBlockedCompany).filter(Boolean);
    }
    if (Array.isArray(data.blockedAts)) {
      state.blockedAts = data.blockedAts.map(normalizeBlockedAts).filter(Boolean);
    }
    if (Array.isArray(data.blockedJobs)) {
      state.blockedJobs = data.blockedJobs.map(normalizeBlockedJob).filter(Boolean);
    }
  }

  async function persistResults() {
    await rememberScrapedNames(state.filteredJobs).catch(() => {});
    await storageSet({
      [STORAGE.lastResults]: {
        jobs: state.filteredJobs,
        rawJobs: state.rawJobs,
        scrapedAt: state.lastScrapedAt,
        stats: state.stats,
      },
    });
  }

  function formatFilterRemovalDetail(stats) {
    if (!stats) return '';
    const bits = [];
    if (stats.removedByDate) bits.push(`${stats.removedByDate} by date`);
    if (stats.removedBlockedJobs) bits.push(`${stats.removedBlockedJobs} blocked jobs`);
    if (stats.removedBlockedCompanies) {
      bits.push(`${stats.removedBlockedCompanies} blocked cos`);
    }
    if (stats.removedAts) bits.push(`${stats.removedAts} blocked ATS`);
    if (stats.removedAggregator) bits.push(`${stats.removedAggregator} easy-apply`);
    if (stats.removedRepost) bits.push(`${stats.removedRepost} reposts`);
    if (stats.removedClearance) bits.push(`${stats.removedClearance} clearance`);
    if (stats.removedForeign) bits.push(`${stats.removedForeign} outside US`);
    if (stats.removedDegree) bits.push(`${stats.removedDegree} higher degree`);
    if (stats.removedLanguage) bits.push(`${stats.removedLanguage} other language`);
    if (stats.removedJobType) bits.push(`${stats.removedJobType} job type`);
    if (stats.removedNotOpen) {
      bits.push(
        state.prefs.candidateCountry === ANY_COUNTRY
          ? `${stats.removedNotOpen} US-only`
          : `${stats.removedNotOpen} not open to ${state.prefs.candidateCountry}`
      );
    }

    if (stats.removedRegisteredJobs) bits.push(`${stats.removedRegisteredJobs} reg. jobs`);
    if (stats.removedRegisteredCompanies) {
      bits.push(`${stats.removedRegisteredCompanies} reg. cos`);
    }
    return bits.length ? `Hidden: ${bits.join(' · ')}` : 'No matches hidden by lists';
  }

  function normalizeFreshnessPref(value) {
    const pref = String(value || '')
      .trim()
      .toLowerCase();
    return /^\d+[hd]$/.test(pref) ? pref : '';
  }

  function resolveJrDateWindow() {
    return (
      normalizeFreshnessPref(state.prefs.freshnessWindowJr) ||
      normalizeFreshnessPref(state.prefs.freshnessWindow) ||
      DEFAULT_PREFS.freshnessWindowJr
    );
  }

  /** The HiringCafe search a run uses: an imported one, else this mode's default. */
  function hcSearchStateForRun() {
    if (state.customSearchState) return state.customSearchState;
    if (state.mode === 'intl' && state.prefs.candidateCountry) {
      const code = state.prefs.candidateCountry;
      if (code === ANY_COUNTRY) return api()?.anyCountrySearchState?.() || null;
      return api()?.countrySearchState?.(code, countryName(code)) || null;
    }
    return null;
  }

  function resolveHcDateWindow() {
    const pref =
      normalizeFreshnessPref(state.prefs.freshnessWindowHc) ||
      normalizeFreshnessPref(state.prefs.freshnessWindow);
    if (pref) return pref;
    const scraper = api();
    const importedDays = Number(state.customSearchState?.dateFetchedPastNDays);
    if (Number.isFinite(importedDays) && importedDays >= 1) {
      return scraper?.dateWindowFromDays?.(importedDays) || `${Math.round(importedDays)}d`;
    }
    return DEFAULT_PREFS.freshnessWindowHc;
  }

  /** @deprecated use resolveHcDateWindow */
  function resolveScrapeDateWindow() {
    return resolveHcDateWindow();
  }

  /** @deprecated use resolveHcDateWindow */
  function resolveHiringCafeDateWindow() {
    return resolveHcDateWindow();
  }

  function jobOriginKey(job) {
    const raw = String(job?.origin || job?.source || '')
      .trim()
      .toLowerCase();
    if (raw.includes('jobright') || raw === 'jr') return 'jobright';
    if (raw.includes('hiring') || raw === 'hc') return 'hiringcafe';
    return '';
  }

  /**
   * Split jobs by freshness window. Undated jobs are excluded from "in window"
   * (same as filterJobsByPublishDate). Does not drop same-company roles.
   */
  function partitionJobsByDateWindow(jobs, dateWindow, nowMs = Date.now()) {
    const scraper = api();
    const cutoffMs =
      typeof scraper?.dateWindowCutoffMs === 'function'
        ? scraper.dateWindowCutoffMs(dateWindow, nowMs)
        : nowMs - 8 * 60 * 60 * 1000;
    const parsed =
      typeof scraper?.parseFreshnessWindow === 'function'
        ? scraper.parseFreshnessWindow(dateWindow)
        : { label: String(dateWindow || ''), hcDays: 1, kind: 'hours', amount: 8 };
    const inWindow = [];
    const outWindow = [];
    const undated = [];
    for (const job of jobs || []) {
      const raw = String(job?.estimated_publish_date || job?.posted_at || '').trim();
      if (!raw) {
        undated.push(job);
        continue;
      }
      const times = jobPostedTimes(job, nowMs);
      if (!times || times.latestMs < cutoffMs) {
        outWindow.push(job);
      } else {
        inWindow.push(job);
      }
    }
    return {
      inWindow,
      outWindow,
      undated,
      days: parsed.hcDays,
      label: parsed.label || String(dateWindow || ''),
      cutoffMs,
    };
  }

  /** Apply each job's source-specific freshness window. */
  function filterJobsByPerSourceFreshness(jobs, nowMs = Date.now()) {
    const jrWin = resolveJrDateWindow();
    const hcWin = resolveHcDateWindow();
    const filtered = [];
    let removedByDate = 0;
    for (const job of jobs || []) {
      const origin = jobOriginKey(job);
      const win = origin === 'jobright' ? jrWin : hcWin;
      const part = partitionJobsByDateWindow([job], win, nowMs);
      // An undated Jobright row was admitted on purpose at scrape time (no dates
      // were available to judge by); it has no date to fail here either.
      if (part.inWindow.length || (origin === 'jobright' && part.undated.length)) {
        filtered.push(job);
      } else {
        removedByDate += 1;
      }
    }
    return {
      filtered,
      removedByDate,
      dateWindowJr: jrWin,
      dateWindowHc: hcWin,
    };
  }

  /** The moment the saved results were scraped; "now" only before any run. */
  function freshnessReferenceMs() {
    const started = Date.parse(state.stats?.startedAt || state.lastScrapedAt || '');
    return Number.isNaN(started) ? Date.now() : started;
  }

  function recomputeFiltered() {
    const scraper = api();
    if (!scraper) {
      state.filteredJobs = [...state.rawJobs];
      return;
    }

    const hasProfile = Boolean(state.prefs.candidateFilter);
    // The freshness window limits what a run reads. Once a job is in the pending
    // list it stays until cleared, however old it gets.
    const dated = {
      removedByDate: 0,
      dateWindowJr: resolveJrDateWindow(),
      dateWindowHc: resolveHcDateWindow(),
    };
    const deduped = scraper.dedupeJobs(state.rawJobs);
    const { filtered: afterBlocks, stats } = scraper.applyLocalFilters(deduped, {
      excludeBlockedCompanies: state.prefs.excludeBlockedCompanies,
      excludeBlockedAts: state.prefs.excludeBlockedAts,
      excludeBlockedJobs: state.prefs.excludeBlockedJobs,
      excludeRegisteredJobs: hasProfile && state.prefs.excludeRegisteredJobs,
      excludeRegisteredCompanies: hasProfile && state.prefs.excludeRegisteredCompanies,
      blockedCompanies: blockedCompanyNames(),
      blockedAts: blockedAtsNames(),
      blockedJobs: blockedJobRefs(),
      registeredJobs: state.registeredJobs,
      registeredCompanies: state.registeredCompanies,
    });

    // After dedupe, so a job found on Jobright and directly on HiringCafe keeps its direct copy.
    const direct = state.prefs.directLinksOnly
      ? (afterBlocks || []).filter((job) => !hiddenByDirectLinks(job))
      : afterBlocks || [];
    const removedAggregator = (afterBlocks || []).length - direct.length;
    const fresh = state.prefs.hideReposts ? direct.filter((job) => job.repost !== true) : direct;
    const removedRepost = direct.length - fresh.length;
    const cleared = state.prefs.hideClearanceRequired
      ? fresh.filter((job) => job.clearance_required !== true)
      : fresh;
    const removedClearance = fresh.length - cleared.length;
    // Only a stated, different country excludes; an unknown one does not.
    // A stated other country excludes; so does a title that limits the job to
    // another region. An unknown country alone does not.
    const worldwide = state.mode === 'intl';
    const domestic = !worldwide && state.prefs.usOnly
      ? cleared.filter(
          (job) =>
            (!job.country_code || /^(us|usa)$/i.test(String(job.country_code).trim())) &&
            !titleLimitsToOutsideUs(job.title)
        )
      : cleared;
    const removedForeign = cleared.length - domestic.length;
    const reachable =
      worldwide && state.prefs.openToCountryOnly && state.prefs.candidateCountry
        ? domestic.filter((job) => openToCountry(job, state.prefs.candidateCountry))
        : domestic;
    const removedNotOpen = domestic.length - reachable.length;
    const degreeOk = state.prefs.hideAdvancedDegree
      ? reachable.filter((job) => job.advanced_degree_required !== true)
      : reachable;
    const removedDegree = reachable.length - degreeOk.length;
    const languageOk = state.prefs.hideForeignLanguage
      ? degreeOk.filter((job) => job.foreign_language_required !== true)
      : degreeOk;
    const removedLanguage = degreeOk.length - languageOk.length;
    const typeOk = languageOk.filter(jobTypeShown);
    const removedJobType = languageOk.length - typeOk.length;
    let filtered = sortBidJobs(typeOk);
    // Several jobs at one company: all stay, side by side under the company's best
    // one, so the user picks which to bid on.
    let groupedSameCompany = 0;
    let companiesWithSeveral = 0;
    if (state.prefs.onePerCompany) {
      const grouped = groupJobsByCompany(filtered);
      filtered = grouped.jobs;
      groupedSameCompany = grouped.extraJobs;
      companiesWithSeveral = grouped.companiesWithSeveral;
    }

    state.filteredJobs = filtered;
    state.stats = {
      ...(state.stats || {}),
      scraped: state.rawJobs.length,
      deduped: deduped.length,
      removedByDate: dated.removedByDate || 0,
      dateWindow: `${dated.dateWindowJr || ''}/${dated.dateWindowHc || ''}`,
      dateWindowJr: dated.dateWindowJr,
      dateWindowHc: dated.dateWindowHc,
      removedBlockedJobs: stats.removedBlockedJobs,
      removedBlockedCompanies: stats.removedBlockedCompanies,
      removedAts: stats.removedAts,
      removedRegisteredJobs: stats.removedRegisteredJobs,
      removedRegisteredCompanies: stats.removedRegisteredCompanies,
      removedAggregator,
      removedRepost,
      removedClearance,
      removedForeign,
      removedDegree,
      removedLanguage,
      removedJobType,
      removedNotOpen,
      // Jobs both sources listed, and how often the other source's posting time was earlier.
      crossSourceDates: deduped.dateMerge || null,
      groupedSameCompany,
      companiesWithSeveral,
      remaining: filtered.length,
      registeredJobCount: state.registeredJobs.length,
      registeredCompanyCount: state.registeredCompanies.length,
    };

    const validKeys = new Set(filtered.map((job, i) => jobKey(job, i)));
    state.selectedKeys = new Set([...state.selectedKeys].filter((k) => validKeys.has(k)));
  }

  function setProgress(options = {}) {
    const {
      text = '',
      detail = '',
      kind = 'info',
      current = null,
      total = null,
      indeterminate = false,
      hidden = false,
      phase = null,
      showTrust = null,
    } = options;

    state.status = text || '';
    const section = document.getElementById('jsProgressSection');
    const root = document.getElementById('jsProgress') || section;
    const label = document.getElementById('jsProgressLabel');
    const pctEl = document.getElementById('jsProgressPct');
    const bar = document.getElementById('jsProgressBar');
    const detailEl = document.getElementById('jsProgressDetail');
    const trustEl = document.getElementById('jsProgressTrust');
    const phaseStrip = document.getElementById('jsPhaseStrip');
    if (!section || !label || !bar) return;

    const clean = (value) => String(value || '').replace(/\u2014|\u2013/g, '-');

    if (hidden || !text) {
      section.hidden = true;
      if (root && root !== section) root.hidden = true;
      if (root) {
        root.dataset.kind = 'info';
        root.classList.remove('is-indeterminate');
      }
      bar.style.width = '0%';
      if (pctEl) {
        pctEl.hidden = true;
        pctEl.textContent = '';
      }
      if (detailEl) {
        detailEl.hidden = true;
        detailEl.textContent = '';
      }
      if (trustEl) trustEl.hidden = true;
      if (phaseStrip) phaseStrip.hidden = true;
      syncResultsPanelUi();
      return;
    }

    section.hidden = false;
    if (root && root !== section) root.hidden = false;
    if (root) root.dataset.kind = kind || 'info';
    label.textContent = clean(text);

    const trustVisible =
      showTrust != null ? showTrust : kind === 'info' || kind === 'warn';
    if (trustEl) {
      trustEl.hidden = !trustVisible;
      if (kind === 'warn' && state.pausedForChallenge) {
        trustEl.textContent =
          'Browser check in the open tab — finish it, then hit Resume. Nothing is uploaded.';
      } else {
        trustEl.textContent =
          'Using your open browser tabs. JobStrike does not store passwords.';
      }
    }

    if (phaseStrip) {
      const combined = isCombinedMode() || phase;
      phaseStrip.hidden = !combined;
      if (combined) {
        const activePhase =
          phase ||
          state.combinedRun?.phase ||
          (kind === 'success' ? 'done' : 'jobright');
        const order = ['jobright', 'hiringcafe', 'done'];
        const activeIdx = order.indexOf(activePhase);
        phaseStrip.querySelectorAll('.js-progress-phase').forEach((el) => {
          const name = el.getAttribute('data-phase');
          const idx = order.indexOf(name);
          el.classList.remove('is-active', 'is-done', 'is-paused');
          if (kind === 'success' || activePhase === 'done') {
            el.classList.add('is-done');
          } else if (name === activePhase) {
            el.classList.add(kind === 'warn' ? 'is-paused' : 'is-active');
          } else if (idx >= 0 && activeIdx >= 0 && idx < activeIdx) {
            el.classList.add('is-done');
          }
        });
      }
    }

    if (detailEl) {
      if (detail) {
        detailEl.hidden = false;
        detailEl.textContent = clean(detail);
      } else {
        detailEl.hidden = true;
        detailEl.textContent = '';
      }
    }

    const hasNumbers =
      Number.isFinite(current) && Number.isFinite(total) && total > 0;
    if (indeterminate || !hasNumbers) {
      if (root) root.classList.add('is-indeterminate');
      bar.style.width = '35%';
      if (pctEl) {
        pctEl.hidden = true;
        pctEl.textContent = '';
      }
    } else {
      if (root) root.classList.remove('is-indeterminate');
      const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
      bar.style.width = `${pct}%`;
      if (pctEl) {
        pctEl.hidden = false;
        pctEl.textContent = `${pct}%`;
      }
    }

    // After Done: hand off to Results actions. While running: hide Results.
    if (kind === 'success' && (phase === 'done' || /done/i.test(String(text)))) {
      finishScrapeUiReveal();
    } else if (kind === 'error') {
      syncResultsPanelUi();
    } else {
      syncResultsPanelUi({
        mode: state.pausedForChallenge ? 'paused' : state.scraping ? 'scraping' : undefined,
      });
    }
  }

  /**
   * While scraping: show progress only.
   * After finish: hide progress, show Results + Export/Copy/Clear.
   */
  function syncResultsPanelUi(options = {}) {
    const card = document.getElementById('jsResultsCard');
    const actions = document.getElementById('jsResultsActions');
    if (!card) return;

    const hasJobs = state.filteredJobs.length > 0 || state.rawJobs.length > 0;
    let mode = options.mode;
    if (!mode) {
      if (state.scraping && !state.pausedForChallenge) mode = 'scraping';
      else if (state.pausedForChallenge) mode = 'paused';
      else if (hasJobs) mode = 'ready';
      else mode = 'idle';
    }

    card.classList.remove('is-scraping', 'is-ready', 'is-paused', 'is-idle');
    card.classList.add(
      mode === 'scraping'
        ? 'is-scraping'
        : mode === 'paused'
          ? 'is-paused'
          : mode === 'ready'
            ? 'is-ready'
            : 'is-idle'
    );

    if (mode === 'scraping' || mode === 'paused') {
      card.hidden = true;
      if (actions) actions.hidden = true;
      return;
    }

    card.hidden = false;
    if (actions) {
      const showActions = mode === 'ready' && state.filteredJobs.length > 0;
      actions.hidden = !showActions;
    }
  }

  function finishScrapeUiReveal() {
    const progress = document.getElementById('jsProgressSection');
    window.setTimeout(() => {
      if (state.scraping && !state.pausedForChallenge) return;
      if (progress) progress.hidden = true;
      syncResultsPanelUi({
        mode: state.filteredJobs.length || state.rawJobs.length ? 'ready' : 'idle',
      });
      renderResults();
      const card = document.getElementById('jsResultsCard');
      if (card && !card.hidden) {
        try {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (_) {
          /* ignore */
        }
      }
    }, 450);
  }

  function formatBidPostedAt(value) {
    if (value == null || value === '') return '';
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?(Z|[+-]00:?00)$/.test(raw)) return raw.slice(0, 10);
    let d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      const match = raw.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?Z?$/
      );
      if (match) {
        d = new Date(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5])
        );
      }
    }
    if (Number.isNaN(d.getTime())) return raw;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeBidJob(job, origin) {
    return {
      apply_url: job?.apply_url || null,
      posted_at: formatBidPostedAt(
        job?.posted_at || job?.estimated_publish_date || ''
      ),
      title: job?.title || null,
      company_name: job?.company_name || null,
      application_site:
        (job?.apply_url && api()?.detectPlatform?.(job.apply_url)) || job?.application_site || 'Unknown',
      applicants_count:
        job?.applicants_count != null && String(job.applicants_count).trim()
          ? String(job.applicants_count).trim()
          : null,
      origin: origin || job?.origin || '',
      estimated_publish_date: job?.estimated_publish_date || null,
      source: job?.source || origin || '',
      id: job?.id || null,
      applicants_text: job?.applicants_text || null,
      ...sourceStatedFacts(job),
      work_model: job?.work_model || null,
      job_type: jobTypeLabel(job?.job_type || job?.employment_type) || null,
      // Where the job may be done from (HiringCafe), for the worldwide mode.
      workplace_countries: Array.isArray(job?.workplace_countries) ? job.workplace_countries : [],
      worldwide_ok: job?.worldwide_ok === true,
      repost: job?.repost === true,
      easy_apply: job?.easy_apply === true,
      first_seen_at: job?.first_seen_at || null,
      time_v: 2,
    };
  }

  /** Straight-line interpolation through [x, y] points; flat beyond either end. */
  function interpolate(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      if (x <= x1) {
        const [x0, y0] = points[i - 1];
        return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return points[points.length - 1][1];
  }

  // Share of the freshness points left after N hours. Screening usually starts
  // within a day or two and the shortlist fills during the first week, so the
  // value falls slowly at first, fastest between day 1 and day 3, then flattens.
  const FRESHNESS_CURVE = [
    [0, 1], [6, 0.95], [24, 0.8], [48, 0.6], [72, 0.45], [168, 0.2], [336, 0.08], [720, 0.03],
  ];
  // Share of the competition points at N applicants. The count is Jobright's:
  // its own users who marked the job as applied, which is optional, so the real
  // number is higher by an unknown factor. It ranks jobs against each other
  // (more marks, more competition) but says little as a number, so it carries
  // few points.
  const COMPETITION_CURVE = [[0, 1], [25, 1], [50, 0.8], [100, 0.5], [200, 0.1], [500, 0]];
  const FRESHNESS_POINTS = 80;
  const COMPETITION_POINTS = 20;
  // A repost shows a fresh date and a small count, but the employer already
  // holds the earlier applicants, so the real queue is longer than it looks.
  const REPOST_PENALTY = 10;

  // Age brackets (hours) for "how many applicants does a job this old usually
  // have": the same shape as the freshness curve, so each covers one stage.
  const AGE_BRACKETS = [[0, 6], [6, 12], [12, 24], [24, 48], [48, 168], [168, Infinity]];
  const TYPICAL_MIN_SAMPLES = 5;

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Typical applicant counts by age, from the jobs that state one (Jobright).
   * Fills the gap for sources that give no count (HiringCafe), so a 3-hour-old
   * job there is scored like other 3-hour-old jobs rather than as a middling one.
   */
  function typicalApplicantsByAge(jobs, nowMs = Date.now()) {
    const buckets = AGE_BRACKETS.map(() => []);
    const all = [];
    for (const job of jobs || []) {
      const count = applicantsEstimate(job);
      if (count == null) continue;
      const posted = jobPostedTimes(job, nowMs);
      if (!posted) continue;
      const hours = Math.max(0, (nowMs - posted.ms) / 3600000);
      const index = AGE_BRACKETS.findIndex(([from, to]) => hours >= from && hours < to);
      if (index >= 0) buckets[index].push(count);
      all.push(count);
    }
    return {
      brackets: buckets.map((values) => (values.length >= TYPICAL_MIN_SAMPLES ? median(values) : null)),
      overall: all.length >= TYPICAL_MIN_SAMPLES ? median(all) : null,
      samples: all.length,
    };
  }

  /** The typical count for a job this old, or null when there is too little evidence. */
  function typicalApplicants(table, hours) {
    if (!table || hours == null) return null;
    const index = AGE_BRACKETS.findIndex(([from, to]) => hours >= from && hours < to);
    const own = index >= 0 ? table.brackets[index] : null;
    if (own != null) return own;
    // Nearest bracket with enough samples, then the whole run.
    for (let step = 1; step < AGE_BRACKETS.length; step += 1) {
      const below = table.brackets[index - step];
      const above = table.brackets[index + step];
      if (below != null) return below;
      if (above != null) return above;
    }
    return table.overall;
  }

  /**
   * Job points, 0–100: how much an application sent now is worth, the way a
   * screener's queue works. Being early counts most (80), a small pile next (20).
   * Continuous, so two jobs an hour apart get different points. Skills,
   * experience and the kind of application form are not part of it.
   * A missing applicant count is taken from `typical`, the run's own counts by
   * age; without that evidence it scores as middling, never as a zero.
   * A repost loses REPOST_PENALTY points.
   */
  function jobPriority(job, nowMs = Date.now(), typical = null) {
    const posted = jobPostedTimes(job, nowMs);
    const hours = posted ? Math.max(0, (nowMs - posted.ms) / 3600000) : null;
    const freshness = hours == null ? 0.4 : interpolate(FRESHNESS_CURVE, hours);

    let applicants = applicantsEstimate(job);
    let estimated = false;
    if (applicants == null) {
      const guess = typicalApplicants(typical, hours);
      if (guess != null) {
        applicants = Math.round(guess);
        estimated = true;
      }
    }
    const competition = applicants != null ? interpolate(COMPETITION_CURVE, applicants) : 0.5;
    const repost = job?.repost === true;

    const raw = FRESHNESS_POINTS * freshness + COMPETITION_POINTS * competition - (repost ? REPOST_PENALTY : 0);
    const score = Math.max(0, Math.round(raw * 10) / 10);
    return { score, hours, applicants, estimated, repost };
  }

  /**
   * Applicants as a number for scoring. Jobright's text is the precise form:
   * "< 25 applicants" (fewer than 25), "60 applicants" (exactly), "100+
   * applicants" (at least 100). For "100+" the row's own number is used when it
   * says more than the text does; otherwise a quarter more. Null when unknown.
   */
  function applicantsEstimate(job) {
    const text = String(job?.applicants_text || '').trim();
    const number = (s) => Number(String(s).replace(/,/g, ''));
    const raw = (String(job?.applicants_count ?? '').match(/\d[\d,]*/) || [''])[0];
    const stated = raw ? number(raw) : NaN;
    const statedCount = Number.isFinite(stated) && stated > 0 ? stated : null;
    let m = text.match(/^(?:<|less than|under|fewer than)\s*(\d[\d,]*)/i);
    if (m) return Math.max(1, number(m[1]) - 1);
    m = text.match(/^(?:over\s+)?(\d[\d,]*)\s*\+/i) || text.match(/^(?:over|more than)\s+(\d[\d,]*)/i);
    if (m) {
      const floor = number(m[1]);
      return statedCount != null && statedCount > floor ? statedCount : Math.round(floor * 1.25);
    }
    m = text.match(/^(\d[\d,]*)/);
    if (m) return number(m[1]);
    return statedCount;
  }

  /** Applicants as shown in the sheet: "< 25", "60", "100+". */
  function applicantsLabel(job) {
    const text = String(job?.applicants_text || '').replace(/\s*applicants?\s*$/i, '').trim();
    return text || (job?.applicants_count ?? '');
  }

  /**
   * Job types in one vocabulary for both sources (Jobright "Full-time",
   * HiringCafe "Full Time", "Contract to hire", …), each with its show setting.
   */
  const JOB_TYPES = [
    { label: 'Full-time', pref: 'showFullTime', re: /full[\s_-]*time|permanent/i },
    { label: 'Contract', pref: 'showContract', re: /contract|freelance|\b1099\b|\bc2c\b|corp[\s_-]*to[\s_-]*corp/i },
    { label: 'Part-time', pref: 'showPartTime', re: /part[\s_-]*time/i },
    { label: 'Temporary', pref: 'showTemporary', re: /\btemp(orary)?\b|seasonal/i },
    { label: 'Internship', pref: 'showInternship', re: /\bintern(ship)?s?\b/i },
  ];

  /** "Full-time", "Contract, Part-time", or '' when the source states no known type. */
  function jobTypeLabel(value) {
    const text = String(value ?? '');
    if (!text.trim()) return '';
    return JOB_TYPES.filter((type) => type.re.test(text)).map((type) => type.label).join(', ');
  }

  /** Shown while any of the job's types is ticked; an unstated type never hides a job. */
  function jobTypeShown(job) {
    const labels = String(job?.job_type || '').split(/,\s*/).filter(Boolean);
    if (!labels.length) return true;
    return labels.some((label) => {
      const type = JOB_TYPES.find((item) => item.label === label);
      return !type || state.prefs[type.pref] !== false;
    });
  }

  /**
   * Hard facts the source states about a job, in one shape for both sources.
   * Jobright gives flags; HiringCafe gives its own reading of the posting.
   * Anything not stated stays false / null: unknown never excludes a job.
   */
  function sourceStatedFacts(job) {
    const none = (value) => /^(|none|null|no|n\/a|not mentioned|not required|unknown)$/i.test(String(value ?? '').trim());
    const required = (value) => /^required$/i.test(String(value ?? '').trim());

    const clearance =
      job?.clearance_required === true ||
      (job?.security_clearance != null && !none(job.security_clearance));

    const languages = Array.isArray(job?.language_requirements) ? job.language_requirements : [];
    const foreignLanguage =
      job?.foreign_language_required === true ||
      languages.some((name) => name && !/^english$/i.test(name));

    const advancedDegree =
      job?.advanced_degree_required === true ||
      required(job?.masters_degree_requirement) ||
      required(job?.doctorate_degree_requirement);

    // A list of countries that leaves out the US places the job abroad.
    const countries = Array.isArray(job?.workplace_countries) ? job.workplace_countries : [];
    let country = job?.country_code || null;
    if (!country && countries.length) {
      country = countries.some((code) => /^(US|USA)$/.test(code)) ? 'US' : countries[0];
    }

    return {
      clearance_required: clearance,
      foreign_language_required: foreignLanguage,
      advanced_degree_required: advancedDegree,
      country_code: country,
    };
  }

  /**
   * Title wording that limits a job to somewhere other than the US: European
   * gender tags such as "(m/w/d)", "remote within Germany", "Remote (Europe)",
   * "UK - Remote", or CET working hours. A title that names the US as well
   * ("Remote - US or Canada") is not excluded.
   */
  const NON_US_GENDER_TAG_RE = /\((?:(?:[mwfdhx]\s*\/\s*){1,3}[mwfdhx]|gn|all genders?)\)/i;
  const NON_US_REGION_RE = new RegExp(
    [
      // "remote within Germany", "remote in the EU", "Remote (Europe)", "Remote - UK"
      String.raw`remote\s*(?:[-–—:,(|/]\s*)?(?:only\s+)?(?:within|in|across|from)?\s*(?:the\s+)?(?<!new\s)(?:germany|deutschland|deutschlandweit|austria|switzerland|dach|europe|european union|eu|emea|uk|united kingdom|england|ireland|france|spain|portugal|italy|netherlands|belgium|poland|romania|bulgaria|czechia|czech republic|hungary|greece|sweden|norway|denmark|finland|baltics|estonia|latvia|lithuania|ukraine|serbia|croatia|turkey|israel|canada|mexico|latam|latin america|south america|brazil|argentina|colombia|chile|costa rica|india|apac|asia|philippines|singapore|vietnam|pakistan|sri lanka|indonesia|malaysia|australia|new zealand|africa|south africa|nigeria|kenya|egypt|armenia)\b`,
      // "UK - Remote", "Germany (Remote)", "Europe / remote"
      String.raw`\b(?<!new\s)(?:germany|deutschland|deutschlandweit|austria|switzerland|dach|europe|european union|eu|emea|uk|united kingdom|england|ireland|france|spain|portugal|italy|netherlands|belgium|poland|romania|bulgaria|czechia|czech republic|hungary|greece|sweden|norway|denmark|finland|baltics|estonia|latvia|lithuania|ukraine|serbia|croatia|turkey|israel|canada|mexico|latam|latin america|south america|brazil|argentina|colombia|chile|costa rica|india|apac|asia|philippines|singapore|vietnam|pakistan|sri lanka|indonesia|malaysia|australia|new zealand|africa|south africa|nigeria|kenya|egypt|armenia)\s*(?:[-–—:,(|/]\s*)?(?:fully\s+)?remote`,
      // working hours tied to a European or Asian time zone
      String.raw`\b(?:cet|cest|gmt\+?[1-9]|ist|eet|eest|bst)\b`,
    ].join('|'),
    'i'
  );
  const MENTIONS_US_RE = /\b(?:us|u\.s\.?|usa|united states|north america|americas|us-based|est|pst|cst)\b/i;

  // German job-title words ("Entwickler", "Berater", "Produktmanager:in", "Werkstudent").
  const GERMAN_TITLE_RE =
    /\b(?:\w*entwickler|berater|ingenieur|\w*leiter|mitarbeiter|werkstudent|praktik|ausbildung|sachbearbeiter|fachkraft|\w*deutschland)\w*|\breferent(?:in)?\b|\w(?::|\*)in(?:nen)?\b/i;

  /** Words in a title that open a job beyond the US (a region or "anywhere"). */
  const BEYOND_US_RE =
    /\b(?:worldwide|global(?:ly)?|anywhere|international|remote[- ]first|latam|latin america|emea|apac|europe|eu|americas)\b/i;

  /**
   * Can a candidate in `code` take this job? The source's list of countries
   * decides when it has one; a job based in another country (Jobright states
   * the job's country) or a title limited to the US does not qualify. A job
   * that states nothing is kept: unknown never excludes.
   */
  /** A title limited to US residents. Time zones (EST, PST) are not: LATAM contracts often ask for them. */
  const US_ONLY_TITLE_RE = /\b(?:us|u\.s\.?|usa|united states|us-based)\b/i;
  /** Other ways a title names a country than its English display name. */
  const COUNTRY_ALIASES = {
    GB: ['uk', 'united kingdom', 'britain', 'england', 'scotland'],
    TR: ['turkey', 'türkiye'],
    HK: ['hong kong'],
    CZ: ['czech'],
    KR: ['korea'],
    AE: ['uae', 'emirates', 'dubai'],
    NL: ['netherlands', 'holland'],
    VN: ['vietnam'],
    CN: ['china'],
    TW: ['taiwan'],
  };
  function titleNamesCountry(title, code) {
    const text = String(title || '').toLowerCase();
    const names = [countryName(code), ...(COUNTRY_ALIASES[code] || [])].map((n) => String(n).toLowerCase());
    return names.some((n) => n && text.includes(n)) || new RegExp(`\\b${code}\\b`).test(title);
  }

  /** Any country outside the US: only a job limited to the US is out. */
  function openOutsideUs(job) {
    if (job?.worldwide_ok === true) return true;
    const countries = (Array.isArray(job?.workplace_countries) ? job.workplace_countries : [])
      .map((c) => String(c || '').trim().toUpperCase())
      .filter(Boolean);
    if (countries.length) return countries.some((c) => c !== 'US' && c !== 'USA');
    const stated = String(job?.country_code || '').trim().toUpperCase();
    if (stated === 'US' || stated === 'USA') return false;
    const title = String(job?.title || '');
    return !(US_ONLY_TITLE_RE.test(title) && !BEYOND_US_RE.test(title));
  }

  function openToCountry(job, code) {
    const want = String(code || '').toUpperCase();
    if (!want) return true;
    if (want === ANY_COUNTRY) return openOutsideUs(job);
    if (job?.worldwide_ok === true) return true;
    const countries = (Array.isArray(job?.workplace_countries) ? job.workplace_countries : [])
      .map((c) => String(c || '').trim().toUpperCase())
      .filter(Boolean);
    if (countries.length) return countries.includes(want);
    const stated = String(job?.country_code || '').trim().toUpperCase();
    if (stated && stated !== want) return false;
    const title = String(job?.title || '');
    if (US_ONLY_TITLE_RE.test(title) && !titleNamesCountry(title, want) && !BEYOND_US_RE.test(title)) {
      return false;
    }
    return true;
  }

  function titleLimitsToOutsideUs(title) {
    const text = String(title || '');
    if (!text) return false;
    if (MENTIONS_US_RE.test(text)) return false;
    return NON_US_GENDER_TAG_RE.test(text) || NON_US_REGION_RE.test(text) || GERMAN_TITLE_RE.test(text);
  }

  /** Highest points first; newer first when points are equal. */
  function sortBidJobs(jobs) {
    const sortedAt = Date.now();
    // Typical counts come from everything this run found, not only the shown jobs.
    const typical = typicalApplicantsByAge(state.rawJobs, sortedAt);
    return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
      const pA = jobPriority(a, sortedAt, typical).score;
      const pB = jobPriority(b, sortedAt, typical).score;
      if (pA !== pB) return pB - pA;
      const tA = Date.parse(a?.estimated_publish_date || a?.posted_at || '') || 0;
      const tB = Date.parse(b?.estimated_publish_date || b?.posted_at || '') || 0;
      if (tA !== tB) return tB - tA;
      const coA = String(a?.company_name || '').toLowerCase();
      const coB = String(b?.company_name || '').toLowerCase();
      if (coA !== coB) return coA.localeCompare(coB);
      return String(a?.title || '').localeCompare(String(b?.title || ''));
    });
  }

  /**
   * Jobs in bid order, with each company's jobs moved up under its best one.
   * Companies are compared the way the duplicate check compares them; jobs with
   * no company name stay where they are.
   * @returns {{ jobs: object[], position: Map<object, {index:number,count:number}>, extraJobs:number, companiesWithSeveral:number }}
   */
  function groupJobsByCompany(sortedJobs) {
    const matcher = window.SmartJobCompanyName?.companiesMatch;
    const same = (a, b) => (matcher ? matcher(a, b) : a.toLowerCase() === b.toLowerCase());
    const groups = [];
    for (const job of sortedJobs || []) {
      const company = String(job?.company_name || '').trim();
      const group = company ? groups.find((g) => g.company && same(g.company, company)) : null;
      if (group) group.jobs.push(job);
      else groups.push({ company, jobs: [job] });
    }
    const position = new Map();
    let companiesWithSeveral = 0;
    for (const group of groups) {
      if (group.jobs.length > 1) companiesWithSeveral += 1;
      // group: 1, 2, 3… for companies with several jobs; 0 for a company with one.
      const number = group.jobs.length > 1 ? companiesWithSeveral : 0;
      group.jobs.forEach((job, i) =>
        position.set(job, { index: i + 1, count: group.jobs.length, group: number })
      );
    }
    const jobs = groups.flatMap((group) => group.jobs);
    return { jobs, position, extraJobs: jobs.length - groups.length, companiesWithSeveral };
  }

  function dedupeBidJobs(jobs) {
    const seen = new Set();
    const out = [];
    for (const job of jobs) {
      const url = String(job?.apply_url || '')
        .trim()
        .toLowerCase();
      const base =
        url ||
        `${String(job?.company_name || '').toLowerCase()}::${String(job?.title || '').toLowerCase()}`;
      // Only a repeat from the same source is dropped here. The same job from the
      // other source is kept for dedupeJobs, which merges the two (earlier date,
      // HiringCafe's countries) instead of throwing one away.
      const origin = String(job?.origin || job?.source || '').toLowerCase();
      const key = base ? `${origin}|${base}` : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(job);
    }
    return out;
  }

  /** The choices in the sheet's Status column. */
  const SHEET_STATUSES = ['Applied', 'Blocked'];

  /** Excel keeps at most this many characters of a hyperlink's address. */
  const SHEET_LINK_MAX = 255;
  /** Query parameters that only track where a click came from. */
  const TRACKING_PARAM_RE = /^(utm_.*|gh_src|lever-(source|origin)|iis|iisn|ref|referrer)$/i;

  /**
   * The link as scraped; only one too long for an Excel hyperlink loses its
   * tracking parameters (the job's own parameters always stay).
   */
  function sheetLink(url) {
    const raw = String(url || '').trim();
    if (raw.length <= SHEET_LINK_MAX) return raw;
    try {
      const parsed = new URL(raw);
      [...parsed.searchParams.keys()].forEach((name) => {
        if (TRACKING_PARAM_RE.test(name)) parsed.searchParams.delete(name);
      });
      return parsed.toString();
    } catch (_) {
      return raw;
    }
  }

  /** Row tints for companies with several jobs; neighbouring companies alternate. */
  const SHEET_GROUP_TINTS = { GA: '#E6F0FA', GB: '#F0E8FA' };

  /** Styles for tinted rows: plain, company (bold), link, number; F adds a line above. */
  function groupSheetStyles() {
    const out = [];
    for (const [tint, color] of Object.entries(SHEET_GROUP_TINTS)) {
      for (const first of [false, true]) {
        const id = `${tint}${first ? 'F' : ''}`;
        const fill = `<Interior ss:Color="${color}" ss:Pattern="Solid"/>`;
        const line = first
          ? '<Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#7A94B8"/></Borders>'
          : '';
        const style = (suffix, inner) => `  <Style ss:ID="${id}${suffix}">${inner}${fill}${line}</Style>`;
        out.push(
          style('', '<Alignment ss:Vertical="Center"/>'),
          style('Co', '<Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>'),
          style('Link', '<Font ss:FontName="Calibri" ss:Size="11" ss:Color="#0563C1" ss:Underline="Single"/>'),
          style('Num', '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/>')
        );
      }
    }
    return out.join('\n');
  }

  /**
   * The scrape result as an Excel sheet: links on the left, and on the right a
   * Status dropdown to mark each job
   * Applied or Blocked while bidding (the row turns green or grey), clickable
   * links, a frozen header with filters, and each company with several jobs
   * marked (tinted rows, "1 of 3" on the company name) and kept together.
   */
  function jobsToBidExcelXml(jobs, { includeOrigin = false } = {}) {
    // Open the link at the left, read across, mark the outcome at the right.
    const columns = [
      { header: 'Application Link', width: 240 },
      { header: 'Job Title', width: 220 },
      { header: 'Company', width: 140 },
      { header: 'Job Type', width: 90 },
      ...(state.mode === 'intl' ? [{ header: 'Open To', width: 110 }] : []),
      // A real number, so the sheet can sort and filter on it.
      { header: 'Score', width: 55 },
      { header: 'Applicants', width: 75 },
      { header: 'Age', width: 60 },
      { header: 'Date Posted', width: 110 },
      { header: 'Source Platform', width: 115 },
      ...(includeOrigin ? [{ header: 'Origin', width: 90 }] : []),
      { header: 'New', width: 45 },
      { header: 'Status', width: 80 },
    ];
    const byScore = sortBidJobs(jobs);
    // Companies compared the same way as the list's grouping and the Bid tab's
    // duplicate-company check. With grouping on, each company's jobs sit side
    // by side, best first, so you choose which to bid on.
    const grouping = groupJobsByCompany(byScore);
    const adjacent = Boolean(state.prefs.onePerCompany);
    const sorted = adjacent ? grouping.jobs : byScore;
    const exportedAt = Date.now();
    const typical = typicalApplicantsByAge(state.rawJobs, exportedAt);
    const ageOf = (job) => {
      const posted = jobPostedTimes(job, exportedAt);
      if (!posted) return '';
      const age = formatAgeMinutes(Math.round((exportedAt - posted.ms) / 60000));
      // "~" marks a job the source dated by day only.
      return posted.approximate ? `~${age}` : age;
    };

    // `group` is '' for a company with one job, else its tint (GA / GB), with
    // F for the group's first row (a line above it when the rows are together).
    const styleAttr = (id) => (id ? ` ss:StyleID="${id}"` : '');
    const cellXml = (value, group = '') => {
      if (value && typeof value === 'object') {
        if (value.status) return `<Cell${styleAttr(group.endsWith('F') ? 'StatusTop' : 'Status')}/>`;
        if ('link' in value) {
          const url = sheetLink(value.link);
          if (!url) return `<Cell${styleAttr(group)}/>`;
          // Excel would cut a longer address and open a broken page: text only.
          if (url.length > SHEET_LINK_MAX) {
            return `<Cell${styleAttr(group)}><Data ss:Type="String">${escapeXml(url)}</Data></Cell>`;
          }
          return `<Cell${styleAttr(group ? `${group}Link` : 'Link')} ss:HRef="${escapeXml(url)}"><Data ss:Type="String">${escapeXml(url)}</Data></Cell>`;
        }
        if (Number.isFinite(value.number)) {
          return `<Cell${styleAttr(group ? `${group}Num` : 'Number')}><Data ss:Type="Number">${value.number}</Data></Cell>`;
        }
        if ('company' in value) {
          const note = value.note
            ? `<Comment ss:Author="JobStrike"><ss:Data xmlns="http://www.w3.org/TR/REC-html40">${escapeXml(value.note)}</ss:Data></Comment>`
            : '';
          return `<Cell${styleAttr(group ? `${group}Co` : '')}><Data ss:Type="String">${escapeXml(value.company)}</Data>${note}</Cell>`;
        }
      }
      return `<Cell${styleAttr(group)}><Data ss:Type="String">${escapeXml(value ?? '')}</Data></Cell>`;
    };

    const COMPANY_HEADER_NOTE =
      'Tinted rows: one company with several jobs (the tint alternates between companies). ' +
      'Hover a company name to see "1 of 3", then choose which of its jobs to bid on.';
    const headerCells = columns
      .map((c) => {
        const note =
          c.header === 'Company'
            ? `<Comment ss:Author="JobStrike"><ss:Data xmlns="http://www.w3.org/TR/REC-html40">${escapeXml(COMPANY_HEADER_NOTE)}</ss:Data></Comment>`
            : '';
        return `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(c.header)}</Data>${note}</Cell>`;
      })
      .join('');
    const dataRows = sorted
      .map((job) => {
        const priority = jobPriority(job, exportedAt, typical);
        const at = grouping.position.get(job);
        const several = at && at.count > 1;
        const group = several ? `${at.group % 2 ? 'GA' : 'GB'}${adjacent && at.index === 1 ? 'F' : ''}` : '';
        const values = [
          { link: job?.apply_url || '' },
          job?.title ?? '',
          {
            company: job?.company_name ?? '',
            note: several ? `${at.index} of ${at.count} jobs at this company` : '',
          },
          job?.job_type || '',
          ...(state.mode === 'intl'
            ? [
                job?.worldwide_ok
                  ? 'Worldwide'
                  : (job?.workplace_countries || []).length
                    ? job.workplace_countries.join(', ')
                    : 'Not stated',
              ]
            : []),
          { number: priority.score },
          // "~" marks a count the source did not give, taken from jobs of the same age.
          priority.estimated ? `~${priority.applicants}` : applicantsLabel(job),
          ageOf(job),
          formatBidPostedAt(job?.posted_at || job?.estimated_publish_date || ''),
          job?.application_site ?? '',
          ...(includeOrigin ? [job?.origin || ''] : []),
          isNewJob(job) ? 'new' : '',
          { status: true },
        ];
        return `<Row>${values.map((value) => cellXml(value, group)).join('')}</Row>`;
      })
      .join('\n   ');

    const colXml = columns.map((c) => `<Column ss:Width="${c.width}"/>`).join('');
    const lastRow = Math.max(sorted.length + 1, 2);
    const lastCol = columns.length;
    const statusList = SHEET_STATUSES.join(',');

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="12" ss:FontName="Calibri"/>
   <Interior ss:Color="#1B4F72" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Status">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D0D5DD"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D0D5DD"/>
   </Borders>
   <Interior ss:Color="#FFF8DC" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Link">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#0563C1" ss:Underline="Single"/>
  </Style>
  <Style ss:ID="Number">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="StatusTop">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#7A94B8"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D0D5DD"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D0D5DD"/>
   </Borders>
   <Interior ss:Color="#FFF8DC" ss:Pattern="Solid"/>
  </Style>
${groupSheetStyles()}
 </Styles>
 <Worksheet ss:Name="Jobs">
  <Names>
   <NamedRange ss:Name="_FilterDatabase" ss:RefersTo="=Jobs!R1C1:R${lastRow}C${lastCol}" ss:Hidden="1"/>
  </Names>
  <Table>
   ${colXml}
   <Row ss:Height="20" ss:StyleID="Header">${headerCells}</Row>
   ${dataRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>1</SplitHorizontal>
   <TopRowBottomPane>1</TopRowBottomPane>
   <ActivePane>2</ActivePane>
   <Panes>
    <Pane><Number>3</Number></Pane>
    <Pane><Number>2</Number><ActiveRow>1</ActiveRow><ActiveCol>0</ActiveCol></Pane>
   </Panes>
  </WorksheetOptions>
  <AutoFilter x:Range="R1C1:R${lastRow}C${lastCol}" xmlns="urn:schemas-microsoft-com:office:excel"/>
  <DataValidation xmlns="urn:schemas-microsoft-com:office:excel">
   <Range>R2C${lastCol}:R${lastRow}C${lastCol}</Range>
   <Type>List</Type>
   <Value>&quot;${statusList}&quot;</Value>
  </DataValidation>
  <ConditionalFormatting xmlns="urn:schemas-microsoft-com:office:excel">
   <Range>R2C1:R${lastRow}C${lastCol}</Range>
   <Condition>
    <Value1>RC${lastCol}=&quot;Applied&quot;</Value1>
    <Format Style='color:#1E6B3A;background:#D9F2E3'/>
   </Condition>
   <Condition>
    <Value1>RC${lastCol}=&quot;Blocked&quot;</Value1>
    <Format Style='color:#8A8F98;background:#ECEDEF;text-line-through:single'/>
   </Condition>
  </ConditionalFormatting>
 </Worksheet>
</Workbook>`;
  }

  function setStatus(text, kind) {
    if (!text) {
      setProgress({ hidden: true });
      return;
    }
    setProgress({
      text,
      kind: kind || 'info',
      indeterminate: kind === 'info' || kind === 'warn',
    });
  }

  function syncControlsFromState() {

    const profileSel = document.getElementById('jsProfileFilter');
    if (profileSel) {
      const options =
        '<option value="">Select profile…</option>' +
        state.candidates
          .map(
            (candidate) =>
              `<option value="${escapeHtml(candidate.key)}">${escapeHtml(candidate.label)}</option>`
          )
          .join('');
      const previous = profileSel.value;
      profileSel.innerHTML = options;
      const preferred = state.prefs.candidateFilter || previous;
      if (preferred && state.candidates.some((c) => c.key === preferred)) {
        profileSel.value = preferred;
      } else {
        profileSel.value = '';
        // Before the list has loaded, "not in the list" means nothing: clearing here
        // wiped the saved profile on every panel open and disabled the registered filters.
        if (
          state.candidates.length &&
          state.prefs.candidateFilter &&
          !state.candidates.some((c) => c.key === state.prefs.candidateFilter)
        ) {
          state.prefs.candidateFilter = '';
        }
      }
      profileSel.disabled = state.profileLoading;
    }

    const map = [
      ['jsFilterBlockedCompanies', 'excludeBlockedCompanies'],
      ['jsFilterBlockedAts', 'excludeBlockedAts'],
      ['jsFilterBlockedJobs', 'excludeBlockedJobs'],
      ['jsFilterRegisteredJobs', 'excludeRegisteredJobs'],
      ['jsFilterRegisteredCompanies', 'excludeRegisteredCompanies'],
      ['jsDirectLinksOnly', 'directLinksOnly'],
      ['jsHideClearance', 'hideClearanceRequired'],
      ['jsHideReposts', 'hideReposts'],
      ['jsUsOnly', 'usOnly'],
      ['jsHideDegree', 'hideAdvancedDegree'],
      ['jsHideLanguage', 'hideForeignLanguage'],
      ['jsTypeFullTime', 'showFullTime'],
      ['jsTypeContract', 'showContract'],
      ['jsTypePartTime', 'showPartTime'],
      ['jsTypeTemporary', 'showTemporary'],
      ['jsTypeInternship', 'showInternship'],
      ['jsOpenToCountry', 'openToCountryOnly'],
      ['jsOnePerCompany', 'onePerCompany'],
      ['jsUseJobright', 'useJobright'],
      ['jsUseHiringCafe', 'useHiringCafe'],
    ];
    for (const [id, key] of map) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(state.prefs[key]);
    }

    syncFreshnessSelect();
    syncModeUi();

    const hasProfile = Boolean(state.prefs.candidateFilter);
    const regJobs = document.getElementById('jsFilterRegisteredJobs');
    const regCos = document.getElementById('jsFilterRegisteredCompanies');
    if (regJobs) regJobs.disabled = !hasProfile;
    if (regCos) regCos.disabled = !hasProfile;

    const jobCount = document.getElementById('jsRegisteredJobCount');
    const coCount = document.getElementById('jsRegisteredCompanyCount');
    if (jobCount) jobCount.textContent = String(state.registeredJobs.length);
    if (coCount) coCount.textContent = String(state.registeredCompanies.length);

    renderFeedStatus();
    renderSyncStatus();

    const hint = document.getElementById('jsProfileHint');
    const filtersHint = document.getElementById('jsFiltersModalHint');
    const hintText = !state.candidates.length && !state.profileLoading
      ? 'Sign in under Settings, then open Filters → Refresh lists.'
      : !hasProfile
        ? 'Open Filters & lists to pick a profile for Resume DB hide rules.'
        : '';
    if (hint) {
      if (hintText) {
        hint.textContent = hintText;
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }
    if (filtersHint) {
      filtersHint.textContent = !state.candidates.length && !state.profileLoading
        ? 'Sign in under Settings first, then refresh to load profiles and block lists.'
        : !hasProfile
          ? 'Select a profile to hide registered jobs/companies for that profile.'
          : 'Hide lists apply on the next scrape / filter refresh.';
    }

    const refreshBtn = document.getElementById('jsRefreshProfileBtn');
    if (refreshBtn) refreshBtn.disabled = state.profileLoading;

    const resumeBtn = document.getElementById('jsResumeBtn');
    if (resumeBtn) resumeBtn.hidden = !state.pausedForChallenge;

    const scrapeBtn = document.getElementById('jsScrapeBtn');
    if (scrapeBtn) {
      const busy = state.runActive || (state.scraping && !state.pausedForChallenge);
      // Paused for a site check: Resume continues it, Stop keeps what it collected.
      scrapeBtn.disabled = busy || state.pausedForChallenge;
      scrapeBtn.classList.toggle('is-busy', busy);
      scrapeBtn.title = state.pausedForChallenge
        ? 'A scrape is paused. Click Resume to continue it, or Stop to keep what it collected.'
        : '';
    }
    if (resumeBtn) resumeBtn.disabled = state.runActive;

    const stopBtn = document.getElementById('jsStopBtn');
    if (stopBtn) {
      stopBtn.hidden = !(state.scraping || state.runActive);
      // Stop takes effect at the next safe point; show that it was heard.
      stopBtn.disabled = state.stopRequested && state.runActive;
      stopBtn.textContent = stopBtn.disabled ? 'Stopping…' : 'Stop';
    }

    renderBlockLists();
    renderResults();
    syncResultsPanelUi();
    renderMeta();
  }

  function renderFeedStatus() {
    const scraper = api();
    const hcEl = document.getElementById('jsHcFeedStatus');
    const jrEl = document.getElementById('jsJrFeedStatus');
    const jrLabel =
      scraper?.dateWindowLabel?.(resolveJrDateWindow()) || resolveJrDateWindow();
    const hcLabel =
      scraper?.dateWindowLabel?.(resolveHcDateWindow()) || resolveHcDateWindow();

    const hcSummary = state.customSearchState
      ? scraper?.summarizeSearchState?.(state.customSearchState) || 'Custom search imported'
      : state.mode === 'intl'
        ? state.prefs.candidateCountry === ANY_COUNTRY
          ? 'Remote contract · any country'
          : state.prefs.candidateCountry
            ? `Remote contract · open to ${countryName(state.prefs.candidateCountry)}`
            : 'Choose the candidate country'
        : 'Built-in default';

    // Freshness has its own control on the row, so the line says only what is searched.
    const hcOn = state.prefs.useHiringCafe !== false;
    const jrOn = state.mode !== 'intl' && state.prefs.useJobright !== false;
    if (hcEl) {
      hcEl.textContent = hcOn ? hcSummary : 'Off';
      hcEl.title = `${hcSummary} · ${hcLabel} (HiringCafe searches whole days; shorter windows are cut afterwards)`;
    }
    if (jrEl) {
      const guard = jobrightGuard();
      const used = `${guard.requests} of ${JR_DAILY_REQUESTS} requests today`;
      // Is Jobright read on the next scrape, and if not, until when. The row is
      // narrow: the request count lives in the tooltip.
      const held = jrOn && (guard.cooldownUntil > Date.now() || jobrightRequestsLeft() <= 0);
      jrEl.textContent = !jrOn
        ? state.mode === 'intl'
          ? 'Not used: US jobs only'
          : 'Off'
        : guard.cooldownUntil > Date.now()
          ? `Paused until ${clockTime(guard.cooldownUntil)}`
          : jobrightRequestsLeft() <= 0
            ? 'Daily limit reached'
            : 'Recommend feed';
      jrEl.classList.toggle('is-alert', held);
      jrEl.title =
        `Jobright freshness ${jrLabel}. Set filters on jobright.ai → Recommend, then scrape. ` +
        `${used}; Jobright is skipped for a few hours after it asks to slow down.`;
    }
    for (const [id, on] of [['jsUseJobright', jrOn], ['jsUseHiringCafe', hcOn]]) {
      document.getElementById(id)?.closest('.js-source-card')?.classList.toggle('is-off', !on);
    }
    const jrSelect = document.getElementById('jsFreshnessWindowJr');
    const hcSelect = document.getElementById('jsFreshnessWindowHc');
    if (jrSelect) jrSelect.disabled = !jrOn;
    if (hcSelect) hcSelect.disabled = !hcOn;
  }

  function ensureFreshnessSelectValue(sel, value) {
    if (!sel) return;
    if (![...sel.options].some((o) => o.value === value)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      sel.appendChild(opt);
    }
    sel.value = value;
  }

  function syncFreshnessSelect() {
    ensureFreshnessSelectValue(
      document.getElementById('jsFreshnessWindowJr'),
      resolveJrDateWindow()
    );
    ensureFreshnessSelectValue(
      document.getElementById('jsFreshnessWindowHc'),
      resolveHcDateWindow()
    );
  }

  async function openJobrightRecommend() {
    const jr = jrApi();
    const url = jr?.JOBRIGHT_RECOMMEND || 'https://jobright.ai/jobs/recommend';
    try {
      await chrome.tabs.create({ url, active: true });
    } catch (err) {
      showToast(err?.message || String(err), 'error');
    }
  }

  async function applyImportedSearch(searchState, sourceUrl) {
    state.customSearchState = searchState;
    state.customSearchSourceUrl = sourceUrl || '';

    // Freshness stays whatever the row's dropdown says: an imported URL carrying
    // "past 61 days" must not silently replace an 8-hour window.
    await persistPrefs();
    await persistCustomSearch();
    syncControlsFromState();
  }

  async function resetImportedSearch() {
    state.customSearchState = null;
    state.customSearchSourceUrl = '';
    const input = document.getElementById('jsSearchUrlInput');
    if (input) input.value = '';
    await persistCustomSearch();
    syncControlsFromState();
    showToast('Restored built-in HiringCafe search default.', 'success');
  }

  async function importSearchFromText(raw, { silent = false } = {}) {
    const scraper = api();
    if (!scraper?.parseSearchStateFromInput) {
      showToast('Search import is unavailable. Reload the extension.', 'error');
      return false;
    }
    const parsed = scraper.parseSearchStateFromInput(raw);
    if (!parsed.ok) {
      showToast(parsed.error, 'error');
      return false;
    }
    await applyImportedSearch(parsed.searchState, parsed.sourceUrl);
    if (!silent) {
      showToast(
        `Search imported. ${scraper.summarizeSearchState(parsed.searchState)}`,
        'success'
      );
    }
    return true;
  }

  async function importSearchFromActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    const url = tab?.url || '';
    if (!/hiringcafe\.com|hiring\.cafe/i.test(url)) {
      showToast('Open a hiringcafe.com search tab first, then try From tab.', 'warn');
      return;
    }
    const input = document.getElementById('jsSearchUrlInput');
    if (input) input.value = url;
    await importSearchFromText(url);
  }

  function formatSyncAge(ms) {
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    return `${hr}h ago`;
  }

  function renderSyncStatus() {
    const el = document.getElementById('jsListsSyncStatus');
    if (!el) return;
    el.classList.remove('is-syncing', 'is-ready', 'is-error', 'is-stale');

    if (state.profileLoading) {
      el.textContent = 'Syncing…';
      el.classList.add('is-syncing');
      return;
    }
    if (state.listsSyncError) {
      el.textContent = 'Sync failed';
      el.title = state.listsSyncError;
      el.classList.add('is-error');
      return;
    }
    if (!state.listsSyncedAt) {
      el.textContent = 'Not synced';
      el.title = 'Click Refresh to load website lists.';
      el.classList.add('is-stale');
      return;
    }

    const ageMs = Date.now() - state.listsSyncedAt;
    const stale = ageMs > 5 * 60 * 1000;
    el.textContent = stale
      ? `Stale · ${formatSyncAge(ageMs)}`
      : `Synced ${formatSyncAge(ageMs)}`;
    el.title = new Date(state.listsSyncedAt).toLocaleString();
    el.classList.add(stale ? 'is-stale' : 'is-ready');
  }

  function closeListEditor() {
    state.openListEditor = null;
    const editor = document.getElementById('jsListEditor');
    if (editor) editor.hidden = true;
    const input = document.getElementById('jsListEditorInput');
    if (input) input.value = '';
  }

  function openListEditor(kind) {
    if (!LIST_EDITOR_META[kind]) return;
    state.openListEditor = kind;
    const editor = document.getElementById('jsListEditor');
    const title = document.getElementById('jsListEditorTitle');
    const input = document.getElementById('jsListEditorInput');
    const meta = LIST_EDITOR_META[kind];
    if (title) title.textContent = meta.title;
    if (input) {
      input.type = meta.inputType;
      input.placeholder = meta.placeholder;
      input.value = '';
    }
    if (editor) editor.hidden = false;
    renderBlockLists();
    input?.focus();
  }

  function renderMeta() {
    const meta = document.getElementById('jsMeta');
    if (!meta) return;
    const parts = [];
    if (state.lastScrapedAt) {
      parts.push(`Last run ${new Date(state.lastScrapedAt).toLocaleString()}`);
    }
    const profileLabel = state.candidates.find((c) => c.key === state.prefs.candidateFilter)?.label;
    if (profileLabel) parts.push(profileLabel);
    if (state.customSearchState) parts.push('custom search');
    meta.textContent = parts.join(' · ') || 'Pick a source, set your search, then scrape.';
  }

  function renderBlockLists() {
    const companyCount = document.getElementById('jsBlockedCompanyCount');
    const atsCount = document.getElementById('jsBlockedAtsCount');
    const jobCount = document.getElementById('jsBlockedJobCount');
    if (companyCount) companyCount.textContent = String(state.blockedCompanies.length);
    if (atsCount) atsCount.textContent = String(state.blockedAts.length);
    if (jobCount) jobCount.textContent = String(state.blockedJobs.length);

    const editor = document.getElementById('jsListEditor');
    const listEl = document.getElementById('jsListEditorItems');
    if (!editor || !listEl) return;

    if (!state.openListEditor) {
      editor.hidden = true;
      listEl.innerHTML = '';
      return;
    }

    editor.hidden = false;
    const kind = state.openListEditor;
    let itemsHtml = '';

    if (kind === 'company') {
      itemsHtml = state.blockedCompanies
        .map((item, i) => {
          const name = blockedCompanyName(item);
          const id = blockedRecordId(item);
          return (
            `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="company" data-index="${i}" data-id="${escapeHtml(id)}">Remove</button></li>`
          );
        })
        .join('');
    } else if (kind === 'ats') {
      itemsHtml = state.blockedAts
        .map((item, i) => {
          const name = blockedAtsName(item);
          const id = blockedRecordId(item);
          return (
            `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="ats" data-index="${i}" data-id="${escapeHtml(id)}">Remove</button></li>`
          );
        })
        .join('');
    } else if (kind === 'job') {
      itemsHtml = state.blockedJobs
        .map((job, i) => {
          const ref = normalizeBlockedJob(job);
          const label = [ref.jobTitle, ref.companyName].filter(Boolean).join(' · ') || ref.jobLink;
          return (
            `<li><span title="${escapeHtml(ref.jobLink)}">${escapeHtml(label)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="job" data-index="${i}" data-id="${escapeHtml(ref.id)}">Remove</button></li>`
          );
        })
        .join('');
    }

    listEl.innerHTML =
      itemsHtml ||
      '<li class="muted" style="border:none;justify-content:flex-start">No items yet.</li>';

    document.querySelectorAll('.js-filter-row').forEach((row) => {
      const editEl = row.querySelector('[data-edit-list]');
      const kind = editEl?.dataset?.editList;
      row.classList.toggle('is-editing', Boolean(kind && kind === state.openListEditor));
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function actionJobs() {
    return state.filteredJobs;
  }

  // ───────────────────────────── Live mode ─────────────────────────────

  const LIVE_TICK_MS = 30 * 1000;
  /** Jobright: a full read at most this often (also its own 3-hour safety gap). */
  const LIVE_JR_EVERY_MS = 3 * 60 * 60 * 1000;
  /** Jobs posted longer ago than this leave the Live list. */
  const LIVE_MAX_AGE_HOURS = 48;
  const LIVE_QUEUE_SHOW = 60;
  let liveTimer = null;
  let liveQueueShowAll = false;

  function liveKey(job) {
    const url = window.SmartJobJobUrl?.canonicalJobUrl?.(job?.apply_url) || String(job?.apply_url || '').trim().toLowerCase();
    return url || `${String(job?.company_name || '').toLowerCase()}::${String(job?.title || '').toLowerCase()}`;
  }

  /** One row per source: the same job from both sources is merged later (dedupeJobs). */
  function liveRowKey(job) {
    return `${String(job?.origin || job?.source || '').toLowerCase()}|${liveKey(job)}`;
  }

  function dropAgedLiveJobs(jobs) {
    const now = Date.now();
    const seen = new Set();
    return jobs.filter((job) => {
      const key = liveRowKey(job);
      if (seen.has(key)) return false;
      seen.add(key);
      const posted = jobPostedTimes(job, now);
      return !posted || (now - posted.ms) / 3600000 <= LIVE_MAX_AGE_HOURS;
    });
  }

  async function persistLive() {
    await storageSet({
      [STORAGE.live]: { lastHcAt: state.live.lastHcAt, lastCheckAt: state.live.lastCheckAt, lastAdded: state.live.lastAdded },
    });
  }

  /** "10:00-20:30, 01:00-07:30" → [[600, 1230], [60, 450]] (minutes of the day). */
  function parseLiveHours(text) {
    const spans = [];
    for (const part of String(text || '').split(/[,;]/)) {
      const m = part.trim().match(/^(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?$/);
      if (!m) continue;
      const from = Number(m[1]) * 60 + Number(m[2] || 0);
      const to = Number(m[3]) * 60 + Number(m[4] || 0);
      if (from <= 24 * 60 && to <= 24 * 60 && from !== to) spans.push([from, to]);
    }
    return spans;
  }

  function withinLiveHours(at = new Date()) {
    const spans = parseLiveHours(state.prefs.liveHours);
    if (!spans.length) return true;
    const minute = at.getHours() * 60 + at.getMinutes();
    return spans.some(([from, to]) => (from < to ? minute >= from && minute < to : minute >= from || minute < to));
  }

  function nextLiveStartLabel() {
    const spans = parseLiveHours(state.prefs.liveHours);
    if (!spans.length) return '';
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    const ahead = spans
      .map(([from]) => ({ from, wait: (from - minute + 24 * 60) % (24 * 60) }))
      .sort((a, b) => a.wait - b.wait)[0];
    const h = Math.floor(ahead.from / 60);
    const m = ahead.from % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function liveHcEveryMs() {
    const minutes = Math.max(15, Math.min(Number(state.prefs.liveHcMinutes) || 30, 120));
    return minutes * 60 * 1000;
  }

  function setLiveStatus(text) {
    state.live.status = text;
    const el = document.getElementById('jsLiveStatus');
    if (el) el.textContent = text;
  }

  /** After a check: when, how many jobs it added, and the alerts. */
  function noteLiveCheck(added) {
    state.live.lastCheckAt = Date.now();
    state.live.lastAdded = added;
    void persistLive();
    updateLiveBadge();
    if (added > 0) notifyLiveJobs(added);
    if (added > 0) autoQueueNewJobs();
    renderLiveCard();
  }

  /** Sites Auto-bid submits on: other jobs would only be filled and left for the user. */
  const AUTO_SUBMIT_SITE_RE = /greenhouse|lever|ashby/i;

  /** Live "Queue new jobs for AutoGen automatically": the new, unopened jobs, as Queue all would. */
  function autoQueueNewJobs() {
    if (!state.prefs.liveAutoQueue || !state.prefs.liveAutoQueueProfileId) return;
    const jobs = liveNewJobs().filter(
      (job) =>
        job.apply_url &&
        !autogenStates.has(liveKey(job)) &&
        (!state.prefs.liveAutoQueueSupported || AUTO_SUBMIT_SITE_RE.test(`${job.application_site || ''} ${job.apply_url}`))
    );
    if (jobs.length) void queueJobsForAutogen(jobs, { profileId: state.prefs.liveAutoQueueProfileId });
  }

  /** For Full auto (autobid-runner.js): what Live is set to do. */
  function autoState() {
    return {
      live: Boolean(state.prefs.liveEnabled),
      autoQueue: Boolean(state.prefs.liveAutoQueue && state.prefs.liveAutoQueueProfileId),
      profileName: state.prefs.liveAutoQueueProfileName || '',
      supportedOnly: state.prefs.liveAutoQueueSupported !== false,
      status: state.live.status || '',
      challenge: Boolean(state.pausedForChallenge),
      hours: state.prefs.liveHours || '',
      lastCheckAt: state.live.lastCheckAt ? new Date(state.live.lastCheckAt).toISOString() : null,
      lastAdded: Number(state.live.lastAdded) || 0,
    };
  }

  /**
   * Full auto on: Live on, new jobs queued for `profile` (Greenhouse, Lever and
   * Ashby only), and the new jobs already in the list queued now. Off: stops
   * queuing; Live keeps checking and alerting.
   */
  async function setAutoQueue(profile) {
    state.prefs.liveAutoQueue = Boolean(profile);
    state.prefs.liveAutoQueueProfileId = profile?.id || '';
    state.prefs.liveAutoQueueProfileName = profile?.name || '';
    if (profile) {
      state.prefs.liveAutoQueueSupported = true;
      if (!state.prefs.liveEnabled) {
        await setLiveEnabled(true);
      }
    }
    await persistPrefs();
    renderLiveCard();
    if (profile) autoQueueNewJobs();
  }

  function liveNewJobs() {
    return state.filteredJobs.filter((job) => job.live_new && !job.opened_at);
  }

  function updateLiveBadge() {
    try {
      const count = state.prefs.liveEnabled ? liveNewJobs().length : 0;
      chrome.action?.setBadgeBackgroundColor?.({ color: '#3b6fd4' });
      chrome.action?.setBadgeText?.({ text: count ? String(Math.min(count, 999)) : '' });
    } catch (_) {
      /* no badge: the queue still shows them */
    }
  }

  function notifyLiveJobs(added) {
    if (!state.prefs.liveNotify || !chrome.notifications?.create) return;
    const top = liveNewJobs()[0];
    try {
      chrome.notifications.create('jobstrike-live', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: `${added} new job${added === 1 ? '' : 's'} to bid on`,
        message: top ? `Top: ${top.title || 'Job'}${top.company_name ? ` (${top.company_name})` : ''}` : 'Open JobStrike to see them.',
        priority: 1,
      });
    } catch (_) {
      /* notifications off: the badge still counts them */
    }
  }

  /** Decide whether a check is due, and run it. Called every 30 s and on demand. */
  async function liveTick({ force = false } = {}) {
    if (!state.prefs.liveEnabled) {
      renderLiveCard();
      return;
    }
    if (state.pausedForChallenge) {
      setLiveStatus('Paused: a site asked for a check. Complete it in the scrape tab, then click Resume.');
      return;
    }
    if (state.runActive || state.scraping || state.live.running) return;
    if (!withinLiveHours()) {
      setLiveStatus(`Paused outside working hours · resumes ${nextLiveStartLabel()}`);
      return;
    }
    if (state.mode === 'intl' && !state.prefs.candidateCountry && !state.customSearchState) {
      setLiveStatus("Choose the candidate's country to start.");
      return;
    }
    const now = Date.now();
    const useHc = state.prefs.useHiringCafe !== false;
    const useJr = state.mode !== 'intl' && state.prefs.useJobright !== false;
    await loadJobrightGuard();
    const guard = jobrightGuard();
    const jrDue =
      useJr &&
      !jobrightHoldReason() &&
      jobrightRequestsLeft() >= JR_FULL_READ_REQUESTS &&
      now - (guard.lastRunAt || 0) >= Math.max(LIVE_JR_EVERY_MS, JR_MIN_GAP_MS);
    const hcDue = useHc && (force || now - (state.live.lastHcAt || 0) >= liveHcEveryMs());
    if (!jrDue && !hcDue) {
      const wait = Math.max(1, Math.round((state.live.lastHcAt + liveHcEveryMs() - now) / 60000));
      setLiveStatus(useHc ? `Next check in ${wait} min` : 'Waiting for Jobright (every 3 h, while requests last)');
      return;
    }
    state.live.running = true;
    state.live.lastHcAt = useHc ? now : state.live.lastHcAt;
    await persistLive();
    setLiveStatus(jrDue ? 'Checking Jobright and HiringCafe…' : 'Checking HiringCafe…');
    try {
      await runScrape({ live: { jr: jrDue, hc: useHc } });
    } finally {
      state.live.running = false;
      renderLiveCard();
    }
  }

  function startLiveTimer() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(() => void liveTick(), LIVE_TICK_MS);
  }

  /** The Live card: switch, status, settings. */
  function renderLiveCard() {
    const on = Boolean(state.prefs.liveEnabled);
    const toggle = document.getElementById('jsLiveToggle');
    if (toggle) toggle.checked = on;
    document.getElementById('jsLiveCard')?.classList.toggle('is-on', on);
    const hoursEl = document.getElementById('jsLiveHours');
    if (hoursEl && document.activeElement !== hoursEl) hoursEl.value = state.prefs.liveHours || '';
    const every = document.getElementById('jsLiveEvery');
    if (every) every.value = String(state.prefs.liveHcMinutes || 30);
    const notify = document.getElementById('jsLiveNotify');
    if (notify) notify.checked = state.prefs.liveNotify !== false;
    const autoQueue = document.getElementById('jsLiveAutoQueue');
    if (autoQueue) autoQueue.checked = Boolean(state.prefs.liveAutoQueue);
    const autoQueueFor = document.getElementById('jsLiveAutoQueueFor');
    if (autoQueueFor) {
      autoQueueFor.textContent = state.prefs.liveAutoQueue && state.prefs.liveAutoQueueProfileName
        ? `for ${state.prefs.liveAutoQueueProfileName}`
        : '';
    }
    const supportedOnly = document.getElementById('jsLiveAutoQueueSupported');
    if (supportedOnly) supportedOnly.checked = state.prefs.liveAutoQueueSupported !== false;
    const meta = document.getElementById('jsLiveMeta');
    if (meta) {
      const last = state.live.lastCheckAt
        ? `Last check ${new Date(state.live.lastCheckAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · +${state.live.lastAdded} new`
        : 'No check yet';
      meta.textContent = on ? last : 'Checks HiringCafe every 30 min and Jobright every 3 h during your hours.';
    }
    if (!on) setLiveStatus('Off');
    else if (!state.live.status || state.live.status === 'Off') setLiveStatus('Starting…');
    else setLiveStatus(state.live.status);
  }

  async function setLiveEnabled(on) {
    state.prefs.liveEnabled = Boolean(on);
    await persistPrefs();
    renderLiveCard();
    renderResults();
    updateLiveBadge();
    if (on) {
      showToast('Live on: new jobs will be added while the panel is open.', 'success');
      setTimeout(() => void liveTick(), 1500);
    }
  }

  /** Mark a job opened (by its link), everywhere it appears. */
  async function markLiveOpened(job) {
    const key = liveKey(job);
    const at = new Date().toISOString();
    for (const item of state.rawJobs) {
      if (liveKey(item) === key) {
        item.opened_at = at;
        item.live_new = false;
      }
    }
    recomputeFiltered();
    await persistResults();
    renderResults();
    updateLiveBadge();
  }

  // ───────────────────── Queue for AutoGen (from the Live queue) ─────────────────────

  /** Per job (liveKey): { state: 'waiting' | 'reading' | 'error', error }. Not saved: a reload starts clean. */
  const autogenStates = new Map();
  const autogenRun = { running: false, stop: false, pending: [], tally: null };

  /** Failures every later job would hit too: the run stops at the first. */
  const AUTOGEN_STOP_RE = /cannot generate resumes yet|Not signed in|Choose a profile|Unauthorized|did not answer|Could not reach/i;

  function autogenButtonHtml(job) {
    const entry = autogenStates.get(liveKey(job));
    if (entry?.state === 'reading') {
      return '<button type="button" class="js-q-gen" disabled title="Reading the job page, then queuing it">Queuing…</button>';
    }
    if (entry?.state === 'waiting') {
      return '<button type="button" class="js-q-gen" disabled title="Waiting its turn">Waiting</button>';
    }
    const failed = entry?.state === 'error';
    const title = failed
      ? `Not queued: ${entry.error}. Click to try again.`
      : "Queue for AutoGen: read the job and generate its resume for the Bid tab's profile";
    return `<button type="button" class="js-q-gen${failed ? ' is-error' : ''}" data-q-action="autogen" title="${escapeHtml(title)}">${failed ? 'Retry' : 'Queue'}</button>`;
  }

  /** The job is in Resume DB now (queued or already there): it leaves the queue like a registered one. */
  function dropQueuedJob(job, resolvedLink) {
    autogenStates.delete(liveKey(job));
    for (const jobLink of new Set([job.apply_url, resolvedLink].filter(Boolean))) {
      onJobRegistered({ detail: { jobLink, jobTitle: job.title || '', company: job.company_name || '' } });
    }
  }

  /** profileId: a fixed profile (Live auto-queue); otherwise the Bid tab's, read per job. */
  async function queueJobsForAutogen(jobs, { profileId = '' } = {}) {
    const api = window.SmartJobRegisterResumeDb;
    if (!api?.queueJobLinkForAutogen) {
      showToast('The Bid tab is not loaded yet. Open it once, then try again.', 'warn');
      return;
    }
    if (!profileId && !api.getSelectedRegisterProfile?.()) {
      showToast('Choose a profile in the Bid tab first: queued jobs are generated for it.', 'warn');
      return;
    }
    for (const job of jobs) {
      const entry = autogenStates.get(liveKey(job));
      if (entry && entry.state !== 'error') continue;
      autogenStates.set(liveKey(job), { state: 'waiting' });
      autogenRun.pending.push({ job, profileId });
    }
    renderLiveQueue();
    if (autogenRun.running) return;

    autogenRun.running = true;
    autogenRun.stop = false;
    autogenRun.tally = { queued: 0, already: 0, failed: 0 };
    let stoppedBy = '';
    try {
      while (autogenRun.pending.length && !autogenRun.stop) {
        const { job, profileId: forProfile } = autogenRun.pending.shift();
        autogenStates.set(liveKey(job), { state: 'reading' });
        renderLiveQueue();
        try {
          const out = await api.queueJobLinkForAutogen({
            url: job.apply_url,
            jobTitle: job.title || '',
            company: job.company_name || '',
            profileId: forProfile,
          });
          autogenRun.tally[out.duplicateId ? 'already' : 'queued'] += 1;
          dropQueuedJob(job, out.jobLink);
        } catch (error) {
          const message = error?.message || String(error);
          autogenRun.tally.failed += 1;
          autogenStates.set(liveKey(job), { state: 'error', error: message });
          if (AUTOGEN_STOP_RE.test(message)) {
            stoppedBy = message;
            break;
          }
        }
        renderLiveQueue();
      }
    } finally {
      for (const { job } of autogenRun.pending) autogenStates.delete(liveKey(job));
      autogenRun.pending = [];
      autogenRun.running = false;
      const { queued, already, failed } = autogenRun.tally;
      const summary = [
        `${queued} queued for AutoGen`,
        already ? `${already} already in Resume DB` : '',
        failed ? `${failed} not queued (hover Retry for why)` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (stoppedBy) showToast(`Stopped: ${stoppedBy}`, 'error');
      else showToast(summary, failed && !queued ? 'warn' : 'success');
      renderLiveQueue();
    }
  }

  function liveQueueRowHtml(job, index, typical, nowMs) {
    const priority = jobPriority(job, nowMs, typical);
    const posted = jobPostedTimes(job, nowMs);
    const age = posted ? formatAgeMinutes(Math.round((nowMs - posted.ms) / 60000)) : '';
    const fresh = job.live_new && !job.opened_at;
    const meta = [job.company_name, job.application_site, age ? `${age} ago` : ''].filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <div class="js-q-row${job.opened_at ? ' is-opened' : ''}${fresh ? ' is-new' : ''}" data-q-index="${index}">
        <div class="js-q-main">
          <div class="js-q-title">${fresh ? '<span class="js-q-tag">NEW</span>' : job.opened_at ? '<span class="js-q-done" title="Opened">✓</span>' : ''}<span title="${escapeHtml(job.title || '')}">${escapeHtml(job.title || 'Untitled job')}</span></div>
          <div class="js-q-meta">${meta}</div>
        </div>
        <span class="js-q-score" title="Score: freshness and competition">${Math.round(priority.score)}</span>
        <button type="button" class="js-q-open" data-q-action="open" title="Open the job; the Bid tab loads it">Open</button>
        ${autogenButtonHtml(job)}
        <button type="button" class="js-q-skip" data-q-action="skip" title="Not for me: block this job so it never comes back" aria-label="Not for me">✕</button>
      </div>`;
  }

  /** The bidding queue, shown while Live is on. */
  function renderLiveQueue() {
    const list = document.getElementById('jsResultsList');
    if (!list || !state.prefs.liveEnabled) return;
    const nowMs = Date.now();
    const typical = typicalApplicantsByAge(state.rawJobs, nowMs);
    const all = state.filteredJobs;
    // Too old to be worth a bid (they leave the list at the next check).
    const recent = (job) => {
      const posted = jobPostedTimes(job, nowMs);
      return !posted || (nowMs - posted.ms) / 3600000 <= LIVE_MAX_AGE_HOURS;
    };
    const visible = all.filter((job) => recent(job) && !(state.prefs.liveHideOpened && job.opened_at));
    const shown = liveQueueShowAll ? visible : visible.slice(0, LIVE_QUEUE_SHOW);
    const fresh = liveNewJobs().length;
    const openedCount = all.filter((job) => job.opened_at).length;
    const profileName = window.SmartJobRegisterResumeDb?.getSelectedRegisterProfile?.()?.name || '';
    const genAll = autogenRun.running
      ? `<button type="button" class="js-q-gen-all is-running" data-q-action="autogen-stop" title="Finish the job being read, then stop">Stop (${autogenRun.pending.length + 1} left)</button>`
      : shown.length
        ? `<button type="button" class="js-q-gen-all" data-q-action="autogen-all" title="${escapeHtml(
            `Read each job shown and queue it for AutoGen${profileName ? ` for ${profileName}` : ''} (one at a time, in background tabs)`
          )}">Queue all</button>`
        : '';
    list.innerHTML = `
      <div class="js-q-head">
        <span><strong>Queue</strong> · ${visible.length} to bid${fresh ? ` · <span class="js-q-newcount">${fresh} new</span>` : ''}</span>
        <span class="js-q-tools">
          ${genAll}
          <label class="js-q-hide"><input type="checkbox" id="jsLiveHideOpened" ${state.prefs.liveHideOpened ? 'checked' : ''}> Hide opened (${openedCount})</label>
        </span>
      </div>
      ${shown.map((job) => liveQueueRowHtml(job, all.indexOf(job), typical, nowMs)).join('') || '<p class="js-q-empty">Nothing to bid on yet. New jobs appear here as they are found.</p>'}
      ${visible.length > shown.length ? `<button type="button" class="js-q-more" data-q-action="more">Show all ${visible.length}</button>` : ''}`;
    list.classList.add('is-live-queue');
    list.hidden = false;
  }

  async function onLiveQueueClick(event) {
    const btn = event.target.closest('[data-q-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-q-action');
    if (action === 'more') {
      liveQueueShowAll = true;
      renderLiveQueue();
      return;
    }
    if (action === 'autogen-stop') {
      autogenRun.stop = true;
      btn.disabled = true;
      btn.textContent = 'Stopping…';
      return;
    }
    if (action === 'autogen-all') {
      const jobs = [...document.querySelectorAll('#jsResultsList [data-q-index]')]
        .map((row) => state.filteredJobs[Number(row.getAttribute('data-q-index'))])
        .filter((job) => job?.apply_url && !job.opened_at);
      if (!jobs.length) {
        showToast('No unopened jobs with a link to queue.', 'warn');
        return;
      }
      void queueJobsForAutogen(jobs);
      return;
    }
    const row = btn.closest('[data-q-index]');
    const job = state.filteredJobs[Number(row?.getAttribute('data-q-index'))];
    if (!job) return;
    if (action === 'open') {
      if (!job.apply_url) {
        showToast('This job has no link.', 'warn');
        return;
      }
      await chrome.tabs.create({ url: job.apply_url, active: true });
      await markLiveOpened(job);
    } else if (action === 'autogen') {
      if (!job.apply_url) {
        showToast('This job has no link.', 'warn');
        return;
      }
      void queueJobsForAutogen([job]);
    } else if (action === 'skip') {
      btn.disabled = true;
      await addBlockedJob(job);
      updateLiveBadge();
    }
  }

  /** The Bid tab registered a job: it leaves the queue now, not at the next sync. */
  function onJobRegistered(event) {
    const detail = event?.detail || {};
    const jobLink = String(detail.jobLink || '').trim();
    if (!jobLink) return;
    state.registeredJobs = [
      ...state.registeredJobs,
      { jobLink, jobTitle: String(detail.jobTitle || ''), company: String(detail.company || '') },
    ];
    const company = String(detail.company || '').trim();
    if (company && !state.registeredCompanies.includes(company)) {
      state.registeredCompanies = [...state.registeredCompanies, company];
    }
    recomputeFiltered();
    void persistResults();
    renderResults();
    renderMeta();
    updateLiveBadge();
  }

  function wireLive() {
    document.getElementById('jsLiveToggle')?.addEventListener('change', (event) => void setLiveEnabled(event.target.checked));
    document.getElementById('jsLiveHours')?.addEventListener('change', async (event) => {
      const text = String(event.target.value || '').trim();
      if (text && !parseLiveHours(text).length) {
        showToast('Use the form 10:00-20:30, 01:00-07:30', 'warn');
        event.target.value = state.prefs.liveHours || '';
        return;
      }
      state.prefs.liveHours = text;
      await persistPrefs();
      void liveTick();
    });
    document.getElementById('jsLiveEvery')?.addEventListener('change', async (event) => {
      state.prefs.liveHcMinutes = Number(event.target.value) || 30;
      await persistPrefs();
      void liveTick();
    });
    document.getElementById('jsLiveNotify')?.addEventListener('change', async (event) => {
      state.prefs.liveNotify = Boolean(event.target.checked);
      await persistPrefs();
    });
    document.getElementById('jsLiveAutoQueue')?.addEventListener('change', async (event) => {
      // The profile is fixed now: Auto-bid switches the Bid tab's profile per job.
      const profile = event.target.checked
        ? window.SmartJobRegisterResumeDb?.getSelectedRegisterProfile?.()
        : null;
      if (event.target.checked && !profile) {
        event.target.checked = false;
        showToast('Choose a profile in the Bid tab first: new Live jobs are queued for it.', 'warn');
        return;
      }
      state.prefs.liveAutoQueue = Boolean(profile);
      state.prefs.liveAutoQueueProfileId = profile?.id || '';
      state.prefs.liveAutoQueueProfileName = profile?.name || '';
      await persistPrefs();
      renderLiveCard();
      if (profile) showToast(`New Live jobs will be queued for AutoGen for ${profile.name}.`, 'success');
    });
    document.getElementById('jsLiveAutoQueueSupported')?.addEventListener('change', async (event) => {
      state.prefs.liveAutoQueueSupported = Boolean(event.target.checked);
      await persistPrefs();
    });
    document.getElementById('jsLiveCheckNow')?.addEventListener('click', () => void liveTick({ force: true }));
    const list = document.getElementById('jsResultsList');
    list?.addEventListener('click', (event) => void onLiveQueueClick(event));
    list?.addEventListener('change', async (event) => {
      if (event.target?.id !== 'jsLiveHideOpened') return;
      state.prefs.liveHideOpened = Boolean(event.target.checked);
      await persistPrefs();
      renderLiveQueue();
    });
    document.addEventListener('jobstrike-registered', onJobRegistered);
    window.SmartJobLive = { autoState, setAutoQueue };
    startLiveTimer();
    renderLiveCard();
    updateLiveBadge();
    // Opening the panel catches up at once.
    if (state.prefs.liveEnabled) setTimeout(() => void liveTick(), 8000);
  }

  function renderResults() {
    const empty = document.getElementById('jsResultsEmpty');
    const emptyText = document.getElementById('jsResultsEmptyText');
    const emptyHint = document.getElementById('jsResultsEmptyHint');
    const list = document.getElementById('jsResultsList');
    const jobs = state.filteredJobs;
    const n = jobs.length;

    if (list) {
      list.innerHTML = '';
      list.hidden = true;
    }

    if (n === 0) {
      if (empty) {
        empty.hidden = false;
        empty.classList.remove('is-ready');
        if (emptyText) {
          emptyText.textContent = state.rawJobs.length
            ? '0 jobs after filters. Open Filters & lists to adjust.'
            : 'Start a scrape to load jobs';
        }
        if (emptyHint) {
          emptyHint.hidden = true;
          emptyHint.textContent = '';
        }
      }
      updateActionButtons();
      syncResultsPanelUi();
      return;
    }

    if (empty) {
      empty.hidden = true;
    }

    renderLiveQueue();
    updateActionButtons();
    syncResultsPanelUi();
  }

  function updateActionButtons() {
    const jobs = actionJobs();
    const disabled = jobs.length === 0;
    ['jsCsvBtn', 'jsLinksBtn', 'jsCopyLinksBtn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
    const clearBtn = document.getElementById('jsClearResultsBtn');
    if (clearBtn) clearBtn.disabled = state.rawJobs.length === 0 && state.filteredJobs.length === 0;

    const scope = document.getElementById('jsActionScope');
    if (scope) {
      if (state.filteredJobs.length) {
        const total = state.filteredJobs.length;
        const fresh = state.filteredJobs.filter(isNewJob).length;
        scope.textContent =
          `${total} job${total === 1 ? '' : 's'} ready` +
          (fresh && fresh !== total ? ` · ${fresh} new` : '');
      } else if (state.rawJobs.length) {
        scope.textContent = '0 jobs after filters';
      } else {
        scope.textContent = 'No results yet';
      }
    }

    const reportEl = document.getElementById('jsResultsReport');
    const copyReportBtn = document.getElementById('jsCopyReportBtn');
    if (reportEl) {
      const lines = state.rawJobs.length ? runReportLines() : [];
      reportEl.textContent = lines.join('\n');
      reportEl.hidden = lines.length === 0;
      if (copyReportBtn) copyReportBtn.hidden = lines.length === 0;
    }

    const warn = document.getElementById('jsResultsWarn');
    if (warn) {
      const notes = [...(Array.isArray(state.stats?.warnings) ? state.stats.warnings : [])];
      // A failed sync or a missing profile means nothing registered was hidden.
      if (state.listsSyncError) {
        const known =
          state.registeredJobs.length + state.registeredCompanies.length +
          state.blockedJobs.length + state.blockedCompanies.length + state.blockedAts.length;
        notes.push(
          known
            ? `Website lists did not sync (${state.listsSyncError}). The lists from the last sync were used; jobs applied to or blocked since then may be listed.`
            : `Website lists did not sync (${state.listsSyncError}) and none are saved, so jobs you applied to or blocked are not hidden.`
        );
      } else if (!state.prefs.candidateFilter) {
        notes.push('No profile selected in Filters & lists — jobs you already applied to are not hidden.');
      }
      // A hide rule that is switched off lets its jobs through without a word.
      const off = hideRulesSwitchedOff();
      if (off.length) notes.push(`Not hidden (switched off in Filters & lists): ${off.join(', ')}.`);
      warn.textContent = notes.join(' ');
      warn.hidden = notes.length === 0 || (!state.rawJobs.length && !state.filteredJobs.length);
    }

    const sub = document.getElementById('jsResultsSub');
    if (sub) {
      const bits = [];
      const scrapedMs = Date.parse(state.lastScrapedAt || '');
      if (!Number.isNaN(scrapedMs)) {
        const when = new Date(scrapedMs);
        const sameDay = when.toDateString() === new Date().toDateString();
        const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        bits.push(
          sameDay
            ? `Scraped ${time}`
            : `Scraped ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
        );
      }
      if (state.stats?.newCount != null) bits.push(`${state.stats.newCount} found`);
      if (state.stats?.removedBlockedJobs) {
        bits.push(`${state.stats.removedBlockedJobs} blocked jobs`);
      }
      if (state.stats?.removedBlockedCompanies) {
        bits.push(`${state.stats.removedBlockedCompanies} blocked cos`);
      }
      if (state.stats?.removedAts) bits.push(`${state.stats.removedAts} blocked ATS`);
      if (state.stats?.employerLinks?.found) {
        bits.push(`${state.stats.employerLinks.found} moved to employer link`);
      }
      if (state.stats?.removedAggregator) bits.push(`${state.stats.removedAggregator} easy-apply hidden`);
      if (state.stats?.removedRepost) bits.push(`${state.stats.removedRepost} reposts`);
      if (state.stats?.removedClearance) bits.push(`${state.stats.removedClearance} clearance required`);
      if (state.stats?.removedForeign) bits.push(`${state.stats.removedForeign} outside US`);
      if (state.stats?.removedDegree) bits.push(`${state.stats.removedDegree} Master's/PhD required`);
      if (state.stats?.removedLanguage) bits.push(`${state.stats.removedLanguage} other language required`);
      if (state.stats?.removedJobType) bits.push(`${state.stats.removedJobType} other job types`);
      if (state.stats?.removedNotOpen) {
        bits.push(
          state.prefs.candidateCountry === ANY_COUNTRY
            ? `${state.stats.removedNotOpen} US-only hidden`
            : `${state.stats.removedNotOpen} not open to ${countryName(state.prefs.candidateCountry)}`
        );
      }
      if (state.stats?.companiesWithSeveral) {
        bits.push(
          `${state.stats.companiesWithSeveral} compan${state.stats.companiesWithSeveral === 1 ? 'y has' : 'ies have'} several jobs (grouped)`
        );
      }
      if (state.stats?.removedRegisteredJobs) {
        bits.push(`${state.stats.removedRegisteredJobs} reg. jobs`);
      }
      if (state.stats?.removedRegisteredCompanies) {
        bits.push(`${state.stats.removedRegisteredCompanies} reg. cos`);
      }
      if (state.stats?.pagesFetched) bits.push(`${state.stats.pagesFetched} pages`);
      sub.textContent = bits.join(' · ');
      sub.hidden = bits.length === 0;
    }
  }

  async function getStoredScrapeTabId() {
    const result = await storageGet([STORAGE.scrapeTabId]);
    const id = Number(result[STORAGE.scrapeTabId]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  async function setStoredScrapeTabId(tabId) {
    if (tabId) await storageSet({ [STORAGE.scrapeTabId]: tabId });
    else await chrome.storage.local.remove(STORAGE.scrapeTabId);
  }

  function waitForTabComplete(tabId, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(`Timed out waiting for the ${sourceLabel(scrapePhaseSource())} tab to load.`));
      }, timeoutMs);

      function finish(ok, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        if (ok) resolve(value);
        else reject(value);
      }

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status === 'complete') {
          finish(true);
        }
      }

      // A closed tab will never finish loading; fail now instead of after the timeout.
      function onRemoved(removedTabId) {
        if (removedTabId !== tabId) return;
        chrome.tabs.onRemoved.removeListener(onRemoved);
        finish(false, new Error(`The ${sourceLabel(scrapePhaseSource())} tab was closed.`));
      }
      chrome.tabs.onRemoved?.addListener(onRemoved);
      setTimeout(() => chrome.tabs.onRemoved?.removeListener(onRemoved), timeoutMs + 1000);

      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          finish(false, new Error(chrome.runtime.lastError.message));
          return;
        }
        if (tab?.status === 'complete') finish(true);
      });
    });
  }

  /**
   * Wait for the tab to finish loading, but do not fail on a page that keeps
   * "loading" (ads, trackers) long after its job list is there: the reader
   * (waitUntilPageReady) checks for the list itself and reports if it is missing.
   */
  async function waitForTabLoaded(tabId, url = '') {
    try {
      await waitForTabComplete(tabId, 45000);
    } catch (err) {
      if (/was closed/i.test(err?.message || '')) throw err;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw err;
      // Still on the previous page (the new one never committed): reading it
      // would take the old page's jobs for this one.
      if (tab.pendingUrl) throw err;
      if (url) {
        try {
          const want = new URL(url);
          const have = new URL(tab.url || '');
          const samePage =
            have.hostname.replace(/^www\./, '') === want.hostname.replace(/^www\./, '') &&
            (have.searchParams.get('page') || '') === (want.searchParams.get('page') || '');
          if (!samePage) throw err;
        } catch (_) {
          throw err;
        }
      }
    }
  }

  /** The tab the scraper itself opened last (a tab it may navigate). */
  const CREATED_TAB_KEY = 'job_scraper_created_tab_v1';

  async function ensureScrapeTab(url) {
    let tabId = await getStoredScrapeTabId();
    if (tabId) {
      let tab = null;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (_) {
        tab = null;
      }
      // Tab ids are reused across browser restarts: only navigate a tab that is
      // still one of ours (a scrape page, or blank), never something the user opened.
      const href = String(tab?.url || tab?.pendingUrl || '');
      // A Jobright tab may be the user's own Recommend tab, adopted for reading
      // the feed: only one this scraper opened may be sent elsewhere.
      const createdByUs = Number((await storageGet([CREATED_TAB_KEY]))[CREATED_TAB_KEY]) === tab?.id;
      const ours =
        !href ||
        /^(about:blank|chrome:\/\/newtab)/i.test(href) ||
        /hiringcafe\.com|hiring\.cafe/i.test(href) ||
        (createdByUs && /jobright\.ai/i.test(href));
      if (tab?.id && ours) {
        await chrome.tabs.update(tab.id, { url, active: false });
        await waitForTabLoaded(tab.id, url);
        await sleep(400);
        return tab.id;
      }
      await setStoredScrapeTabId(null);
    }

    // A live check must not pull you away from the application you are filling.
    const created = await chrome.tabs.create({ url, active: !state.liveRun });
    if (!created?.id) throw new Error(`Could not open ${sourceLabel()} tab.`);
    await setStoredScrapeTabId(created.id);
    await storageSet({ [CREATED_TAB_KEY]: created.id });
    await waitForTabLoaded(created.id, url);
    await sleep(500);
    return created.id;
  }

  /** Reuse an open Jobright Recommend tab without reloading (keeps session for swan-api). */
  async function ensureJobrightApiTab(fallbackUrl) {
    const recommendUrl =
      jrApi()?.JOBRIGHT_RECOMMEND || fallbackUrl || 'https://jobright.ai/jobs/recommend';
    let tabId = await getStoredScrapeTabId();
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const href = String(tab?.url || '');
        if (
          tab?.id &&
          /jobright\.ai/i.test(href) &&
          /\/jobs\/recommend/i.test(href) &&
          !/\/_jr\/security\/challenge/i.test(href)
        ) {
          return tab.id;
        }
      } catch (_) {
        await setStoredScrapeTabId(null);
      }
    }
    // Prefer any open recommend tab in this window.
    try {
      const tabs = await chrome.tabs.query({ url: ['*://jobright.ai/jobs/recommend*'] });
      const live = tabs.find(
        (t) => t?.id && !/\/_jr\/security\/challenge/i.test(String(t.url || ''))
      );
      if (live?.id) {
        await setStoredScrapeTabId(live.id);
        return live.id;
      }
    } catch (_) {
      /* ignore */
    }
    return ensureScrapeTab(recommendUrl);
  }

  /**
   * Open/reuse Recommend, install swan capture, then force a refetch so the first
   * job payloads are not missed (page load usually finishes before capture exists).
   */
  async function prepareJobrightRecommendTab(recommendUrl) {
    const jr = jrApi();
    let reused = false;
    let tabId = null;

    try {
      const tabs = await chrome.tabs.query({ url: ['*://jobright.ai/jobs/recommend*'] });
      const live = tabs.find(
        (t) => t?.id && !/\/_jr\/security\/challenge/i.test(String(t.url || ''))
      );
      if (live?.id) {
        tabId = live.id;
        reused = true;
        await setStoredScrapeTabId(tabId);
      }
    } catch (_) {
      /* ignore */
    }

    if (!tabId) {
      tabId = await ensureScrapeTab(recommendUrl);
    }

    if (typeof jr?.installSwanCaptureInTab === 'function') {
      await runJobrightTabFn(tabId, jr.installSwanCaptureInTab, []);
    }

    // Fresh tab already fetched before capture — force another Recommend pull.
    // Reused tab also needs a pull so capture sees jobs (prior SPA loads are gone).
    let rateLimited = false;
    if (typeof jr?.forceRecommendRefetchInTab === 'function') {
      const refetch = await runJobrightTabFn(tabId, jr.forceRecommendRefetchInTab, []);
      await noteJobrightRequests(refetch?.requests ?? 1, 'openingRefetch');
      rateLimited = Boolean(refetch?.rateLimited);
      await sleep(1400);
    }

    return { tabId, reused, rateLimited };
  }

  function scrapePhaseSource() {
    if (state.combinedRun?.active && state.combinedRun.phase) {
      return state.combinedRun.phase === 'jobright' ? 'jobright' : 'hiringcafe';
    }
    const source = activeSource();
    return source === 'jobright' ? 'jobright' : 'hiringcafe';
  }

  async function extractFromTab(tabId) {
    const phase = scrapePhaseSource();
    const extractFn =
      phase === 'jobright'
        ? jrApi()?.extractPagePropsInTab
        : api()?.extractPagePropsInTab;
    if (typeof extractFn !== 'function') {
      return {
        ok: false,
        error: `${sourceLabel(phase)} scraper module failed to load.`,
      };
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractFn,
    });
    return result;
  }

  async function waitUntilPageReady(tabId, { allowPause = true } = {}) {
    const phase = scrapePhaseSource();
    const label = sourceLabel(phase);
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!state.scraping || state.stopRequested) throw new Error('Scrape stopped.');
      const extracted = await extractFromTab(tabId);
      if (extracted?.ok) return extracted;

      if (extracted?.challenge && allowPause) {
        state.pausedForChallenge = true;
        syncControlsFromState();
        setProgress({
          text: 'Browser check required',
          detail: `Complete it in the open ${label} tab, then click Resume.`,
          kind: 'warn',
          indeterminate: true,
          phase: state.combinedRun?.active ? phase : null,
        });
        showToast(`Complete the ${label} check, then click Resume.`, 'warn');
        return { paused: true };
      }

      if (extracted?.needsLogin && allowPause) {
        state.pausedForChallenge = true;
        syncControlsFromState();
        setProgress({
          text: 'Sign-in required',
          detail: `Sign in on the ${label} tab if needed, open search results, then click Resume.`,
          kind: 'warn',
          indeterminate: true,
          phase: state.combinedRun?.active ? phase : null,
        });
        showToast(`Sign in on ${label} if needed, then click Resume.`, 'warn');
        return { paused: true };
      }

      await sleep(800 + attempt * 200);
    }

    return {
      ok: false,
      error: `Could not read ${label} job data from the page.`,
    };
  }

  /**
   * Single exit for a run. Whatever was collected becomes the result set, whether
   * the run finished, was stopped, or broke part-way — so a late failure can no
   * longer throw away earlier pages. Returns false when there is nothing to keep.
   */
  async function finishRun({
    jrJobs = [],
    hcJobs = [],
    pagesFetched = 0,
    reportedTotal = null,
    outcome = 'done',
    error = '',
    warnings = [],
    report = {},
    known = 0,
  } = {}) {
    const stamp = new Date().toISOString();
    const merged = dedupeBidJobs([...jrJobs, ...hcJobs]).map((job) => ({
      ...job,
      first_seen_at: stamp,
      // Only a label: was this job in any earlier run? It is listed either way.
      is_new: !isSeenJob(job),
    }));
    state.scrapeCursor = null;
    state.combinedRun = null;
    state.pausedForChallenge = false;
    const merging = Boolean(state.prefs.liveEnabled);
    // Nothing new and nothing recognised: the sources returned nothing at all.
    if (merged.length === 0 && !known) {
      if (!state.liveRun) return false;
      // A quiet live check: the list stays as it is (but a failure is said).
      noteLiveCheck(0);
      if (error) showToast(`Live check ended early: ${error}`, 'warn');
      return true;
    }

    let employerLinks = { tried: 0, found: 0, duplicates: 0 };

    const notes = warnings.filter(Boolean);
    if (outcome === 'partial' && error) notes.unshift(`The run ended early: ${error}`);
    if (outcome === 'stopped') notes.unshift('Stopped before the run finished.');

    // The list is what this run found. Bids, blocks and companies are filtered
    // from it; having been scraped before is not a reason to leave a job out.
    // In Live mode the run adds to the list instead: opened marks and jobs from
    // earlier checks stay, and jobs older than LIVE_MAX_AGE_HOURS leave.
    let addedNow = merged;
    if (merging) {
      const have = new Set(state.rawJobs.map(liveRowKey));
      const haveJob = new Set(state.rawJobs.map(liveKey));
      // New to the list: NEW only if no source had it before.
      addedNow = merged
        .filter((job) => !have.has(liveRowKey(job)))
        .map((job) => ({ ...job, live_new: !haveJob.has(liveKey(job)) }));
      state.rawJobs = dropAgedLiveJobs([...addedNow, ...state.rawJobs]);
    } else {
      state.rawJobs = merged;
    }
    const previousReport = state.stats?.report || {};
    state.lastScrapedAt = stamp;
    state.stats = {
      pagesFetched,
      reportedTotal,
      scraped: state.rawJobs.length,
      newCount: merging ? addedNow.length : merged.length,
      knownCount: known,
      source: 'both',
      jrCount: jrJobs.length,
      hcCount: hcJobs.length,
      startedAt: new Date(state.runStartedAt || Date.now()).toISOString(),
      warnings: notes,
      // What each source actually returned — the check that a scrape was complete.
      employerLinks,
      report: {
        employerLinks,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        // A live check that skipped a source keeps that source's last report.
        jobright:
          merging && !jrJobs.length && !report?.jobright
            ? previousReport.jobright || null
            : { ...summarizeSourceAges(jrJobs), ...(report?.jobright || {}) },
        hiringcafe:
          merging && !hcJobs.length && !report?.hiringcafe
            ? previousReport.hiringcafe || null
            : { ...summarizeSourceAges(hcJobs), ...(report?.hiringcafe || {}) },
      },
    };
    state.selectedKeys = new Set();
    recomputeFiltered();
    await persistResults();
    // Only now, with the results saved, do these jobs count as seen: a run that
    // dies before this point must be able to find them again.
    markJobsSeen(merged);
    await persistSeen();

    // Easy-apply and aggregator listings: find the same job on the employer's
    // board, for the new jobs and any still pending. After the save above, so
    // closing the panel during the lookups cannot lose the run.
    if (outcome !== 'stopped') {
      employerLinks = await resolveEmployerLinks(state.rawJobs).catch(() => employerLinks);
      if (employerLinks.tried) {
        state.rawJobs = dedupeBidJobs(state.rawJobs.filter((job) => !job.duplicate_of_seen));
        state.stats.employerLinks = employerLinks;
        if (state.stats.report) state.stats.report.employerLinks = employerLinks;
        if (employerLinks.duplicates) {
          state.stats.newCount = Math.max(0, state.stats.newCount - employerLinks.duplicates);
          state.stats.knownCount = (state.stats.knownCount || 0) + employerLinks.duplicates;
        }
        markJobsSeen(state.rawJobs);
        recomputeFiltered();
        await persistResults();
        await persistSeen();
      }
    }

    if (merging) {
      const readyAdded = state.filteredJobs.filter((job) => job.live_new && !job.opened_at && addedNow.some((a) => liveKey(a) === liveKey(job))).length;
      noteLiveCheck(readyAdded);
      if (state.liveRun) {
        // A live check is quiet: the queue, badge and notification say what is new.
        if (outcome === 'partial' && error) showToast(`Live check ended early: ${error}`, 'warn');
        finishScrapeUiReveal();
        renderResults();
        renderMeta();
        return true;
      }
    }

    const ready = state.filteredJobs.length;
    const newReady = state.filteredJobs.filter(isNewJob).length;
    const removalDetail = formatFilterRemovalDetail(state.stats);
    const jobsText = `${ready} job${ready === 1 ? '' : 's'}`;
    const newText = newReady && newReady !== ready ? ` · ${newReady} new` : '';
    const head =
      outcome === 'stopped'
        ? `Stopped · ${jobsText} kept${newText}`
        : outcome === 'partial'
          ? `Ended early · ${jobsText} kept${newText}`
          : `Done · ${jobsText} ready${newText}`;
    const clean = outcome === 'done' && notes.length === 0;
    setProgress({
      text: head,
      detail:
        `JR ${jrJobs.length} + HC ${hcJobs.length} → ${merged.length} unique` +
        (known ? ` · ${known} already seen` : '') +
        (pagesFetched ? ` · ${pagesFetched} pages` : '') +
        (removalDetail ? ` · ${removalDetail}` : ''),
      kind: clean ? 'success' : 'warn',
      current: 1,
      total: 1,
      phase: 'done',
      showTrust: false,
    });
    // setProgress only reveals the results for a clean success.
    if (!clean) finishScrapeUiReveal();
    showToast(
      `${head}.` + (notes.length ? ` ${notes[0]}` : removalDetail ? ` ${removalDetail}` : ''),
      clean ? 'success' : 'warn'
    );
    return true;
  }

  /** Count and age span of one source's jobs, measured from when the run started. */
  function summarizeSourceAges(jobs) {
    const ref = state.runStartedAt || Date.now();
    const ages = [];
    let undated = 0;
    for (const job of jobs || []) {
      const posted = jobPostedTimes(job, ref);
      if (!posted) undated += 1;
      else ages.push(Math.max(0, Math.round((ref - posted.ms) / 60000)));
    }
    return {
      kept: (jobs || []).length,
      undated,
      newestMinutesAgo: ages.length ? Math.min(...ages) : null,
      oldestMinutesAgo: ages.length ? Math.max(...ages) : null,
    };
  }

  function formatAgeMinutes(minutes) {
    if (minutes == null || !Number.isFinite(minutes)) return '?';
    const m = Math.max(0, minutes);
    if (m < 60) return `${m}m`;
    if (m < 48 * 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${Math.round(m / 1440)}d`;
  }

  /** One line per source: how many, how old, and how much of the site's list was read. */
  function runReportLines() {
    const report = state.stats?.report;
    if (!report) return [];
    const line = (label, src, readText) => {
      if (!src) return '';
      if (!src.kept) return `${label}: 0 jobs${readText ? ` · ${readText}` : ''}`;
      const span =
        src.newestMinutesAgo == null
          ? 'no dates'
          : `posted ${formatAgeMinutes(src.newestMinutesAgo)} – ${formatAgeMinutes(src.oldestMinutesAgo)} ago`;
      return `${label}: ${src.kept} job${src.kept === 1 ? "" : "s"} · ${span}${readText ? ` · ${readText}` : ''}`;
    };
    const jr = report.jobright;
    const hc = report.hiringcafe;
    return [
      line(
        'Jobright',
        jr,
        jr?.rowsRead != null
          ? `read ${jr.rowsRead}${jr.siteTotal ? ` of ${jr.siteTotal}` : ''} rows` +
              (jr.alreadySeen ? ` · ${jr.alreadySeen} already seen` : '')
          : ''
      ),
      line(
        'HiringCafe',
        hc,
        hc?.pagesRead != null
          ? `read ${hc.pagesRead} page${hc.pagesRead === 1 ? '' : 's'}${hc.siteTotal ? ` · site total ${hc.siteTotal}` : ''}` +
              (hc.alreadySeen ? ` · ${hc.alreadySeen} already seen` : '')
          : ''
      ),
    ].filter(Boolean);
  }

  /** Stop pressed while the run is parked on a browser check: keep what it holds. */
  async function commitPausedRun() {
    if (state.runActive) return;
    state.runActive = true;
    syncControlsFromState();
    try {
      await settlePausedRun();
    } finally {
      state.runActive = false;
      state.stopRequested = false;
      syncControlsFromState();
    }
  }

  async function settlePausedRun() {
    const cursor = state.scrapeCursor;
    const held = state.combinedRun || {};
    const inHc = cursor?.phase === 'hiringcafe';
    const cursorJobs = Array.isArray(cursor?.jobs) ? cursor.jobs : [];
    const jrJobs = inHc
      ? state.combinedRun?.jrJobs || []
      : cursorJobs.map((job) => normalizeBidJob(job, 'Jobright'));
    const hcJobs = inHc ? cursorJobs.map((job) => normalizeBidJob(job, 'HiringCafe')) : [];
    const kept = await finishRun({
      jrJobs,
      hcJobs,
      pagesFetched: (Number(held.jrPages) || 0) + (Number(cursor?.pagesFetched) || 0),
      reportedTotal: cursor?.reportedTotal ?? null,
      outcome: 'stopped',
      known: (Number(held.jrKnown) || 0) + (Number(cursor?.knownCount) || 0) + (Number(cursor?.hcKnown) || 0),
      warnings: held.jrWarnings || [],
      report: {
        jobright: held.jrReport || null,
        ...(inHc
          ? {
              hiringcafe: {
                kept: hcJobs.length,
                pagesRead: Number(cursor?.pagesFetched) || 0,
                siteTotal: cursor?.reportedTotal ?? null,
                pages: Array.isArray(cursor?.pagesLog) ? cursor.pagesLog : [],
                stoppedWhilePaused: true,
              },
            }
          : {}),
      },
    });
    state.scraping = false;
    if (!kept) {
      setProgress({
        text: 'Scrape stopped',
        detail: 'Nothing had been collected yet.',
        kind: 'warn',
        indeterminate: true,
        showTrust: false,
      });
    }
    syncControlsFromState();
  }

  async function runHiringCafeScrape({ resume = false } = {}) {
    const scraper = api();
    if (!scraper) {
      showToast('HiringCafe scraper module failed to load. Reload the extension.', 'error');
      return;
    }

    if (state.scraping && !state.pausedForChallenge && !resume) {
      const handoff =
        state.combinedRun?.active && state.combinedRun.phase === 'hiringcafe';
      if (!handoff) return;
    }

    await loadProfileFilterContext({ silent: true });

    state.scraping = true;
    state.pausedForChallenge = false;
    if (state.combinedRun?.active) {
      state.combinedRun.phase = 'hiringcafe';
    }
    syncControlsFromState();

    const combined = Boolean(state.combinedRun?.active);
    // Jobright was read first (or tried); otherwise this is a one-source run.
    const twoStep = combined && !state.combinedRun?.jrSkipped;
    // "A page of only old jobs means we are past the window" holds for date order only.
    const runSearch = hcSearchStateForRun();
    const sortedByDate = !runSearch || String(runSearch.sortBy || '') === 'date';
    // Newest-first paging ends itself once it leaves the window, so it may read
    // on to the hard limit instead of cutting a busy window off at the usual 8.
    const maxPages = sortedByDate
      ? 20
      : Math.max(1, Math.min(Number(state.prefs.maxPages) || 8, 20));
    const delayMs = Math.max(400, Math.min(Number(state.prefs.delayMs) || 700, 3000));
    const jrPages = Number(state.combinedRun?.jrPages) || 0;
    const overallTotal = twoStep ? maxPages * 2 : maxPages;
    const overallOffset = twoStep ? maxPages : 0;
    const dateWindow = resolveHcDateWindow();

    let page = resume && state.scrapeCursor ? state.scrapeCursor.page : 0;
    let jobs = resume && state.scrapeCursor ? [...state.scrapeCursor.jobs] : [];
    let reportedTotal =
      resume && state.scrapeCursor ? state.scrapeCursor.reportedTotal : null;
    let lastHitId = resume && state.scrapeCursor ? state.scrapeCursor.lastHitId : '';
    let pagesFetched =
      resume && state.scrapeCursor ? state.scrapeCursor.pagesFetched : 0;
    let staleDatePages = 0;
    let runError = '';
    let hitPageCap = false;
    let hcDateSample = null;
    // Kept across a pause for a site check, so the report still starts at page 1.
    const hcPagesLog =
      resume && Array.isArray(state.scrapeCursor?.pagesLog) ? [...state.scrapeCursor.pagesLog] : [];
    let hcHitFields = null;
    let hcExpired = 0;
    // What HiringCafe's requirement fields actually contain, so filters can be
    // built on them from evidence: value → count, for the fields that matter.
    const HC_FIELDS_OF_INTEREST = [
      'security_clearance', 'visa_sponsorship', 'language_requirements', 'num_language_requirements',
      'bachelors_degree_requirement', 'masters_degree_requirement', 'doctorate_degree_requirement',
      'licenses_or_certifications_not_mentioned', 'role_type', 'commitment', 'seniority_level',
      'boundless_workplace_countries', 'is_workplace_worldwide_ok', 'min_industry_and_role_yoe',
      'physical_position', 'position_employer_type',
    ];
    const hcValueStats = {};
    const tallyHiringCafeHit = (hit) => {
      const data = hit?.v5_processed_job_data || {};
      const record = (field, value) => {
        const bag = (hcValueStats[field] = hcValueStats[field] || {});
        const label = (Array.isArray(value) ? value.join(', ') : String(value ?? 'null')).slice(0, 48) || '(empty)';
        if (label in bag || Object.keys(bag).length < 10) bag[label] = (bag[label] || 0) + 1;
        else bag['(other)'] = (bag['(other)'] || 0) + 1;
      };
      for (const field of HC_FIELDS_OF_INTEREST) record(field, data[field]);
      record('is_expired', hit?.is_expired);
      record('source', hit?.source);
    };
    let hcKnown = resume && state.scrapeCursor ? Number(state.scrapeCursor.hcKnown) || 0 : 0;
    let knownPages = resume && state.scrapeCursor ? Number(state.scrapeCursor.knownPages) || 0 : 0;

    try {
      for (; page < maxPages; page += 1) {
        if (!state.scraping || state.stopRequested) break;

        setProgress({
          text: twoStep
            ? `Both · Step 2 of 2 · HiringCafe · Page ${page + 1} of ${maxPages}`
            : `HiringCafe · Page ${page + 1} of ${maxPages}`,
          detail:
            `Collected ${jobs.length}${reportedTotal != null ? ` / ${reportedTotal}` : ''} so far` +
            ` · window ${dateWindow}` +
            (combined ? ` · Jobright ${state.combinedRun?.jrCount || 0} already` : ''),
          kind: 'info',
          current: overallOffset + page,
          total: overallTotal,
          phase: combined ? 'hiringcafe' : null,
        });
        const url = scraper.buildHiringCafeUrl(dateWindow, page, runSearch);
        // A page that fails ends the paging, not the run: earlier pages and the
        // Jobright jobs are still worth having.
        let extracted;
        try {
          const tabId = await ensureScrapeTab(url);
          extracted = await waitUntilPageReady(tabId);
        } catch (err) {
          if (!state.stopRequested) runError = err?.message || String(err);
          break;
        }

        if (extracted?.paused) {
          state.scrapeCursor = {
            page,
            jobs,
            reportedTotal,
            lastHitId,
            pagesFetched,
            hcKnown,
            knownPages,
            pagesLog: hcPagesLog,
            combined: combined || undefined,
            phase: combined ? 'hiringcafe' : undefined,
          };
          state.pausedForChallenge = true;
          state.scraping = true;
          syncControlsFromState();
          return;
        }

        if (!extracted?.ok) {
          runError = extracted?.error || 'HiringCafe page did not return job data.';
          break;
        }
        // No result list at all is an error page, not the end of the results.
        if (extracted.pageProps.hasHits === false) {
          runError = `HiringCafe page ${page + 1} had no result list (rate limit or site change).`;
          break;
        }

        const hits = extracted.pageProps.ssrHits || [];
        reportedTotal = extracted.pageProps.ssrTotalCount ?? reportedTotal;

        if (hits.length === 0) break;

        // Same first job as the previous page: the site ignored the page number.
        const firstHitId = scraper.extractJobFields(hits[0]).id || '';
        if (page > 0 && firstHitId && firstHitId === lastHitId) break;
        lastHitId = firstHitId || lastHitId;

        if (hcDateSample == null) {
          const dates = hits.map((hit) => hit?.v5_processed_job_data?.estimated_publish_date ?? null);
          hcDateSample = {
            first: dates[0] ?? null,
            // How many of this page's jobs carry a date with no time of day.
            dateOnly: dates.filter(
              (d) => typeof d === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(d) || /T00:00:00/.test(d))
            ).length,
            of: dates.length,
            title: hits[0]?.job_information?.title ?? null,
          };
        }
        for (const hit of hits) tallyHiringCafeHit(hit);
        const expiredOnPage = hits.filter((hit) => hit?.is_expired === true).length;
        hcExpired += expiredOnPage;
        const mapped = hits
          .map((hit) => scraper.extractJobFields(hit))
          .filter((job) => !job.is_expired);
        const part = partitionJobsByDateWindow(mapped, dateWindow);
        // Every job inside the window is taken, whether or not an earlier run had it.
        const fresh = part.inWindow;
        {
          // One line per page, so a report shows where and why the paging stopped.
          const stamps = mapped
            .map((job) => Date.parse(job.estimated_publish_date || ''))
            .filter((ms) => !Number.isNaN(ms));
          const hoursAgo = (ms) => Math.round(((Date.now() - ms) / 3600000) * 10) / 10;
          hcPagesLog.push({
            page: page + 1,
            hits: hits.length,
            inWindow: part.inWindow.length,
            older: part.outWindow.length,
            undated: part.undated.length,
            newestHoursAgo: stamps.length ? hoursAgo(Math.max(...stamps)) : null,
            oldestHoursAgo: stamps.length ? hoursAgo(Math.min(...stamps)) : null,
            lastPage: Boolean(extracted.pageProps.ssrIsLastPage),
          });
          if (!hcHitFields && hits[0]) {
            hcHitFields = {
              top: Object.keys(hits[0]).slice(0, 40),
              processed: Object.keys(hits[0].v5_processed_job_data || {}).slice(0, 80),
            };
          }
        }
        hcKnown += part.inWindow.length - fresh.length;
        for (const job of fresh) {
          jobs.push(job);
        }
        pagesFetched += 1;

        // Live check, newest-first: a page with nothing not seen before means caught up.
        if (state.liveRun && sortedByDate && part.inWindow.length > 0 &&
            !part.inWindow.some((job) => !isSeenJob(job, 'HiringCafe'))) {
          break;
        }
        // Newest-first, and two pages in a row hold nothing new: caught up with the last run.
        if (fresh.length > 0) {
          knownPages = 0;
        } else if (part.inWindow.length > 0) {
          knownPages += 1;
          if (sortedByDate && knownPages >= 2) break;
        }

        // Sorted by date: a full page of only older dated jobs → past the window.
        if (part.inWindow.length === 0 && part.outWindow.length > 0) {
          staleDatePages += 1;
          setProgress({
            text: twoStep
              ? `Both · Step 2 of 2 · HiringCafe · Page ${page + 1} of ${maxPages}`
              : `HiringCafe · Page ${page + 1} of ${maxPages}`,
            detail: sortedByDate
              ? `Page outside ${dateWindow} (${part.outWindow.length} older) · ${staleDatePages}/2 before stopping`
              : `Page outside ${dateWindow} (${part.outWindow.length} older) · search is not date-sorted, reading on`,
            kind: 'info',
            current: overallOffset + page + 1,
            total: overallTotal,
            phase: combined ? 'hiringcafe' : null,
          });
          // Two in a row: the site orders by the date it found the job, which can
          // run slightly out of step with the posting date used for the window.
          if (sortedByDate && staleDatePages >= 2) break;
        } else {
          staleDatePages = 0;
          setProgress({
            text: twoStep
              ? `Both · Step 2 of 2 · HiringCafe · Page ${page + 1} of ${maxPages}`
              : `HiringCafe · Page ${page + 1} of ${maxPages}`,
            detail:
              `+${fresh.length} new · collected ${jobs.length}` +
              (hcKnown ? ` · ${hcKnown} already seen` : '') +
              (part.outWindow.length ? ` · skipped ${part.outWindow.length} older` : '') +
              (reportedTotal != null ? ` / ${reportedTotal}` : '') +
              (combined
                ? ` · combined ${(state.combinedRun?.jrCount || 0) + jobs.length}`
                : ''),
            kind: 'info',
            current: overallOffset + page + 1,
            total: overallTotal,
            phase: combined ? 'hiringcafe' : null,
          });
        }

        if (extracted.pageProps.ssrIsLastPage) break;
        if (page < maxPages - 1) await sleep(delayMs);
        // Out of pages while they were still yielding jobs: the list is cut short.
        else if (fresh.length > 0) hitPageCap = true;
      }

      const stopped = state.stopRequested;
      const kept = await finishRun({
        jrJobs: combined ? state.combinedRun?.jrJobs || [] : [],
        hcJobs: jobs.map((job) => normalizeBidJob(job, 'HiringCafe')),
        pagesFetched: jrPages + pagesFetched,
        reportedTotal,
        outcome: stopped ? 'stopped' : runError ? 'partial' : 'done',
        error: runError,
        warnings: [
          ...(combined ? state.combinedRun?.jrWarnings || [] : []),
          hitPageCap
            ? `HiringCafe reached its ${maxPages}-page limit with jobs still inside ${dateWindow}; some are missing. Use a shorter freshness window.`
            : '',
        ],
        known: (combined ? state.combinedRun?.jrKnown || 0 : 0) + hcKnown,
        report: {
          jobright: combined ? state.combinedRun?.jrReport || null : null,
          hiringcafe: {
            alreadySeen: hcKnown,
            pagesRead: pagesFetched,
            siteTotal: reportedTotal,
            sortedByDate,
            window: dateWindow,
            dateSample: hcDateSample,
            maxPages,
            expiredSkipped: hcExpired,
            pages: hcPagesLog,
            resumedAfterPause: Boolean(resume),
            fieldValues: hcValueStats,
          },
        },
      });
      if (!kept) {
        if (!stopped) {
          throw new Error(runError || 'No jobs found from Jobright or HiringCafe.');
        }
        setProgress({
          text: 'Scrape stopped',
          detail: 'Nothing had been collected yet.',
          kind: 'warn',
          indeterminate: true,
          showTrust: false,
        });
      }
    } catch (err) {
      const message = err?.message || String(err);
      // Anything unexpected still keeps what both sources had gathered.
      const kept = await finishRun({
        jrJobs: combined ? state.combinedRun?.jrJobs || [] : [],
        hcJobs: jobs.map((job) => normalizeBidJob(job, 'HiringCafe')),
        pagesFetched: jrPages + pagesFetched,
        reportedTotal,
        outcome: 'partial',
        error: message,
        known: (combined ? state.combinedRun?.jrKnown || 0 : 0) + hcKnown,
      }).catch(() => false);
      if (!kept) {
        setProgress({
          text: 'Scrape failed',
          detail: message,
          kind: 'error',
          indeterminate: true,
          showTrust: false,
          phase: combined ? 'hiringcafe' : null,
        });
        showToast(message, 'error');
      }
      state.pausedForChallenge = false;
      state.scrapeCursor = null;
      state.combinedRun = null;
    } finally {
      if (!state.pausedForChallenge) {
        state.scraping = false;
      }
      syncControlsFromState();
    }
  }

  async function runJobrightTabFn(tabId, fn, args = []) {
    if (typeof fn !== 'function') {
      return { ok: false, error: 'Jobright helper missing.' };
    }
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: fn,
        args,
      });
      return result;
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function fetchJobrightApiPage(tabId, position, count, sortCondition) {
    const jr = jrApi();
    const errors = [];
    const sort = sortCondition || undefined;

    const viaExtension = async () => {
      const ext = await jr.fetchRecommendApiPageExtension(position, count, sort);
      await noteJobrightRequests(ext?.requests ?? 1, 'feedFromExtension');
      return ext;
    };
    let extensionTried = false;
    if (jobrightPreferExtension && typeof jr?.fetchRecommendApiPageExtension === 'function') {
      extensionTried = true;
      try {
        const ext = await viaExtension();
        if (ext?.ok && ext.rows?.length) return ext;
        if (ext?.rateLimited) return { ok: false, rows: [], total: null, rateLimited: true };
        if (ext?.error) errors.push(`ext: ${ext.error}`);
      } catch (err) {
        errors.push(`ext: ${err?.message || String(err)}`);
      }
    }

    // Prefer in-tab fetch so UI "Most Recent" session applies.
    let tabFailed = false;
    if (typeof jr?.fetchRecommendApiPageInTab === 'function') {
      const tabResult = await runJobrightTabFn(tabId, jr.fetchRecommendApiPageInTab, [
        position,
        count,
        sort || '',
      ]);
      await noteJobrightRequests(tabResult?.requests ?? 1, 'feedInTab');
      if (tabResult?.ok && tabResult.rows?.length) return tabResult;
      // Neither answer is a failure to work around by other routes.
      if (tabResult?.rateLimited || tabResult?.empty) {
        return {
          ok: false,
          rows: [],
          total: null,
          rateLimited: Boolean(tabResult.rateLimited),
          empty: Boolean(tabResult.empty),
        };
      }
      if (tabResult?.error) errors.push(`tab: ${tabResult.error}`);
      tabFailed = true;
    }

    if (!extensionTried && typeof jr?.fetchRecommendApiPageExtension === 'function') {
      try {
        const ext = await viaExtension();
        if (ext?.ok && ext.rows?.length) {
          if (tabFailed) jobrightPreferExtension = true;
          return ext;
        }
        if (ext?.rateLimited) return { ok: false, rows: [], total: null, rateLimited: true };
        if (ext?.error) errors.push(`ext: ${ext.error}`);
      } catch (err) {
        errors.push(`ext: ${err?.message || String(err)}`);
      }
    }

    if (typeof jr?.installSwanCaptureInTab === 'function') {
      await runJobrightTabFn(tabId, jr.installSwanCaptureInTab, []);
    }
    if (typeof jr?.harvestMoreJobsInTab === 'function') {
      const harvested = await runJobrightTabFn(tabId, jr.harvestMoreJobsInTab, [3]);
      await noteJobrightRequests(1, 'scroll');
      // Scrolled rows say nothing about the API offset; mark them so paging ignores them.
      if (harvested?.ok && harvested.rows?.length) return { ...harvested, viaScroll: true };
      if (harvested?.error) errors.push(`scroll: ${harvested.error}`);
    }

    return {
      ok: false,
      rows: [],
      total: null,
      error:
        errors.filter(Boolean).slice(0, 3).join(' | ') ||
        'Could not load Recommend jobs. Sign in on jobright.ai and keep Recommend open.',
    };
  }

  /** Challenge / login probe for Recommend (SSR job list is optional). */
  async function waitUntilJobrightRecommendReady(tabId) {
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!state.scraping || state.stopRequested) throw new Error('Scrape stopped.');
      const extracted = await extractFromTab(tabId);

      if (extracted?.challenge) {
        state.pausedForChallenge = true;
        syncControlsFromState();
        setProgress({
          text: 'Browser check required',
          detail: 'Complete it in the open Jobright tab, then click Resume.',
          kind: 'warn',
          indeterminate: true,
          phase: state.combinedRun?.active ? 'jobright' : null,
        });
        showToast('Complete the Jobright check, then click Resume.', 'warn');
        return { paused: true };
      }

      if (extracted?.rateLimited) return { rateLimited: true };

      if (extracted?.needsLogin) {
        state.pausedForChallenge = true;
        syncControlsFromState();
        setProgress({
          text: 'Sign-in required',
          detail: 'Sign in on Jobright Recommend, confirm your filters, then click Resume.',
          kind: 'warn',
          indeterminate: true,
          phase: state.combinedRun?.active ? 'jobright' : null,
        });
        showToast('Sign in on Jobright Recommend, then click Resume.', 'warn');
        return { paused: true };
      }

      // Recommend may have empty SSR — API paging still works once the page is up.
      if (extracted?.ok || extracted?.missingJobList || /jobright\.ai/i.test(extracted?.url || '')) {
        return { ok: true, extracted };
      }

      await sleep(800 + attempt * 200);
    }

    return { ok: true, extracted: null };
  }

  async function runJobrightScrape({ resume = false } = {}) {
    const jr = jrApi();
    const filters = api();
    if (!jr) {
      showToast('Jobright scraper module failed to load. Reload the extension.', 'error');
      return;
    }
    if (!filters) {
      showToast('Filter helpers failed to load. Reload the extension.', 'error');
      return;
    }

    if (state.scraping && !state.pausedForChallenge && !resume) {
      const handoff =
        state.combinedRun?.active && state.combinedRun.phase === 'jobright';
      if (!handoff) return;
    }

    await loadProfileFilterContext({ silent: true });

    state.scraping = true;
    state.pausedForChallenge = false;
    if (state.combinedRun?.active) {
      state.combinedRun.phase = 'jobright';
    }
    syncControlsFromState();

    const combined = Boolean(state.combinedRun?.active);
    const pageSize = jr.PAGE_SIZE || 20;
    // The site's own page size. Asking for more was ignored (20 rows came back)
    // and made the requests unlike anything the page itself sends.
    let apiPageSize = pageSize;
    if (!resume) {
      jobrightRequestKinds = {};
      jobrightPreferExtension = false;
    }
    const requestsBeforeRun = resume && state.scrapeCursor?.requestsBeforeRun != null
      ? Number(state.scrapeCursor.requestsBeforeRun)
      : jobrightGuard().requests;
    const hcOff = combined && state.combinedRun?.hcOff === true;
    // Set when the guard cuts the reading short: the reason, and the note for the user.
    let endReason = '';
    let limitNote = '';
    const jrFieldStats = {
      rows: 0,
      clearanceRequired: 0,
      citizenOnly: 0,
      repost: 0,
      easyApplyFlag: 0,
      companySiteLink: 0,
      applyLinkOnJobBoard: 0,
      originalUrlIsEmployer: 0,
      workModel: {},
      employmentType: {},
      country: {},
      applicantsText: [],
      // For "N+" rows: how often the numeric field is above N, with examples.
      applicantsPlusRows: 0,
      applicantsCountAbovePlus: 0,
      applicantsPairs: [],
      // Candidate markers for staffing-agency postings, overall and among the
      // rows whose apply link is a job board (where agencies cluster).
      toB: 0,
      toBOnJobBoard: 0,
      recruiterNamed: 0,
      recruiterNamedOnJobBoard: 0,
      hiddenJob: 0,
      jobBoardSample: [],
    };
    // Share of neighbouring rows that arrive newer-then-older. The stop rules
    // and the "oldest are missing" wording are only right for a sorted feed.
    let orderPairs = 0;
    let orderedPairs = 0;
    let lastRowPostedMs = null;
    const measureOrder = (mapped) => {
      for (const job of mapped || []) {
        const ms = Date.parse(job?.estimated_publish_date || '');
        if (Number.isNaN(ms)) continue;
        if (lastRowPostedMs != null) {
          orderPairs += 1;
          if (ms <= lastRowPostedMs + 60 * 1000) orderedPairs += 1;
        }
        lastRowPostedMs = ms;
      }
      // Enough rows to judge, and plainly not in time order: stop trusting it.
      if (orderPairs >= 40 && orderedPairs / orderPairs < 0.85) {
        feedSorted = false;
        maxScrollBatches = UNSORTED_BATCH_LIMIT;
      }
    };
    const bump = (bag, key) => {
      const name = String(key ?? 'none');
      bag[name] = (bag[name] || 0) + 1;
    };
    const tallyJobrightRows = (hits) => {
      for (const hit of hits || []) {
        const row = hit?.jobResult && typeof hit.jobResult === 'object' ? hit.jobResult : hit || {};
        jrFieldStats.rows += 1;
        if (row.isClearanceRequired === true) jrFieldStats.clearanceRequired += 1;
        if (row.isCitizenOnly === true) jrFieldStats.citizenOnly += 1;
        if (row.repost === true) jrFieldStats.repost += 1;
        if (row.jobtargetEasyapply === true) jrFieldStats.easyApplyFlag += 1;
        if (row.isCompanySiteLink === true) jrFieldStats.companySiteLink += 1;
        const onBoard = (link) => !link || isAggregatorLink(link);
        if (row.isToB === true) jrFieldStats.toB += 1;
        if (row.jobRecruiter) jrFieldStats.recruiterNamed += 1;
        if (row.hiddenJob === true) jrFieldStats.hiddenJob += 1;
        if (onBoard(row.applyLink)) {
          jrFieldStats.applyLinkOnJobBoard += 1;
          if (row.originalUrl && !onBoard(row.originalUrl)) jrFieldStats.originalUrlIsEmployer += 1;
          if (row.isToB === true) jrFieldStats.toBOnJobBoard += 1;
          if (row.jobRecruiter) jrFieldStats.recruiterNamedOnJobBoard += 1;
          if (jrFieldStats.jobBoardSample.length < 10) {
            const company = hit?.companyResult?.companyName || row.companyName || '';
            jrFieldStats.jobBoardSample.push(
              `${company} | toB=${row.isToB === true} | recruiter=${row.jobRecruiter ? 'yes' : 'no'} | source=${row.source || ''}`
            );
          }
        }
        bump(jrFieldStats.workModel, row.workModel);
        bump(
          jrFieldStats.employmentType,
          Array.isArray(row.employmentType) ? row.employmentType.join(', ') : row.employmentType
        );
        bump(jrFieldStats.country, row.countryCode);
        const text = String(row.applicantsDisplayText || '').trim();
        if (text && jrFieldStats.applicantsText.length < 6 && !jrFieldStats.applicantsText.includes(text)) {
          jrFieldStats.applicantsText.push(text);
        }
        const plus = text.match(/^(\d[\d,]*)\s*\+/);
        if (plus) {
          const floor = Number(plus[1].replace(/,/g, ''));
          const count = Number(row.applicantsCount);
          jrFieldStats.applicantsPlusRows += 1;
          if (Number.isFinite(count) && count > floor) jrFieldStats.applicantsCountAbovePlus += 1;
          if (jrFieldStats.applicantsPairs.length < 8) {
            jrFieldStats.applicantsPairs.push(`${row.applicantsCount} | ${text}`);
          }
        }
      }
    };
    let jrDateSample = null;
    let jrSortAttempt = null;
    // Safer caps: fewer batches, longer pauses — Jobright bans aggressive scroll.
    // Jobright serves 20 rows a request (it ignores a larger count), and a full
    // day of a busy feed is close to 300 rows. Newest-first paging stops by
    // itself once it leaves the window, so the cap only has to be high enough.
    let maxScrollBatches = 30;
    // A feed that is not newest-first cannot be cut short without losing jobs of
    // any age, so it is read on: to its end, or to 1,000 rows. Real runs held
    // about 540 rows; reading 2,000 was more than an account should ask for.
    const UNSORTED_BATCH_LIMIT = 50;
    const scrollsPerBatch = 2;
    // 4–7 s between requests, and a longer rest every tenth.
    const delayMs = 4000;
    const overallTotal = combined ? maxScrollBatches + 8 : maxScrollBatches;
    const overallOffset = 0;
    const recommendUrl = jr.JOBRIGHT_RECOMMEND || 'https://jobright.ai/jobs/recommend';
    const dateWindow = resolveJrDateWindow();

    let batch = resume && state.scrapeCursor ? state.scrapeCursor.page : 0;
    let jobs = resume && state.scrapeCursor ? [...state.scrapeCursor.jobs] : [];
    let reportedTotal =
      resume && state.scrapeCursor ? state.scrapeCursor.reportedTotal : null;
    let pagesFetched =
      resume && state.scrapeCursor ? state.scrapeCursor.pagesFetched : 0;
    // Rows read from the API so far. Paging by the number of jobs *kept* re-read
    // or skipped pages whenever a page held old or duplicate jobs.
    let rawOffset =
      resume && state.scrapeCursor ? Number(state.scrapeCursor.rawOffset) || jobs.length : 0;
    // Same key order as pushMapped, so a resumed run cannot re-add a row.
    const seenIds = new Set(
      jobs
        .map(
          (j) =>
            String(j.id || '').trim() ||
            String(j.apply_url || '').trim() ||
            `${j.company_name || ''}::${j.title || ''}`
        )
        .filter(Boolean)
    );
    let sawDated = Boolean(resume && state.scrapeCursor?.sawDated);
    let undatedKept = resume && state.scrapeCursor ? Number(state.scrapeCursor.undatedKept) || 0 : 0;
    let feedSorted = false;
    let endedOnApiError = '';
    let lastBatchAdded = 0;
    let knownCount = resume && state.scrapeCursor ? Number(state.scrapeCursor.knownCount) || 0 : 0;

    const pushMapped = (mappedList) => {
      let added = 0;
      for (const mapped of mappedList) {
        const key =
          String(mapped.id || '').trim() ||
          String(mapped.apply_url || '').trim() ||
          `${mapped.company_name || ''}::${mapped.title || ''}`;
        if (!key || seenIds.has(key)) continue;
        seenIds.add(key);
        jobs.push(mapped);
        added += 1;
      }
      return added;
    };

    /** Keep only Past N days jobs; do not auto-drop same-company roles. */
    const pushRawHitsInWindow = (hits) => {
      tallyJobrightRows(hits);
      if (!jrDateSample && hits?.[0]) {
        // How Jobright expresses the posting time, kept for the run report.
        const first = hits[0]?.jobResult && typeof hits[0].jobResult === 'object' ? hits[0].jobResult : hits[0];
        jrDateSample = {
          publishTime: first?.publishTime ?? null,
          publishTimeType: typeof first?.publishTime,
          publishTimeDesc: first?.publishTimeDesc ?? first?.posted ?? null,
          // How it was read, and what else the row offers — to verify against the site.
          readAs: jr.extractJobFields(hits[0]).estimated_publish_date || null,
          applicants:
            first?.applicantsCount ?? first?.applicantCount ?? first?.applyCount ?? first?.numApplicants ?? null,
          title: first?.jobTitle ?? first?.title ?? null,
          fields: Object.keys(first || {}).slice(0, 80),
        };
      }
      const mapped = (hits || []).map((hit) => jr.extractJobFields(hit));
      measureOrder(mapped);
      const part = partitionJobsByDateWindow(mapped, dateWindow);
      const knownBefore = knownCount;
      if (part.inWindow.length || part.outWindow.length) sawDated = true;
      let added = pushMapped(part.inWindow);
      // Rows with no date (cards read off the page) are taken only while the feed
      // has given no dates at all. Once it has, an undated row is most likely a
      // card the date filter already turned away.
      if (!sawDated && part.undated.length) {
        const kept = pushMapped(part.undated);
        undatedKept += kept;
        added += kept;
      }
      return {
        added,
        known: knownCount - knownBefore,
        inWindow: part.inWindow.length,
        outWindow: part.outWindow.length,
        undated: part.undated.length,
      };
    };

    let lastApiError = '';
    let recommendSort = resume && state.scrapeCursor?.recommendSort ? state.scrapeCursor.recommendSort : '';
    let stagnantBatches = 0;
    let staleDateBatches = 0;
    const jrProgressLabel = (batchNum) =>
      combined && !hcOff
        ? `Both · Step 1 of 2 · Jobright · Scroll ${batchNum} of ${maxScrollBatches}`
        : `Jobright · Scroll ${batchNum} of ${maxScrollBatches}`;

    const checkJobrightRateLimit = async (tabIdCheck) => {
      if (typeof jr.detectJobrightRateLimitInTab !== 'function') return false;
      const probe = await runJobrightTabFn(tabIdCheck, jr.detectJobrightRateLimitInTab, []);
      return Boolean(probe?.rateLimited);
    };

    // A pause ends this function; Resume starts it afresh. Pick the run's
    // measurements back up, or the report and the row limit forget what was learnt.
    const carried = resume ? state.scrapeCursor?.reportState : null;
    if (carried) {
      Object.assign(jrFieldStats, carried.jrFieldStats || {});
      orderPairs = Number(carried.orderPairs) || 0;
      orderedPairs = Number(carried.orderedPairs) || 0;
      jrDateSample = carried.jrDateSample || null;
      if (carried.maxScrollBatches) maxScrollBatches = carried.maxScrollBatches;
      if (carried.feedSorted === false) feedSorted = false;
    }

    try {
      let tabId = null;

      const backOffFromJobright = async () => {
        const until = await startJobrightCooldown();
        endReason = 'rate limit';
        limitNote =
          `Jobright asked to slow down after ${rawOffset} rows, so reading stopped there and Jobright is skipped until ${until}. ` +
          `Jobs inside ${dateWindow} may be missing.`;
        showToast(`Jobright asked to slow down — skipped until ${until}.`, 'warn');
      };
      // Before any rows were read there is nothing to keep: end the Jobright half.
      const backOffBeforeReading = async () => {
        await backOffFromJobright();
        const err = new Error(limitNote);
        err.jobrightLimit = true;
        throw err;
      };

      if (batch === 0) {
        setProgress({
          text: jrProgressLabel(1),
          detail: 'Opening Jobright Recommend…',
          kind: 'info',
          current: overallOffset,
          total: overallTotal,
          phase: 'jobright',
          showTrust: true,
        });

        const prepared = await prepareJobrightRecommendTab(recommendUrl);
        tabId = prepared.tabId;
        if (prepared.rateLimited) await backOffBeforeReading();
        const ready = await waitUntilJobrightRecommendReady(tabId);
        if (ready?.rateLimited) await backOffBeforeReading();

        if (ready?.paused) {
          state.scrapeCursor = {
            page: 0,
            jobs,
            reportedTotal,
            pagesFetched,
            rawOffset,
            recommendSort,
            knownCount,
            sawDated,
            undatedKept,
            apiPageSize,
            requestsBeforeRun,
            reportState: { jrFieldStats, orderPairs, orderedPairs, jrDateSample, maxScrollBatches, feedSorted },
            combined: combined || undefined,
            phase: combined ? 'jobright' : undefined,
          };
          state.pausedForChallenge = true;
          state.scraping = true;
          syncControlsFromState();
          return;
        }

        // Capture may have been wiped if a challenge redirected: reinstall it. No
        // second refetch; the first page is asked for below if the capture is empty.
        if (typeof jr.installSwanCaptureInTab === 'function') {
          await runJobrightTabFn(tabId, jr.installSwanCaptureInTab, []);
        }

        setProgress({
          text: jrProgressLabel(1),
          detail: 'Selecting Most Recent in sort dropdown…',
          kind: 'info',
          current: overallOffset,
          total: overallTotal,
          phase: 'jobright',
          showTrust: true,
        });

        let sortOk = false;
        if (typeof jr.ensureMostRecentSort === 'function') {
          const sortResult = await runJobrightTabFn(tabId, jr.ensureMostRecentSort, []);
          sortOk = Boolean(sortResult?.ok && (sortResult.clicked || sortResult.already));
          feedSorted = sortOk;
          // Kept for the run report: whether the site's sort control took the choice.
          jrSortAttempt = {
            ok: Boolean(sortResult?.ok),
            clicked: Boolean(sortResult?.clicked),
            already: Boolean(sortResult?.already),
            label: sortResult?.label || null,
            reason: sortResult?.reason || sortResult?.error || null,
          };
          // Choosing a sort makes the page load its list again.
          if (sortResult?.clicked) await noteJobrightRequests(1, 'sortClick');
          if (sortOk) {
            await sleep(sortResult.clicked ? 3200 : 1000);
            if (typeof jr.readCapturedRecommendSort === 'function') {
              const captured = await runJobrightTabFn(tabId, jr.readCapturedRecommendSort, []);
              if (captured?.sortCondition) recommendSort = captured.sortCondition;
            }
            setProgress({
              text: jrProgressLabel(1),
              detail: sortResult.already
                ? 'Most Recent already selected · loading feed…'
                : 'Dropdown set to Most Recent · loading feed…',
              kind: 'info',
              current: overallOffset,
              total: overallTotal,
              phase: 'jobright',
              showTrust: true,
            });
          } else {
            setProgress({
              text: jrProgressLabel(1),
              detail: `Sort dropdown: ${sortResult?.reason || sortResult?.error || 'not changed'} · scrolling feed…`,
              kind: 'warn',
              current: overallOffset,
              total: overallTotal,
              phase: 'jobright',
              showTrust: true,
            });
          }
        }

        // Initial jobs from page network after sort / forced refetch
        if (typeof jr.drainSwanCaptureInTab === 'function') {
          const drained = await runJobrightTabFn(tabId, jr.drainSwanCaptureInTab, []);
          if (drained?.rows?.length) {
            pushRawHitsInWindow(drained.rows);
            // The capture can hold more than one fetch of page one; count one page.
            rawOffset = Math.min(drained.rows.length, pageSize);
            if (drained.total != null) reportedTotal = drained.total;
            if (drained.sortCondition) recommendSort = drained.sortCondition;
            pagesFetched = jobs.length > 0 ? 1 : 0;
          }
        }

        // Seed from API only if capture empty
        if (jobs.length === 0 && knownCount === 0) {
          const first = await fetchJobrightApiPage(tabId, 0, pageSize, recommendSort || undefined);
          if (first.rateLimited) await backOffBeforeReading();
          if (first.sortCondition) recommendSort = first.sortCondition;
          if (first.total != null) reportedTotal = first.total;
          if (first.ok && first.rows?.length) {
            if (!first.viaScroll) rawOffset = first.rows.length;
            pushRawHitsInWindow(first.rows);
            pagesFetched = jobs.length > 0 ? 1 : 0;
          } else if (first.error) {
            lastApiError = first.error;
          }
        }

        if (jobs.length === 0 && knownCount === 0) {
          const extracted = ready?.extracted;
          const ssrHits = extracted?.pageProps?.jobList || [];
          if (ssrHits.length) {
            pushRawHitsInWindow(ssrHits);
            reportedTotal = extracted.pageProps.totalJobs ?? reportedTotal;
            pagesFetched = jobs.length > 0 ? 1 : 0;
          }
        }

        // DOM cards on the open Recommend page
        if (
          jobs.length === 0 &&
          knownCount === 0 &&
          typeof jr.extractDomRecommendJobsInTab === 'function'
        ) {
          const dom = await runJobrightTabFn(tabId, jr.extractDomRecommendJobsInTab, []);
          if (dom?.rows?.length) {
            pushRawHitsInWindow(dom.rows);
            pagesFetched = jobs.length > 0 ? 1 : 0;
          }
        }

        setProgress({
          text: jrProgressLabel(1),
          detail:
            `${jobs.length} in ${dateWindow}` +
            (sortOk ? ' (Most Recent)' : '') +
            (prepared.reused ? ' · reused tab' : '') +
            ' · scrolling for more…',
          kind: jobs.length ? 'info' : 'warn',
          current: overallOffset + 1,
          total: overallTotal,
          phase: 'jobright',
          showTrust: true,
        });

        batch = 1;
      }

      if (resume && batch > 0 && typeof jr.ensureMostRecentSort === 'function') {
        // The pause may have reloaded the tab and dropped Most Recent, which the
        // stop-at-old-jobs rule below depends on.
        const resumeTabId = await ensureJobrightApiTab(recommendUrl);
        const sortResult = await runJobrightTabFn(resumeTabId, jr.ensureMostRecentSort, []);
        feedSorted = Boolean(sortResult?.ok && (sortResult.clicked || sortResult.already));
        if (sortResult?.clicked) {
          await noteJobrightRequests(1, 'sortClick');
          await sleep(3200);
        }
      }

      // Primary: prefer API paging; gentle scroll only as backup (avoids bans).
      for (; batch < maxScrollBatches; batch += 1) {
        if (!state.scraping || state.stopRequested) break;
        if (
          reportedTotal != null &&
          reportedTotal > 0 &&
          (jobs.length >= reportedTotal || rawOffset >= reportedTotal)
        ) {
          break;
        }
        if (jobrightRequestsLeft() <= 0) {
          endReason = 'daily request limit';
          limitNote =
            `Today's Jobright limit (${JR_DAILY_REQUESTS} requests) was reached after ${rawOffset} rows, so reading stopped there. ` +
            `Jobs inside ${dateWindow} may be missing.`;
          break;
        }

        setProgress({
          text: jrProgressLabel(batch + 1),
          detail: `Loading Recommend safely… (${jobs.length} in ${dateWindow})`,
          kind: 'info',
          current: overallOffset + batch,
          total: overallTotal,
          phase: 'jobright',
          showTrust: true,
        });

        tabId = await ensureJobrightApiTab(recommendUrl);

        if (await checkJobrightRateLimit(tabId)) {
          await backOffFromJobright();
          break;
        }

        const probe = await extractFromTab(tabId);
        if (probe?.rateLimited) {
          await backOffFromJobright();
          break;
        }
        if (probe?.challenge || probe?.needsLogin) {
          state.scrapeCursor = {
            page: batch,
            jobs,
            reportedTotal,
            pagesFetched,
            rawOffset,
            recommendSort,
            knownCount,
            sawDated,
            undatedKept,
            apiPageSize,
            requestsBeforeRun,
            reportState: { jrFieldStats, orderPairs, orderedPairs, jrDateSample, maxScrollBatches, feedSorted },
            combined: combined || undefined,
            phase: combined ? 'jobright' : undefined,
          };
          state.pausedForChallenge = true;
          state.scraping = true;
          syncControlsFromState();
          setProgress({
            text: probe?.needsLogin ? 'Sign-in required' : 'Browser check required',
            detail: 'Complete it in the open Jobright tab, then click Resume.',
            kind: 'warn',
            indeterminate: true,
            phase: 'jobright',
          });
          showToast('Complete the Jobright check, then click Resume.', 'warn');
          return;
        }

        if (typeof jr.installSwanCaptureInTab === 'function') {
          await runJobrightTabFn(tabId, jr.installSwanCaptureInTab, []);
        }

        const before = jobs.length;
        let pushResult = { added: 0, inWindow: 0, outWindow: 0, undated: 0 };

        // API first — quieter than rapid scroll.
        let apiResult = await fetchJobrightApiPage(
          tabId,
          rawOffset,
          apiPageSize,
          recommendSort || undefined
        );
        if (apiPageSize > pageSize && (apiResult.viaScroll || !apiResult.ok || !apiResult.rows?.length)) {
          // The large page was not served: use the site's own size from here on.
          apiPageSize = pageSize;
          if (!apiResult.rows?.length) {
            apiResult = await fetchJobrightApiPage(tabId, rawOffset, apiPageSize, recommendSort || undefined);
          }
        }
        if (apiResult.rateLimited) {
          await backOffFromJobright();
          break;
        }
        // The feed's own address answered with no rows: that is its end.
        if (apiResult.empty && rawOffset > 0) {
          stagnantBatches = 2;
          break;
        }
        if (apiResult.total != null) reportedTotal = apiResult.total;
        if (apiResult.sortCondition) recommendSort = apiResult.sortCondition;
        let batchApiError = '';
        if (apiResult.ok && apiResult.rows?.length) {
          if (!apiResult.viaScroll) rawOffset += apiResult.rows.length;
          pushResult = pushRawHitsInWindow(apiResult.rows);
        } else if (apiResult.error) {
          lastApiError = apiResult.error;
          batchApiError = apiResult.error;
        }

        // Gentle scroll only if the API gave nothing at all. A page of jobs we
        // already have is an answer, not a failure.
        // (Scrolling makes the page send its own feed requests.)
        const apiAnswered = Boolean(apiResult?.ok && apiResult.rows?.length);
        if (pushResult.added === 0 && !pushResult.known && !apiAnswered) {
          const harvest = await runJobrightTabFn(tabId, jr.harvestMoreJobsInTab, [
            scrollsPerBatch,
          ]);
          await noteJobrightRequests(1, 'scroll');
          if (harvest?.rateLimited) {
            await backOffFromJobright();
            break;
          }
          if (harvest?.total != null) reportedTotal = harvest.total;
          if (harvest?.sortCondition) recommendSort = harvest.sortCondition;
          if (harvest?.rows?.length) {
            pushResult = pushRawHitsInWindow(harvest.rows);
          }
        }

        if (
          pushResult.added === 0 &&
          !pushResult.known &&
          jobs.length === 0 &&
          typeof jr.extractDomRecommendJobsInTab === 'function'
        ) {
          const dom = await runJobrightTabFn(tabId, jr.extractDomRecommendJobsInTab, []);
          if (dom?.rows?.length) {
            pushResult = pushRawHitsInWindow(dom.rows);
          }
        }

        if (await checkJobrightRateLimit(tabId)) {
          await backOffFromJobright();
          break;
        }

        const added = pushResult.added;
        lastBatchAdded = added;
        // Remember whether the run was still failing when it ran out of batches.
        endedOnApiError = added > 0 ? '' : batchApiError || endedOnApiError;
        if (added > 0) {
          pagesFetched += 1;
          stagnantBatches = 0;
          staleDateBatches = 0;
          setProgress({
            text: jrProgressLabel(batch + 1),
            detail:
              `+${added} in ${dateWindow} · collected ${jobs.length}` +
              (pushResult.outWindow ? ` · skipped ${pushResult.outWindow} older` : ''),
            kind: 'info',
            current: overallOffset + batch + 1,
            total: overallTotal,
            phase: 'jobright',
            showTrust: true,
          });
        } else if (pushResult.outWindow > 0) {
          staleDateBatches += 1;
          // Unsorted, old jobs here say nothing about the next page: keep reading.
          if (feedSorted) stagnantBatches += 1;
          setProgress({
            text: jrProgressLabel(batch + 1),
            detail: `Batch outside ${dateWindow} (${pushResult.outWindow} older) · ${staleDateBatches}/2`,
            kind: 'info',
            current: overallOffset + batch + 1,
            total: overallTotal,
            phase: 'jobright',
            showTrust: true,
          });
          if (feedSorted && staleDateBatches >= 2) break;
        } else if (pushResult.known && !feedSorted) {
          // Not newest-first: the same known jobs sit on top every run, so they
          // are no sign of having caught up. Keep reading.
        } else {
          stagnantBatches += 1;
          if (stagnantBatches >= 2) break;
        }

        if (jobs.length === before && stagnantBatches >= 2) break;
        if (batch < maxScrollBatches - 1) {
          await sleep(delayMs + Math.floor(Math.random() * 3000));
          if ((batch + 1) % 10 === 0) await sleep(8000 + Math.floor(Math.random() * 7000));
        }
      }

      if (jobs.length === 0 && !combined) {
        throw new Error(
          lastApiError ||
            'No Recommend jobs found. Sign in on jobright.ai, open Recommend with your Saved Filters, then scrape again.'
        );
      }

      const jrWarnings = [];
      if (endedOnApiError) jrWarnings.push(`Jobright stopped responding part-way (${endedOnApiError}).`);
      if (undatedKept) {
        jrWarnings.push(
          `Jobright gave no posting date for ${undatedKept} job${undatedKept === 1 ? '' : 's'}; the freshness window was not applied to them.`
        );
      }
      if (limitNote) jrWarnings.push(limitNote);
      const hitCap = batch >= maxScrollBatches && lastBatchAdded > 0 && !state.stopRequested;
      // The order only matters when the run stopped before the end of the feed:
      // a feed read to its last row has every job, whatever the order.
      if (!feedSorted && hitCap) {
        jrWarnings.push(
          `Jobright returned its jobs in its own order, not newest-first, and one run reads ${rawOffset} rows. Some jobs inside ${dateWindow} were not reached; narrow the filters on Jobright Recommend to see all of them.`
        );
      } else if (hitCap) {
        jrWarnings.push(
          `Jobright had more jobs inside ${dateWindow} than one run reads (${rawOffset} rows read); the oldest ones are missing. Narrow the filters on Jobright Recommend, or scrape more often.`
        );
      }
      let jrRequests = null;
      if (typeof jr.readSwanRequestLogInTab === 'function') {
        const tabForLog = await getStoredScrapeTabId();
        if (tabForLog) {
          const logged = await runJobrightTabFn(tabForLog, jr.readSwanRequestLogInTab, []);
          jrRequests = logged?.requests || null;
        }
      }

      const jrReport = {
        alreadySeen: knownCount,
        rowsRead: rawOffset,
        batches: batch,
        siteTotal: reportedTotal,
        sortedMostRecent: feedSorted,
        sortAttempt: jrSortAttempt,
        sortCondition: recommendSort || null,
        pageSize: apiPageSize,
        window: dateWindow,
        dateSample: jrDateSample,
        fieldStats: jrFieldStats,
        // 1 = strictly newest-first; near 0.5 = no time order at all.
        timeOrderedShare: orderPairs ? Math.round((orderedPairs / orderPairs) * 100) / 100 : null,
        resumedAfterPause: Boolean(resume),
        batchLimit: maxScrollBatches,
        requestsToday: jobrightGuard().requests,
        requestsThisRun: jobrightGuard().requests - requestsBeforeRun,
        requestsByKind: { ...jobrightRequestKinds },
        requestLimit: JR_DAILY_REQUESTS,
        endedBecause: state.stopRequested
          ? 'stopped'
          : endReason
            ? endReason
            : batch >= maxScrollBatches
            ? 'batch limit reached'
            : feedSorted && staleDateBatches >= 2
              ? 'passed the freshness window'
              : stagnantBatches >= 2
                ? 'no more rows'
                : 'site total reached',
        siteRequests: jrRequests,
      };

      if (combined && state.stopRequested) {
        // Stop means stop: do not carry on into HiringCafe.
        const kept = await finishRun({
          jrJobs: jobs.map((job) => normalizeBidJob(job, 'Jobright')),
          pagesFetched,
          reportedTotal,
          outcome: 'stopped',
          warnings: jrWarnings,
          report: { jobright: jrReport },
          known: knownCount,
        });
        if (!kept) {
          setProgress({
            text: 'Scrape stopped',
            detail: 'Nothing had been collected yet.',
            kind: 'warn',
            indeterminate: true,
            showTrust: false,
          });
        }
        return;
      }

      if (hcOff) {
        const kept = await finishRun({
          jrJobs: jobs.map((job) => normalizeBidJob(job, 'Jobright')),
          pagesFetched,
          reportedTotal,
          outcome: 'done',
          warnings: jrWarnings,
          report: { jobright: jrReport },
          known: knownCount,
        });
        if (!kept) {
          throw new Error(
            lastApiError ||
              'No Recommend jobs found. Sign in on jobright.ai, open Recommend with your Saved Filters, then scrape again.'
          );
        }
        return;
      }

      if (combined) {
        const jrEmpty = jobs.length === 0;
        state.combinedRun = {
          active: true,
          phase: 'hiringcafe',
          jrJobs: jobs.map((job) => normalizeBidJob(job, 'Jobright')),
          jrPages: pagesFetched,
          jrCount: jobs.length,
          jrWarnings,
          jrReport,
          jrKnown: knownCount,
        };
        state.scrapeCursor = null;
        state.pausedForChallenge = false;
        setProgress({
          text: jrEmpty
            ? 'Both · Jobright returned 0 · starting HiringCafe'
            : 'Both · Step 1 of 2 complete',
          detail: jrEmpty
            ? (lastApiError
                ? `Jobright failed (${lastApiError}). Continuing with HiringCafe…`
                : 'Jobright collected 0 jobs. Continuing with HiringCafe…')
            : `Jobright ${jobs.length} jobs. Starting HiringCafe…`,
          kind: jrEmpty ? 'warn' : 'info',
          indeterminate: true,
          phase: 'hiringcafe',
        });
        showToast(
          jrEmpty
            ? 'Jobright returned 0 jobs — continuing HiringCafe.'
            : `Jobright done (${jobs.length}). Starting HiringCafe…`,
          jrEmpty ? 'warn' : 'info'
        );
        // Keep scraping=true; HiringCafe phase continues.
        await runHiringCafeScrape({ resume: false });
        return;
      }

      const jrJobs = jobs.map((job) => normalizeBidJob(job, 'Jobright'));

      state.rawJobs = jrJobs;
      state.lastScrapedAt = new Date().toISOString();
      state.stats = {
        pagesFetched,
        reportedTotal,
        scraped: jrJobs.length,
        source: 'jobright',
        jrCount: jrJobs.length,
      };
      state.scrapeCursor = null;
      state.selectedKeys = new Set();
      recomputeFiltered();
      await persistResults();
      const removalDetail = formatFilterRemovalDetail(state.stats);
      setProgress({
        text: `Done · ${state.filteredJobs.length} jobs ready`,
        detail:
          `${jrJobs.length} scraped` +
          (pagesFetched ? ` · ${pagesFetched} scroll batches` : '') +
          (removalDetail ? ` · ${removalDetail}` : ''),
        kind: 'success',
        current: 1,
        total: 1,
        phase: 'done',
        showTrust: false,
      });
      showToast(
        `Scraped ${jrJobs.length} · ${state.filteredJobs.length} after filters.` +
          (removalDetail ? ` ${removalDetail}` : ''),
        'success'
      );
    } catch (err) {
      const message = err?.message || String(err);
      const jrJobs = jobs.map((job) => normalizeBidJob(job, 'Jobright'));

      // A Jobright failure costs the Jobright half, not the whole run.
      if (combined && !hcOff && !state.stopRequested) {
        state.combinedRun = {
          active: true,
          phase: 'hiringcafe',
          jrJobs,
          jrPages: pagesFetched,
          jrCount: jrJobs.length,
          jrWarnings: [err?.jobrightLimit ? message : `Jobright failed part-way (${message}).`],
          jrKnown: knownCount,
        };
        state.scrapeCursor = null;
        state.pausedForChallenge = false;
        if (!err?.jobrightLimit) showToast(`Jobright failed (${message}) — continuing with HiringCafe.`, 'warn');
        await runHiringCafeScrape({ resume: false });
        return;
      }

      const kept = await finishRun({
        jrJobs,
        pagesFetched,
        reportedTotal,
        outcome: state.stopRequested ? 'stopped' : 'partial',
        error: state.stopRequested ? '' : message,
      }).catch(() => false);
      if (!kept) {
        setProgress({
          text: state.stopRequested ? 'Scrape stopped' : 'Scrape failed',
          detail: state.stopRequested ? 'Nothing had been collected yet.' : message,
          kind: state.stopRequested ? 'warn' : 'error',
          indeterminate: true,
          showTrust: false,
          phase: combined ? 'jobright' : null,
        });
        if (!state.stopRequested) showToast(message, 'error');
      }
      state.pausedForChallenge = false;
      state.scrapeCursor = null;
      state.combinedRun = null;
    } finally {
      // Combined handoff to HiringCafe keeps scraping true.
      if (!state.pausedForChallenge && !(combined && state.combinedRun?.phase === 'hiringcafe')) {
        state.scraping = false;
      }
      syncControlsFromState();
    }
  }

  /** One run at a time. The flag is set before any await, so a double-click cannot start two. */
  async function runScrape({ resume = false, live = null } = {}) {
    if (state.runActive) return;
    if (resume && !state.pausedForChallenge) return;
    state.runActive = true;
    state.stopRequested = false;
    if (!resume) state.runStartedAt = Date.now();
    // A live check reads the sources Live chose, in a background tab, quietly.
    state.runSources = live ? { jr: Boolean(live.jr), hc: Boolean(live.hc) } : null;
    state.liveRun = Boolean(live);
    syncControlsFromState();
    let stoppedWhileParking = false;
    try {
      await dispatchScrape({ resume });
    } finally {
      state.runSources = null;
      state.liveRun = false;
      state.live.running = false;
      renderLiveCard();
      stoppedWhileParking = state.stopRequested && state.pausedForChallenge;
      state.runActive = false;
      state.stopRequested = false;
      syncControlsFromState();
    }
    // The user asked to stop; do not leave the run waiting for a Resume.
    if (stoppedWhileParking) {
      state.stopRequested = true;
      await commitPausedRun();
    }
  }

  async function dispatchScrape({ resume = false } = {}) {
    if (!resume && state.mode === 'intl' && !state.prefs.candidateCountry && !state.customSearchState) {
      showToast("Choose the candidate's country first (under the mode buttons).", 'warn');
      document.getElementById('jsCandidateCountry')?.focus();
      return;
    }
    if (activeSource() === 'both' || state.combinedRun?.active) {
      if (!resume || !state.combinedRun?.active) {
        // Worldwide mode: Jobright's feed is US jobs (999 of 1,000 rows in a test
        // run), so reading it only spends the US mode's daily requests.
        const useJr = state.runSources
          ? Boolean(state.runSources.jr)
          : state.mode !== 'intl' && state.prefs.useJobright !== false;
        const useHc = state.runSources ? Boolean(state.runSources.hc) : state.prefs.useHiringCafe !== false;
        if (!state.liveRun) {
          // A manual scrape counts as a check: Live's next HiringCafe read waits a full interval.
          state.live.lastHcAt = useHc ? Date.now() : state.live.lastHcAt;
          void persistLive();
        }
        if (!useJr && !useHc) {
          showToast('Both sources are switched off. Switch one on to scrape.', 'warn');
          return;
        }
        await loadJobrightGuard();
        // Cooling down or out of requests: Jobright sits this run out.
        const hold = useJr ? jobrightHoldReason() : '';
        let declined = false;
        const sinceLast = Date.now() - jobrightGuard().lastRunAt;
        const left = jobrightRequestsLeft();
        // Two reasons to ask first: a repeat read soon after the last one, or too
        // little of the day's budget left for a whole read (a partial read misses jobs).
        let question = '';
        if (useJr && !hold && jobrightGuard().lastRunAt && sinceLast < JR_MIN_GAP_MS) {
          const minutes = Math.max(1, Math.round(sinceLast / 60000));
          const ago = minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`;
          question =
            `Read Jobright again so soon?\n\nJobright was read ${ago} ago. Reading it often is what gets an account limited. ` +
            `${jobrightGuard().requests} of ${JR_DAILY_REQUESTS} requests are used today.`;
        } else if (useJr && !hold && left < JR_FULL_READ_REQUESTS) {
          question =
            `Read Jobright with ${left} request${left === 1 ? '' : 's'} left today?\n\nA full read of the feed needs about ${JR_FULL_READ_REQUESTS}. ` +
            `With fewer, the read stops part-way and the jobs it did not reach are missing from the list.`;
        }
        if (question && !state.liveRun) {
          const ask =
            typeof window.rwhConfirm === 'function'
              ? window.rwhConfirm
              : (m) => Promise.resolve(window.confirm(m));
          declined = !(await ask(question, {
            confirmLabel: 'Read Jobright',
            cancelLabel: useHc ? 'Skip Jobright' : 'Cancel',
          }));
        }
        const skipJr = !useJr || Boolean(hold) || declined;
        if (skipJr && !useHc) {
          if (hold) showToast(hold, 'warn');
          return;
        }
        state.combinedRun = {
          active: true,
          phase: skipJr ? 'hiringcafe' : 'jobright',
          jrJobs: [],
          jrPages: 0,
          jrCount: 0,
          jrSkipped: skipJr,
          jrWarnings: hold ? [hold] : [],
          hcOff: !useHc,
        };
        setProgress({
          text: 'Starting scrape…',
          detail: skipJr
            ? 'HiringCafe only'
            : useHc
              ? 'Step 1 of 2 · Jobright → HiringCafe'
              : 'Jobright only',
          kind: 'info',
          indeterminate: true,
          phase: skipJr ? 'hiringcafe' : 'jobright',
          showTrust: true,
        });
        if (skipJr) {
          if (hold) showToast(hold, 'warn');
          await runHiringCafeScrape({ resume: false });
          return;
        }
        jobrightGuard().lastRunAt = Date.now();
        await persistJobrightGuard();
      }
      if (resume && state.scrapeCursor?.phase === 'hiringcafe') {
        state.combinedRun.phase = 'hiringcafe';
        await runHiringCafeScrape({ resume: true });
        return;
      }
      if (resume && state.combinedRun.phase === 'hiringcafe' && !state.scrapeCursor) {
        await runHiringCafeScrape({ resume: false });
        return;
      }
      if (resume && state.scrapeCursor?.phase === 'jobright') {
        await runJobrightScrape({ resume: true });
        return;
      }
      await runJobrightScrape({ resume });
      return;
    }

    state.combinedRun = null;
    if (activeSource() === 'jobright') {
      await runJobrightScrape({ resume });
      return;
    }
    await runHiringCafeScrape({ resume });
  }

  async function websiteRequest(path, options = {}) {
    const config = await getAuthConfig();
    if (!config?.extensionApiKey || !config?.baseUrl) {
      throw new Error('Sign in under Settings to sync block lists with the website.');
    }
    const headers = {
      'X-Extension-Key': config.extensionApiKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  async function refreshAfterBlockChange() {
    state.listsSyncedAt = Date.now();
    state.listsSyncError = '';
    await persistBlockLists();
    recomputeFiltered();
    await persistResults();
    syncControlsFromState();
  }

  async function addBlockedCompany(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned) return;
    try {
      const data = await websiteRequest('/api/job-scraper/blocked-companies', {
        method: 'POST',
        body: JSON.stringify({ companyName: cleaned }),
      });
      applyWebsiteBlockedLists(data);
      await refreshAfterBlockChange();
      showToast('Company blocked on the website.', 'success');
    } catch (err) {
      showToast(err?.message || String(err), 'error');
    }
  }

  async function addBlockedAts(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned) return;
    try {
      const data = await websiteRequest('/api/job-scraper/blocked-ats', {
        method: 'POST',
        body: JSON.stringify({ atsName: cleaned }),
      });
      applyWebsiteBlockedLists(data);
      await refreshAfterBlockChange();
      showToast('ATS blocked on the website.', 'success');
    } catch (err) {
      showToast(err?.message || String(err), 'error');
    }
  }

  async function addBlockedJob(job) {
    const jobLink = String(job?.apply_url || job?.jobLink || '').trim();
    if (!jobLink) return;
    try {
      const data = await websiteRequest('/api/job-scraper/blocked-jobs', {
        method: 'POST',
        body: JSON.stringify({
          jobLink,
          jobTitle: job.title || job.jobTitle || '',
          companyName: job.company_name || job.companyName || '',
        }),
      });
      applyWebsiteBlockedLists(data);
      await refreshAfterBlockChange();
      showToast(
        data.alreadyBlocked ? 'Job was already blocked on the website.' : 'Job blocked on the website.',
        'success'
      );
    } catch (err) {
      showToast(err?.message || String(err), 'error');
    }
  }

  async function removeBlockedItem(kind, id) {
    const routes = {
      company: '/api/job-scraper/blocked-companies',
      ats: '/api/job-scraper/blocked-ats',
      job: '/api/job-scraper/blocked-jobs',
    };
    const path = routes[kind];
    if (!path) return;
    if (!id) {
      showToast('Refresh lists from the website, then try Remove again.', 'warn');
      return;
    }
    try {
      await websiteRequest(`${path}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (kind === 'company') {
        state.blockedCompanies = state.blockedCompanies.filter((item) => blockedRecordId(item) !== id);
      } else if (kind === 'ats') {
        state.blockedAts = state.blockedAts.filter((item) => blockedRecordId(item) !== id);
      } else {
        state.blockedJobs = state.blockedJobs.filter((item) => blockedRecordId(item) !== id);
      }
      await refreshAfterBlockChange();
      showToast('Removed on the website.', 'success');
    } catch (err) {
      showToast(err?.message || String(err), 'error');
    }
  }

  async function getAuthConfig() {
    const register = window.SmartJobRegisterResumeDb;
    if (register?.getBackendConfig) {
      return register.getBackendConfig();
    }
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['resume_db_backend_url', 'resume_db_extension_api_key', 'resume_db_api_key'],
        (result) => {
          resolve({
            baseUrl: String(result.resume_db_backend_url || '').replace(/\/+$/, ''),
            extensionApiKey: String(
              result.resume_db_extension_api_key || result.resume_db_api_key || ''
            ).trim(),
          });
        }
      );
    });
  }

  async function preferredCandidateFromRegister() {
    const select = document.getElementById('regProfileId');
    const profileId = select?.value?.trim();
    if (profileId) return `profile-${profileId}`;
    return state.prefs.candidateFilter || '';
  }

  let profileLoadSeq = 0;

  async function loadProfileFilterContext({ silent = false } = {}) {
    const seq = ++profileLoadSeq;
    state.profileLoading = true;
    state.listsSyncError = '';
    syncControlsFromState();

    try {
      const config = await getAuthConfig();
      if (!config?.extensionApiKey || !config?.baseUrl) {
        state.candidates = [];
        state.registeredJobs = [];
        state.registeredCompanies = [];
        state.listsSyncedAt = null;
        state.listsSyncError = 'Sign in under Settings to sync website lists.';
        if (!silent) {
          showToast('Sign in under Settings to load website block lists and profiles.', 'warn');
        }
        return;
      }

      if (!state.prefs.candidateFilter) {
        const preferred = await preferredCandidateFromRegister();
        if (preferred) state.prefs.candidateFilter = preferred;
      }

      const params = new URLSearchParams();
      if (state.prefs.candidateFilter) {
        params.set('candidateFilter', state.prefs.candidateFilter);
      }

      const res = await fetch(
        `${config.baseUrl}/api/job-scraper/blocked-companies?${params.toString()}`,
        {
          headers: { 'X-Extension-Key': config.extensionApiKey },
          cache: 'no-store',
          // A website that never answers must not hold a scrape (and its Jobright jobs) forever.
          signal: AbortSignal.timeout(20000),
        }
      );
      const data = await res.json().catch(() => ({}));
      // A newer request (another profile) is already on its way: do not overwrite it.
      if (seq !== profileLoadSeq) return;
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load profile filter lists.');
      }

      applyWebsiteBlockedLists(data);
      await persistBlockLists();

      state.candidates = Array.isArray(data.candidates) ? data.candidates : [];
      state.registeredCompanies = Array.isArray(data.resumeDbCompanies)
        ? data.resumeDbCompanies
        : [];
      state.registeredJobs = Array.isArray(data.registeredJobs)
        ? data.registeredJobs.map((job) => ({
            jobLink: job.jobLink || '',
            jobTitle: job.jobTitle || '',
            company: job.company || '',
          }))
        : [];

      if (
        state.prefs.candidateFilter &&
        !state.candidates.some((c) => c.key === state.prefs.candidateFilter)
      ) {
        state.prefs.candidateFilter = '';
        state.registeredCompanies = [];
        state.registeredJobs = [];
      }

      state.listsSyncedAt = Date.now();
      state.listsSyncError = '';
      await persistPrefs();
      await storageSet({
        [STORAGE.registered]: {
          profile: state.prefs.candidateFilter || '',
          jobs: state.registeredJobs,
          companies: state.registeredCompanies,
          at: state.listsSyncedAt,
        },
      });
      recomputeFiltered();
      await persistResults();
      if (!silent) {
        const bits = [
          `${state.blockedCompanies.length} companies`,
          `${state.blockedAts.length} ATS`,
          `${state.blockedJobs.length} jobs`,
        ];
        if (state.prefs.candidateFilter) {
          bits.push(`${state.registeredJobs.length} reg. jobs`);
          bits.push(`${state.registeredCompanies.length} reg. cos`);
        }
        showToast(`Website lists loaded (${bits.join(', ')}).`, 'success');
      }
    } catch (err) {
      if (seq !== profileLoadSeq) return;
      state.listsSyncError = err?.message || String(err);
      if (!silent) showToast(err?.message || String(err), 'error');
    } finally {
      if (seq === profileLoadSeq) {
        state.profileLoading = false;
        syncControlsFromState();
      }
    }
  }

  function modalEl(name) {
    if (name === 'filters') return document.getElementById('jsFiltersModal');
    if (name === 'import') return document.getElementById('jsImportModal');
    return null;
  }


  function openJsModal(name) {
    const modal = modalEl(name);
    if (!modal) return;
    modal.hidden = false;
  }

  function closeJsModal(name) {
    const modal = modalEl(name);
    if (modal) modal.hidden = true;
  }

  function closeAllJsModals() {
    closeJsModal('filters');
    closeJsModal('import');
  }

  /** Mode buttons, the candidate country, and which filter rows apply. */
  function syncModeUi() {
    const intl = state.mode === 'intl';
    document.querySelectorAll('[data-js-mode]').forEach((btn) => {
      const on = btn.getAttribute('data-js-mode') === state.mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.disabled = (state.scraping || state.runActive || state.pausedForChallenge) && !on;
    });
    const countryRow = document.getElementById('jsCountryRow');
    if (countryRow) countryRow.hidden = !intl;
    const select = document.getElementById('jsCandidateCountry');
    if (select) {
      if (select.options.length <= 1) {
        select.add(new Option('Any country (outside the US)', ANY_COUNTRY));
        const options = CANDIDATE_COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        for (const { code, name } of options) select.add(new Option(name, code));
      }
      select.value = state.prefs.candidateCountry || '';
      select.disabled = state.scraping || state.runActive;
    }
    const hint = document.getElementById('jsModeHint');
    if (hint) {
      hint.textContent = intl
        ? state.prefs.candidateCountry === ANY_COUNTRY
          ? 'Remote contract jobs open to candidates outside the US, any country. Own filters, profile and results.'
          : state.prefs.candidateCountry
            ? `Remote contract jobs open to candidates in ${countryName(state.prefs.candidateCountry)}. Own filters, profile and results.`
            : "Choose the candidate's country to search remote contract jobs open to it."
        : 'Remote jobs in the US.';
    }
    // Jobright cannot be switched on here (see dispatchScrape); its setting is kept for the US mode.
    const jrSwitch = document.getElementById('jsUseJobright');
    if (jrSwitch) {
      jrSwitch.disabled = intl;
      if (intl) jrSwitch.checked = false;
      else jrSwitch.checked = state.prefs.useJobright !== false;
      jrSwitch.closest('label')?.setAttribute(
        'title',
        intl
          ? "Jobright's Recommend feed is US jobs, so Worldwide mode does not read it (and keeps its daily requests for US mode)."
          : 'Read Jobright on the next scrape. It uses your Jobright account.'
      );
    }
    const usRow = document.getElementById('jsUsOnly')?.closest('.js-filter-row');
    if (usRow) usRow.hidden = intl;
    const openRow = document.getElementById('jsOpenToCountry')?.closest('.js-filter-row');
    if (openRow) openRow.hidden = !intl;
  }

  /** Switch scrape mode: save this one's state, load the other's. */
  async function switchMode(mode) {
    const next = mode === 'intl' ? 'intl' : 'us';
    if (next === state.mode) return;
    if (state.scraping || state.runActive || state.pausedForChallenge) {
      showToast(
        state.runActive && state.stopRequested
          ? 'The scrape is still stopping. Switch mode once it has finished.'
          : 'Stop the running scrape before switching mode.',
        'warn'
      );
      return;
    }
    await persistPrefs();
    await persistResults();
    state.mode = next;
    applyModeStorageKeys(next);
    await storageSet({ [MODE_KEY]: next });
    Object.assign(state, {
      rawJobs: [],
      filteredJobs: [],
      selectedKeys: new Set(),
      stats: null,
      lastScrapedAt: null,
      customSearchState: null,
      customSearchSourceUrl: '',
      registeredJobs: [],
      registeredCompanies: [],
      scrapeCursor: null,
      pausedForChallenge: false,
    });
    // The profile list shows this mode's profile, not the one left from the other mode.
    const profileSelect = document.getElementById('jsProfileFilter');
    if (profileSelect) profileSelect.value = '';
    await loadState();
    recomputeFiltered();
    syncControlsFromState();
    renderResults();
    renderMeta();
    renderLiveCard();
    updateLiveBadge();
    void loadProfileFilterContext({ silent: true });
    showToast(next === 'intl' ? 'Worldwide contract mode' : 'US jobs mode', 'info');
  }

  function wireUi() {
    document.querySelectorAll('[data-js-mode]').forEach((btn) => {
      btn.addEventListener('click', () => void switchMode(btn.getAttribute('data-js-mode')));
    });
    document.getElementById('jsCandidateCountry')?.addEventListener('change', async (event) => {
      state.prefs.candidateCountry = String(event.target.value || '').toUpperCase();
      await persistPrefs();
      recomputeFiltered();
      await persistResults();
      syncControlsFromState();
      renderResults();
      renderMeta();
    });
    document.querySelectorAll('[data-js-open-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openJsModal(btn.getAttribute('data-js-open-modal'));
      });
    });
    document.querySelectorAll('[data-js-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeJsModal(btn.getAttribute('data-js-close-modal'));
      });
    });
    ['jsFiltersModal', 'jsImportModal'].forEach((id) => {
      const modal = document.getElementById(id);
      if (!modal || modal.dataset.wiredBackdrop === '1') return;
      modal.dataset.wiredBackdrop = '1';
      modal.addEventListener('click', (event) => {
        if (event.target === modal) modal.hidden = true;
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAllJsModals();
    });

    document.getElementById('jsImportSearchUrlBtn')?.addEventListener('click', async () => {
      const raw = document.getElementById('jsSearchUrlInput')?.value || '';
      await importSearchFromText(raw);
    });

    document.getElementById('jsImportSearchTabBtn')?.addEventListener('click', () => {
      void importSearchFromActiveTab();
    });

    document.getElementById('jsResetSearchBtn')?.addEventListener('click', () => {
      void resetImportedSearch();
    });

    document.getElementById('jsSearchUrlInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void importSearchFromText(event.target.value || '');
      }
    });

    document.getElementById('jsEditHcSearchBtn')?.addEventListener('click', () => {
      openJsModal('import');
    });

    document.getElementById('jsOpenRecommendBtn')?.addEventListener('click', () => {
      void openJobrightRecommend();
    });

    [
      ['jsFilterBlockedCompanies', 'excludeBlockedCompanies'],
      ['jsFilterBlockedAts', 'excludeBlockedAts'],
      ['jsFilterBlockedJobs', 'excludeBlockedJobs'],
      ['jsFilterRegisteredJobs', 'excludeRegisteredJobs'],
      ['jsFilterRegisteredCompanies', 'excludeRegisteredCompanies'],
      ['jsDirectLinksOnly', 'directLinksOnly'],
      ['jsHideClearance', 'hideClearanceRequired'],
      ['jsHideReposts', 'hideReposts'],
      ['jsUsOnly', 'usOnly'],
      ['jsHideDegree', 'hideAdvancedDegree'],
      ['jsHideLanguage', 'hideForeignLanguage'],
      ['jsTypeFullTime', 'showFullTime'],
      ['jsTypeContract', 'showContract'],
      ['jsTypePartTime', 'showPartTime'],
      ['jsTypeTemporary', 'showTemporary'],
      ['jsTypeInternship', 'showInternship'],
      ['jsOpenToCountry', 'openToCountryOnly'],
      ['jsOnePerCompany', 'onePerCompany'],
    ].forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener('change', async (event) => {
        state.prefs[key] = Boolean(event.target.checked);
        await persistPrefs();
        recomputeFiltered();
        await persistResults();
        renderResults();
        renderMeta();
      });
    });

    // Which sources the next scrape reads. Results already listed are not touched.
    [
      ['jsUseJobright', 'useJobright'],
      ['jsUseHiringCafe', 'useHiringCafe'],
    ].forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener('change', async (event) => {
        state.prefs[key] = Boolean(event.target.checked);
        await persistPrefs();
        renderFeedStatus();
      });
    });

    document.getElementById('jsProfileFilter')?.addEventListener('change', async (event) => {
      state.prefs.candidateFilter = String(event.target.value || '').trim();
      await persistPrefs();
      await loadProfileFilterContext({ silent: true });
    });

    document.getElementById('jsFreshnessWindowJr')?.addEventListener('change', async (event) => {
      const value = String(event.target.value || '').trim().toLowerCase();
      if (!/^\d+[hd]$/.test(value)) return;
      state.prefs.freshnessWindowJr = value;
      await persistPrefs();
      recomputeFiltered();
      await persistResults();
      renderFeedStatus();
      renderResults();
      renderMeta();
      showToast(`Jobright freshness set to ${value}.`, 'success');
    });

    document.getElementById('jsFreshnessWindowHc')?.addEventListener('change', async (event) => {
      const value = String(event.target.value || '').trim().toLowerCase();
      if (!/^\d+[hd]$/.test(value)) return;
      state.prefs.freshnessWindowHc = value;
      await persistPrefs();
      recomputeFiltered();
      await persistResults();
      renderFeedStatus();
      renderResults();
      renderMeta();
      showToast(`HiringCafe freshness set to ${value}.`, 'success');
    });

    document.getElementById('jsRefreshProfileBtn')?.addEventListener('click', () => {
      void loadProfileFilterContext({ silent: false });
    });

    document.querySelectorAll('.tab-main[data-tab="job-scraper"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void loadProfileFilterContext({ silent: true });
      });
    });

    document.getElementById('jsScrapeBtn')?.addEventListener('click', () => {
      void runScrape({ resume: false });
    });
    document.getElementById('jsResumeBtn')?.addEventListener('click', () => {
      void runScrape({ resume: true });
    });
    document.getElementById('jsStopBtn')?.addEventListener('click', () => {
      state.stopRequested = true;
      // Parked on a browser check: no code is running, so settle it here.
      if (!state.runActive) {
        void commitPausedRun();
        return;
      }
      // Running: the loop sees this at its next step and finishes through
      // finishRun, which keeps everything collected so far.
      state.scraping = false;
      state.pausedForChallenge = false;
      setProgress({
        text: 'Stopping…',
        detail: 'Finishing the current step. Jobs collected so far are kept.',
        kind: 'warn',
        indeterminate: true,
        showTrust: false,
      });
      syncControlsFromState();
    });

    document.getElementById('jsClearResultsBtn')?.addEventListener('click', async () => {
      if (state.runActive || state.scraping) return;
      if (state.filteredJobs.length || state.rawJobs.length) {
        const ask = typeof window.rwhConfirm === 'function' ? window.rwhConfirm : (m) => Promise.resolve(window.confirm(m));
        const count = state.filteredJobs.length || state.rawJobs.length;
        const proceed = await ask(
          `Clear ${count} job${count === 1 ? '' : 's'}?\n\nThe next scrape lists whatever is inside the freshness window again.`,
          { confirmLabel: 'Clear', danger: true }
        );
        if (!proceed) return;
      }
      state.rawJobs = [];
      state.filteredJobs = [];
      state.selectedKeys = new Set();
      state.stats = null;
      state.lastScrapedAt = null;
      state.scrapeCursor = null;
      state.combinedRun = null;
      await storageSet({ [STORAGE.lastResults]: null });
      setProgress({ hidden: true });
      syncControlsFromState();
    });

    document.getElementById('jsCsvBtn')?.addEventListener('click', () => {
      const jobs = actionJobs();
      if (!jobs.length) return;
      const includeOrigin =
        activeSource() === 'both' ||
        jobs.some((j) => j.origin) ||
        state.stats?.source === 'both';
      const xml = jobsToBidExcelXml(jobs, { includeOrigin });
      const prefix =
        state.stats?.source === 'both' || activeSource() === 'both'
          ? 'jobstrike-both'
          : activeSource() === 'jobright'
            ? 'jobright'
            : 'hiringcafe';
      downloadTextFile(
        xml,
        `${prefix}-jobs.xls`,
        'application/vnd.ms-excel;charset=utf-8'
      );
      showToast(`Spreadsheet downloaded (${jobs.length}), highest score first.`, 'success');
    });

    document.getElementById('jsLinksBtn')?.addEventListener('click', () => {
      const links = actionJobs()
        .map((job) => job.apply_url)
        .filter(Boolean);
      if (!links.length) {
        showToast('No links to download.', 'error');
        return;
      }
      const prefix =
        state.stats?.source === 'both' || activeSource() === 'both'
          ? 'jobstrike-both'
          : activeSource() === 'jobright'
            ? 'jobright'
            : 'hiringcafe';
      downloadTextFile(
        links.join('\n'),
        `${prefix}-links.txt`,
        'text/plain;charset=utf-8'
      );
      showToast(`Links file downloaded (${links.length}).`, 'success');
    });

    document.getElementById('jsCopyReportBtn')?.addEventListener('click', async () => {
      const stats = state.stats || {};
      const text = JSON.stringify(
        {
          scrapedAt: state.lastScrapedAt,
          startedAt: stats.startedAt,
          found: state.rawJobs.length,
          ready: state.filteredJobs.length,
          hidden: {
            tooOld: stats.removedByDate || 0,
            blockedJobs: stats.removedBlockedJobs || 0,
            blockedCompanies: stats.removedBlockedCompanies || 0,
            blockedAts: stats.removedAts || 0,
            easyApplyOrAggregator: stats.removedAggregator || 0,
            repost: stats.removedRepost || 0,
            clearanceRequired: stats.removedClearance || 0,
            outsideUS: stats.removedForeign || 0,
            higherDegreeRequired: stats.removedDegree || 0,
            otherLanguageRequired: stats.removedLanguage || 0,
            jobType: stats.removedJobType || 0,
            notOpenToCandidateCountry: stats.removedNotOpen || 0,
            registeredJobs: stats.removedRegisteredJobs || 0,
            registeredCompanies: stats.removedRegisteredCompanies || 0,
          },
          mode: state.mode === 'intl' ? `worldwide contract (${state.prefs.candidateCountry || 'no country'})` : 'us',
          // Jobs listed by both sources: how often one source's posting time was
          // surely earlier (it is the one kept), and by how many hours.
          crossSourceDates: stats.crossSourceDates || null,
          // Types among the ready jobs ("not stated" when the source gives none).
          jobTypesReady: state.filteredJobs.reduce((bag, job) => {
            const name = job?.job_type || 'not stated';
            bag[name] = (bag[name] || 0) + 1;
            return bag;
          }, {}),
          // Not hidden: kept together in the list and the export.
          sameCompanyGrouped: {
            companies: stats.companiesWithSeveral || 0,
            extraJobs: stats.groupedSameCompany || 0,
          },
          // What the hide rules worked from: a list that is empty, stale, or
          // exactly 1,000 long is the first thing to check when a job slips through.
          lists: {
            profile: state.prefs.candidateFilter || null,
            syncedAt: state.listsSyncedAt ? new Date(state.listsSyncedAt).toISOString() : null,
            syncError: state.listsSyncError || null,
            appliedJobs: state.registeredJobs.length,
            appliedCompanies: state.registeredCompanies.length,
            blockedJobs: state.blockedJobs.length,
            blockedCompanies: state.blockedCompanies.length,
            blockedAts: state.blockedAts.length,
            switchedOff: hideRulesSwitchedOff(),
          },
          warnings: stats.warnings || [],
          report: stats.report || null,
        },
        null,
        2
      );
      try {
        await navigator.clipboard.writeText(text);
        showToast('Run report copied.', 'success');
      } catch (_) {
        showToast('Copy failed.', 'error');
      }
    });

    document.getElementById('jsCopyLinksBtn')?.addEventListener('click', async () => {
      const links = actionJobs()
        .map((job) => job.apply_url)
        .filter(Boolean);
      if (!links.length) {
        showToast('No links to copy.', 'error');
        return;
      }
      try {
        await navigator.clipboard.writeText(links.join('\n'));
        showToast(`Copied ${links.length} link(s).`, 'success');
      } catch (_) {
        showToast('Copy failed.', 'error');
      }
    });

    document.getElementById('jsListEditorClose')?.addEventListener('click', () => {
      closeListEditor();
    });

    document.getElementById('jsListEditorAddBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('jsListEditorInput');
      const value = input?.value || '';
      const kind = state.openListEditor;
      if (kind === 'company') await addBlockedCompany(value);
      else if (kind === 'ats') await addBlockedAts(value);
      else if (kind === 'job') await addBlockedJob({ apply_url: value });
      if (input) input.value = '';
    });

    document.getElementById('jsListEditorInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('jsListEditorAddBtn')?.click();
      } else if (event.key === 'Escape') {
        closeListEditor();
      }
    });

    // The count badge opens that list for editing. It sits inside the row's
    // <label>, so the click must not also toggle the checkbox.
    document.getElementById('jsFiltersModal')?.addEventListener('click', (event) => {
      const target = event.target.closest('.js-filter-count[data-edit-list]');
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      openListEditor(String(target.dataset.editList || ''));
    });

    document.getElementById('jsListEditorItems')?.addEventListener('click', async (event) => {
      const btn = event.target.closest('.js-unblock');
      if (!btn) return;
      const kind = btn.dataset.kind;
      await removeBlockedItem(kind, String(btn.dataset.id || '').trim());
    });
  }

  async function initJobScraperPanel() {
    if (!document.getElementById('tab-job-scraper')) return;
    const savedMode = (await storageGet([MODE_KEY]))[MODE_KEY];
    state.mode = savedMode === 'intl' ? 'intl' : 'us';
    applyModeStorageKeys(state.mode);
    await loadState();
    // The list already on screen counts too, not only the next scrape.
    void rememberScrapedNames(state.filteredJobs).catch(() => {});
    wireUi();
    syncControlsFromState();
    wireLive();
    void loadProfileFilterContext({ silent: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initJobScraperPanel();
    });
  } else {
    void initJobScraperPanel();
  }
})();
