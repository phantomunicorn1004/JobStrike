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
  const OFFLINE_QUEUE_KEY = 'resume_db_offline_queue';
  const DUPLICATE_CHECK_WINDOW_DAYS_KEY = 'resume_db_duplicate_check_window_days';
  const DEFAULT_DUPLICATE_CHECK_WINDOW_DAYS = 15;
  const DEFAULT_BACKEND = 'https://remote-work-helper.vercel.app';
  const QUEUE_VERSION = 1;

  let connectionPollTimer = null;
  let profilesLoadSeq = 0;
  let backendConnected = false;
  let websiteDriveStatus = null;

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

  async function getTargetJobTab() {
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current?.id && current.url && /^https?:\/\//i.test(current.url)) {
      return current;
    }

    try {
      const lastFocused = await chrome.windows.getLastFocused({
        populate: true,
        windowTypes: ['normal']
      });
      const active = lastFocused?.tabs?.find((tab) => tab.active);
      if (active?.id) return active;
    } catch (_) {
      /* ignore */
    }

    const normals = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    for (const win of normals) {
      const active = win.tabs?.find((tab) => tab.active);
      if (active?.id && active.url && /^https?:\/\//i.test(active.url)) return active;
    }

    const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (fallback?.id) return fallback;
    throw new Error('No active tab.');
  }

  async function sendToActiveTab(message) {
    const tab = await getTargetJobTab();
    if (!tab?.id) throw new Error('No active tab.');
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return { response, tab };
  }

  async function scrapeJobFromTab() {
    const { response, tab } = await sendToActiveTab({ action: 'getJobFields' });
    if (!response?.success && !response?.job_title && !response?.company_name) {
      throw new Error(response?.error || 'Could not read job info from this page.');
    }
    return {
      jobTitle: response.job_title || '',
      companyName: response.company_name || '',
      jobLink: response.job_link || tab.url || '',
      jobDescription: response.job_description || '',
    };
  }

  function formatJobPostingForClipboard(job) {
    const lines = [];
    if (job.jobTitle) lines.push(`Job title: ${job.jobTitle}`);
    if (job.companyName) lines.push(`Company: ${job.companyName}`);
    if (job.jobLink) lines.push(`Job link: ${job.jobLink}`);
    if (job.jobDescription) {
      if (lines.length) lines.push('');
      lines.push(job.jobDescription);
    }
    return lines.join('\n');
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

  async function copyJobDescriptionFromTab(showStatus) {
    const job = await scrapeJobFromTab();
    const text = formatJobPostingForClipboard(job);
    if (!text.trim()) throw new Error('No job description found on this page.');
    await copyTextToClipboard(text);
    document.getElementById('regJobTitle').value = job.jobTitle;
    document.getElementById('regCompany').value = job.companyName;
    document.getElementById('regJobLink').value = job.jobLink;
    setRegisterStatus('Job description copied to clipboard.', 'success');
    if (showStatus) showStatus('Job description copied to clipboard.', 'success');
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
    if (btn) {
      btn.disabled = busy || !backendConnected;
      btn.textContent = busy ? '…' : 'Register';
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

  async function checkFieldDuplicate(field, showStatus) {
    const connected = await checkBackendConnection();
    if (!connected) {
      throw new Error(
        'Not signed in. Open Settings → Website connection and sign in to check Resume DB.'
      );
    }

    const profileId = document.getElementById('regProfileId')?.value?.trim();
    if (!profileId) {
      throw new Error('Select a candidate first.');
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
      const message = `Duplicate ${config.label.toLowerCase()} — already in Resume DB for this candidate${windowSuffix}${
        when ? ` (${when}${detail ? `: ${detail}` : ''})` : detail ? ` (${detail})` : ''
      }.`;
      setRegisterStatus(message, 'error');
      if (showStatus) showStatus(`Duplicate ${config.label.toLowerCase()} for this candidate.`, 'error');
      return { level: 'duplicate', match, windowDays, field };
    }

    const noMatchMessage =
      windowDays > 0
        ? `No matching ${config.label.toLowerCase()} in the last ${windowDays} day${
            windowDays === 1 ? '' : 's'
          } for this candidate.`
        : `No matching ${config.label.toLowerCase()} for this candidate.`;
    setRegisterStatus(noMatchMessage, 'success');
    if (showStatus) showStatus(noMatchMessage, 'success');
    return { level: 'none', match: null, windowDays, field };
  }

  function setConnectionStatus(state, detail, username) {
    const pairs = [
      ['backendConnectionDot', 'backendConnectionLabel'],
      ['settingsBackendConnectionDot', 'settingsBackendConnectionLabel']
    ];
    for (const [dotId, labelId] of pairs) {
      const dot = document.getElementById(dotId);
      const label = document.getElementById(labelId);
      if (!dot || !label) continue;
      dot.className = 'backend-connection-dot is-' + state;
      if (state === 'ok' && username) {
        label.innerHTML =
          'Signed in · <strong class="backend-connection-user">' +
          escapeHtml(username) +
          '</strong>';
      } else {
        label.textContent =
          detail ||
          (state === 'ok' ? 'Connected' : state === 'checking' ? 'Checking…' : 'Not connected');
      }
    }
  }

  function updateBackendDependentUi(connected) {
    backendConnected = connected;

    const registerBtn = document.getElementById('registerJobBtn');
    const profileSelect = document.getElementById('regProfileId');
    const offlineBanner = document.getElementById('registerOfflineBanner');
    const registerTabBtn = document.getElementById('registerTabBtn');
    const signedInAs = document.getElementById('backendSignedInAs');
    const signedInUser = document.getElementById('backendSignedInUser');

    if (registerBtn) registerBtn.disabled = !connected;
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
    const el = document.getElementById('registerDriveStatus');
    if (!el) return;

    if (!backendConnected) {
      el.hidden = true;
      return;
    }

    const status = (await fetchWebsiteDriveStatus()) || websiteDriveStatus;
    el.hidden = false;

    if (!status) {
      el.textContent = 'Drive status unavailable';
      el.className = 'register-drive-status is-off';
      return;
    }

    if (status.connected) {
      el.textContent = status.googleEmail
        ? `Drive ready · ${status.googleEmail}`
        : 'Drive ready';
      el.className = 'register-drive-status is-ready';
      return;
    }

    if (status.serviceAccountConfigured) {
      el.textContent = 'Uploads use server Drive (connect personal Drive in website Settings)';
      el.className = 'register-drive-status is-off';
      return;
    }

    el.textContent = 'Connect Google Drive on the website Settings page to upload files';
    el.className = 'register-drive-status is-off';
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
    });
  }

  async function loadProfilesIntoSelect() {
    const select = document.getElementById('regProfileId');
    if (!select) return;

    const config = await getBackendConfig();
    if (!isAuthenticated(config)) {
      select.innerHTML = '<option value="">Sign in to load profiles</option>';
      select.disabled = true;
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
        return;
      }

      select.innerHTML =
        '<option value="">Select candidate…</option>' +
        profiles
          .map(
            (p) =>
              `<option value="${p.id}">${escapeHtml(p.full_name || 'Profile ' + p.id)}</option>`
          )
          .join('');
      select.disabled = !backendConnected;
      restoreProfileSelection(select, profiles, preservedId);
    } catch (err) {
      if (loadSeq !== profilesLoadSeq) return;
      const msg = err.message || 'Failed to load profiles';
      select.innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
      if (/fetch|network|failed/i.test(msg)) {
        select.innerHTML = '<option value="">Not connected — sign in under Settings</option>';
      }
    }
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
  }

  function clearAllRegisterFiles() {
    const { resume, cover } = getRegisterFileInputs();
    if (resume) resume.value = '';
    if (cover) cover.value = '';
    updateRegisterComboDropUi();
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
    updateRegisterComboDropUi();

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

  async function getOfflineQueue() {
    return new Promise((resolve) => {
      chrome.storage.local.get([OFFLINE_QUEUE_KEY], (result) => {
        const queue = Array.isArray(result[OFFLINE_QUEUE_KEY]) ? result[OFFLINE_QUEUE_KEY] : [];
        resolve(queue);
      });
    });
  }

  async function saveOfflineQueue(queue) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: queue }, resolve);
    });
  }

  function newQueueId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  async function renderOfflineQueue() {
    const listEl = document.getElementById('registerQueueList');
    const countEl = document.getElementById('registerQueueCount');
    const queue = await getOfflineQueue();

    if (countEl) {
      const n = queue.length;
      countEl.textContent = n === 1 ? '1 saved' : `${n} saved`;
    }

    if (!listEl) return;

    if (!queue.length) {
      listEl.hidden = true;
      listEl.innerHTML = '';
      return;
    }

    listEl.hidden = false;
    listEl.innerHTML = queue
      .slice()
      .reverse()
      .map((entry) => {
        const title = escapeHtml(entry.jobTitle || 'Untitled');
        const company = escapeHtml(entry.companyName || '');
        const when = entry.queuedAt ? new Date(entry.queuedAt).toLocaleString() : '';
        return `
          <article class="register-queue-item" data-queue-id="${escapeHtml(entry.id)}">
            <div>
              <div class="register-queue-title">${title}</div>
              <div class="register-queue-company">${company}</div>
              <div class="register-queue-meta muted small">${escapeHtml(when)}</div>
            </div>
            <button type="button" class="btn small danger register-queue-remove">Remove</button>
          </article>
        `;
      })
      .join('');

    listEl.querySelectorAll('.register-queue-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.register-queue-item')?.dataset.queueId;
        if (!id) return;
        const next = (await getOfflineQueue()).filter((item) => item.id !== id);
        await saveOfflineQueue(next);
        await renderOfflineQueue();
      });
    });
  }

  async function saveCurrentJobToQueue(showStatus) {
    const fields = readRegisterFormFields();
    if (!fields.jobTitle || !fields.companyName || !fields.jobLink) {
      throw new Error('Job title, company, and job link are required.');
    }

    const entry = {
      id: newQueueId(),
      queuedAt: new Date().toISOString(),
      ...fields
    };

    const queue = await getOfflineQueue();
    queue.push(entry);
    await saveOfflineQueue(queue);
    await renderOfflineQueue();
    setRegisterStatus(`Queued (${queue.length}).`, 'success');
    if (showStatus) showStatus('Saved to queue.', 'success');
  }

  function exportOfflineQueueJson(showStatus) {
    void getOfflineQueue().then((entries) => {
      const payload = {
        version: QUEUE_VERSION,
        exportedAt: new Date().toISOString(),
        entries
      };
      const d = new Date();
      const filename = `resume_db_queue_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename, saveAs: true }, () => {
        URL.revokeObjectURL(url);
        if (showStatus) showStatus('Queue JSON download started.', 'success');
      });
    });
  }

  async function clearOfflineQueue(showStatus) {
    await saveOfflineQueue([]);
    await renderOfflineQueue();
    setRegisterStatus('Offline queue cleared.', 'info');
    if (showStatus) showStatus('Offline queue cleared.', 'success');
  }

  async function registerJobToBackend() {
    const fields = readRegisterFormFields();
    const { jobTitle, companyName, jobLink, note, profileId } = fields;
    const resumeFile = readFileInput(document.getElementById('regResumeFile'));
    const coverFile = readFileInput(document.getElementById('regCoverFile'));

    if (!jobTitle || !companyName || !jobLink) {
      throw new Error('Job title, company, and job link are required. Use Refresh in the header first.');
    }
    if (!profileId) {
      throw new Error('Select a candidate profile.');
    }

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
    return data;
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

  function wireOfflineQueueControls(showStatus) {
    const saveBtn = document.getElementById('saveToQueueBtn');
    const exportBtn = document.getElementById('exportQueueBtn');
    const clearBtn = document.getElementById('clearQueueBtn');

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await saveCurrentJobToQueue(showStatus);
        } catch (err) {
          const msg = err.message || String(err);
          setRegisterStatus(msg, 'error');
          if (showStatus) showStatus(msg, 'error');
        }
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => exportOfflineQueueJson(showStatus));
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        const queue = await getOfflineQueue();
        if (!queue.length) {
          setRegisterStatus('Queue is already empty.', 'info');
          return;
        }
        if (!global.confirm(`Clear ${queue.length} queued job(s)?`)) return;
        await clearOfflineQueue(showStatus);
      });
    }
  }

  function startConnectionPolling() {
    if (connectionPollTimer) clearInterval(connectionPollTimer);
    checkBackendConnection();
    loadProfilesIntoSelect();
    renderOfflineQueue();
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

  function initRegisterResumeDb(showStatus) {
    const copyJdBtn = document.getElementById('regCopyJdBtn');
    const registerBtn = document.getElementById('registerJobBtn');

    loadBackendSettingsForm();
    wireBackendSettingsForm(showStatus);
    wireOfflineQueueControls(showStatus);
    wireRegisterFileDrops();
    wireProfileSelectPersistence();
    wireDuplicateWindowSetting();
    startConnectionPolling();

    document.querySelectorAll('.tab-main[data-tab="register"]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        checkBackendConnection();
        loadProfilesIntoSelect();
        renderOfflineQueue();
        updateRegisterDriveBadge();
      });
    });

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
        loadBackendSettingsForm();
        loadDuplicateWindowSetting();
        checkBackendConnection();
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

          const fields = readRegisterFormFields();
          if (!fields.jobTitle || !fields.companyName || !fields.jobLink) {
            throw new Error('Job title, company, and job link are required. Use Refresh in the header first.');
          }
          if (!fields.profileId) {
            throw new Error('Select a candidate profile.');
          }

          const resumeFile = document.getElementById('regResumeFile')?.files?.[0];
          const coverFile = document.getElementById('regCoverFile')?.files?.[0];
          const needsFileUpload = registerNeedsFileUpload(false, false, resumeFile, coverFile);

          setRegisterStatus(
            needsFileUpload
              ? 'Uploading files & saving to Resume DB…'
              : 'Saving to Resume DB…',
            'info'
          );
          const result = await registerJobToBackend();
          const fileNote =
            result.resumeUrl || result.coverLetterUrl ? ' Files saved.' : '';
          setRegisterStatus(
            `Registered (#${result.id}, ${result.candidateName || 'candidate'}).${fileNote}`,
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

    wireRegisterFieldCopy('regJobTitleCopyBtn', 'regJobTitle', 'Job title copied to clipboard.', 'Could not copy job title.', showStatus);
    wireRegisterFieldCopy('regCompanyCopyBtn', 'regCompany', 'Company copied to clipboard.', 'Could not copy company name.', showStatus);
    wireRegisterFieldCopy('regJobLinkCopyBtn', 'regJobLink', 'Job link copied to clipboard.', 'Could not copy job link.', showStatus);
    wireRegisterFieldDup('regCompanyDupBtn', 'company', showStatus);
    wireRegisterFieldDup('regJobLinkDupBtn', 'link', showStatus);

    if (copyJdBtn) {
      copyJdBtn.addEventListener('click', () => {
        setRegisterStatus('Reading job description…', 'info');
        copyJobDescriptionFromTab(showStatus).catch((err) => {
          const msg = err.message || String(err);
          const friendly = /receiving end does not exist/i.test(msg)
            ? 'Cannot read this tab. Open a job posting page and reload it, then try Copy JD again.'
            : msg;
          setRegisterStatus(friendly, 'error');
          if (showStatus) showStatus(friendly, 'error');
        });
      });
    }
  }

  global.SmartJobRegisterResumeDb = {
    initRegisterResumeDb,
    getBackendConfig,
    saveBackendConfig,
    checkBackendConnection,
    loadBackendSettingsForm,
    BACKEND_URL_KEY,
    EXTENSION_API_KEY_KEY,
    DEFAULT_BACKEND
  };
})(typeof window !== 'undefined' ? window : self);
