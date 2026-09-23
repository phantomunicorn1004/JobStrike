/**
 * Jobright.ai Recommend scrape helpers for the extension (browser-side).
 * Uses the logged-in Recommend feed (account Saved Filters) via swan-api.
 */
(function (global) {
  const JOBRIGHT_SITE = 'https://jobright.ai';
  const JOBRIGHT_RECOMMEND = `${JOBRIGHT_SITE}/jobs/recommend`;
  const SWAN_API = 'https://swan-api.jobright.ai';
  /** Jobright recommend / search list page size (SSR + swan-api). */
  const PAGE_SIZE = 20;
  const DEFAULT_SEARCH = {
    titleKeyword: 'Software Engineer',
    location: 'United States',
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
    ['Jobright', (h) => h.includes('jobright.ai')],
  ];

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

  function joinList(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
        .join('\n');
    }
    return serializeField(value);
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

  const COUNTRY_TO_LOCATION = {
    US: 'United States',
    USA: 'United States',
    CA: 'Canada',
    GB: 'United Kingdom',
    UK: 'United Kingdom',
  };

  /** Params that should be overridden when paging swan-api / opening a fresh tab. */
  const PAGING_PARAM_KEYS = new Set(['position', 'count', 'page', 'refresh', 'visit']);

  function cloneDefaultSearch() {
    return { ...DEFAULT_SEARCH };
  }

  function mapCountryToLocation(country) {
    const code = String(country || '').trim().toUpperCase();
    if (!code) return '';
    return COUNTRY_TO_LOCATION[code] || String(country || '').trim();
  }

  function countryCodeFromLocation(location) {
    const loc = String(location || '').trim().toLowerCase();
    if (!loc) return 'US';
    if (/^[a-z]{2}$/i.test(loc)) return loc.toUpperCase();
    if (loc.includes('united states') || loc === 'usa') return 'US';
    if (loc.includes('canada')) return 'CA';
    if (loc.includes('united kingdom') || loc.includes('england') || loc === 'uk') return 'GB';
    return 'US';
  }

  function taxonomyTitleFromParams(paramsOrUrl) {
    let raw = '';
    if (paramsOrUrl instanceof URL) {
      raw = paramsOrUrl.searchParams.get('jobTaxonomyList') || '';
    } else if (paramsOrUrl && typeof paramsOrUrl === 'object') {
      raw = String(paramsOrUrl.jobTaxonomyList || '');
    }
    if (!raw) return '';
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list[0]?.title) return String(list[0].title).trim();
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  function cloneParams(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    const out = {};
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      const str = String(value);
      if (!str) continue;
      out[key] = str;
    }
    return Object.keys(out).length ? out : null;
  }

  function normalizeSearch(search) {
    const titleKeyword = String(
      search?.titleKeyword ?? search?.keyword ?? search?.value ?? ''
    ).trim();
    const location = String(
      search?.location ?? mapCountryToLocation(search?.country) ?? ''
    ).trim();
    const params = cloneParams(search?.params);
    return {
      titleKeyword: titleKeyword || DEFAULT_SEARCH.titleKeyword,
      location: location || DEFAULT_SEARCH.location,
      ...(params ? { params } : {}),
    };
  }

  function buildQueryFromParams(params, { position, count } = {}) {
    const qs = new URLSearchParams();
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (value == null || value === '') continue;
        if (PAGING_PARAM_KEYS.has(key)) continue;
        qs.set(key, String(value));
      }
    }
    if (position != null) qs.set('position', String(Math.max(0, Number(position) || 0)));
    if (count != null) qs.set('count', String(Math.max(1, Number(count) || PAGE_SIZE)));
    return qs;
  }

  function buildJobrightSearchUrl(search, page = 0) {
    const normalized = normalizeSearch(search);
    const url = new URL(`${JOBRIGHT_SITE}/jobs/search`);

    if (normalized.params) {
      for (const [key, value] of Object.entries(normalized.params)) {
        if (value == null || value === '') continue;
        if (key === 'page' || key === 'visit') continue;
        url.searchParams.set(key, String(value));
      }
      // Fresh scrape always starts at the first page of results.
      url.searchParams.set('position', page > 0 ? String(page * PAGE_SIZE) : '0');
      return url.toString();
    }

    // Current Jobright search URL shape (value/country) + legacy aliases.
    url.searchParams.set('value', normalized.titleKeyword);
    url.searchParams.set('country', countryCodeFromLocation(normalized.location));
    url.searchParams.set('titleKeyword', normalized.titleKeyword);
    if (normalized.location) url.searchParams.set('location', normalized.location);
    url.searchParams.set('visit', 'search');
    url.searchParams.set('position', page > 0 ? String(page * PAGE_SIZE) : '0');
    return url.toString();
  }

  function buildSwanApiCandidateUrls(search, position, count) {
    const normalized = normalizeSearch(search);
    const size = Math.max(1, Math.min(Number(count) || PAGE_SIZE, 50));
    const pos = Math.max(0, Number(position) || 0);
    const kw = encodeURIComponent(normalized.titleKeyword);
    const loc = encodeURIComponent(normalized.location || '');
    const country = encodeURIComponent(countryCodeFromLocation(normalized.location));
    const urls = [];

    if (normalized.params) {
      const qs = buildQueryFromParams(normalized.params, { position: pos, count: size });
      if (!qs.has('value') && !qs.has('titleKeyword')) qs.set('value', normalized.titleKeyword);
      if (!qs.has('country') && !qs.has('location')) qs.set('country', countryCodeFromLocation(normalized.location));
      const q = qs.toString();
      urls.push(`${SWAN_API}/swan/search/list/jobs?${q}`);
      urls.push(`${SWAN_API}/swan/job/search/list?${q}`);
    }

    // New-style minimal query.
    urls.push(
      `${SWAN_API}/swan/search/list/jobs?value=${kw}&country=${country}&position=${pos}&count=${size}`
    );
    urls.push(
      `${SWAN_API}/swan/job/search/list?value=${kw}&country=${country}&position=${pos}&count=${size}`
    );

    // Legacy titleKeyword/location.
    urls.push(
      `${SWAN_API}/swan/search/list/jobs?titleKeyword=${kw}&location=${loc}&position=${pos}&count=${size}`
    );
    urls.push(
      `${SWAN_API}/swan/job/search/list?titleKeyword=${kw}&location=${loc}&position=${pos}&count=${size}`
    );

    urls.push(
      `${SWAN_API}/swan/recommend/list/jobs?position=${pos}&count=${size}${pos === 0 ? '&refresh=true' : ''}`
    );
    return urls;
  }

  /** Recommend feed only — server applies the account Saved Filters. */
  function buildRecommendApiUrls(position, count, sortCondition) {
    const size = Math.max(1, Math.min(Number(count) || PAGE_SIZE, 50));
    const pos = Math.max(0, Number(position) || 0);
    const refresh = pos === 0 ? '&refresh=true' : '';
    const sortRaw = String(sortCondition || '').trim();
    // Always try bare Recommend URL first. Optional real captured sort after.
    // Do not invent MOST_RECENT — that caused JR 0 when the API rejected it.
    const sortParts = [''];
    if (sortRaw) sortParts.push(`&sortCondition=${encodeURIComponent(sortRaw)}`);
    const seen = new Set();
    const urls = [];
    for (const sort of sortParts) {
      for (const path of [
        `${SWAN_API}/swan/recommend/list/jobs?position=${pos}&count=${size}${refresh}${sort}`,
        `${SWAN_API}/swan/job/recommend/list?position=${pos}&count=${size}${refresh}${sort}`,
      ]) {
        if (seen.has(path)) continue;
        seen.add(path);
        urls.push(path);
      }
    }
    return urls;
  }

  function collectJobRowsFromPayload(payload, out) {
    if (!payload) return;
    if (Array.isArray(payload)) {
      for (const item of payload) {
        if (item && typeof item === 'object') {
          const row = item;
          if (row.jobResult || row.jobTitle || row.jobId || row.applyLink) {
            out.push(item);
          } else {
            collectJobRowsFromPayload(item, out);
          }
        }
      }
      return;
    }
    if (typeof payload !== 'object') return;
    for (const key of ['jobList', 'jobs', 'list', 'result', 'data', 'records']) {
      if (payload[key] != null) collectJobRowsFromPayload(payload[key], out);
    }
  }

  function extractTotalFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.total === 'number') return payload.total;
    if (typeof payload.totalJobs === 'number') return payload.totalJobs;
    if (payload.result && typeof payload.result === 'object') {
      if (typeof payload.result.total === 'number') return payload.result.total;
      if (typeof payload.result.totalJobs === 'number') return payload.result.totalJobs;
    }
    return null;
  }

  /**
   * Fetch swan-api from the extension page (sidepanel). Bypasses page CORS;
   * Chrome attaches jobright cookies when host_permissions allow the URL.
   */
  async function fetchSearchApiPageExtension(search, position, count) {
    const candidates = buildSwanApiCandidateUrls(search, position, count);
    const errors = [];

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          errors.push(`${response.status} ${url.split('?')[0]}`);
          continue;
        }
        const json = await response.json().catch(() => null);
        if (!json) continue;
        const rows = [];
        collectJobRowsFromPayload(json, rows);
        if (rows.length === 0) {
          errors.push(`empty ${url.split('?')[0]}`);
          continue;
        }
        return {
          ok: true,
          rows,
          total: extractTotalFromPayload(json),
          endpoint: url.split('?')[0],
          via: 'extension',
        };
      } catch (err) {
        errors.push(
          `${err?.message || String(err)} (${url.split('?')[0].replace(/^https:\/\//, '')})`
        );
      }
    }

    return {
      ok: false,
      rows: [],
      total: null,
      error: errors.length ? errors.slice(0, 4).join('; ') : 'No swan-api endpoint returned jobs',
    };
  }

  /** Page the Recommend feed (Saved Filters) from the extension context. */
  async function fetchRecommendApiPageExtension(position, count, sortCondition) {
    const candidates = buildRecommendApiUrls(position, count, sortCondition);
    const errors = [];

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          errors.push(`${response.status} ${url.split('?')[0]}`);
          continue;
        }
        const json = await response.json().catch(() => null);
        if (!json) continue;
        const rows = [];
        collectJobRowsFromPayload(json, rows);
        if (rows.length === 0) {
          errors.push(`empty ${url.split('?')[0]}`);
          continue;
        }
        let detectedSort = sortCondition || '';
        try {
          detectedSort =
            new URL(url).searchParams.get('sortCondition') || detectedSort;
        } catch (_) {
          /* ignore */
        }
        return {
          ok: true,
          rows,
          total: extractTotalFromPayload(json),
          endpoint: url.split('?')[0],
          via: 'extension',
          sortCondition: detectedSort || null,
        };
      } catch (err) {
        errors.push(
          `${err?.message || String(err)} (${url.split('?')[0].replace(/^https:\/\//, '')})`
        );
      }
    }

    return {
      ok: false,
      rows: [],
      total: null,
      error:
        errors.length
          ? errors.slice(0, 4).join('; ')
          : 'No recommend swan-api endpoint returned jobs',
    };
  }

  /**
   * Injected into the Jobright tab (MAIN world). Must stay self-contained.
   * Do not set Origin/Referer — they are forbidden and can break fetch.
   */
  async function fetchSearchApiPageInTab(search, position, count) {
    const SWAN_API = 'https://swan-api.jobright.ai';
    const PAGE_SIZE = 20;
    const PAGING_KEYS = new Set(['position', 'count', 'page', 'refresh', 'visit']);
    const titleKeyword = String(
      search?.titleKeyword || search?.value || ''
    ).trim() || 'Software Engineer';
    const location = String(search?.location || '').trim() || 'United States';
    const country =
      String(search?.params?.country || '').trim() ||
      (/canada/i.test(location) ? 'CA' : /united kingdom|\buk\b/i.test(location) ? 'GB' : 'US');
    const kw = encodeURIComponent(titleKeyword);
    const loc = encodeURIComponent(location);
    const ctry = encodeURIComponent(country);
    const size = Math.max(1, Math.min(Number(count) || PAGE_SIZE, 50));
    const pos = Math.max(0, Number(position) || 0);

    const candidates = [];
    if (search?.params && typeof search.params === 'object') {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(search.params)) {
        if (value == null || value === '' || PAGING_KEYS.has(key)) continue;
        qs.set(key, String(value));
      }
      if (!qs.has('value') && !qs.has('titleKeyword')) qs.set('value', titleKeyword);
      if (!qs.has('country') && !qs.has('location')) qs.set('country', country);
      qs.set('position', String(pos));
      qs.set('count', String(size));
      const q = qs.toString();
      candidates.push(`${SWAN_API}/swan/search/list/jobs?${q}`);
      candidates.push(`${SWAN_API}/swan/job/search/list?${q}`);
    }
    candidates.push(
      `${SWAN_API}/swan/search/list/jobs?value=${kw}&country=${ctry}&position=${pos}&count=${size}`,
      `${SWAN_API}/swan/job/search/list?value=${kw}&country=${ctry}&position=${pos}&count=${size}`,
      `${SWAN_API}/swan/search/list/jobs?titleKeyword=${kw}&location=${loc}&position=${pos}&count=${size}`,
      `${SWAN_API}/swan/job/search/list?titleKeyword=${kw}&location=${loc}&position=${pos}&count=${size}`,
      `${SWAN_API}/swan/recommend/list/jobs?position=${pos}&count=${size}${pos === 0 ? '&refresh=true' : ''}`
    );

    function collect(payload, out) {
      if (!payload) return;
      if (Array.isArray(payload)) {
        for (const item of payload) {
          if (item && typeof item === 'object') {
            if (item.jobResult || item.jobTitle || item.jobId || item.applyLink) {
              out.push(item);
            } else {
              collect(item, out);
            }
          }
        }
        return;
      }
      if (typeof payload !== 'object') return;
      for (const key of ['jobList', 'jobs', 'list', 'result', 'data', 'records']) {
        if (payload[key] != null) collect(payload[key], out);
      }
    }

    function readTotal(payload) {
      if (!payload || typeof payload !== 'object') return null;
      if (typeof payload.total === 'number') return payload.total;
      if (typeof payload.totalJobs === 'number') return payload.totalJobs;
      if (payload.result && typeof payload.result === 'object') {
        if (typeof payload.result.total === 'number') return payload.result.total;
        if (typeof payload.result.totalJobs === 'number') return payload.result.totalJobs;
      }
      return null;
    }

    const errors = [];
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          errors.push(`${response.status} ${url.split('?')[0]}`);
          continue;
        }
        const json = await response.json().catch(() => null);
        if (!json) continue;
        const rows = [];
        collect(json, rows);
        if (rows.length === 0) {
          errors.push(`empty ${url.split('?')[0]}`);
          continue;
        }
        return {
          ok: true,
          rows,
          total: readTotal(json),
          endpoint: url.split('?')[0],
          via: 'tab',
        };
      } catch (err) {
        errors.push(
          `${err?.message || String(err)} (${url.split('?')[0].replace(/^https:\/\//, '')})`
        );
      }
    }

    return {
      ok: false,
      rows: [],
      total: null,
      error: errors.length ? errors.slice(0, 3).join('; ') : 'No swan-api endpoint returned jobs',
    };
  }

  /**
   * Injected (MAIN): auto-select "Most Recent" in the Recommend sort dropdown
   * (Recommended | Top Matched | Most Recent) shown in the Jobright UI.
   */
  async function ensureMostRecentSort() {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const lower = (text) => clean(text).toLowerCase();
    const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
    const SORT_LABELS = /^(recommended|top matched|most recent)$/i;

    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    }

    function leafText(el) {
      return clean(el?.innerText || el?.textContent || '');
    }

    function clickEl(el) {
      if (!el) return false;
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (_) {}
      try {
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return true;
      } catch (_) {
        try {
          el.click();
          return true;
        } catch (_) {
          return false;
        }
      }
    }

    /** Closed trigger shows current sort, e.g. "Recommended" with chevron. */
    function findSortTrigger() {
      const nodes = Array.from(
        document.querySelectorAll('button, [role="button"], [role="combobox"], div, span')
      );
      const matches = [];
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const text = leafText(el);
        if (!SORT_LABELS.test(text)) continue;
        if (text.length > 20) continue;
        matches.push(el);
      }
      matches.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height || ra.top - rb.top;
      });
      return matches[0] || null;
    }

    /** Deepest visible node whose text is exactly Most Recent (menu row). */
    function findMostRecentMenuItem() {
      const nodes = Array.from(
        document.querySelectorAll(
          'div, span, li, button, [role="option"], [role="menuitem"], [class*="option"], [class*="item"], [class*="menu"], [class*="dropdown"]'
        )
      );
      let best = null;
      let bestScore = Infinity;
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const text = leafText(el);
        if (!/^most\s*recent$/i.test(text)) continue;
        const rect = el.getBoundingClientRect();
        const score = el.childElementCount * 1000 + rect.width * rect.height;
        if (score < bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return best;
    }

    async function waitForTrigger(timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const el = findSortTrigger();
        if (el) return el;
        await sleepMs(150);
      }
      return null;
    }

    async function waitForOpenMenuItem(trigger, timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const el = findMostRecentMenuItem();
        if (el && trigger) {
          const tr = trigger.getBoundingClientRect();
          const er = el.getBoundingClientRect();
          if (er.top >= tr.top - 8 && el !== trigger) return el;
        } else if (el && el !== trigger) {
          return el;
        }
        await sleepMs(100);
      }
      return findMostRecentMenuItem();
    }

    try {
      let trigger = await waitForTrigger(10000);
      if (!trigger) {
        return { ok: false, reason: 'sort dropdown (Recommended) not found' };
      }

      if (/most\s*recent/i.test(lower(leafText(trigger)))) {
        return { ok: true, already: true, label: leafText(trigger) };
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        trigger = findSortTrigger() || trigger;
        if (/most\s*recent/i.test(lower(leafText(trigger)))) {
          return { ok: true, already: true, label: leafText(trigger), attempt };
        }

        clickEl(trigger);
        await sleepMs(400);

        const option = await waitForOpenMenuItem(trigger, 3500);
        if (!option) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleepMs(300);
          continue;
        }

        let clickTarget = option;
        const parent = option.parentElement;
        if (parent && /^most\s*recent$/i.test(leafText(parent))) {
          clickTarget = parent;
        }
        clickEl(clickTarget);
        await sleepMs(1000);

        const afterTrigger = await waitForTrigger(3000);
        const afterLabel = leafText(afterTrigger);
        if (/most\s*recent/i.test(lower(afterLabel))) {
          return { ok: true, clicked: true, label: afterLabel, attempt };
        }
      }

      return {
        ok: false,
        reason: 'opened dropdown but Most Recent did not stick',
        label: leafText(findSortTrigger()),
      };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /** Injected (MAIN): read sortCondition from swan-api URLs captured after UI sort. */
  function readCapturedRecommendSort() {
    try {
      const items = Array.isArray(window.__jobstrikeSwanCapture)
        ? window.__jobstrikeSwanCapture
        : [];
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const url = String(items[i]?.url || '');
        if (!/recommend/i.test(url)) continue;
        try {
          const sort = new URL(url, location.origin).searchParams.get('sortCondition');
          if (sort) return { ok: true, sortCondition: sort, url };
        } catch (_) {
          const m = url.match(/[?&]sortCondition=([^&]+)/i);
          if (m) return { ok: true, sortCondition: decodeURIComponent(m[1]), url };
        }
      }
      return { ok: false, sortCondition: null };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /** Injected (MAIN): page Recommend feed with page cookies. */
  async function fetchRecommendApiPageInTab(position, count, sortCondition) {
    const SWAN_API = 'https://swan-api.jobright.ai';
    const PAGE_SIZE = 20;
    const size = Math.max(1, Math.min(Number(count) || PAGE_SIZE, 50));
    const pos = Math.max(0, Number(position) || 0);
    const refresh = pos === 0 ? '&refresh=true' : '';
    const sortRaw = String(sortCondition || '').trim();
    // Bare Recommend URL first (UI Most Recent is session-side). Optional captured sort after.
    const sortVariants = [''];
    if (sortRaw) sortVariants.push(`&sortCondition=${encodeURIComponent(sortRaw)}`);
    const candidates = [];
    const seen = new Set();
    for (const sort of sortVariants) {
      for (const url of [
        `${SWAN_API}/swan/recommend/list/jobs?position=${pos}&count=${size}${refresh}${sort}`,
        `${SWAN_API}/swan/job/recommend/list?position=${pos}&count=${size}${refresh}${sort}`,
      ]) {
        if (seen.has(url)) continue;
        seen.add(url);
        candidates.push(url);
      }
    }

    function collect(payload, out) {
      if (!payload) return;
      if (Array.isArray(payload)) {
        for (const item of payload) {
          if (item && typeof item === 'object') {
            if (item.jobResult || item.jobTitle || item.jobId || item.applyLink) {
              out.push(item);
            } else {
              collect(item, out);
            }
          }
        }
        return;
      }
      if (typeof payload !== 'object') return;
      for (const key of ['jobList', 'jobs', 'list', 'result', 'data', 'records']) {
        if (payload[key] != null) collect(payload[key], out);
      }
    }

    function readTotal(payload) {
      if (!payload || typeof payload !== 'object') return null;
      if (typeof payload.total === 'number') return payload.total;
      if (typeof payload.totalJobs === 'number') return payload.totalJobs;
      if (payload.result && typeof payload.result === 'object') {
        if (typeof payload.result.total === 'number') return payload.result.total;
        if (typeof payload.result.totalJobs === 'number') return payload.result.totalJobs;
      }
      return null;
    }

    const errors = [];
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          errors.push(`${response.status} ${url.split('?')[0]}`);
          continue;
        }
        const json = await response.json().catch(() => null);
        if (!json) continue;
        const rows = [];
        collect(json, rows);
        if (rows.length === 0) {
          errors.push(`empty ${url.split('?')[0]}`);
          continue;
        }
        let detectedSort = sortRaw;
        try {
          detectedSort = new URL(url).searchParams.get('sortCondition') || detectedSort;
        } catch (_) {
          /* ignore */
        }
        return {
          ok: true,
          rows,
          total: readTotal(json),
          endpoint: url.split('?')[0],
          via: 'tab',
          sortCondition: detectedSort || null,
        };
      } catch (err) {
        errors.push(
          `${err?.message || String(err)} (${url.split('?')[0].replace(/^https:\/\//, '')})`
        );
      }
    }

    return {
      ok: false,
      rows: [],
      total: null,
      error:
        errors.length
          ? errors.slice(0, 3).join('; ')
          : 'No recommend swan-api endpoint returned jobs',
    };
  }

  /** Injected (MAIN): patch fetch/XHR to capture swan-api JSON the SPA loads. */
  function installSwanCaptureInTab() {
    if (window.__jobstrikeSwanInstalled) {
      window.__jobstrikeSwanCapture = window.__jobstrikeSwanCapture || [];
      window.__jobstrikeSwanSeen = window.__jobstrikeSwanSeen || new Set();
      return { ok: true, already: true };
    }
    window.__jobstrikeSwanCapture = [];
    window.__jobstrikeSwanSeen = new Set();

    const pushPayload = (url, json) => {
      try {
        const key = `${url}::${JSON.stringify(json)?.slice(0, 180)}`;
        if (window.__jobstrikeSwanSeen.has(key)) return;
        window.__jobstrikeSwanSeen.add(key);
        window.__jobstrikeSwanCapture.push({ url: String(url || ''), json });
      } catch (_) {
        /* ignore */
      }
    };

    const origFetch = window.fetch.bind(window);
    window.fetch = async function jobstrikePatchedFetch(input, init) {
      const response = await origFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        if (url && /swan-api\.jobright\.ai/i.test(String(url)) && response.ok) {
          const clone = response.clone();
          clone
            .json()
            .then((json) => pushPayload(url, json))
            .catch(() => {});
        }
      } catch (_) {
        /* ignore */
      }
      return response;
    };

    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      const xhr = new OrigXHR();
      let reqUrl = '';
      const open = xhr.open;
      xhr.open = function (method, url, ...rest) {
        reqUrl = String(url || '');
        return open.call(xhr, method, url, ...rest);
      };
      xhr.addEventListener('load', function () {
        try {
          if (!/swan-api\.jobright\.ai/i.test(reqUrl) || xhr.status < 200 || xhr.status >= 300) {
            return;
          }
          pushPayload(reqUrl, JSON.parse(xhr.responseText));
        } catch (_) {
          /* ignore */
        }
      });
      return xhr;
    }
    PatchedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = PatchedXHR;

    window.__jobstrikeSwanInstalled = true;
    return { ok: true, already: false };
  }

  /**
   * Injected (MAIN): after capture is installed, force Recommend to refetch so
   * swan-api responses hit the patched fetch (first paint was usually already done).
   */
  async function forceRecommendRefetchInTab() {
    try {
      if (window.__jobstrikeSwanCapture) window.__jobstrikeSwanCapture.length = 0;

      const SWAN_API = 'https://swan-api.jobright.ai';
      const candidates = [
        `${SWAN_API}/swan/recommend/list/jobs?position=0&count=20&refresh=true`,
        `${SWAN_API}/swan/job/recommend/list?position=0&count=20&refresh=true`,
        `${SWAN_API}/swan/recommend/list/jobs?position=0&count=50&refresh=true`,
      ];

      let apiRows = 0;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) continue;
          const json = await response.json().catch(() => null);
          if (!json) continue;
          // Patched fetch also stores this; count jobs for ok signal.
          const probe = [];
          const walk = (payload) => {
            if (!payload) return;
            if (Array.isArray(payload)) {
              for (const item of payload) {
                if (
                  item &&
                  typeof item === 'object' &&
                  (item.jobResult || item.jobTitle || item.jobId || item.applyLink)
                ) {
                  probe.push(item);
                } else if (item && typeof item === 'object') {
                  walk(item);
                }
              }
              return;
            }
            if (typeof payload === 'object') {
              for (const key of ['jobList', 'jobs', 'list', 'result', 'data', 'records']) {
                if (payload[key] != null) walk(payload[key]);
              }
            }
          };
          walk(json);
          if (probe.length) {
            apiRows = probe.length;
            break;
          }
        } catch (_) {
          /* try next */
        }
      }

      // Soft UI nudge: scroll to top then a bit down so infinite feed may refetch.
      try {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 200));
        window.scrollBy(0, Math.max(window.innerHeight, 600));
      } catch (_) {
        /* ignore */
      }

      await new Promise((r) => setTimeout(r, 900));

      return {
        ok: apiRows > 0 || (window.__jobstrikeSwanCapture || []).length > 0,
        apiRows,
        captured: (window.__jobstrikeSwanCapture || []).length,
      };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /**
   * Injected (MAIN): scrape visible Recommend cards from the DOM when network
   * capture / API guesses return nothing.
   */
  function extractDomRecommendJobsInTab() {
    try {
      const rows = [];
      const seen = new Set();
      const anchors = Array.from(
        document.querySelectorAll('a[href*="/jobs/info/"], a[href*="/jobs/detail/"]')
      );

      for (const a of anchors) {
        const href = String(a.href || '');
        const m = href.match(/\/jobs\/(?:info|detail)\/([^/?#]+)/i);
        if (!m) continue;
        const jobId = decodeURIComponent(m[1]);
        if (!jobId || seen.has(jobId)) continue;
        seen.add(jobId);

        let card = a.closest('article, li, [class*="Job"], [class*="job"], [class*="card"], [class*="Card"]');
        if (!card) card = a.parentElement;
        const block = card || a;
        const lines = String(block.innerText || a.textContent || '')
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((s) => !/^(easy apply|applied|save|saved|new|hot)$/i.test(s));

        let title = '';
        let company = '';
        for (const line of lines) {
          if (!title && line.length > 2 && line.length < 180) {
            title = line;
            continue;
          }
          if (title && !company && line.length > 1 && line.length < 100 && line !== title) {
            company = line;
            break;
          }
        }
        if (!title) title = String(a.textContent || '').trim() || `Job ${jobId}`;

        rows.push({
          jobId,
          jobTitle: title,
          companyName: company,
          applyLink: href.startsWith('http') ? href : `https://jobright.ai/jobs/info/${jobId}`,
        });
      }

      return { ok: rows.length > 0, rows, via: 'dom', count: rows.length };
    } catch (err) {
      return { ok: false, rows: [], error: err?.message || String(err) };
    }
  }

  /**
   * Injected (MAIN): return jobs already captured from swan-api (e.g. after Most Recent click).
   */
  function drainSwanCaptureInTab() {
    try {
      const items = Array.isArray(window.__jobstrikeSwanCapture)
        ? window.__jobstrikeSwanCapture.slice()
        : [];
      const rows = [];
      let total = null;
      let sortCondition = null;

      function collect(payload, out) {
        if (!payload) return;
        if (Array.isArray(payload)) {
          for (const item of payload) {
            if (item && typeof item === 'object') {
              if (item.jobResult || item.jobTitle || item.jobId || item.applyLink) {
                out.push(item);
              } else {
                collect(item, out);
              }
            }
          }
          return;
        }
        if (typeof payload !== 'object') return;
        for (const key of ['jobList', 'jobs', 'list', 'result', 'data', 'records']) {
          if (payload[key] != null) collect(payload[key], out);
        }
      }

      function readTotal(payload) {
        if (!payload || typeof payload !== 'object') return null;
        if (typeof payload.total === 'number') return payload.total;
        if (typeof payload.totalJobs === 'number') return payload.totalJobs;
        if (payload.result && typeof payload.result === 'object') {
          if (typeof payload.result.total === 'number') return payload.result.total;
          if (typeof payload.result.totalJobs === 'number') return payload.result.totalJobs;
        }
        return null;
      }

      for (const item of items) {
        const url = String(item?.url || '');
        // Accept any swan-api payload; Jobright path names change across releases.
        if (!/swan-api\.jobright\.ai/i.test(url)) continue;
        try {
          const sort = new URL(url, location.origin).searchParams.get('sortCondition');
          if (sort) sortCondition = sort;
        } catch (_) {
          const m = url.match(/[?&]sortCondition=([^&]+)/i);
          if (m) sortCondition = decodeURIComponent(m[1]);
        }
        collect(item.json, rows);
        const t = readTotal(item.json);
        if (t != null) total = t;
      }

      // Clear so later harvests only get new pages
      if (window.__jobstrikeSwanCapture) window.__jobstrikeSwanCapture.length = 0;

      return {
        ok: rows.length > 0,
        rows,
        total,
        sortCondition,
        via: 'swan-capture',
        drained: items.length,
      };
    } catch (err) {
      return { ok: false, rows: [], error: err?.message || String(err) };
    }
  }

  /**
   * Injected (MAIN): scroll the Recommend infinite feed and return newly captured jobs.
   * Jobright is one page + scroll — not classic pagination.
   */
  async function harvestMoreJobsInTab(scrollRounds) {
    function collect(payload, out) {
      if (!payload) return;
      if (Array.isArray(payload)) {
        for (const item of payload) {
          if (item && typeof item === 'object') {
            if (item.jobResult || item.jobTitle || item.jobId || item.applyLink) {
              out.push(item);
            } else {
              collect(item, out);
            }
          }
        }
        return;
      }
      if (typeof payload !== 'object') return;
      for (const key of ['jobList', 'jobs', 'list', 'result', 'data', 'records']) {
        if (payload[key] != null) collect(payload[key], out);
      }
    }

    function readTotal(payload) {
      if (!payload || typeof payload !== 'object') return null;
      if (typeof payload.total === 'number') return payload.total;
      if (typeof payload.totalJobs === 'number') return payload.totalJobs;
      if (payload.result && typeof payload.result === 'object') {
        if (typeof payload.result.total === 'number') return payload.result.total;
        if (typeof payload.result.totalJobs === 'number') return payload.result.totalJobs;
      }
      return null;
    }

    function findScrollRoot() {
      const candidates = Array.from(
        document.querySelectorAll('main, [class*="list"], [class*="feed"], [class*="scroll"], [class*="job"]')
      );
      let best = null;
      let bestScore = 0;
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        const canScroll =
          /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 80;
        if (!canScroll) continue;
        const score = el.scrollHeight - el.clientHeight;
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return best;
    }

    function scrollOnce(root) {
      const step = Math.max(window.innerHeight, 900);
      if (root) {
        root.scrollTop = Math.min(root.scrollTop + step * 1.6, root.scrollHeight);
      } else {
        window.scrollBy(0, step * 1.6);
        document.documentElement.scrollTop = document.documentElement.scrollHeight;
        document.body.scrollTop = document.body.scrollHeight;
      }
    }

    window.__jobstrikeSwanCapture = window.__jobstrikeSwanCapture || [];
    const beforeLen = window.__jobstrikeSwanCapture.length;
    const rounds = Math.max(2, Math.min(Number(scrollRounds) || 5, 12));
    const root = findScrollRoot();

    for (let i = 0; i < rounds; i += 1) {
      scrollOnce(root);
      await new Promise((r) => setTimeout(r, 700));
      // Second nudge in case lazy-load needs another tick
      scrollOnce(root);
      await new Promise((r) => setTimeout(r, 550));
    }

    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const loadMore = buttons.find((el) =>
      /load\s*more|show\s*more|see\s*more|next/i.test((el.textContent || '').trim())
    );
    if (loadMore) {
      try {
        loadMore.click();
      } catch (_) {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    await new Promise((r) => setTimeout(r, 500));

    const captured = window.__jobstrikeSwanCapture.slice(beforeLen);
    const rows = [];
    let total = null;
    let sortCondition = null;
    for (const item of captured) {
      const url = String(item?.url || '');
      try {
        const sort = new URL(url, location.origin).searchParams.get('sortCondition');
        if (sort) sortCondition = sort;
      } catch (_) {
        /* ignore */
      }
      collect(item.json, rows);
      const t = readTotal(item.json);
      if (t != null) total = t;
    }

    // DOM backup when scroll did not yield swan-api payloads
    if (rows.length === 0) {
      try {
        const anchors = Array.from(
          document.querySelectorAll('a[href*="/jobs/info/"], a[href*="/jobs/detail/"]')
        );
        const seen = new Set();
        for (const a of anchors) {
          const href = String(a.href || '');
          const m = href.match(/\/jobs\/(?:info|detail)\/([^/?#]+)/i);
          if (!m) continue;
          const jobId = decodeURIComponent(m[1]);
          if (!jobId || seen.has(jobId)) continue;
          seen.add(jobId);
          let card = a.closest(
            'article, li, [class*="Job"], [class*="job"], [class*="card"], [class*="Card"]'
          );
          if (!card) card = a.parentElement;
          const lines = String((card || a).innerText || a.textContent || '')
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .filter((s) => !/^(easy apply|applied|save|saved|new|hot)$/i.test(s));
          const title = lines[0] || String(a.textContent || '').trim() || `Job ${jobId}`;
          const company = lines[1] && lines[1] !== title ? lines[1] : '';
          rows.push({
            jobId,
            jobTitle: title,
            companyName: company,
            applyLink: href.startsWith('http') ? href : `https://jobright.ai/jobs/info/${jobId}`,
          });
        }
      } catch (_) {
        /* ignore */
      }
    }

    return {
      ok: rows.length > 0,
      rows,
      total,
      sortCondition,
      captured: captured.length,
      via: rows.length && captured.length === 0 ? 'dom-after-scroll' : 'scroll-capture',
      error: rows.length ? null : 'No new Jobright payloads after scroll',
    };
  }

  function summarizeSearch(search) {
    const normalized = normalizeSearch(search);
    const parts = [normalized.titleKeyword];
    if (normalized.location) parts.push(normalized.location);
    if (normalized.params) {
      const ignored = new Set([
        'value',
        'titleKeyword',
        'keyword',
        'q',
        'location',
        'country',
        'position',
        'count',
        'page',
        'refresh',
        'visit',
        'searchType',
        'jobTaxonomyList',
        'sortCondition',
      ]);
      const filterCount = Object.keys(normalized.params).filter((k) => !ignored.has(k)).length;
      if (filterCount > 0) parts.push(`${filterCount} filters`);
    }
    return parts.join(' · ');
  }

  /**
   * Parse a Jobright search URL into { titleKeyword, location, params? }.
   * Supports legacy titleKeyword/location and current value/country (+ filters).
   * @returns {{ ok: true, search: object, sourceUrl: string } | { ok: false, error: string }}
   */
  function parseSearchFromInput(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) {
      return {
        ok: false,
        error: 'Paste a Jobright search URL (jobs/search?value=… or titleKeyword=…).',
      };
    }

    try {
      let url;
      if (/^https?:\/\//i.test(raw)) {
        url = new URL(raw);
      } else if (
        raw.includes('titleKeyword=') ||
        raw.includes('value=') ||
        raw.includes('/jobs/search')
      ) {
        url = new URL(raw.startsWith('/') ? raw : `/${raw}`, JOBRIGHT_SITE);
      } else {
        return {
          ok: false,
          error:
            'Paste a full Jobright search URL, e.g. https://jobright.ai/jobs/search?value=Software+Engineer&country=US',
        };
      }

      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host && host !== 'jobright.ai' && !host.endsWith('.jobright.ai')) {
        return { ok: false, error: 'URL must be from jobright.ai.' };
      }

      // Challenge redirect: recover original search from return=
      if (/\/_jr\/security\/challenge/i.test(url.pathname)) {
        const ret = url.searchParams.get('return') || '';
        if (ret) {
          try {
            const decoded = decodeURIComponent(ret);
            return parseSearchFromInput(
              decoded.startsWith('http') ? decoded : `${JOBRIGHT_SITE}${decoded}`
            );
          } catch (_) {
            /* fall through */
          }
        }
      }

      if (/\/jobs\/recommend\/?$/i.test(url.pathname) && ![...url.searchParams.keys()].length) {
        return {
          ok: false,
          error:
            'Recommended feed URLs cannot be imported. Open Jobs → Search, apply filters, then copy that URL.',
        };
      }

      const params = {};
      url.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const titleKeyword =
        url.searchParams.get('titleKeyword') ||
        url.searchParams.get('value') ||
        url.searchParams.get('keyword') ||
        url.searchParams.get('q') ||
        taxonomyTitleFromParams(url) ||
        '';
      const location =
        url.searchParams.get('location') ||
        mapCountryToLocation(url.searchParams.get('country')) ||
        '';

      if (!titleKeyword.trim()) {
        return {
          ok: false,
          error:
            'No search keyword found in that URL (need value= or titleKeyword=). Search on Jobright, then copy the address bar URL.',
        };
      }

      return {
        ok: true,
        search: normalizeSearch({
          titleKeyword,
          location,
          params: Object.keys(params).length ? params : null,
        }),
        sourceUrl: url.toString(),
      };
    } catch (_) {
      return { ok: false, error: 'Could not parse that URL.' };
    }
  }

  function parseRelativePublishDesc(desc, nowMs = Date.now()) {
    const s = String(desc || '')
      .trim()
      .toLowerCase();
    if (!s) return null;
    if (/just now|moments? ago|today|a few seconds/.test(s)) {
      return new Date(nowMs).toISOString();
    }

    let amount;
    let unit;
    let match = s.match(
      /(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|mos?|years?|yrs?)\s*ago/
    );
    if (match) {
      amount = Number(match[1]);
      unit = match[2];
    } else {
      // Compact forms like "2h ago" / "3d ago" (avoid bare "m" — minutes vs months).
      match = s.match(/(\d+)\s*(h|d|w)\s*ago/);
      if (!match) return null;
      amount = Number(match[1]);
      unit = match[2];
    }

    if (!Number.isFinite(amount) || amount < 0) return null;

    let ms = 0;
    if (/^min/.test(unit)) ms = amount * 60 * 1000;
    else if (/^h/.test(unit)) ms = amount * 60 * 60 * 1000;
    else if (/^d/.test(unit)) ms = amount * 24 * 60 * 60 * 1000;
    else if (/^w/.test(unit)) ms = amount * 7 * 24 * 60 * 60 * 1000;
    else if (/^mo/.test(unit)) ms = amount * 30 * 24 * 60 * 60 * 1000;
    else if (/^y/.test(unit)) ms = amount * 365 * 24 * 60 * 60 * 1000;
    else return null;

    return new Date(nowMs - ms).toISOString();
  }

  function parsePublishDate(jr, nowMs = Date.now()) {
    const raw =
      jr?.publishTime ??
      jr?.publishedAt ??
      jr?.publishTimestamp ??
      jr?.postedAt ??
      jr?.createTime;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const ms = raw < 1e12 ? raw * 1000 : raw;
      return new Date(ms).toISOString();
    }
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
      const n = Number(raw.trim());
      const ms = n < 1e12 ? n * 1000 : n;
      return new Date(ms).toISOString();
    }
    if (typeof raw === 'string' && raw.trim() && !Number.isNaN(Date.parse(raw))) {
      return new Date(raw).toISOString();
    }
    const relative = parseRelativePublishDesc(jr?.publishTimeDesc || jr?.posted, nowMs);
    if (relative) return relative;
    // Keep undated Jobright hits in the pool — date filter would otherwise drop all.
    return new Date(nowMs).toISOString();
  }

  /** Local display: 2026-09-18 21:34 */
  function formatPostedAtLocal(value) {
    if (value == null || value === '') return '';
    const raw = String(value).trim();
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

  function extractJobFields(raw) {
    const jr =
      raw?.jobResult && typeof raw.jobResult === 'object' ? raw.jobResult : raw || {};
    const cr =
      raw?.companyResult && typeof raw.companyResult === 'object' ? raw.companyResult : {};
    const jobId = serializeField(jr.jobId || jr.id || raw?.jobId);
    const applyUrl =
      serializeField(jr.applyLink || jr.applyUrl || jr.applicationUrl) ||
      (jobId ? `${JOBRIGHT_SITE}/jobs/info/${jobId}` : null);
    const publishedIso = parsePublishDate(jr);

    return {
      id: jobId,
      apply_url: applyUrl,
      posted_at: formatPostedAtLocal(publishedIso),
      title: serializeField(jr.jobTitle || jr.title),
      company_name:
        serializeField(cr.companyName) ||
        serializeField(jr.companyName) ||
        serializeField(raw?.companyName),
      application_site: detectPlatform(applyUrl),
      // ISO for shared date-window filtering in the panel.
      estimated_publish_date: publishedIso,
      source: 'jobright',
    };
  }

  function postedAtSortKey(job) {
    const raw = job?.estimated_publish_date || job?.posted_at || '';
    const ms = Date.parse(String(raw));
    return Number.isFinite(ms) ? ms : 0;
  }

  function companyKey(job) {
    return String(job?.company_name || '')
      .trim()
      .toLowerCase();
  }

  /**
   * Bid order: application_site Z→A, then company_name A→Z (same company adjacent),
   * then newest posted_at first. Does not drop same-company duplicates.
   */
  function sortJobsForCsv(jobs) {
    return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
      const atsA = String(a?.application_site || '').toLowerCase();
      const atsB = String(b?.application_site || '').toLowerCase();
      if (atsA !== atsB) return atsB.localeCompare(atsA); // Z → A
      const coA = companyKey(a);
      const coB = companyKey(b);
      if (coA !== coB) return coA.localeCompare(coB); // A → Z
      return postedAtSortKey(b) - postedAtSortKey(a); // newest first
    });
  }

  /** Jobright CSV matching the bid spreadsheet layout. */
  function jobsToCsv(jobs) {
    // Display headers (order matches the manual bid table).
    const headers = [
      'Application Link',
      'Date Posted',
      'Job Title',
      'Company',
      'Source Platform',
    ];
    const escape = (value) => {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const sorted = sortJobsForCsv(jobs);
    const rows = sorted.map((job) =>
      [
        job?.apply_url ?? '',
        formatPostedAtLocal(job?.posted_at || job?.estimated_publish_date || ''),
        job?.title ?? '',
        job?.company_name ?? '',
        job?.application_site ?? '',
      ]
        .map(escape)
        .join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * SpreadsheetML (.xls) with styled header row.
   * CSV cannot set font color/size; open this in Excel / Google Sheets.
   */
  function jobsToExcelXml(jobs) {
    const headers = [
      'Application Link',
      'Date Posted',
      'Job Title',
      'Company',
      'Source Platform',
    ];
    const sorted = sortJobsForCsv(jobs);
    const headerCells = headers
      .map(
        (h) =>
          `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`
      )
      .join('');
    const dataRows = sorted
      .map((job) => {
        const values = [
          job?.apply_url ?? '',
          formatPostedAtLocal(job?.posted_at || job?.estimated_publish_date || ''),
          job?.title ?? '',
          job?.company_name ?? '',
          job?.application_site ?? '',
        ];
        const cells = values
          .map(
            (v) =>
              `<Cell><Data ss:Type="String">${escapeXml(v)}</Data></Cell>`
          )
          .join('');
        return `<Row>${cells}</Row>`;
      })
      .join('');

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="14" ss:FontName="Calibri"/>
   <Interior ss:Color="#1B4F72" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Jobs">
  <Table>
   <Column ss:Width="280"/>
   <Column ss:Width="110"/>
   <Column ss:Width="220"/>
   <Column ss:Width="120"/>
   <Column ss:Width="120"/>
   <Row ss:StyleID="Header">${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
  }

  /** Injected into the Jobright tab — keep self-contained. */
  function extractPagePropsInTab() {
    const url = location.href || '';
    const title = document.title || '';
    const bodyText = document.body?.innerText?.slice(0, 2500) || '';
    const htmlHead = document.documentElement?.innerHTML?.slice(0, 12000) || '';

    const challenge =
      /\/_jr\/security\/challenge/i.test(url) ||
      /security check/i.test(title) ||
      /one quick security check/i.test(bodyText) ||
      /cf-browser-verification|challenge-platform|turnstile|challenges\.cloudflare\.com/i.test(
        htmlHead
      );

    const needsLogin =
      /\/sign-?in|\/login|\/auth/i.test(url) ||
      (/sign in|log in|create account/i.test(title) && !/jobs\/search/i.test(url));

    const el = document.querySelector('script#__NEXT_DATA__');
    if (!el?.textContent) {
      return { ok: false, challenge, needsLogin, title, url };
    }

    try {
      const data = JSON.parse(el.textContent);
      const pageProps = data?.props?.pageProps || {};
      let jobList = Array.isArray(pageProps.jobList)
        ? pageProps.jobList
        : Array.isArray(pageProps.jobs)
          ? pageProps.jobs
          : Array.isArray(pageProps?.result?.jobList)
            ? pageProps.result.jobList
            : Array.isArray(pageProps?.dehydratedState)
              ? []
              : [];

      // Deep walk: Jobright sometimes nests the list under arbitrary keys.
      if (!jobList.length) {
        const found = [];
        const walk = (node, depth) => {
          if (!node || depth > 6) return;
          if (Array.isArray(node)) {
            if (
              node.length &&
              node.some(
                (item) =>
                  item &&
                  typeof item === 'object' &&
                  (item.jobResult || item.jobTitle || item.jobId || item.applyLink)
              )
            ) {
              found.push(...node);
            } else {
              for (const item of node) walk(item, depth + 1);
            }
            return;
          }
          if (typeof node === 'object') {
            for (const key of Object.keys(node)) walk(node[key], depth + 1);
          }
        };
        walk(pageProps, 0);
        if (found.length) jobList = found;
      }

      const totalJobs =
        typeof pageProps.totalJobs === 'number'
          ? pageProps.totalJobs
          : typeof pageProps.total === 'number'
            ? pageProps.total
            : typeof pageProps?.result?.totalJobs === 'number'
              ? pageProps.result.totalJobs
              : null;

      // Still on challenge shell even if NEXT_DATA exists.
      if (challenge && jobList.length === 0) {
        return { ok: false, challenge: true, needsLogin, title, url };
      }

      if (!Array.isArray(jobList)) {
        return {
          ok: false,
          challenge: false,
          needsLogin,
          title,
          url,
          missingJobList: true,
        };
      }

      return {
        ok: true,
        url,
        pageProps: {
          jobList,
          totalJobs,
          // First SSR chunk is never "last" solely because length < total —
          // multi-page continues via swan-api. Only empty list means stop.
          isLastPage: jobList.length === 0,
        },
      };
    } catch (err) {
      return {
        ok: false,
        challenge,
        needsLogin,
        title,
        url,
        error: err?.message || String(err),
      };
    }
  }

  global.SmartJobJobrightScraper = {
    JOBRIGHT_SITE,
    JOBRIGHT_RECOMMEND,
    SWAN_API,
    PAGE_SIZE,
    DEFAULT_SEARCH,
    cloneDefaultSearch,
    normalizeSearch,
    buildJobrightSearchUrl,
    buildSwanApiCandidateUrls,
    buildRecommendApiUrls,
    collectJobRowsFromPayload,
    extractTotalFromPayload,
    fetchSearchApiPageExtension,
    fetchSearchApiPageInTab,
    fetchRecommendApiPageExtension,
    fetchRecommendApiPageInTab,
    ensureMostRecentSort,
    readCapturedRecommendSort,
    installSwanCaptureInTab,
    forceRecommendRefetchInTab,
    extractDomRecommendJobsInTab,
    drainSwanCaptureInTab,
    harvestMoreJobsInTab,
    summarizeSearch,
    parseSearchFromInput,
    parsePublishDate,
    formatPostedAtLocal,
    parseRelativePublishDesc,
    extractJobFields,
    jobsToCsv,
    jobsToExcelXml,
    detectPlatform,
    extractPagePropsInTab,
  };
})(typeof window !== 'undefined' ? window : self);
