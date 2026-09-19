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
    jobrightSearch: 'job_scraper_jobright_search',
  };

  const DEFAULT_PREFS = {
    source: 'hiringcafe',
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

  const DEFAULT_JOBRIGHT_SEARCH = {
    titleKeyword: 'Software Engineer',
    location: 'United States',
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
    listsSyncedAt: null,
    listsSyncError: '',
    openListEditor: null,
    customSearchState: null,
    customSearchSourceUrl: '',
    jobrightSearch: { ...DEFAULT_JOBRIGHT_SEARCH },
    jobrightSearchSourceUrl: '',
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
    return state.prefs.source === 'jobright' ? 'jobright' : 'hiringcafe';
  }

  function sourceLabel(source = activeSource()) {
    return source === 'jobright' ? 'Jobright' : 'HiringCafe';
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
      STORAGE.jobrightSearch,
    ]);

    state.prefs = { ...DEFAULT_PREFS, ...(result[STORAGE.prefs] || {}) };
    if (state.prefs.source !== 'jobright') state.prefs.source = 'hiringcafe';

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

    const jrStored = result[STORAGE.jobrightSearch];
    if (jrStored && typeof jrStored === 'object') {
      state.jobrightSearch = {
        ...DEFAULT_JOBRIGHT_SEARCH,
        titleKeyword: String(jrStored.titleKeyword || DEFAULT_JOBRIGHT_SEARCH.titleKeyword),
        location: String(jrStored.location || DEFAULT_JOBRIGHT_SEARCH.location),
      };
      state.jobrightSearchSourceUrl = String(jrStored.sourceUrl || '');
    } else {
      state.jobrightSearch = { ...DEFAULT_JOBRIGHT_SEARCH };
      state.jobrightSearchSourceUrl = '';
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

  async function persistJobrightSearch() {
    await storageSet({
      [STORAGE.jobrightSearch]: {
        titleKeyword: state.jobrightSearch.titleKeyword,
        location: state.jobrightSearch.location,
        sourceUrl: state.jobrightSearchSourceUrl || '',
        updatedAt: new Date().toISOString(),
      },
    });
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

    renderSourceUi();
    renderActiveSearchUi();
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
      scrapeBtn.disabled = state.scraping && !state.pausedForChallenge;
      scrapeBtn.classList.toggle('is-busy', state.scraping && !state.pausedForChallenge);
    }

    const stopBtn = document.getElementById('jsStopBtn');
    if (stopBtn) stopBtn.hidden = !state.scraping;

    renderBlockLists();
    renderResults();
    renderMeta();
  }

  function renderSourceUi() {
    const source = activeSource();
    document.querySelectorAll('[data-js-source]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-js-source') === source);
    });
    syncImportModalPanels();
    const title = document.getElementById('jsScraperTitle');
    if (title) title.textContent = 'Job Scraper';
    const empty = document.getElementById('jsResultsEmpty');
    if (empty && !state.rawJobs.length && !state.filteredJobs.length) {
      empty.innerHTML = `Tap <strong>Scrape jobs</strong> to load ${sourceLabel(source)} listings.`;
    }
    renderActiveSearchUi();
  }

  function renderActiveSearchUi() {
    if (activeSource() === 'jobright') {
      renderJobrightSearchUi();
    } else {
      renderSearchImportUi();
    }
  }

  function renderSearchImportUi() {
    if (activeSource() !== 'hiringcafe') return;

    const scraper = api();
    const summaryEl = document.getElementById('jsSearchSummary');
    const previewLabel = document.getElementById('jsSearchPreviewLabel');
    const sourceEl = document.getElementById('jsSearchSource');
    const panel = document.getElementById('jsSearchImportPanel');
    const resetBtn = document.getElementById('jsResetSearchBtn');
    const badge = document.getElementById('jsSearchCustomBadge');
    const searchCard = document.getElementById('jsSearchCard');

    const summary = state.customSearchState
      ? scraper?.summarizeSearchState?.(state.customSearchState) || 'Custom search imported'
      : 'Built-in default';

    if (previewLabel) previewLabel.textContent = 'HiringCafe search';
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
        sourceEl.textContent = `From: ${state.customSearchSourceUrl}`;
        sourceEl.title = state.customSearchSourceUrl;
      } else if (state.customSearchState) {
        sourceEl.hidden = false;
        sourceEl.textContent = 'From: pasted searchState';
      } else {
        sourceEl.hidden = true;
        sourceEl.textContent = '';
      }
    }
  }

  function renderJobrightSearchUi() {
    if (activeSource() !== 'jobright') return;

    const jr = jrApi();
    const summaryEl = document.getElementById('jsSearchSummary');
    const previewLabel = document.getElementById('jsSearchPreviewLabel');
    const sourceEl = document.getElementById('jsSearchSource');
    const badge = document.getElementById('jsSearchCustomBadge');
    const searchCard = document.getElementById('jsSearchCard');
    const resetBtn = document.getElementById('jsJrResetSearchBtn');
    const panel = document.getElementById('jsJrSearchImportPanel');
    const isCustom =
      Boolean(state.jobrightSearchSourceUrl) ||
      state.jobrightSearch.titleKeyword !== DEFAULT_JOBRIGHT_SEARCH.titleKeyword ||
      state.jobrightSearch.location !== DEFAULT_JOBRIGHT_SEARCH.location;

    const summary = isCustom
      ? jr?.summarizeSearch?.(state.jobrightSearch) ||
        `${state.jobrightSearch.titleKeyword} · ${state.jobrightSearch.location}`
      : 'Built-in default';

    if (previewLabel) previewLabel.textContent = 'Jobright search';
    if (summaryEl) {
      summaryEl.textContent = summary;
      summaryEl.title = summary;
    }
    if (panel) panel.classList.toggle('is-custom', isCustom);
    if (badge) badge.hidden = !isCustom;
    if (searchCard) searchCard.classList.toggle('is-custom', isCustom);
    if (resetBtn) resetBtn.disabled = !isCustom;

    if (sourceEl) {
      if (state.jobrightSearchSourceUrl) {
        sourceEl.hidden = false;
        sourceEl.textContent = `From: ${state.jobrightSearchSourceUrl}`;
        sourceEl.title = state.jobrightSearchSourceUrl;
      } else {
        sourceEl.hidden = true;
        sourceEl.textContent = '';
      }
    }
  }

  async function setScrapeSource(nextSource) {
    const source = nextSource === 'jobright' ? 'jobright' : 'hiringcafe';
    if (state.prefs.source === source) return;
    if (state.scraping) {
      showToast('Stop the current scrape before switching source.', 'warn');
      return;
    }
    state.prefs.source = source;
    state.pausedForChallenge = false;
    state.scrapeCursor = null;
    await persistPrefs();
    syncControlsFromState();
  }

  async function applyJobrightSearch(search, sourceUrl) {
    const jr = jrApi();
    state.jobrightSearch = jr?.normalizeSearch?.(search) || {
      titleKeyword: String(search?.titleKeyword || DEFAULT_JOBRIGHT_SEARCH.titleKeyword),
      location: String(search?.location || DEFAULT_JOBRIGHT_SEARCH.location),
    };
    state.jobrightSearchSourceUrl = sourceUrl || '';
    await persistJobrightSearch();
    syncControlsFromState();
  }

  async function resetJobrightSearch() {
    state.jobrightSearch = { ...DEFAULT_JOBRIGHT_SEARCH };
    state.jobrightSearchSourceUrl = '';
    const input = document.getElementById('jsJrSearchUrlInput');
    if (input) input.value = '';
    await persistJobrightSearch();
    syncControlsFromState();
    showToast('Restored default Jobright search.', 'success');
  }

  async function importJobrightSearchFromText(raw, { silent = false } = {}) {
    const jr = jrApi();
    if (!jr?.parseSearchFromInput) {
      showToast('Jobright search import is unavailable. Reload the extension.', 'error');
      return false;
    }
    const parsed = jr.parseSearchFromInput(raw);
    if (!parsed.ok) {
      showToast(parsed.error, 'error');
      return false;
    }
    await applyJobrightSearch(parsed.search, parsed.sourceUrl);
    if (!silent) {
      showToast(`Jobright search imported. ${jr.summarizeSearch(parsed.search)}`, 'success');
    }
    return true;
  }

  async function importJobrightSearchFromActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    const url = tab?.url || '';
    if (!/jobright\.ai/i.test(url)) {
      showToast('Open a jobright.ai search tab first, then try From tab.', 'warn');
      return;
    }
    const input = document.getElementById('jsJrSearchUrlInput');
    if (input) input.value = url;
    await importJobrightSearchFromText(url);
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

    document.querySelectorAll('.js-hide-row').forEach((row) => {
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
        reject(new Error(`Timed out waiting for ${sourceLabel()} tab to load.`));
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
    if (!created?.id) throw new Error(`Could not open ${sourceLabel()} tab.`);
    await setStoredScrapeTabId(created.id);
    await waitForTabComplete(created.id);
    await sleep(500);
    return created.id;
  }

  /** Reuse an open Jobright tab without reloading (keeps session for swan-api). */
  async function ensureJobrightApiTab(fallbackUrl) {
    let tabId = await getStoredScrapeTabId();
    if (tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const href = String(tab?.url || '');
        if (
          tab?.id &&
          /jobright\.ai/i.test(href) &&
          !/\/_jr\/security\/challenge/i.test(href)
        ) {
          return tab.id;
        }
      } catch (_) {
        await setStoredScrapeTabId(null);
      }
    }
    return ensureScrapeTab(fallbackUrl);
  }

  async function extractFromTab(tabId) {
    const extractFn =
      activeSource() === 'jobright'
        ? jrApi()?.extractPagePropsInTab
        : api()?.extractPagePropsInTab;
    if (typeof extractFn !== 'function') {
      return { ok: false, error: `${sourceLabel()} scraper module failed to load.` };
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractFn,
    });
    return result;
  }

  async function waitUntilPageReady(tabId, { allowPause = true } = {}) {
    const label = sourceLabel();
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!state.scraping) throw new Error('Scrape stopped.');
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

  async function runHiringCafeScrape({ resume = false } = {}) {
    const scraper = api();
    if (!scraper) {
      showToast('HiringCafe scraper module failed to load. Reload the extension.', 'error');
      return;
    }

    if (state.scraping && !state.pausedForChallenge && !resume) return;

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
        source: 'hiringcafe',
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

  async function fetchJobrightApiPage(tabId, search, position, count) {
    const jr = jrApi();
    const errors = [];

    // 1) Extension-context fetch (bypasses page CORS; uses host cookies).
    if (typeof jr?.fetchSearchApiPageExtension === 'function') {
      try {
        const ext = await jr.fetchSearchApiPageExtension(search, position, count);
        if (ext?.ok && ext.rows?.length) return ext;
        if (ext?.error) errors.push(`ext: ${ext.error}`);
      } catch (err) {
        errors.push(`ext: ${err?.message || String(err)}`);
      }
    }

    // 2) In-tab fetch (page cookies / CORS as the site itself).
    if (typeof jr?.fetchSearchApiPageInTab === 'function') {
      const tabResult = await runJobrightTabFn(tabId, jr.fetchSearchApiPageInTab, [
        search,
        position,
        count,
      ]);
      if (tabResult?.ok && tabResult.rows?.length) return tabResult;
      if (tabResult?.error) errors.push(`tab: ${tabResult.error}`);
    }

    // 3) Scroll the live search page and harvest swan-api traffic the SPA triggers.
    if (typeof jr?.installSwanCaptureInTab === 'function') {
      await runJobrightTabFn(tabId, jr.installSwanCaptureInTab, []);
    }
    if (typeof jr?.harvestMoreJobsInTab === 'function') {
      const harvested = await runJobrightTabFn(tabId, jr.harvestMoreJobsInTab, [3]);
      if (harvested?.ok && harvested.rows?.length) return harvested;
      if (harvested?.error) errors.push(`scroll: ${harvested.error}`);
    }

    return {
      ok: false,
      rows: [],
      total: null,
      error:
        errors.filter(Boolean).slice(0, 3).join(' | ') ||
        'Could not load more Jobright jobs (API + scroll). Sign in on jobright.ai and keep the search tab open.',
    };
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

    if (state.scraping && !state.pausedForChallenge && !resume) return;

    if (!String(state.jobrightSearch?.titleKeyword || '').trim()) {
      showToast('Import a Jobright search URL first.', 'warn');
      return;
    }

    await loadProfileFilterContext({ silent: true });

    state.scraping = true;
    state.pausedForChallenge = false;
    syncControlsFromState();

    const pageSize = jr.PAGE_SIZE || 20;
    const maxPages = Math.max(1, Math.min(Number(state.prefs.maxPages) || 8, 15));
    const delayMs = Math.max(400, Math.min(Number(state.prefs.delayMs) || 700, 3000));

    let page = resume && state.scrapeCursor ? state.scrapeCursor.page : 0;
    let jobs = resume && state.scrapeCursor ? [...state.scrapeCursor.jobs] : [];
    let reportedTotal =
      resume && state.scrapeCursor ? state.scrapeCursor.reportedTotal : null;
    let pagesFetched =
      resume && state.scrapeCursor ? state.scrapeCursor.pagesFetched : 0;
    const seenIds = new Set(
      jobs.map((j) => String(j.id || j.apply_url || '').trim()).filter(Boolean)
    );

    const pushHits = (hits) => {
      let added = 0;
      for (const hit of hits) {
        const mapped = jr.extractJobFields(hit);
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

    let lastApiError = '';

    try {
      let tabId = null;

      // Page 0: open search tab and read SSR __NEXT_DATA__.
      if (page === 0) {
        setProgress({
          text: `Page 1 of ${maxPages}`,
          detail: 'Opening Jobright search…',
          kind: 'info',
          current: 0,
          total: maxPages,
        });

        const url = jr.buildJobrightSearchUrl(state.jobrightSearch, 0);
        tabId = await ensureScrapeTab(url);
        const extracted = await waitUntilPageReady(tabId);

        if (extracted?.paused) {
          state.scrapeCursor = {
            page: 0,
            jobs,
            reportedTotal,
            pagesFetched,
          };
          state.pausedForChallenge = true;
          state.scraping = true;
          syncControlsFromState();
          return;
        }

        if (!extracted?.ok) {
          throw new Error(extracted?.error || 'Jobright page did not return job data.');
        }

        const hits = extracted.pageProps.jobList || [];
        reportedTotal = extracted.pageProps.totalJobs ?? reportedTotal;
        pushHits(hits);
        pagesFetched = hits.length > 0 ? 1 : 0;
        page = 1;

        // Install network capture early so later scrolls see SPA API calls.
        if (typeof jr.installSwanCaptureInTab === 'function') {
          await runJobrightTabFn(tabId, jr.installSwanCaptureInTab, []);
        }

        // Client-rendered results: scroll once if SSR was empty.
        if (jobs.length === 0 && typeof jr.harvestMoreJobsInTab === 'function') {
          setProgress({
            text: `Page 1 of ${maxPages}`,
            detail: 'SSR empty — scrolling for Jobright API jobs…',
            kind: 'info',
            current: 0,
            total: maxPages,
          });
          const firstHarvest = await runJobrightTabFn(tabId, jr.harvestMoreJobsInTab, [4]);
          if (firstHarvest?.rows?.length) {
            pushHits(firstHarvest.rows);
            if (firstHarvest.total != null) reportedTotal = firstHarvest.total;
            pagesFetched = jobs.length > 0 ? 1 : 0;
          }
        }

        setProgress({
          text: `Page 1 of ${maxPages}`,
          detail:
            `${jobs.length} collected` +
            (reportedTotal != null ? ` / ${reportedTotal}` : ''),
          kind: 'info',
          current: 1,
          total: maxPages,
        });
      }

      // Pages 1+: extension API → tab API → scroll capture.
      for (; page < maxPages; page += 1) {
        if (!state.scraping) break;
        if (reportedTotal != null && jobs.length >= reportedTotal) break;

        setProgress({
          text: `Page ${page + 1} of ${maxPages}`,
          detail: `Loading more Jobright jobs (offset ${page * pageSize})…`,
          kind: 'info',
          current: page,
          total: maxPages,
        });

        tabId = await ensureJobrightApiTab(
          jr.buildJobrightSearchUrl(state.jobrightSearch, 0)
        );

        const probe = await extractFromTab(tabId);
        if (probe?.challenge || probe?.needsLogin) {
          state.scrapeCursor = {
            page,
            jobs,
            reportedTotal,
            pagesFetched,
          };
          state.pausedForChallenge = true;
          state.scraping = true;
          syncControlsFromState();
          setProgress({
            text: probe?.needsLogin ? 'Sign-in required' : 'Browser check required',
            detail: 'Complete it in the open Jobright tab, then click Resume.',
            kind: 'warn',
            indeterminate: true,
          });
          showToast('Complete the Jobright check, then click Resume.', 'warn');
          return;
        }

        const before = jobs.length;
        const apiResult = await fetchJobrightApiPage(
          tabId,
          state.jobrightSearch,
          page * pageSize,
          pageSize
        );

        if (apiResult.total != null) reportedTotal = apiResult.total;

        if (!apiResult.ok || !apiResult.rows?.length) {
          lastApiError = apiResult.error || lastApiError;
          break;
        }

        const added = pushHits(apiResult.rows);
        if (added === 0) break;

        pagesFetched += 1;

        setProgress({
          text: `Page ${page + 1} of ${maxPages}`,
          detail:
            `+${added} via ${apiResult.via || 'api'} · collected ${jobs.length}` +
            (reportedTotal != null ? ` / ${reportedTotal}` : ''),
          kind: 'info',
          current: page + 1,
          total: maxPages,
        });

        if (jobs.length === before) break;
        if (page < maxPages - 1) await sleep(delayMs);
      }

      if (jobs.length === 0) {
        throw new Error(
          lastApiError ||
            'No Jobright jobs found. Sign in on jobright.ai, open search results, then scrape again.'
        );
      }

      const deduped = filters.dedupeJobs(jobs);
      state.rawJobs = deduped;
      state.lastScrapedAt = new Date().toISOString();
      state.stats = {
        pagesFetched,
        reportedTotal,
        scraped: deduped.length,
        source: 'jobright',
      };
      state.scrapeCursor = null;
      state.selectedKeys = new Set();
      recomputeFiltered();
      await persistResults();
      const removalDetail = formatFilterRemovalDetail(state.stats);
      const pageNote =
        reportedTotal != null && deduped.length < reportedTotal
          ? ` · ${deduped.length} of ${reportedTotal} (raise Max pages for more)`
          : '';
      setProgress({
        text: `Done · ${state.filteredJobs.length} jobs ready`,
        detail:
          `${deduped.length} scraped` +
          (pagesFetched ? ` · ${pagesFetched} pages` : '') +
          pageNote +
          (removalDetail ? ` · ${removalDetail}` : ''),
        kind: 'success',
        current: 1,
        total: 1,
      });
      showToast(
        `Scraped ${deduped.length} · ${state.filteredJobs.length} after filters.` +
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

  async function runScrape({ resume = false } = {}) {
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

  async function loadProfileFilterContext({ silent = false } = {}) {
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

      state.listsSyncedAt = Date.now();
      state.listsSyncError = '';
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
      state.listsSyncError = err?.message || String(err);
      if (!silent) showToast(err?.message || String(err), 'error');
    } finally {
      state.profileLoading = false;
      syncControlsFromState();
    }
  }

  function modalEl(name) {
    if (name === 'filters') return document.getElementById('jsFiltersModal');
    if (name === 'import') return document.getElementById('jsImportModal');
    return null;
  }

  function syncImportModalPanels() {
    const source = activeSource();
    document.querySelectorAll('[data-import-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-import-panel') !== source;
    });
    const title = document.getElementById('jsImportModalTitle');
    if (title) {
      title.textContent =
        source === 'jobright' ? 'Edit Jobright search' : 'Edit HiringCafe search';
    }
  }

  function openJsModal(name) {
    const modal = modalEl(name);
    if (!modal) return;
    if (name === 'import') syncImportModalPanels();
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

  function wireUi() {
    document.querySelectorAll('[data-js-source]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void setScrapeSource(btn.getAttribute('data-js-source'));
      });
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

    document.getElementById('jsJrImportSearchUrlBtn')?.addEventListener('click', async () => {
      const raw = document.getElementById('jsJrSearchUrlInput')?.value || '';
      await importJobrightSearchFromText(raw);
    });

    document.getElementById('jsJrImportSearchTabBtn')?.addEventListener('click', () => {
      void importJobrightSearchFromActiveTab();
    });

    document.getElementById('jsJrResetSearchBtn')?.addEventListener('click', () => {
      void resetJobrightSearch();
    });

    document.getElementById('jsJrSearchUrlInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void importJobrightSearchFromText(event.target.value || '');
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
      const prefix = activeSource() === 'jobright' ? 'jobright' : 'hiringcafe';
      downloadTextFile(
        csv,
        `${prefix}-jobs.csv`,
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
      const prefix = activeSource() === 'jobright' ? 'jobright' : 'hiringcafe';
      downloadTextFile(
        links.join('\n'),
        `${prefix}-links.txt`,
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

    document.querySelector('.js-hide-group')?.addEventListener('dblclick', (event) => {
      const target = event.target.closest('[data-edit-list]');
      if (!target) return;
      event.preventDefault();
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
