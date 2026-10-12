// Background service worker for JobStrike.
// Opens the movable JobStrike dialog on the active tab (popup fallback if needed).

const STORAGE_KEYS = {
  jobs: 'scraped_jobs',
  userName: 'job_scraper_user_name',
  dailyDate: 'job_scraper_daily_date',
  dailyCount: 'job_scraper_daily_count',
  dailyLimit: 'job_scraper_daily_limit'
};

const ASSISTANT_DIALOG_TABS_KEY = 'assistant_dialog_open_tabs';
const DEFAULT_DAILY_LIMIT = 10;

/** In-memory fallback if session storage is unavailable. */
const assistantDialogOpenTabs = new Set();

async function getAssistantDialogTabs() {
  try {
    if (chrome.storage?.session) {
      const result = await chrome.storage.session.get(ASSISTANT_DIALOG_TABS_KEY);
      const raw = result?.[ASSISTANT_DIALOG_TABS_KEY];
      if (raw && typeof raw === 'object') {
        return new Set(
          Object.keys(raw)
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && raw[String(id)])
        );
      }
    }
  } catch (_) {
    /* ignore */
  }
  return new Set(assistantDialogOpenTabs);
}

async function setAssistantDialogOpen(tabId, open) {
  if (!tabId) return;
  const tabs = await getAssistantDialogTabs();
  if (open) tabs.add(tabId);
  else tabs.delete(tabId);

  assistantDialogOpenTabs.clear();
  for (const id of tabs) assistantDialogOpenTabs.add(id);

  try {
    if (!chrome.storage?.session) return;
    const payload = {};
    for (const id of tabs) payload[String(id)] = true;
    await chrome.storage.session.set({ [ASSISTANT_DIALOG_TABS_KEY]: payload });
  } catch (_) {
    /* ignore */
  }
}

async function isAssistantDialogOpenForTab(tabId) {
  if (!tabId) return false;
  if (assistantDialogOpenTabs.has(tabId)) return true;
  const tabs = await getAssistantDialogTabs();
  return tabs.has(tabId);
}

async function restoreAssistantDialogOnTab(tabId, url) {
  if (!tabId || !url || !/^https?:\/\//i.test(url)) return;
  if (!(await isAssistantDialogOpenForTab(tabId))) return;
  try {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        files: ['assistant-overlay.js']
      })
      .catch(() => null);
    await ensureContentScriptAndSendMessage(tabId, { action: 'showAssistantDialog' });
  } catch (error) {
    console.warn('Could not restore JobStrike dialog:', error?.message || error);
  }
}

function configureSidePanelBehavior() {
  void enableGlobalSidePanel();
  if (!chrome.sidePanel?.setPanelBehavior) return;
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.warn('setPanelBehavior failed:', error));
}

/**
 * The pinned panel is one panel for the whole window. Options set with a tabId
 * give that tab its own, separate panel instance, which is open on that tab
 * only and closes with it: closing the job tab the panel was opened from used
 * to take JobStrike away from every other tab. So the panel is enabled
 * globally, and a tab gets options of its own only to undo an overlay mode
 * that switched the panel off there.
 */
function enableGlobalSidePanel() {
  if (!chrome.sidePanel?.setOptions) return Promise.resolve();
  return chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }).catch(() => {});
}

async function reenableSidePanelOnTab(tabId) {
  if (!tabId || !chrome.sidePanel?.getOptions || !chrome.sidePanel?.setOptions) return;
  try {
    // A tab with no options of its own reports the global ones (enabled).
    const options = await chrome.sidePanel.getOptions({ tabId });
    if (options && options.enabled === false) {
      await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
    }
  } catch (_) {
    /* ignore */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('JobStrike installed');
  configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(configureSidePanelBehavior);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  void restoreAssistantDialogOnTab(tabId, tab?.url || '');
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void setAssistantDialogOpen(tabId, false);
});

async function preparePinnedSidePanel(tabId) {
  if (!tabId) return { success: true };
  await setAssistantDialogOpen(tabId, false);
  try {
    await ensureContentScriptAndSendMessage(tabId, { action: 'hideAssistantDialog' });
  } catch (_) {
    /* ignore */
  }
  await enableGlobalSidePanel();
  await reenableSidePanelOnTab(tabId);
  return { success: true, mode: 'panel' };
}

async function openPreparedJobTabs(urls) {
  const list = Array.isArray(urls)
    ? urls.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url))
    : [];
  if (!list.length) {
    return { success: false, error: 'Add at least one http(s) job link.' };
  }

  const openedIds = [];
  try {
    // Create every tab inactive first so focus never depends on popup lifetime.
    for (const url of list) {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab?.id) openedIds.push(tab.id);
    }
    if (openedIds[0]) {
      await chrome.tabs.update(openedIds[0], { active: true });
    }
    return { success: true, count: openedIds.length };
  } catch (error) {
    return {
      success: false,
      error: error?.message || String(error),
      count: openedIds.length
    };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // A Greenhouse application form has no description; its page policy stops the
  // content script from asking the job board API, so the worker asks for it.
  if (request && (request.action === 'fetchGreenhouseJob' || request.action === 'fetchSmartRecruitersJob')) {
    const board = String(request.board || '');
    const token = String(request.token || '');
    const greenhouse = request.action === 'fetchGreenhouseJob';
    // Only these two public job APIs, and only well-formed ids.
    const valid = greenhouse
      ? /^[a-z0-9_-]+$/i.test(board) && /^\d+$/.test(token)
      : /^[a-z0-9_-]+$/i.test(board) && /^[0-9a-f-]{8,40}$/i.test(token);
    if (!valid) {
      sendResponse({ success: false });
      return false;
    }
    const address = greenhouse
      ? `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${token}`
      : `https://api.smartrecruiters.com/v1/companies/${board}/postings/${token}`;
    fetch(address, { credentials: 'omit' })
      .then((response) => (response.ok ? response.json() : null))
      .then((job) => sendResponse({ success: Boolean(job), job }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
  if (request && request.action === 'openPreparedJobTabs') {
    void openPreparedJobTabs(request.urls)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error?.message || String(error)
        });
      });
    return true;
  }
  if (request && request.action === 'openSidePanel') {
    const tabId = request.tabId || (sender.tab && sender.tab.id);
    if (!tabId || !chrome.sidePanel?.open) {
      sendResponse({
        success: false,
        error: !tabId
          ? 'No active tab.'
          : 'Chrome side panel is unavailable in this browser.'
      });
      return false;
    }
    // Global, not for this tab: a tab-specific panel would close with the tab.
    void enableGlobalSidePanel();
    // Start open synchronously in the message turn to preserve the user gesture.
    // With no tab-specific panel on this tab, this opens the window's panel.
    const openPromise = chrome.sidePanel.open({ tabId });
    void openPromise
      .then(() => preparePinnedSidePanel(tabId))
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({ success: false, error: error?.message || String(error) });
      });
    return true;
  }
  if (request && request.action === 'preparePinnedSidePanel') {
    const tabId = request.tabId || sender.tab?.id;
    void preparePinnedSidePanel(tabId)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({ success: false, error: error?.message || String(error) });
      });
    return true;
  }
  if (request && request.action === 'setAssistantDialogOpen') {
    const tabId = request.tabId || sender.tab?.id;
    void setAssistantDialogOpen(tabId, Boolean(request.open)).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (request && request.action === 'getAssistantDialogShouldOpen') {
    const tabId = sender.tab?.id;
    void isAssistantDialogOpenForTab(tabId).then((open) => {
      sendResponse({ success: true, open: Boolean(open) });
    });
    return true;
  }
  if (request && request.action === 'openAssistantDialog') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
        sendResponse({
          success: false,
          error: 'Open a regular web page (http/https) before opening JobStrike.'
        });
        return;
      }

      const mode =
        request.mode === 'left' || request.mode === 'right' || request.mode === 'panel'
          ? request.mode
          : 'movable';

      if (mode === 'panel') {
        // Open immediately inside this callback — do not await cleanup first.
        try {
          void enableGlobalSidePanel();
          if (!chrome.sidePanel?.open) {
            throw new Error('Chrome side panel is unavailable in this browser.');
          }
          await chrome.sidePanel.open({ tabId: tab.id });
          void preparePinnedSidePanel(tab.id);
          sendResponse({ success: true, mode: 'panel' });
        } catch (error) {
          sendResponse({
            success: false,
            error: error?.message || 'Could not open the pinned side panel.'
          });
        }
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
          action: 'showAssistantDialog',
          mode
        });
        if (response?.success) {
          await setAssistantDialogOpen(tab.id, true);
          sendResponse(response);
          return;
        }
        throw new Error(response?.error || 'Could not open JobStrike overlay.');
      } catch (error) {
        try {
          await chrome.windows.create({
            url: chrome.runtime.getURL('sidepanel.html?dialog=1'),
            type: 'popup',
            width: 380,
            height: 680,
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

  if (request && request.action === 'closeSidePanelForActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ success: false });
        return;
      }
      try {
        if (chrome.sidePanel?.setOptions) {
          await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
        }
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    });
    return true;
  }

  if (request && request.action === 'enableSidePanelForActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ success: false });
        return;
      }
      try {
        await enableGlobalSidePanel();
        await reenableSidePanelOnTab(tab.id);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    });
    return true;
  }

  if (request && request.action === 'setOptimizedUiOnActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
        sendResponse({
          success: false,
          error: 'Open a regular web page before using Optimized UI.'
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
          action: 'setOptimizedUiRail',
          enabled: Boolean(request.enabled),
          railOnly: false
        });
        if (request.enabled) {
          await setAssistantDialogOpen(tab.id, true);
          try {
            if (chrome.sidePanel?.setOptions) {
              await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
            }
          } catch (_) {
            /* ignore */
          }
        } else {
          try {
            await enableGlobalSidePanel();
            await reenableSidePanelOnTab(tab.id);
            if (chrome.sidePanel?.open) {
              await chrome.sidePanel.open({ tabId: tab.id });
            }
          } catch (_) {
            /* ignore */
          }
        }
        sendResponse(response?.success ? response : { success: false, error: response?.error });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    });
    return true;
  }

  if (request && request.action === 'showPageToastOnActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
        sendResponse({ success: false });
        return;
      }
      try {
        const response = await ensureContentScriptAndSendMessage(tab.id, {
          action: 'showPageToast',
          message: request.message,
          type: request.type,
          timeout: request.timeout
        });
        sendResponse(response?.success ? { success: true } : { success: false });
      } catch (_) {
        sendResponse({ success: false });
      }
    });
    return true;
  }

  if (request && request.action === 'copyTextOnActiveTab') {
    const tabId = request.tabId || sender.tab?.id;
    const copyOnTab = async (id) => {
      if (!id) throw new Error('No active tab.');
      const response = await ensureContentScriptAndSendMessage(id, {
        action: 'copyTextOnHost',
        text: request.text
      });
      if (response?.success) return { success: true };
      throw new Error(response?.error || 'Copy failed.');
    };
    if (tabId) {
      void copyOnTab(tabId)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        void copyOnTab(tabs[0]?.id)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
      });
    }
    return true;
  }

  if (request && request.action === 'broadcastOptUiState') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ success: false });
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'optUiState',
          state: request.state
        });
        sendResponse({ success: true });
      } catch (_) {
        sendResponse({ success: false });
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
          files: ['field-registry.js', 'job-posting-ingest.js', 'content.js', 'assistant-overlay.js']
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

    const assistantModeByCommand = {
      'open-assistant-left': 'left',
      'open-assistant-movable': 'movable',
      'open-assistant-right': 'right',
      'open-assistant-panel': 'panel'
    };
    const assistantMode = assistantModeByCommand[command];
    if (assistantMode) {
      try {
        if (assistantMode === 'panel') {
          void enableGlobalSidePanel();
          if (!chrome.sidePanel?.open) {
            throw new Error('Chrome side panel is unavailable in this browser.');
          }
          await chrome.sidePanel.open({ tabId: tab.id });
          void preparePinnedSidePanel(tab.id);
          return;
        }
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ['assistant-overlay.js']
          })
          .catch(() => null);
        const response = await ensureContentScriptAndSendMessage(tab.id, {
          action: 'showAssistantDialog',
          mode: assistantMode
        });
        if (!response?.success) {
          throw new Error(response?.error || 'Could not open JobStrike.');
        }
        await setAssistantDialogOpen(tab.id, true);
      } catch (error) {
        chrome.action.setBadgeText({ text: '!', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId: tab.id });
        setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2500);
      }
      return;
    }

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
      const response = await ensureContentScriptAndSendMessage(tab.id, { action: 'fetchJobPosting' });
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
