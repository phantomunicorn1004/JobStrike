/**
 * Resume DB registration tab — communicates with JobStrike backend only.
 */
(function (global) {
  const BACKEND_URL_KEY = 'resume_db_backend_url';
  const AUTH_USERNAME_KEY = 'resume_db_auth_username';
  const AUTH_USER_ID_KEY = 'resume_db_auth_user_id';
  const EXTENSION_API_KEY_KEY = 'resume_db_extension_api_key';
  const LEGACY_API_KEY_KEY = 'resume_db_api_key';
  const SELECTED_PROFILE_KEY = 'resume_db_selected_profile_id';
  const DUPLICATE_CHECK_WINDOW_DAYS_KEY = 'resume_db_duplicate_check_window_days';
  const DEFAULT_DUPLICATE_CHECK_WINDOW_DAYS = 15;
  const DEFAULT_BACKEND = 'https://remote-work-helper.vercel.app';

  let connectionPollTimer = null;
  let profilesLoadSeq = 0;
  let backendConnected = false;
  let websiteDriveStatus = null;
  /** Short-lived caches so Register / Copy don't refetch on every click. */
  let authCache = { ok: false, checkedAt: 0, username: '' };
  let driveStatusCacheAt = 0;
  let applicationsCache = { at: 0, resumes: null };
  let profileLocationCache = { at: 0, profileId: '', city: '', state: '', constraints: null };
  const AUTH_CACHE_TTL_MS = 3 * 60 * 1000;
  const DRIVE_CACHE_TTL_MS = 3 * 60 * 1000;
  // Reading the whole list takes several requests, so keep it a while;
  // registering a job invalidates it.
  const APPLICATIONS_CACHE_TTL_MS = 5 * 60 * 1000;
  const APPLICATIONS_PAGE_SIZE = 200;
  const APPLICATIONS_MAX_PAGES = 25;
  const PROFILE_LOCATION_CACHE_TTL_MS = 5 * 60 * 1000;
  // These hold the *currently bound tab's* values. SmartJobTabSession owns the
  // per-tab copies and swaps them in and out around tab changes.
  let autoAttachedFromJson2docx = { resume: false, cover: false };
  let resumeJsonOverrideActive = false;
  let resumeJsonApplyTimer = null;
  let resumeJsonDupTimer = null;
  let lastAutoCheckedCompanyKey = '';
  let lastAutoCheckedJobLinkKey = '';
  let jobLinkDupTimer = null;
  let companyDupTimer = null;
  let jobLinkDuplicateActive = false;
  /** @type {'none' | 'definite' | 'possible'} */
  let companyDuplicateLevel = 'none';
  let generatedFileMeta = { resumeName: '', coverName: '', generatedAt: 0 };
  /** Set when a reload left file metadata behind but the File objects are gone. */
  let filesNeedRegeneration = false;
  let promptCopiedAt = 0;
  let registeredRecord = { id: '', at: 0 };
  /** Latest Bid fit preflight result (gates Copy Prompt). */
  let lastBidFitResult = null;
  /** Last AI compatibility result for the current Note+profile. */
  let lastAiCompatResult = null;
  let lastAiCompatCacheKey = '';
  /** True while an AI compatibility call is in-flight (auto or manual). */
  let aiCompatPending = false;
  /** Bumped when Note/profile changes so stale AI responses are ignored. */
  let aiCompatRunId = 0;
  /** Set once a run finds no API key, so later edits skip the "Checking…" wait. */
  let aiCompatKeyMissing = false;
  /**
   * Verdicts by posting text + profile location. The Note is rewritten by many
   * actions (Refresh, tab switches, Generate, Register); without this each one
   * paid for a fresh API call on text that had already been checked.
   */
  const aiCompatCache = new Map();
  const AI_COMPAT_CACHE_MAX = 40;
  /**
   * True once the Note has been replaced by the built resume JSON's copy of the
   * description. The verdict was reached on the real posting, so it stays
   * attached to this job instead of being re-run on GPT's rewording of it.
   */
  let aiCompatPinned = false;
  /** Idle time after typing in the Note before an automatic check. */
  const AI_COMPAT_TYPING_DELAY_MS = 5000;
  /** Debounce timer for the auto compatibility check (longer than bidFitRefreshTimer). */
  let autoAiCompatTimer = null;
  /** True while the user has unsaved edits in the prompt kit fields. */
  let promptKitEditorDirty = false;
  /** null follows the preflight level; true/false is a manual override. */
  let bidFitReasonsExpanded = null;
  let bidFitRefreshTimer = null;
  /** Live percent while json2docx runs, mirrored into the Generate Files step. */
  let generateActivity = null;
  /** Suppresses side effects (duplicate checks, session writes) while restoring. */
  let isRestoringSession = false;

  function tabSession() {
    return global.SmartJobTabSession || null;
  }

  function syncTabSession() {
    if (isRestoringSession) return;
    tabSession()?.sync();
  }

  function normalizeBackendUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_BACKEND;
  }

  function isAuthenticated(config) {
    return Boolean(config?.extensionApiKey && config?.username);
  }

  async function getBackendConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          BACKEND_URL_KEY,
          AUTH_USERNAME_KEY,
          AUTH_USER_ID_KEY,
          EXTENSION_API_KEY_KEY,
          LEGACY_API_KEY_KEY
        ],
        (result) => {
          const extensionApiKey = String(
            result[EXTENSION_API_KEY_KEY] || result[LEGACY_API_KEY_KEY] || ''
          ).trim();
          resolve({
            baseUrl: normalizeBackendUrl(result[BACKEND_URL_KEY]),
            username: String(result[AUTH_USERNAME_KEY] || '').trim(),
            userId: String(result[AUTH_USER_ID_KEY] || '').trim(),
            extensionApiKey,
            apiKey: extensionApiKey
          });
        }
      );
    });
  }

  async function saveAuthConfig({ baseUrl, username, userId, extensionApiKey }) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [BACKEND_URL_KEY]: normalizeBackendUrl(baseUrl),
          [AUTH_USERNAME_KEY]: String(username || '').trim(),
          [AUTH_USER_ID_KEY]: String(userId || '').trim(),
          [EXTENSION_API_KEY_KEY]: String(extensionApiKey || '').trim(),
          [LEGACY_API_KEY_KEY]: ''
        },
        resolve
      );
    });
  }

  async function saveBackendUrlOnly(baseUrl) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [BACKEND_URL_KEY]: normalizeBackendUrl(baseUrl) }, resolve);
    });
  }

  function invalidateSessionCaches() {
    authCache = { ok: false, checkedAt: 0, username: '' };
    driveStatusCacheAt = 0;
    websiteDriveStatus = null;
    applicationsCache = { at: 0, resumes: null };
    profileLocationCache = { at: 0, profileId: '', city: '', state: '', constraints: null };
    clearAiCompatResult();
  }

  function clearAiCompatResult() {
    aiCompatRunId += 1;
    lastAiCompatResult = null;
    lastAiCompatCacheKey = '';
    aiCompatPending = false;
    aiCompatPinned = false;
    if (autoAiCompatTimer) {
      clearTimeout(autoAiCompatTimer);
      autoAiCompatTimer = null;
    }
  }

  /**
   * Mark compatibility as in-progress immediately so the preflight card shows
   * "Checking…" instead of flashing regex warns before the AI call starts.
   * Also invalidates any in-flight AI response for a previous Note/job.
   */
  function markAiCompatPending() {
    aiCompatRunId += 1;
    lastAiCompatResult = null;
    lastAiCompatCacheKey = '';
    aiCompatPending = true;
    aiCompatPinned = false;
    if (autoAiCompatTimer) {
      clearTimeout(autoAiCompatTimer);
      autoAiCompatTimer = null;
    }
  }

  /** Note/job changed: wait on the AI verdict, unless no key means none is coming. */
  function beginAiCompatWait() {
    if (aiCompatKeyMissing) clearAiCompatResult();
    else markAiCompatPending();
  }

  /**
   * Identity of a check: the whole posting text (whitespace-insensitive) plus
   * the profile location. Hashing all of it means an edit in the middle of the
   * text is a different posting, while a re-scrape of the same page is not.
   */
  function aiCompatCacheKey(jobDescription, profileCity, profileState, constraints) {
    const jd = String(jobDescription || '').replace(/\s+/g, ' ').trim();
    const c = constraints || {};
    const facts = [c.sponsorshipRequirement, c.workAuthorizationUS, c.securityClearance, c.citizenship, c.languages, c.remotePreference]
      .map((v) => String(v || '').trim().toLowerCase())
      .join('|');
    let hash = 5381;
    for (let i = 0; i < jd.length; i += 1) {
      hash = ((hash << 5) + hash + jd.charCodeAt(i)) | 0;
    }
    return [jd.length, hash >>> 0, profileCity || '', profileState || '', facts].join('\u0001');
  }

  function rememberAiCompatResult(cacheKey, result) {
    if (!cacheKey || result?.status !== 'done') return;
    aiCompatCache.delete(cacheKey);
    aiCompatCache.set(cacheKey, result);
    while (aiCompatCache.size > AI_COMPAT_CACHE_MAX) {
      aiCompatCache.delete(aiCompatCache.keys().next().value);
    }
  }

  /**
   * The Note was replaced by the resume JSON's description. Keep the verdict
   * (or the check still in flight) for the posting instead of re-running it.
   * @returns {boolean} true when there is a verdict to keep
   */
  function pinAiCompatToJob() {
    if (!aiCompatPending && lastAiCompatResult?.status !== 'done') return false;
    aiCompatPinned = true;
    return true;
  }

  /**
   * Shape the cached AI compatibility result for the preflight engine.
   * Returns null when nothing is known yet, a 'pending' marker while the call
   * is in flight, and the full evidence payload once it lands.
   */
  function resolveAiCompatForInputs(inputs) {
    if (aiCompatPending) return { status: 'pending' };
    if (!lastAiCompatResult || !lastAiCompatCacheKey) return null;
    if (aiCompatPinned) return lastAiCompatResult;
    const key = aiCompatCacheKey(inputs.jobDescription, inputs.profileCity, inputs.profileState, inputs.constraints);
    if (key !== lastAiCompatCacheKey) return null;
    return lastAiCompatResult;
  }

  async function clearAuthConfig() {
    invalidateSessionCaches();
    return new Promise((resolve) => {
      chrome.storage.local.remove(
        [AUTH_USERNAME_KEY, AUTH_USER_ID_KEY, EXTENSION_API_KEY_KEY, LEGACY_API_KEY_KEY],
        resolve
      );
    });
  }

  async function saveBackendConfig(baseUrl, apiKey) {
    const config = await getBackendConfig();
    if (apiKey) {
      return saveAuthConfig({
        baseUrl,
        username: config.username,
        userId: config.userId,
        extensionApiKey: apiKey
      });
    }
    return saveBackendUrlOnly(baseUrl);
  }

  function apiHeaders(config) {
    const headers = {};
    const key = config?.extensionApiKey || config?.apiKey;
    if (key) headers['X-Extension-Key'] = key;
    return headers;
  }

  async function copyTextToClipboard(text) {
    if (typeof global.copyTextToClipboard === 'function' && global.copyTextToClipboard !== copyTextToClipboard) {
      return global.copyTextToClipboard(text);
    }
    const value = String(text || '').trim();
    if (!value) throw new Error('Nothing to copy.');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch (_) {
      /* fall through */
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Copy failed.');
    } finally {
      textarea.remove();
    }
  }

  function setRegisterStatus(message, type) {
    // Status strip removed — route through panel toast (showStatus / showToast).
    const text = String(message || '').trim();
    if (!text) return;
    const kind = type || 'info';
    if (typeof showStatus === 'function') {
      showStatus(text, kind);
      return;
    }
    if (typeof global.showToast === 'function') {
      global.showToast(text, kind === 'warn' ? 'info' : kind);
    }
  }

  function setSettingsHint(message, type) {
    const el = document.getElementById('backendSettingsHint');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'muted register-settings-hint' + (type ? ` is-${type}` : '');
    el.hidden = !message;
  }

  /** True from the Register click until its request settles. */
  let registerInFlight = false;

  function setRegisterBusy(busy) {
    const btn = document.getElementById('registerJobBtn');
    setRbButtonLoading(btn, busy);
    syncResumeBuilderActionButtons({ registerBusy: busy });
  }

  /** Built resume JSON is usable when it parses and includes the Register contract fields. */
  function hasUsableBuiltResumeJson() {
    const raw = String(document.getElementById('regResumeJson')?.value || '').trim();
    if (!raw) return false;
    const mapper = global.SmartJobResumeJsonMapper;
    const result = mapper?.extractRegisterFieldsFromResumeJsonText?.(raw);
    if (!result?.ok) return false;
    const fields = result.fields || {};
    return Boolean(fields.resumeTemplate && fields.hasRegisterFields);
  }

  /* ------------------------------------------------------- apply progress */

  const APPLY_STEPS = [
    { key: 'job', label: 'Job', target: 'regNote', nextCue: 'Next: Add job description (paste or Refresh)' },
    { key: 'prompt', label: 'Prompt', target: 'regBuildCopyPromptBtn', nextCue: 'Next: Copy Prompt' },
    { key: 'json', label: 'JSON', target: 'regOpenResumeJsonBtn', nextCue: 'Next: Edit JSON' },
    {
      key: 'files',
      label: 'Files',
      target: 'regGenerateFilesBtn',
      nextCue: 'Next: Generate files — or skip to Register'
    },
    { key: 'register', label: 'Register', target: 'registerJobBtn', nextCue: 'Next: Register this job' }
  ];

  /**
   * Derives the current step from live state. Nothing about "which step am I on"
   * is stored, so the tracker cannot drift out of sync with reality.
   */
  function computeApplyProgress() {
    const hasNote = Boolean(document.getElementById('regNote')?.value?.trim());
    const hasJson = hasUsableBuiltResumeJson();
    const inputs = getRegisterFileInputs();
    const hasFiles = Boolean(inputs.resume?.files?.[0] || inputs.cover?.files?.[0]);
    // Pasting a different job link into the same tab is a new job.
    const currentLinkKey = canonicalJobLinkKey(document.getElementById('regJobLink')?.value || '');
    const registered =
      Boolean(registeredRecord.id) &&
      (!registeredRecord.jobLinkKey || !currentLinkKey || registeredRecord.jobLinkKey === currentLinkKey);
    const profileId = document.getElementById('regProfileId')?.value?.trim();

    const done = {
      job: hasNote,
      // Skippable: a valid resume JSON means the prompt round-trip happened,
      // whether or not it went through this extension.
      prompt: Boolean(promptCopiedAt) || hasJson,
      json: hasJson,
      files: hasFiles,
      register: registered
    };

    const blockedReason = {
      job: hasNote ? '' : 'Use Refresh to read this page, or paste a job description.',
      prompt: profileId ? '' : 'Select a profile first.',
      json: '',
      // Files are optional — prerequisites are checked when Generate is clicked.
      files: hasFiles ? '' : 'Optional — generate or attach files, or register without them.',
      register: jobLinkDuplicateActive
        ? 'Duplicate job link — already in Resume DB for this profile.'
        : companyDuplicateLevel === 'definite'
          ? 'Duplicate company — already in Resume DB for this profile.'
          : companyDuplicateLevel === 'possible'
            ? 'Similar company name — review before registering.'
            : ''
    };

    // A later step being complete implies the earlier ones were. This matters
    // after Register, which clears the attached files on success.
    let seenDone = false;
    for (let i = APPLY_STEPS.length - 1; i >= 0; i -= 1) {
      const key = APPLY_STEPS[i].key;
      if (seenDone) done[key] = true;
      else if (done[key]) seenDone = true;
    }

    const currentIndex = APPLY_STEPS.findIndex((step) => !done[step.key]);
    const steps = APPLY_STEPS.map((step, index) => {
      let state;
      let reason = '';
      let percent = null;

      if (generateActivity && step.key === 'files') {
        state = 'active';
        reason = generateActivity.message || 'Generating…';
        percent = generateActivity.percent;
      } else if (done[step.key]) {
        state = 'done';
      } else if (step.key === 'files' && filesNeedRegeneration) {
        state = 'warn';
        reason = 'Files were generated earlier — regenerate to attach them.';
      } else if (step.key === 'files' && !hasFiles && index === currentIndex) {
        state = 'current';
        reason = blockedReason.files;
      } else if (step.key === 'register' && jobLinkDuplicateActive) {
        state = 'blocked';
        reason = blockedReason.register;
      } else if (step.key === 'register' && companyDuplicateLevel === 'definite') {
        state = 'warn';
        reason = blockedReason.register;
      } else if (step.key === 'register' && companyDuplicateLevel === 'possible') {
        state = 'warn';
        reason = blockedReason.register;
      } else if (index === currentIndex) {
        reason = blockedReason[step.key];
        state = reason ? 'blocked' : 'current';
      } else {
        state = 'pending';
      }

      return { ...step, index, number: index + 1, state, reason, percent };
    });

    const doneCount = APPLY_STEPS.filter((step) => done[step.key]).length;
    return {
      steps,
      currentIndex: currentIndex === -1 ? APPLY_STEPS.length : currentIndex,
      doneCount,
      total: APPLY_STEPS.length,
      percent: Math.round((doneCount / APPLY_STEPS.length) * 100),
      complete: currentIndex === -1
    };
  }

  function applyStepTooltip(step) {
    if (step.state === 'done') {
      return `${step.number}. ${step.label} — done · click to redo from here`;
    }
    if (step.reason) return `${step.number}. ${step.label} — ${step.reason}`;
    const suffix = {
      current: 'do this next',
      pending: 'not yet',
      active: 'in progress'
    }[step.state];
    return suffix ? `${step.number}. ${step.label} — ${suffix}` : `${step.number}. ${step.label}`;
  }

  /* ------------------------------------------------- rewind / reset steps */

  const APPLY_STEP_ORDER = APPLY_STEPS.map((step) => step.key);

  /** True when rewinding to this step would throw away real work. */
  function rewindDiscardsWork(stepKey) {
    const from = APPLY_STEP_ORDER.indexOf(stepKey);
    if (from < 0) return false;
    const clears = (key) => APPLY_STEP_ORDER.indexOf(key) >= from;
    const inputs = getRegisterFileInputs();
    if (clears('json') && getResumeJsonText().trim()) return true;
    if (clears('files') && (inputs.resume?.files?.[0] || inputs.cover?.files?.[0])) return true;
    return false;
  }

  /**
   * Clears the given step and everything after it. Since step states are
   * derived, clearing the underlying data is all a rewind needs to do.
   */
  function rewindApplyTo(stepKey) {
    const from = APPLY_STEP_ORDER.indexOf(stepKey);
    if (from < 0) return false;
    const clears = (key) => APPLY_STEP_ORDER.indexOf(key) >= from;

    // Latest step first, so each renderer sees a consistent state.
    if (clears('register')) registeredRecord = { id: '', at: 0 };
    if (clears('files')) clearAllRegisterFiles();
    if (clears('json')) clearResumeJsonOverride({ clearTextarea: true });
    if (clears('prompt')) promptCopiedAt = 0;
    if (clears('job')) setRegisterFieldValue('regNote', '');

    generateActivity = null;
    filesNeedRegeneration = false;
    syncTabSession();
    syncResumeBuilderActionButtons();
    return true;
  }

  /** Step 1 owns the scraped job description, so a rewind there re-reads the page. */
  function requestJobRescrape() {
    try {
      document.dispatchEvent(new CustomEvent('rwh-request-rescrape'));
    } catch (_) {
      /* ignore */
    }
  }

  /** In-panel confirm; the native one can be suppressed inside the on-page overlay. */
  function confirmAction(message, options) {
    if (typeof global.rwhConfirm === 'function') return global.rwhConfirm(message, options);
    return Promise.resolve(window.confirm(message));
  }

  async function handleApplyStepClick(stepKey) {
    const step = computeApplyProgress().steps.find((s) => s.key === stepKey);
    if (!step) return;

    // Completed steps rewind; anything else jumps to the control that advances it.
    if (step.state !== 'done' && step.state !== 'warn') {
      focusApplyStep(stepKey);
      return;
    }

    if (rewindDiscardsWork(stepKey)) {
      const proceed = await confirmAction(
        `Redo from step ${step.number} (${step.label})?\n\n` +
          'This clears that step and everything after it.',
        { confirmLabel: 'Redo from here', danger: true }
      );
      if (!proceed) return;
    }

    rewindApplyTo(stepKey);
    setRegisterStatus(`Back to step ${step.number}: ${step.label}.`, 'info');
    if (stepKey === 'job') requestJobRescrape();
  }

  async function resetApplyProgress() {
    if (rewindDiscardsWork('job')) {
      const proceed = await confirmAction(
        'Reset this job’s progress?\n\n' +
          'This clears the job description, resume JSON, generated files, and the registered mark for this tab.',
        { confirmLabel: 'Reset', danger: true }
      );
      if (!proceed) return;
    }
    rewindApplyTo('job');
    setRegisterStatus('Progress reset — reloading job info from this tab.', 'info');
    requestJobRescrape();
  }

  /** Wire reset once; stepper DOM was removed in favor of the cue strip. */
  function ensureApplyProgressDom() {
    const resetBtn = document.getElementById('applyProgressReset');
    if (resetBtn && resetBtn.dataset.wired !== '1') {
      resetBtn.dataset.wired = '1';
      resetBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void resetApplyProgress();
      });
    }

    const track = document.getElementById('applySteps');
    if (track && track.dataset.wired !== '1') {
      track.dataset.wired = '1';
      track.innerHTML = APPLY_STEPS.map(
        (step, index) => `
        <li class="apply-step" data-step="${step.key}">
          <button type="button" class="apply-step-btn" data-step="${step.key}">
            <span class="apply-step-node">
              <span class="apply-step-fill"></span>
              <span class="apply-step-num">${index + 1}</span>
              <svg class="apply-step-check" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7.5"/></svg>
            </span>
            <span class="apply-step-label">${step.label}</span>
          </button>
        </li>`
      ).join('');
      track.addEventListener('click', (event) => {
        const key = event.target.closest?.('.apply-step-btn')?.dataset.step;
        if (key) void handleApplyStepClick(key);
      });
    }
    return document.getElementById('rbNextCue') || resetBtn || true;
  }

  /** One node per step: done / current / blocked at a glance, click to jump or redo. */
  function renderApplyStepper(progress) {
    const track = document.getElementById('applySteps');
    if (!track) return;
    progress.steps.forEach((step) => {
      const item = track.querySelector(`.apply-step[data-step="${step.key}"]`);
      if (!item) return;
      const state = progress.complete ? 'done' : step.state;
      ['done', 'current', 'active', 'blocked', 'warn', 'pending'].forEach((name) => {
        item.classList.toggle(`is-${name}`, name === state);
      });
      const btn = item.querySelector('.apply-step-btn');
      if (btn) {
        btn.title = applyStepTooltip(step);
        if (state === 'current' || state === 'active' || state === 'blocked') {
          btn.setAttribute('aria-current', 'step');
        } else {
          btn.removeAttribute('aria-current');
        }
      }
      const fill = item.querySelector('.apply-step-fill');
      if (fill) {
        const percent = state === 'active' && Number.isFinite(step.percent) ? step.percent : 0;
        fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      }
    });
  }

  function renderApplyProgress(progress) {
    if (!ensureApplyProgressDom()) return;

    const current = progress.steps[progress.currentIndex];
    const cue = document.getElementById('rbNextCue');
    if (cue) {
      cue.setAttribute(
        'aria-label',
        progress.complete
          ? 'Job application progress: registered'
          : `Job application progress: step ${progress.currentIndex + 1} of ${progress.total}, ${
              current?.label || ''
            }`
      );
    }

    const resetBtn = document.getElementById('applyProgressReset');
    if (resetBtn) resetBtn.hidden = progress.doneCount === 0;

    renderApplyStepper(progress);
    updateNextCue(progress);
  }

  function updateNextCue(progress) {
    const cue = document.getElementById('rbNextCue');
    const stepEl = document.getElementById('rbNextCueStep');
    const msgEl = document.getElementById('rbNextCueMsg');
    if (!cue) return;

    cue.classList.remove('is-complete', 'is-blocked', 'is-working');
    cue.dataset.focusStep = '';
    // The filled button already says what is next; speak up only for a problem,
    // work in progress, or the finish.
    cue.hidden = false;

    if (progress.complete) {
      if (stepEl) stepEl.textContent = `${progress.total} / ${progress.total}`;
      if (msgEl) msgEl.textContent = 'Done — job registered';
      else cue.textContent = 'Done — job registered';
      cue.classList.add('is-complete');
      cue.title = 'Bid pipeline complete';
      return;
    }

    const current = progress.steps[progress.currentIndex];
    if (!current) {
      if (stepEl) stepEl.textContent = `— / ${progress.total}`;
      if (msgEl) msgEl.textContent = 'Next: Continue the bid pipeline';
      cue.title = 'Continue the bid pipeline';
      return;
    }

    cue.dataset.focusStep = current.key;
    if (stepEl) stepEl.textContent = `${current.number} / ${progress.total}`;

    let message = current.nextCue || `Next: ${current.label}`;
    if (current.state === 'blocked' || current.state === 'warn') {
      message = current.reason ? `Fix: ${current.reason}` : message;
      cue.classList.add('is-blocked');
    } else if (current.state === 'active') {
      message = current.reason || 'Working…';
      cue.classList.add('is-working');
    }

    if (msgEl) msgEl.textContent = message;
    else cue.textContent = message;
    cue.title = `Go to step ${current.number}: ${current.label}`;
    // Step 1 has its own status line under the job description.
    const worthSaying = cue.classList.contains('is-blocked') || cue.classList.contains('is-working');
    cue.hidden = !worthSaying || current.key === 'job';
  }

  /** Clicking a step jumps to the control that advances it. */
  function focusApplyStep(key) {
    const step = APPLY_STEPS.find((s) => s.key === key);
    const el = step && document.getElementById(step.target);
    if (!el) return;
    const details = el.closest('details');
    if (details && !details.open) details.open = true;
    // Highlight job note block when focusing that step.
    if (key === 'job') {
      const block = document.getElementById('regNoteBlock');
      setNoteExpanded(true);
      if (block) {
        try {
          block.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (_) {
          block.scrollIntoView();
        }
      }
    }
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) {
      el.scrollIntoView();
    }
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  /** Buttons + note field reflect live pipeline state for glanceable bidding. */
  function syncApplyStepButtons(progress) {
    const actions = document.querySelector('.rb-actions');
    const noteBlock = document.getElementById('regNoteBlock');
    const current = progress.steps[progress.currentIndex];
    const currentKey = progress.complete ? '' : current?.key || '';

    if (actions) {
      actions.dataset.pipeline = '1';
      actions.dataset.currentStep = currentKey;
    }

    if (noteBlock) {
      const jobStep = progress.steps.find((s) => s.key === 'job');
      const jobCurrent =
        jobStep &&
        (jobStep.state === 'current' ||
          jobStep.state === 'active' ||
          jobStep.state === 'blocked' ||
          jobStep.state === 'warn');
      noteBlock.classList.toggle('is-current-step', Boolean(jobCurrent) && !progress.complete);
      noteBlock.classList.toggle('is-blocked-step', jobStep?.state === 'blocked' || jobStep?.state === 'warn');
      noteBlock.classList.toggle('is-done-step', jobStep?.state === 'done');
    }

    progress.steps.forEach((step) => {
      const isCurrent = step.state === 'current' || step.state === 'active';
      const isDone = step.state === 'done';
      const isBlocked = step.state === 'blocked' || step.state === 'warn';
      const isUpcoming = step.state === 'pending';

      document.querySelectorAll(`[data-step-btn="${step.key}"]`).forEach((btn) => {
        btn.classList.toggle('is-current-step', isCurrent);
        btn.classList.toggle('is-blocked-step', isBlocked && !isDone);
        btn.classList.toggle('is-done-step', isDone);
        btn.classList.toggle('is-upcoming-step', isUpcoming);
      });
    });
  }

  /** A loaded description collapses to one line; Edit brings the text back. */
  function setNoteExpanded(expanded) {
    const block = document.getElementById('regNoteBlock');
    const toggle = document.getElementById('regNoteToggle');
    if (!block) return;
    block.classList.toggle('is-expanded', Boolean(expanded));
    if (toggle) {
      toggle.textContent = expanded ? 'Hide' : 'Edit';
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }

  function wireNoteToggle() {
    const toggle = document.getElementById('regNoteToggle');
    if (!toggle || toggle.dataset.wired === '1') return;
    toggle.dataset.wired = '1';
    toggle.addEventListener('click', () => {
      const block = document.getElementById('regNoteBlock');
      const expand = !block?.classList.contains('is-expanded');
      setNoteExpanded(expand);
      if (expand) document.getElementById('regNote')?.focus({ preventScroll: true });
    });
  }

  function wireApplyNextCue() {
    wireNoteToggle();
    const cue = document.getElementById('rbNextCue');
    if (!cue || cue.dataset.wired === '1') return;
    cue.dataset.wired = '1';
    cue.addEventListener('click', () => {
      const key = cue.dataset.focusStep;
      if (key) focusApplyStep(key);
    });
  }

  function wireApplyProgressLiveInputs() {
    const note = document.getElementById('regNote');
    if (note && note.dataset.applyProgressWired !== '1') {
      note.dataset.applyProgressWired = '1';
      note._rbPrevLen = String(note.value || '').trim().length;
      note.addEventListener('input', (event) => {
        onRegisterNoteChanged(event, { programmatic: false });
      });
    }
    const profile = document.getElementById('regProfileId');
    if (profile && profile.dataset.applyProgressWired !== '1') {
      profile.dataset.applyProgressWired = '1';
      profile.addEventListener('change', () => {
        // A profile in the same city/state reuses the verdict; a different
        // location is a different question and is checked again.
        aiCompatPinned = false;
        if (!noteJdReadyForAi(document.getElementById('regNote'))) clearAiCompatResult();
        refreshApplyProgress();
        scheduleBidFitRefresh({ immediateAi: true });
      });
    }
  }

  function refreshApplyProgress() {
    const progress = computeApplyProgress();
    renderApplyProgress(progress);
    syncApplyStepButtons(progress);
    return progress;
  }

  function syncResumeBuilderActionButtons({ registerBusy = false } = {}) {
    const generateBtn = document.getElementById('regGenerateFilesBtn');
    const registerBtn = document.getElementById('registerJobBtn');
    const buildBtn = document.getElementById('regBuildCopyPromptBtn');

    if (generateBtn && !generateBtn.classList.contains('is-loading')) {
      generateBtn.disabled = false;
      generateBtn.title = 'Convert JSON via local json2docx and attach files';
    }

    if (registerBtn && !registerBtn.classList.contains('is-loading')) {
      const blockedByDuplicate = jobLinkDuplicateActive;
      registerBtn.disabled = Boolean(registerBusy) || blockedByDuplicate;
      registerBtn.title = blockedByDuplicate
        ? 'Duplicate job link — already in Resume DB for this profile'
        : 'Register this job to Resume DB';
    }

    if (buildBtn && !buildBtn.classList.contains('is-loading')) {
      const profileId = document.getElementById('regProfileId')?.value?.trim();
      const fitBlocked = lastBidFitResult?.level === 'blocked';
      // Wait for the verdict; the request timeout bounds how long this lasts.
      const fitChecking = Boolean(lastBidFitResult?.aiChecking);
      buildBtn.disabled = !profileId || fitBlocked || fitChecking;
      if (!profileId) {
        buildBtn.title = 'Select a profile first';
      } else if (fitChecking) {
        buildBtn.title = 'Checking compatibility…';
      } else if (fitBlocked) {
        buildBtn.title =
          lastBidFitResult.reasons?.[0]?.message ||
          'Preflight: skip — don’t waste a ChatGPT run';
      } else if (lastBidFitResult?.level === 'risky') {
        buildBtn.title = 'Preflight weak — you can still copy if you want to try';
      } else {
        buildBtn.title = 'Build final prompt from kit + Note and copy to clipboard';
      }
    }

    const autofillBtn = document.getElementById('regAutofillBtn');
    const profileId = document.getElementById('regProfileId')?.value?.trim();
    if (autofillBtn && !autofillBtn.classList.contains('is-loading')) {
      const canAutofill = backendConnected && Boolean(profileId);
      autofillBtn.disabled = !canAutofill;
      if (!backendConnected) {
        autofillBtn.title = 'Sign in under Settings to Autofill from a website profile';
      } else if (!profileId) {
        autofillBtn.title = 'Select a profile to Autofill this page';
      } else {
        autofillBtn.title = 'Fill the current job page from the selected website profile';
      }
    }
    const autofillAiBtn = document.getElementById('fillSelectedAiBtn');
    if (autofillAiBtn && !autofillAiBtn.classList.contains('is-loading')) {
      autofillAiBtn.disabled = !(backendConnected && Boolean(profileId));
    }

    refreshApplyProgress();
    syncOptimizedActionButtons({ registerBusy });
  }

  function syncOptimizedActionButtons({ registerBusy = false } = {}) {
    const profileId = document.getElementById('regProfileId')?.value?.trim();
    const pairs = [
      ['optGenerateFilesBtn', 'regGenerateFilesBtn'],
      ['optRegisterBtn', 'registerJobBtn'],
      ['optAutofillBtn', 'regAutofillBtn'],
      ['optBuildCopyPromptBtn', 'regBuildCopyPromptBtn'],
    ];
    pairs.forEach(([optId, sourceId]) => {
      const opt = document.getElementById(optId);
      const source = document.getElementById(sourceId);
      if (!opt) return;
      if (source) {
        opt.disabled = Boolean(source.disabled);
        if (source.title) opt.title = source.title;
      }
    });

    const optAutofill = document.getElementById('optAutofillBtn');
    if (optAutofill && !optAutofill.classList.contains('is-loading')) {
      optAutofill.disabled = !(backendConnected && profileId);
    }

    const websiteDot = document.getElementById('backendConnectionDot');
    const driveDot = document.getElementById('driveConnectionDot');
    const j2dDot = document.getElementById('json2docxConnectionDot');
    const mirrorDot = (from, toId) => {
      const to = document.getElementById(toId);
      if (!to || !from) return;
      to.className = from.className;
      to.title = from.title || to.title;
    };
    mirrorDot(websiteDot, 'optWebsiteDot');
    mirrorDot(driveDot, 'optDriveDot');
    mirrorDot(j2dDot, 'optJson2docxDot');

    try {
      if (typeof publishOptUiState === 'function') publishOptUiState();
      else if (typeof window.publishOptUiState === 'function') window.publishOptUiState();
    } catch (_) {
      /* ignore */
    }
  }

  const FIELD_DUP_BUTTON_IDS = [
    'regCompanyDupBtn',
    'regJobLinkDupBtn'
  ];
  const FIELD_BLOCK_BUTTON_IDS = ['regJobLinkBlockBtn'];

  function syncJobLinkBlockButton() {
    const btn = document.getElementById('regJobLinkBlockBtn');
    const jobLink = document.getElementById('regJobLink')?.value?.trim();
    if (!btn) return;
    btn.disabled = !backendConnected || !jobLink;
  }

  function setFieldDupBusy(buttonId, busy) {
    FIELD_DUP_BUTTON_IDS.forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (busy) {
        btn.disabled = true;
        btn.classList.toggle('is-busy', id === buttonId);
      } else {
        btn.disabled = !backendConnected;
        btn.classList.remove('is-busy');
      }
    });
  }


  /** Loose compare key: ignores case, spaces, punctuation, accents. */
  function normalizeMatchKey(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function hasMatchKey(value) {
    return normalizeMatchKey(value).length > 0;
  }

  function matchKeysEqual(a, b) {
    const left = normalizeMatchKey(a);
    const right = normalizeMatchKey(b);
    if (!left || !right) return false;
    return left === right;
  }

  function companyNameApi() {
    return global.SmartJobCompanyName || null;
  }

  function normalizeCompanyKey(value) {
    const api = companyNameApi();
    if (api?.normalizeCompanyName) return api.normalizeCompanyName(value);
    return normalizeMatchKey(value);
  }

  function companiesMatchNames(a, b) {
    const api = companyNameApi();
    if (api?.companiesMatch) return api.companiesMatch(a, b);
    return matchKeysEqual(a, b);
  }

  function companyMatchLevelNames(a, b) {
    const api = companyNameApi();
    if (api?.companyMatchLevel) return api.companyMatchLevel(a, b);
    return companiesMatchNames(a, b) ? 'definite' : 'none';
  }

  function applicationSameCompany(app, job) {
    return (
      companiesMatchNames(app.company, job.companyName) &&
      hasMatchKey(job.companyName)
    );
  }

  function setCompanyDuplicateLevel(level) {
    companyDuplicateLevel = level === 'definite' || level === 'possible' ? level : 'none';
    syncResumeBuilderActionButtons();
  }

  function jobUrlApi() {
    return global.SmartJobJobUrl || null;
  }

  function canonicalJobLinkKey(value) {
    const api = jobUrlApi();
    if (api?.canonicalJobUrl) return api.canonicalJobUrl(value);
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      const path = u.pathname.replace(/\/+$/, '') || '';
      return `${u.hostname}${path}`.toLowerCase();
    } catch {
      return '';
    }
  }

  function applicationSameJobLink(app, jobLink) {
    const api = jobUrlApi();
    if (api?.jobLinksMatch) return api.jobLinksMatch(app.jobLink, jobLink);
    const left = canonicalJobLinkKey(app.jobLink);
    const right = canonicalJobLinkKey(jobLink);
    if (!left || !right) return false;
    return left === right;
  }

  function setJobLinkDuplicateState(active) {
    jobLinkDuplicateActive = Boolean(active);
    syncResumeBuilderActionButtons();
  }

  function formatApplicationSummary(app, fallback) {
    const when = app.appliedAt
      ? new Date(app.appliedAt).toLocaleDateString()
      : app.date || '';
    const detail = [app.jobTitle || fallback.jobTitle, app.company || fallback.companyName]
      .filter(Boolean)
      .join(' at ');
    return { when, detail };
  }

  function normalizeDuplicateWindowDays(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_DUPLICATE_CHECK_WINDOW_DAYS;
    return Math.min(n, 365);
  }

  async function getDuplicateCheckWindowDays() {
    return new Promise((resolve) => {
      chrome.storage.local.get([DUPLICATE_CHECK_WINDOW_DAYS_KEY], (result) => {
        const stored = result[DUPLICATE_CHECK_WINDOW_DAYS_KEY];
        if (stored === undefined || stored === null || stored === '') {
          resolve(DEFAULT_DUPLICATE_CHECK_WINDOW_DAYS);
          return;
        }
        resolve(normalizeDuplicateWindowDays(stored));
      });
    });
  }

  async function saveDuplicateCheckWindowDays(days) {
    const normalized = normalizeDuplicateWindowDays(days);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [DUPLICATE_CHECK_WINDOW_DAYS_KEY]: normalized }, resolve);
    });
  }

  function getApplicationAppliedTime(app) {
    const raw = app.appliedAt || app.date || '';
    if (!raw) return null;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? null : time;
  }

  /** 0 = all time; otherwise rolling window from now minus N days. */
  function isWithinDuplicateCheckWindow(app, windowDays) {
    if (!windowDays || windowDays <= 0) return true;
    const applied = getApplicationAppliedTime(app);
    if (applied == null) return true;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return applied >= cutoff;
  }

  function duplicateWindowLabel(windowDays) {
    if (!windowDays || windowDays <= 0) return ' (all time)';
    return ` (last ${windowDays} day${windowDays === 1 ? '' : 's'})`;
  }

  async function loadDuplicateWindowSetting() {
    const input = document.getElementById('duplicateWindowDaysSetting');
    if (!input) return;
    const days = await getDuplicateCheckWindowDays();
    input.value = String(days);
  }

  function wireDuplicateWindowSetting() {
    const input = document.getElementById('duplicateWindowDaysSetting');
    if (!input) return;

    void loadDuplicateWindowSetting();

    const persist = () => {
      void saveDuplicateCheckWindowDays(input.value).then(() => {
        input.value = String(normalizeDuplicateWindowDays(input.value));
      });
    };

    input.addEventListener('change', persist);
    input.addEventListener('blur', persist);
  }

  async function fetchResumeDbApplications(options = {}) {
    const { force = false } = options;
    const now = Date.now();
    if (
      !force &&
      Array.isArray(applicationsCache.resumes) &&
      applicationsCache.at &&
      now - applicationsCache.at < APPLICATIONS_CACHE_TTL_MS
    ) {
      return applicationsCache.resumes;
    }

    // The list endpoint pages at 25 by default. Reading only the first page
    // meant a job registered 26+ applications ago was no longer seen as a
    // duplicate. Read every page, at the largest size the endpoint allows.
    const config = await getBackendConfig();
    const resumes = [];
    for (let page = 1; page <= APPLICATIONS_MAX_PAGES; page += 1) {
      const res = await fetch(
        `${config.baseUrl}/api/resume-db?page=${page}&pageSize=${APPLICATIONS_PAGE_SIZE}`,
        { headers: apiHeaders(config), cache: 'no-store' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load Resume DB applications');
      }
      const rows = Array.isArray(data.resumes) ? data.resumes : [];
      resumes.push(...rows);
      if (rows.length < APPLICATIONS_PAGE_SIZE) break;
    }
    applicationsCache = { at: now, resumes };
    return resumes;
  }

  function invalidateApplicationsCache() {
    applicationsCache = { at: 0, resumes: null };
  }

  async function checkFieldDuplicate(field, showStatus, { quietIfNone = false } = {}) {
    const connected = await checkBackendConnection({ skipDriveBadge: true });
    if (!connected) {
      throw new Error(
        'Not signed in. Open Settings → Website connection and sign in to check Resume DB.'
      );
    }

    const profileId = document.getElementById('regProfileId')?.value?.trim();
    if (!profileId) {
      throw new Error('Select a profile first.');
    }

    const fields = readRegisterFormFields();
    const configs = {
      company: {
        value: fields.companyName,
        emptyError: 'Enter a company to check.',
        label: 'Company',
        matches: (app) => applicationSameCompany(app, fields)
      },
      link: {
        value: fields.jobLink,
        emptyError: 'Enter a job link to check.',
        label: 'Job link',
        matches: (app) => applicationSameJobLink(app, fields.jobLink)
      }
    };
    const config = configs[field];
    if (!config) throw new Error('Unknown field for duplicate check.');
    if (!String(config.value || '').trim()) {
      throw new Error(config.emptyError);
    }

    setRegisterStatus(`Checking ${config.label.toLowerCase()} in Resume DB…`, 'info');
    const windowDays = await getDuplicateCheckWindowDays();
    const windowSuffix = duplicateWindowLabel(windowDays);
    const tabToken = tabSession()?.getGeneration();
    const applications = await fetchResumeDbApplications();
    // The user switched tabs while the list loaded: this answer is about the
    // other tab's job and must not set this one's duplicate flags.
    if (tabSession() && !tabSession().isCurrentGeneration(tabToken)) {
      return { level: 'none', match: null, windowDays, field, stale: true };
    }
    const forCandidate = applications
      .filter((app) => String(app.profileId) === String(profileId))
      .filter((app) => isWithinDuplicateCheckWindow(app, windowDays));

    if (field === 'company') {
      let definiteMatch = null;
      let possibleMatch = null;
      for (const app of forCandidate) {
        const level = companyMatchLevelNames(app.company, fields.companyName);
        if (level === 'definite') {
          definiteMatch = app;
          break;
        }
        if (level === 'possible' && !possibleMatch) {
          possibleMatch = app;
        }
      }

      if (definiteMatch) {
        const { when, detail } = formatApplicationSummary(definiteMatch, fields);
        const message = `Duplicate company — already in Resume DB for this profile${windowSuffix}${
          when ? ` (${when}${detail ? `: ${detail}` : ''})` : detail ? ` (${detail})` : ''
        }.`;
        if (!jobLinkDuplicateActive) {
          setRegisterStatus(message, 'error');
          if (showStatus) showStatus('Duplicate company for this profile.', 'error');
        }
        setCompanyDuplicateLevel('definite');
        return { level: 'duplicate', match: definiteMatch, windowDays, field };
      }

      if (possibleMatch) {
        const { when, detail } = formatApplicationSummary(possibleMatch, fields);
        const registeredCompany = possibleMatch.company || 'registered company';
        const message = `Possible duplicate company — similar to "${registeredCompany}" in Resume DB for this profile${windowSuffix}${
          when ? ` (${when}${detail ? `: ${detail}` : ''})` : detail ? ` (${detail})` : ''
        }.`;
        if (!jobLinkDuplicateActive) {
          setRegisterStatus(message, 'warn');
          if (showStatus) showStatus('Possible duplicate company for this profile.', 'warn');
        }
        setCompanyDuplicateLevel('possible');
        return { level: 'possible', match: possibleMatch, windowDays, field };
      }

      setCompanyDuplicateLevel('none');
      const noCompanyMessage =
        windowDays > 0
          ? `No matching company in the last ${windowDays} day${windowDays === 1 ? '' : 's'} for this profile.`
          : 'No matching company for this profile.';
      if (!quietIfNone && !jobLinkDuplicateActive) {
        setRegisterStatus(noCompanyMessage, 'success');
        if (showStatus) showStatus(noCompanyMessage, 'success');
      }
      return { level: 'none', match: null, windowDays, field };
    }

    const match = forCandidate.find((app) => config.matches(app));
    if (match) {
      const { when, detail } = formatApplicationSummary(match, fields);
      const message = `Duplicate ${config.label.toLowerCase()} — already in Resume DB for this profile${windowSuffix}${
        when ? ` (${when}${detail ? `: ${detail}` : ''})` : detail ? ` (${detail})` : ''
      }.`;
      setRegisterStatus(message, 'error');
      if (showStatus) showStatus(`Duplicate ${config.label.toLowerCase()} for this profile.`, 'error');
      if (field === 'link') setJobLinkDuplicateState(true);
      return { level: 'duplicate', match, windowDays, field };
    }

    if (field === 'link') setJobLinkDuplicateState(false);

    const noMatchMessage =
      windowDays > 0
        ? `No matching ${config.label.toLowerCase()} in the last ${windowDays} day${
            windowDays === 1 ? '' : 's'
          } for this profile.`
        : `No matching ${config.label.toLowerCase()} for this profile.`;
    if (!quietIfNone) {
      setRegisterStatus(noMatchMessage, 'success');
      if (showStatus) showStatus(noMatchMessage, 'success');
    }
    return { level: 'none', match: null, windowDays, field };
  }

  function scheduleJobLinkDuplicateCheck(showStatus, { force = false } = {}) {
    const key = canonicalJobLinkKey(document.getElementById('regJobLink')?.value);
    if (!key) {
      lastAutoCheckedJobLinkKey = '';
      setJobLinkDuplicateState(false);
      return;
    }
    if (!force && key === lastAutoCheckedJobLinkKey) return;
    if (jobLinkDupTimer) clearTimeout(jobLinkDupTimer);
    jobLinkDupTimer = setTimeout(() => {
      void runAutoJobLinkDuplicateCheck(showStatus, { force });
    }, 450);
  }

  async function runAutoJobLinkDuplicateCheck(showStatus, { force = false } = {}) {
    const key = canonicalJobLinkKey(document.getElementById('regJobLink')?.value);
    if (!key) {
      lastAutoCheckedJobLinkKey = '';
      setJobLinkDuplicateState(false);
      return;
    }
    if (!force && key === lastAutoCheckedJobLinkKey) return;
    if (!backendConnected) return;
    const profileId = document.getElementById('regProfileId')?.value?.trim();
    if (!profileId) return;

    lastAutoCheckedJobLinkKey = key;
    try {
      await checkFieldDuplicate('link', showStatus, { quietIfNone: true });
    } catch (_) {
      lastAutoCheckedJobLinkKey = '';
      setJobLinkDuplicateState(false);
    }
  }

  function notifyRegisterJobLinkFilled(showStatus, { force = false } = {}) {
    if (isRestoringSession) return;
    scheduleJobLinkDuplicateCheck(showStatus, { force });
  }

  function wireJobLinkDuplicateAutoCheck(showStatus) {
    const input = document.getElementById('regJobLink');
    if (!input || input.dataset.linkDupWired === '1') return;
    input.dataset.linkDupWired = '1';
    const onEdit = () => {
      lastAutoCheckedJobLinkKey = '';
      scheduleJobLinkDuplicateCheck(showStatus);
    };
    input.addEventListener('input', onEdit);
    input.addEventListener('change', onEdit);
  }

  function scheduleCompanyDuplicateCheck(showStatus, { force = false } = {}) {
    const key = normalizeCompanyKey(document.getElementById('regCompany')?.value);
    if (!key) {
      lastAutoCheckedCompanyKey = '';
      setCompanyDuplicateLevel('none');
      return;
    }
    if (!force && key === lastAutoCheckedCompanyKey) return;
    if (companyDupTimer) clearTimeout(companyDupTimer);
    companyDupTimer = setTimeout(() => {
      void runAutoCompanyDuplicateCheck(showStatus, { force });
    }, 450);
  }

  async function runAutoCompanyDuplicateCheck(showStatus, { force = false } = {}) {
    const key = normalizeCompanyKey(document.getElementById('regCompany')?.value);
    if (!key) {
      lastAutoCheckedCompanyKey = '';
      setCompanyDuplicateLevel('none');
      return;
    }
    if (!force && key === lastAutoCheckedCompanyKey) return;
    if (!backendConnected) return;
    const profileId = document.getElementById('regProfileId')?.value?.trim();
    if (!profileId) return;

    lastAutoCheckedCompanyKey = key;
    try {
      await checkFieldDuplicate('company', showStatus, { quietIfNone: true });
    } catch (_) {
      lastAutoCheckedCompanyKey = '';
      setCompanyDuplicateLevel('none');
    }
  }

  function notifyRegisterCompanyFilled(showStatus, { force = false } = {}) {
    if (isRestoringSession) return;
    scheduleCompanyDuplicateCheck(showStatus, { force });
  }

  function wireCompanyDuplicateAutoCheck(showStatus) {
    const input = document.getElementById('regCompany');
    if (!input || input.dataset.companyDupWired === '1') return;
    input.dataset.companyDupWired = '1';
    const onEdit = () => {
      lastAutoCheckedCompanyKey = '';
      scheduleCompanyDuplicateCheck(showStatus);
    };
    input.addEventListener('input', onEdit);
    input.addEventListener('change', onEdit);
  }

  function scheduleCompanyDuplicateCheckFromResumeJson(companyName, showStatus) {
    const key = normalizeCompanyKey(companyName);
    if (!key) return;
    if (key === lastAutoCheckedCompanyKey) return;
    if (resumeJsonDupTimer) clearTimeout(resumeJsonDupTimer);
    resumeJsonDupTimer = setTimeout(() => {
      void runAutoCompanyDuplicateCheck(showStatus, { force: true });
    }, 450);
  }

  async function blockCurrentJobFromRegister(showStatus) {
    const connected = await checkBackendConnection();
    if (!connected) {
      throw new Error(
        'Not signed in. Open Settings → Website connection and sign in to block jobs.'
      );
    }

    const jobLink = document.getElementById('regJobLink')?.value?.trim();
    if (!jobLink) {
      throw new Error('Job link is required to block this job.');
    }

    const jobTitle = document.getElementById('regJobTitle')?.value?.trim() || '';
    const companyName = document.getElementById('regCompany')?.value?.trim() || '';
    const config = await getBackendConfig();
    const res = await fetch(`${config.baseUrl}/api/job-scraper/blocked-jobs`, {
      method: 'POST',
      headers: { ...apiHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobLink, jobTitle, companyName })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to block job.');
    }

    const message = data.alreadyBlocked
      ? 'This job is already on your blocked list.'
      : 'Job blocked — it will be hidden in the website job scraper.';
    setRegisterStatus(message, data.alreadyBlocked ? 'warn' : 'success');
    if (showStatus) showStatus(message, data.alreadyBlocked ? 'warn' : 'success');
    return data;
  }

  function wireRegisterFieldBlock(buttonId, showStatus) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.add('is-busy');
      try {
        await blockCurrentJobFromRegister(showStatus);
      } catch (err) {
        const msg = err.message || String(err);
        setRegisterStatus(msg, 'error');
        if (showStatus) showStatus(msg, 'error');
      } finally {
        btn.classList.remove('is-busy');
        syncJobLinkBlockButton();
      }
    });
  }

  function wireJobLinkBlockAutoSync() {
    const input = document.getElementById('regJobLink');
    if (!input || input.dataset.blockSyncWired === '1') return;
    input.dataset.blockSyncWired = '1';
    const onEdit = () => syncJobLinkBlockButton();
    input.addEventListener('input', onEdit);
    input.addEventListener('change', onEdit);
  }

  function setConnectionStatus(state, detail, username) {
    const headerChip = document.getElementById('rbChipWebsite');
    const headerLabel = document.getElementById('backendConnectionLabel');
    const headerDot = document.getElementById('backendConnectionDot');
    const settingsDot = document.getElementById('settingsBackendConnectionDot');
    const settingsLabel = document.getElementById('settingsBackendConnectionLabel');

    const websiteDetail =
      detail ||
      (state === 'ok'
        ? username
          ? `Signed in · ${username}`
          : 'Connected'
        : state === 'checking'
          ? 'Checking…'
          : 'Not connected');

    if (headerDot) headerDot.className = 'backend-connection-dot is-' + state;
    if (headerLabel) headerLabel.textContent = 'Website';
    if (headerChip) {
      headerChip.dataset.websiteDetail = websiteDetail;
      refreshWebsiteChipTitle();
    }

    if (settingsDot) settingsDot.className = 'backend-connection-dot is-' + state;
    if (settingsLabel) {
      if (state === 'ok' && username) {
        settingsLabel.innerHTML =
          'Signed in · <strong class="backend-connection-user">' +
          escapeHtml(username) +
          '</strong>';
      } else {
        settingsLabel.textContent = websiteDetail;
      }
    }
    syncRbStatusChips();
  }

  function refreshWebsiteChipTitle() {
    const headerChip = document.getElementById('rbChipWebsite');
    if (!headerChip) return;
    const websiteDetail = headerChip.dataset.websiteDetail || 'Website connection';
    const driveDetail = headerChip.dataset.driveDetail || '';
    headerChip.title = driveDetail ? `${websiteDetail} · ${driveDetail}` : websiteDetail;
  }

  function setDriveConnectionUi({ state, detail }) {
    const driveDot = document.getElementById('driveConnectionDot');
    const driveLabel = document.getElementById('driveConnectionLabel');
    const headerChip = document.getElementById('rbChipWebsite');
    if (driveDot) {
      driveDot.className = 'backend-connection-dot' + (state ? ` is-${state}` : '');
      driveDot.title = detail || 'Google Drive';
    }
    if (driveLabel) {
      driveLabel.textContent = 'GDrive';
      driveLabel.title = detail || 'Google Drive';
    }
    if (headerChip) {
      headerChip.dataset.driveDetail = detail || '';
      refreshWebsiteChipTitle();
    }
    syncRbStatusChips();
  }

  function updateBackendDependentUi(connected) {
    backendConnected = connected;

    const profileSelect = document.getElementById('regProfileId');
    const offlineBanner = document.getElementById('registerOfflineBanner');
    const registerTabBtn = document.getElementById('registerTabBtn');
    const signedInAs = document.getElementById('backendSignedInAs');
    const signedInUser = document.getElementById('backendSignedInUser');

    syncResumeBuilderActionButtons();
    FIELD_DUP_BUTTON_IDS.forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !connected;
    });
    FIELD_BLOCK_BUTTON_IDS.forEach((id) => {
      const btn = document.getElementById(id);
      if (btn && id !== 'regJobLinkBlockBtn') btn.disabled = !connected;
    });
    syncJobLinkBlockButton();
    if (profileSelect) profileSelect.disabled = !connected;
    if (offlineBanner) offlineBanner.hidden = true;
    if (registerTabBtn) registerTabBtn.classList.toggle('is-auth-required', !connected);

    void getBackendConfig().then((config) => {
      if (signedInAs && signedInUser) {
        if (connected && config.username) {
          signedInUser.textContent = config.username;
          signedInAs.hidden = false;
        } else {
          signedInAs.hidden = true;
        }
      }
    });
  }

  async function loadBackendSettingsForm() {
    const config = await getBackendConfig();
    const urlInput = document.getElementById('backendUrlSetting');
    const usernameInput = document.getElementById('backendUsernameSetting');
    const passwordInput = document.getElementById('backendPasswordSetting');
    const signedInAs = document.getElementById('backendSignedInAs');
    const signedInUser = document.getElementById('backendSignedInUser');

    if (urlInput) urlInput.value = config.baseUrl;
    if (usernameInput) {
      usernameInput.value = config.username || usernameInput.value || '';
    }
    if (passwordInput) passwordInput.value = '';

    if (signedInAs && signedInUser) {
      if (config.username && config.extensionApiKey) {
        signedInUser.textContent = config.username;
        signedInAs.hidden = false;
      } else {
        signedInAs.hidden = true;
      }
    }
  }

  async function loginWithCredentials(baseUrl, username, password) {
    const res = await fetch(`${normalizeBackendUrl(baseUrl)}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Sign in failed (${res.status})`);
    }
    if (!data.extensionApiKey) {
      throw new Error('Server did not return an extension key. Update the backend and try again.');
    }
    await saveAuthConfig({
      baseUrl,
      username: data.user?.username || username,
      userId: data.user?.id || '',
      extensionApiKey: data.extensionApiKey
    });
    return data;
  }

  async function checkBackendConnection(options = {}) {
    const { force = false, skipDriveBadge = false } = options;
    const now = Date.now();
    if (
      !force &&
      authCache.checkedAt &&
      now - authCache.checkedAt < AUTH_CACHE_TTL_MS &&
      authCache.ok
    ) {
      setConnectionStatus('ok', null, authCache.username || undefined);
      updateBackendDependentUi(true);
      backendConnected = true;
      if (!skipDriveBadge) {
        // Use cached drive badge if fresh; don't block.
        if (!driveStatusCacheAt || now - driveStatusCacheAt >= DRIVE_CACHE_TTL_MS) {
          void updateRegisterDriveBadge();
        }
      }
      return true;
    }

    setConnectionStatus('checking', 'Checking…');
    const config = await getBackendConfig();

    if (!isAuthenticated(config)) {
      authCache = { ok: false, checkedAt: now, username: '' };
      setConnectionStatus('error', 'Not signed in — open Settings');
      updateBackendDependentUi(false);
      if (!skipDriveBadge) await updateRegisterDriveBadge();
      return false;
    }

    try {
      const res = await fetch(`${config.baseUrl}/api/auth/me`, {
        headers: apiHeaders(config),
        credentials: 'include',
        cache: 'no-store'
      });
      if (!res.ok) {
        if (res.status === 401) await clearAuthConfig();
        throw new Error('Unauthorized');
      }
      const data = await res.json().catch(() => ({}));
      const username = data.user?.username || config.username;
      authCache = { ok: true, checkedAt: now, username: username || '' };
      setConnectionStatus('ok', null, username);
      updateBackendDependentUi(true);
      backendConnected = true;
      if (!skipDriveBadge) await updateRegisterDriveBadge();
      return true;
    } catch (err) {
      authCache = { ok: false, checkedAt: now, username: '' };
      const host = config.baseUrl.replace(/^https?:\/\//, '');
      setConnectionStatus('error', 'Not connected · ' + host);
      updateBackendDependentUi(false);
      if (!skipDriveBadge) await updateRegisterDriveBadge();
      return false;
    }
  }

  async function fetchWebsiteDriveStatus(options = {}) {
    const { force = false } = options;
    const now = Date.now();
    if (
      !force &&
      websiteDriveStatus &&
      driveStatusCacheAt &&
      now - driveStatusCacheAt < DRIVE_CACHE_TTL_MS
    ) {
      return websiteDriveStatus;
    }

    const config = await getBackendConfig();
    if (!isAuthenticated(config)) {
      websiteDriveStatus = null;
      driveStatusCacheAt = 0;
      return null;
    }
    try {
      const res = await fetch(`${config.baseUrl}/api/integrations/google-drive/status`, {
        headers: apiHeaders(config),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load Drive status');
      websiteDriveStatus = data;
      driveStatusCacheAt = now;
      return data;
    } catch {
      websiteDriveStatus = null;
      driveStatusCacheAt = 0;
      return null;
    }
  }

  async function updateRegisterDriveBadge() {
    // Legacy standalone Drive badge removed — status lives on the Website chip.
    const legacy = document.getElementById('registerDriveStatus');
    if (legacy) legacy.hidden = true;

    if (!backendConnected) {
      setDriveConnectionUi({ state: 'error', detail: 'Drive unavailable (sign in first)' });
      return;
    }

    const status = (await fetchWebsiteDriveStatus()) || websiteDriveStatus;
    if (!status) {
      setDriveConnectionUi({ state: 'error', detail: 'Drive status unavailable' });
      return;
    }

    if (status.connected) {
      setDriveConnectionUi({
        state: 'ok',
        detail: status.googleEmail
          ? `Drive ready · ${status.googleEmail}`
          : 'Drive ready',
      });
      return;
    }

    if (status.serviceAccountConfigured) {
      setDriveConnectionUi({
        state: 'checking',
        detail: 'Uploads use server Drive (connect personal Drive in website Settings)',
      });
      return;
    }

    setDriveConnectionUi({
      state: 'error',
      detail: 'Connect Google Drive on the website Settings page',
    });
  }

  function registerNeedsFileUpload(resumeIsDefault, coverIsDefault, resumeFile, coverFile) {
    const hasResumeFile = Boolean(resumeFile);
    const hasCoverFile = Boolean(coverFile && coverFile.size > 0);
    return (
      (hasResumeFile && !resumeIsDefault) || (hasCoverFile && !coverIsDefault)
    );
  }

  async function ensureCanUploadFiles(resumeIsDefault, coverIsDefault, resumeFile, coverFile) {
    const needsUpload = registerNeedsFileUpload(
      resumeIsDefault,
      coverIsDefault,
      resumeFile,
      coverFile
    );
    if (!needsUpload && !resumeIsDefault) return;

    const status = (await fetchWebsiteDriveStatus()) || websiteDriveStatus;

    if (resumeIsDefault && !resumeFile && !status?.defaultResumeUrl) {
      throw new Error(
        'Default resume link is not set. Add it on the website under Settings → Google Drive.'
      );
    }

    if (needsUpload && !status) {
      throw new Error(
        'Could not check Google Drive status — check the website connection and try again.'
      );
    }

    if (needsUpload && !status?.connected && !status?.serviceAccountConfigured) {
      throw new Error(
        'Connect Google Drive on the website Settings page before uploading files from the extension.'
      );
    }
  }

  async function getSelectedProfileId() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SELECTED_PROFILE_KEY], (result) => {
        resolve(String(result[SELECTED_PROFILE_KEY] || '').trim());
      });
    });
  }

  async function saveSelectedProfileId(profileId) {
    const id = String(profileId || '').trim();
    return new Promise((resolve) => {
      if (id) {
        chrome.storage.local.set({ [SELECTED_PROFILE_KEY]: id }, resolve);
      } else {
        chrome.storage.local.remove(SELECTED_PROFILE_KEY, resolve);
      }
    });
  }

  function restoreProfileSelection(select, profiles, preferredId) {
    if (!select || !preferredId) return;
    const match = profiles.some((p) => String(p.id) === String(preferredId));
    if (match) select.value = String(preferredId);
  }

  function wireProfileSelectPersistence() {
    const select = document.getElementById('regProfileId');
    if (!select || select.dataset.persistenceWired === '1') return;
    select.dataset.persistenceWired = '1';
    // The side panel and the on-page overlay are separate documents; a profile
    // picked in one must not leave the other bidding as someone else.
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[SELECTED_PROFILE_KEY]) return;
        const next = String(changes[SELECTED_PROFILE_KEY].newValue || '').trim();
        if (next === String(select.value || '').trim()) return;
        if (next && ![...select.options].some((option) => option.value === next)) return;
        select.value = next;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    select.addEventListener('change', () => {
      void saveSelectedProfileId(select.value);
      promptKitEditorDirty = false;
      void refreshPromptKitUi({ fillEditor: true, syncRemote: true });
      lastAutoCheckedJobLinkKey = '';
      lastAutoCheckedCompanyKey = '';
      scheduleJobLinkDuplicateCheck(null);
      scheduleCompanyDuplicateCheck(null);
      syncResumeBuilderActionButtons();
    });
  }

  async function loadProfilesIntoSelect() {
    const select = document.getElementById('regProfileId');
    if (!select) return;

    const config = await getBackendConfig();
    if (!isAuthenticated(config)) {
      select.innerHTML = '<option value="">Sign in to load profiles</option>';
      select.disabled = true;
      void refreshPromptKitUi();
      syncResumeBuilderActionButtons();
      return;
    }

    const loadSeq = ++profilesLoadSeq;
    const preservedId = select.value?.trim() || (await getSelectedProfileId());

    select.innerHTML = '<option value="">Loading profiles…</option>';
    select.disabled = true;

    try {
      const res = await fetch(`${config.baseUrl}/api/profiles`, {
        headers: apiHeaders(config),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (loadSeq !== profilesLoadSeq) return;

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load profiles');
      }

      const profiles = data.profiles || [];
      if (!profiles.length) {
        select.innerHTML =
          '<option value="">No profiles — add them on the website /profile page</option>';
        syncResumeBuilderActionButtons();
        return;
      }

      select.innerHTML =
        '<option value="">Select profile…</option>' +
        profiles
          .map(
            (p) =>
              `<option value="${p.id}">${escapeHtml(p.full_name || 'Profile ' + p.id)}</option>`
          )
          .join('');
      select.disabled = !backendConnected;
      restoreProfileSelection(select, profiles, preservedId);
      await refreshPromptKitUi({ syncRemote: true });
      scheduleJobLinkDuplicateCheck(null, { force: true });
      scheduleCompanyDuplicateCheck(null, { force: true });
      syncResumeBuilderActionButtons();
    } catch (err) {
      if (loadSeq !== profilesLoadSeq) return;
      const msg = err.message || 'Failed to load profiles';
      select.innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
      if (/fetch|network|failed/i.test(msg)) {
        select.innerHTML = '<option value="">Not connected — sign in under Settings</option>';
      }
      void refreshPromptKitUi();
      syncResumeBuilderActionButtons();
    }
  }

  async function fetchProfileRecord(profileId) {
    const id = String(profileId || '').trim();
    if (!id) return null;
    const config = await getBackendConfig();
    if (!isAuthenticated(config)) {
      throw new Error('Not signed in. Open Settings and sign in first.');
    }
    const res = await fetch(`${config.baseUrl}/api/profiles?full=1`, {
      headers: apiHeaders(config),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to load profile (${res.status}).`);
    }
    const list = Array.isArray(data.profiles) ? data.profiles : [];
    return list.find((profile) => String(profile.id) === id) || null;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const RESUME_ACCEPT = ['.pdf', '.docx', '.doc'];
  const COVER_ACCEPT = ['.pdf', '.docx', '.doc', '.txt'];

  function fileExtension(name) {
    const parts = String(name || '').toLowerCase().split('.');
    return parts.length > 1 ? '.' + parts.pop() : '';
  }

  function isAllowedFile(file, allowedExts) {
    if (!file) return false;
    return allowedExts.includes(fileExtension(file.name));
  }

  function readFileInput(input) {
    const file = input?.files?.[0];
    return file || null;
  }

  function scoreCoverName(name) {
    const n = String(name || '').toLowerCase();
    let score = 0;
    if (/cover/.test(n)) score += 3;
    if (/(^|[^a-z])cl([^a-z]|$)/.test(n)) score += 2;
    if (/letter/.test(n)) score += 2;
    if (fileExtension(n) === '.txt') score += 4;
    return score;
  }

  function scoreResumeName(name) {
    const n = String(name || '').toLowerCase();
    let score = 0;
    if (/resume/.test(n)) score += 3;
    if (/(^|[^a-z])cv([^a-z]|$)/.test(n)) score += 3;
    if (/curriculum/.test(n)) score += 2;
    return score;
  }

  /**
   * Classify 1–2 dropped/browsed files into resume + optional cover letter.
   * @returns {{ resume: File|null, cover: File|null, error?: string, warning?: string }}
   */
  function classifyDroppedFiles(fileList) {
    const raw = Array.from(fileList || []).filter(Boolean);
    if (raw.length > 2) {
      return { resume: null, cover: null, error: 'Drop 1 or 2 files only.' };
    }
    if (raw.length === 0) {
      return { resume: null, cover: null };
    }

    const valid = [];
    const rejected = [];
    for (const file of raw) {
      const ext = fileExtension(file.name);
      const resumeOk = RESUME_ACCEPT.includes(ext);
      const coverOk = COVER_ACCEPT.includes(ext);
      if (!resumeOk && !coverOk) {
        rejected.push(file.name);
        continue;
      }
      valid.push(file);
    }

    if (valid.length === 0) {
      return {
        resume: null,
        cover: null,
        error: `Invalid file type. Allowed: ${COVER_ACCEPT.join(', ')}`
      };
    }

    let resume = null;
    let cover = null;

    if (valid.length === 1) {
      const file = valid[0];
      const ext = fileExtension(file.name);
      // "Cover_Letter.docx" is a cover letter even though a resume may be .docx too.
      const looksLikeCover = scoreCoverName(file.name) > scoreResumeName(file.name);
      if (!RESUME_ACCEPT.includes(ext) || (looksLikeCover && COVER_ACCEPT.includes(ext))) {
        cover = file;
      } else {
        resume = file;
      }
      const single = rejected.length ? `Skipped invalid file(s): ${rejected.join(', ')}` : undefined;
      return { resume, cover, warning: single, keepOtherSlot: true };
    } else if (
      valid.length === 2 &&
      scoreCoverName(valid[0].name) === 0 &&
      scoreCoverName(valid[1].name) === 0 &&
      valid[0].name.replace(/\.[^.]+$/, '').toLowerCase() === valid[1].name.replace(/\.[^.]+$/, '').toLowerCase()
    ) {
      // resume.docx + resume.pdf: one document in two formats, not a resume and a cover letter.
      const docx = valid.find((f) => fileExtension(f.name) === '.docx') || valid[0];
      return {
        resume: docx,
        cover: null,
        warning: `Both files are the same document; attached ${docx.name} as the resume.`,
        keepOtherSlot: true,
      };
    } else {
      const [a, b] = valid;
      const aCover = scoreCoverName(a.name);
      const bCover = scoreCoverName(b.name);
      const aResume = scoreResumeName(a.name);
      const bResume = scoreResumeName(b.name);

      if (aCover > bCover || (aCover === bCover && aCover > 0 && aResume < bResume)) {
        cover = a;
        resume = b;
      } else if (bCover > aCover || (aCover === bCover && bCover > 0 && bResume < aResume)) {
        cover = b;
        resume = a;
      } else if (fileExtension(a.name) === '.txt' && fileExtension(b.name) !== '.txt') {
        cover = a;
        resume = b;
      } else if (fileExtension(b.name) === '.txt' && fileExtension(a.name) !== '.txt') {
        cover = b;
        resume = a;
      } else {
        resume = a;
        cover = b;
      }

      // Ensure resume slot only gets resume-allowed types
      if (resume && !isAllowedFile(resume, RESUME_ACCEPT)) {
        if (cover && isAllowedFile(cover, RESUME_ACCEPT)) {
          const swap = resume;
          resume = cover;
          cover = swap;
        } else {
          cover = resume;
          resume = null;
        }
      }
      if (cover && !isAllowedFile(cover, COVER_ACCEPT)) {
        cover = null;
      }
    }

    const warning = rejected.length
      ? `Skipped invalid file(s): ${rejected.join(', ')}`
      : undefined;

    return { resume, cover, warning };
  }

  function getRegisterFileInputs() {
    return {
      resume: document.getElementById('regResumeFile'),
      cover: document.getElementById('regCoverFile')
    };
  }

  function updateRegisterComboDropUi() {
    const drop = document.getElementById('regFilesDrop');
    const summary = document.getElementById('regFilesSummary');
    const clearBtn = document.getElementById('regFilesClear');
    const { resume, cover } = getRegisterFileInputs();
    const resumeFile = resume?.files?.[0] || null;
    const coverFile = cover?.files?.[0] || null;
    const hasAny = Boolean(resumeFile || coverFile);

    if (drop) {
      drop.classList.toggle('has-file', hasAny);
      drop.classList.remove('is-default-file');
    }

    const parts = [];
    if (resumeFile) parts.push(resumeFile.name);
    if (coverFile) parts.push(coverFile.name);

    if (summary) {
      if (parts.length) {
        summary.textContent = parts.join(' · ');
        summary.title = parts.join('\n');
        summary.hidden = false;
      } else {
        summary.textContent = '';
        summary.title = '';
        summary.hidden = true;
      }
    }

    if (clearBtn) clearBtn.hidden = !hasAny;

    const cta = drop?.querySelector('.file-drop-cta');
    const formats = drop?.querySelector('.file-drop > .muted.small');
    const icon = drop?.querySelector('.file-drop-icon');
    if (cta) cta.hidden = hasAny;
    if (formats) formats.hidden = hasAny;
    if (icon) icon.hidden = hasAny;
    syncRbStatusChips();
  }

  function clearAllRegisterFiles() {
    const { resume, cover } = getRegisterFileInputs();
    if (resume) resume.value = '';
    if (cover) cover.value = '';
    autoAttachedFromJson2docx = { resume: false, cover: false };
    generatedFileMeta = { resumeName: '', coverName: '', generatedAt: 0 };
    filesNeedRegeneration = false;
    updateRegisterComboDropUi();
    renderGeneratedAttachmentChips();
    syncTabSession();
  }

  function assignFileToInput(input, file) {
    if (!input) return;
    if (!file) {
      input.value = '';
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }

  function applyClassifiedFiles(result) {
    const { resume, cover } = getRegisterFileInputs();
    if (result.error) {
      setRegisterStatus(result.error, 'error');
      return;
    }

    // A single dropped file replaces only its own slot; dropping a cover
    // letter must not remove the resume that Generate attached.
    if (result.keepOtherSlot) {
      if (result.resume) assignFileToInput(resume, result.resume);
      if (result.cover) assignFileToInput(cover, result.cover);
      autoAttachedFromJson2docx = {
        resume: result.resume ? false : autoAttachedFromJson2docx.resume,
        cover: result.cover ? false : autoAttachedFromJson2docx.cover,
      };
    } else {
      assignFileToInput(resume, result.resume || null);
      assignFileToInput(cover, result.cover || null);
      autoAttachedFromJson2docx = {
        resume: false,
        cover: false,
      };
    }
    filesNeedRegeneration = false;
    updateRegisterComboDropUi();
    renderGeneratedAttachmentChips();
    syncTabSession();

    if (result.warning) {
      setRegisterStatus(result.warning, 'info');
    } else if (result.resume || result.cover) {
      const parts = [];
      if (result.resume) parts.push(`resume: ${result.resume.name}`);
      if (result.cover) parts.push(`cover: ${result.cover.name}`);
      setRegisterStatus(`Attached ${parts.join(' · ')}`, 'success');
    }
  }

  function wireRegisterFileDrops() {
    const drop = document.getElementById('regFilesDrop');
    const picker = document.getElementById('regFilesPicker');
    const clearBtn = document.getElementById('regFilesClear');
    if (!drop || !picker) return;

    const openPicker = () => picker.click();

    drop.addEventListener('click', (e) => {
      if (e.target.closest('[data-clear-file]')) return;
      openPicker();
    });

    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPicker();
      }
    });

    picker.addEventListener('change', () => {
      applyClassifiedFiles(classifyDroppedFiles(picker.files));
      picker.value = '';
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearAllRegisterFiles();
      });
    }

    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.add('drag-active');
    });

    drop.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('drag-active');
    });

    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('drag-active');
      applyClassifiedFiles(classifyDroppedFiles(e.dataTransfer?.files));
    });

    updateRegisterComboDropUi();
  }

  function readRegisterFormFields() {
    const profileSelect = document.getElementById('regProfileId');
    const profileId = profileSelect?.value?.trim() || '';
    const profileOption = profileSelect?.selectedOptions?.[0];
    const resumeFile = readFileInput(document.getElementById('regResumeFile'));
    const coverFile = readFileInput(document.getElementById('regCoverFile'));

    return {
      jobTitle: document.getElementById('regJobTitle')?.value?.trim() || '',
      companyName: document.getElementById('regCompany')?.value?.trim() || '',
      jobLink: document.getElementById('regJobLink')?.value?.trim() || '',
      note: document.getElementById('regNote')?.value?.trim() || '',
      profileId,
      profileName: profileOption?.textContent?.trim() || '',
      resumeIsDefault: false,
      coverLetterIsDefault: false,
      resumeFileName: resumeFile?.name || null,
      coverFileName: coverFile?.name || null,
      apply: 'Registered'
    };
  }

  /**
   * Build the live Register draft for Register submit.
   * Re-applies built resume JSON onto title/company/note when present.
   * Never scrapes the tab at submit time.
   */
  function prepareRegisterDraftForSubmit() {
    const mapper = global.SmartJobResumeJsonMapper;
    const formFields = readRegisterFormFields();
    const resumeJsonText = document.getElementById('regResumeJson')?.value || '';
    const resumeFile = readFileInput(document.getElementById('regResumeFile'));
    const coverFile = readFileInput(document.getElementById('regCoverFile'));

    if (!mapper?.mergeRegisterDraftFromResumeJson || !mapper?.validateRegisterDraft) {
      const validation = {
        ok: Boolean(formFields.jobTitle && formFields.companyName && formFields.jobLink && formFields.profileId),
        errors: [],
        warnings: [],
        fields: formFields,
      };
      if (!formFields.jobTitle || !formFields.companyName || !formFields.jobLink) {
        validation.errors.push(
          'Job title, company, and job link are required. Paste resume JSON or use Refresh for the job link.'
        );
      }
      if (!formFields.profileId) validation.errors.push('Select a profile.');
      validation.ok = validation.errors.length === 0;
      return {
        ...validation,
        fromJson: hasActiveResumeJsonOverride(),
        resumeFile,
        coverFile,
      };
    }

    const merged = mapper.mergeRegisterDraftFromResumeJson(formFields, resumeJsonText);
    if (!merged.ok) {
      return {
        ok: false,
        fromJson: false,
        errors: [merged.error || 'Invalid resume JSON'],
        warnings: [],
        fields: formFields,
        resumeFile,
        coverFile,
      };
    }

    // What the user typed into Bid details after pasting the JSON is a
    // correction, and it is what gets registered.
    const userEdited = (id) => document.getElementById(id)?.dataset.fillSource === 'user';
    if (merged.fromJson) {
      if (userEdited('regJobTitle')) merged.fields.jobTitle = formFields.jobTitle;
      if (userEdited('regCompany')) merged.fields.companyName = formFields.companyName;
      if (userEdited('regNote')) merged.fields.note = formFields.note;
    }

    // Keep the visible form in sync with JSON before submit (link unchanged).
    if (merged.fromJson) {
      if (merged.fields.jobTitle && !userEdited('regJobTitle')) setRegisterFieldValue('regJobTitle', merged.fields.jobTitle, 'resume-json');
      if (merged.fields.companyName && !userEdited('regCompany')) setRegisterFieldValue('regCompany', merged.fields.companyName, 'resume-json');
      if (merged.fields.note && !userEdited('regNote')) setRegisterFieldValue('regNote', merged.fields.note, 'resume-json');
      resumeJsonOverrideActive = true;
    }

    const draftFields = {
      ...formFields,
      ...merged.fields,
      // Re-read profile labels after merge (unchanged)
      profileId: formFields.profileId,
      profileName: formFields.profileName,
      resumeFileName: resumeFile?.name || null,
      coverFileName: coverFile?.name || null,
    };

    const validated = mapper.validateRegisterDraft(draftFields, {
      fromJson: merged.fromJson || hasActiveResumeJsonOverride(),
      hasResumeFile: Boolean(resumeFile),
      hasCoverFile: Boolean(coverFile),
    });

    return {
      ...validated,
      fromJson: merged.fromJson || hasActiveResumeJsonOverride(),
      resumeTemplate: merged.resumeTemplate || '',
      resumeFile,
      coverFile,
      fields: {
        ...draftFields,
        ...validated.fields,
      },
    };
  }

  async function registerJobToBackend() {
    const draft = prepareRegisterDraftForSubmit();
    if (!draft.ok) {
      throw new Error(draft.errors[0] || 'Register draft is incomplete.');
    }

    const fields = draft.fields;
    const { jobTitle, companyName, jobLink, note, profileId } = fields;
    const resumeFile = draft.resumeFile || readFileInput(document.getElementById('regResumeFile'));
    const coverFile = draft.coverFile || readFileInput(document.getElementById('regCoverFile'));

    const resumeIsDefault = fields.resumeIsDefault;
    const coverIsDefault = fields.coverLetterIsDefault;

    await ensureCanUploadFiles(resumeIsDefault, coverIsDefault, resumeFile, coverFile);

    const config = await getBackendConfig();

    const formData = new FormData();
    formData.append('jobTitle', jobTitle);
    formData.append('companyName', companyName);
    formData.append('jobLink', jobLink);
    formData.append('note', note || '');
    formData.append('profileId', profileId);
    formData.append('apply', 'Registered');
    formData.append('resumeIsDefault', resumeIsDefault ? '1' : '0');
    formData.append('coverLetterIsDefault', coverIsDefault ? '1' : '0');
    if (resumeFile) formData.append('resume', resumeFile, resumeFile.name);
    if (coverFile && coverFile.size > 0) {
      formData.append('coverLetter', coverFile, coverFile.name);
    }

    const res = await fetch(`${config.baseUrl}/api/resume-db/register`, {
      method: 'POST',
      headers: apiHeaders(config),
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Registration failed (${res.status})`);
    }
    return { ...data, _draftWarnings: draft.warnings || [], _draftFromJson: Boolean(draft.fromJson) };
  }

  function wireBackendSettingsForm(showStatus) {
    const form = document.getElementById('backendSettingsForm');
    const testBtn = document.getElementById('testBackendConnectionBtn');
    const signOutBtn = document.getElementById('signOutBackendBtn');

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const baseUrl = document.getElementById('backendUrlSetting')?.value;
        const username = document.getElementById('backendUsernameSetting')?.value?.trim();
        const password = document.getElementById('backendPasswordSetting')?.value || '';

        if (!username || !password) {
          setSettingsHint('Username and password are required.', 'error');
          return;
        }

        setSettingsHint('Signing in…', '');
        try {
          await loginWithCredentials(baseUrl, username, password);
          await saveBackendUrlOnly(baseUrl);
          invalidateSessionCaches();
          const passwordInput = document.getElementById('backendPasswordSetting');
          if (passwordInput) passwordInput.value = '';
          setSettingsHint('Signed in successfully.', 'success');
          if (showStatus) showStatus('Signed in to Resume DB.', 'success');
          await checkBackendConnection({ force: true });
          await loadBackendSettingsForm();
          await loadProfilesIntoSelect();
        } catch (err) {
          const msg = err.message || String(err);
          setSettingsHint(msg, 'error');
          if (showStatus) showStatus(msg, 'error');
          updateBackendDependentUi(false);
        }
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await clearAuthConfig();
        const passwordInput = document.getElementById('backendPasswordSetting');
        if (passwordInput) passwordInput.value = '';
        setSettingsHint('Signed out.', 'success');
        if (showStatus) showStatus('Signed out of Resume DB.', 'success');
        await loadBackendSettingsForm();
        await checkBackendConnection();
        await loadProfilesIntoSelect();
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const baseUrl = document.getElementById('backendUrlSetting')?.value;
        await saveBackendUrlOnly(baseUrl);
        setSettingsHint('Testing connection…', '');
        const ok = await checkBackendConnection({ force: true });
        if (ok) {
          setSettingsHint('Connection successful.', 'success');
          if (showStatus) showStatus('Backend connection OK.', 'success');
          await loadProfilesIntoSelect();
        } else {
          setSettingsHint(
            'Not connected. Sign in with your username and password, or check the backend URL.',
            'error'
          );
          if (showStatus) showStatus('Backend connection failed.', 'error');
        }
      });
    }
  }

  function startConnectionPolling() {
    if (connectionPollTimer) clearInterval(connectionPollTimer);
    checkBackendConnection();
    loadProfilesIntoSelect();
    connectionPollTimer = setInterval(() => {
      checkBackendConnection();
    }, 30000);
  }

  function wireRegisterFieldCopy(buttonId, inputId, successMessage, errorFallback, showStatus) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const value = document.getElementById(inputId)?.value?.trim() || '';
      copyTextToClipboard(value)
        .then(() => {
          setRegisterStatus(successMessage, 'success');
          if (showStatus) showStatus(successMessage, 'success');
        })
        .catch((err) => {
          const msg = err.message || errorFallback;
          setRegisterStatus(msg, 'error');
          if (showStatus) showStatus(msg, 'error');
        });
    });
  }

  function wireRegisterFieldDup(buttonId, field, showStatus) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      setFieldDupBusy(buttonId, true);
      try {
        await checkFieldDuplicate(field, showStatus);
      } catch (err) {
        const msg = err.message || String(err);
        setRegisterStatus(msg, 'error');
        if (showStatus) showStatus(msg, 'error');
      } finally {
        setFieldDupBusy(buttonId, false);
      }
    });
  }

  function hasActiveResumeJsonOverride() {
    return Boolean(resumeJsonOverrideActive);
  }

  function getResumeJsonText() {
    return String(document.getElementById('regResumeJson')?.value || '');
  }

  /* --------------------------------------------------- per-tab session slice */

  const REGISTER_DRAFT_FIELDS = ['regJobTitle', 'regCompany', 'regNote', 'regJobLink'];
  const MAX_PERSISTED_TEXT = 50000;

  function captureRegisterStatus() {
    return null;
  }

  function restoreRegisterStatus(_state) {
    /* Register status strip removed */
  }

  function captureRegisterSession() {
    const inputs = getRegisterFileInputs();
    const draft = {};
    const fillSources = {};
    REGISTER_DRAFT_FIELDS.forEach((id) => {
      const el = document.getElementById(id);
      draft[id] = el ? el.value : '';
      if (el?.dataset.fillSource) fillSources[id] = el.dataset.fillSource;
    });
    return {
      draft,
      fillSources,
      resumeJson: getResumeJsonText(),
      resumeJsonOverrideActive,
      lastAutoCheckedCompanyKey,
      lastAutoCheckedJobLinkKey,
      jobLinkDuplicateActive,
      companyDuplicateLevel,
      files: {
        resume: inputs.resume?.files?.[0] || null,
        cover: inputs.cover?.files?.[0] || null
      },
      fileMeta: { ...generatedFileMeta },
      autoAttachedFromJson2docx: { ...autoAttachedFromJson2docx },
      promptCopiedAt,
      registeredRecord: { ...registeredRecord },
      // Failed or in-flight checks are not worth keeping; they re-run on return.
      aiCompat:
        lastAiCompatResult?.status === 'done' && lastAiCompatCacheKey
          ? { result: lastAiCompatResult, cacheKey: lastAiCompatCacheKey, pinned: aiCompatPinned }
          : null,
      registerStatus: captureRegisterStatus()
    };
  }

  function restoreRegisterSession(data) {
    const state = data || {};
    isRestoringSession = true;
    // The verdict in memory belongs to the tab being left. Drop it before any
    // field is restored, or applying this tab's resume JSON would pin it here.
    clearAiCompatResult();
    try {
      if (resumeJsonApplyTimer) {
        clearTimeout(resumeJsonApplyTimer);
        resumeJsonApplyTimer = null;
      }
      if (resumeJsonDupTimer) {
        clearTimeout(resumeJsonDupTimer);
        resumeJsonDupTimer = null;
      }
      if (jobLinkDupTimer) {
        clearTimeout(jobLinkDupTimer);
        jobLinkDupTimer = null;
      }
      if (companyDupTimer) {
        clearTimeout(companyDupTimer);
        companyDupTimer = null;
      }

      // Globals first, so the renderers below read the right precedence.
      lastAutoCheckedCompanyKey = String(state.lastAutoCheckedCompanyKey || '');
      lastAutoCheckedJobLinkKey = String(state.lastAutoCheckedJobLinkKey || '');
      jobLinkDuplicateActive = Boolean(state.jobLinkDuplicateActive);
      companyDuplicateLevel =
        state.companyDuplicateLevel === 'definite' || state.companyDuplicateLevel === 'possible'
          ? state.companyDuplicateLevel
          : 'none';
      autoAttachedFromJson2docx = {
        resume: Boolean(state.autoAttachedFromJson2docx?.resume),
        cover: Boolean(state.autoAttachedFromJson2docx?.cover)
      };
      generatedFileMeta = {
        resumeName: String(state.fileMeta?.resumeName || ''),
        coverName: String(state.fileMeta?.coverName || ''),
        generatedAt: Number(state.fileMeta?.generatedAt || 0)
      };
      promptCopiedAt = Number(state.promptCopiedAt || 0);
      registeredRecord = {
        id: String(state.registeredRecord?.id || ''),
        jobLinkKey: String(state.registeredRecord?.jobLinkKey || ''),
        at: Number(state.registeredRecord?.at || 0)
      };
      generateActivity = null;

      // Resume JSON drives title/company/note, so apply it before the draft
      // fields — otherwise it would overwrite the user's manual edits.
      const jsonText = String(state.resumeJson || '');
      const ta = document.getElementById('regResumeJson');
      if (ta) ta.value = jsonText;
      if (jsonText.trim()) {
        applyResumeJsonToRegisterForm(jsonText, { silent: true });
      } else {
        clearResumeJsonOverride({ clearTextarea: true });
      }
      resumeJsonOverrideActive = Boolean(state.resumeJsonOverrideActive);

      REGISTER_DRAFT_FIELDS.forEach((id) => {
        setRegisterFieldValue(id, state.draft?.[id] || '', state.fillSources?.[id]);
      });
      restoreAiCompatFromSession(state.aiCompat);

      const inputs = getRegisterFileInputs();
      const resumeFile = state.files?.resume || null;
      const coverFile = state.files?.cover || null;
      assignFileToInput(inputs.resume, resumeFile);
      assignFileToInput(inputs.cover, coverFile);
      filesNeedRegeneration =
        !resumeFile && !coverFile && Boolean(generatedFileMeta.generatedAt);

      updateRegisterComboDropUi();
      renderGeneratedAttachmentChips();
      restoreRegisterStatus(state.registerStatus);
      setGenerateProgress({ hidden: true, percent: 0, message: '' });
      syncResumeBuilderActionButtons();
      // The "Edit JSON" window belongs to the tab it was opened on; left open,
      // Apply would write that tab's text into this one.
      const editModal = document.getElementById('rbMaxModal');
      if (editModal) editModal.hidden = true;
    } finally {
      isRestoringSession = false;
    }
    // Saved duplicate flags can be out of date: the profile is shared by all
    // tabs, and the record may have been added or removed since.
    scheduleJobLinkDuplicateCheck(null, { force: true });
    scheduleCompanyDuplicateCheck(null, { force: true });
  }

  /** Drops File objects, which cannot be serialized into chrome.storage. */
  function registerSessionToPersist(data) {
    if (!data) return null;
    const trim = (text) => String(text || '').slice(0, MAX_PERSISTED_TEXT);
    const draft = {};
    Object.keys(data.draft || {}).forEach((id) => {
      draft[id] = trim(data.draft[id]);
    });
    return {
      draft,
      fillSources: data.fillSources || {},
      resumeJson: trim(data.resumeJson),
      resumeJsonOverrideActive: Boolean(data.resumeJsonOverrideActive),
      lastAutoCheckedCompanyKey: data.lastAutoCheckedCompanyKey || '',
      lastAutoCheckedJobLinkKey: data.lastAutoCheckedJobLinkKey || '',
      jobLinkDuplicateActive: Boolean(data.jobLinkDuplicateActive),
      companyDuplicateLevel: data.companyDuplicateLevel || 'none',
      fileMeta: data.fileMeta || null,
      autoAttachedFromJson2docx: data.autoAttachedFromJson2docx || null,
      promptCopiedAt: Number(data.promptCopiedAt || 0),
      registeredRecord: data.registeredRecord || null,
      aiCompat: data.aiCompat || null,
      registerStatus: data.registerStatus || null
    };
  }

  function registerSessionHasWork(data) {
    if (!data) return false;
    if (String(data.resumeJson || '').trim()) return true;
    if (data.files?.resume || data.files?.cover) return true;
    if (data.registeredRecord?.id) return true;
    return Boolean(data.fileMeta?.generatedAt);
  }

  function wireRegisterDraftSessionSync() {
    REGISTER_DRAFT_FIELDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.sessionWired === '1') return;
      el.dataset.sessionWired = '1';
      const onEdit = () => {
        syncTabSession();
        // The Note field drives the first step of the apply tracker.
        refreshApplyProgress();
      };
      el.addEventListener('input', onEdit);
      el.addEventListener('change', onEdit);
    });
  }

  function wireRegisterTabSession() {
    wireRegisterDraftSessionSync();
    tabSession()?.registerSlice('register', {
      capture: captureRegisterSession,
      restore: restoreRegisterSession,
      toPersist: registerSessionToPersist,
      hasWork: registerSessionHasWork
    });
  }

  function setRegisterFieldValue(id, value, source) {
    const el = document.getElementById(id);
    if (!el) return;
    const next = value == null ? '' : String(value);
    const unchanged = el.value.trim() === next.trim();
    el.value = next;
    if (source) el.dataset.fillSource = source;
    else delete el.dataset.fillSource;
    if (id === 'regNote') {
      // Generate and Register re-apply the same text; that is not a new posting.
      if (!unchanged) onRegisterNoteChanged(null, { programmatic: true });
      if (typeof global.renderPostingMeta === 'function') global.renderPostingMeta();
    }
    renderBidDetailsSummary();
  }

  /**
   * One-line readout on the collapsed "Bid details" header, so the title and
   * company that will be registered are checkable without opening it — and a
   * missing one is visible before Register fails on it.
   */
  function renderBidDetailsSummary() {
    const el = document.getElementById('regDetailsSummary');
    if (!el) return;
    const headTitle = document.getElementById('regJobHeadTitle');
    const mark = document.getElementById('regJobMark');
    const value = (id) => String(document.getElementById(id)?.value || '').trim();
    const title = value('regJobTitle');
    const company = value('regCompany');
    const link = value('regJobLink');

    // The company initial stands in for a logo once there is a company.
    if (mark) {
      const initial = (company.match(/[A-Za-z0-9]/) || [''])[0].toUpperCase();
      if (!mark.dataset.icon) mark.dataset.icon = mark.innerHTML;
      if (initial) mark.textContent = initial;
      else mark.innerHTML = mark.dataset.icon;
      mark.classList.toggle('has-initial', Boolean(initial));
    }

    if (!title && !company && !link) {
      if (headTitle) headTitle.textContent = 'No job loaded';
      el.textContent = 'Open a job posting and press Refresh';
      el.dataset.state = 'idle';
      el.removeAttribute('title');
      return;
    }

    if (headTitle) headTitle.textContent = title || 'Untitled job';

    const missing = [];
    if (!title) missing.push('job title');
    if (!company) missing.push('company');
    if (!link) missing.push('job link');

    if (missing.length) {
      el.textContent = `Missing ${missing.join(', ')}`;
      el.dataset.state = 'warn';
      el.title = 'Open this card and fill these in before registering';
      return;
    }

    let host = '';
    try {
      host = new URL(link).hostname.replace(/^www\./, '');
    } catch (_) {
      /* keep the company alone */
    }
    el.textContent = host ? `${company} · ${host}` : company;
    el.dataset.state = 'ready';
    el.title = `${title} · ${company}\n${link}`;
  }

  function wireBidDetailsSummary() {
    ['regJobTitle', 'regCompany', 'regJobLink'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.detailsSummaryWired === '1') return;
      el.dataset.detailsSummaryWired = '1';
      el.addEventListener('input', renderBidDetailsSummary);
    });
    renderBidDetailsSummary();
  }

  function updateResumeJsonHint(message, type) {
    const hint = document.getElementById('regResumeJsonHint');
    if (!hint) return;
    hint.textContent = message;
    hint.classList.toggle('is-error', type === 'error');
    hint.classList.toggle('is-success', type === 'success');
  }

  function clearResumeJsonOverride({ clearTextarea = true } = {}) {
    resumeJsonOverrideActive = false;
    lastAutoCheckedCompanyKey = '';
    setCompanyDuplicateLevel('none');
    if (clearTextarea) {
      const ta = document.getElementById('regResumeJson');
      if (ta) ta.value = '';
    }
    const clearBtn = document.getElementById('regResumeJsonClearBtn');
    if (clearBtn) clearBtn.hidden = true;
    ['regJobTitle', 'regCompany', 'regNote'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) delete el.dataset.fillSource;
    });
    updateResumeJsonHint(
      'Fills job title, company, and note from JSON. Job link stays from the current tab / Refresh.',
      ''
    );
    syncTabSession();
    syncResumeBuilderActionButtons();
  }

  /**
   * Apply built resume JSON to Register draft fields (title/company/note).
   * Does not change job link.
   */
  function applyResumeJsonToRegisterForm(rawText, { silent = false, showStatus, respectUserEdits = false } = {}) {
    // A field the user typed in after the JSON was pasted stays as typed.
    const keepsUserEdit = (id) =>
      respectUserEdits && document.getElementById(id)?.dataset.fillSource === 'user';
    const mapper = global.SmartJobResumeJsonMapper;
    const clearBtn = document.getElementById('regResumeJsonClearBtn');
    const text = String(rawText || '').trim();

    if (!text) {
      lastAutoCheckedCompanyKey = '';
    setCompanyDuplicateLevel('none');
      clearResumeJsonOverride({ clearTextarea: false });
      if (clearBtn) clearBtn.hidden = true;
      syncResumeBuilderActionButtons();
      return { ok: false, empty: true };
    }

    if (clearBtn) clearBtn.hidden = false;

    if (!mapper?.extractRegisterFieldsFromResumeJsonText) {
      updateResumeJsonHint('Resume JSON mapper is not loaded.', 'error');
      resumeJsonOverrideActive = false;
      syncResumeBuilderActionButtons();
      return { ok: false, error: 'mapper missing' };
    }

    const result = mapper.extractRegisterFieldsFromResumeJsonText(text);
    if (!result.ok) {
      resumeJsonOverrideActive = false;
      updateResumeJsonHint(result.error || 'Invalid JSON', 'error');
      if (!silent) setRegisterStatus(result.error || 'Invalid resume JSON', 'error');
      syncResumeBuilderActionButtons();
      return result;
    }

    const fields = result.fields || {};
    if (!fields.hasRegisterFields) {
      resumeJsonOverrideActive = false;
      updateResumeJsonHint(
        'JSON parsed, but no job_title / company_name / job_description found yet.',
        'error'
      );
      syncResumeBuilderActionButtons();
      return { ok: false, error: 'missing register fields', fields };
    }

    if (fields.jobTitle && !keepsUserEdit('regJobTitle')) setRegisterFieldValue('regJobTitle', fields.jobTitle, 'resume-json');
    if (fields.companyName && !keepsUserEdit('regCompany')) setRegisterFieldValue('regCompany', fields.companyName, 'resume-json');
    if (fields.jobDescription && !keepsUserEdit('regNote')) setRegisterFieldValue('regNote', fields.jobDescription, 'resume-json');
    if (fields.companyName && !isRestoringSession) {
      scheduleCompanyDuplicateCheckFromResumeJson(fields.companyName, showStatus);
    }

    resumeJsonOverrideActive = true;
    syncTabSession();
    const templateNote = fields.resumeTemplate ? ` · template ${fields.resumeTemplate}` : '';
    if (!fields.resumeTemplate) {
      updateResumeJsonHint(
        'JSON has job fields, but resume_template is required to Generate Files / Register.',
        'error'
      );
    } else {
      updateResumeJsonHint(
        `Register fields updated from resume JSON${templateNote}. Job link unchanged.`,
        'success'
      );
    }
    if (!silent) {
      setRegisterStatus('Register fields filled from built resume JSON.', 'success');
    }

    syncResumeBuilderActionButtons();
    scheduleBidFitRefresh();
    return { ok: true, fields, data: result.data };
  }

  function wireResumeJsonLiveFill(showStatus) {
    const ta = document.getElementById('regResumeJson');
    const clearBtn = document.getElementById('regResumeJsonClearBtn');
    if (!ta) return;

    const scheduleApply = () => {
      if (resumeJsonApplyTimer) clearTimeout(resumeJsonApplyTimer);
      // The tab can change before this fires; drop the result if it does.
      const token = tabSession()?.getGeneration();
      resumeJsonApplyTimer = setTimeout(() => {
        if (tabSession() && !tabSession().isCurrentGeneration(token)) return;
        applyResumeJsonToRegisterForm(ta.value, { silent: true, showStatus });
        syncTabSession();
      }, 250);
    };

    ta.addEventListener('input', scheduleApply);
    ta.addEventListener('paste', () => {
      setTimeout(scheduleApply, 0);
    });
    ta.addEventListener('change', () => {
      const result = applyResumeJsonToRegisterForm(ta.value, { silent: false, showStatus });
      syncTabSession();
      if (result.ok && showStatus) {
        showStatus('Register fields filled from built resume JSON.', 'success');
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        clearResumeJsonOverride({ clearTextarea: true });
        setRegisterStatus('Cleared built resume JSON override.', 'info');
        if (showStatus) showStatus('Cleared built resume JSON.', 'info');
      });
    }
  }

  /** Generation progress is shown inside the Files step of the apply tracker. */
  function setGenerateProgress({ hidden = false, percent = 0, message = '' } = {}) {
    generateActivity = hidden
      ? null
      : { percent: Math.max(0, Math.min(100, Number(percent) || 0)), message: message || 'Working…' };
    refreshApplyProgress();
  }

  function renderGeneratedAttachmentChips() {
    const host = document.getElementById('regGeneratedAttachments');
    if (!host) return;
    const { resume, cover } = getRegisterFileInputs();
    const resumeFile = resume?.files?.[0] || null;
    const coverFile = cover?.files?.[0] || null;
    const chips = [];

    if (resumeFile && autoAttachedFromJson2docx.resume) {
      chips.push({
        slot: 'resume',
        label: 'Resume',
        title: resumeFile.name || 'Resume',
      });
    }
    if (coverFile && autoAttachedFromJson2docx.cover) {
      chips.push({
        slot: 'cover',
        label: 'CoverLetter',
        title: coverFile.name || 'CoverLetter',
      });
    }

    if (!chips.length) {
      // A panel reload keeps the metadata but loses the File objects, so say so
      // rather than showing nothing or a chip with no file behind it.
      if (filesNeedRegeneration) {
        const names = [generatedFileMeta.resumeName, generatedFileMeta.coverName]
          .filter(Boolean)
          .join(' · ');
        host.hidden = false;
        host.innerHTML = `
      <span class="register-attach-chip is-pending" title="${escapeHtml(names)}">
        <span class="register-attach-chip-label">Regenerate to attach</span>
      </span>`;
        syncRbStatusChips();
        return;
      }
      host.hidden = true;
      host.innerHTML = '';
      syncRbStatusChips();
      return;
    }

    host.hidden = false;
    host.innerHTML = chips
      .map(
        (chip) => `
      <span class="register-attach-chip" data-slot="${chip.slot}">
        <span class="register-attach-chip-label" title="${escapeHtml(chip.title)}">${escapeHtml(chip.label)}</span>
        <button type="button" class="register-attach-chip-remove" data-remove-slot="${chip.slot}" aria-label="Remove ${chip.label}">×</button>
      </span>`
      )
      .join('');

    host.querySelectorAll('[data-remove-slot]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const slot = btn.getAttribute('data-remove-slot');
        const inputs = getRegisterFileInputs();
        if (slot === 'resume') {
          assignFileToInput(inputs.resume, null);
          autoAttachedFromJson2docx.resume = false;
          generatedFileMeta.resumeName = '';
        } else if (slot === 'cover') {
          assignFileToInput(inputs.cover, null);
          autoAttachedFromJson2docx.cover = false;
          generatedFileMeta.coverName = '';
        }
        updateRegisterComboDropUi();
        renderGeneratedAttachmentChips();
        setRegisterStatus(`Removed ${slot} attachment.`, 'info');
        syncTabSession();
      });
    });
    syncRbStatusChips();
  }

  function attachGeneratedFilesToRegister(preferred) {
    const inputs = getRegisterFileInputs();
    const resumeFile = preferred?.resume?.file || null;
    const coverFile = preferred?.coverLetter?.file || null;

    // Re-generate replaces previous auto-attached set.
    assignFileToInput(inputs.resume, resumeFile);
    assignFileToInput(inputs.cover, coverFile);
    autoAttachedFromJson2docx = {
      resume: Boolean(resumeFile),
      cover: Boolean(coverFile),
    };
    generatedFileMeta = {
      resumeName: resumeFile?.name || '',
      coverName: coverFile?.name || '',
      generatedAt: resumeFile || coverFile ? Date.now() : 0
    };
    filesNeedRegeneration = false;
    updateRegisterComboDropUi();
    renderGeneratedAttachmentChips();
    syncTabSession();
    return { resumeFile, coverFile };
  }

  /** True while json2docx is producing files for a Generate click. */
  let generateInFlight = false;

  /** Store generated files in a tab's saved draft when that tab is not on screen. */
  function saveGeneratedFilesToTab(tabId, preferred) {
    // Same shape attachGeneratedFilesToRegister reads.
    const resumeFile = preferred?.resume?.file || null;
    const coverFile = preferred?.coverLetter?.file || null;
    if (!tabId || (!resumeFile && !coverFile)) return false;
    return Boolean(
      tabSession()?.mutateSlice?.(tabId, 'register', (slice) => ({
        ...(slice || {}),
        files: { resume: resumeFile, cover: coverFile },
        fileMeta: {
          resumeName: resumeFile?.name || '',
          coverName: coverFile?.name || '',
          generatedAt: Date.now(),
        },
        autoAttachedFromJson2docx: { resume: Boolean(resumeFile), cover: Boolean(coverFile) },
      }))
    );
  }

  async function generateFilesFromResumeJson(showStatus) {
    const api = global.SmartJobJson2Docx;
    const mapper = global.SmartJobResumeJsonMapper;
    const btn = document.getElementById('regGenerateFilesBtn');
    const raw = String(document.getElementById('regResumeJson')?.value || '').trim();

    if (!api?.generateAndDownloadFiles) {
      throw new Error('json2docx client is not loaded.');
    }
    if (!raw) {
      throw new Error('Paste built resume JSON first.');
    }

    const parsed = mapper?.extractRegisterFieldsFromResumeJsonText?.(raw);
    if (!parsed?.ok) {
      throw new Error(parsed?.error || 'Invalid resume JSON.');
    }
    if (!parsed.fields?.resumeTemplate) {
      throw new Error('JSON must include resume_template (template folder name).');
    }

    const j2dDot = document.getElementById('json2docxConnectionDot');
    if (!j2dDot?.classList.contains('is-ok')) {
      throw new Error('Local json2docx server is offline. Start it or check Settings.');
    }

    if (generateInFlight) return null;
    generateInFlight = true;
    const originToken = tabSession()?.getGeneration();
    const originTabId = tabSession()?.getBoundTabId?.();

    // Keep Register draft in sync before generate, without undoing a title or
    // company the user corrected by hand after pasting the JSON.
    applyResumeJsonToRegisterForm(raw, { silent: true, respectUserEdits: true });

    if (btn) {
      setRbButtonLoading(btn, true);
    }
    setGenerateProgress({ hidden: false, percent: 8, message: 'Starting…' });
    setRegisterStatus('Generating resume files via json2docx…', 'info');

    try {
      const config = await api.getJson2docxConfig?.();
      // Register always needs DOCX to attach; upgrade PDF-only to both.
      const outputMode =
        config?.outputMode === 'pdf' ? 'both' : config?.outputMode || 'both';

      const result = await api.generateAndDownloadFiles(parsed.data, {
        outputMode,
        onProgress: ({ percent, message }) => {
          setGenerateProgress({
            hidden: false,
            percent: percent ?? 0,
            message: message || 'Working…',
          });
        },
      });

      // Switched tabs while json2docx ran: these files are for the other job.
      if (tabSession() && !tabSession().isCurrentGeneration(originToken)) {
        const saved = saveGeneratedFilesToTab(originTabId, result.preferred);
        const note = saved
          ? 'Files finished generating for the tab you started on. Switch back to it to see them.'
          : 'Files finished generating after you switched tabs. Generate again on that tab.';
        if (showStatus) showStatus(note, 'info');
        return result;
      }
      const attached = attachGeneratedFilesToRegister(result.preferred);
      const names = [];
      if (attached.resumeFile) names.push(attached.resumeFile.name);
      if (attached.coverFile) names.push(attached.coverFile.name);
      if (!names.length) {
        throw new Error(
          'No DOCX resume/cover files to attach. Use output mode DOCX only or DOCX + PDF (Register never attaches PDF).'
        );
      }
      if (attached.resumeFile && !/\.docx$/i.test(attached.resumeFile.name || '')) {
        throw new Error('Resume auto-attach must be a .docx file.');
      }
      if (attached.coverFile && !/\.docx$/i.test(attached.coverFile.name || '')) {
        throw new Error('Cover letter auto-attach must be a .docx file.');
      }

      const msg = `Generated and attached: ${names.join(' · ')}`;
      setGenerateProgress({ hidden: false, percent: 100, message: msg });
      setRegisterStatus(msg, 'success');
      syncRbStatusChips();
      if (showStatus) showStatus(msg, 'success');
      return result;
    } catch (err) {
      const message = err?.message || String(err);
      setGenerateProgress({ hidden: false, percent: 100, message: message });
      setRegisterStatus(message, 'error');
      updateResumeJsonHint(message, 'error');
      if (showStatus) showStatus(message, 'error');
      throw err;
    } finally {
      generateInFlight = false;
      if (btn) {
        setRbButtonLoading(btn, false);
      }
      syncResumeBuilderActionButtons();
      setTimeout(() => {
        setGenerateProgress({ hidden: true, percent: 0, message: '' });
        syncRbStatusChips();
      }, 1200);
    }
  }

  function wireJson2docxGenerate(showStatus) {
    const btn = document.getElementById('regGenerateFilesBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      generateFilesFromResumeJson(showStatus).catch(() => {
        // errors already surfaced in UI
      });
    });
  }

  function getSelectedRegisterProfileId() {
    return document.getElementById('regProfileId')?.value?.trim() || '';
  }

  function updatePromptKitStatus(message, type) {
    const el = document.getElementById('regPromptKitStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', type === 'error');
    el.classList.toggle('is-success', type === 'success');
  }

  function syncRbStatusChips() {
    const website = document.getElementById('rbChipWebsite');
    const j2d = document.getElementById('rbChipJson2docx');
    const websiteDot = document.getElementById('backendConnectionDot');
    const driveDot = document.getElementById('driveConnectionDot');
    const j2dDot = document.getElementById('json2docxConnectionDot');
    if (website && websiteDot) {
      const websiteOk = websiteDot.classList.contains('is-ok');
      const websiteErr = websiteDot.classList.contains('is-error');
      const driveOk = !driveDot || driveDot.classList.contains('is-ok');
      const driveErr = Boolean(driveDot?.classList.contains('is-error'));
      website.classList.toggle('is-ok', websiteOk && driveOk);
      website.classList.toggle('is-error', websiteErr || (websiteOk && driveErr));
    }
    if (j2d && j2dDot) {
      j2d.classList.toggle('is-ok', j2dDot.classList.contains('is-ok'));
      j2d.classList.toggle('is-error', j2dDot.classList.contains('is-error'));
    }

    // Attachment state is shown by the apply tracker's Files step.
  }

  function setRbButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle('is-loading', Boolean(loading));
    const spinner = btn.querySelector('.rb-spinner');
    if (spinner) spinner.hidden = !loading;
  }

  /** Second line of the card: where the verdict came from. */
  function bidFitSourceLabel(result) {
    if (result.aiChecking) return '';
    if (result.aiFailed) return 'AI check failed';
    if (!result.aiRan) return 'Local rules only · AI check not run';
    const compat = (result.criteria || []).filter((c) => c.id === 'compatibility');
    const blockers = compat.filter((c) => c.status === 'fail').length;
    const warnings = compat.filter((c) => c.status === 'warn').length;
    if (blockers) return `AI check · ${blockers} hard blocker${blockers === 1 ? '' : 's'}`;
    if (warnings) return `AI check · ${warnings} warning${warnings === 1 ? '' : 's'}`;
    return 'AI check passed';
  }

  function renderBidFitCard(result) {
    const cue = document.getElementById('rbFitCue');
    const text = document.getElementById('rbFitCueText');
    const sub = document.getElementById('rbFitSub');
    const toggle = document.getElementById('rbFitToggle');
    const list = document.getElementById('rbFitReasons');
    const foot = document.getElementById('rbFitFoot');
    const recheckBtn = document.getElementById('rbFitAiCompatBtn');
    if (!cue || !text) return;

    // Preflight judges a job description, so with none present it would only
    // repeat what the step cue already says. Stay hidden until there is a JD.
    const noJobDescription =
      result?.criteria?.find((c) => c.id === 'jd_quality')?.status === 'fail';

    if (!result || noJobDescription) {
      cue.hidden = true;
      text.textContent = 'Preflight: —';
      if (list) {
        list.textContent = '';
        list.hidden = true;
      }
      return;
    }

    const preflight = global.SmartJobBidFitPreflight;
    const level = result.level || 'ready';
    const isChecking = Boolean(result.aiChecking);
    const aiFailed = Boolean(result.aiFailed);
    const hasProblem = level === 'blocked' || level === 'risky' || aiFailed;
    const shownLevel = isChecking ? 'ready' : aiFailed && level === 'ready' ? 'risky' : level;

    // Always visible once there is a JD: a pass is confirmed, not implied by
    // absence, and Re-check stays reachable when the verdict looks wrong.
    cue.hidden = false;
    if (cue.dataset.level !== shownLevel) bidFitReasonsExpanded = null;
    cue.dataset.level = shownLevel;
    cue.dataset.state = isChecking ? 'checking' : shownLevel;
    text.textContent = preflight?.summarizeFit?.(result) || 'Preflight: —';

    if (sub) {
      const label = bidFitSourceLabel(result);
      sub.textContent = label;
      sub.hidden = !label;
    }
    if (foot) foot.hidden = isChecking || !result.overridable;
    if (recheckBtn && !recheckBtn.classList.contains('is-loading')) {
      recheckBtn.disabled = isChecking;
    }

    const reasons = Array.isArray(result.reasons) ? result.reasons.slice(0, 8) : [];
    if (list) {
      list.textContent = '';
      reasons.forEach((reason) => {
        const item = document.createElement('li');
        item.className = 'rb-fit-reason';
        item.dataset.severity = reason.severity || 'info';
        const dot = document.createElement('span');
        dot.className = 'rb-fit-reason-dot';
        dot.setAttribute('aria-hidden', 'true');
        const msg = document.createElement('span');
        msg.className = 'rb-fit-reason-text';
        msg.textContent = reason.message || '';
        item.append(dot, msg);
        list.appendChild(item);
      });

      // Problems always show reasons clearly; checking has no reason list yet.
      const shouldExpand =
        bidFitReasonsExpanded == null ? hasProblem && !isChecking : bidFitReasonsExpanded;
      const canExpand = reasons.length > 0;
      list.hidden = !canExpand || !shouldExpand;
      if (toggle) {
        toggle.disabled = !canExpand;
        toggle.setAttribute('aria-expanded', String(canExpand && shouldExpand));
      }
      cue.classList.toggle('is-open', canExpand && shouldExpand);
    }
  }

  function wireBidFitToggle() {
    const toggle = document.getElementById('rbFitToggle');
    if (!toggle || toggle.dataset.wired === '1') return;
    toggle.dataset.wired = '1';
    toggle.addEventListener('click', () => {
      const list = document.getElementById('rbFitReasons');
      if (!list) return;
      bidFitReasonsExpanded = list.hidden;
      renderBidFitCard(lastBidFitResult);
    });
  }

  const AI_AUTOFILL_SETTINGS_KEY = 'autofill_settings';

  function readAiAutofillSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([AI_AUTOFILL_SETTINGS_KEY], (result) => {
        const s = result[AI_AUTOFILL_SETTINGS_KEY] || {};
        resolve({
          apiKey: String(s.openaiApiKey || '').trim(),
          baseUrl:
            global.SmartJobAiFill?.normalizeChatBaseUrl?.(s.openaiBaseUrl) ||
            String(s.openaiBaseUrl || '').trim() ||
            global.SmartJobAiFill?.DEFAULT_BASE_URL ||
            'https://api.openai.com/v1',
          model: String(s.openaiModel || '').trim() || global.SmartJobAiFill?.DEFAULT_MODEL || 'gpt-4o-mini',
        });
      });
    });
  }

  /**
   * Run the AI compatibility screen for the current Note + profile.
   *
   * The model's hard blockers are re-validated locally before they can reject a
   * job, so a confident-but-unsupported claim degrades to a warning instead of
   * discarding a posting.
   *
   * @param {Function|null} showStatus  - toast callback; null = silent auto-mode
   * @param {{ manual?: boolean }} opts - manual=true: show button + toasts
   */
  async function runAiCompatCheck(showStatus, { manual = false } = {}) {
    const ai = global.SmartJobAiFill;
    const engine = global.SmartJobBidFitPreflight;
    const btn = document.getElementById('rbFitAiCompatBtn');

    const releasePendingWithoutResult = async () => {
      aiCompatPending = false;
      await refreshBidFitPreflight();
    };

    if (!ai?.evaluateJobCompatibility) {
      if (showStatus) showStatus('AI module not loaded. Reload the extension.', 'error');
      await releasePendingWithoutResult();
      return null;
    }

    const inputs = await collectBidFitInputs();
    const jd = String(inputs.jobDescription || '').trim();
    if (!jd || jd.length < engine?.MIN_JD_CHARS) {
      if (showStatus) showStatus('Add a full job description in Note first.', 'warn');
      await releasePendingWithoutResult();
      return null;
    }

    const settings = await readAiAutofillSettings();
    aiCompatKeyMissing = !settings.apiKey;
    if (!settings.apiKey) {
      if (manual) {
        if (typeof global.openSettingsPanel === 'function') {
          global.openSettingsPanel();
        } else {
          document.querySelector('[data-tab="settings"]')?.click();
        }
        if (showStatus) showStatus('Add an API key under Settings → AI autofill.', 'error');
      }
      // No key: drop pending so regex soft signals can show as fallback.
      await releasePendingWithoutResult();
      return null;
    }

    const cacheKey = aiCompatCacheKey(jd, inputs.profileCity, inputs.profileState, inputs.constraints);
    if (!manual && aiCompatPinned && lastAiCompatResult) {
      return lastAiCompatResult;
    }
    if (!manual && cacheKey === lastAiCompatCacheKey && lastAiCompatResult) {
      aiCompatPending = false;
      return lastAiCompatResult;
    }
    // Same posting and location checked earlier in this session: reuse it.
    if (!manual && aiCompatCache.has(cacheKey)) {
      aiCompatRunId += 1;
      lastAiCompatResult = aiCompatCache.get(cacheKey);
      lastAiCompatCacheKey = cacheKey;
      aiCompatPending = false;
      syncTabSession();
      await refreshBidFitPreflight();
      return lastAiCompatResult;
    }
    // A manual re-check judges the text now in the Note, on its own terms.
    if (manual) aiCompatPinned = false;

    const runId = ++aiCompatRunId;
    aiCompatPending = true;
    await refreshBidFitPreflight();

    if (manual && btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
    }

    try {
      // Point the model at every sentence the local rules find suspicious, so a
      // requirement buried in a long posting gets an explicit ruling.
      const signals = engine?.collectHardSignals
        ? engine.collectHardSignals(jd, { profileState: inputs.profileState })
        : [];
      const result = await ai.evaluateJobCompatibility(settings.apiKey, settings.model, {
        jobDescription: jd,
        constraints: inputs.constraints,
        baseUrl: settings.baseUrl,
        signals,
      });

      // Note/job changed while this call was in flight — discard stale result.
      if (runId !== aiCompatRunId) return null;

      // Only evidence-backed blockers may reject; the rest become warnings.
      const { accepted } = engine?.validateHardBlockers
        ? engine.validateHardBlockers(result.blockers, jd)
        : { accepted: [] };

      // Record which quotes were found in the checked text. The Note may later
      // hold the resume JSON's rewording, where the same quote no longer appears.
      const acceptedEvidence = new Set(accepted.map((b) => b.evidence));
      lastAiCompatResult = {
        status: 'done',
        blockers: result.blockers.map((b) => ({
          ...b,
          validated: acceptedEvidence.has(String(b.evidence || '').trim()),
        })),
        warnings: result.warnings,
        summary: result.summary,
        signals,
        signalReviews: result.signalReviews,
      };
      lastAiCompatCacheKey = cacheKey;
      rememberAiCompatResult(cacheKey, lastAiCompatResult);
      aiCompatPending = false;
      // Keep the verdict with this tab's draft so switching back does not re-run it.
      syncTabSession();

      await refreshBidFitPreflight();

      if (manual && showStatus) {
        showStatus(
          accepted.length ? 'Compatibility check found a hard blocker.' : 'Compatibility check complete.',
          accepted.length ? 'warn' : 'success'
        );
      }
      return lastAiCompatResult;
    } catch (err) {
      if (runId !== aiCompatRunId) return null;
      aiCompatPending = false;
      const msg = err?.message || String(err);
      // A failed call must not look like a rejection — record it as unavailable.
      lastAiCompatResult = { status: 'error', message: msg };
      lastAiCompatCacheKey = cacheKey;
      if (showStatus) showStatus(msg, 'error');
      await refreshBidFitPreflight();
      return null;
    } finally {
      if (manual && btn) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }
  }

  /**
   * Put back a verdict saved with a tab's draft. Restoring the Note has just
   * marked the check pending; the queued auto-run then hits this cache instead
   * of calling the API again.
   */
  function restoreAiCompatFromSession(saved) {
    const result = saved?.result;
    const cacheKey = String(saved?.cacheKey || '');
    const note = document.getElementById('regNote');
    if (result?.status !== 'done' || !cacheKey || !noteJdReadyForAi(note)) return;

    aiCompatRunId += 1;
    lastAiCompatResult = result;
    lastAiCompatCacheKey = cacheKey;
    aiCompatPending = false;
    aiCompatPinned = Boolean(saved.pinned);
    rememberAiCompatResult(cacheKey, result);

    void refreshBidFitPreflight();
  }

  /** A check that throws outside its own handling must not leave "Checking…" up. */
  function releaseAiCompatAfterCrash() {
    aiCompatPending = false;
    void refreshBidFitPreflight();
  }

  /**
   * Schedule an automatic (silent) compatibility check after the JD settles.
   * Paste / bulk fill uses delay 0; typing uses 2s so mid-edit doesn't spam.
   */
  function scheduleAutoAiCompat({ immediate = false } = {}) {
    if (autoAiCompatTimer) clearTimeout(autoAiCompatTimer);
    autoAiCompatTimer = setTimeout(() => {
      autoAiCompatTimer = null;
      runAiCompatCheck(null, { manual: false }).catch(releaseAiCompatAfterCrash);
    }, immediate ? 0 : AI_COMPAT_TYPING_DELAY_MS);
  }

  function wireBidFitAiCompat(showStatus) {
    const btn = document.getElementById('rbFitAiCompatBtn');
    if (btn && btn.dataset.wired !== '1') {
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        // Manual re-check: clear cache so it always re-runs.
        lastAiCompatResult = null;
        lastAiCompatCacheKey = '';
        markAiCompatPending();
        runAiCompatCheck(showStatus, { manual: true }).catch(releaseAiCompatAfterCrash);
      });
    }

    // A key saved in Settings makes the AI verdict worth waiting for again.
    if (btn && chrome.storage?.onChanged && btn.dataset.keyWatch !== '1') {
      btn.dataset.keyWatch = '1';
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[AI_AUTOFILL_SETTINGS_KEY]) aiCompatKeyMissing = false;
      });
    }

    // Escape hatch for a wrong AI blocker; shown only when nothing else blocks.
    const copyAnywayBtn = document.getElementById('rbFitCopyAnywayBtn');
    if (copyAnywayBtn && copyAnywayBtn.dataset.wired !== '1') {
      copyAnywayBtn.dataset.wired = '1';
      copyAnywayBtn.addEventListener('click', () => {
        copyAnywayBtn.disabled = true;
        buildAndCopyPromptFromKit(showStatus, { force: true })
          .catch((err) => {
            const msg = err.message || String(err);
            setRegisterStatus(msg, 'error');
            if (showStatus) showStatus(msg, 'error');
          })
          .finally(() => {
            copyAnywayBtn.disabled = false;
          });
      });
    }
  }

  /**
   * Candidate facts the compatibility screen is allowed to reject a job on.
   *
   * Fixed defaults for this product:
   *   - sponsorshipRequirement → "No" (US citizen; never needs sponsorship)
   *   - securityClearance → "No" (reject jobs that require active clearance)
   *   - remotePreference → "Remote" when blank
   *
   * Salary / travel % / employment-type are intentionally not checked.
   */
  function buildCandidateConstraints(record) {
    const str = (v) => String(v ?? '').trim();
    // The profile's website "Autofill details" hold these; the defaults apply
    // to a profile that has not filled them in.
    const details = record?.autofill && typeof record.autofill === 'object' ? record.autofill : {};
    const languages = str(details.languages);
    return {
      city: str(record?.city),
      state: str(record?.state),
      yearsOfExperience: str(details.yearsOfExperience),
      sponsorshipRequirement: str(details.sponsorshipRequirement) || 'No',
      workAuthorizationUS: str(details.workAuthorizationUS) || 'Yes',
      relocationPreference: str(details.relocationPreference),
      remotePreference: 'Remote',
      securityClearance: str(details.securityClearance) || 'No',
      citizenship: str(details.citizenship) || 'US citizen',
      languages: !languages || /^english$/i.test(languages) ? 'English only' : languages,
    };
  }

  /**
   * City/state plus hard constraints for the selected profile.
   * Preflight reruns on every Note keystroke, so this stays cached.
   */
  async function getProfileLocation(profileId) {
    const empty = { city: '', state: '', constraints: buildCandidateConstraints(null) };
    const id = String(profileId || '').trim();
    if (!id) return empty;

    const now = Date.now();
    if (
      profileLocationCache.profileId === id &&
      profileLocationCache.at &&
      now - profileLocationCache.at < PROFILE_LOCATION_CACHE_TTL_MS
    ) {
      return {
        city: profileLocationCache.city,
        state: profileLocationCache.state,
        constraints: profileLocationCache.constraints || buildCandidateConstraints(null),
      };
    }
    if (!backendConnected) return empty;

    try {
      const record = await fetchProfileRecord(id);
      const city = String(record?.city || '').trim();
      const state = String(record?.state || '').trim();
      const constraints = buildCandidateConstraints(record);
      profileLocationCache = { at: now, profileId: id, city, state, constraints };
      return { city, state, constraints };
    } catch (_) {
      return empty;
    }
  }

  async function collectBidFitInputs() {
    const api = global.SmartJobPromptKit;
    const noteText = document.getElementById('regNote')?.value || '';
    const profileId = getSelectedRegisterProfileId();
    // Unedited editor text is not the kit (see buildAndCopyPromptFromKit).
    let template = promptKitEditorDirty
      ? document.getElementById('regPromptKitTemplate')?.value || ''
      : '';
    let resumeTemplateJson = promptKitEditorDirty
      ? document.getElementById('regPromptKitResumeJson')?.value || ''
      : '';

    const {
      city: profileCity,
      state: profileState,
      constraints,
    } = await getProfileLocation(profileId);

    if (api && profileId) {
      try {
        const { kit } = await api.getPromptKit(profileId, { preferLocal: true });
        if (!template.trim()) template = kit.template || '';
        if (!resumeTemplateJson.trim()) resumeTemplateJson = kit.resumeTemplateJson || '';
        const posting = global.SmartJobPostingContext?.getLastPosting?.() || null;
        const jobDescription = api.resolveJobDescriptionForCompat({ noteText, kit, posting });
        return {
          jobDescription,
          template,
          resumeTemplateJson,
          profileCity,
          profileState,
          constraints,
          aiCompat: resolveAiCompatForInputs({ jobDescription, profileCity, profileState, constraints }),
        };
      } catch (_) {
        /* fall through to editor fields */
      }
    }

    const posting = global.SmartJobPostingContext?.getLastPosting?.() || null;
    const jobDescription = api
      ? api.resolveJobDescriptionForCompat({ noteText, kit: null, posting })
      : noteText;
    return {
      jobDescription,
      template,
      resumeTemplateJson,
      profileCity,
      profileState,
      constraints,
      aiCompat: resolveAiCompatForInputs({
        jobDescription,
        profileCity,
        profileState,
        constraints,
      }),
    };
  }

  async function refreshBidFitPreflight() {
    const engine = global.SmartJobBidFitPreflight;
    if (!engine?.evaluateBidFit) {
      lastBidFitResult = null;
      renderBidFitCard(null);
      return null;
    }
    const inputs = await collectBidFitInputs();
    lastBidFitResult = engine.evaluateBidFit(inputs);
    renderBidFitCard(lastBidFitResult);
    syncResumeBuilderActionButtons();
    return lastBidFitResult;
  }

  function scheduleBidFitRefresh({ immediateAi = false } = {}) {
    if (bidFitRefreshTimer) clearTimeout(bidFitRefreshTimer);
    bidFitRefreshTimer = setTimeout(() => {
      bidFitRefreshTimer = null;
      void refreshBidFitPreflight();
    }, 320);
    // Paste/bulk fill: start AI immediately. Typing: wait 2s to settle.
    scheduleAutoAiCompat({ immediate: Boolean(immediateAi) });
  }

  /**
   * After Refresh / job load: ensure AI compat runs for the current Note
   * even when text length barely changed (same-length replace).
   */
  function notifyJobLoadedForBidFit() {
    const note = document.getElementById('regNote');
    if (!noteJdReadyForAi(note)) {
      clearAiCompatResult();
      void refreshBidFitPreflight();
      return;
    }
    if (aiCompatPinned && lastAiCompatResult && note?.dataset.fillSource === 'resume-json') {
      void refreshBidFitPreflight();
      return;
    }
    beginAiCompatWait();
    if (note) note._rbPrevLen = String(note.value || '').trim().length;
    void refreshBidFitPreflight();
    scheduleBidFitRefresh({ immediateAi: true });
  }

  /**
   * Decide whether a Note change should start AI right away (paste / bulk fill)
   * vs wait for typing to settle.
   */
  function shouldStartAiImmediately(noteEl, event) {
    if (!noteEl) return false;
    if (event?.inputType === 'insertFromPaste') return true;
    const len = String(noteEl.value || '').trim().length;
    const prev = Number(noteEl._rbPrevLen) || 0;
    const min = global.SmartJobBidFitPreflight?.MIN_JD_CHARS || 80;
    // Large jump: paste without inputType, or bulk replace into Note.
    return len >= min && len - prev >= min;
  }

  function noteJdReadyForAi(noteEl) {
    const jd = String(noteEl?.value || '').trim();
    const min = global.SmartJobBidFitPreflight?.MIN_JD_CHARS || 80;
    return jd.length >= min;
  }

  function onRegisterNoteChanged(event, { programmatic = false } = {}) {
    const note = document.getElementById('regNote');
    // User paste/edit: drop stale scrape resume/compat slices so Note is sole source.
    if (note?.dataset.fillSource === 'user') {
      global.SmartJobPostingContext?.clearPostingDerivedSlices?.();
    }
    const ready = noteJdReadyForAi(note);
    if (ready && programmatic && note?.dataset.fillSource === 'resume-json' && pinAiCompatToJob()) {
      refreshApplyProgress();
      if (note) note._rbPrevLen = String(note.value || '').trim().length;
      void refreshBidFitPreflight();
      return;
    }
    if (ready) {
      beginAiCompatWait();
    } else {
      clearAiCompatResult();
    }
    refreshApplyProgress();
    const immediateAi =
      ready && (programmatic || shouldStartAiImmediately(note, event));
    if (note) note._rbPrevLen = String(note.value || '').trim().length;
    scheduleBidFitRefresh({ immediateAi });
  }

  function setPromptKitEditorValues(template, resumeTemplateJson) {
    const templateEl = document.getElementById('regPromptKitTemplate');
    const resumeEl = document.getElementById('regPromptKitResumeJson');
    if (templateEl) templateEl.value = template || '';
    if (resumeEl) resumeEl.value = resumeTemplateJson || '';
    promptKitEditorDirty = false;
  }

  async function refreshPromptKitUi({ fillEditor = false, syncRemote = false } = {}) {
    const api = global.SmartJobPromptKit;
    const profileId = getSelectedRegisterProfileId();
    const kitDetails = document.getElementById('regPromptKitBlock');
    const buildBtn = document.getElementById('regBuildCopyPromptBtn');

    if (!api) {
      updatePromptKitStatus('Prompt kit module not loaded.', 'error');
      if (buildBtn) buildBtn.disabled = true;
      syncRbStatusChips();
      syncResumeBuilderActionButtons();
      return;
    }

    if (!profileId) {
      updatePromptKitStatus('Select a profile to load a kit.', '');
      if (buildBtn) buildBtn.disabled = true;
      // Nothing is written into the editor here: with no profile there is no
      // kit to show, and the default would look like the user's prompt was reset.
      syncRbStatusChips();
      syncResumeBuilderActionButtons();
      void refreshBidFitPreflight();
      return;
    }

    try {
      const pack = syncRemote
        ? await api.getPromptKit(profileId)
        : typeof api.getPromptKitLocal === 'function'
          ? await api.getPromptKitLocal(profileId)
          : await api.getPromptKit(profileId, { preferLocal: true });
      const kit = pack.kit || {};
      const exists = Boolean(pack.exists);
      updatePromptKitStatus(api.kitStatusSummary(kit, exists), exists ? 'success' : '');
      if ((fillEditor || kitDetails?.open) && !promptKitEditorDirty) {
        setPromptKitEditorValues(
          kit.template || api.DEFAULT_PROMPT_TEMPLATE,
          kit.resumeTemplateJson || ''
        );
      }
    } catch (err) {
      updatePromptKitStatus(err.message || 'Failed to load prompt kit.', 'error');
    }
    syncRbStatusChips();
    await refreshBidFitPreflight();
  }

  async function buildAndCopyPromptFromKit(showStatus, { force = false } = {}) {
    const api = global.SmartJobPromptKit;
    if (!api) throw new Error('Prompt kit module not loaded.');

    const profileId = getSelectedRegisterProfileId();
    if (!profileId) throw new Error('Select a profile first.');

    // The saved kit is the source of truth. A browser that has never used this
    // profile has no local copy yet, so fetch the account's kit before building:
    // building from the placeholder default and saving it back used to replace
    // the account's own prompt.
    let kit;
    const localPack =
      typeof api.getPromptKitLocal === 'function'
        ? await api.getPromptKitLocal(profileId)
        : await api.getPromptKit(profileId, { preferLocal: true });
    kit = { ...(localPack.kit || {}) };
    if (!localPack.exists) {
      const remotePack = await api.getPromptKit(profileId);
      kit = { ...(remotePack.kit || kit) };
    }

    // The editor overrides it only when the user has actually typed in it. Its
    // unedited contents may be the default shown before the kit had loaded.
    if (promptKitEditorDirty) {
      const editorTemplate = document.getElementById('regPromptKitTemplate')?.value || '';
      const editorResumeJson = document.getElementById('regPromptKitResumeJson')?.value || '';
      if (String(editorTemplate).trim()) kit.template = editorTemplate;
      if (String(editorResumeJson).trim()) kit.resumeTemplateJson = editorResumeJson;
    }

    const noteText = document.getElementById('regNote')?.value || '';
    const posting = global.SmartJobPostingContext?.getLastPosting?.() || null;
    const jobDescription = api.resolveJobDescriptionForCompat({ noteText, kit, posting });
    const jobDescriptionForResume = api.resolveJobDescriptionForResume({ noteText, kit, posting });
    const {
      city: profileCity,
      state: profileState,
      constraints,
    } = await getProfileLocation(profileId);
    const aiCompat = resolveAiCompatForInputs({ jobDescription, profileCity, profileState, constraints });

    const fit = global.SmartJobBidFitPreflight?.evaluateBidFit?.({
      jobDescription,
      template: kit.template,
      resumeTemplateJson: kit.resumeTemplateJson,
      profileCity,
      profileState,
      constraints,
      aiCompat,
    });
    if (fit) {
      lastBidFitResult = fit;
      renderBidFitCard(fit);
      syncResumeBuilderActionButtons();
    }

    if (fit && !fit.canCopy && !force) {
      const top =
        fit.reasons.find((r) => r.severity === 'block')?.message ||
        'Preflight: skip — don’t waste a ChatGPT run.';
      throw new Error(top);
    }

    const { prompt, missingPlaceholders } = api.buildPrompt(
      kit.template,
      kit.resumeTemplateJson,
      jobDescriptionForResume
    );

    if (!String(prompt || '').trim()) {
      throw new Error('Nothing to copy — prompt is empty.');
    }

    await copyTextToClipboard(prompt);

    promptCopiedAt = Date.now();
    syncTabSession();

    let message = 'Final prompt copied to clipboard. Paste into GPT, then open Resume JSON.';
    if (missingPlaceholders.length) {
      message = `Copied (empty: ${missingPlaceholders.join(', ')}). Fill kit / Note, then rebuild.`;
      setRegisterStatus(message, 'warn');
      if (showStatus) showStatus(message, 'error');
    } else if (fit?.level === 'risky') {
      message = 'Copied (preflight weak). Paste into GPT if you still want to try.';
      setRegisterStatus(message, 'warn');
      if (showStatus) showStatus(message, 'warn');
    } else {
      setRegisterStatus(message, 'success');
      if (showStatus) showStatus(message, 'success');
    }

    // Persist in the background. Do not reload the kit — that was resetting the original prompt.
    void api.savePromptKit(
      profileId,
      { ...kit, output: prompt, jobDescription },
      { swallowRemoteError: true }
    ).catch(() => {
      /* non-fatal */
    });

    return { prompt, missingPlaceholders, fit };
  }

  async function savePromptKitFromEditor(showStatus) {
    const api = global.SmartJobPromptKit;
    if (!api) throw new Error('Prompt kit module not loaded.');
    const profileId = getSelectedRegisterProfileId();
    if (!profileId) throw new Error('Select a profile first.');

    const template = document.getElementById('regPromptKitTemplate')?.value ?? '';
    const resumeTemplateJson = document.getElementById('regPromptKitResumeJson')?.value ?? '';
    const noteText = String(document.getElementById('regNote')?.value || '').trim();
    const existing = await api.getPromptKit(profileId);
    const next = await api.savePromptKit(profileId, {
      ...existing.kit,
      // An empty box is not "use the default": keep what is saved. Reset template
      // is the explicit way to go back to the default.
      template: String(template).trim() ? template : existing.kit.template,
      resumeTemplateJson,
      jobDescription: noteText || existing.kit.jobDescription || '',
    });
    promptKitEditorDirty = false;
    updatePromptKitStatus(api.kitStatusSummary(next, true), 'success');
    setRegisterStatus('Prompt kit saved for this profile (account).', 'success');
    if (showStatus) showStatus('Prompt kit saved for this profile.', 'success');
    syncRbStatusChips();
    return next;
  }

  function wireResumeBuilderChrome() {
    const openJsonBtn = document.getElementById('regOpenResumeJsonBtn');
    const kitDetails = document.getElementById('regPromptKitBlock');
    const modal = document.getElementById('rbMaxModal');
    const modalTitle = document.getElementById('rbMaxModalTitle');
    const modalTextarea = document.getElementById('rbMaxModalTextarea');
    const modalClose = document.getElementById('rbMaxModalCloseBtn');
    const modalApply = document.getElementById('rbMaxModalApplyBtn');
    let maxTargetId = null;

    const fieldMap = {
      kitTemplate: 'regPromptKitTemplate',
      kitResumeJson: 'regPromptKitResumeJson',
      resumeJson: 'regResumeJson',
    };

    function openMax(key) {
      const id = fieldMap[key];
      const source = id ? document.getElementById(id) : null;
      if (!source || !modal || !modalTextarea || !modalTitle) return;
      maxTargetId = id;
      const titles = {
        kitTemplate: 'Original prompt',
        kitResumeJson: 'resume_template_json',
        resumeJson: 'Built resume JSON',
      };
      modalTitle.textContent = titles[key] || 'Edit';
      modalTextarea.value = source.value || '';
      modal.hidden = false;
      modalTextarea.focus();
    }

    function closeMax() {
      if (modal) modal.hidden = true;
      maxTargetId = null;
    }

    function applyMax() {
      if (!maxTargetId || !modalTextarea) return;
      const target = document.getElementById(maxTargetId);
      if (!target) return;
      target.value = modalTextarea.value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      closeMax();
    }

    if (openJsonBtn && openJsonBtn.dataset.wired !== '1') {
      openJsonBtn.dataset.wired = '1';
      openJsonBtn.addEventListener('click', () => openMax('resumeJson'));
    }
    if (kitDetails && kitDetails.dataset.wired !== '1') {
      kitDetails.dataset.wired = '1';
      kitDetails.addEventListener('toggle', () => {
        if (kitDetails.open) void refreshPromptKitUi({ fillEditor: true, syncRemote: true });
      });
    }

    document.querySelectorAll('[data-rb-max]').forEach((btn) => {
      if (btn.dataset.wired === '1') return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => openMax(btn.getAttribute('data-rb-max')));
    });
    if (modalClose && modalClose.dataset.wired !== '1') {
      modalClose.dataset.wired = '1';
      modalClose.addEventListener('click', closeMax);
    }
    if (modalApply && modalApply.dataset.wired !== '1') {
      modalApply.dataset.wired = '1';
      modalApply.addEventListener('click', applyMax);
    }
    if (modal && modal.dataset.wired !== '1') {
      modal.dataset.wired = '1';
      modal.addEventListener('click', (event) => {
        if (event.target === modal) closeMax();
      });
    }
  }

  function wirePromptKitStorageSync() {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    if (wirePromptKitStorageSync._wired) return;
    wirePromptKitStorageSync._wired = true;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const selected = getSelectedRegisterProfileId();
      if (!selected) return;

      const api = global.SmartJobPromptKit;
      const key = api?.kitStorageKey?.(selected) || `promptKit_v1_${selected}`;
      if (!changes[key]) return;

      if (api?.takeOwnKitWrite?.(key)) return;

      const kitDetails = document.getElementById('regPromptKitBlock');
      const fillEditor = Boolean(kitDetails?.open) && !promptKitEditorDirty;
      void refreshPromptKitUi({ fillEditor, syncRemote: false });
      if (!promptKitEditorDirty) {
        setRegisterStatus('Prompt kit updated from website sync.', 'info');
      }
    });
  }

  function wirePromptKitControls(showStatus) {
    const buildBtn = document.getElementById('regBuildCopyPromptBtn');
    const saveBtn = document.getElementById('regPromptKitSaveBtn');
    const resetBtn = document.getElementById('regPromptKitResetTemplateBtn');
    const api = global.SmartJobPromptKit;

    if (buildBtn && buildBtn.dataset.wired !== '1') {
      buildBtn.dataset.wired = '1';
      buildBtn.addEventListener('click', () => {
        setRegisterStatus('Building prompt…', 'info');
        setRbButtonLoading(buildBtn, true);
        buildAndCopyPromptFromKit(showStatus, { force: false })
          .catch((err) => {
            const msg = err.message || String(err);
            setRegisterStatus(msg, 'error');
            if (showStatus) showStatus(msg, 'error');
            void refreshBidFitPreflight();
          })
          .finally(() => setRbButtonLoading(buildBtn, false));
      });
    }

    if (saveBtn && saveBtn.dataset.wired !== '1') {
      saveBtn.dataset.wired = '1';
      saveBtn.addEventListener('click', () => {
        savePromptKitFromEditor(showStatus)
          .then(() => refreshBidFitPreflight())
          .catch((err) => {
            const msg = err.message || String(err);
            setRegisterStatus(msg, 'error');
            if (showStatus) showStatus(msg, 'error');
          });
      });
    }

    if (resetBtn && resetBtn.dataset.wired !== '1') {
      resetBtn.dataset.wired = '1';
      resetBtn.addEventListener('click', () => {
        const ta = document.getElementById('regPromptKitTemplate');
        if (ta && api) ta.value = api.DEFAULT_PROMPT_TEMPLATE;
        promptKitEditorDirty = true;
        setRegisterStatus('Template reset to default (Save kit to keep).', 'info');
        scheduleBidFitRefresh();
      });
    }

    ['regPromptKitTemplate', 'regPromptKitResumeJson'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.dataset.bidFitWired !== '1') {
        el.dataset.bidFitWired = '1';
        el.addEventListener('input', () => {
          promptKitEditorDirty = true;
          scheduleBidFitRefresh();
        });
      }
    });

    wireResumeBuilderChrome();
    void refreshPromptKitUi({ fillEditor: true, syncRemote: true });
    syncRbStatusChips();
    document.addEventListener('rwh-json2docx-ui', () => {
      syncRbStatusChips();
      // json2docx availability gates the Generate Files step.
      refreshApplyProgress();
    });
  }

  function initRegisterResumeDb(showStatus) {
    const registerBtn = document.getElementById('registerJobBtn');

    loadBackendSettingsForm();
    wireBackendSettingsForm(showStatus);
    wireRegisterFileDrops();
    wireProfileSelectPersistence();
    wireDuplicateWindowSetting();
    wireResumeJsonLiveFill(showStatus);
    wireRegisterTabSession();
    wireJobLinkDuplicateAutoCheck(showStatus);
    wireCompanyDuplicateAutoCheck(showStatus);
    wireJobLinkBlockAutoSync();
    wireJson2docxGenerate(showStatus);
    wireBidFitToggle();
    wireBidFitAiCompat(showStatus);
    wireBidDetailsSummary();
    // Kick off the first check shortly after init (a JD may already be present).
    if (noteJdReadyForAi(document.getElementById('regNote'))) {
      markAiCompatPending();
      scheduleAutoAiCompat({ immediate: true });
    }
    wirePromptKitControls(showStatus);
    wirePromptKitStorageSync();
    startConnectionPolling();
    syncResumeBuilderActionButtons();
    setGenerateProgress({ hidden: true, percent: 0, message: '' });
    wireApplyNextCue();
    wireApplyProgressLiveInputs();
    refreshApplyProgress();

    document.querySelectorAll('[data-tab="settings"]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        loadBackendSettingsForm();
        loadDuplicateWindowSetting();
        checkBackendConnection();
      });
    });

    const headerSettings = document.getElementById('headerSettingsBtn');
    if (headerSettings) {
      headerSettings.addEventListener('click', () => {
        const settingsOpen = document.getElementById('tab-settings')?.classList.contains('active');
        if (settingsOpen) {
          loadBackendSettingsForm();
          loadDuplicateWindowSetting();
          checkBackendConnection();
        } else {
          onRegisterViewShown();
        }
      });
    }

    if (registerBtn) {
      registerBtn.addEventListener('click', async () => {
        // One registration at a time. The button's loading state does not
        // disable it, so a double-click used to send two requests, both of
        // which passed the duplicate check before either had saved.
        if (registerInFlight) return;
        registerInFlight = true;
        setRegisterBusy(true);
        try {
          const connected = await checkBackendConnection({ skipDriveBadge: true });
          if (!connected) {
            throw new Error(
              'Not signed in. Open Settings → Website connection, enter your username and password, and click Sign in.'
            );
          }

          if (!hasUsableBuiltResumeJson()) {
            throw new Error(
              'Paste a built resume JSON with resume_template and job fields first.'
            );
          }

          // This tab already registered this job. The server-side list is the
          // usual guard, but it is cached and can lag a just-saved record.
          const currentLinkKey = canonicalJobLinkKey(document.getElementById('regJobLink')?.value || '');
          if (registeredRecord.id && registeredRecord.jobLinkKey && registeredRecord.jobLinkKey === currentLinkKey) {
            throw new Error(`This job is already registered (#${registeredRecord.id}).`);
          }

          if (jobLinkDuplicateActive) {
            throw new Error(
              'Duplicate job link — already in Resume DB for this profile. Change the job link or select a different profile.'
            );
          }

          const linkDup = await checkFieldDuplicate('link', showStatus, { quietIfNone: true });
          if (linkDup.level === 'duplicate') {
            throw new Error(
              'Duplicate job link — already in Resume DB for this profile. Change the job link or select a different profile.'
            );
          }

          // After the panel is reopened the generated files are gone (the
          // browser cannot keep them), and registering would save no resume.
          if (filesNeedRegeneration) {
            throw new Error(
              'The generated files are no longer attached. Click Generate again, or clear them under “Attach your own files” to register without files.'
            );
          }

          const draft = prepareRegisterDraftForSubmit();
          if (!draft.ok) {
            throw new Error(draft.errors[0] || 'Register draft is incomplete.');
          }
          const registerToken = tabSession()?.getGeneration();
          const registerTabId = tabSession()?.getBoundTabId?.();
          if (draft.warnings?.length) {
            setRegisterStatus(draft.warnings.join(' '), 'warn');
          }

          const resumeFile = draft.resumeFile;
          const coverFile = draft.coverFile;
          const needsFileUpload = registerNeedsFileUpload(false, false, resumeFile, coverFile);

          setRegisterStatus(
            needsFileUpload
              ? 'Uploading files & saving to Resume DB…'
              : 'Saving to Resume DB…',
            'info'
          );
          const submittedLinkKey = canonicalJobLinkKey(draft.fields?.jobLink || '');
          const result = await registerJobToBackend();
          invalidateApplicationsCache();
          const record = { id: String(result.id || ''), at: Date.now(), jobLinkKey: submittedLinkKey };
          // Switched tabs during the upload: the record belongs to the tab it
          // was sent from. Mark that one, and leave this one untouched.
          if (tabSession() && !tabSession().isCurrentGeneration(registerToken)) {
            tabSession().mutateSlice?.(registerTabId, 'register', (slice) => ({
              ...(slice || {}),
              registeredRecord: record,
              files: { resume: null, cover: null },
            }));
            if (showStatus) showStatus(`Job registered (#${record.id}) for the tab you started on.`, 'success');
            return;
          }
          registeredRecord = record;
          const sourceNote = result._draftFromJson ? ' (from resume JSON draft)' : '';
          const fileNote =
            result.resumeUrl || result.coverLetterUrl ? ' Files saved.' : '';
          setRegisterStatus(
            `Registered (#${result.id}, ${result.candidateName || 'profile'})${sourceNote}.${fileNote}`,
            'success'
          );
          if (showStatus) showStatus('Job registered in Resume DB.', 'success');
          clearAllRegisterFiles();
        } catch (err) {
          const msg = err.message || String(err);
          setRegisterStatus(msg, 'error');
          if (showStatus) showStatus(msg, 'error');
        } finally {
          registerInFlight = false;
          setRegisterBusy(false);
        }
      });
    }

    wireRegisterFieldCopy('regNoteCopyBtn', 'regNote', 'Note copied to clipboard.', 'Could not copy note.', showStatus);
    wireRegisterFieldCopy('regJobTitleCopyBtn', 'regJobTitle', 'Job title copied to clipboard.', 'Could not copy job title.', showStatus);
    wireRegisterFieldCopy('regCompanyCopyBtn', 'regCompany', 'Company copied to clipboard.', 'Could not copy company name.', showStatus);
    wireRegisterFieldCopy('regJobLinkCopyBtn', 'regJobLink', 'Job link copied to clipboard.', 'Could not copy job link.', showStatus);
    wireRegisterFieldDup('regCompanyDupBtn', 'company', showStatus);
    wireRegisterFieldDup('regJobLinkDupBtn', 'link', showStatus);
    wireRegisterFieldBlock('regJobLinkBlockBtn', showStatus);
    syncJobLinkBlockButton();
  }

  function onRegisterViewShown() {
    checkBackendConnection();
    loadProfilesIntoSelect();
    updateRegisterDriveBadge();
    void refreshPromptKitUi();
    syncRbStatusChips();
  }

  global.SmartJobRegisterResumeDb = {
    initRegisterResumeDb,
    getBackendConfig,
    saveBackendConfig,
    checkBackendConnection,
    fetchProfileRecord,
    onRegisterViewShown,
    syncResumeBuilderActionButtons,
    buildAndCopyPromptFromKit,
    refreshBidFitPreflight,
    scheduleBidFitRefresh,
    notifyJobLoadedForBidFit,
    updateRegisterDriveBadge,
    loadBackendSettingsForm,
    hasActiveResumeJsonOverride,
    applyResumeJsonToRegisterForm,
    clearResumeJsonOverride,
    prepareRegisterDraftForSubmit,
    computeApplyProgress,
    refreshApplyProgress,
    notifyRegisterJobLinkFilled,
    notifyRegisterCompanyFilled,
    blockCurrentJobFromRegister,
    syncJobLinkBlockButton,
    setRegisterFieldValue,
    BACKEND_URL_KEY,
    EXTENSION_API_KEY_KEY,
    DEFAULT_BACKEND
  };
})(typeof window !== 'undefined' ? window : self);
