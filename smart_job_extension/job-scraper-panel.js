/**
 * Job Scraper tab — HiringCafe scrape in a real browser tab + local filters/export.
 */
(function () {
  const STORAGE = {
    prefs: 'job_scraper_prefs',
    blockedCompanies: 'job_scraper_blocked_companies',
    blockedAts: 'job_scraper_blocked_ats',
    blockedJobs: 'job_scraper_blocked_jobs',
    lastResults: 'job_scraper_last_results',
    scrapeTabId: 'job_scraper_tab_id',
  };

  const DEFAULT_PREFS = {
    dateWindow: '3d',
    excludeBlockedCompanies: true,
    excludeBlockedAts: true,
    excludeBlockedJobs: true,
    excludeRegisteredJobs: true,
    excludeRegisteredCompanies: true,
    candidateFilter: '',
    maxPages: 8,
    delayMs: 700,
  };

  const state = {
    prefs: { ...DEFAULT_PREFS },
    blockedCompanies: [],
    blockedAts: [],
    blockedJobs: [],
    candidates: [],
    registeredCompanies: [],
    registeredJobs: [],
    profileLoading: false,
    rawJobs: [],
    filteredJobs: [],
    selectedKeys: new Set(),
    scraping: false,
    pausedForChallenge: false,
    scrapeCursor: null,
    status: '',
    lastScrapedAt: null,
    stats: null,
  };

  function api() {
    return window.SmartJobHiringCafeScraper;
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

  function jobKey(job, index) {
    const urlApi = window.SmartJobJobUrl?.canonicalJobUrl;
    const urlKey = urlApi ? urlApi(job.apply_url) : String(job.apply_url || '');
    return urlKey || `idx:${index}:${job.title || ''}:${job.company_name || ''}`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
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

  async function loadState() {
    const result = await storageGet([
      STORAGE.prefs,
      STORAGE.blockedCompanies,
      STORAGE.blockedAts,
      STORAGE.blockedJobs,
      STORAGE.lastResults,
    ]);

    state.prefs = { ...DEFAULT_PREFS, ...(result[STORAGE.prefs] || {}) };
    state.blockedCompanies = Array.isArray(result[STORAGE.blockedCompanies])
      ? result[STORAGE.blockedCompanies]
      : [];
    state.blockedAts = Array.isArray(result[STORAGE.blockedAts])
      ? result[STORAGE.blockedAts]
      : [];
    state.blockedJobs = Array.isArray(result[STORAGE.blockedJobs])
      ? result[STORAGE.blockedJobs]
      : [];

    const last = result[STORAGE.lastResults];
    if (last && Array.isArray(last.jobs)) {
      state.rawJobs = last.rawJobs || last.jobs;
      state.lastScrapedAt = last.scrapedAt || null;
      state.stats = last.stats || null;
      recomputeFiltered();
    }
  }

  async function persistPrefs() {
    await storageSet({ [STORAGE.prefs]: state.prefs });
  }

  async function persistBlockLists() {
    await storageSet({
      [STORAGE.blockedCompanies]: state.blockedCompanies,
      [STORAGE.blockedAts]: state.blockedAts,
      [STORAGE.blockedJobs]: state.blockedJobs,
    });
  }

  async function persistResults() {
    await storageSet({
      [STORAGE.lastResults]: {
        jobs: state.filteredJobs,
        rawJobs: state.rawJobs,
        scrapedAt: state.lastScrapedAt,
        stats: state.stats,
      },
    });
  }

  function recomputeFiltered() {
    const scraper = api();
    if (!scraper) {
      state.filteredJobs = [...state.rawJobs];
      return;
    }

    const hasProfile = Boolean(state.prefs.candidateFilter);
    const deduped = scraper.dedupeJobs(state.rawJobs);
    const { filtered: dated, removedByDate } = scraper.filterJobsByPublishDate(
      deduped,
      state.prefs.dateWindow
    );
    const { filtered, stats } = scraper.applyLocalFilters(dated, {
      excludeBlockedCompanies: state.prefs.excludeBlockedCompanies,
      excludeBlockedAts: state.prefs.excludeBlockedAts,
      excludeBlockedJobs: state.prefs.excludeBlockedJobs,
      excludeRegisteredJobs: hasProfile && state.prefs.excludeRegisteredJobs,
      excludeRegisteredCompanies: hasProfile && state.prefs.excludeRegisteredCompanies,
      blockedCompanies: state.blockedCompanies,
      blockedAts: state.blockedAts,
      blockedJobs: state.blockedJobs,
      registeredJobs: state.registeredJobs,
      registeredCompanies: state.registeredCompanies,
    });

    state.filteredJobs = filtered;
    state.stats = {
      ...(state.stats || {}),
      scraped: state.rawJobs.length,
      deduped: deduped.length,
      removedByDate,
      removedBlockedJobs: stats.removedBlockedJobs,
      removedBlockedCompanies: stats.removedBlockedCompanies,
      removedAts: stats.removedAts,
      removedRegisteredJobs: stats.removedRegisteredJobs,
      removedRegisteredCompanies: stats.removedRegisteredCompanies,
      remaining: filtered.length,
      registeredJobCount: state.registeredJobs.length,
      registeredCompanyCount: state.registeredCompanies.length,
    };

    const validKeys = new Set(filtered.map((job, i) => jobKey(job, i)));
    state.selectedKeys = new Set([...state.selectedKeys].filter((k) => validKeys.has(k)));
  }

  function setStatus(text, kind) {
    state.status = text || '';
    const el = document.getElementById('jsStatus');
    if (!el) return;
    el.textContent = state.status;
    el.dataset.kind = kind || 'info';
    el.hidden = !state.status;
  }

  function syncControlsFromState() {
    const dateSel = document.getElementById('jsDateWindow');
    if (dateSel) dateSel.value = state.prefs.dateWindow;

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
        if (state.prefs.candidateFilter && !state.candidates.some((c) => c.key === state.prefs.candidateFilter)) {
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
    ];
    for (const [id, key] of map) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(state.prefs[key]);
    }

    const hasProfile = Boolean(state.prefs.candidateFilter);
    const regJobs = document.getElementById('jsFilterRegisteredJobs');
    const regCos = document.getElementById('jsFilterRegisteredCompanies');
    if (regJobs) regJobs.disabled = !hasProfile;
    if (regCos) regCos.disabled = !hasProfile;

    const jobCount = document.getElementById('jsRegisteredJobCount');
    const coCount = document.getElementById('jsRegisteredCompanyCount');
    if (jobCount) jobCount.textContent = String(state.registeredJobs.length);
    if (coCount) coCount.textContent = String(state.registeredCompanies.length);

    const hint = document.getElementById('jsProfileHint');
    if (hint) {
      if (!state.candidates.length && !state.profileLoading) {
        hint.textContent =
          'Sign in under Settings, then Refresh to load profiles for Resume DB filters.';
        hint.hidden = false;
      } else if (!hasProfile) {
        hint.textContent = 'Select a profile to hide registered jobs/companies for that profile.';
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }

    const refreshBtn = document.getElementById('jsRefreshProfileBtn');
    if (refreshBtn) refreshBtn.disabled = state.profileLoading;

    const resumeBtn = document.getElementById('jsResumeBtn');
    if (resumeBtn) resumeBtn.hidden = !state.pausedForChallenge;

    const scrapeBtn = document.getElementById('jsScrapeBtn');
    if (scrapeBtn) {
      scrapeBtn.disabled = state.scraping && !state.pausedForChallenge;
      scrapeBtn.classList.toggle('is-busy', state.scraping && !state.pausedForChallenge);
    }

    const stopBtn = document.getElementById('jsStopBtn');
    if (stopBtn) stopBtn.hidden = !state.scraping;

    renderBlockLists();
    renderResults();
    renderMeta();
  }

  function renderMeta() {
    const meta = document.getElementById('jsMeta');
    if (!meta) return;
    const parts = [];
    if (state.lastScrapedAt) {
      parts.push(`Last scrape ${new Date(state.lastScrapedAt).toLocaleString()}`);
    }
    if (state.stats) {
      parts.push(`${state.stats.remaining ?? state.filteredJobs.length} shown`);
      if (state.stats.scraped != null) parts.push(`${state.stats.scraped} scraped`);
      if (state.stats.removedRegisteredJobs) {
        parts.push(`${state.stats.removedRegisteredJobs} reg. jobs hidden`);
      }
      if (state.stats.removedRegisteredCompanies) {
        parts.push(`${state.stats.removedRegisteredCompanies} reg. cos hidden`);
      }
      if (state.stats.reportedTotal != null) {
        parts.push(`HiringCafe total ${state.stats.reportedTotal}`);
      }
    }
    const profileLabel = state.candidates.find((c) => c.key === state.prefs.candidateFilter)?.label;
    if (profileLabel) parts.push(`profile ${profileLabel}`);
    meta.textContent = parts.join(' · ') || 'Click Scrape to load HiringCafe jobs.';
  }

  function renderBlockLists() {
    const companyCount = document.getElementById('jsBlockedCompanyCount');
    const atsCount = document.getElementById('jsBlockedAtsCount');
    const jobCount = document.getElementById('jsBlockedJobCount');
    if (companyCount) companyCount.textContent = String(state.blockedCompanies.length);
    if (atsCount) atsCount.textContent = String(state.blockedAts.length);
    if (jobCount) jobCount.textContent = String(state.blockedJobs.length);

    const companyUl = document.getElementById('jsBlockedCompanyList');
    const atsUl = document.getElementById('jsBlockedAtsList');
    const jobUl = document.getElementById('jsBlockedJobList');

    if (companyUl) {
      companyUl.innerHTML = state.blockedCompanies
        .map(
          (name, i) =>
            `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="company" data-index="${i}">Remove</button></li>`
        )
        .join('');
    }
    if (atsUl) {
      atsUl.innerHTML = state.blockedAts
        .map(
          (name, i) =>
            `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="ats" data-index="${i}">Remove</button></li>`
        )
        .join('');
    }
    if (jobUl) {
      jobUl.innerHTML = state.blockedJobs
        .map((job, i) => {
          const label = [job.jobTitle, job.companyName].filter(Boolean).join(' · ') || job.jobLink;
          return (
            `<li><span title="${escapeHtml(job.jobLink || '')}">${escapeHtml(label)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="job" data-index="${i}">Remove</button></li>`
          );
        })
        .join('');
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function actionJobs() {
    if (state.selectedKeys.size === 0) return state.filteredJobs;
    return state.filteredJobs.filter((job, i) => state.selectedKeys.has(jobKey(job, i)));
  }

  function renderResults() {
    const list = document.getElementById('jsResultsList');
    const empty = document.getElementById('jsResultsEmpty');
    const selectAll = document.getElementById('jsSelectAll');
    if (!list) return;

    if (state.filteredJobs.length === 0) {
      list.innerHTML = '';
      if (empty) {
        empty.hidden = false;
        empty.textContent = state.rawJobs.length
          ? '0 jobs after filters. Adjust date or unblock lists.'
          : 'Click Scrape to load HiringCafe jobs.';
      }
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      updateActionButtons();
      return;
    }

    if (empty) empty.hidden = true;

    list.innerHTML = state.filteredJobs
      .map((job, index) => {
        const key = jobKey(job, index);
        const checked = state.selectedKeys.has(key) ? 'checked' : '';
        const title = escapeHtml(job.title || 'Untitled');
        const company = escapeHtml(job.company_name || 'Unknown company');
        const ats = escapeHtml(job.application_site || 'Unknown');
        const date = escapeHtml(formatDate(job.estimated_publish_date));
        const url = escapeHtml(job.apply_url || '');
        return `
          <article class="js-row" data-key="${escapeHtml(key)}" data-index="${index}">
            <label class="js-row-check">
              <input type="checkbox" class="js-row-select" data-key="${escapeHtml(key)}" ${checked}>
            </label>
            <div class="js-row-body">
              <div class="js-row-title">${title}</div>
              <div class="js-row-meta">
                <span>${company}</span>
                <span class="js-badge">${ats}</span>
                <span>${date}</span>
              </div>
              ${url ? `<a class="js-row-link muted" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` : ''}
            </div>
            <div class="js-row-actions">
              <button type="button" class="btn small" data-action="open" ${url ? '' : 'disabled'}>Open</button>
              <button type="button" class="btn small" data-action="block-job" ${url ? '' : 'disabled'}>Block job</button>
              <button type="button" class="btn small" data-action="block-company" ${job.company_name ? '' : 'disabled'}>Block co.</button>
            </div>
          </article>`;
      })
      .join('');

    if (selectAll) {
      const allSelected =
        state.filteredJobs.length > 0 &&
        state.filteredJobs.every((job, i) => state.selectedKeys.has(jobKey(job, i)));
      const someSelected = state.selectedKeys.size > 0 && !allSelected;
      selectAll.checked = allSelected;
      selectAll.indeterminate = someSelected;
    }

    updateActionButtons();
  }

  function updateActionButtons() {
    const jobs = actionJobs();
    const disabled = jobs.length === 0;
    ['jsCsvBtn', 'jsLinksBtn', 'jsCopyLinksBtn', 'jsClearResultsBtn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && id !== 'jsClearResultsBtn') el.disabled = disabled;
    });
    const clearBtn = document.getElementById('jsClearResultsBtn');
    if (clearBtn) clearBtn.disabled = state.rawJobs.length === 0 && state.filteredJobs.length === 0;

    const scope = document.getElementById('jsActionScope');
    if (scope) {
      scope.textContent =
        state.selectedKeys.size > 0
          ? `${state.selectedKeys.size} selected`
          : state.filteredJobs.length
            ? `all ${state.filteredJobs.length}`
            : '';
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
        reject(new Error('Timed out waiting for HiringCafe tab to load.'));
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

  async function ensureScrapeTab(url) {
    let tabId = await getStoredScrapeTabId();
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.id) {
          await chrome.tabs.update(tab.id, { url, active: false });
          await waitForTabComplete(tab.id);
          await sleep(400);
          return tab.id;
        }
      } catch (_) {
        await setStoredScrapeTabId(null);
      }
    }

    const created = await chrome.tabs.create({ url, active: true });
    if (!created?.id) throw new Error('Could not open HiringCafe tab.');
    await setStoredScrapeTabId(created.id);
    await waitForTabComplete(created.id);
    await sleep(500);
    return created.id;
  }

  async function extractFromTab(tabId) {
    const scraper = api();
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scraper.extractPagePropsInTab,
    });
    return result;
  }

  async function waitUntilPageReady(tabId, { allowPause = true } = {}) {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!state.scraping) throw new Error('Scrape stopped.');
      const extracted = await extractFromTab(tabId);
      if (extracted?.ok) return extracted;

      if (extracted?.challenge && allowPause) {
        state.pausedForChallenge = true;
        syncControlsFromState();
        setStatus(
          'HiringCafe browser check detected. Complete it in the open tab, then click Resume.',
          'warn'
        );
        showToast('Complete the HiringCafe check, then click Resume.', 'warn');
        return { paused: true };
      }

      await sleep(800 + attempt * 200);
    }

    return {
      ok: false,
      error: 'Could not read HiringCafe job data from the page.',
    };
  }

  async function runScrape({ resume = false } = {}) {
    const scraper = api();
    if (!scraper) {
      showToast('Scraper module failed to load. Reload the extension.', 'error');
      return;
    }

    if (state.scraping && !state.pausedForChallenge && !resume) return;

    state.scraping = true;
    state.pausedForChallenge = false;
    syncControlsFromState();

    const dateWindow = state.prefs.dateWindow;
    const maxPages = Math.max(1, Math.min(Number(state.prefs.maxPages) || 8, 20));
    const delayMs = Math.max(400, Math.min(Number(state.prefs.delayMs) || 700, 3000));

    let page = resume && state.scrapeCursor ? state.scrapeCursor.page : 0;
    let jobs = resume && state.scrapeCursor ? [...state.scrapeCursor.jobs] : [];
    let reportedTotal =
      resume && state.scrapeCursor ? state.scrapeCursor.reportedTotal : null;
    let lastHitId = resume && state.scrapeCursor ? state.scrapeCursor.lastHitId : '';
    let pagesFetched =
      resume && state.scrapeCursor ? state.scrapeCursor.pagesFetched : 0;

    try {
      for (; page < maxPages; page += 1) {
        if (!state.scraping) break;

        setStatus(`Fetching HiringCafe page ${page + 1}…`, 'info');
        const url = scraper.buildHiringCafeUrl(dateWindow, page);
        const tabId = await ensureScrapeTab(url);
        const extracted = await waitUntilPageReady(tabId);

        if (extracted?.paused) {
          state.scrapeCursor = {
            page,
            jobs,
            reportedTotal,
            lastHitId,
            pagesFetched,
          };
          state.pausedForChallenge = true;
          state.scraping = true;
          syncControlsFromState();
          return;
        }

        if (!extracted?.ok) {
          throw new Error(extracted?.error || 'HiringCafe page did not return job data.');
        }

        const hits = extracted.pageProps.ssrHits || [];
        reportedTotal = extracted.pageProps.ssrTotalCount ?? reportedTotal;

        if (hits.length === 0) break;

        const firstHitId = scraper.extractJobFields(hits[0]).id || '';
        if (page > 0 && firstHitId && firstHitId === lastHitId) break;
        lastHitId =
          scraper.extractJobFields(hits[hits.length - 1]).id || lastHitId;

        for (const hit of hits) {
          jobs.push(scraper.extractJobFields(hit));
        }
        pagesFetched += 1;

        setStatus(
          `Page ${page + 1}: ${hits.length} hits · collected ${jobs.length}` +
            (reportedTotal != null ? ` / ${reportedTotal}` : ''),
          'info'
        );

        if (extracted.pageProps.ssrIsLastPage) break;
        if (page < maxPages - 1) await sleep(delayMs);
      }

      state.rawJobs = jobs;
      state.lastScrapedAt = new Date().toISOString();
      state.stats = {
        pagesFetched,
        reportedTotal,
        scraped: jobs.length,
      };
      state.scrapeCursor = null;
      state.selectedKeys = new Set();
      recomputeFiltered();
      await persistResults();
      setStatus(
        `Done — ${state.filteredJobs.length} jobs after filters` +
          (pagesFetched ? ` (${pagesFetched} pages)` : ''),
        'success'
      );
      showToast(
        `Scraped ${jobs.length} jobs · ${state.filteredJobs.length} after filters.`,
        'success'
      );
    } catch (err) {
      const message = err?.message || String(err);
      setStatus(message, 'error');
      showToast(message, 'error');
      state.pausedForChallenge = false;
      state.scrapeCursor = null;
    } finally {
      if (!state.pausedForChallenge) {
        state.scraping = false;
      }
      syncControlsFromState();
    }
  }

  async function addBlockedCompany(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned) return;
    const matcher = window.SmartJobCompanyName?.companiesMatch;
    const exists = state.blockedCompanies.some((item) =>
      matcher ? matcher(item, cleaned) : item.toLowerCase() === cleaned.toLowerCase()
    );
    if (!exists) state.blockedCompanies.push(cleaned);
    await persistBlockLists();
    recomputeFiltered();
    await persistResults();
    syncControlsFromState();
  }

  async function addBlockedAts(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (!state.blockedAts.some((item) => item.toLowerCase() === key)) {
      state.blockedAts.push(cleaned);
    }
    await persistBlockLists();
    recomputeFiltered();
    await persistResults();
    syncControlsFromState();
  }

  async function addBlockedJob(job) {
    const jobLink = String(job?.apply_url || job?.jobLink || '').trim();
    if (!jobLink) return;
    const linksMatch = window.SmartJobJobUrl?.jobLinksMatch;
    const exists = state.blockedJobs.some((item) =>
      linksMatch ? linksMatch(item.jobLink, jobLink) : item.jobLink === jobLink
    );
    if (!exists) {
      state.blockedJobs.push({
        jobLink,
        jobTitle: job.title || job.jobTitle || '',
        companyName: job.company_name || job.companyName || '',
      });
    }
    await persistBlockLists();
    recomputeFiltered();
    await persistResults();
    syncControlsFromState();
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

  async function loadProfileFilterContext({ silent = false } = {}) {
    state.profileLoading = true;
    syncControlsFromState();

    try {
      const config = await getAuthConfig();
      if (!config?.extensionApiKey || !config?.baseUrl) {
        state.candidates = [];
        state.registeredJobs = [];
        state.registeredCompanies = [];
        if (!silent) {
          showToast('Sign in under Settings to use per-profile Resume DB filters.', 'warn');
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
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load profile filter lists.');
      }

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

      await persistPrefs();
      recomputeFiltered();
      await persistResults();
      if (!silent) {
        showToast(
          state.prefs.candidateFilter
            ? `Profile lists loaded (${state.registeredJobs.length} jobs, ${state.registeredCompanies.length} companies).`
            : `Loaded ${state.candidates.length} profile(s).`,
          'success'
        );
      }
    } catch (err) {
      if (!silent) showToast(err?.message || String(err), 'error');
    } finally {
      state.profileLoading = false;
      syncControlsFromState();
    }
  }

  function wireUi() {
    document.getElementById('jsDateWindow')?.addEventListener('change', async (event) => {
      state.prefs.dateWindow = event.target.value === '1d' || event.target.value === '7d'
        ? event.target.value
        : '3d';
      await persistPrefs();
      if (state.rawJobs.length) {
        recomputeFiltered();
        await persistResults();
        renderResults();
        renderMeta();
      }
    });

    [
      ['jsFilterBlockedCompanies', 'excludeBlockedCompanies'],
      ['jsFilterBlockedAts', 'excludeBlockedAts'],
      ['jsFilterBlockedJobs', 'excludeBlockedJobs'],
      ['jsFilterRegisteredJobs', 'excludeRegisteredJobs'],
      ['jsFilterRegisteredCompanies', 'excludeRegisteredCompanies'],
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

    document.getElementById('jsProfileFilter')?.addEventListener('change', async (event) => {
      state.prefs.candidateFilter = String(event.target.value || '').trim();
      await persistPrefs();
      await loadProfileFilterContext({ silent: true });
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
      state.scraping = false;
      state.pausedForChallenge = false;
      setStatus('Scrape stopped.', 'warn');
      syncControlsFromState();
    });

    document.getElementById('jsClearResultsBtn')?.addEventListener('click', async () => {
      state.rawJobs = [];
      state.filteredJobs = [];
      state.selectedKeys = new Set();
      state.stats = null;
      state.lastScrapedAt = null;
      state.scrapeCursor = null;
      await storageSet({ [STORAGE.lastResults]: null });
      setStatus('', 'info');
      syncControlsFromState();
    });

    document.getElementById('jsSelectAll')?.addEventListener('change', (event) => {
      if (event.target.checked) {
        state.selectedKeys = new Set(
          state.filteredJobs.map((job, i) => jobKey(job, i))
        );
      } else {
        state.selectedKeys = new Set();
      }
      renderResults();
    });

    document.getElementById('jsCsvBtn')?.addEventListener('click', () => {
      const jobs = actionJobs();
      if (!jobs.length) return;
      const csv = api().jobsToCsv(jobs);
      downloadTextFile(
        csv,
        state.selectedKeys.size ? 'hiringcafe-selected.csv' : 'hiringcafe-jobs.csv',
        'text/csv;charset=utf-8'
      );
      showToast(`CSV downloaded (${jobs.length}).`, 'success');
    });

    document.getElementById('jsLinksBtn')?.addEventListener('click', () => {
      const links = actionJobs()
        .map((job) => job.apply_url)
        .filter(Boolean);
      if (!links.length) {
        showToast('No links to download.', 'error');
        return;
      }
      downloadTextFile(
        links.join('\n'),
        state.selectedKeys.size ? 'hiringcafe-selected-links.txt' : 'hiringcafe-links.txt',
        'text/plain;charset=utf-8'
      );
      showToast(`Links file downloaded (${links.length}).`, 'success');
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

    document.getElementById('jsAddBlockedCompanyBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('jsAddBlockedCompany');
      await addBlockedCompany(input?.value);
      if (input) input.value = '';
    });
    document.getElementById('jsAddBlockedAtsBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('jsAddBlockedAts');
      await addBlockedAts(input?.value);
      if (input) input.value = '';
    });
    document.getElementById('jsAddBlockedJobBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('jsAddBlockedJob');
      await addBlockedJob({ apply_url: input?.value });
      if (input) input.value = '';
    });

    document.getElementById('jsListsPanel')?.addEventListener('click', async (event) => {
      const btn = event.target.closest('.js-unblock');
      if (!btn) return;
      const kind = btn.dataset.kind;
      const index = Number(btn.dataset.index);
      if (!Number.isFinite(index)) return;
      if (kind === 'company') state.blockedCompanies.splice(index, 1);
      if (kind === 'ats') state.blockedAts.splice(index, 1);
      if (kind === 'job') state.blockedJobs.splice(index, 1);
      await persistBlockLists();
      recomputeFiltered();
      await persistResults();
      syncControlsFromState();
    });

    document.getElementById('jsResultsList')?.addEventListener('change', (event) => {
      const input = event.target.closest('.js-row-select');
      if (!input) return;
      const key = input.dataset.key;
      if (!key) return;
      if (input.checked) state.selectedKeys.add(key);
      else state.selectedKeys.delete(key);
      updateActionButtons();
      const selectAll = document.getElementById('jsSelectAll');
      if (selectAll) {
        const allSelected =
          state.filteredJobs.length > 0 &&
          state.filteredJobs.every((job, i) => state.selectedKeys.has(jobKey(job, i)));
        selectAll.checked = allSelected;
        selectAll.indeterminate = state.selectedKeys.size > 0 && !allSelected;
      }
    });

    document.getElementById('jsResultsList')?.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('.js-row');
      const index = Number(row?.dataset.index);
      const job = state.filteredJobs[index];
      if (!job) return;
      const action = btn.dataset.action;
      if (action === 'open' && job.apply_url) {
        chrome.tabs.create({ url: job.apply_url, active: true });
        return;
      }
      if (action === 'block-job') {
        await addBlockedJob(job);
        showToast('Job blocked locally.', 'success');
        return;
      }
      if (action === 'block-company') {
        await addBlockedCompany(job.company_name);
        showToast('Company blocked locally.', 'success');
      }
    });
  }

  async function initJobScraperPanel() {
    if (!document.getElementById('tab-job-scraper')) return;
    await loadState();
    wireUi();
    syncControlsFromState();
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
