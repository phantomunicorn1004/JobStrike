importScripts("autogen-json-extract.js");
importScripts("autogen-api.js");

const HEARTBEAT_ALARM = "autogen-heartbeat";
const MAX_ACTIVITY_LOG_LINES = 500;
const CHATGPT_POLL_INTERVAL_MS = 3000;
// While the selected-run queue still has work, windows recheck quickly instead of
// waiting a full fetch period, so a selection drains as fast as ChatGPT allows.
const QUEUE_DRAIN_DELAY_MS = 500;

// The explicit select-and-run queue (Tab 2). Held in memory for race-free
// synchronous splicing inside the single-threaded service worker, and mirrored to
// chrome.storage.local so it survives eviction and drives the panel's progress UI.
// `selectedQueue` holds not-yet-claimed application ids; `queueStatus` maps every
// id the user has run to its lifecycle state for the Applications tab.
let selectedQueue = [];
let queueStatus = {}; // id -> { status, windowId, error, updatedAt }
let queueStateLoaded = false;

// Each window that has clicked "Run selected"/"Run in background" in its own
// side panel is an independent worker: its own setTimeout-based tick chain,
// scoped to whatever ChatGPT tab is currently active IN THAT WINDOW (never a
// tab this extension created/pinned itself - the user chose it). The backend's
// next-application endpoint claims rows under a row lock, so two windows can
// never be handed the same application.
let windowWorkers = {}; // windowId -> { running, busy, stopSeq, stopWaiters, tickTimer, claimFailureStreak }

// Successful generations since each window's ChatGPT thread was last reset.
// Persisted so it survives an MV3 service-worker eviction/restart.
let windowGenerationCounts = {}; // windowId -> count
let windowGenerationCountsLoaded = false;

async function loadWindowGenerationCounts() {
  if (windowGenerationCountsLoaded) return;
  const data = await chrome.storage.local.get({ autogenWindowGenerationCounts: {} });
  windowGenerationCounts =
    data.autogenWindowGenerationCounts && typeof data.autogenWindowGenerationCounts === "object"
      ? data.autogenWindowGenerationCounts
      : {};
  windowGenerationCountsLoaded = true;
}

async function persistWindowGenerationCounts() {
  await chrome.storage.local.set({ autogenWindowGenerationCounts: { ...windowGenerationCounts } });
}

/** Bumps a window's successful-generation count. When Settings say so, opens a
 * fresh temporary chat after threadResetAfter successes. */
async function autogenBumpWindowGenerationCount(windowId, tabId) {
  const settings = await autogenGetSettings();
  if (settings.threadResetMode !== "temporary") return;
  await loadWindowGenerationCounts();
  windowGenerationCounts[windowId] = (windowGenerationCounts[windowId] || 0) + 1;
  await persistWindowGenerationCounts();
  if (windowGenerationCounts[windowId] >= settings.threadResetAfter) {
    windowGenerationCounts[windowId] = 0;
    await persistWindowGenerationCounts();
    await resetWindowChatGptThread(windowId, tabId, settings.threadResetAfter);
  }
}

/** Navigates a window's currently-claimed tab to a brand-new temporary chat. */
async function resetWindowChatGptThread(windowId, tabId, afterCount) {
  if (tabId == null) return;
  await appendActivityLog(
    windowId,
    null,
    `${afterCount} resumes generated in this thread - starting a fresh temporary chat`,
  );
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { url: autogenChatUrl(tab.url, true) });
    await waitForTabReady(tabId);
  } catch (error) {
    await appendActivityLog(windowId, null, `failed to start a fresh conversation: ${String(error?.message || error)}`);
    return;
  }
  const settings = await autogenGetSettings();
  const selection = await resolveChatGptModelForTab(tabId, settings);
  await applyChatGptModelIfNeeded(windowId, tabId, selection.model);
}

function autogenChatOrigin(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_e) {
    return "https://chatgpt.com";
  }
}

function autogenChatUrl(currentUrl, temporary) {
  const origin = autogenChatOrigin(currentUrl);
  return temporary ? `${origin}/?temporary-chat=true` : `${origin}/`;
}

const AUTOGEN_MODEL_LOG_LABELS = {
  instant: "Instant",
  medium: "Medium",
  high: "High",
  "extra-high": "Extra high",
  pro: "Pro",
  "pro-standard": "Pro Standard",
  "pro-extended": "Pro Extended",
};

/** Applies the Settings Chat/Work model to the ChatGPT tab active in this window. */
async function testChatGptModelOnTab(windowId, selection) {
  let tab;
  try {
    tab = await resolveWindowActiveChatGptTab(windowId);
  } catch (_error) {
    return {
      ok: false,
      detail: "Switch to a chatgpt.com tab in this window, then click Test.",
    };
  }

  const settings = {
    chatgptModel: selection?.chatModeModel || "asis",
    chatModeModel: selection?.chatModeModel || "asis",
    workModeModel: selection?.workModeModel || "asis",
  };
  const resolved = await resolveChatGptModelForTab(tab.id, settings);
  const modeLabel = resolved.mode === "work" ? "Work" : "Chat";
  if (!resolved.model || resolved.model === "asis") {
    return {
      ok: true,
      detail: `${modeLabel} is set to leave the model as is. The open tab was not changed.`,
    };
  }

  const label = AUTOGEN_MODEL_LOG_LABELS[resolved.model] || resolved.model;
  await ensureContentScriptInjected(tab.id);
  const result = await sendMessageToTabWithRetry(tab.id, {
    type: "AUTOGEN_SET_MODEL",
    model: resolved.model,
  });
  if (result?.already) {
    return { ok: true, detail: `${label} is already selected on this ${modeLabel} tab.` };
  }
  if (result?.ok) {
    await appendActivityLog(windowId, null, `ChatGPT model set to ${result.model || label}`);
    return { ok: true, detail: `Set this ${modeLabel} tab to ${result.model || label}.` };
  }
  if (result?.reason === "option-missing") {
    await appendActivityLog(
      windowId,
      null,
      `${label} is not in the ChatGPT menu; keeping ${result.model || "the current model"}`,
    );
    return {
      ok: false,
      detail: `${label} is not in this ChatGPT menu. The current model was kept.`,
    };
  }
  await appendActivityLog(windowId, null, "ChatGPT model picker was not found; keeping the current model");
  return { ok: false, detail: "The ChatGPT model picker was not found on this tab." };
}

/** Best-effort model/reasoning selection. Missing/unavailable picker choices never fail an application. */
async function applyChatGptModelIfNeeded(windowId, tabId, model) {
  if (!model || model === "asis") return;
  const label = AUTOGEN_MODEL_LOG_LABELS[model] || model;
  try {
    await ensureContentScriptInjected(tabId);
    const result = await sendMessageToTabWithRetry(tabId, { type: "AUTOGEN_SET_MODEL", model });
    if (result?.already || result?.skipped) return;
    if (result?.ok) {
      await appendActivityLog(windowId, null, `ChatGPT model set to ${result.model || label}`);
      return;
    }
    if (result?.reason === "option-missing") {
      await appendActivityLog(
        windowId,
        null,
        `${label} is not in the ChatGPT menu; keeping ${result.model || "the current model"}`,
      );
      return;
    }
    await appendActivityLog(windowId, null, "ChatGPT model picker was not found; keeping the current model");
  } catch (error) {
    await appendActivityLog(windowId, null, `could not set ChatGPT model: ${String(error?.message || error)}`);
  }
}

/** Resolves the saved selection for the Chat or Work experience currently open in the tab. */
async function resolveChatGptModelForTab(tabId, settings) {
  const fallback = settings.chatgptModel || "asis";
  try {
    await ensureContentScriptInjected(tabId);
    const result = await sendMessageToTabWithRetry(tabId, { type: "AUTOGEN_GET_MODE" });
    const mode = result?.mode === "work" ? "work" : "chat";
    return {
      mode,
      model: mode === "work"
        ? settings.workModeModel || fallback
        : settings.chatModeModel || fallback,
    };
  } catch (_error) {
    return { mode: "chat", model: fallback };
  }
}

/** Prepares the active ChatGPT tab before a prompt is pasted. */
async function applyChatSessionAction(windowId, tabId, action) {
  if (!action || action === "reuse" || action === "asis") return;
  const tab = await chrome.tabs.get(tabId);
  if (action === "reload") {
    await appendActivityLog(windowId, null, "reloading the current ChatGPT tab before pasting");
    await reloadTab(tabId);
  } else if (action === "delete-new") {
    await appendActivityLog(windowId, null, "deleting the current chat, then opening a new chat");
    await ensureContentScriptInjected(tabId);
    const deleted = await sendMessageToTabWithRetry(tabId, { type: "AUTOGEN_DELETE_CURRENT_CHAT" });
    if (!deleted?.ok) {
      await appendActivityLog(
        windowId,
        null,
        `could not delete the open chat (${deleted?.error || "no delete control"}); opening a new chat anyway`,
      );
    } else if (deleted.skipped) {
      await appendActivityLog(windowId, null, "no saved conversation was open to delete");
    }
    await navigateChatTab(tabId, autogenChatUrl(tab.url, false));
  } else if (action === "new") {
    await appendActivityLog(windowId, null, "opening a new chat before pasting");
    await navigateChatTab(tabId, autogenChatUrl(tab.url, false));
  } else if (action === "temporary") {
    await appendActivityLog(windowId, null, "opening a temporary chat before pasting");
    await navigateChatTab(tabId, autogenChatUrl(tab.url, true));
  } else {
    return;
  }
}

async function navigateChatTab(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabReady(tabId);
}

async function loadQueueState() {
  if (queueStateLoaded) return;
  const data = await chrome.storage.local.get({ autogenSelectedQueue: [], autogenQueueStatus: {} });
  selectedQueue = Array.isArray(data.autogenSelectedQueue) ? data.autogenSelectedQueue : [];
  queueStatus = data.autogenQueueStatus && typeof data.autogenQueueStatus === "object" ? data.autogenQueueStatus : {};
  queueStateLoaded = true;
}

async function persistSelectedQueue() {
  await chrome.storage.local.set({ autogenSelectedQueue: [...selectedQueue] });
}

async function persistQueueStatus() {
  await chrome.storage.local.set({ autogenQueueStatus: { ...queueStatus } });
}

/** Synchronously removes and returns the next queued id (or null). Persists after. */
function shiftQueueId() {
  return selectedQueue.length ? selectedQueue.shift() : null;
}

async function setQueueStatus(id, status, extra = {}) {
  queueStatus[id] = { ...queueStatus[id], status, ...extra, updatedAt: new Date().toISOString() };
  await persistQueueStatus();
}

function getOrCreateWindowWorker(windowId) {
  if (!windowWorkers[windowId]) {
    windowWorkers[windowId] = {
      running: false,
      busy: false,
      stopSeq: 0,
      stopWaiters: [],
      tickTimer: null,
      claimFailureStreak: 0,
    };
  }
  return windowWorkers[windowId];
}

async function persistRunningWindows() {
  const running = {};
  for (const [windowId, worker] of Object.entries(windowWorkers)) {
    if (worker.running) running[windowId] = true;
  }
  await chrome.storage.local.set({ autogenRunningWindows: running });
}

/** Appends selected application ids to the shared run queue (deduped against ids
 * already queued or in flight), marks them "queued", and wakes every currently
 * running window so processing starts immediately. */
async function enqueueApplications(ids) {
  await loadQueueState();
  const inFlight = new Set(
    Object.entries(queueStatus)
      .filter(([, v]) => v && v.status === "processing")
      .map(([k]) => k),
  );
  const queuedSet = new Set(selectedQueue);
  let added = 0;
  for (const id of ids) {
    if (!id || queuedSet.has(id) || inFlight.has(id)) continue;
    selectedQueue.push(id);
    queuedSet.add(id);
    queueStatus[id] = { status: "queued", updatedAt: new Date().toISOString() };
    added += 1;
  }
  await persistSelectedQueue();
  await persistQueueStatus();
  if (added > 0) {
    await appendActivityLog(null, null, `queued ${added} selected application(s) to run`);
    for (const [windowId, worker] of Object.entries(windowWorkers)) {
      if (worker.running) scheduleWindowTick(Number(windowId), 300);
    }
  }
  return added;
}

async function clearSelectedQueue() {
  await loadQueueState();
  selectedQueue = [];
  await persistSelectedQueue();
}

/** Applications tab's "Clear" button: resets the per-id status map that
 * drives the "N queued/processing/completed/failed" progress readout and each
 * row's badge. Doesn't touch selectedQueue - an item actually in flight just
 * re-adds its own entry the next time its status changes. */
async function clearQueueStatus() {
  await loadQueueState();
  queueStatus = {};
  await persistQueueStatus();
}

/**
 * Stops ONE window's worker: interrupts whatever it's doing right now and
 * stops its tick loop. Does NOT touch the shared selectedQueue - other
 * windows keep draining it.
 */
async function stopWindow(windowId, reason) {
  const worker = getOrCreateWindowWorker(windowId);
  const wasRunning = worker.running;
  worker.running = false;
  clearTimeout(worker.tickTimer);
  worker.tickTimer = null;
  worker.stopSeq += 1;
  const waiters = worker.stopWaiters.splice(0);
  waiters.forEach((resolve) => resolve());
  await persistRunningWindows();
  if (wasRunning || reason) {
    await appendActivityLog(
      windowId,
      null,
      reason || "user clicked Stop - interrupted this window's in-flight work",
    );
  }
  void reportStatusToWebsite();
}

async function startWindow(windowId) {
  const worker = getOrCreateWindowWorker(windowId);
  if (worker.running) return;
  worker.running = true;
  await persistRunningWindows();
  await appendActivityLog(windowId, null, "user started processing in this window");
  scheduleWindowTick(windowId, 300);
  void reportStatusToWebsite();
}

/**
 * Option A: do not force ChatGPT's High model. Generation uses whatever
 * model/effort is already selected in this window's active ChatGPT tab.
 */
async function ensureHighModelForWindow(windowId) {
  void windowId;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "AUTOGEN_ENQUEUE") {
    enqueueApplications(Array.isArray(message.ids) ? message.ids : []).then((added) =>
      sendResponse({ ok: true, added }),
    );
    return true; // async response
  }
  if (message.type === "AUTOGEN_CLEAR_QUEUE_STATUS") {
    clearQueueStatus().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "AUTOGEN_START_WINDOW") {
    startWindow(message.windowId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "AUTOGEN_STOP_WINDOW") {
    stopWindow(message.windowId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "AUTOGEN_TEST_CHATGPT_MODEL") {
    testChatGptModelOnTab(message.windowId, message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, detail: String(error?.message || error) }));
    return true;
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  delete windowWorkers[windowId];
  await persistRunningWindows();
  const data = await chrome.storage.local.get({ autogenWindowStatus: {}, autogenWindowBusy: {} });
  const status = { ...data.autogenWindowStatus };
  const busy = { ...data.autogenWindowBusy };
  delete status[windowId];
  delete busy[windowId];
  await chrome.storage.local.set({ autogenWindowStatus: status, autogenWindowBusy: busy });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  purgeLegacyStorageEntries();
  // Reloading/updating the extension itself should always come up idle and
  // wait for the user to click "Run selected" or "Run in background" again -
  // NOT resume whatever was left running last time. (An actual Chrome restart,
  // or the service worker being silently evicted mid-run - which fires neither
  // this nor onStartup - still resumes automatically via restartWindowsIfActive,
  // so an active run isn't killed by Chrome's normal MV3 background lifecycle.)
  resetRunStateOnReload();
});

chrome.runtime.onStartup.addListener(() => {
  purgeLegacyStorageEntries();
  restartWindowsIfActive();
});

/**
 * Drops storage entries from before the per-window rewrite (lane-indexed
 * arrays/log rows) - without this they'd just sit in chrome.storage.local
 * forever, never read by the new windowId-keyed code.
 */
async function purgeLegacyStorageEntries() {
  await chrome.storage.local.remove([
    "autogenLog",
    "autogenLaneBusy",
    "autogenChatGptTabIds",
    "autogenLaneGenerationCounts",
  ]);

  const data = await chrome.storage.local.get({ autogenActivityLog: [] });
  const activity = Array.isArray(data.autogenActivityLog) ? data.autogenActivityLog : [];
  const cleanActivity = activity.filter((row) => row && typeof row === "object" && typeof row.message === "string");
  if (cleanActivity.length !== activity.length) {
    await chrome.storage.local.set({ autogenActivityLog: cleanActivity });
  }
}

// chrome.alarms can't reliably fire below ~1 minute, but the settings allow a 5-60s
// fetch period, so the real cadence is driven by each window's own setTimeout chain.
// This alarm is only a backstop to restart any window's chain if the MV3 service
// worker gets evicted while a timer was pending.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    restartWindowsIfActive().finally(() => reportStatusToWebsite());
  }
});

/**
 * Tells JobStrike which windows are generating and what each is on, for the
 * website's Auto-bid page. Sent every minute (the heartbeat) and when a window
 * starts or stops; the page shows AutoGen as stopped when reports stop coming.
 */
async function reportStatusToWebsite() {
  try {
    const settings = await autogenGetSettings();
    if (!settings.serverBaseUrl || !settings.username) return;
    const data = await chrome.storage.local.get({
      autogenRunningWindows: {},
      autogenWindowStatus: {},
      autogenSessionStats: {},
      autogenActivityLog: [],
    });
    const running = data.autogenRunningWindows || {};
    const statusById = data.autogenWindowStatus || {};
    const ids = new Set([...Object.keys(running), ...Object.keys(windowWorkers)].map(Number));
    const windows = [];
    for (const windowId of ids) {
      const win = await chrome.windows.get(windowId, { populate: true }).catch(() => null);
      if (!win) continue;
      const entry = statusById[windowId] || {};
      const activeTab = (win.tabs || []).find((tab) => tab.active);
      windows.push({
        windowId,
        running: Boolean(windowWorkers[windowId]?.running || running[windowId]),
        busy: Boolean(windowWorkers[windowId]?.busy),
        minimized: win.state === "minimized",
        chatGptActive: isChatGptUrl(activeTab?.url || ""),
        status: entry.status || "",
        applicationId: entry.id ?? null,
        company: entry.company || "",
        jobTitle: entry.jobTitle || "",
        error: String(entry.error || "").slice(0, 300),
        updatedAt: entry.updatedAt || null,
      });
    }
    const log = (Array.isArray(data.autogenActivityLog) ? data.autogenActivityLog : [])
      .slice(-12)
      .reverse()
      .map((row) => ({ at: row.timestamp, windowId: row.windowId ?? null, text: String(row.message || "").slice(0, 300) }));
    await autogenApiFetch(settings, "/api/autobid/status", autogenJsonPost({
      kind: "autogen",
      status: {
        version: chrome.runtime.getManifest().version,
        engine: settings.engine === "api" ? "api" : "chatgpt",
        windows,
        stats: data.autogenSessionStats || {},
        log,
      },
    }));
  } catch (_error) {
    /* signed out, offline or the migration has not run: the next heartbeat tries again */
  }
}

/** Forces a clean "off" state on extension reload/update: stops every window's
 * worker and drops any queued (not yet in-flight) selected-run work, so the
 * user has to click "Run selected" or "Run in background" again in each
 * window rather than the previous run silently picking back up. */
async function resetRunStateOnReload() {
  await loadQueueState();
  const hadQueued = selectedQueue.length;
  await clearSelectedQueue();
  const data = await chrome.storage.local.get({ autogenRunningWindows: {} });
  const wasRunning = data.autogenRunningWindows && typeof data.autogenRunningWindows === "object"
    ? Object.keys(data.autogenRunningWindows).length > 0
    : false;
  await chrome.storage.local.set({ autogenRunningWindows: {} });
  await chrome.storage.local.remove("autogenAdoptAfterRestart");
  if (wasRunning || hadQueued) {
    await appendActivityLog(
      null,
      null,
      "extension reloaded - stopping the previous run; click \"Run selected\" or \"Run in background\" to start again",
    );
  }
  await reconcileOrphanedProcessing();
}

/**
 * A fresh worker instance (cold start after Chrome restarts, or after the MV3
 * service worker gets silently evicted and revived) starts with windowWorkers
 * entirely empty - the JS call stack of whatever was mid-`processApplication`
 * died along with the old instance. Any queueStatus entry still showing
 * "processing" at that point is therefore necessarily stale, not actually in
 * progress; left alone it shows as permanently "stuck" in the Applications
 * tab. Safe to call unconditionally (e.g. on every heartbeat) - it only ever
 * touches entries whose window genuinely isn't busy right now, so a real
 * in-flight item is never mistaken for orphaned.
 */
async function reconcileOrphanedProcessing() {
  await loadQueueState();
  const orphanedIds = [];
  let queueChanged = false;
  for (const [id, status] of Object.entries(queueStatus)) {
    if (status && status.status === "processing" && !windowWorkers[status.windowId]?.busy) {
      orphanedIds.push(id);
      queueStatus[id] = {
        ...status,
        status: "failed",
        error: "interrupted (extension/browser restarted before finishing)",
        updatedAt: new Date().toISOString(),
      };
      queueChanged = true;
    }
  }
  if (queueChanged) await persistQueueStatus();

  // The server still has these as "generating" under our claim; the call
  // stack that would have released them died with the old worker. Release
  // each with the claim stamp it was last known under. One we can no longer
  // release (stamp unknown, or another worker took it) becomes claimable on
  // its own once the claim is 10 minutes old.
  if (orphanedIds.length > 0) {
    const settings = await autogenGetSettings();
    let released = 0;
    for (const id of orphanedIds) {
      const claimedAt = queueStatus[id]?.claimedAt;
      if (!claimedAt) continue;
      try {
        const result = await autogenReleaseClaim(settings, id, claimedAt);
        if (result?.ok) released += 1;
      } catch (_error) {
        /* the stale-claim timeout covers it */
      }
    }
    await appendActivityLog(
      null,
      null,
      `released ${released} of ${orphanedIds.length} interrupted application(s) back to the queue` +
        (released < orphanedIds.length ? "; the rest become claimable 10 minutes after their last claim" : ""),
    );
  }
}

async function restartWindowsIfActive() {
  await loadQueueState();
  await reconcileOrphanedProcessing();
  const data = await chrome.storage.local.get({
    autogenRunningWindows: {},
    autogenDisconnectedWindows: {},
  });
  const disconnected = data.autogenDisconnectedWindows || {};
  const running = data.autogenRunningWindows && typeof data.autogenRunningWindows === "object" ? data.autogenRunningWindows : {};
  let lost = 0;
  for (const key of Object.keys(running)) {
    if (disconnected[key]) continue;
    const windowId = Number(key);
    try {
      await chrome.windows.get(windowId);
    } catch (_e) {
      // Window is gone without a close (onRemoved drops closed ones first): Chrome
      // restarted and gave the restored windows new ids. Taken over below.
      lost += 1;
      continue;
    }
    const worker = getOrCreateWindowWorker(windowId);
    worker.running = true;
    if (!worker.tickTimer) scheduleWindowTick(windowId, 1000);
  }
  await persistRunningWindows();
  await adoptRestoredWindows(lost);
}

/** How long after a Chrome restart restored ChatGPT windows are still taken over. */
const ADOPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * After a Chrome restart, as many restored windows as were running before
 * start again: each one whose active tab is ChatGPT and that is not running
 * yet. Windows can be restored after onStartup, so the heartbeat keeps
 * looking for a while. An extension reload never gets here (it clears the
 * running windows on purpose).
 */
let adopting = Promise.resolve();

function adoptRestoredWindows(lost) {
  // Startup and the heartbeat can both call this: one at a time, or a window is counted twice.
  adopting = adopting.then(() => adoptRestoredWindowsNow(lost)).catch(() => {});
  return adopting;
}

async function adoptRestoredWindowsNow(lost) {
  const data = await chrome.storage.local.get({ autogenAdoptAfterRestart: null });
  let pending = data.autogenAdoptAfterRestart;
  if (lost > 0) {
    pending = { count: (pending?.count || 0) + lost, until: Date.now() + ADOPT_WINDOW_MS };
  }
  if (!pending || pending.count <= 0) return;
  if (Date.now() > pending.until) {
    await chrome.storage.local.remove("autogenAdoptAfterRestart");
    return;
  }
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }).catch(() => []);
  for (const win of windows) {
    if (pending.count <= 0) break;
    if (windowWorkers[win.id]?.running || win.state === "minimized") continue;
    const active = (win.tabs || []).find((tab) => tab.active);
    if (!active || !isChatGptUrl(active.url || active.pendingUrl)) continue;
    pending.count -= 1;
    const worker = getOrCreateWindowWorker(win.id);
    worker.running = true;
    await appendActivityLog(win.id, null, "Chrome restarted - running again in this window");
    scheduleWindowTick(win.id, 3000);
  }
  await persistRunningWindows();
  if (pending.count > 0) await chrome.storage.local.set({ autogenAdoptAfterRestart: pending });
  else await chrome.storage.local.remove("autogenAdoptAfterRestart");
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (_e) {
    /* side panel unavailable in some contexts */
  }
});

function scheduleWindowTick(windowId, delayMs) {
  const worker = getOrCreateWindowWorker(windowId);
  clearTimeout(worker.tickTimer);
  worker.tickTimer = setTimeout(() => windowTick(windowId), delayMs);
}

async function windowTick(windowId) {
  const worker = getOrCreateWindowWorker(windowId);
  worker.tickTimer = null;
  await loadQueueState();
  const settings = await autogenGetSettings();

  const reschedule = () => {
    if (!worker.running) return;
    const backingOff = worker.claimFailureStreak > 0;
    const delayMs = selectedQueue.length > 0 && !backingOff ? QUEUE_DRAIN_DELAY_MS : settings.fetchPeriodSeconds * 1000;
    scheduleWindowTick(windowId, delayMs);
  };

  if (!worker.running) return;

  if (worker.busy) {
    reschedule();
    return;
  }

  worker.busy = true;
  await setWindowBusy(windowId, true);
  try {
    // 1. Selected-run queue takes priority over background auto-claim.
    const queuedId = shiftQueueId();
    if (queuedId) {
      await persistSelectedQueue();
      await appendActivityLog(windowId, null, `claim selected application_id: ${queuedId}`);
      let result;
      try {
        result = await autogenClaimApplicationById(settings, queuedId);
        worker.claimFailureStreak = 0;
      } catch (error) {
        // Couldn't reach the server - put it back on the queue and surface the error.
        selectedQueue.unshift(queuedId);
        await persistSelectedQueue();
        throw error;
      }
      if (result && result.application) {
        await processApplication(windowId, result.application, settings);
      } else {
        // not_found / not_claimable: someone else has it or it is done. Anything
        // else is a kit or job problem the server already marked failed.
        const reason = (result && result.reason) || "not_claimable";
        const bucket = reason === "not_claimable" || reason === "not_found" ? "skipped" : "failed";
        const detail = (result && result.detail) || reason;
        await setQueueStatus(queuedId, bucket, { error: detail });
        await appendActivityLog(windowId, null, `selected application_id ${queuedId} not run: ${detail}`);
        await bumpSessionStat(bucket);
      }
    } else if (settings.autoClaim) {
      // 2. Background auto-claim fallback (oldest queued application).
      const { application, skipped } = await autogenFetchNextApplication(settings);
      worker.claimFailureStreak = 0;
      for (const item of Array.isArray(skipped) ? skipped : []) {
        await appendActivityLog(windowId, null, `application_id ${item.id} marked failed by JobStrike: ${item.reason}`);
      }
      if (application) {
        await appendActivityLog(windowId, null, `get application from server: application_id: ${application.id}`);
        await processApplication(windowId, application, settings);
      }
    }
  } catch (error) {
    worker.claimFailureStreak += 1;
    await appendActivityLog(
      windowId,
      null,
      `failed to fetch application from server: ${String(error?.message || error)} ` +
        `(${worker.claimFailureStreak} consecutive failure(s); backing off to the normal fetch period)`,
      { updatable: true },
    );
  } finally {
    worker.busy = false;
    await setWindowBusy(windowId, false);
    reschedule();
  }
}

/**
 * Session-wide totals (completed/failed/skipped) shown in the Monitor tab's
 * summary bar - covers work from every window. Always reads fresh from
 * storage before incrementing (no persistent in-memory copy), so the
 * sidepanel resetting this to zeros directly is safe and can never be
 * clobbered by a stale in-memory value.
 */
async function bumpSessionStat(key) {
  const data = await chrome.storage.local.get({ autogenSessionStats: { completed: 0, failed: 0, skipped: 0 } });
  const stats = data.autogenSessionStats && typeof data.autogenSessionStats === "object" ? { ...data.autogenSessionStats } : {};
  stats[key] = (stats[key] || 0) + 1;
  await chrome.storage.local.set({ autogenSessionStats: stats });
}

async function setWindowBusy(windowId, busy) {
  const data = await chrome.storage.local.get({ autogenWindowBusy: {} });
  const map = data.autogenWindowBusy && typeof data.autogenWindowBusy === "object" ? { ...data.autogenWindowBusy } : {};
  map[windowId] = busy;
  await chrome.storage.local.set({ autogenWindowBusy: map });
}

// Tracks, per window, whether the last activity-log line for that window was written
// with {updatable: true} - lets the next updatable call for the same window overwrite
// it in place (e.g. a "thinking, Ns elapsed" tick) instead of spamming a new line
// every poll. Keyed by windowId; "null" (global/session messages) never updates.
const activityLogTailUpdatable = {};

/**
 * Appends a timestamped, window-tagged line to the global activity log shown in
 * the side panel. `windowId` is the window this line is about, or null for a
 * session-level message not tied to a specific window. `tabLabel` (optional) is
 * a human-readable tag for the tab that was actually acted on (its title), shown
 * instead of the raw windowId. Pass {updatable: true} for a repeating per-window
 * status tick so consecutive calls for the *same* window replace that window's
 * last line as an elapsed-time counter, instead of flooding the log with one
 * entry per poll.
 */
async function appendActivityLog(windowId, tabLabel, message, { updatable = false } = {}) {
  const entry = { windowId, tabLabel: tabLabel || null, message, timestamp: new Date().toISOString(), updatable };
  const data = await chrome.storage.local.get({ autogenActivityLog: [] });
  const log = Array.isArray(data.autogenActivityLog) ? data.autogenActivityLog : [];

  if (windowId != null && updatable && activityLogTailUpdatable[windowId]) {
    const lastIdx = [...log].reverse().findIndex((row) => row.windowId === windowId);
    if (lastIdx !== -1) {
      log[log.length - 1 - lastIdx] = entry;
    } else {
      log.push(entry);
    }
  } else {
    log.push(entry);
  }
  if (windowId != null) activityLogTailUpdatable[windowId] = updatable;

  await chrome.storage.local.set({ autogenActivityLog: log.slice(-MAX_ACTIVITY_LOG_LINES) });
}

async function setWindowStatus(windowId, partial) {
  const data = await chrome.storage.local.get({ autogenWindowStatus: {} });
  const map = data.autogenWindowStatus && typeof data.autogenWindowStatus === "object" ? { ...data.autogenWindowStatus } : {};
  map[windowId] = { ...map[windowId], ...partial, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ autogenWindowStatus: map });
}

async function stopEntry(windowId, entry) {
  entry.status = "Stopped";
  await setWindowStatus(windowId, entry);
  // Tracked by entry.id (== application.id) regardless of whether this came
  // from the selected-run queue or auto-claim, so the Applications tab's
  // badge updates correctly either way.
  await setQueueStatus(entry.id, "skipped", { error: "stopped" });
  await appendActivityLog(windowId, entry.tabLabel, `processing stopped by user for application_id: ${entry.id}`);
  await bumpSessionStat("skipped");
  // Back to the queue on the server, or it would sit as "generating" until
  // the claim went stale.
  await releaseApplicationClaim(entry.id, entry.claimedAt, windowId);
}

/**
 * Gives a claimed application back to the queue. Best-effort: logs and
 * swallows failures, since the outcome is already recorded locally and the
 * stale-claim timeout releases it anyway.
 */
async function releaseApplicationClaim(applicationId, claimedAt, windowId = null) {
  if (!claimedAt) return;
  try {
    const settings = await autogenGetSettings();
    await autogenReleaseClaim(settings, applicationId, claimedAt);
  } catch (error) {
    await appendActivityLog(
      windowId,
      null,
      `failed to release application_id ${applicationId} back to the queue: ${String(error?.message || error)}`,
    );
  }
}

/** Races `promise` against this window's stop button being clicked. Resolves
 * with {stopped:true} immediately on stop, or {stopped:false, value|error}
 * once `promise` itself settles - whichever comes first. */
function raceWithWindowStop(windowId, promise) {
  const worker = getOrCreateWindowWorker(windowId);
  return new Promise((resolve) => {
    let settled = false;
    const stopResolver = () => {
      if (settled) return;
      settled = true;
      resolve({ stopped: true });
    };
    worker.stopWaiters.push(stopResolver);
    const cleanup = () => {
      const idx = worker.stopWaiters.indexOf(stopResolver);
      if (idx >= 0) worker.stopWaiters.splice(idx, 1);
    };
    promise.then(
      (value) => {
        cleanup();
        if (!settled) {
          settled = true;
          resolve({ stopped: false, value });
        }
      },
      (error) => {
        cleanup();
        if (!settled) {
          settled = true;
          resolve({ stopped: false, error });
        }
      },
    );
  });
}

// How often a still-in-progress attempt re-stamps its claim (see
// autogenRefreshClaim). Well under the server's 10-minute stale-claim
// threshold, so a genuinely long multi-retry run never gets treated as
// abandoned and handed to another window's auto-claim mid-generation.
const CLAIM_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

/** Thrown when a periodic claim refresh finds another window already took
 * over this application (our claim went stale before we refreshed it, or the
 * server never sent us a claimedAt to guard with). Callers must abort - not
 * retry, not report-failure - since the row is no longer ours to touch. */
class ClaimLostError extends Error {}

/**
 * Tracks one application's claim across a possibly-long multi-retry run and
 * re-stamps it on the server every CLAIM_REFRESH_INTERVAL_MS. Cheap to call
 * often - it only actually hits the network once the interval has elapsed.
 * A transient network error refreshing is swallowed (retried next call)
 * rather than treated as claim-lost, so a brief server hiccup can't abort a
 * real in-progress generation.
 */
function createClaimGuard(applicationId, initialClaimedAt, onRefresh = () => {}) {
  let claimedAt = initialClaimedAt;
  let lastRefreshAt = Date.now();
  return {
    /** The claim stamp the server currently has; every save/release/report needs it. */
    get claimedAt() {
      return claimedAt;
    },
    async check(settings) {
      if (!claimedAt) return;
      if (Date.now() - lastRefreshAt < CLAIM_REFRESH_INTERVAL_MS) return;
      lastRefreshAt = Date.now();
      let result;
      try {
        result = await autogenRefreshClaim(settings, applicationId, claimedAt);
      } catch (_error) {
        return; // transient network error - try again next check
      }
      if (!result?.ok) throw new ClaimLostError("This application's claim was taken over by another window.");
      claimedAt = result.claimedAt;
      await onRefresh(claimedAt);
    },
  };
}

/** ChatGPT cannot be used right now (usage limit, signed out, verification). Not a failed attempt. */
class ChatGptBlockedError extends Error {}

/** Abandons an application whose claim was taken over by another window
 * mid-run. Deliberately does NOT call report-failure/release-claim - we no
 * longer hold this claim, so touching its status here could clobber whatever
 * the window that legitimately owns it now is doing with it. */
async function claimLostEntry(windowId, entry, error) {
  entry.status = "Skipped";
  entry.error = String(error?.message || error);
  await setWindowStatus(windowId, entry);
  await setQueueStatus(entry.id, "skipped", { error: "claimed by another window" });
  await appendActivityLog(
    windowId,
    entry.tabLabel,
    `application_id ${entry.id} was claimed by another window - moving to the next application`,
  );
  await bumpSessionStat("skipped");
}

function autogenLogEntryFromApplication(windowId, application, tabLabel) {
  return {
    windowId,
    tabLabel: tabLabel || null,
    id: application.id,
    account: application.seq != null ? `#${application.seq}` : "",
    company: application.company_name || "",
    jobTitle: application.role || "",
    createdTime: application.created_at || "",
    jobDescription: application.job_description || "",
    renderedPrompt: application.rendered_prompt || "",
    status: "Claimed",
    error: "",
  };
}

/**
 * One claimed application, start to finish, with the configured engine:
 *   chatgpt  paste the prompt into this window's active ChatGPT tab, then
 *            send the raw reply to submit-answer;
 *   api      ask the server to generate it with its OpenAI key.
 * The server checks and saves the result either way. A retryable error tries
 * again (up to maxTryCount); a non-retryable one (kit problem, bad key) goes
 * straight to report-failure; a lost claim is dropped without touching the
 * row; a blocked ChatGPT (usage limit, signed out) gives the application back
 * to the queue and stops this window.
 */
async function processApplication(windowId, application, settings) {
  const worker = getOrCreateWindowWorker(windowId);
  const engine = settings.engine === "api" ? "api" : "chatgpt";
  let tab = null;
  if (engine === "chatgpt") {
    try {
      tab = await resolveWindowActiveChatGptTab(windowId);
    } catch (error) {
      // No ChatGPT tab: nothing was attempted, so the application goes back to the queue.
      const message = String(error?.message || error);
      await appendActivityLog(windowId, null, message);
      await releaseApplicationClaim(application.id, application.autogen_claimed_at, windowId);
      await setQueueStatus(application.id, "skipped", { error: message });
      await stopWindow(windowId, "stopped: open a chatgpt.com tab in this window, then start again");
      return;
    }
  }

  const tabLabel = engine === "api" ? "API" : tab.title || tab.url || "";
  const entry = autogenLogEntryFromApplication(windowId, application, tabLabel);
  entry.status = "Processing";
  entry.engine = engine;
  entry.claimedAt = application.autogen_claimed_at;
  await setWindowStatus(windowId, entry);
  await setQueueStatus(application.id, "processing", { windowId, claimedAt: entry.claimedAt });

  const startSeq = worker.stopSeq;
  const stopped = () => worker.stopSeq !== startSeq;
  const guard = createClaimGuard(application.id, application.autogen_claimed_at, async (claimedAt) => {
    entry.claimedAt = claimedAt;
    await setQueueStatus(application.id, "processing", { windowId, claimedAt });
  });

  let lastError = "";
  for (let attempt = 1; attempt <= settings.maxTryCount; attempt += 1) {
    if (stopped()) return stopEntry(windowId, entry);
    try {
      await guard.check(settings);
    } catch (error) {
      if (error instanceof ClaimLostError) return claimLostEntry(windowId, entry, error);
      throw error;
    }

    let outcome;
    if (engine === "api") {
      await appendActivityLog(windowId, tabLabel, `attempt ${attempt}: generating with the API…`);
      const run = await raceWithWindowStop(
        windowId,
        autogenGenerateViaApi(settings, application.id, { claimedAt: guard.claimedAt, attempt }),
      );
      if (run.stopped) return stopEntry(windowId, entry);
      outcome = run.error
        ? { status: "Error", detail: String(run.error?.message || run.error), retryable: true }
        : run.value;
    } else {
      outcome = await runChatGptEngineAttempt(windowId, tab, application, settings, guard, attempt);
      if (outcome.stopped) return stopEntry(windowId, entry);
      if (outcome.claimLost instanceof ClaimLostError) return claimLostEntry(windowId, entry, outcome.claimLost);
      if (outcome.blocked) {
        await releaseApplicationClaim(application.id, guard.claimedAt, windowId);
        entry.status = "Paused";
        entry.error = outcome.detail;
        await setWindowStatus(windowId, entry);
        await setQueueStatus(application.id, "skipped", { error: outcome.detail });
        await stopWindow(
          windowId,
          `ChatGPT is blocked (${outcome.detail}) - the application went back to the queue; start again once ChatGPT works`,
        );
        return;
      }
    }

    if (outcome.status === "Success") {
      const notes = [
        outcome.restored?.length ? `${outcome.restored.length} kit fact(s) put back` : "",
        ...(outcome.warnings || []).filter((w) => !/^Put back/.test(w)),
      ].filter(Boolean);
      await appendActivityLog(
        windowId,
        tabLabel,
        `completed - resume JSON checked and saved${notes.length ? ` (${notes.join("; ")})` : ""}`,
      );
      entry.status = "Completed";
      entry.error = "";
      await setWindowStatus(windowId, entry);
      await setQueueStatus(application.id, "completed", { windowId });
      if (engine === "chatgpt") await autogenBumpWindowGenerationCount(windowId, tab.id);
      await bumpSessionStat("completed");
      return;
    }

    if (outcome.claimLost) {
      return claimLostEntry(windowId, entry, new ClaimLostError(outcome.detail || "claim lost"));
    }
    lastError = outcome.detail || "The server reported an error.";
    await appendActivityLog(windowId, tabLabel, `attempt ${attempt} failed: ${lastError}`);
    if (outcome.retryable === false) break;
    entry.status = `Retrying (${attempt}/${settings.maxTryCount})`;
    entry.error = lastError;
    await setWindowStatus(windowId, entry);
  }

  await appendActivityLog(windowId, tabLabel, `giving up on application_id ${application.id}: ${lastError}`);
  await autogenReportFailure(settings, application.id, guard.claimedAt, lastError).catch(() => {});
  entry.status = "Error";
  entry.error = lastError;
  await setWindowStatus(windowId, entry);
  await setQueueStatus(application.id, "failed", { error: lastError });
  await bumpSessionStat("failed");
}

/**
 * One ChatGPT attempt: prepare the chat, check the page can be used, paste,
 * wait, then hand the raw reply to submit-answer. Returns the server's
 * outcome, or { stopped } / { claimLost } / { blocked, detail }.
 */
async function runChatGptEngineAttempt(windowId, tab, application, settings, guard, attempt) {
  try {
    const sessionAction = attempt === 1 ? settings.startChatMode : settings.retryChatMode;
    await applyChatSessionAction(windowId, tab.id, sessionAction);
    const selection = await resolveChatGptModelForTab(tab.id, settings);
    await applyChatGptModelIfNeeded(windowId, tab.id, selection.model);
  } catch (error) {
    return { status: "Error", detail: `chatgpt session: ${String(error?.message || error)}`, retryable: true };
  }

  const run = await raceWithWindowStop(windowId, runChatGptAttempt(windowId, tab.id, application, settings, guard));
  if (run.stopped) return { stopped: true };
  if (run.error instanceof ClaimLostError) return { claimLost: run.error };
  if (run.error instanceof ChatGptBlockedError) return { blocked: true, detail: run.error.message };
  if (run.error) return { status: "Error", detail: String(run.error?.message || run.error), retryable: true };

  await appendActivityLog(windowId, tab.title || null, "sending ChatGPT's answer to JobStrike for checking…");
  const submit = await raceWithWindowStop(
    windowId,
    autogenSubmitAnswer(settings, application.id, {
      answer: run.value,
      claimedAt: guard.claimedAt,
      attempt,
      chatgptModel: await currentChatGptModelLabel(tab.id),
    }),
  );
  if (submit.stopped) return { stopped: true };
  return submit.error
    ? { status: "Error", detail: String(submit.error?.message || submit.error), retryable: true }
    : submit.value;
}

/** The model label ChatGPT shows, for the generation log; "" when unknown. */
async function currentChatGptModelLabel(tabId) {
  try {
    const result = await sendMessageToTabWithRetry(tabId, { type: "AUTOGEN_SELF_TEST" }, 1);
    return String(result?.model || "").slice(0, 60);
  } catch (_error) {
    return "";
  }
}

/**
 * Resolves the tab currently active in `windowId`, throwing a clear,
 * user-facing error if it's not a ChatGPT tab. Called once per application -
 * deliberately does NOT create, pin, or activate anything. The user chose
 * which tab is active before clicking Start/Run selected.
 */
async function resolveWindowActiveChatGptTab(windowId) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab || !isChatGptUrl(tab.url)) {
    throw new Error("No ChatGPT tab is active in this window. Switch to a chatgpt.com tab in this window and click Start again.");
  }
  return tab;
}

/** Throws ChatGptBlockedError when the page shows it cannot take a prompt now. */
async function assertChatGptUsable(tabId) {
  const check = await sendMessageToTabWithRetry(tabId, { type: "AUTOGEN_SELF_TEST" });
  if (check?.blocked) throw new ChatGptBlockedError(check.blocked);
  if (check?.missing?.length) {
    throw new Error(
      `ChatGPT page is missing: ${check.missing.join(", ")} (the page may still be loading, or ChatGPT changed its layout).`,
    );
  }
}

async function runChatGptAttempt(windowId, tabId, application, settings, guard) {
  await waitForTabReady(tabId);
  await ensureContentScriptInjected(tabId);
  await assertChatGptUsable(tabId);

  await appendActivityLog(windowId, null, "insert rendered prompt to chatgpt's input box");
  const insertResponse = await sendMessageToTabWithRetry(tabId, {
    type: "AUTOGEN_INSERT_AND_SEND",
    prompt: application.rendered_prompt || "",
  });
  if (!insertResponse?.ok) {
    throw new Error(insertResponse?.error || "Could not insert/send the prompt in ChatGPT.");
  }
  await appendActivityLog(windowId, null, "clicked 'Send prompt'");

  const worker = getOrCreateWindowWorker(windowId);
  const startedAt = Date.now();
  const deadline = startedAt + settings.maxWaitSeconds * 1000;
  let lastStatus = null;
  const startSeq = worker.stopSeq;
  while (Date.now() < deadline) {
    if (worker.stopSeq !== startSeq) {
      throw new Error("Stopped while waiting for ChatGPT.");
    }
    await delay(CHATGPT_POLL_INTERVAL_MS);
    await guard.check(settings); // throws ClaimLostError if another window took this over

    // Read-only check: is the target tab still the one the user is looking
    // at? Never forced back - a warning makes a stall explainable.
    const stillVisible = await isTabActiveAndVisible(tabId);
    if (!stillVisible) {
      await appendActivityLog(
        windowId,
        null,
        "target tab isn't active - ChatGPT may stall rendering until you switch back to it",
        { updatable: true },
      );
      continue;
    }

    const statusResponse = await sendMessageToTabWithRetry(tabId, { type: "AUTOGEN_CHECK_STATUS" });
    if (!statusResponse?.ok) {
      throw new Error(statusResponse?.error || "Could not read ChatGPT status.");
    }
    if (statusResponse.blocked) throw new ChatGptBlockedError(statusResponse.blocked);
    lastStatus = statusResponse;
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    if (statusResponse.state === "done") {
      await appendActivityLog(
        windowId,
        null,
        `ChatGPT answered (${elapsedSeconds}s, ${statusResponse.answer.length} chars)`,
      );
      return statusResponse.answer;
    }
    const phase = statusResponse.phase || "unknown";
    const chars = Number(statusResponse.answerChars || 0);
    await appendActivityLog(
      windowId,
      null,
      `application_id ${application.id}: ChatGPT thinking (${elapsedSeconds}s, phase=${phase}, chars=${chars})`,
      { updatable: true },
    );
  }

  const phase = lastStatus?.phase || "unknown";
  const chars = Number(lastStatus?.answerChars || 0);
  throw new Error(
    `ChatGPT status timed out after ${settings.maxWaitSeconds}s (phase=${phase}, responseChars=${chars}).`,
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read-only visibility check - never activates/steals the tab. */
async function isTabActiveAndVisible(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return false;
    const win = await chrome.windows.get(tab.windowId);
    return win.state !== "minimized";
  } catch (_e) {
    return false;
  }
}

/**
 * A ChatGPT tab the user opened themselves may predate the extension loading/
 * reloading - Chrome doesn't retroactively inject content scripts into
 * already-open tabs, so chrome.tabs.sendMessage would otherwise fail with
 * "Could not establish connection. Receiving end does not exist." every time.
 * Ping first, and inject on demand if nothing answers.
 */
async function ensureContentScriptInjected(tabId) {
  if (await pingTab(tabId)) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["autogen-mode-detector.js", "autogen-json-extract.js", "autogen-model-adapter.js", "chatgpt-content.js"],
  });
  if (!(await pingTab(tabId))) {
    throw new Error("AutoGen content script did not respond after injection.");
  }
}

function pingTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "AUTOGEN_PING" }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

function isChatGptUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com" || host.endsWith(".chat.openai.com");
  } catch (_e) {
    return false;
  }
}

// Reloads the given tab so a stuck/broken page state (rather than just the
// prompt/answer) gets cleared before the next retry attempt. Best-effort: if
// the reload fails (tab closed), the next attempt's resolveWindowActiveChatGptTab
// will surface a clear "no ChatGPT tab active" error instead.
async function reloadTab(tabId) {
  try {
    await chrome.tabs.reload(tabId);
    await waitForTabReady(tabId);
  } catch (_e) {
    /* tab likely closed - surfaced on the next attempt's tab resolution */
  }
}

function waitForTabReady(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timeoutId = setTimeout(finish, timeout);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    // A closed tab rejects this promise. Catch it so Chrome does not report
    // "No tab with id" after the worker's tab is already gone.
    Promise.resolve(chrome.tabs.get(tabId))
      .then((tab) => {
        if (tab && tab.status === "complete") finish();
      })
      .catch(() => finish());
  });
}

function sendMessageToTabWithRetry(tabId, message, attempts = 3) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;
    function attempt() {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          remaining -= 1;
          if (remaining <= 0) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          // Content script may not have attached yet (tab just created/navigated).
          setTimeout(attempt, 1000);
          return;
        }
        resolve(response);
      });
    }
    attempt();
  });
}
