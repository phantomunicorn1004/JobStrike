// Background service worker for Smart Job Autofill Assistant.
// Opens the movable Job Assistant dialog on the active tab (popup fallback if needed).

const STORAGE_KEYS = {
  jobs: 'scraped_jobs',
  userName: 'job_scraper_user_name',
  dailyDate: 'job_scraper_daily_date',
  dailyCount: 'job_scraper_daily_count',
  dailyLimit: 'job_scraper_daily_limit'
};

const DEFAULT_DAILY_LIMIT = 10;

function configureSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.warn('setPanelBehavior failed:', error));
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Smart Job Autofill Assistant installed');
  configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(configureSidePanelBehavior);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'openSidePanel') {
    const tabId = request.tabId || (sender.tab && sender.tab.id);
    if (chrome.sidePanel && chrome.sidePanel.open && tabId) {
      chrome.sidePanel.open({ tabId }).then(() => sendResponse({ success: true })).catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
    sendResponse({ success: false, error: 'Chrome sidePanel API is unavailable.' });
    return true;
  }
  if (request && request.action === 'openAssistantDialog') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
        sendResponse({
          success: false,
          error: 'Open a regular web page (http/https) before opening Job Assistant.'
        });
        return;
      }
      try {
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ['assistant-overlay.js']
          })
          .catch(() => null);

        const response = await ensureContentScriptAndSendMessage(tab.id, {
          action: 'showAssistantDialog'
        });
        if (response?.success) {
          sendResponse(response);
          return;
        }
        throw new Error(response?.error || 'Could not open Job Assistant overlay.');
      } catch (error) {
        try {
          await chrome.windows.create({
            url: chrome.runtime.getURL('sidepanel.html?dialog=1'),
            type: 'popup',
            width: 400,
            height: 600,
            focused: true
          });
          sendResponse({ success: true, fallback: 'popup' });
        } catch (popupError) {
          sendResponse({
            success: false,
            error: error?.message || popupError?.message || String(error)
          });
        }
      }
    });
    return true;
  }
  if (request && request.action === 'startElementTextPicker') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
        sendResponse({ success: false, error: 'Open a regular web page before starting the text picker.' });
        return;
      }
      try {
        const response = await ensureContentScriptAndSendMessage(tab.id, {
          action: 'startElementTextPicker'
        });
        sendResponse(response?.success ? response : {
          success: false,
          error: response?.error || 'Could not start the text picker.'
        });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    });
    return true;
  }
  return false;
});

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addJobFromScrape(tabUrl, companyName, jobTitle, userName) {
  const job = {
    name: userName || '',
    title: (jobTitle || '').trim(),
    company_name: (companyName || '').trim(),
    job_link: (tabUrl || '').trim(),
    note: ''
  };

  if (!job.title || !job.company_name) {
    return Promise.resolve({ success: false, error: 'Could not scrape job title or company.' });
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([
      STORAGE_KEYS.jobs,
      STORAGE_KEYS.dailyDate,
      STORAGE_KEYS.dailyCount,
      STORAGE_KEYS.dailyLimit
    ], (result) => {
      const today = getTodayKey();
      let dailyCount = result[STORAGE_KEYS.dailyCount] || 0;
      const limit = Math.max(1, parseInt(result[STORAGE_KEYS.dailyLimit], 10) || DEFAULT_DAILY_LIMIT);
      if ((result[STORAGE_KEYS.dailyDate] || '') !== today) dailyCount = 0;

      let jobs = Array.isArray(result[STORAGE_KEYS.jobs]) ? result[STORAGE_KEYS.jobs] : [];
      const existingIndex = job.job_link ? jobs.findIndex((item) => (item.job_link || item.job_url) === job.job_link) : -1;

      if (existingIndex >= 0) {
        jobs[existingIndex] = job;
        chrome.storage.local.set({ [STORAGE_KEYS.jobs]: jobs }, () => resolve({ success: true, updated: true }));
        return;
      }

      if (dailyCount >= limit) {
        resolve({ success: false, error: `Daily limit of ${limit} reached.` });
        return;
      }

      jobs.push(job);
      dailyCount += 1;
      chrome.storage.local.set({
        [STORAGE_KEYS.jobs]: jobs,
        [STORAGE_KEYS.dailyDate]: today,
        [STORAGE_KEYS.dailyCount]: dailyCount
      }, () => resolve({ success: true, updated: false }));
    });
  });
}

function ensureContentScriptAndSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (pingResponse) => {
      if (!chrome.runtime.lastError && pingResponse && pingResponse.ready) {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: ['field-registry.js', 'content.js', 'assistant-overlay.js']
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(response);
            });
          }, 100);
        }
      );
    });
  });
}

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id || !tab.url || !/^https?:\/\//.test(tab.url)) return;

    if (command === 'start-element-text-picker') {
      try {
        await ensureContentScriptAndSendMessage(tab.id, { action: 'startElementTextPicker' });
      } catch (error) {
        chrome.action.setBadgeText({ text: '!', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId: tab.id });
        setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2500);
      }
      return;
    }

    if (command !== 'refresh-current-tab') return;

    try {
      const response = await ensureContentScriptAndSendMessage(tab.id, { action: 'getJobFields' });
      if (!response || !response.success) throw new Error('Could not read job data from this tab.');

      chrome.storage.local.get([STORAGE_KEYS.userName], async (stored) => {
        const userName = (stored[STORAGE_KEYS.userName] || '').trim();
        const out = await addJobFromScrape(response.job_link || tab.url, response.company_name, response.job_title, userName);
        chrome.action.setBadgeText({ text: out.success ? '✓' : '!', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: out.success ? '#16a34a' : '#dc2626', tabId: tab.id });
        setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2500);
      });
    } catch (error) {
      chrome.action.setBadgeText({ text: '!', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId: tab.id });
      setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2500);
    }
  });
});
