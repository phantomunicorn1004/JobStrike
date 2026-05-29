const STORAGE_KEY = 'scraped_jobs';
const USER_NAME_KEY = 'job_scraper_user_name';
const DAILY_DATE_KEY = 'job_scraper_daily_date';
const DAILY_COUNT_KEY = 'job_scraper_daily_count';
const DAILY_LIMIT_KEY = 'job_scraper_daily_limit';
const DEFAULT_DAILY_LIMIT = 10;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('closeBtn').addEventListener('click', () => window.close());
  document.getElementById('openSidePanelBtn').addEventListener('click', openSidePanel);
  document.getElementById('quickScrapeBtn').addEventListener('click', quickScrapeCurrentJob);
  document.getElementById('downloadBtn').addEventListener('click', downloadJobsJson);
  document.getElementById('userName').addEventListener('change', saveUserName);
  document.getElementById('userName').addEventListener('blur', saveUserName);
  loadUserName();
  updateDailyStats();
});

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showStatus(message, type = 'info', timeout = 3500) {
  if (typeof showToast === 'function') {
    showToast(message, type, timeout);
    return;
  }
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = message;
  status.className = `toast toast-${type}`;
  status.classList.remove('hidden');
  if (timeout) setTimeout(() => status.classList.add('hidden'), timeout);
}

function loadUserName() {
  chrome.storage.local.get([USER_NAME_KEY], (result) => {
    document.getElementById('userName').value = result[USER_NAME_KEY] || '';
  });
}

function saveUserName() {
  const name = document.getElementById('userName').value.trim();
  chrome.storage.local.set({ [USER_NAME_KEY]: name });
}

function updateDailyStats() {
  const today = getTodayKey();
  chrome.storage.local.get([DAILY_DATE_KEY, DAILY_COUNT_KEY], (result) => {
    let count = result[DAILY_COUNT_KEY] || 0;
    if ((result[DAILY_DATE_KEY] || '') !== today) {
      count = 0;
      chrome.storage.local.set({ [DAILY_DATE_KEY]: today, [DAILY_COUNT_KEY]: 0 });
    }
    document.getElementById('applicationsCount').textContent = count;
  });
}

function getActiveTab() {
  return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null)));
}

async function openSidePanel() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    showStatus('No active tab found.', 'error');
    return;
  }
  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    showStatus('Side panel API is unavailable.', 'error');
    return;
  }
  chrome.sidePanel.open({ tabId: tab.id }).then(() => window.close()).catch((error) => showStatus(error.message, 'error'));
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (pingResponse) => {
      if (!chrome.runtime.lastError && pingResponse && pingResponse.ready) {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
        return;
      }
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          });
        }, 120);
      });
    });
  });
}

async function quickScrapeCurrentJob() {
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('Open a job page first.');
    const response = await sendToTab(tab.id, { action: 'getJobFields' });
    if (!response || !response.success) throw new Error(response?.error || 'Could not scrape job info.');
    const userName = document.getElementById('userName').value.trim();
    const job = {
      name: userName,
      title: response.job_title || '',
      company_name: response.company_name || '',
      job_link: response.job_link || tab.url || '',
      note: ''
    };
    if (!job.title || !job.company_name) throw new Error('Could not detect title or company. Open the side panel to edit manually.');
    saveJob(job);
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function saveJob(job) {
  chrome.storage.local.get([STORAGE_KEY, DAILY_DATE_KEY, DAILY_COUNT_KEY, DAILY_LIMIT_KEY], (result) => {
    let jobs = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const existingIndex = job.job_link ? jobs.findIndex((item) => (item.job_link || item.job_url) === job.job_link) : -1;
    const today = getTodayKey();
    let dailyCount = result[DAILY_COUNT_KEY] || 0;
    const limit = Math.max(1, parseInt(result[DAILY_LIMIT_KEY], 10) || DEFAULT_DAILY_LIMIT);
    if ((result[DAILY_DATE_KEY] || '') !== today) dailyCount = 0;

    if (existingIndex >= 0) {
      jobs[existingIndex] = job;
    } else {
      if (dailyCount >= limit) {
        showStatus(`Daily limit of ${limit} reached.`, 'error');
        return;
      }
      jobs.push(job);
      dailyCount += 1;
    }

    chrome.storage.local.set({
      [STORAGE_KEY]: jobs,
      [DAILY_DATE_KEY]: today,
      [DAILY_COUNT_KEY]: dailyCount,
      [USER_NAME_KEY]: job.name
    }, () => {
      updateDailyStats();
      showStatus(existingIndex >= 0 ? 'Job updated.' : 'Job saved.', 'success');
    });
  });
}

function toJobEntry(job) {
  return {
    name: job.name || job.user_name || '',
    title: job.title || job.job_title || '',
    company_name: job.company_name || job.company || '',
    job_link: job.job_link || job.job_url || '',
    note: job.note || ''
  };
}

function downloadJobsJson() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const jobs = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY].map(toJobEntry) : [];
    const d = new Date();
    const filename = `jobs_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true }, () => {
      URL.revokeObjectURL(url);
      showStatus('JSON download started.', 'success');
    });
  });
}
