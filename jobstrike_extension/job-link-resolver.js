/**
 * Finds a job's posting on the employer's own careers board.
 *
 * A job scraped with only a job-board link (Dice, LinkedIn, a Jobright info page)
 * usually also exists on the company's ATS board. Greenhouse, Lever and Ashby
 * publish each board as public JSON, so given the company and title we can look
 * the posting up and return its direct link.
 */
(function (global) {
  const CACHE_KEY = 'job_scraper_board_cache_v1';
  const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MISSING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
  const BOARD_TTL_MS = 30 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 12000;

  const LEGAL_SUFFIX_RE =
    /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pbc)\b\.?/g;
  // Part of the name, though boards often drop them ("Notion Labs" → notion).
  const NAME_TAIL_RE = /\b(holdings|group|technologies|technology|labs|software|systems|solutions)\b/g;

  /** company slug → { ats, slug, at } | { missing: true, at } */
  let slugCache = null;
  /** `${ats}:${slug}` → { at, jobs } for the current session. */
  const boardCache = new Map();

  const BOARDS = [
    {
      ats: 'Greenhouse',
      url: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      jobs: (data) =>
        (Array.isArray(data?.jobs) ? data.jobs : []).map((job) => ({
          title: job?.title,
          url: job?.absolute_url,
          location: job?.location?.name || '',
        })),
    },
    {
      ats: 'Ashby',
      url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      jobs: (data) =>
        (Array.isArray(data?.jobs) ? data.jobs : []).map((job) => ({
          title: job?.title,
          url: job?.jobUrl || job?.applyUrl,
          location: job?.location || '',
        })),
    },
    {
      ats: 'Lever',
      url: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
      jobs: (data) =>
        (Array.isArray(data) ? data : []).map((job) => ({
          title: job?.text,
          url: job?.hostedUrl || job?.applyUrl,
          location: job?.categories?.location || '',
        })),
    },
  ];

  function companyWords(company) {
    return String(company || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[.,'’()]/g, ' ')
      .replace(LEGAL_SUFFIX_RE, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  }

  /**
   * Board names a company would plausibly register. Only whole-name forms: a
   * first-word guess ("acme" for "Acme Robotics") could land on another company.
   */
  function slugCandidates(company) {
    const words = companyWords(company);
    if (!words.length) return [];
    const out = [words.join('')];
    if (words.length > 1) out.push(words.join('-'));
    const noAnd = words.filter((word) => word !== 'and');
    if (noAnd.length !== words.length && noAnd.length) out.push(noAnd.join(''));
    return [...new Set(out)].filter((slug) => slug.length >= 2 && slug.length <= 60);
  }

  /**
   * The shortened name ("Acme Labs" → acme). It may belong to another company,
   * so a board found this way is trusted only for an exact, specific title.
   */
  function weakSlugCandidates(company) {
    const full = companyWords(company);
    const trimmed = companyWords(String(company || '').toLowerCase().replace(NAME_TAIL_RE, ' '));
    if (!trimmed.length || trimmed.length === full.length) return [];
    const strong = new Set(slugCandidates(company));
    const out = [trimmed.join('')];
    if (trimmed.length > 1) out.push(trimmed.join('-'));
    return [...new Set(out)].filter((slug) => slug.length >= 3 && slug.length <= 60 && !strong.has(slug));
  }

  function normalizeTitle(title) {
    return String(title || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\bsr\b\.?/g, 'senior')
      .replace(/\bjr\b\.?/g, 'junior')
      .replace(/[^a-z0-9+#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const LOCATION_TAIL_RE =
    /\b(remote|hybrid|on[\s-]?site|united states|usa|u\.?s\.?a?|north america|americas|canada|emea|apac|europe|uk|anywhere|nationwide|eastern|pacific|central|mountain|est|pst|cst|mst)\b/i;
  const isLocationTail = (text) =>
    LOCATION_TAIL_RE.test(text) || /^\s*[A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(text);

  /**
   * Title with a trailing location removed — and only a location. "Engineer -
   * Payments" and "Engineer - Fraud" are different jobs and keep their tails.
   */
  function coreTitle(title) {
    return normalizeTitle(
      String(title || '')
        .replace(/\(([^)]*)\)/g, (whole, inner) => (isLocationTail(inner) ? ' ' : whole))
        .replace(/\s[-–—|]\s(.*)$/, (whole, tail) => (isLocationTail(tail) ? ' ' : whole))
    );
  }

  /**
   * The board posting for this title, or null. Exact title first; then the title
   * with location tails removed, but only when that points at one distinct role.
   */
  function matchTitle(jobs, title, { exactOnly = false } = {}) {
    const wanted = normalizeTitle(title);
    if (!wanted) return null;
    const usable = jobs.filter((job) => job.title && job.url);

    // One role is often posted once per location: take the US / remote one.
    const preferLocal = (list) =>
      list.find((job) => /\b(remote|united states|usa|u\.s\.|us)\b/i.test(String(job.location || ''))) ||
      list[0];

    const exact = usable.filter((job) => normalizeTitle(job.title) === wanted);
    if (exact.length) return preferLocal(exact);
    if (exactOnly) return null;

    const core = coreTitle(title);
    if (!core) return null;
    const loose = usable.filter((job) => coreTitle(job.title) === core);
    if (!loose.length) return null;
    // Several postings are fine when they are one role in several locations.
    const distinct = new Set(loose.map((job) => normalizeTitle(job.title)));
    return distinct.size <= 3 ? preferLocal(loose) : null;
  }

  async function loadSlugCache() {
    if (slugCache) return slugCache;
    slugCache = {};
    try {
      if (global.chrome?.storage?.local) {
        const stored = await new Promise((resolve) =>
          global.chrome.storage.local.get([CACHE_KEY], (result) => resolve(result || {}))
        );
        if (stored[CACHE_KEY] && typeof stored[CACHE_KEY] === 'object') slugCache = stored[CACHE_KEY];
      }
    } catch (_) {
      /* run without a cache */
    }
    return slugCache;
  }

  async function saveSlugCache() {
    if (!slugCache || !global.chrome?.storage?.local) return;
    const now = Date.now();
    for (const [key, entry] of Object.entries(slugCache)) {
      const ttl = entry?.missing ? MISSING_TTL_MS : FOUND_TTL_MS;
      if (!entry || now - (entry.at || 0) > ttl) delete slugCache[key];
    }
    await new Promise((resolve) =>
      global.chrome.storage.local.set({ [CACHE_KEY]: slugCache }, () => resolve())
    );
  }

  async function fetchBoard(board, slug) {
    const key = `${board.ats}:${slug}`;
    const cached = boardCache.get(key);
    if (cached && Date.now() - cached.at < BOARD_TTL_MS) return cached.jobs;
    let jobs = null;
    try {
      const response = await fetch(board.url(encodeURIComponent(slug)), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) jobs = board.jobs(await response.json());
      else if (response.status !== 404) jobs = undefined; // unknown: do not cache as missing
    } catch (_) {
      jobs = undefined;
    }
    if (jobs !== undefined) boardCache.set(key, { at: Date.now(), jobs });
    return jobs;
  }

  /**
   * The company's board, if one of the three hosts has it under a whole-name slug.
   * @returns {Promise<{ats:string, slug:string, jobs:object[]}|null>}
   */
  async function findBoard(company) {
    const candidates = slugCandidates(company);
    if (!candidates.length) return null;
    const cache = await loadSlugCache();
    const cacheKey = candidates[0];
    const known = cache[cacheKey];
    const now = Date.now();

    if (known && !known.missing && now - known.at < FOUND_TTL_MS) {
      const board = BOARDS.find((b) => b.ats === known.ats);
      const jobs = board ? await fetchBoard(board, known.slug) : null;
      if (jobs && jobs.length) return { ats: known.ats, slug: known.slug, jobs };
    } else if (known?.missing && now - known.at < MISSING_TTL_MS) {
      return null;
    }

    let uncertain = false;
    for (const slug of candidates) {
      // The three hosts are independent, so ask them together.
      const results = await Promise.all(BOARDS.map((board) => fetchBoard(board, slug)));
      for (let i = 0; i < BOARDS.length; i += 1) {
        const jobs = results[i];
        if (jobs === undefined) uncertain = true;
        if (jobs && jobs.length) {
          cache[cacheKey] = { ats: BOARDS[i].ats, slug, at: now };
          return { ats: BOARDS[i].ats, slug, jobs };
        }
      }
    }
    // The shortened name, last and flagged: its board may be someone else's.
    for (const slug of weakSlugCandidates(company)) {
      const results = await Promise.all(BOARDS.map((board) => fetchBoard(board, slug)));
      for (let i = 0; i < BOARDS.length; i += 1) {
        const jobs = results[i];
        if (jobs === undefined) uncertain = true;
        if (jobs && jobs.length) return { ats: BOARDS[i].ats, slug, jobs, weak: true };
      }
    }

    // A timeout is not "no board": only remember a clean miss.
    if (!uncertain) cache[cacheKey] = { missing: true, at: now };
    return uncertain ? { uncertain: true } : null;
  }

  /**
   * @returns {Promise<{url:string, ats:string, title:string}|null>}
   */
  async function resolveDirectLink({ company, title }) {
    const board = await findBoard(company);
    if (!board) return null;
    // Could not check (offline, timeout): the caller should try again later.
    if (board.uncertain) return { uncertain: true };
    // A board found by a shortened name counts only for an exact, specific title.
    const specific = normalizeTitle(title).split(' ').length >= 3;
    if (board.weak && !specific) return null;
    const match = matchTitle(board.jobs, title, { exactOnly: Boolean(board.weak) });
    if (!match) return null;
    return { url: String(match.url), ats: board.ats, title: String(match.title || '') };
  }

  /**
   * Resolve many jobs with bounded concurrency. `onProgress(done, total, found)`
   * is called after each one; `shouldStop()` ends the batch early.
   * @returns {Promise<Map<number, {url:string, ats:string}>>} by input index
   */
  async function resolveMany(jobs, { concurrency = 3, onProgress, shouldStop } = {}) {
    const found = new Map();
    /** Indexes whose lookup could not be completed; not a miss. */
    found.uncertain = new Set();
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        if (shouldStop?.()) return;
        const index = next;
        next += 1;
        const job = jobs[index];
        try {
          const hit = await resolveDirectLink({ company: job.company_name, title: job.title });
          if (hit?.uncertain) found.uncertain.add(index);
          else if (hit) found.set(index, hit);
        } catch (_) {
          // One failed lookup must not end the batch, nor count as "not found".
          found.uncertain.add(index);
        }
        done += 1;
        onProgress?.(done, jobs.length, found.size);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
    await saveSlugCache();
    return found;
  }

  global.SmartJobLinkResolver = {
    slugCandidates,
    normalizeTitle,
    matchTitle,
    findBoard,
    resolveDirectLink,
    resolveMany,
  };
})(typeof window !== 'undefined' ? window : globalThis);
