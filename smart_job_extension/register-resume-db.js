/**
 * Resume DB registration tab — talks to remote-work-helper backend.
 */
(function (global) {
  const BACKEND_URL_KEY = 'resume_db_backend_url';
  const API_KEY_KEY = 'resume_db_api_key';
  const DEFAULT_BACKEND = 'http://localhost:3000';

  const RESUME_ACCEPT = '.pdf,.docx,.doc';
  const COVER_ACCEPT = '.pdf,.docx,.doc,.txt';

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

  function saveBackendConfig(baseUrl, apiKey) {
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

  function readFileInput(input) {
    const file = input?.files?.[0];
    if (!file) return null;
    return file;
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

  async function registerJobToBackend() {
    const jobTitle = document.getElementById('regJobTitle')?.value?.trim();
    const companyName = document.getElementById('regCompany')?.value?.trim();
    const jobLink = document.getElementById('regJobLink')?.value?.trim();
    const candidate = document.getElementById('regCandidate')?.value?.trim() || '';
    const email = document.getElementById('regEmail')?.value?.trim() || '';
    const resumeFile = readFileInput(document.getElementById('regResumeFile'));
    const coverFile = readFileInput(document.getElementById('regCoverFile'));

    if (!jobTitle || !companyName || !jobLink) {
      throw new Error('Job title, company, and job link are required. Click Scrape first.');
    }
    if (!resumeFile) {
      throw new Error('Select a resume file (PDF or DOCX).');
    }

    const { baseUrl, apiKey } = await getBackendConfig();
    const formData = new FormData();
    formData.append('jobTitle', jobTitle);
    formData.append('companyName', companyName);
    formData.append('jobLink', jobLink);
    formData.append('candidate', candidate);
    formData.append('email', email);
    formData.append('apply', 'Registered');
    formData.append('resume', resumeFile, resumeFile.name);
    if (coverFile) {
      formData.append('coverLetter', coverFile, coverFile.name);
    }

    const headers = {};
    if (apiKey) headers['X-Extension-Key'] = apiKey;

    const res = await fetch(`${baseUrl}/api/resume-db/register`, {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Registration failed (${res.status})`);
    }
    return data;
  }

  function initRegisterResumeDb(showStatus) {
    const scrapeBtn = document.getElementById('regScrapeBtn');
    const registerBtn = document.getElementById('registerJobBtn');
    const saveBackendBtn = document.getElementById('saveBackendBtn');

    getBackendConfig().then(({ baseUrl, apiKey }) => {
      const urlInput = document.getElementById('backendUrlSetting');
      const keyInput = document.getElementById('backendApiKeySetting');
      if (urlInput) urlInput.value = baseUrl;
      if (keyInput) keyInput.value = apiKey;
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

    if (saveBackendBtn) {
      saveBackendBtn.addEventListener('click', async () => {
        const baseUrl = document.getElementById('backendUrlSetting')?.value;
        const apiKey = document.getElementById('backendApiKeySetting')?.value;
        await saveBackendConfig(baseUrl, apiKey);
        setRegisterStatus('Backend URL saved.', 'success');
        if (showStatus) showStatus('Backend settings saved.', 'success');
      });
    }

    if (registerBtn) {
      registerBtn.addEventListener('click', async () => {
        setRegisterBusy(true);
        setRegisterStatus('Uploading to Google Drive and saving to sheet…', 'info');
        try {
          const result = await registerJobToBackend();
          setRegisterStatus(
            `Registered (row ${result.rowIndex}, id ${result.entryId}).`,
            'success'
          );
          if (showStatus) {
            showStatus('Job registered in Resume DB.', 'success');
          }
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
    saveBackendConfig,
    BACKEND_URL_KEY,
    API_KEY_KEY,
    DEFAULT_BACKEND
  };
})(typeof window !== 'undefined' ? window : self);
