/**
 * Flexible JobStrike shell injected on the page.
 * Supports movable, dock-left, and dock-right modes.
 */
(function () {
  const OVERLAY_VERSION = 18;
  if (window.__remoteHelperAssistantOverlayVersion >= OVERLAY_VERSION) return;
  try {
    document
      .querySelectorAll(
        '#remote-helper-assistant-host, #remote-helper-assistant-host, #rh-assistant-host, [data-remote-helper="assistant"]'
      )
      .forEach((el) => el.remove());
  } catch (_) {
    /* ignore */
  }
  window.__remoteHelperAssistantOverlay = true;
  window.__remoteHelperAssistantOverlayVersion = OVERLAY_VERSION;

  const HOST_ID = 'remote-helper-assistant-host';
  const STORAGE_KEY = 'assistant_dialog_geom_v3';
  const OPT_RAIL_KEY = 'assistant_opt_rail_geom_v1';
  const EXPANDED_HOST_KEY = 'rwh_expanded_host_v1';
  const OPTIMIZED_UI_KEY = 'rwh_optimized_ui_v1';
  const MODE_KEY = 'assistant_dialog_mode';
  let cachedExpandedHost = 'panel';
  void loadExpandedHost();
  const THEME_KEY = 'extension_theme';
  const VALID_MODES = new Set(['movable', 'left', 'right']);
  const DEFAULT_WIDTH = 380;
  const DEFAULT_HEIGHT = 700;
  const MIN_WIDTH = 300;
  const MIN_HEIGHT = 460;
  const MAX_DOCK_WIDTH = 560;
  /** Keep the page scrollbar reachable when docked on the right. */
  const RIGHT_DOCK_MIN_GUTTER = 14;
  const OPT_RAIL_WIDTH = 56;
  const OPT_RAIL_HEIGHT = 420;

  let hostEl = null;
  let shadow = null;
  let panelEl = null;
  let iframeEl = null;
  let optRailEl = null;
  let pageToastEl = null;
  let pageToastTimer = null;
  /** Last Initial-rail action — toast anchors beside this button. */
  let lastOptAction = null;
  let themeBtn = null;
  let dragState = null;
  let optDragState = null;
  let resizeState = null;
  let currentMode = 'movable';
  let currentTheme = 'dark';
  let floatingGeom = null;
  let dockWidth = DEFAULT_WIDTH;
  let optimizedUi = false;
  let optRailOnly = false;
  let optRailGeom = null;
  let textDlgEl = null;
  let textDlgTitleEl = null;
  let textDlgInputEl = null;
  let textDlgKind = null;

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

  async function openPinnedPanelFromOverlay() {
    hideAssistantDialog();
    try {
      chrome.storage.local.set({ [MODE_KEY]: 'panel' });
    } catch (_) {
      /* ignore */
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'openSidePanel' }, (response) => {
          void chrome.runtime.lastError;
          resolve(response || { success: false, error: 'Could not open pinned panel.' });
        });
      } catch (error) {
        resolve({ success: false, error: error?.message || String(error) });
      }
    });
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
    if (optRailEl) optRailEl.dataset.theme = currentTheme;
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

  /**
   * Width of the page's vertical scrollbar, with a minimum so overlay-style
   * scrollbars stay clickable next to a right-docked panel.
   */
  function rightDockGutter() {
    const doc = document.documentElement;
    if (!doc) return 0;
    const scrollbarWidth = Math.max(0, window.innerWidth - doc.clientWidth);
    const scrollable = doc.scrollHeight > doc.clientHeight + 1;
    if (!scrollable) return scrollbarWidth;
    return Math.max(scrollbarWidth, RIGHT_DOCK_MIN_GUTTER);
  }

  function applyGeom(geom, mode = currentMode) {
    if (!panelEl || !geom) return;
    const normalizedMode = normalizeMode(mode);
    const docked = normalizedMode !== 'movable';
    const gutter = normalizedMode === 'right' ? rightDockGutter() : 0;
    const availableWidth = Math.max(240, window.innerWidth - (docked ? gutter : 8));
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
          ? Math.max(0, window.innerWidth - width - gutter)
          : clamp(geom.left ?? 4, 0, Math.max(0, window.innerWidth - width));
    const top =
      docked ? 0 : clamp(geom.top ?? 4, 0, Math.max(0, window.innerHeight - height));

    panelEl.dataset.mode = normalizedMode;
    panelEl.style.width = `${width}px`;
    panelEl.style.height = `${height}px`;
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    /* exclusivity: Initial panel => hide rail */
    if (!panelEl.hidden) hideOptRailHard();
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
    if (mode === 'panel') {
      return openPinnedPanelFromOverlay();
    }
    // L / ◇ / R = full Initial UI only — never leave the optimized rail up.
    if (optimizedUi) {
      await setOptimizedUi(false);
      postToSidepanel({ action: 'setOptimizedUiMode', enabled: false });
    }
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
        /* Shadow DOM: author display must not override [hidden]. */
        .rh-panel[hidden] {
          display: none !important;
        }
        .rh-panel[data-mode="left"] {
          border-radius: 0 14px 14px 0;
          box-shadow: 10px 0 32px rgba(15, 23, 42, 0.24);
        }
        .rh-panel[data-mode="right"] {
          border-radius: 14px;
          box-shadow: -10px 0 32px rgba(15, 23, 42, 0.24);
        }
        .rh-opt-rail {
          position: fixed;
          z-index: 2147483647;
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          width: ${OPT_RAIL_WIDTH}px;
          padding: 10px 6px 12px;
          box-sizing: border-box;
          pointer-events: auto;
          border-radius: 16px;
          background: #0f172a;
          color: #e2e8f0;
          box-shadow:
            0 14px 36px rgba(15, 23, 42, 0.32),
            0 0 0 1px rgba(148, 163, 184, 0.18);
          user-select: none;
        }
        .rh-opt-rail.is-visible:not([hidden]) { display: flex !important; }
        .rh-opt-rail[hidden],
        .rh-opt-rail:not(.is-visible) {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
        .rh-opt-rail[data-theme="light"] {
          background: #f8fafc;
          color: #0f172a;
          box-shadow:
            0 14px 36px rgba(15, 23, 42, 0.14),
            0 0 0 1px rgba(15, 23, 42, 0.1);
        }
        .rh-text-dlg {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: none;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          background: rgba(15, 23, 42, 0.45);
          padding: 16px;
          box-sizing: border-box;
        }
        .rh-text-dlg.is-open { display: flex !important; }
        .rh-text-dlg[hidden] { display: none !important; }
        .rh-text-dlg-card {
          width: min(520px, 100%);
          max-height: min(70vh, 560px);
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px;
          border-radius: 14px;
          background: #0f172a;
          color: #e2e8f0;
          box-shadow: 0 18px 48px rgba(15, 23, 42, 0.4);
        }
        .rh-text-dlg-card h3 {
          margin: 0;
          font: 650 14px/1.3 system-ui, sans-serif;
        }
        .rh-text-dlg-card textarea {
          flex: 1;
          min-height: 220px;
          resize: vertical;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: #020617;
          color: inherit;
          padding: 10px 12px;
          font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .rh-text-dlg-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .rh-text-dlg-actions button {
          border: none;
          border-radius: 8px;
          padding: 8px 12px;
          font: 600 12px/1 system-ui, sans-serif;
          cursor: pointer;
        }
        .rh-text-dlg-cancel {
          background: rgba(148, 163, 184, 0.18);
          color: inherit;
        }
        .rh-text-dlg-apply {
          background: #4f46e5;
          color: #fff;
        }
        .rh-opt-drag {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          width: 100%;
          height: 18px;
          cursor: grab;
          touch-action: none;
          opacity: 0.55;
        }
        .rh-opt-drag:active { cursor: grabbing; }
        .rh-opt-drag span {
          display: block;
          width: 16px;
          height: 2px;
          border-radius: 1px;
          background: currentColor;
        }
        .rh-opt-status {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
        }
        .rh-opt-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #64748b;
          box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.25);
        }
        .rh-opt-progress {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          width: 100%;
        }
        .rh-opt-progress-count {
          font-size: 9px;
          font-weight: 700;
          line-height: 1;
          opacity: 0.75;
        }
        .rh-opt-progress-bar {
          width: 20px;
          height: 3px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.35);
          overflow: hidden;
        }
        .rh-opt-progress-fill {
          display: block;
          width: 0;
          height: 100%;
          background: #22c55e;
        }
        .rh-opt-btn.is-done-step { color: #22c55e; }
        .rh-opt-btn.is-current-step {
          box-shadow: 0 0 0 2px rgba(102, 102, 255, 0.55);
        }
        .rh-opt-btn.is-blocked-step {
          box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.55);
        }
        .rh-opt-dot.is-ok,
        .rh-opt-dot.connected { background: #22c55e; }
        .rh-opt-dot.is-warn { background: #f59e0b; }
        .rh-opt-dot.is-err,
        .rh-opt-dot.disconnected,
        .rh-opt-dot.error { background: #ef4444; }
        .rh-opt-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .rh-opt-btn {
          position: relative;
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 50%;
          background: rgba(148, 163, 184, 0.16);
          color: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .rh-opt-btn.is-primary {
          background: rgba(99, 102, 241, 0.28);
        }
        .rh-opt-rail[data-theme="light"] .rh-opt-btn {
          background: rgba(15, 23, 42, 0.08);
        }
        .rh-opt-rail[data-theme="light"] .rh-opt-btn.is-primary {
          background: rgba(79, 70, 229, 0.18);
        }
        .rh-opt-btn:hover:not(:disabled) {
          background: rgba(148, 163, 184, 0.28);
        }
        .rh-opt-btn:disabled {
          opacity: 0.38;
          cursor: not-allowed;
        }
        .rh-opt-btn svg {
          width: 18px;
          height: 18px;
          display: block;
        }
        .rh-opt-btn .rh-opt-spin {
          position: absolute;
          inset: 0;
          margin: auto;
          width: 16px;
          height: 16px;
          border: 2px solid currentColor;
          border-right-color: transparent;
          border-radius: 50%;
          animation: rh-opt-spin 0.7s linear infinite;
        }
        .rh-opt-btn.is-loading svg { opacity: 0; }
        @keyframes rh-opt-spin {
          to { transform: rotate(360deg); }
        }
        .rh-page-toast {
          position: fixed;
          right: 20px;
          bottom: 20px;
          left: auto;
          top: auto;
          z-index: 2147483647;
          max-width: min(380px, calc(100vw - 40px));
          padding: 11px 16px;
          border-radius: 10px;
          font: 13px/1.35 system-ui, -apple-system, Segoe UI, sans-serif;
          font-weight: 500;
          color: #f8fafc;
          background: rgba(18, 24, 38, 0.96);
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.45), 0 2px 8px rgba(0, 0, 0, 0.2);
          pointer-events: none;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        .rh-page-toast.is-visible {
          opacity: 1;
          transform: translateY(0);
        }
        .rh-page-toast.is-success { background: rgba(22, 101, 52, 0.96); }
        .rh-page-toast.is-error { background: rgba(153, 27, 27, 0.96); }
        .rh-page-toast.is-warn { background: rgba(146, 64, 14, 0.96); }
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
            <div class="rh-title">JobStrike</div>
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
              <button type="button" class="rh-mode" data-mode="panel" id="rhPanelMode" title="Open Chrome pinned side panel" aria-label="Open pinned side panel">P</button>
            </div>
            <button type="button" class="rh-close" id="rhClose" aria-label="Close">×</button>
          </div>
          <iframe class="rh-frame" id="rhFrame" title="JobStrike" allow="clipboard-write"></iframe>
          <div class="rh-resize" id="rhResize" aria-hidden="true"></div>
        </div>
        <aside class="rh-opt-rail" id="rhOptRail" hidden aria-label="Initial UI actions">
          <div class="rh-opt-drag" id="rhOptDrag" title="Drag to move">
            <span></span><span></span>
          </div>
          <div class="rh-opt-status" aria-live="polite">
            <span class="rh-opt-dot" id="rhOptWebsiteDot" title="Website"></span>
            <span class="rh-opt-dot" id="rhOptDriveDot" title="Google Drive"></span>
            <span class="rh-opt-dot" id="rhOptJson2docxDot" title="Json2Docx"></span>
          </div>
          <div class="rh-opt-progress" id="rhOptProgress" hidden aria-live="polite">
            <span class="rh-opt-progress-count" id="rhOptProgressCount">0/5</span>
            <span class="rh-opt-progress-bar" aria-hidden="true">
              <span class="rh-opt-progress-fill" id="rhOptProgressFill"></span>
            </span>
          </div>
          <div class="rh-opt-actions" role="toolbar" aria-label="Resume workflow">
            <button type="button" class="rh-opt-btn" data-opt-action="pasteJd" title="Job Description (paste / edit)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M14 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>
              </svg>
            </button>
            <button type="button" class="rh-opt-btn is-primary" data-opt-action="buildCopyPrompt" title="Build &amp; Copy Prompt">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><path d="M12 12v4M10 14h4"/>
              </svg>
            </button>
            <button type="button" class="rh-opt-btn" data-opt-action="pasteResumeJson" title="Resume JSON (paste / edit)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8 4c-2 0-3 1.5-3 4v2c0 1-.5 2-2 2 1.5 0 2 1 2 2v2c0 2.5 1 4 3 4"/><path d="M16 4c2 0 3 1.5 3 4v2c0 1 .5 2 2 2-1.5 0-2 1-2 2v2c0 2.5-1 4-3 4"/>
              </svg>
            </button>
            <button type="button" class="rh-opt-btn is-primary" data-opt-action="generateFiles" title="Generate Files">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15l3 3 3-3"/>
              </svg>
            </button>
            <button type="button" class="rh-opt-btn is-primary" data-opt-action="register" title="Register">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </button>
            <button type="button" class="rh-opt-btn is-primary" data-opt-action="autofill" title="Autofill" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3l1.8 4.6L18.5 9.5l-3.7 2.9.9 4.8L12 14.9 8.3 17.2l.9-4.8L5.5 9.5l4.7-1.9L12 3z"/>
              </svg>
            </button>
          </div>
          <button type="button" class="rh-opt-btn" data-opt-action="expand" title="Return to side panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        </aside>
        <div class="rh-page-toast" id="rhPageToast" hidden aria-live="polite"></div>
        <div class="rh-text-dlg" id="rhTextDlg" hidden>
          <div class="rh-text-dlg-card" role="dialog" aria-modal="true" aria-labelledby="rhTextDlgTitle">
            <h3 id="rhTextDlgTitle">Edit</h3>
            <textarea id="rhTextDlgInput" spellcheck="false"></textarea>
            <div class="rh-text-dlg-actions">
              <button type="button" class="rh-text-dlg-cancel" id="rhTextDlgCancel">Cancel</button>
              <button type="button" class="rh-text-dlg-apply" id="rhTextDlgApply">Apply</button>
            </div>
          </div>
        </div>
      </div>
    `;

    panelEl = shadow.getElementById('rhPanel');
    iframeEl = shadow.getElementById('rhFrame');
    if (iframeEl && iframeEl.dataset.optSyncWired !== '1') {
      iframeEl.dataset.optSyncWired = '1';
      iframeEl.addEventListener('load', () => {
        scheduleOptUiStateSync();
      });
    }
    optRailEl = shadow.getElementById('rhOptRail');
    pageToastEl = shadow.getElementById('rhPageToast');
    textDlgEl = shadow.getElementById('rhTextDlg');
    textDlgTitleEl = shadow.getElementById('rhTextDlgTitle');
    textDlgInputEl = shadow.getElementById('rhTextDlgInput');
    const header = shadow.getElementById('rhHeader');
    const closeBtn = shadow.getElementById('rhClose');
    themeBtn = shadow.getElementById('rhTheme');
    const resizeHandle = shadow.getElementById('rhResize');
    const optDrag = shadow.getElementById('rhOptDrag');
    const textDlgCancel = shadow.getElementById('rhTextDlgCancel');
    const textDlgApply = shadow.getElementById('rhTextDlgApply');

    wireOptRailInteractions(optDrag);
    if (textDlgCancel) {
      textDlgCancel.addEventListener('click', (e) => {
        e.preventDefault();
        closeTextDialog();
      });
    }
    if (textDlgApply) {
      textDlgApply.addEventListener('click', (e) => {
        e.preventDefault();
        applyTextDialog();
      });
    }
    if (textDlgEl) {
      textDlgEl.addEventListener('click', (e) => {
        if (e.target === textDlgEl) closeTextDialog();
      });
    }

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
        if (button.dataset.mode === 'panel') {
          void openPinnedPanelFromOverlay();
          return;
        }
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
      if (optRailEl && !optRailEl.hidden && optRailGeom) {
        applyOptRailGeom(optRailGeom);
      }
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

  function defaultOptRailGeom() {
    return {
      left: Math.max(8, window.innerWidth - OPT_RAIL_WIDTH - 20),
      top: Math.max(8, Math.round((window.innerHeight - OPT_RAIL_HEIGHT) / 2))
    };
  }

  function loadOptRailGeom() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([OPT_RAIL_KEY], (result) => {
          const saved = result?.[OPT_RAIL_KEY];
          if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
            resolve(saved);
            return;
          }
          resolve(defaultOptRailGeom());
        });
      } catch (_) {
        resolve(defaultOptRailGeom());
      }
    });
  }

  function saveOptRailGeom(geom) {
    try {
      chrome.storage.local.set({ [OPT_RAIL_KEY]: { left: geom.left, top: geom.top } });
    } catch (_) {
      /* ignore */
    }
  }

  function applyOptRailGeom(geom) {
    if (!optRailEl || !geom) return null;
    const width = OPT_RAIL_WIDTH;
    const height = Math.min(OPT_RAIL_HEIGHT, Math.max(280, optRailEl.offsetHeight || OPT_RAIL_HEIGHT));
    const left = clamp(geom.left ?? 8, 0, Math.max(0, window.innerWidth - width));
    const top = clamp(geom.top ?? 8, 0, Math.max(0, window.innerHeight - height));
    optRailEl.style.left = `${left}px`;
    optRailEl.style.top = `${top}px`;
    optRailGeom = { left, top };
    return optRailGeom;
  }

  function scheduleOptUiStateSync() {
    const sync = () => postToSidepanel({ action: 'requestOptUiState' });
    sync();
    setTimeout(sync, 400);
    setTimeout(sync, 1200);
  }

  /** Bottom-right toast on the host page (not inside the extension panel). */
  function showPageToast(message, type = 'info', timeout = 4200) {
    if (!pageToastEl) return;
    const text = String(message || '').trim();
    if (!text) return;
    if (pageToastTimer) {
      clearTimeout(pageToastTimer);
      pageToastTimer = null;
    }
    pageToastEl.textContent = text;
    pageToastEl.className = 'rh-page-toast';
    if (type === 'success' || type === 'error' || type === 'warn') {
      pageToastEl.classList.add(`is-${type}`);
    }
    pageToastEl.hidden = false;
    pageToastEl.style.left = '';
    pageToastEl.style.top = '';

    requestAnimationFrame(() => pageToastEl.classList.add('is-visible'));
    if (timeout > 0) {
      pageToastTimer = setTimeout(() => {
        pageToastEl.classList.remove('is-visible');
        setTimeout(() => {
          if (pageToastEl) pageToastEl.hidden = true;
        }, 200);
        pageToastTimer = null;
      }, timeout);
    }
  }

  function showOptRailToast(message, type = 'info', timeout = 4200) {
    showPageToast(message, type, timeout);
  }

  function postToSidepanel(payload) {
    const send = () => {
      if (!iframeEl?.contentWindow || !iframeEl.getAttribute('src')) return false;
      try {
        iframeEl.contentWindow.postMessage(
          { source: 'remote-helper-assistant', ...payload },
          '*'
        );
        return true;
      } catch (_) {
        return false;
      }
    };
    if (send()) return;
    setTimeout(() => send(), 150);
    setTimeout(() => send(), 650);
    try {
      chrome.runtime.sendMessage({ ...payload }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      /* ignore */
    }
  }

  function closeTextDialog() {
    textDlgKind = null;
    if (textDlgEl) {
      textDlgEl.hidden = true;
      textDlgEl.classList.remove('is-open');
    }
  }

  function requestSidepanelField(field) {
    return new Promise((resolve) => {
      const id = `fld_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const onMsg = (event) => {
        const data = event.data;
        if (!data || data.source !== 'remote-helper-sidepanel') return;
        if (data.action !== 'optFieldValue' || data.id !== id) return;
        window.removeEventListener('message', onMsg);
        resolve(String(data.value || ''));
      };
      window.addEventListener('message', onMsg);
      postToSidepanel({ action: 'optGetField', field, id });
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve('');
      }, 1200);
    });
  }

  async function openTextDialog(kind) {
    ensureHost();
    textDlgKind = kind === 'resumeJson' ? 'resumeJson' : 'jd';
    if (textDlgTitleEl) {
      textDlgTitleEl.textContent =
        textDlgKind === 'resumeJson' ? 'Built Resume JSON' : 'Job Description';
    }
    if (textDlgInputEl) {
      textDlgInputEl.value = '';
      textDlgInputEl.placeholder =
        textDlgKind === 'resumeJson'
          ? 'Paste built resume JSON here…'
          : 'Paste or edit the job description here…';
    }
    if (textDlgEl) {
      textDlgEl.hidden = false;
      textDlgEl.classList.add('is-open');
    }
    const field = textDlgKind === 'resumeJson' ? 'resumeJson' : 'note';
    const existing = await requestSidepanelField(field);
    if (textDlgInputEl && existing) textDlgInputEl.value = existing;
    textDlgInputEl?.focus();
  }

  function applyTextDialog() {
    const text = String(textDlgInputEl?.value || '');
    const kind = textDlgKind;
    closeTextDialog();
    if (kind === 'resumeJson') {
      lastOptAction = 'pasteResumeJson';
      postToSidepanel({ action: 'optApplyResumeJson', text });
      return;
    }
    if (kind === 'jd') {
      lastOptAction = 'pasteJd';
      postToSidepanel({ action: 'optApplyJd', text });
    }
  }

  function wireOptRailInteractions(optDrag) {
    if (!optRailEl || optRailEl.dataset.wired === '1') return;
    optRailEl.dataset.wired = '1';

    optRailEl.querySelectorAll('[data-opt-action]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = button.getAttribute('data-opt-action');
        if (action && action !== 'expand') lastOptAction = action;
        if (action === 'expand') {
          closeTextDialog();
          void setOptimizedUi(false);
          return;
        }
        if (action === 'pasteJd') {
          void openTextDialog('jd');
          return;
        }
        if (action === 'pasteResumeJson') {
          void openTextDialog('resumeJson');
          return;
        }
        postToSidepanel({ action: 'optRunAction', name: action });
      });
    });

    if (optDrag) {
      optDrag.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const left = parseFloat(optRailEl.style.left) || 0;
        const top = parseFloat(optRailEl.style.top) || 0;
        optDragState = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originLeft: left,
          originTop: top
        };
        optDrag.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      optDrag.addEventListener('pointermove', (e) => {
        if (!optDragState || optDragState.pointerId !== e.pointerId) return;
        applyOptRailGeom({
          left: optDragState.originLeft + (e.clientX - optDragState.startX),
          top: optDragState.originTop + (e.clientY - optDragState.startY)
        });
      });
      const endOptDrag = (e) => {
        if (!optDragState || optDragState.pointerId !== e.pointerId) return;
        optDragState = null;
        if (optRailGeom) saveOptRailGeom(optRailGeom);
      };
      optDrag.addEventListener('pointerup', endOptDrag);
      optDrag.addEventListener('pointercancel', endOptDrag);
    }
  }

  function applyOptUiState(state) {
    if (!optRailEl || !state) return;
    const buttons = state.buttons || {};
    optRailEl.querySelectorAll('[data-opt-action]').forEach((button) => {
      const key = button.getAttribute('data-opt-action');
      if (!key || key === 'expand' || key === 'pasteJd' || key === 'pasteResumeJson') return;
      const info = buttons[key];
      if (!info) return;
      button.disabled = Boolean(info.disabled);
      if (info.title) button.title = info.title;
      button.classList.toggle('is-loading', Boolean(info.loading));
      let spin = button.querySelector('.rh-opt-spin');
      if (info.loading) {
        if (!spin) {
          spin = document.createElement('span');
          spin.className = 'rh-opt-spin';
          spin.setAttribute('aria-hidden', 'true');
          button.appendChild(spin);
        }
      } else if (spin) {
        spin.remove();
      }
    });
    const dots = state.dots || {};
    const map = [
      ['website', 'rhOptWebsiteDot'],
      ['drive', 'rhOptDriveDot'],
      ['json2docx', 'rhOptJson2docxDot']
    ];
    map.forEach(([key, id]) => {
      const el = shadow?.getElementById(id);
      const info = dots[key];
      if (!el || !info) return;
      el.className = `rh-opt-dot ${info.className || ''}`.trim();
      if (info.title) el.title = info.title;
    });
    applyOptProgress(state.progress);
  }

  /** Rail step keys mirror the side panel's apply tracker. */
  const OPT_STEP_ACTIONS = {
    job: 'pasteJd',
    prompt: 'buildCopyPrompt',
    json: 'pasteResumeJson',
    files: 'generateFiles',
    register: 'register'
  };

  function applyOptProgress(progress) {
    const wrap = shadow?.getElementById('rhOptProgress');
    if (!wrap) return;
    if (!progress || !Array.isArray(progress.steps) || !progress.steps.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;

    const count = shadow.getElementById('rhOptProgressCount');
    if (count) count.textContent = `${progress.doneCount}/${progress.total}`;
    const fill = shadow.getElementById('rhOptProgressFill');
    if (fill) {
      const pct = progress.total ? (progress.doneCount / progress.total) * 100 : 0;
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }

    const current = progress.steps[progress.currentIndex];
    wrap.title = progress.complete
      ? 'Registered'
      : `Step ${progress.currentIndex + 1} of ${progress.total}: ${current?.label || ''}${
          current?.reason ? ` — ${current.reason}` : ''
        }`;

    progress.steps.forEach((step) => {
      const action = OPT_STEP_ACTIONS[step.key];
      const button = action ? optRailEl.querySelector(`[data-opt-action="${action}"]`) : null;
      if (!button) return;
      button.classList.toggle('is-done-step', step.state === 'done');
      button.classList.toggle(
        'is-current-step',
        step.state === 'current' || step.state === 'active'
      );
      button.classList.toggle('is-blocked-step', step.state === 'blocked' || step.state === 'warn');
      if (step.reason) button.title = `${step.number}. ${step.label} — ${step.reason}`;
    });
  }

  function setDisplay(el, value) {
    if (!el) return;
    if (value == null || value === '') {
      el.style.removeProperty('display');
      return;
    }
    el.style.setProperty('display', value, 'important');
  }

  /** Expanded mode: full dialog only. Initial rail must never share the screen. */
  function showFullPanelOnly() {
    hideOptRailHard();
    if (panelEl) {
      panelEl.hidden = false;
      panelEl.classList.remove('is-optimized');
      setDisplay(panelEl, 'flex');
    }
    optimizedUi = false;
  }

  /** Initial mode: floating rail only. Expanded full UI must be gone. */
  function showOptRailOnly() {
    if (panelEl) {
      panelEl.hidden = true;
      panelEl.classList.remove('is-optimized');
      setDisplay(panelEl, 'none');
    }
    if (optRailEl) {
      optRailEl.hidden = false;
      optRailEl.classList.add('is-visible');
      setDisplay(optRailEl, 'flex');
    }
    optimizedUi = true;
  }

  function hideOptRailHard() {
    if (optRailEl) {
      optRailEl.hidden = true;
      optRailEl.classList.remove('is-visible');
      setDisplay(optRailEl, 'none');
    }
    // Kill any leftover rails from older overlay hosts on this page.
    try {
      document.querySelectorAll('#remote-helper-assistant-host, [data-remote-helper="assistant"]').forEach((host) => {
        const root = host.shadowRoot;
        if (!root) return;
        root.querySelectorAll('.rh-opt-rail, #rhOptRail').forEach((rail) => {
          rail.hidden = true;
          rail.classList.remove('is-visible');
          rail.style.setProperty('display', 'none', 'important');
        });
      });
    } catch (_) {
      /* ignore */
    }
  }

  function loadExpandedHost() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([EXPANDED_HOST_KEY], (result) => {
          const host = result?.[EXPANDED_HOST_KEY];
          cachedExpandedHost = host === 'overlay' ? 'overlay' : 'panel';
          resolve(cachedExpandedHost);
        });
      } catch (_) {
        cachedExpandedHost = 'panel';
        resolve('panel');
      }
    });
  }

  function openSidePanelSync() {
    try {
      chrome.runtime.sendMessage({ action: 'openSidePanel' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      /* ignore */
    }
  }

  async function returnToExpandedUi({ skipPanelOpen = false } = {}) {
    const host = await loadExpandedHost();
    hideOptRailHard();
    optimizedUi = false;
    optRailOnly = false;

    if (host === 'panel') {
      // Side panel workflow: never restore movable overlay — reopen pinned panel.
      if (panelEl) {
        panelEl.hidden = true;
        setDisplay(panelEl, 'none');
      }
      notifyDialogOpenState(true);
      if (!skipPanelOpen) {
        openSidePanelSync();
      }
      return;
    }

    showFullPanelOnly();
    if (!floatingGeom) floatingGeom = await loadGeom();
    const source =
      currentMode === 'movable'
        ? floatingGeom
        : { ...floatingGeom, width: dockWidth, height: window.innerHeight };
    applyGeom(source, currentMode);
    notifyDialogOpenState(true);
  }

  async function setOptimizedUi(enabled, { railOnly = false } = {}) {
    ensureHost();
    const on = Boolean(enabled);

    if (on) {
      optimizedUi = true;
      // Initial rail keeps a hidden dialog iframe as logic host while side panel is closed.
      optRailOnly = false;
      void loadExpandedHost();
      const url = chrome.runtime.getURL('sidepanel.html?dialog=1');
      if (iframeEl && iframeEl.getAttribute('src') !== url) {
        iframeEl.setAttribute('src', url);
      }
      if (!optRailGeom) optRailGeom = await loadOptRailGeom();
      applyOptRailGeom(optRailGeom);
      applyOverlayTheme(currentTheme);
      showOptRailOnly();
      notifyDialogOpenState(true);
      try {
        chrome.runtime.sendMessage({ action: 'closeSidePanelForActiveTab' }, () => {
          void chrome.runtime.lastError;
        });
      } catch (_) {
        /* ignore */
      }
      scheduleOptUiStateSync();
    } else {
      closeTextDialog();
      try {
        chrome.storage.local.set({ [OPTIMIZED_UI_KEY]: false });
      } catch (_) {
        /* ignore */
      }
      const useSidePanel = cachedExpandedHost !== 'overlay';
      if (useSidePanel) {
        openSidePanelSync();
      }
      postToSidepanel({
        action: 'setOptimizedUiMode',
        enabled: false,
        skipNotifyParent: true
      });
      await returnToExpandedUi({ skipPanelOpen: useSidePanel });
    }
    return { success: true, optimized: on };
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

    // Opening the assistant is always Initial mode unless Optimized is requested
    // separately. Never leave the expandable rail on screen beside the full UI.
    optRailOnly = false;
    optimizedUi = false;
    showFullPanelOnly();
    notifyDialogOpenState(true);
    postToSidepanel({ action: 'setOptimizedUiMode', enabled: false });
    return { success: true };
  }

  function hideAssistantDialog() {
    closeTextDialog();
    if (panelEl) {
      panelEl.hidden = true;
      setDisplay(panelEl, 'none');
    }
    hideOptRailHard();
    optimizedUi = false;
    optRailOnly = false;
    notifyDialogOpenState(false);
    return { success: true };
  }

  function toggleAssistantDialog() {
    ensureHost();
    if (isAssistantDialogOpen()) return hideAssistantDialog();
    return showAssistantDialog();
  }

  function isAssistantDialogOpen() {
    const panelOpen = Boolean(panelEl && !panelEl.hidden);
    const railOpen = Boolean(optRailEl && !optRailEl.hidden);
    return panelOpen || railOpen;
  }

  async function copyTextOnHostPage(text) {
    const value = String(text ?? '');
    if (!value.trim()) throw new Error('Nothing to copy.');
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText =
      'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;' +
      'box-shadow:none;background:transparent;opacity:0;';
    const mount = document.body || document.documentElement;
    mount.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_) {
      copied = false;
    } finally {
      textarea.remove();
    }
    if (copied) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch (_) {
      /* fall through */
    }
    throw new Error('Copy failed.');
  }

  async function readTextFromHostPage() {
    try {
      if (navigator.clipboard?.readText) {
        return String(await navigator.clipboard.readText());
      }
    } catch (_) {
      /* fall through */
    }
    throw new Error('Clipboard read is blocked on this page. Paste into the full UI instead.');
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'remote-helper-sidepanel') return;
    if (iframeEl && event.source && event.source !== iframeEl.contentWindow) return;

    if (data.action === 'copyText') {
      const reply = (ok, error) => {
        try {
          iframeEl?.contentWindow?.postMessage(
            {
              source: 'remote-helper-assistant',
              action: 'copyTextResult',
              id: data.id,
              ok,
              error: error || null
            },
            '*'
          );
        } catch (_) {
          /* ignore */
        }
      };
      copyTextOnHostPage(data.text)
        .then(() => reply(true))
        .catch((err) => reply(false, err?.message || 'Copy failed.'));
      return;
    }

    if (data.action === 'pasteText') {
      const reply = (ok, text, error) => {
        try {
          iframeEl?.contentWindow?.postMessage(
            {
              source: 'remote-helper-assistant',
              action: 'pasteTextResult',
              id: data.id,
              ok,
              text: text || '',
              error: error || null
            },
            '*'
          );
        } catch (_) {
          /* ignore */
        }
      };
      readTextFromHostPage()
        .then((text) => reply(true, text))
        .catch((err) => reply(false, '', err?.message || 'Paste failed.'));
      return;
    }

    if (data.action === 'setOptimizedUi') {
      void setOptimizedUi(Boolean(data.enabled), { railOnly: Boolean(data.railOnly) });
      return;
    }

    if (data.action === 'optUiState') {
      applyOptUiState(data.state);
      return;
    }

    if (data.action === 'optActionFeedback') {
      const toastType =
        data.type === 'error'
          ? 'error'
          : data.type === 'warn'
            ? 'warn'
            : data.type === 'success'
              ? 'success'
              : 'info';
      if (data.actionName) lastOptAction = String(data.actionName);
      showPageToast(data.message || '', toastType, Number(data.timeout) || 4200);
      return;
    }
  });

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
      sendResponse({
        success: true,
        open: isAssistantDialogOpen(),
        mode: currentMode,
        optimized: optimizedUi
      });
      return true;
    }

    if (request.action === 'setOptimizedUiRail') {
      setOptimizedUi(Boolean(request.enabled), { railOnly: request.railOnly !== false })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
      return true;
    }

    if (request.action === 'optUiState') {
      applyOptUiState(request.state);
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'showPageToast') {
      showPageToast(request.message, request.type, Number(request.timeout) || 4200);
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'copyTextOnHost') {
      copyTextOnHostPage(request.text)
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({ success: false, error: error?.message || String(error) })
        );
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
