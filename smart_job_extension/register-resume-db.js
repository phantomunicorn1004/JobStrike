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

  function setRegisterBusy(busy) {
    const btn = document.getElementById('registerJobBtn');
    if (btn) {
      btn.disabled = busy;
      btn.textContent = busy ? 'Registering…' : 'Register';
    }
  }

  function setConnectionStatus(state, detail) {
    const dot = document.getElementById('backendConnectionDot');
    const label = document.getElementById('backendConnectionLabel');
    if (!dot || !label) return;
    dot.className = 'backend-connection-dot is-' + state;
    label.textContent = detail || (state === 'ok' ? 'Connected to backend' : 'Not connected');
  }

  async function checkBackendConnection() {
    const { baseUrl, apiKey } = await getBackendConfig();
    try {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: apiHeaders(apiKey),
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setConnectionStatus('ok', 'Connected');
        return true;
      }
      throw new Error('Invalid response');
    } catch (_) {
      setConnectionStatus('error', 'Not connected');
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
        select.innerHTML = '<option value="">No profiles on backend</option>';
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
      select.innerHTML = `<option value="">${escapeHtml(err.message || 'Failed to load')}</option>`;
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readFileInput(input) {
    const file = input?.files?.[0];
    return file || null;
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
    if (!resumeFile) {
      throw new Error('Select a resume file (PDF or DOCX).');
    }

    const { baseUrl, apiKey } = await getBackendConfig();
    const formData = new FormData();
    formData.append('jobTitle', jobTitle);
    formData.append('companyName', companyName);
    formData.append('jobLink', jobLink);
    formData.append('profileId', profileId);
    formData.append('apply', 'Registered');
    formData.append('resume', resumeFile, resumeFile.name);
    if (coverFile) {
      formData.append('coverLetter', coverFile, coverFile.name);
    }

    const res = await fetch(`${baseUrl}/api/resume-db/register`, {
      method: 'POST',
      headers: apiHeaders(apiKey),
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Registration failed (${res.status})`);
    }
    return data;
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

    startConnectionPolling();

    document.querySelectorAll('.tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        if (tabBtn.dataset.tab === 'register') {
          checkBackendConnection();
          loadProfilesIntoSelect();
        }
      });
    });

    if (scrapeBtn) {
      scrapeBtn.addEventListener('click', async () => {
        setRegisterStatus('Reading job page…', 'info');
        try {
          const job = await scrapeJobFromTab();
          document.getElementById('regJobTitle').value = job.jobTitle;
          document.getElementById('regCompany').value = job.companyName;
          document.getElementById('regJobLink').value = job.jobLink;
          setRegisterStatus('Job info loaded from current tab.', 'success');
          if (showStatus) showStatus('Job info scraped.', 'success');
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
        setRegisterStatus('Uploading files and saving to Resume DB…', 'info');
        try {
          const connected = await checkBackendConnection();
          if (!connected) {
            throw new Error('Backend is not reachable. Start the website or check deployment.');
          }
          const result = await registerJobToBackend();
          setRegisterStatus(
            `Registered (#${result.id}, ${result.candidateName || 'candidate'}).`,
            'success'
          );
          if (showStatus) showStatus('Job registered in Resume DB.', 'success');
          document.getElementById('regResumeFile').value = '';
          const coverInput = document.getElementById('regCoverFile');
          if (coverInput) coverInput.value = '';
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
    DEFAULT_BACKEND
  };
})(typeof window !== 'undefined' ? window : self);
