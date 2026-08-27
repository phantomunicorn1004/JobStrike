/**
 * Resume DB registration tab — communicates with remote-work-helper backend only.
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
  let autoAttachedFromJson2docx = { resume: false, cover: false };
  let resumeJsonOverrideActive = false;
  let resumeJsonApplyTimer = null;
  let resumeJsonDupTimer = null;
  /** @type {Map<number, string>} Built resume JSON keyed by Chrome tab id */
  const resumeJsonByTabId = new Map();
  /** Tab id the textarea currently represents */
  let resumeJsonBoundTabId = null;
  let lastAutoCheckedCompanyKey = '';

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

  async function clearAuthConfig() {
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
    const el = document.getElementById('registerStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'register-status' + (type ? ` is-${type}` : '');
    el.hidden = !message;
  }

  function setSettingsHint(message, type) {
    const el = document.getElementById('backendSettingsHint');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'muted register-settings-hint' + (type ? ` is-${type}` : '');
    el.hidden = !message;
  }

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

  function syncResumeBuilderActionButtons({ registerBusy = false } = {}) {
    const hasJson = hasUsableBuiltResumeJson();
    const generateBtn = document.getElementById('regGenerateFilesBtn');
    const registerBtn = document.getElementById('registerJobBtn');

    if (generateBtn && !generateBtn.classList.contains('is-loading')) {
      generateBtn.disabled = !hasJson;
      generateBtn.title = hasJson
        ? 'Convert JSON via local json2docx and attach files'
        : 'Paste a built resume JSON with resume_template and job fields first';
    }

    if (registerBtn && !registerBtn.classList.contains('is-loading')) {
      registerBtn.disabled = Boolean(registerBusy) || !backendConnected || !hasJson;
      if (!backendConnected) {
        registerBtn.title = 'Sign in under Settings to register';
      } else if (!hasJson) {
        registerBtn.title = 'Paste a built resume JSON with resume_template and job fields first';
      } else {
        registerBtn.title = 'Register this job to Resume DB';
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

    syncOptimizedActionButtons({ registerBusy });
  }

  function syncOptimizedActionButtons({ registerBusy = false } = {}) {
    const hasJson = hasUsableBuiltResumeJson();
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

    const optGenerate = document.getElementById('optGenerateFilesBtn');
    if (optGenerate && !optGenerate.classList.contains('is-loading')) {
      optGenerate.disabled = !hasJson;
    }
    const optRegister = document.getElementById('optRegisterBtn');
    if (optRegister && !optRegister.classList.contains('is-loading')) {
      optRegister.disabled = Boolean(registerBusy) || !backendConnected || !hasJson;
    }
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

  function applicationSameCompany(app, job) {
    return (
      matchKeysEqual(app.company, job.companyName) &&
      hasMatchKey(job.companyName)
    );
  }

  function normalizeJobLinkKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      const path = u.pathname.replace(/\/+$/, '') || '';
      return `${u.hostname}${path}${u.search}`.toLowerCase();
    } catch {
      return normalizeMatchKey(raw);
    }
  }

  function applicationSameJobLink(app, jobLink) {
    const left = normalizeJobLinkKey(app.jobLink);
    const right = normalizeJobLinkKey(jobLink);
    if (!left || !right) return false;
    return left === right;
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

  async function fetchResumeDbApplications() {
    const config = await getBackendConfig();
    const res = await fetch(`${config.baseUrl}/api/resume-db`, {
      headers: apiHeaders(config),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load Resume DB applications');
    }
    return Array.isArray(data.resumes) ? data.resumes : [];
  }

  async function checkFieldDuplicate(field, showStatus, { quietIfNone = false } = {}) {
    const connected = await checkBackendConnection();
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
    const applications = await fetchResumeDbApplications();
    const forCandidate = applications
      .filter((app) => String(app.profileId) === String(profileId))
      .filter((app) => isWithinDuplicateCheckWindow(app, windowDays));

    const match = forCandidate.find((app) => config.matches(app));
    if (match) {
      const { when, detail } = formatApplicationSummary(match, fields);
      const message = `Duplicate ${config.label.toLowerCase()} — already in Resume DB for this profile${windowSuffix}${
        when ? ` (${when}${detail ? `: ${detail}` : ''})` : detail ? ` (${detail})` : ''
      }.`;
      setRegisterStatus(message, 'error');
      if (showStatus) showStatus(`Duplicate ${config.label.toLowerCase()} for this profile.`, 'error');
      return { level: 'duplicate', match, windowDays, field };
    }

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

  function scheduleCompanyDuplicateCheckFromResumeJson(companyName, showStatus) {
    const key = normalizeMatchKey(companyName);
    if (!key) return;
    if (key === lastAutoCheckedCompanyKey) return;
    if (resumeJsonDupTimer) clearTimeout(resumeJsonDupTimer);
    resumeJsonDupTimer = setTimeout(() => {
      void runAutoCompanyDuplicateCheck(companyName, showStatus);
    }, 450);
  }

  async function runAutoCompanyDuplicateCheck(companyName, showStatus) {
    const key = normalizeMatchKey(companyName);
    if (!key || key === lastAutoCheckedCompanyKey) return;
    if (!backendConnected) return;
    const profileId = document.getElementById('regProfileId')?.value?.trim();
    if (!profileId) return;

    lastAutoCheckedCompanyKey = key;
    try {
      await checkFieldDuplicate('company', showStatus, { quietIfNone: true });
    } catch (_) {
      lastAutoCheckedCompanyKey = '';
    }
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

  async function checkBackendConnection() {
    setConnectionStatus('checking', 'Checking…');
    const config = await getBackendConfig();

    if (!isAuthenticated(config)) {
      setConnectionStatus('error', 'Not signed in — open Settings');
      updateBackendDependentUi(false);
      await updateRegisterDriveBadge();
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
      setConnectionStatus('ok', null, username);
      updateBackendDependentUi(true);
      await updateRegisterDriveBadge();
      return true;
    } catch (err) {
      const host = config.baseUrl.replace(/^https?:\/\//, '');
      setConnectionStatus('error', 'Not connected · ' + host);
      updateBackendDependentUi(false);
      await updateRegisterDriveBadge();
      return false;
    }
  }

  async function fetchWebsiteDriveStatus() {
    const config = await getBackendConfig();
    if (!isAuthenticated(config)) {
      websiteDriveStatus = null;
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
      return data;
    } catch {
      websiteDriveStatus = null;
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
    select.addEventListener('change', () => {
      void saveSelectedProfileId(select.value);
      void refreshPromptKitUi();
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
      await refreshPromptKitUi();
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
      if (RESUME_ACCEPT.includes(ext)) {
        resume = file;
      } else {
        cover = file;
      }
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
    updateRegisterComboDropUi();
    renderGeneratedAttachmentChips();
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

    assignFileToInput(resume, result.resume || null);
    assignFileToInput(cover, result.cover || null);
    autoAttachedFromJson2docx = {
      resume: false,
      cover: false,
    };
    updateRegisterComboDropUi();
    renderGeneratedAttachmentChips();

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

    // Keep the visible form in sync with JSON before submit (link unchanged).
    if (merged.fromJson) {
      if (merged.fields.jobTitle) setRegisterFieldValue('regJobTitle', merged.fields.jobTitle, 'resume-json');
      if (merged.fields.companyName) setRegisterFieldValue('regCompany', merged.fields.companyName, 'resume-json');
      if (merged.fields.note) setRegisterFieldValue('regNote', merged.fields.note, 'resume-json');
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
          const passwordInput = document.getElementById('backendPasswordSetting');
          if (passwordInput) passwordInput.value = '';
          setSettingsHint('Signed in successfully.', 'success');
          if (showStatus) showStatus('Signed in to Resume DB.', 'success');
          await checkBackendConnection();
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
        const ok = await checkBackendConnection();
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

  function persistResumeJsonForTab(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id) || id <= 0) return;
    const text = getResumeJsonText().trim();
    if (text) resumeJsonByTabId.set(id, text);
    else resumeJsonByTabId.delete(id);
    resumeJsonBoundTabId = id;
  }

  function restoreResumeJsonForTab(tabId, { showStatus, silent = true } = {}) {
    const id = Number(tabId);
    if (!Number.isFinite(id) || id <= 0) {
      clearResumeJsonOverride({ clearTextarea: true });
      resumeJsonBoundTabId = null;
      return false;
    }
    const text = resumeJsonByTabId.get(id) || '';
    resumeJsonBoundTabId = id;
    const ta = document.getElementById('regResumeJson');
    if (ta) ta.value = text;
    applyResumeJsonToRegisterForm(text, { silent, showStatus });
    return Boolean(text.trim());
  }

  /**
   * Save JSON for the outgoing tab, then restore JSON for the incoming tab.
   * Call this before scraping job fields on a tab switch.
   */
  function switchResumeJsonTabContext(previousTabId, nextTabId, options = {}) {
    if (previousTabId && Number(previousTabId) !== Number(nextTabId)) {
      persistResumeJsonForTab(previousTabId);
    }
    return restoreResumeJsonForTab(nextTabId, options);
  }

  function rememberResumeJsonForBoundTab() {
    if (resumeJsonBoundTabId) {
      persistResumeJsonForTab(resumeJsonBoundTabId);
      return;
    }
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const id = tabs?.[0]?.id;
        if (id) persistResumeJsonForTab(id);
      });
    } catch (_) {
      /* ignore */
    }
  }

  function wireResumeJsonTabCleanup() {
    if (!chrome?.tabs?.onRemoved) return;
    chrome.tabs.onRemoved.addListener((tabId) => {
      resumeJsonByTabId.delete(Number(tabId));
      if (resumeJsonBoundTabId === Number(tabId)) resumeJsonBoundTabId = null;
    });
  }

  function setRegisterFieldValue(id, value, source) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value == null ? '' : String(value);
    if (source) el.dataset.fillSource = source;
    else delete el.dataset.fillSource;
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
    if (resumeJsonBoundTabId) resumeJsonByTabId.delete(resumeJsonBoundTabId);
    syncResumeBuilderActionButtons();
  }

  /**
   * Apply built resume JSON to Register draft fields (title/company/note).
   * Does not change job link.
   */
  function applyResumeJsonToRegisterForm(rawText, { silent = false, showStatus } = {}) {
    const mapper = global.SmartJobResumeJsonMapper;
    const clearBtn = document.getElementById('regResumeJsonClearBtn');
    const text = String(rawText || '').trim();

    if (!text) {
      lastAutoCheckedCompanyKey = '';
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

    if (fields.jobTitle) setRegisterFieldValue('regJobTitle', fields.jobTitle, 'resume-json');
    if (fields.companyName) setRegisterFieldValue('regCompany', fields.companyName, 'resume-json');
    if (fields.jobDescription) setRegisterFieldValue('regNote', fields.jobDescription, 'resume-json');
    if (fields.companyName) {
      scheduleCompanyDuplicateCheckFromResumeJson(fields.companyName, showStatus);
    }

    resumeJsonOverrideActive = true;
    rememberResumeJsonForBoundTab();
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
    return { ok: true, fields, data: result.data };
  }

  function wireResumeJsonLiveFill(showStatus) {
    const ta = document.getElementById('regResumeJson');
    const clearBtn = document.getElementById('regResumeJsonClearBtn');
    if (!ta) return;

    const scheduleApply = () => {
      if (resumeJsonApplyTimer) clearTimeout(resumeJsonApplyTimer);
      resumeJsonApplyTimer = setTimeout(() => {
        applyResumeJsonToRegisterForm(ta.value, { silent: true, showStatus });
        rememberResumeJsonForBoundTab();
      }, 250);
    };

    ta.addEventListener('input', scheduleApply);
    ta.addEventListener('paste', () => {
      setTimeout(scheduleApply, 0);
    });
    ta.addEventListener('change', () => {
      const result = applyResumeJsonToRegisterForm(ta.value, { silent: false, showStatus });
      rememberResumeJsonForBoundTab();
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

  function setGenerateProgress({ hidden = false, percent = 0, message = '' } = {}) {
    const wrap = document.getElementById('regGenerateProgress');
    const fill = document.getElementById('regGenerateProgressFill');
    const label = document.getElementById('regGenerateProgressLabel');
    if (wrap) wrap.hidden = Boolean(hidden);
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    if (label) label.textContent = message || 'Working…';
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
        } else if (slot === 'cover') {
          assignFileToInput(inputs.cover, null);
          autoAttachedFromJson2docx.cover = false;
        }
        updateRegisterComboDropUi();
        renderGeneratedAttachmentChips();
        setRegisterStatus(`Removed ${slot} attachment.`, 'info');
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
    updateRegisterComboDropUi();
    renderGeneratedAttachmentChips();
    return { resumeFile, coverFile };
  }

  async function generateFilesFromResumeJson(showStatus) {
    const api = global.SmartJobJson2Docx;
    const mapper = global.SmartJobResumeJsonMapper;
    const btn = document.getElementById('regGenerateFilesBtn');
    const ta = document.getElementById('regResumeJson');
    const raw = String(ta?.value || '').trim();

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

    // Keep Register draft in sync before generate.
    applyResumeJsonToRegisterForm(raw, { silent: true });

    if (btn) {
      btn.disabled = true;
      setRbButtonLoading(btn, true);
    }
    setGenerateProgress({ hidden: false, percent: 8, message: 'Starting…' });
    setRegisterStatus('Generating resume files via json2docx…', 'info');

    try {
      const result = await api.generateAndDownloadFiles(parsed.data, {
        onProgress: ({ percent, message }) => {
          setGenerateProgress({
            hidden: false,
            percent: percent ?? 0,
            message: message || 'Working…',
          });
        },
      });

      const attached = attachGeneratedFilesToRegister(result.preferred);
      const names = [];
      if (attached.resumeFile) names.push(attached.resumeFile.name);
      if (attached.coverFile) names.push(attached.coverFile.name);
      if (!names.length) {
        throw new Error('No resume/cover files were returned to attach.');
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
    const chip = document.getElementById('rbChipKit');
    if (chip) {
      chip.classList.toggle('is-ok', type === 'success');
      chip.classList.toggle('is-error', type === 'error');
    }
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

    const filesChip = document.getElementById('rbChipFiles');
    const filesLabel = document.getElementById('regFilesChipLabel');
    const attachHost = document.getElementById('regGeneratedAttachments');
    const attachCount = attachHost
      ? attachHost.querySelectorAll('.register-attach-chip').length
      : 0;
    const summary = document.getElementById('regFilesSummary');
    const hasManual = summary && !summary.hidden && String(summary.textContent || '').trim();
    if (filesChip) {
      if (attachCount > 0 || hasManual) {
        filesChip.hidden = false;
        if (filesLabel) {
          filesLabel.textContent =
            attachCount > 0
              ? `${attachCount} generated file${attachCount === 1 ? '' : 's'}`
              : 'Files attached';
        }
        filesChip.classList.add('is-ok');
      } else {
        filesChip.hidden = true;
        filesChip.classList.remove('is-ok');
      }
    }
  }

  function setRbButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle('is-loading', Boolean(loading));
    const spinner = btn.querySelector('.rb-spinner');
    if (spinner) spinner.hidden = !loading;
  }

  async function refreshPromptKitUi({ fillEditor = false } = {}) {
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
      if (fillEditor || kitDetails?.open) {
        const templateEl = document.getElementById('regPromptKitTemplate');
        const resumeEl = document.getElementById('regPromptKitResumeJson');
        if (templateEl) templateEl.value = api.DEFAULT_PROMPT_TEMPLATE;
        if (resumeEl) resumeEl.value = '';
      }
      syncRbStatusChips();
      syncResumeBuilderActionButtons();
      return;
    }

    if (buildBtn) buildBtn.disabled = false;

    try {
      const { kit, exists } = await api.getPromptKit(profileId);
      updatePromptKitStatus(api.kitStatusSummary(kit, exists), exists ? 'success' : '');
      if (fillEditor || kitDetails?.open) {
        const templateEl = document.getElementById('regPromptKitTemplate');
        const resumeEl = document.getElementById('regPromptKitResumeJson');
        if (templateEl) templateEl.value = kit.template || api.DEFAULT_PROMPT_TEMPLATE;
        if (resumeEl) resumeEl.value = kit.resumeTemplateJson || '';
      }
    } catch (err) {
      updatePromptKitStatus(err.message || 'Failed to load prompt kit.', 'error');
    }
    syncRbStatusChips();
    syncResumeBuilderActionButtons();
  }

  async function buildAndCopyPromptFromKit(showStatus) {
    const api = global.SmartJobPromptKit;
    if (!api) throw new Error('Prompt kit module not loaded.');

    const profileId = getSelectedRegisterProfileId();
    if (!profileId) throw new Error('Select a profile first.');

    const { kit } = await api.getPromptKit(profileId);
    const noteText = document.getElementById('regNote')?.value || '';
    const jobDescription = api.resolveJobDescription({ noteText, kit });
    const { prompt, missingPlaceholders } = api.buildPrompt(
      kit.template,
      kit.resumeTemplateJson,
      jobDescription
    );

    if (!String(prompt || '').trim()) {
      throw new Error('Nothing to copy — prompt is empty.');
    }

    await copyTextToClipboard(prompt);

    try {
      await api.savePromptKit(profileId, { ...kit, output: prompt });
    } catch (_) {
      /* non-fatal: copy already succeeded */
    }

    let message = 'Final prompt copied to clipboard. Paste into GPT, then open Resume JSON.';
    if (missingPlaceholders.length) {
      message = `Copied (empty: ${missingPlaceholders.join(', ')}). Fill kit / Note, then rebuild.`;
      setRegisterStatus(message, 'warn');
      if (showStatus) showStatus(message, 'error');
    } else {
      setRegisterStatus(message, 'success');
      if (showStatus) showStatus(message, 'success');
    }
    void refreshPromptKitUi();
    return { prompt, missingPlaceholders };
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
      template,
      resumeTemplateJson,
      jobDescription: noteText || existing.kit.jobDescription || '',
    });
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
        if (kitDetails.open) void refreshPromptKitUi({ fillEditor: true });
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

      const kitDetails = document.getElementById('regPromptKitBlock');
      const fillEditor = Boolean(kitDetails?.open);
      void refreshPromptKitUi({ fillEditor });
      setRegisterStatus('Prompt kit updated from website sync.', 'info');
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
        buildAndCopyPromptFromKit(showStatus)
          .catch((err) => {
            const msg = err.message || String(err);
            setRegisterStatus(msg, 'error');
            if (showStatus) showStatus(msg, 'error');
          })
          .finally(() => setRbButtonLoading(buildBtn, false));
      });
    }

    if (saveBtn && saveBtn.dataset.wired !== '1') {
      saveBtn.dataset.wired = '1';
      saveBtn.addEventListener('click', () => {
        savePromptKitFromEditor(showStatus).catch((err) => {
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
        setRegisterStatus('Template reset to default (Save kit to keep).', 'info');
      });
    }

    wireResumeBuilderChrome();
    void refreshPromptKitUi({ fillEditor: true });
    syncRbStatusChips();
    document.addEventListener('rwh-json2docx-ui', () => syncRbStatusChips());
  }

  function initRegisterResumeDb(showStatus) {
    const registerBtn = document.getElementById('registerJobBtn');

    loadBackendSettingsForm();
    wireBackendSettingsForm(showStatus);
    wireRegisterFileDrops();
    wireProfileSelectPersistence();
    wireDuplicateWindowSetting();
    wireResumeJsonLiveFill(showStatus);
    wireResumeJsonTabCleanup();
    wireJson2docxGenerate(showStatus);
    wirePromptKitControls(showStatus);
    wirePromptKitStorageSync();
    startConnectionPolling();
    syncResumeBuilderActionButtons();
    setGenerateProgress({ hidden: true, percent: 0, message: '' });

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
        setRegisterBusy(true);
        try {
          const connected = await checkBackendConnection();
          if (!connected) {
            throw new Error(
              'Not signed in. Open Settings → Website connection, enter your username and password, and click Sign in.'
            );
          }

          const draft = prepareRegisterDraftForSubmit();
          if (!draft.ok) {
            throw new Error(draft.errors[0] || 'Register draft is incomplete.');
          }
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
          const result = await registerJobToBackend();
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
    updateRegisterDriveBadge,
    loadBackendSettingsForm,
    hasActiveResumeJsonOverride,
    applyResumeJsonToRegisterForm,
    clearResumeJsonOverride,
    persistResumeJsonForTab,
    restoreResumeJsonForTab,
    switchResumeJsonTabContext,
    prepareRegisterDraftForSubmit,
    BACKEND_URL_KEY,
    EXTENSION_API_KEY_KEY,
    DEFAULT_BACKEND
  };
})(typeof window !== 'undefined' ? window : self);
