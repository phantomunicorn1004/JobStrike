/**
 * Flexible Job Assistant shell injected on the page.
 * Supports movable, dock-left, and dock-right modes.
 */
(function () {
  if (window.__remoteHelperAssistantOverlay) return;
  window.__remoteHelperAssistantOverlay = true;

  const HOST_ID = 'remote-helper-assistant-host';
  const STORAGE_KEY = 'assistant_dialog_geom_v3';
  const MODE_KEY = 'assistant_dialog_mode';
  const THEME_KEY = 'extension_theme';
  const VALID_MODES = new Set(['movable', 'left', 'right']);
  const DEFAULT_WIDTH = 380;
  const DEFAULT_HEIGHT = 700;
  const MIN_WIDTH = 300;
  const MIN_HEIGHT = 460;
  const MAX_DOCK_WIDTH = 560;

  let hostEl = null;
  let shadow = null;
  let panelEl = null;
  let iframeEl = null;
  let themeBtn = null;
  let dragState = null;
  let resizeState = null;
  let currentMode = 'movable';
  let currentTheme = 'dark';
  let floatingGeom = null;
  let dockWidth = DEFAULT_WIDTH;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultGeom() {
    const width = Math.min(DEFAULT_WIDTH, Math.max(240, window.innerWidth - 16));
    const height = Math.min(DEFAULT_HEIGHT, Math.max(320, window.innerHeight - 8));
    const left = Math.max(4, window.innerWidth - width - 12);
    const top = Math.max(4, Math.round((window.innerHeight - height) / 2));
    return { left, top, width, height };
  }

  function normalizeMode(mode) {
    return VALID_MODES.has(mode) ? mode : 'movable';
  }

  function loadMode() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([MODE_KEY], (result) => {
          resolve(normalizeMode(result?.[MODE_KEY]));
        });
      } catch (_) {
        resolve('movable');
      }
    });
  }

  function saveMode(mode) {
    try {
      chrome.storage.local.set({ [MODE_KEY]: normalizeMode(mode) });
    } catch (_) {
      /* ignore */
    }
  }

  function normalizeTheme(theme) {
    return theme === 'light' ? 'light' : 'dark';
  }

  function applyOverlayTheme(theme) {
    currentTheme = normalizeTheme(theme);
    if (panelEl) panelEl.dataset.theme = currentTheme;
    if (themeBtn) {
      const nextIsLight = currentTheme === 'dark';
      themeBtn.setAttribute(
        'aria-label',
        nextIsLight ? 'Switch to light mode' : 'Switch to dark mode'
      );
      themeBtn.setAttribute('title', nextIsLight ? 'Light mode' : 'Dark mode');
    }
  }

  function loadTheme() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([THEME_KEY], (result) => {
          const stored = result?.[THEME_KEY];
          if (stored === 'dark' || stored === 'light') {
            resolve(stored);
            return;
          }
          resolve(
            window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          );
        });
      } catch (_) {
        resolve('dark');
      }
    });
  }

  function setTheme(theme) {
    const resolved = normalizeTheme(theme);
    applyOverlayTheme(resolved);
    try {
      chrome.storage.local.set({ [THEME_KEY]: resolved });
    } catch (_) {
      /* ignore */
    }
    try {
      iframeEl?.contentWindow?.postMessage(
        { source: 'remote-helper-assistant', action: 'setTheme', theme: resolved },
        '*'
      );
    } catch (_) {
      /* ignore */
    }
  }

  function toggleTheme() {
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  function loadGeom() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          const saved = result?.[STORAGE_KEY];
          if (
            saved &&
            typeof saved.left === 'number' &&
            typeof saved.top === 'number' &&
            typeof saved.width === 'number' &&
            typeof saved.height === 'number'
          ) {
            resolve(saved);
            return;
          }
          resolve(defaultGeom());
        });
      } catch (_) {
        resolve(defaultGeom());
      }
    });
  }

  function saveGeom(geom) {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: geom });
    } catch (_) {
      /* ignore */
    }
  }

  function applyGeom(geom, mode = currentMode) {
    if (!panelEl || !geom) return;
    const normalizedMode = normalizeMode(mode);
    const docked = normalizedMode !== 'movable';
    const availableWidth = Math.max(240, window.innerWidth - (docked ? 0 : 8));
    const availableHeight = Math.max(320, window.innerHeight - (docked ? 0 : 8));
    const minimumWidth = Math.min(MIN_WIDTH, availableWidth);
    const minimumHeight = Math.min(MIN_HEIGHT, availableHeight);
    const maxWidth = docked
      ? Math.min(MAX_DOCK_WIDTH, availableWidth)
      : availableWidth;
    const width = clamp(geom.width || DEFAULT_WIDTH, minimumWidth, maxWidth);
    const height = docked
      ? window.innerHeight
      : clamp(geom.height || DEFAULT_HEIGHT, minimumHeight, availableHeight);
    const left =
      normalizedMode === 'left'
        ? 0
        : normalizedMode === 'right'
          ? Math.max(0, window.innerWidth - width)
          : clamp(geom.left ?? 4, 0, Math.max(0, window.innerWidth - width));
    const top =
      docked ? 0 : clamp(geom.top ?? 4, 0, Math.max(0, window.innerHeight - height));

    panelEl.dataset.mode = normalizedMode;
    panelEl.style.width = `${width}px`;
    panelEl.style.height = `${height}px`;
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    return { left, top, width, height };
  }

  function readCurrentGeom() {
    if (!panelEl) return defaultGeom();
    return {
      left: parseFloat(panelEl.style.left) || 0,
      top: parseFloat(panelEl.style.top) || 0,
      width: panelEl.offsetWidth || DEFAULT_WIDTH,
      height: panelEl.offsetHeight || DEFAULT_HEIGHT
    };
  }

  function updateModeUi() {
    if (!shadow) return;
    shadow.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === currentMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const header = shadow.getElementById('rhHeader');
    if (header) {
      header.title = currentMode === 'movable' ? 'Drag to move' : 'Choose movable mode to drag';
    }
  }

  async function setMode(mode, persist = true) {
    const nextMode = normalizeMode(mode);
    if (currentMode === 'movable' && panelEl && !panelEl.hidden) {
      floatingGeom = readCurrentGeom();
      saveGeom(floatingGeom);
    } else if (currentMode !== 'movable' && panelEl) {
      dockWidth = panelEl.offsetWidth || dockWidth;
    }

    currentMode = nextMode;
    if (persist) saveMode(currentMode);
    if (!floatingGeom) floatingGeom = await loadGeom();
    const source =
      currentMode === 'movable'
        ? floatingGeom
        : { ...floatingGeom, width: dockWidth, height: window.innerHeight };
    const geom = applyGeom(source, currentMode);
    if (currentMode === 'movable' && geom) {
      floatingGeom = geom;
      saveGeom(geom);
    }
    updateModeUi();
    return currentMode;
  }

  function ensureHost() {
    if (hostEl && document.documentElement.contains(hostEl)) return hostEl;

    hostEl = document.getElementById(HOST_ID);
    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = HOST_ID;
      hostEl.setAttribute('data-remote-helper', 'assistant');
      document.documentElement.appendChild(hostEl);
    }

    shadow = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .rh-root {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          pointer-events: none;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        }
        .rh-panel {
          position: fixed;
          display: flex;
          flex-direction: column;
          pointer-events: auto;
          border-radius: 14px;
          overflow: hidden;
          box-shadow:
            0 18px 48px rgba(15, 23, 42, 0.28),
            0 0 0 1px rgba(15, 23, 42, 0.12);
          background: #0f172a;
          color: #e2e8f0;
        }
        .rh-panel[data-mode="left"] {
          border-radius: 0 14px 14px 0;
          box-shadow: 10px 0 32px rgba(15, 23, 42, 0.24);
        }
        .rh-panel[data-mode="right"] {
          border-radius: 14px 0 0 14px;
          box-shadow: -10px 0 32px rgba(15, 23, 42, 0.24);
        }
        .rh-panel[hidden] { display: none !important; }
        .rh-header {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          height: 32px;
          padding: 0 6px 0 10px;
          cursor: grab;
          user-select: none;
          background: linear-gradient(180deg, #1e293b, #0f172a);
          border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        }
        .rh-header:active { cursor: grabbing; }
        .rh-title {
          flex: 1;
          min-width: 0;
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rh-modes {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }
        .rh-theme,
        .rh-mode,
        .rh-close {
          flex-shrink: 0;
          width: 26px;
          height: 26px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: inherit;
          font: 600 11px/1 system-ui, sans-serif;
          cursor: pointer;
          opacity: 0.72;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .rh-theme svg {
          width: 14px;
          height: 14px;
          display: block;
        }
        .rh-theme .rh-theme-sun { display: none; }
        .rh-panel[data-theme="light"] .rh-theme .rh-theme-moon { display: none; }
        .rh-panel[data-theme="light"] .rh-theme .rh-theme-sun { display: block; }
        .rh-close {
          font-size: 18px;
          font-weight: 400;
          opacity: 1;
        }
        .rh-theme:hover,
        .rh-mode:hover,
        .rh-mode.active,
        .rh-close:hover { background: rgba(148, 163, 184, 0.2); opacity: 1; }
        .rh-mode.active {
          color: #a5b4fc;
          opacity: 1;
          box-shadow: inset 0 0 0 1px rgba(165, 180, 252, 0.32);
        }
        .rh-panel[data-theme="light"] {
          background: #f8fafc;
          color: #0f172a;
          box-shadow:
            0 18px 48px rgba(15, 23, 42, 0.16),
            0 0 0 1px rgba(15, 23, 42, 0.1);
        }
        .rh-panel[data-theme="light"] .rh-header {
          background: linear-gradient(180deg, #ffffff, #f1f5f9);
          border-bottom-color: rgba(15, 23, 42, 0.1);
        }
        .rh-panel[data-theme="light"] .rh-mode.active {
          color: #4f46e5;
          box-shadow: inset 0 0 0 1px rgba(79, 70, 229, 0.28);
        }
        .rh-panel[data-theme="light"] .rh-frame {
          background: #fff;
        }
        .rh-panel[data-theme="light"][data-mode="movable"] .rh-resize::after {
          border-right-color: rgba(15, 23, 42, 0.35);
          border-bottom-color: rgba(15, 23, 42, 0.35);
        }
        .rh-frame {
          flex: 1;
          min-height: 0;
          width: 100%;
          border: 0;
          background: #fff;
        }
        .rh-resize {
          position: absolute;
          z-index: 2;
          touch-action: none;
        }
        .rh-panel[data-mode="movable"] .rh-resize {
          right: 0;
          bottom: 0;
          width: 18px;
          height: 18px;
          cursor: nwse-resize;
        }
        .rh-panel[data-mode="movable"] .rh-resize::after {
          content: "";
          position: absolute;
          right: 4px;
          bottom: 4px;
          width: 7px;
          height: 7px;
          border-right: 2px solid rgba(226, 232, 240, 0.55);
          border-bottom: 2px solid rgba(226, 232, 240, 0.55);
        }
        .rh-panel[data-mode="left"] .rh-resize {
          top: 32px;
          right: -4px;
          bottom: 0;
          width: 8px;
          cursor: ew-resize;
        }
        .rh-panel[data-mode="right"] .rh-resize {
          top: 32px;
          left: -4px;
          bottom: 0;
          width: 8px;
          cursor: ew-resize;
        }
      </style>
      <div class="rh-root">
        <div class="rh-panel" id="rhPanel" hidden>
          <div class="rh-header" id="rhHeader" title="Drag to move">
            <div class="rh-title">Job Assistant</div>
            <button type="button" class="rh-theme" id="rhTheme" aria-label="Switch to light mode" title="Light mode">
              <svg class="rh-theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
              <svg class="rh-theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
              </svg>
            </button>
            <div class="rh-modes" role="group" aria-label="Assistant position">
              <button type="button" class="rh-mode" data-mode="left" title="Dock left" aria-label="Dock left">L</button>
              <button type="button" class="rh-mode" data-mode="movable" title="Movable dialog" aria-label="Movable dialog">◇</button>
              <button type="button" class="rh-mode" data-mode="right" title="Dock right" aria-label="Dock right">R</button>
            </div>
            <button type="button" class="rh-close" id="rhClose" aria-label="Close">×</button>
          </div>
          <iframe class="rh-frame" id="rhFrame" title="Job Assistant"></iframe>
          <div class="rh-resize" id="rhResize" aria-hidden="true"></div>
        </div>
      </div>
    `;

    panelEl = shadow.getElementById('rhPanel');
    iframeEl = shadow.getElementById('rhFrame');
    const header = shadow.getElementById('rhHeader');
    const closeBtn = shadow.getElementById('rhClose');
    themeBtn = shadow.getElementById('rhTheme');
    const resizeHandle = shadow.getElementById('rhResize');

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideAssistantDialog();
    });

    if (themeBtn) {
      themeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
      });
    }

    shadow.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void setMode(button.dataset.mode);
      });
    });

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[THEME_KEY]) return;
        applyOverlayTheme(changes[THEME_KEY].newValue);
      });
    } catch (_) {
      /* ignore */
    }

    void loadTheme().then(applyOverlayTheme);

    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (currentMode !== 'movable') return;
      if (e.target.closest('button')) return;
      const geom = readCurrentGeom();
      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: geom.left,
        originTop: geom.top
      };
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const next = applyGeom({
        ...readCurrentGeom(),
        left: dragState.originLeft + dx,
        top: dragState.originTop + dy
      });
      if (next) {
        floatingGeom = next;
        saveGeom(next);
      }
    });

    const endDrag = (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      dragState = null;
      floatingGeom = readCurrentGeom();
      saveGeom(floatingGeom);
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    resizeHandle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const geom = readCurrentGeom();
      resizeState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        width: geom.width,
        height: geom.height
      };
      resizeHandle.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    resizeHandle.addEventListener('pointermove', (e) => {
      if (!resizeState || resizeState.pointerId !== e.pointerId) return;
      const dx = e.clientX - resizeState.startX;
      const dy = e.clientY - resizeState.startY;
      const next = applyGeom(
        {
          ...readCurrentGeom(),
          width:
            currentMode === 'right'
              ? resizeState.width - dx
              : resizeState.width + dx,
          height:
            currentMode === 'movable'
              ? resizeState.height + dy
              : window.innerHeight
        },
        currentMode
      );
      if (next) {
        if (currentMode === 'movable') {
          floatingGeom = next;
          saveGeom(next);
        } else {
          dockWidth = next.width;
        }
      }
    });

    const endResize = (e) => {
      if (!resizeState || resizeState.pointerId !== e.pointerId) return;
      resizeState = null;
      if (currentMode === 'movable') {
        floatingGeom = readCurrentGeom();
        saveGeom(floatingGeom);
      } else {
        dockWidth = panelEl?.offsetWidth || dockWidth;
      }
    };
    resizeHandle.addEventListener('pointerup', endResize);
    resizeHandle.addEventListener('pointercancel', endResize);

    window.addEventListener('resize', () => {
      if (!panelEl || panelEl.hidden) return;
      const source =
        currentMode === 'movable'
          ? readCurrentGeom()
          : { ...(floatingGeom || defaultGeom()), width: dockWidth };
      const next = applyGeom(source, currentMode);
      if (currentMode === 'movable' && next) {
        floatingGeom = next;
        saveGeom(next);
      }
    });

    updateModeUi();
    return hostEl;
  }

  function notifyDialogOpenState(open) {
    try {
      chrome.runtime.sendMessage({ action: 'setAssistantDialogOpen', open: Boolean(open) }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      /* ignore */
    }
  }

  async function showAssistantDialog(mode) {
    ensureHost();
    currentMode = normalizeMode(mode || (await loadMode()));
    if (mode) saveMode(currentMode);
    floatingGeom = await loadGeom();
    dockWidth = floatingGeom.width || DEFAULT_WIDTH;
    const source =
      currentMode === 'movable'
        ? floatingGeom
        : { ...floatingGeom, width: dockWidth, height: window.innerHeight };
    const geom = applyGeom(source, currentMode);
    if (currentMode === 'movable' && geom) {
      floatingGeom = geom;
      saveGeom(geom);
    }
    updateModeUi();

    void loadTheme().then(applyOverlayTheme);

    const url = chrome.runtime.getURL('sidepanel.html?dialog=1');
    if (iframeEl && iframeEl.getAttribute('src') !== url) {
      iframeEl.setAttribute('src', url);
    }

    panelEl.hidden = false;
    notifyDialogOpenState(true);
    return { success: true };
  }

  function hideAssistantDialog() {
    if (panelEl) panelEl.hidden = true;
    notifyDialogOpenState(false);
    return { success: true };
  }

  function toggleAssistantDialog() {
    ensureHost();
    if (panelEl && !panelEl.hidden) return hideAssistantDialog();
    return showAssistantDialog();
  }

  function isAssistantDialogOpen() {
    return Boolean(panelEl && !panelEl.hidden);
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (!request || !request.action) return false;

    if (request.action === 'showAssistantDialog') {
      showAssistantDialog(request.mode)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
      return true;
    }

    if (request.action === 'hideAssistantDialog') {
      sendResponse(hideAssistantDialog());
      return true;
    }

    if (request.action === 'toggleAssistantDialog') {
      Promise.resolve(toggleAssistantDialog())
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
      return true;
    }

    if (request.action === 'assistantDialogState') {
      sendResponse({ success: true, open: isAssistantDialogOpen(), mode: currentMode });
      return true;
    }

    return false;
  });

  // Restore after full page navigations (content script remounts on the new document).
  try {
    chrome.runtime.sendMessage({ action: 'getAssistantDialogShouldOpen' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.open) {
        void showAssistantDialog();
      }
    });
  } catch (_) {
    /* ignore */
  }
})();
