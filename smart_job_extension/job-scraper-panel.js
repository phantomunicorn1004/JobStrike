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
    customSearchState: null,
    customSearchSourceUrl: '',
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

  async function loadState() {
    const result = await storageGet([
      STORAGE.prefs,
      STORAGE.blockedCompanies,
      STORAGE.blockedAts,
      STORAGE.blockedJobs,
      STORAGE.lastResults,
      STORAGE.customSearch,
    ]);

    state.prefs = { ...DEFAULT_PREFS, ...(result[STORAGE.prefs] || {}) };
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
    if (stats.removedRegisteredJobs) bits.push(`${stats.removedRegisteredJobs} reg. jobs`);
    if (stats.removedRegisteredCompanies) {
      bits.push(`${stats.removedRegisteredCompanies} reg. cos`);
    }
    return bits.length ? `Hidden: ${bits.join(' · ')}` : 'No matches hidden by lists';
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
      blockedCompanies: blockedCompanyNames(),
      blockedAts: blockedAtsNames(),
      blockedJobs: blockedJobRefs(),
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

  function setProgress(options = {}) {
    const {
      text = '',
      detail = '',
      kind = 'info',
      current = null,
      total = null,
      indeterminate = false,
      hidden = false,
    } = options;

    state.status = text || '';
    const section = document.getElementById('jsProgressSection');
    const root = document.getElementById('jsProgress');
    const label = document.getElementById('jsProgressLabel');
    const pctEl = document.getElementById('jsProgressPct');
    const bar = document.getElementById('jsProgressBar');
    const detailEl = document.getElementById('jsProgressDetail');
    if (!root || !label || !bar) return;

    const clean = (value) => String(value || '').replace(/\u2014|\u2013/g, '-');

    if (hidden || !text) {
      if (section) section.hidden = true;
      root.hidden = true;
      root.dataset.kind = 'info';
      root.classList.remove('is-indeterminate');
      bar.style.width = '0%';
      if (pctEl) {
        pctEl.hidden = true;
        pctEl.textContent = '';
      }
      if (detailEl) {
        detailEl.hidden = true;
        detailEl.textContent = '';
      }
      return;
    }

    if (section) section.hidden = false;
    root.hidden = false;
    root.dataset.kind = kind || 'info';
    label.textContent = clean(text);

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
      root.classList.add('is-indeterminate');
      bar.style.width = '35%';
      if (pctEl) {
        pctEl.hidden = true;
        pctEl.textContent = '';
      }
      return;
    }

    root.classList.remove('is-indeterminate');
    const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
    bar.style.width = `${pct}%`;
    if (pctEl) {
      pctEl.hidden = false;
      pctEl.textContent = `${pct}%`;
    }
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

    renderSearchImportUi();

    const hint = document.getElementById('jsProfileHint');
    if (hint) {
      if (!state.candidates.length && !state.profileLoading) {
        hint.textContent =
          'Sign in under Settings, then Refresh to load website block lists and profiles.';
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

  function renderSearchImportUi() {
    const scraper = api();
    const summaryEl = document.getElementById('jsSearchSummary');
    const sourceEl = document.getElementById('jsSearchSource');
    const panel = document.getElementById('jsSearchImportPanel');
    const resetBtn = document.getElementById('jsResetSearchBtn');
    const badge = document.getElementById('jsSearchCustomBadge');
    const searchCard = document.querySelector('.js-section-search');

    const summary = state.customSearchState
      ? scraper?.summarizeSearchState?.(state.customSearchState) || 'Custom search imported'
      : 'Built-in default';

    if (summaryEl) {
      summaryEl.textContent = summary;
      summaryEl.title = summary;
    }
    if (panel) panel.classList.toggle('is-custom', Boolean(state.customSearchState));
    if (searchCard) searchCard.classList.toggle('is-custom', Boolean(state.customSearchState));
    if (badge) badge.hidden = !state.customSearchState;
    if (resetBtn) resetBtn.disabled = !state.customSearchState;

    if (sourceEl) {
      if (state.customSearchSourceUrl) {
        sourceEl.hidden = false;
        sourceEl.textContent = `Source: ${state.customSearchSourceUrl}`;
        sourceEl.title = state.customSearchSourceUrl;
      } else if (state.customSearchState) {
        sourceEl.hidden = false;
        sourceEl.textContent = 'Source: pasted searchState JSON';
      } else {
        sourceEl.hidden = true;
        sourceEl.textContent = '';
      }
    }
  }

  async function applyImportedSearch(searchState, sourceUrl) {
    const scraper = api();
    state.customSearchState = searchState;
    state.customSearchSourceUrl = sourceUrl || '';

    if (searchState?.dateFetchedPastNDays != null && scraper?.dateWindowFromDays) {
      state.prefs.dateWindow = scraper.dateWindowFromDays(searchState.dateFetchedPastNDays);
    }

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
    meta.textContent = parts.join(' · ') || 'Set search and filters, then Scrape.';
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
        .map((item, i) => {
          const name = blockedCompanyName(item);
          const id = blockedRecordId(item);
          return (
            `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="company" data-index="${i}" data-id="${escapeHtml(id)}">Remove</button></li>`
          );
        })
        .join('');
    }
    if (atsUl) {
      atsUl.innerHTML = state.blockedAts
        .map((item, i) => {
          const name = blockedAtsName(item);
          const id = blockedRecordId(item);
          return (
            `<li><span title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<button type="button" class="btn small js-unblock" data-kind="ats" data-index="${i}" data-id="${escapeHtml(id)}">Remove</button></li>`
          );
        })
        .join('');
    }
    if (jobUl) {
      jobUl.innerHTML = state.blockedJobs
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

  function renderResults() {
    const empty = document.getElementById('jsResultsEmpty');
    const list = document.getElementById('jsResultsList');
    if (list) {
      list.innerHTML = '';
      list.hidden = true;
    }

    if (empty) {
      if (state.filteredJobs.length === 0) {
        empty.hidden = false;
        empty.textContent = state.rawJobs.length
          ? '0 jobs after filters. Adjust date or unblock lists.'
          : 'Click Scrape to load HiringCafe jobs.';
      } else {
        empty.hidden = true;
      }
    }

    updateActionButtons();
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
        scope.textContent = `${state.filteredJobs.length} jobs ready`;
      } else if (state.rawJobs.length) {
        scope.textContent = '0 jobs after filters';
      } else {
        scope.textContent = 'No results yet';
      }
    }

    const sub = document.getElementById('jsResultsSub');
    if (sub) {
      const bits = [];
      if (state.stats?.scraped != null) bits.push(`${state.stats.scraped} scraped`);
      if (state.stats?.removedByDate) bits.push(`${state.stats.removedByDate} by date`);
      if (state.stats?.removedBlockedJobs) {
        bits.push(`${state.stats.removedBlockedJobs} blocked jobs`);
      }
      if (state.stats?.removedBlockedCompanies) {
        bits.push(`${state.stats.removedBlockedCompanies} blocked cos`);
      }
      if (state.stats?.removedAts) bits.push(`${state.stats.removedAts} blocked ATS`);
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
        setProgress({
          text: 'Browser check required',
          detail: 'Complete it in the open HiringCafe tab, then click Resume.',
          kind: 'warn',
          indeterminate: true,
        });
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

    // Refresh website/Resume DB hide lists before filtering scrape results.
    await loadProfileFilterContext({ silent: true });

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

        setProgress({
          text: `Page ${page + 1} of ${maxPages}`,
          detail: `Collected ${jobs.length}${reportedTotal != null ? ` / ${reportedTotal}` : ''} so far`,
          kind: 'info',
          current: page,
          total: maxPages,
        });
        const url = scraper.buildHiringCafeUrl(
          dateWindow,
          page,
          state.customSearchState
        );
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

        setProgress({
          text: `Page ${page + 1} of ${maxPages}`,
          detail:
            `${hits.length} hits this page · collected ${jobs.length}` +
            (reportedTotal != null ? ` / ${reportedTotal}` : ''),
          kind: 'info',
          current: page + 1,
          total: maxPages,
        });

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
      const removalDetail = formatFilterRemovalDetail(state.stats);
      setProgress({
        text: `Done · ${state.filteredJobs.length} jobs ready`,
        detail:
          `${jobs.length} scraped` +
          (pagesFetched ? ` · ${pagesFetched} pages` : '') +
          (reportedTotal != null ? ` · HiringCafe total ${reportedTotal}` : '') +
          (removalDetail ? ` · ${removalDetail}` : ''),
        kind: 'success',
        current: 1,
        total: 1,
      });
      showToast(
        `Scraped ${jobs.length} · ${state.filteredJobs.length} after filters.` +
          (removalDetail ? ` ${removalDetail}` : ''),
        'success'
      );
    } catch (err) {
      const message = err?.message || String(err);
      setProgress({ text: 'Scrape failed', detail: message, kind: 'error', indeterminate: true });
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
        }
      );
      const data = await res.json().catch(() => ({}));
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

      await persistPrefs();
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
      if (state.customSearchState) {
        renderSearchImportUi();
      }
      if (state.rawJobs.length) {
        recomputeFiltered();
        await persistResults();
        renderResults();
        renderMeta();
      }
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
      setProgress({ text: 'Scrape stopped', detail: 'Partial results were kept if any pages finished.', kind: 'warn', indeterminate: true });
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
      setProgress({ hidden: true });
      syncControlsFromState();
    });

    document.getElementById('jsCsvBtn')?.addEventListener('click', () => {
      const jobs = actionJobs();
      if (!jobs.length) return;
      const csv = api().jobsToCsv(jobs);
      downloadTextFile(
        csv,
        'hiringcafe-jobs.csv',
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
        'hiringcafe-links.txt',
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
      await removeBlockedItem(kind, String(btn.dataset.id || '').trim());
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
