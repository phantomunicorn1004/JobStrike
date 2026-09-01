/**
 * Per-tab session store for the side panel.
 *
 * The side panel is a single document shared by every tab, so per-tab state is
 * swapped in and out around tab changes rather than being scoped by the browser.
 *
 * A session is pinned to the URL it was bound to. Navigating the tab somewhere
 * else never touches it; only the header Refresh re-binds a tab to a new page.
 *
 * Modules contribute "slices" (capture/restore pairs) instead of this module
 * reaching into their internals.
 */
(function (global) {
  const STORE_KEY = 'rwh_tab_sessions_v1';
  const MAX_SESSIONS = 20;
  const PERSIST_DEBOUNCE_MS = 300;
  const SYNC_DEBOUNCE_MS = 250;

  // The hidden dialog iframe runs this same document. Only the real side panel
  // owns the persisted copy, so the two contexts cannot clobber each other.
  const IS_DIALOG_CONTEXT =
    typeof document !== 'undefined' &&
    (document.documentElement.classList.contains('assistant-dialog') ||
      /[?&]dialog=1(?:&|$)/.test(location.search || ''));

  /** @type {Map<number, object>} tabId -> session */
  const sessions = new Map();
  /** @type {Map<string, {capture:Function, restore:Function, toPersist?:Function, hasWork?:Function}>} */
  const slices = new Map();

  let boundTabId = null;
  let generation = 0;
  let persistTimer = null;
  let syncTimer = null;
  let hydrated = false;

  function normalizeUrlKey(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      const path = parsed.pathname.replace(/\/+$/, '');
      return `${parsed.origin}${path}`.toLowerCase();
    } catch (_) {
      return raw.toLowerCase();
    }
  }

  function isWebUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function blankSession(tabId) {
    return {
      tabId: Number(tabId),
      boundUrl: '',
      boundUrlKey: '',
      boundAt: 0,
      updatedAt: 0,
      lastActiveAt: 0,
      slices: {}
    };
  }

  function getSession(tabId) {
    const id = Number(tabId);
    return Number.isFinite(id) ? sessions.get(id) || null : null;
  }

  function hasSession(tabId) {
    return Boolean(getSession(tabId));
  }

  function ensureSession(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id) || id <= 0) return null;
    let session = sessions.get(id);
    if (!session) {
      session = blankSession(id);
      sessions.set(id, session);
    }
    return session;
  }

  function registerSlice(name, slice) {
    if (!name || typeof slice?.capture !== 'function' || typeof slice?.restore !== 'function') return;
    slices.set(name, slice);
  }

  function captureInto(session) {
    if (!session) return;
    slices.forEach((slice, name) => {
      try {
        session.slices[name] = slice.capture();
      } catch (_) {
        /* a failing slice must not block the others */
      }
    });
    session.updatedAt = Date.now();
  }

  function restoreFrom(session) {
    slices.forEach((slice, name) => {
      try {
        slice.restore(session ? session.slices[name] || null : null, session || null);
      } catch (_) {
        /* a failing slice must not block the others */
      }
    });
  }

  function evictStaleSessions() {
    if (sessions.size <= MAX_SESSIONS) return;
    const candidates = Array.from(sessions.values())
      .filter((s) => s.tabId !== boundTabId)
      .sort((a, b) => (a.lastActiveAt || a.updatedAt || 0) - (b.lastActiveAt || b.updatedAt || 0));
    while (sessions.size > MAX_SESSIONS && candidates.length) {
      sessions.delete(candidates.shift().tabId);
    }
  }

  /* ---------------------------------------------------------------- storage */

  function sessionStorage() {
    try {
      return chrome?.storage?.session || null;
    } catch (_) {
      return null;
    }
  }

  function toPersistable() {
    const out = {};
    sessions.forEach((session, tabId) => {
      const data = {};
      slices.forEach((slice, name) => {
        const raw = session.slices[name];
        if (raw == null) return;
        let value = raw;
        if (typeof slice.toPersist === 'function') {
          try {
            value = slice.toPersist(raw);
          } catch (_) {
            value = null;
          }
        }
        if (value != null) data[name] = value;
      });
      out[String(tabId)] = {
        tabId: session.tabId,
        boundUrl: session.boundUrl,
        boundUrlKey: session.boundUrlKey,
        boundAt: session.boundAt,
        updatedAt: session.updatedAt,
        lastActiveAt: session.lastActiveAt,
        slices: data
      };
    });
    return out;
  }

  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (IS_DIALOG_CONTEXT) return;
    const store = sessionStorage();
    if (!store) return;
    try {
      store.set({ [STORE_KEY]: toPersistable() });
    } catch (_) {
      /* quota or serialization issue: in-memory state is still correct */
    }
  }

  function schedulePersist() {
    if (IS_DIALOG_CONTEXT) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
  }

  function pruneClosedTabs() {
    try {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) return;
        const live = new Set((tabs || []).map((t) => Number(t.id)));
        let removed = false;
        Array.from(sessions.keys()).forEach((id) => {
          if (!live.has(id)) {
            sessions.delete(id);
            removed = true;
          }
        });
        if (removed) schedulePersist();
      });
    } catch (_) {
      /* ignore */
    }
  }

  function hydrate() {
    if (hydrated) return Promise.resolve(false);
    hydrated = true;
    const store = sessionStorage();
    if (!store) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        store.get([STORE_KEY], (result) => {
          const saved = result?.[STORE_KEY];
          if (saved && typeof saved === 'object') {
            Object.values(saved).forEach((entry) => {
              const id = Number(entry?.tabId);
              if (!Number.isFinite(id) || id <= 0) return;
              // Live in-memory state always wins over the persisted copy.
              if (sessions.has(id)) return;
              sessions.set(id, {
                ...blankSession(id),
                ...entry,
                slices: entry.slices || {}
              });
            });
            pruneClosedTabs();
          }
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  /* -------------------------------------------------------------- lifecycle */

  function captureFor(tabId) {
    const session = getSession(tabId);
    if (!session) return null;
    captureInto(session);
    schedulePersist();
    return session;
  }

  function captureActive() {
    return captureFor(boundTabId);
  }

  /** Debounced capture from live handlers (typing, attaching files, …). */
  function sync() {
    if (syncTimer) clearTimeout(syncTimer);
    const tabId = boundTabId;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      captureFor(tabId);
    }, SYNC_DEBOUNCE_MS);
  }

  function syncNow() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    captureActive();
    persistNow();
  }

  function restore(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id) || id <= 0) return null;
    generation += 1;
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    const session = ensureSession(id);
    boundTabId = id;
    session.lastActiveAt = Date.now();
    restoreFrom(session);
    evictStaleSessions();
    schedulePersist();
    return session;
  }

  /** Save the outgoing tab, then load the incoming one. */
  function switchTo(previousTabId, nextTabId) {
    const prev = Number.isFinite(Number(previousTabId)) ? Number(previousTabId) : boundTabId;
    if (prev && prev !== Number(nextTabId)) captureFor(prev);
    return restore(nextTabId);
  }

  /** Pin a session to a page. Called on first bind and on Refresh. */
  function bindUrl(tabId, url) {
    const session = ensureSession(tabId);
    if (!session) return null;
    session.boundUrl = String(url || '');
    session.boundUrlKey = normalizeUrlKey(url);
    session.boundAt = Date.now();
    session.updatedAt = Date.now();
    schedulePersist();
    return session;
  }

  function getBoundUrl(tabId) {
    return getSession(tabId)?.boundUrl || '';
  }

  /** True when the tab has navigated away from the page its session is pinned to. */
  function isPinnedElsewhere(tabId, currentUrl) {
    const session = getSession(tabId);
    if (!session?.boundUrlKey || !isWebUrl(currentUrl)) return false;
    return session.boundUrlKey !== normalizeUrlKey(currentUrl);
  }

  /** True when a session holds work that a reset would discard. */
  function hasWork(tabId) {
    const session = getSession(tabId);
    if (!session) return false;
    let found = false;
    slices.forEach((slice, name) => {
      if (found || typeof slice.hasWork !== 'function') return;
      try {
        if (slice.hasWork(session.slices[name] || null)) found = true;
      } catch (_) {
        /* ignore */
      }
    });
    return found;
  }

  /** Wipe a tab's state back to empty, keeping the tab bound. */
  function resetSession(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id) || id <= 0) return null;
    generation += 1;
    const session = blankSession(id);
    sessions.set(id, session);
    if (boundTabId === id) {
      boundTabId = id;
      session.lastActiveAt = Date.now();
      restoreFrom(session);
    }
    schedulePersist();
    return session;
  }

  function dropSession(tabId) {
    const id = Number(tabId);
    if (!sessions.delete(id)) return;
    if (boundTabId === id) boundTabId = null;
    schedulePersist();
  }

  function watchTabRemoval() {
    try {
      chrome.tabs.onRemoved.addListener((tabId) => dropSession(tabId));
    } catch (_) {
      /* ignore */
    }
  }

  watchTabRemoval();

  global.SmartJobTabSession = {
    registerSlice,
    hydrate,
    getSession,
    hasSession,
    getBoundTabId: () => boundTabId,
    getGeneration: () => generation,
    isCurrentGeneration: (token) => token === generation,
    captureActive,
    sync,
    syncNow,
    restore,
    switchTo,
    bindUrl,
    getBoundUrl,
    isPinnedElsewhere,
    normalizeUrlKey,
    hasWork,
    resetSession,
    dropSession,
    IS_DIALOG_CONTEXT
  };
})(typeof window !== 'undefined' ? window : self);
