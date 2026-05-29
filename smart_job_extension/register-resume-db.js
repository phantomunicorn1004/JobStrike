/**
 * Resume DB registration tab — communicates with remote-work-helper backend only.
 */
(function (global) {
  const BACKEND_URL_KEY = 'resume_db_backend_url';
  const API_KEY_KEY = 'resume_db_api_key';
  const DEFAULT_BACKEND = 'https://remote-work-helper.vercel.app';

  let connectionPollTimer = null;

  function normalizeBackendUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_BACKEND;
  }

  async function getBackendConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([BACKEND_URL_KEY, API_KEY_KEY], (result) => {
        resolve({
          baseUrl: normalizeBackendUrl(result[BACKEND_URL_KEY]),
          apiKey: String(result[API_KEY_KEY] || '').trim()
        });
      });
    });
  }

  async function saveBackendConfig(baseUrl, apiKey) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [BACKEND_URL_KEY]: normalizeBackendUrl(baseUrl),
          [API_KEY_KEY]: String(apiKey || '').trim()
        },
        resolve
      );
    });
  }

  function apiHeaders(apiKey) {
    const headers = {};
    if (apiKey) headers['X-Extension-Key'] = apiKey;
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
      btn.disabled = busy;
      btn.textContent = busy ? 'Registering…' : 'Register';
    }
  }

  function setConnectionStatus(state, detail) {
    const pairs = [
      ['backendConnectionDot', 'backendConnectionLabel'],
      ['settingsBackendConnectionDot', 'settingsBackendConnectionLabel']
    ];
    for (const [dotId, labelId] of pairs) {
      const dot = document.getElementById(dotId);
      const label = document.getElementById(labelId);
      if (!dot || !label) continue;
      dot.className = 'backend-connection-dot is-' + state;
      label.textContent =
        detail ||
        (state === 'ok' ? 'Connected' : state === 'checking' ? 'Checking…' : 'Not connected');
    }
  }

  async function loadBackendSettingsForm() {
    const { baseUrl, apiKey } = await getBackendConfig();
    const urlInput = document.getElementById('backendUrlSetting');
    const keyInput = document.getElementById('backendApiKeySetting');
    if (urlInput) urlInput.value = baseUrl;
    if (keyInput) keyInput.value = apiKey;
  }

  async function checkBackendConnection() {
    setConnectionStatus('checking', 'Checking…');
    const { baseUrl, apiKey } = await getBackendConfig();
    try {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: apiHeaders(apiKey),
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const host = baseUrl.replace(/^https?:\/\//, '');
        setConnectionStatus('ok', 'Connected · ' + host);
        if (global.SmartJobGoogleDrive) {
          global.SmartJobGoogleDrive.updateRegisterDriveBadge();
        }
        return true;
      }
      throw new Error('Invalid response');
    } catch (err) {
      const short = baseUrl.replace(/^https?:\/\//, '');
      setConnectionStatus('error', 'Not connected · ' + short);
      return false;
    }
  }

  async function loadProfilesIntoSelect() {
    const select = document.getElementById('regProfileId');
    if (!select) return;

    const { baseUrl, apiKey } = await getBackendConfig();
    select.innerHTML = '<option value="">Loading profiles…</option>';
    select.disabled = true;

    try {
      const res = await fetch(`${baseUrl}/api/profiles`, {
        headers: apiHeaders(apiKey),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
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
      select.disabled = false;
    } catch (err) {
      const msg = err.message || 'Failed to load profiles';
      select.innerHTML = `<option value="">${escapeHtml(msg)}</option>`;
      if (/fetch|network|failed/i.test(msg)) {
        select.innerHTML =
          '<option value="">Not connected — set URL in Settings tab</option>';
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

  async function registerJobToBackend() {
    const jobTitle = document.getElementById('regJobTitle')?.value?.trim();
    const companyName = document.getElementById('regCompany')?.value?.trim();
    const jobLink = document.getElementById('regJobLink')?.value?.trim();
    const profileId = document.getElementById('regProfileId')?.value?.trim();
    const resumeFile = readFileInput(document.getElementById('regResumeFile'));
    const coverFile = readFileInput(document.getElementById('regCoverFile'));

    if (!jobTitle || !companyName || !jobLink) {
      throw new Error('Job title, company, and job link are required. Click Scrape first.');
    }
    if (!profileId) {
      throw new Error('Select a candidate profile.');
    }

    const resumeIsDefault = document.getElementById('regResumeDefault')?.checked;
    const coverIsDefault = document.getElementById('regCoverDefault')?.checked;

    if (!resumeIsDefault && !resumeFile) {
      throw new Error('Select a resume file, or check Default and set a link in Settings → Google Drive.');
    }

    const { baseUrl, apiKey } = await getBackendConfig();

    if (!global.SmartJobGoogleDrive) {
      throw new Error('Google Drive module failed to load. Reload the extension.');
    }

    const drive = await global.SmartJobGoogleDrive.resolveUrlsForRegister({
      resumeFile,
      coverFile,
      resumeIsDefault,
      coverIsDefault,
    });

    const formData = new FormData();
    formData.append('jobTitle', jobTitle);
    formData.append('companyName', companyName);
    formData.append('jobLink', jobLink);
    formData.append('profileId', profileId);
    formData.append('apply', 'Registered');
    formData.append('resumeUrl', drive.resumeUrl);
    if (drive.coverLetterUrl) {
      formData.append('coverLetterUrl', drive.coverLetterUrl);
    }
    formData.append('resumeIsDefault', resumeIsDefault ? '1' : '0');
    formData.append('coverLetterIsDefault', coverIsDefault ? '1' : '0');

    const res = await fetch(`${baseUrl}/api/resume-db/register`, {
      method: 'POST',
      headers: apiHeaders(apiKey),
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Registration failed (${res.status})`);
    }
    return { ...data, drive };
  }

  function wireBackendSettingsForm(showStatus) {
    const form = document.getElementById('backendSettingsForm');
    const testBtn = document.getElementById('testBackendConnectionBtn');

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const baseUrl = document.getElementById('backendUrlSetting')?.value;
        const apiKey = document.getElementById('backendApiKeySetting')?.value;
        await saveBackendConfig(baseUrl, apiKey);
        setSettingsHint('Connection settings saved.', 'success');
        if (showStatus) showStatus('Website connection saved.', 'success');
        await checkBackendConnection();
        await loadProfilesIntoSelect();
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const baseUrl = document.getElementById('backendUrlSetting')?.value;
        const apiKey = document.getElementById('backendApiKeySetting')?.value;
        await saveBackendConfig(baseUrl, apiKey);
        setSettingsHint('Testing connection…', '');
        const ok = await checkBackendConnection();
        if (ok) {
          setSettingsHint('Connection successful.', 'success');
          if (showStatus) showStatus('Backend connection OK.', 'success');
          await loadProfilesIntoSelect();
        } else {
          setSettingsHint(
            'Could not reach the backend. Check the URL, deploy status, and API key.',
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

  function initRegisterResumeDb(showStatus) {
    const scrapeBtn = document.getElementById('regScrapeBtn');
    const registerBtn = document.getElementById('registerJobBtn');

    loadBackendSettingsForm();
    wireBackendSettingsForm(showStatus);
    if (global.SmartJobGoogleDrive) {
      global.SmartJobGoogleDrive.wireGoogleDriveSettings(showStatus);
    }
    wireRegisterFileDrops();
    startConnectionPolling();

    document.querySelectorAll('.tab-main[data-tab="register"]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        checkBackendConnection();
        loadProfilesIntoSelect();
        if (global.SmartJobGoogleDrive) {
          global.SmartJobGoogleDrive.updateRegisterDriveBadge();
        }
      });
    });

    const headerSettings = document.getElementById('headerSettingsBtn');
    if (headerSettings) {
      headerSettings.addEventListener('click', () => {
        loadBackendSettingsForm();
        checkBackendConnection();
      });
    }

    if (scrapeBtn) {
      scrapeBtn.addEventListener('click', () => {
        const globalRefresh = document.getElementById('globalRefreshBtn');
        if (globalRefresh) {
          globalRefresh.click();
          return;
        }
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

    if (registerBtn) {
      registerBtn.addEventListener('click', async () => {
        setRegisterBusy(true);
        try {
          const connected = await checkBackendConnection();
          if (!connected) {
            throw new Error(
              'Backend not connected. Open the Settings tab → Website connection, set the URL, and click Test connection.'
            );
          }
          if (global.SmartJobGoogleDrive) {
            const driveCfg = await global.SmartJobGoogleDrive.getDriveSettings();
            if (!global.SmartJobGoogleDrive.isDriveConfigured(driveCfg)) {
              throw new Error(
                'Configure Google Drive in Settings (OAuth Client ID), then Connect Google Drive.'
              );
            }
            const resumeDefault = document.getElementById('regResumeDefault')?.checked;
            const needsUpload =
              !resumeDefault ||
              (document.getElementById('regCoverFile')?.files?.[0] &&
                !document.getElementById('regCoverDefault')?.checked);
            if (
              needsUpload &&
              !global.SmartJobGoogleDrive.isDriveConnected(driveCfg)
            ) {
              throw new Error(
                'Connect Google Drive in Settings before uploading tailored files.'
              );
            }
          }
          setRegisterStatus('Uploading to Google Drive & saving to Resume DB…', 'info');
          const result = await registerJobToBackend();
          setRegisterStatus(
            `Registered (#${result.id}, ${result.candidateName || 'candidate'}). Drive links saved.`,
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
  }

  global.SmartJobRegisterResumeDb = {
    initRegisterResumeDb,
    getBackendConfig,
    saveBackendConfig,
    checkBackendConnection,
    loadBackendSettingsForm,
    BACKEND_URL_KEY,
    API_KEY_KEY,
    DEFAULT_BACKEND
  };
})(typeof window !== 'undefined' ? window : self);
