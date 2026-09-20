/**
 * Jobright.ai search scrape helpers for the extension (browser-side).
 * Opens a real Jobright search tab, reads __NEXT_DATA__.jobList, maps to ScrapedJob.
 */
(function (global) {
  const JOBRIGHT_SITE = 'https://jobright.ai';
  const SWAN_API = 'https://swan-api.jobright.ai';
  /** Jobright search list page size (SSR + swan-api). */
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

  /** Injected (MAIN): patch fetch/XHR to capture swan-api JSON the SPA loads. */
  function installSwanCaptureInTab() {
    if (window.__jobstrikeSwanInstalled) {
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
   * Injected (MAIN): scroll / load-more to trigger SPA pagination; return new rows.
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

    window.__jobstrikeSwanCapture = window.__jobstrikeSwanCapture || [];
    const beforeLen = window.__jobstrikeSwanCapture.length;
    const rounds = Math.max(1, Math.min(Number(scrollRounds) || 3, 8));

    for (let i = 0; i < rounds; i += 1) {
      window.scrollBy(0, Math.max(window.innerHeight, 800) * 1.5);
      await new Promise((r) => setTimeout(r, 850));
    }

    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const loadMore = buttons.find((el) =>
      /load\s*more|show\s*more|see\s*more|next\s*page/i.test((el.textContent || '').trim())
    );
    if (loadMore) {
      try {
        loadMore.click();
      } catch (_) {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 1200));
    }

    await new Promise((r) => setTimeout(r, 600));

    const captured = window.__jobstrikeSwanCapture.slice(beforeLen);
    const rows = [];
    let total = null;
    for (const item of captured) {
      collect(item.json, rows);
      const t = readTotal(item.json);
      if (t != null) total = t;
    }

    return {
      ok: rows.length > 0,
      rows,
      total,
      captured: captured.length,
      via: 'scroll-capture',
      error: rows.length ? null : 'No new Jobright API payloads after scroll',
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

  function extractJobFields(raw) {
    const jr =
      raw?.jobResult && typeof raw.jobResult === 'object' ? raw.jobResult : raw || {};
    const cr =
      raw?.companyResult && typeof raw.companyResult === 'object' ? raw.companyResult : {};
    const jobId = serializeField(jr.jobId || jr.id || raw?.jobId);
    const applyUrl =
      serializeField(jr.applyLink || jr.applyUrl || jr.applicationUrl) ||
      (jobId ? `${JOBRIGHT_SITE}/jobs/info/${jobId}` : null);

    const requirements =
      joinList(jr.requirements) ||
      serializeField(jr.jobSummary) ||
      serializeField(jr.jobDescription);
    const tools = joinList(jr.skillSummaries || jr.skills || jr.technicalSkills);
    const activities = joinList(jr.coreResponsibilities || jr.responsibilities);

    return {
      id: jobId,
      apply_url: applyUrl,
      title: serializeField(jr.jobTitle || jr.title),
      core_job_title: serializeField(jr.jobTitle || jr.title),
      requirements_summary: requirements,
      technical_tools: tools,
      job_category: serializeField(jr.jobSeniority || jr.jobCategory || jr.department),
      estimated_publish_date: parsePublishDate(jr),
      role_activities: activities,
      company_name:
        serializeField(cr.companyName) ||
        serializeField(jr.companyName) ||
        serializeField(raw?.companyName),
      company_tagline:
        serializeField(cr.companyTagline) ||
        serializeField(cr.tagline) ||
        serializeField(jr.workModel),
      application_site: detectPlatform(applyUrl),
      source: 'jobright',
    };
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
    SWAN_API,
    PAGE_SIZE,
    DEFAULT_SEARCH,
    cloneDefaultSearch,
    normalizeSearch,
    buildJobrightSearchUrl,
    buildSwanApiCandidateUrls,
    collectJobRowsFromPayload,
    extractTotalFromPayload,
    fetchSearchApiPageExtension,
    fetchSearchApiPageInTab,
    installSwanCaptureInTab,
    harvestMoreJobsInTab,
    summarizeSearch,
    parseSearchFromInput,
    parsePublishDate,
    parseRelativePublishDesc,
    extractJobFields,
    detectPlatform,
    extractPagePropsInTab,
  };
})(typeof window !== 'undefined' ? window : self);
