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
    listsSyncedAt: null,
    listsSyncError: '',
    openListEditor: null,
    customSearchState: null,
    customSearchSourceUrl: '',
    rawJobs: [],
    filteredJobs: [],
    selectedKeys: new Set(),
    scraping: false,
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

  function sourceLabel() {
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
    const { filtered, stats } = scraper.applyLocalFilters(deduped, {
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
      application_site: job?.application_site || 'Unknown',
      origin: origin || job?.origin || '',
      estimated_publish_date: job?.estimated_publish_date || null,
      source: job?.source || origin || '',
    };
  }

  function sortBidJobs(jobs) {
    return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
      const atsA = String(a?.application_site || '').toLowerCase();
      const atsB = String(b?.application_site || '').toLowerCase();
      if (atsA !== atsB) return atsB.localeCompare(atsA);
      const coA = String(a?.company_name || '').toLowerCase();
      const coB = String(b?.company_name || '').toLowerCase();
      if (coA !== coB) return coA.localeCompare(coB);
      const tA = Date.parse(a?.estimated_publish_date || a?.posted_at || '') || 0;
      const tB = Date.parse(b?.estimated_publish_date || b?.posted_at || '') || 0;
      return tB - tA;
    });
  }

  function dedupeBidJobs(jobs) {
    const seen = new Set();
    const out = [];
    for (const job of jobs) {
      const url = String(job?.apply_url || '')
        .trim()
        .toLowerCase();
      const key =
        url ||
        `${String(job?.company_name || '').toLowerCase()}::${String(job?.title || '').toLowerCase()}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(job);
    }
    return out;
  }

  function jobsToBidExcelXml(jobs, { includeOrigin = false } = {}) {
    const headers = [
      'Application Link',
      'Date Posted',
      'Job Title',
      'Company',
      'Source Platform',
      ...(includeOrigin ? ['Origin'] : []),
    ];
    const sorted = sortBidJobs(jobs);
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
          formatBidPostedAt(job?.posted_at || job?.estimated_publish_date || ''),
          job?.title ?? '',
          job?.company_name ?? '',
          job?.application_site ?? '',
          ...(includeOrigin ? [job?.origin || ''] : []),
        ];
        return `<Row>${values
          .map((v) => `<Cell><Data ss:Type="String">${escapeXml(v)}</Data></Cell>`)
          .join('')}</Row>`;
      })
      .join('');

    const colXml = headers
      .map((_, i) => {
        const widths = [280, 110, 220, 120, 120, 100];
        return `<Column ss:Width="${widths[i] || 100}"/>`;
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
   ${colXml}
   <Row ss:StyleID="Header">${headerCells}</Row>
   ${dataRows}
  </Table>
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
      scrapeBtn.disabled = state.scraping && !state.pausedForChallenge;
      scrapeBtn.classList.toggle('is-busy', state.scraping && !state.pausedForChallenge);
    }

    const stopBtn = document.getElementById('jsStopBtn');
    if (stopBtn) stopBtn.hidden = !state.scraping;

    renderBlockLists();
    renderResults();
    syncResultsPanelUi();
    renderMeta();
  }

  function renderFeedStatus() {
    const scraper = api();
    const hcEl = document.getElementById('jsHcFeedStatus');
    const jrEl = document.getElementById('jsJrFeedStatus');

    const hcSummary = state.customSearchState
      ? scraper?.summarizeSearchState?.(state.customSearchState) || 'Custom search imported'
      : 'Built-in default';

    if (hcEl) {
      hcEl.textContent = hcSummary;
      hcEl.title = hcSummary;
    }
    if (jrEl) {
      jrEl.textContent = 'Recommend · your Saved Filters';
      jrEl.title = 'Set filters on jobright.ai → Recommend, then scrape';
    }
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
    if (typeof jr?.forceRecommendRefetchInTab === 'function') {
      await runJobrightTabFn(tabId, jr.forceRecommendRefetchInTab, []);
      await sleep(600);
    }

    return { tabId, reused };
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
    const maxPages = Math.max(1, Math.min(Number(state.prefs.maxPages) || 8, 20));
    const delayMs = Math.max(400, Math.min(Number(state.prefs.delayMs) || 700, 3000));
    const jrPages = Number(state.combinedRun?.jrPages) || 0;
    const overallTotal = combined ? maxPages * 2 : maxPages;
    const overallOffset = combined ? maxPages : 0;

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
          text: combined
            ? `Both · Step 2 of 2 · HiringCafe · Page ${page + 1} of ${maxPages}`
            : `HiringCafe · Page ${page + 1} of ${maxPages}`,
          detail:
            `Collected ${jobs.length}${reportedTotal != null ? ` / ${reportedTotal}` : ''} so far` +
            (combined ? ` · Jobright ${state.combinedRun?.jrCount || 0} already` : ''),
          kind: 'info',
          current: overallOffset + page,
          total: overallTotal,
          phase: combined ? 'hiringcafe' : null,
        });
        const url = scraper.buildHiringCafeUrl(
          '1d',
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
            combined: combined || undefined,
            phase: combined ? 'hiringcafe' : undefined,
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
          text: combined
            ? `Both · Step 2 of 2 · HiringCafe · Page ${page + 1} of ${maxPages}`
            : `HiringCafe · Page ${page + 1} of ${maxPages}`,
          detail:
            `${hits.length} hits this page · collected ${jobs.length}` +
            (reportedTotal != null ? ` / ${reportedTotal}` : '') +
            (combined
              ? ` · combined ${(state.combinedRun?.jrCount || 0) + jobs.length}`
              : ''),
          kind: 'info',
          current: overallOffset + page + 1,
          total: overallTotal,
          phase: combined ? 'hiringcafe' : null,
        });

        if (extracted.pageProps.ssrIsLastPage) break;
        if (page < maxPages - 1) await sleep(delayMs);
      }

      const hcJobs = jobs.map((job) => normalizeBidJob(job, 'HiringCafe'));
      let merged = hcJobs;
      let jrCount = 0;
      if (combined) {
        jrCount = state.combinedRun?.jrJobs?.length || 0;
        merged = dedupeBidJobs([...(state.combinedRun?.jrJobs || []), ...hcJobs]);
        state.combinedRun = null;
      }

      if (merged.length === 0) {
        throw new Error(
          'No jobs found from HiringCafe' +
            (combined ? ' (and Jobright returned none).' : '.')
        );
      }

      state.rawJobs = merged;
      state.lastScrapedAt = new Date().toISOString();
      state.stats = {
        pagesFetched: combined ? jrPages + pagesFetched : pagesFetched,
        reportedTotal,
        scraped: merged.length,
        source: combined ? 'both' : 'hiringcafe',
        jrCount: combined ? jrCount : undefined,
        hcCount: hcJobs.length,
      };
      state.scrapeCursor = null;
      state.selectedKeys = new Set();
      recomputeFiltered();
      await persistResults();
      const removalDetail = formatFilterRemovalDetail(state.stats);
      setProgress({
        text: `Done · ${state.filteredJobs.length} jobs ready`,
        detail:
          (combined
            ? `JR ${jrCount} + HC ${hcJobs.length} → ${merged.length} unique`
            : `${jobs.length} scraped`) +
          (pagesFetched
            ? ` · ${combined ? jrPages + pagesFetched : pagesFetched} pages`
            : '') +
          (reportedTotal != null && !combined
            ? ` · HiringCafe total ${reportedTotal}`
            : '') +
          (removalDetail ? ` · ${removalDetail}` : ''),
        kind: 'success',
        current: 1,
        total: 1,
        phase: combined ? 'done' : null,
        showTrust: false,
      });
      showToast(
        `Scraped ${merged.length} · ${state.filteredJobs.length} after filters.` +
          (removalDetail ? ` ${removalDetail}` : ''),
        'success'
      );
    } catch (err) {
      const message = err?.message || String(err);
      setProgress({
        text: 'Scrape failed',
        detail: message,
        kind: 'error',
        indeterminate: true,
        showTrust: false,
        phase: combined ? 'hiringcafe' : null,
      });
      showToast(message, 'error');
      state.pausedForChallenge = false;
      state.scrapeCursor = null;
      if (combined) state.combinedRun = null;
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

    // Prefer in-tab fetch so UI "Most Recent" session applies.
    if (typeof jr?.fetchRecommendApiPageInTab === 'function') {
      const tabResult = await runJobrightTabFn(tabId, jr.fetchRecommendApiPageInTab, [
        position,
        count,
        sort || '',
      ]);
      if (tabResult?.ok && tabResult.rows?.length) return tabResult;
      if (tabResult?.error) errors.push(`tab: ${tabResult.error}`);
    }

    if (typeof jr?.fetchRecommendApiPageExtension === 'function') {
      try {
        const ext = await jr.fetchRecommendApiPageExtension(position, count, sort);
        if (ext?.ok && ext.rows?.length) return ext;
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
      if (harvested?.ok && harvested.rows?.length) return harvested;
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
      if (!state.scraping) throw new Error('Scrape stopped.');
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
    // Jobright is infinite-scroll on one page. Treat prefs.maxPages as scroll batches.
    const maxScrollBatches = Math.max(6, Math.min(Number(state.prefs.maxPages) || 8, 15) * 4);
    const scrollsPerBatch = 5;
    const delayMs = Math.max(400, Math.min(Number(state.prefs.delayMs) || 700, 3000));
    const overallTotal = combined ? maxScrollBatches + 8 : maxScrollBatches;
    const overallOffset = 0;
    const recommendUrl = jr.JOBRIGHT_RECOMMEND || 'https://jobright.ai/jobs/recommend';

    let batch = resume && state.scrapeCursor ? state.scrapeCursor.page : 0;
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
    let recommendSort = '';
    let stagnantBatches = 0;
    const jrProgressLabel = (batchNum) =>
      combined
        ? `Both · Step 1 of 2 · Jobright · Scroll ${batchNum} of ${maxScrollBatches}`
        : `Jobright · Scroll ${batchNum} of ${maxScrollBatches}`;

    try {
      let tabId = null;

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
        const ready = await waitUntilJobrightRecommendReady(tabId);

        if (ready?.paused) {
          state.scrapeCursor = {
            page: 0,
            jobs,
            reportedTotal,
            pagesFetched,
            combined: combined || undefined,
            phase: combined ? 'jobright' : undefined,
          };
          state.pausedForChallenge = true;
          state.scraping = true;
          syncControlsFromState();
          return;
        }

        // Capture may have been wiped if challenge redirected — reinstall + refetch.
        if (typeof jr.installSwanCaptureInTab === 'function') {
          await runJobrightTabFn(tabId, jr.installSwanCaptureInTab, []);
        }
        if (typeof jr.forceRecommendRefetchInTab === 'function') {
          await runJobrightTabFn(tabId, jr.forceRecommendRefetchInTab, []);
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
            pushHits(drained.rows);
            if (drained.total != null) reportedTotal = drained.total;
            if (drained.sortCondition) recommendSort = drained.sortCondition;
            pagesFetched = jobs.length > 0 ? 1 : 0;
          }
        }

        // Seed from API only if capture empty
        if (jobs.length === 0) {
          const first = await fetchJobrightApiPage(tabId, 0, pageSize, recommendSort || undefined);
          if (first.sortCondition) recommendSort = first.sortCondition;
          if (first.total != null) reportedTotal = first.total;
          if (first.ok && first.rows?.length) {
            pushHits(first.rows);
            pagesFetched = 1;
          } else if (first.error) {
            lastApiError = first.error;
          }
        }

        if (jobs.length === 0) {
          const extracted = ready?.extracted;
          const ssrHits = extracted?.pageProps?.jobList || [];
          if (ssrHits.length) {
            pushHits(ssrHits);
            reportedTotal = extracted.pageProps.totalJobs ?? reportedTotal;
            pagesFetched = jobs.length > 0 ? 1 : 0;
          }
        }

        // DOM cards on the open Recommend page
        if (jobs.length === 0 && typeof jr.extractDomRecommendJobsInTab === 'function') {
          const dom = await runJobrightTabFn(tabId, jr.extractDomRecommendJobsInTab, []);
          if (dom?.rows?.length) {
            pushHits(dom.rows);
            pagesFetched = jobs.length > 0 ? 1 : 0;
          }
        }

        setProgress({
          text: jrProgressLabel(1),
          detail:
            `${jobs.length} collected` +
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

      // Primary: infinite-scroll the Recommend feed and capture swan-api payloads
      for (; batch < maxScrollBatches; batch += 1) {
        if (!state.scraping) break;
        if (reportedTotal != null && jobs.length >= reportedTotal) break;

        setProgress({
          text: jrProgressLabel(batch + 1),
          detail: `Scrolling Recommend feed… (${jobs.length} so far)`,
          kind: 'info',
          current: overallOffset + batch,
          total: overallTotal,
          phase: 'jobright',
          showTrust: true,
        });

        tabId = await ensureJobrightApiTab(recommendUrl);

        const probe = await extractFromTab(tabId);
        if (probe?.challenge || probe?.needsLogin) {
          state.scrapeCursor = {
            page: batch,
            jobs,
            reportedTotal,
            pagesFetched,
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
        const harvest = await runJobrightTabFn(tabId, jr.harvestMoreJobsInTab, [
          scrollsPerBatch,
        ]);

        if (harvest?.total != null) reportedTotal = harvest.total;
        if (harvest?.sortCondition) recommendSort = harvest.sortCondition;

        let added = 0;
        if (harvest?.rows?.length) {
          added = pushHits(harvest.rows);
        }

        // API offset backup only when scroll added nothing
        if (added === 0) {
          const apiResult = await fetchJobrightApiPage(
            tabId,
            jobs.length,
            pageSize,
            recommendSort || undefined
          );
          if (apiResult.total != null) reportedTotal = apiResult.total;
          if (apiResult.ok && apiResult.rows?.length) {
            added = pushHits(apiResult.rows);
          } else if (apiResult.error) {
            lastApiError = apiResult.error;
          }
        }

        if (added === 0 && jobs.length === 0 && typeof jr.extractDomRecommendJobsInTab === 'function') {
          const dom = await runJobrightTabFn(tabId, jr.extractDomRecommendJobsInTab, []);
          if (dom?.rows?.length) {
            added = pushHits(dom.rows);
          }
        }

        if (added > 0) {
          pagesFetched += 1;
          stagnantBatches = 0;
          setProgress({
            text: jrProgressLabel(batch + 1),
            detail: `+${added} via scroll · collected ${jobs.length}`,
            kind: 'info',
            current: overallOffset + batch + 1,
            total: overallTotal,
            phase: 'jobright',
            showTrust: true,
          });
        } else {
          stagnantBatches += 1;
          if (stagnantBatches >= 2) break;
        }

        if (jobs.length === before && stagnantBatches >= 2) break;
        if (batch < maxScrollBatches - 1) await sleep(delayMs);
      }

      if (jobs.length === 0 && !combined) {
        throw new Error(
          lastApiError ||
            'No Recommend jobs found. Sign in on jobright.ai, open Recommend with your Saved Filters, then scrape again.'
        );
      }

      if (combined) {
        const jrEmpty = jobs.length === 0;
        state.combinedRun = {
          active: true,
          phase: 'hiringcafe',
          jrJobs: jobs.map((job) => normalizeBidJob(job, 'Jobright')),
          jrPages: pagesFetched,
          jrCount: jobs.length,
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
      setProgress({
        text: 'Scrape failed',
        detail: message,
        kind: 'error',
        indeterminate: true,
        showTrust: false,
        phase: combined ? 'jobright' : null,
      });
      showToast(message, 'error');
      state.pausedForChallenge = false;
      state.scrapeCursor = null;
      if (combined) state.combinedRun = null;
    } finally {
      // Combined handoff to HiringCafe keeps scraping true.
      if (!state.pausedForChallenge && !(combined && state.combinedRun?.phase === 'hiringcafe')) {
        state.scraping = false;
      }
      syncControlsFromState();
    }
  }

  async function runScrape({ resume = false } = {}) {
    if (activeSource() === 'both' || state.combinedRun?.active) {
      if (!resume || !state.combinedRun?.active) {
        state.combinedRun = {
          active: true,
          phase: 'jobright',
          jrJobs: [],
          jrPages: 0,
          jrCount: 0,
        };
        setProgress({
          text: 'Starting scrape…',
          detail: 'Step 1 of 2 · Jobright (Most Recent) → HiringCafe',
          kind: 'info',
          indeterminate: true,
          phase: 'jobright',
          showTrust: true,
        });
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

  function wireUi() {
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
      state.combinedRun = null;
      setProgress({
        text: 'Scrape stopped',
        detail: 'Partial results were kept if any pages finished.',
        kind: 'warn',
        indeterminate: true,
        showTrust: false,
      });
      syncControlsFromState();
    });

    document.getElementById('jsClearResultsBtn')?.addEventListener('click', async () => {
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
      showToast(`Spreadsheet downloaded (${jobs.length}).`, 'success');
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
