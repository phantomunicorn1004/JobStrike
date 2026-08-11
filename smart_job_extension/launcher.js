(function () {
  const PREPARED_LINKS_KEY = 'prepared_job_links';
  const ASSISTANT_MODE_KEY = 'assistant_dialog_mode';
  const SAVE_DEBOUNCE_MS = 400;

  let saveTimer = null;
  let assistantMode = 'movable';

  function parsePreparedLinks(text) {
    const parts = String(text || '')
      .split(/[\r\n,]+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const urls = [];
    const seen = new Set();

    for (const part of parts) {
      const match = part.match(/https?:\/\/\S+/i);
      const url = (match ? match[0] : part).replace(/[.,;:!?)]+$/, '');
      if (!/^https?:\/\//i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }

    return urls;
  }

  function setStatus(message, kind) {
    const el = document.getElementById('launcherStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'launcher-status';
    if (kind) el.classList.add(kind);
  }

  function updateLinkCount() {
    const input = document.getElementById('preparedLinksInput');
    const countEl = document.getElementById('preparedLinksCount');
    const startBtn = document.getElementById('startApplyBtn');
    if (!input || !countEl) return;

    const urls = parsePreparedLinks(input.value);
    const count = urls.length;
    countEl.textContent = count === 1 ? '1 link' : `${count} links`;
    if (startBtn) startBtn.disabled = count === 0;
  }

  function scheduleSavePreparedLinks() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const input = document.getElementById('preparedLinksInput');
      if (!input) return;
      chrome.storage.local.set({ [PREPARED_LINKS_KEY]: input.value });
    }, SAVE_DEBOUNCE_MS);
  }

  function loadPreparedLinks() {
    chrome.storage.local.get([PREPARED_LINKS_KEY], (result) => {
      const input = document.getElementById('preparedLinksInput');
      if (!input) return;
      if (typeof result[PREPARED_LINKS_KEY] === 'string') {
        input.value = result[PREPARED_LINKS_KEY];
      }
      updateLinkCount();
    });
  }

  async function openPreparedJobTabs() {
    const input = document.getElementById('preparedLinksInput');
    const startBtn = document.getElementById('startApplyBtn');
    if (!input) return;

    const urls = parsePreparedLinks(input.value);
    if (!urls.length) {
      setStatus('Add at least one http(s) job link.', 'error');
      return;
    }

    chrome.storage.local.set({ [PREPARED_LINKS_KEY]: input.value });
    if (startBtn) startBtn.disabled = true;
    setStatus(`Opening ${urls.length} tab${urls.length === 1 ? '' : 's'}…`, 'info');

    try {
      await chrome.tabs.create({ url: urls[0], active: true });
      for (let i = 1; i < urls.length; i += 1) {
        await chrome.tabs.create({ url: urls[i], active: false });
      }
      window.close();
    } catch (err) {
      if (startBtn) startBtn.disabled = false;
      setStatus(err.message || 'Could not open job tabs.', 'error');
    }
  }

  function normalizeAssistantMode(mode) {
    if (mode === 'left' || mode === 'right' || mode === 'panel') return mode;
    return 'movable';
  }

  function setAssistantMode(mode, persist = true) {
    assistantMode = normalizeAssistantMode(mode);
    document.querySelectorAll('[data-assistant-mode]').forEach((button) => {
      const active = button.dataset.assistantMode === assistantMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (persist) chrome.storage.local.set({ [ASSISTANT_MODE_KEY]: assistantMode });
  }

  function loadAssistantMode() {
    chrome.storage.local.get([ASSISTANT_MODE_KEY], (result) => {
      setAssistantMode(result?.[ASSISTANT_MODE_KEY], false);
    });
  }

  function openPinnedPanelFromLauncher() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
          reject(
            new Error(
              'Open a regular web page (http/https) before opening Job Assistant.'
            )
          );
          return;
        }
        if (!chrome.sidePanel?.open) {
          reject(new Error('Chrome side panel is unavailable in this browser.'));
          return;
        }

        // Must call open() in this user-gesture turn (popup click). Routing
        // through the service worker with awaits drops the gesture token.
        if (chrome.sidePanel.setOptions) {
          void chrome.sidePanel.setOptions({
            tabId: tab.id,
            path: 'sidepanel.html',
            enabled: true
          });
        }
        chrome.sidePanel
          .open({ tabId: tab.id })
          .then(() => {
            chrome.runtime.sendMessage(
              { action: 'preparePinnedSidePanel', tabId: tab.id },
              () => void chrome.runtime.lastError
            );
            resolve({ success: true, mode: 'panel' });
          })
          .catch((error) => {
            reject(
              error instanceof Error
                ? error
                : new Error(String(error || 'Could not open pinned panel.'))
            );
          });
      });
    });
  }

  async function openAssistantDialog() {
    const sidebarBtn = document.getElementById('openSidebarBtn');
    if (sidebarBtn) sidebarBtn.disabled = true;
    setStatus('Opening Job Assistant…', 'info');

    try {
      if (assistantMode === 'panel') {
        await openPinnedPanelFromLauncher();
        window.close();
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: 'openAssistantDialog',
        mode: assistantMode
      });
      if (!response?.success) {
        throw new Error(response?.error || 'Could not open Job Assistant.');
      }
      window.close();
    } catch (err) {
      if (sidebarBtn) sidebarBtn.disabled = false;
      setStatus(err.message || 'Could not open Job Assistant.', 'error');
    }
  }

  async function loadCommandShortcuts() {
    const label = document.getElementById('pickerShortcutLabel');
    if (!chrome.commands?.getAll) return;
    try {
      const commands = await chrome.commands.getAll();
      const pickerCommand = commands.find((command) => command.name === 'start-element-text-picker');
      if (label) label.textContent = pickerCommand?.shortcut || 'Set hotkey';
      document.querySelectorAll('[data-command-shortcut]').forEach((element) => {
        const command = commands.find(
          (item) => item.name === element.dataset.commandShortcut
        );
        element.textContent = command?.shortcut || 'Set hotkey';
        element.title = command?.shortcut
          ? `${command.description}: ${command.shortcut}`
          : `Set shortcut for ${command?.description || element.dataset.commandShortcut}`;
      });
    } catch (_) {
      if (label) label.textContent = 'Set hotkey';
    }
  }

  async function startElementTextPicker() {
    const pickerBtn = document.getElementById('startElementPickerBtn');
    if (pickerBtn) pickerBtn.disabled = true;
    setStatus('Starting element text picker…', 'info');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'startElementTextPicker' });
      if (!response?.success) {
        throw new Error(response?.error || 'Could not start the text picker.');
      }
      window.close();
    } catch (err) {
      if (pickerBtn) pickerBtn.disabled = false;
      setStatus(err.message || 'Could not start the text picker.', 'error');
    }
  }

  async function openShortcutSettings() {
    try {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts', active: true });
      window.close();
    } catch (_) {
      setStatus('Open chrome://extensions/shortcuts to configure the hotkey.', 'info');
    }
  }

  function initLauncher() {
    if (window.SmartJobTheme?.initTheme) {
      window.SmartJobTheme.initTheme();
    }

    const input = document.getElementById('preparedLinksInput');
    const startBtn = document.getElementById('startApplyBtn');
    const sidebarBtn = document.getElementById('openSidebarBtn');
    const pickerBtn = document.getElementById('startElementPickerBtn');
    const configureShortcutBtn = document.getElementById('configurePickerShortcutBtn');
    const configureAssistantShortcutsBtn = document.getElementById(
      'configureAssistantShortcutsBtn'
    );

    loadPreparedLinks();
    loadCommandShortcuts();
    loadAssistantMode();

    document.querySelectorAll('[data-assistant-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        setAssistantMode(button.dataset.assistantMode);
      });
    });

    if (input) {
      input.addEventListener('input', () => {
        updateLinkCount();
        scheduleSavePreparedLinks();
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        openPreparedJobTabs();
      });
    }

    if (sidebarBtn) {
      sidebarBtn.addEventListener('click', () => {
        openAssistantDialog();
      });
    }

    if (pickerBtn) {
      pickerBtn.addEventListener('click', () => {
        startElementTextPicker();
      });
    }

    if (configureShortcutBtn) {
      configureShortcutBtn.addEventListener('click', () => {
        openShortcutSettings();
      });
    }

    if (configureAssistantShortcutsBtn) {
      configureAssistantShortcutsBtn.addEventListener('click', () => {
        openShortcutSettings();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', initLauncher);
})();
