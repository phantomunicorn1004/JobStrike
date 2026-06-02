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

  async function sendToActiveTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
      jobLink: response.job_link || tab.url || ''
    };
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
      btn.textContent = busy ? 'Registering…' : 'Register to DB';
    }
  }

  function setAlreadyBusy(busy) {
    const btn = document.getElementById('regAlreadyBtn');
    if (btn) {
      btn.disabled = busy || !backendConnected;
      btn.textContent = busy ? 'Checking…' : 'Already?';
    }
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

  function applicationSameCompanyAndTitle(app, job) {
    return (
      applicationSameCompany(app, job) &&
      matchKeysEqual(app.jobTitle, job.jobTitle) &&
      hasMatchKey(job.jobTitle)
    );
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

  async function checkResumeDbDuplicates(showStatus) {
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
    if (!fields.jobTitle || !fields.companyName) {
      throw new Error('Job title and company are required to check for duplicates.');
    }

    setRegisterStatus('Checking Resume DB…', 'info');
    const applications = await fetchResumeDbApplications();
    const forCandidate = applications.filter(
      (app) => String(app.profileId) === String(profileId)
    );

    const duplicateMatch = forCandidate.find((app) =>
      applicationSameCompanyAndTitle(app, fields)
    );
    if (duplicateMatch) {
      const { when, detail } = formatApplicationSummary(duplicateMatch, fields);
      const message = `Duplicate — ${detail} is already in Resume DB${
        when ? ` (${when})` : ''
      }.`;
      setRegisterStatus(message, 'error');
      if (showStatus) showStatus('Duplicate application for this candidate.', 'error');
      return { level: 'duplicate', match: duplicateMatch };
    }

    const sameCompanyMatch = forCandidate.find((app) =>
      applicationSameCompany(app, fields)
    );
    if (sameCompanyMatch) {
      const { when, detail } = formatApplicationSummary(sameCompanyMatch, fields);
      const company = fields.companyName || sameCompanyMatch.company || 'this company';
      setRegisterStatus(
        `Same company — ${company} already has an application${
          when ? ` (${when}: ${detail})` : detail ? ` (${detail})` : ''
        }.`,
        'warn'
      );
      if (showStatus) showStatus('Same company already in Resume DB for this candidate.', 'info');
      return { level: 'same_company', match: sameCompanyMatch };
    }

    setRegisterStatus('Not registered yet for this candidate.', 'success');
    if (showStatus) showStatus('No matching application found in Resume DB.', 'success');
    return { level: 'none', match: null };
  }

  async function runAlreadyCheck(showStatus) {
    setAlreadyBusy(true);
    try {
      return await checkResumeDbDuplicates(showStatus);
    } finally {
      setAlreadyBusy(false);
    }
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
    const alreadyBtn = document.getElementById('regAlreadyBtn');
    const profileSelect = document.getElementById('regProfileId');
    const offlineBanner = document.getElementById('registerOfflineBanner');
    const registerTabBtn = document.getElementById('registerTabBtn');
    const signedInAs = document.getElementById('backendSignedInAs');
    const signedInUser = document.getElementById('backendSignedInUser');

    if (registerBtn) registerBtn.disabled = !connected;
    if (alreadyBtn) alreadyBtn.disabled = !connected;
    if (profileSelect) profileSelect.disabled = !connected;
    if (offlineBanner) offlineBanner.hidden = connected;
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
      setConnectionStatus('error', 'Not signed in — Settings → Website connection');
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

  function updateRegisterDropUi(config) {
    const { drop, input, nameEl, clearBtn, defaultCheckbox } = config;
    const file = input?.files?.[0] || null;
    if (!drop) return;

    drop.classList.toggle('has-file', Boolean(file));
    drop.classList.toggle('is-default-file', Boolean(file && defaultCheckbox?.checked));

    if (nameEl) {
      if (file) {
        nameEl.textContent = file.name;
        nameEl.hidden = false;
      } else {
        nameEl.textContent = '';
        nameEl.hidden = true;
      }
    }

    if (clearBtn) clearBtn.hidden = !file;

    const cta = drop.querySelector('.file-drop-cta');
    const formats = drop.querySelector('.file-drop > .muted.small');
    const icon = drop.querySelector('.file-drop-icon');
    if (cta) cta.hidden = Boolean(file);
    if (formats) formats.hidden = Boolean(file);
    if (icon) icon.hidden = Boolean(file);
  }

  function clearRegisterFileDrop(config) {
    const { input, defaultCheckbox } = config;
    if (input) input.value = '';
    if (defaultCheckbox) defaultCheckbox.checked = false;
    updateRegisterDropUi(config);
  }

  function assignFileToInput(input, file) {
    if (!input || !file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }

  function wireRegisterFileDrop(config) {
    const { drop, input, nameEl, clearBtn, defaultCheckbox, allowedExts, label } = config;
    if (!drop || !input) return;

    const applyFile = (file) => {
      if (!file) {
        clearRegisterFileDrop(config);
        return;
      }
      if (!isAllowedFile(file, allowedExts)) {
        setRegisterStatus(
          `Invalid ${label} type. Allowed: ${allowedExts.join(', ')}`,
          'error'
        );
        clearRegisterFileDrop(config);
        return;
      }
      assignFileToInput(input, file);
      updateRegisterDropUi(config);
    };

    drop.addEventListener('click', (e) => {
      if (e.target.closest('[data-clear-file]')) return;
      input.click();
    });

    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    input.addEventListener('change', () => applyFile(input.files?.[0] || null));

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearRegisterFileDrop(config);
      });
    }

    if (defaultCheckbox) {
      defaultCheckbox.addEventListener('change', () => updateRegisterDropUi(config));
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
      applyFile(e.dataTransfer?.files?.[0] || null);
    });

    updateRegisterDropUi(config);
  }

  function wireRegisterFileDrops() {
    wireRegisterFileDrop({
      drop: document.getElementById('regResumeDrop'),
      input: document.getElementById('regResumeFile'),
      nameEl: document.getElementById('regResumeFileName'),
      clearBtn: document.getElementById('regResumeClear'),
      defaultCheckbox: document.getElementById('regResumeDefault'),
      allowedExts: RESUME_ACCEPT,
      label: 'resume'
    });
    wireRegisterFileDrop({
      drop: document.getElementById('regCoverDrop'),
      input: document.getElementById('regCoverFile'),
      nameEl: document.getElementById('regCoverFileName'),
      clearBtn: document.getElementById('regCoverClear'),
      defaultCheckbox: document.getElementById('regCoverDefault'),
      allowedExts: COVER_ACCEPT,
      label: 'cover letter'
    });
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
      profileId,
      profileName: profileOption?.textContent?.trim() || '',
      resumeIsDefault: Boolean(document.getElementById('regResumeDefault')?.checked),
      coverLetterIsDefault: Boolean(document.getElementById('regCoverDefault')?.checked),
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
    const { jobTitle, companyName, jobLink, profileId } = fields;
    const resumeFile = readFileInput(document.getElementById('regResumeFile'));
    const coverFile = readFileInput(document.getElementById('regCoverFile'));

    if (!jobTitle || !companyName || !jobLink) {
      throw new Error('Job title, company, and job link are required. Click Scrape first.');
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

  function initRegisterResumeDb(showStatus) {
    const scrapeBtn = document.getElementById('regScrapeBtn');
    const alreadyBtn = document.getElementById('regAlreadyBtn');
    const registerBtn = document.getElementById('registerJobBtn');

    loadBackendSettingsForm();
    wireBackendSettingsForm(showStatus);
    wireOfflineQueueControls(showStatus);
    wireRegisterFileDrops();
    wireProfileSelectPersistence();
    startConnectionPolling();

    document.querySelectorAll('.tab-main[data-tab="register"]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        checkBackendConnection();
        loadProfilesIntoSelect();
        renderOfflineQueue();
        updateRegisterDriveBadge();
      });
    });

    const headerSettings = document.getElementById('headerSettingsBtn');
    if (headerSettings) {
      headerSettings.addEventListener('click', () => {
        loadBackendSettingsForm();
        checkBackendConnection();
      });
    }

    if (alreadyBtn) {
      alreadyBtn.addEventListener('click', async () => {
        try {
          await runAlreadyCheck(showStatus);
        } catch (err) {
          const msg = err.message || String(err);
          setRegisterStatus(msg, 'error');
          if (showStatus) showStatus(msg, 'error');
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

          const fields = readRegisterFormFields();
          if (!fields.jobTitle || !fields.companyName || !fields.jobLink) {
            throw new Error('Job title, company, and job link are required. Click Scrape first.');
          }
          if (!fields.profileId) {
            throw new Error('Select a candidate profile.');
          }

          const resumeDefault = document.getElementById('regResumeDefault')?.checked;
          const coverDefault = document.getElementById('regCoverDefault')?.checked;
          const resumeFile = document.getElementById('regResumeFile')?.files?.[0];
          const coverFile = document.getElementById('regCoverFile')?.files?.[0];
          const needsFileUpload = registerNeedsFileUpload(
            resumeDefault,
            coverDefault,
            resumeFile,
            coverFile
          );

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
          clearRegisterFileDrop({
            drop: document.getElementById('regResumeDrop'),
            input: document.getElementById('regResumeFile'),
            nameEl: document.getElementById('regResumeFileName'),
            clearBtn: document.getElementById('regResumeClear'),
            defaultCheckbox: document.getElementById('regResumeDefault')
          });
          clearRegisterFileDrop({
            drop: document.getElementById('regCoverDrop'),
            input: document.getElementById('regCoverFile'),
            nameEl: document.getElementById('regCoverFileName'),
            clearBtn: document.getElementById('regCoverClear'),
            defaultCheckbox: document.getElementById('regCoverDefault')
          });
        } catch (err) {
          const msg = err.message || String(err);
          setRegisterStatus(msg, 'error');
          if (showStatus) showStatus(msg, 'error');
        } finally {
          setRegisterBusy(false);
        }
      });
    }

    if (scrapeBtn) {
      scrapeBtn.addEventListener('click', () => {
        setRegisterStatus('Reading job page…', 'info');
        scrapeJobFromTab()
          .then((job) => {
            document.getElementById('regJobTitle').value = job.jobTitle;
            document.getElementById('regCompany').value = job.companyName;
            document.getElementById('regJobLink').value = job.jobLink;
            setRegisterStatus('Job info loaded from current tab.', 'success');
            if (showStatus) showStatus('Job info scraped.', 'success');
          })
          .catch((err) => {
            const msg = err.message || String(err);
            const friendly = /receiving end does not exist/i.test(msg)
              ? 'Cannot read this tab. Open a job posting page and reload it, then try Scrape again.'
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
