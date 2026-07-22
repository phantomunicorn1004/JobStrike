/**
 * Movable Job Assistant dialog shell injected on the page.
 * Hosts sidepanel.html?dialog=1 in an iframe; drag chrome lives in the shadow root.
 */
(function () {
  if (window.__remoteHelperAssistantOverlay) return;
  window.__remoteHelperAssistantOverlay = true;

  const HOST_ID = 'remote-helper-assistant-host';
  const STORAGE_KEY = 'assistant_dialog_geom';
  const DEFAULT_WIDTH = 380;
  const DEFAULT_HEIGHT = 560;
  const MIN_WIDTH = 320;
  const MIN_HEIGHT = 420;

  let hostEl = null;
  let shadow = null;
  let panelEl = null;
  let iframeEl = null;
  let dragState = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultGeom() {
    const width = DEFAULT_WIDTH;
    const height = DEFAULT_HEIGHT;
    const left = Math.max(12, window.innerWidth - width - 24);
    const top = Math.max(12, Math.round((window.innerHeight - height) / 2));
    return { left, top, width, height };
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

  function applyGeom(geom) {
    if (!panelEl || !geom) return;
    const width = clamp(geom.width || DEFAULT_WIDTH, MIN_WIDTH, window.innerWidth - 16);
    const height = clamp(geom.height || DEFAULT_HEIGHT, MIN_HEIGHT, window.innerHeight - 16);
    const left = clamp(geom.left ?? 12, 0, Math.max(0, window.innerWidth - width));
    const top = clamp(geom.top ?? 12, 0, Math.max(0, window.innerHeight - height));
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
        .rh-panel[hidden] { display: none !important; }
        .rh-header {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          height: 40px;
          padding: 0 8px 0 12px;
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
        .rh-close {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }
        .rh-close:hover { background: rgba(148, 163, 184, 0.2); }
        .rh-frame {
          flex: 1;
          min-height: 0;
          width: 100%;
          border: 0;
          background: #fff;
        }
      </style>
      <div class="rh-root">
        <div class="rh-panel" id="rhPanel" hidden>
          <div class="rh-header" id="rhHeader" title="Drag to move">
            <div class="rh-title">Job Assistant</div>
            <button type="button" class="rh-close" id="rhClose" aria-label="Close">×</button>
          </div>
          <iframe class="rh-frame" id="rhFrame" title="Job Assistant"></iframe>
        </div>
      </div>
    `;

    panelEl = shadow.getElementById('rhPanel');
    iframeEl = shadow.getElementById('rhFrame');
    const header = shadow.getElementById('rhHeader');
    const closeBtn = shadow.getElementById('rhClose');

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideAssistantDialog();
    });

    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.rh-close')) return;
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
      if (next) saveGeom(next);
    });

    const endDrag = (e) => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      dragState = null;
      saveGeom(readCurrentGeom());
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    window.addEventListener('resize', () => {
      if (!panelEl || panelEl.hidden) return;
      const next = applyGeom(readCurrentGeom());
      if (next) saveGeom(next);
    });

    return hostEl;
  }

  async function showAssistantDialog() {
    ensureHost();
    const geom = applyGeom(await loadGeom());
    if (geom) saveGeom(geom);

    const url = chrome.runtime.getURL('sidepanel.html?dialog=1');
    if (iframeEl && iframeEl.getAttribute('src') !== url) {
      iframeEl.setAttribute('src', url);
    }

    panelEl.hidden = false;
    return { success: true };
  }

  function hideAssistantDialog() {
    if (panelEl) panelEl.hidden = true;
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
      showAssistantDialog()
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
      sendResponse({ success: true, open: isAssistantDialogOpen() });
      return true;
    }

    return false;
  });
})();
