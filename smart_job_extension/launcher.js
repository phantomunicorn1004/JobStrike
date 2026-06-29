(function () {
  const PREPARED_LINKS_KEY = 'prepared_job_links';
  const SAVE_DEBOUNCE_MS = 400;

  let saveTimer = null;

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

  async function openSidePanel() {
    const sidebarBtn = document.getElementById('openSidebarBtn');
    if (sidebarBtn) sidebarBtn.disabled = true;
    setStatus('Opening sidebar…', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      if (!chrome.sidePanel?.open) {
        throw new Error('Chrome side panel API is unavailable.');
      }

      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } catch (err) {
      if (sidebarBtn) sidebarBtn.disabled = false;
      setStatus(err.message || 'Could not open sidebar.', 'error');
    }
  }

  function initLauncher() {
    if (window.SmartJobTheme?.initTheme) {
      window.SmartJobTheme.initTheme();
    }

    const input = document.getElementById('preparedLinksInput');
    const startBtn = document.getElementById('startApplyBtn');
    const sidebarBtn = document.getElementById('openSidebarBtn');

    loadPreparedLinks();

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
        openSidePanel();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', initLauncher);
})();
