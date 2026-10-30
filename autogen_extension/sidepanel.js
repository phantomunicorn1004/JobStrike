const els = {
  tabButtons: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),
  // Monitor tab
  summaryWindowStatus: document.getElementById("summary-window-status"),
  summaryCompleted: document.getElementById("summary-completed"),
  summaryFailed: document.getElementById("summary-failed"),
  summarySkipped: document.getElementById("summary-skipped"),
  resetStatsBtn: document.getElementById("reset-stats-btn"),
  windowCardContainer: document.getElementById("window-card-container"),
  activityLog: document.getElementById("activity-log"),
  clearActivityLogBtn: document.getElementById("clear-activity-log-btn"),
  // Applications tab
  runSelectedBtn: document.getElementById("run-selected-btn"),
  toggleRunBtn: document.getElementById("toggle-run-btn"),
  stopSelectedBtn: document.getElementById("stop-selected-btn"),
  fetchCandidatesBtn: document.getElementById("fetch-candidates-btn"),
  clearCandidatesBtn: document.getElementById("clear-candidates-btn"),
  candidatesProgress: document.getElementById("candidates-progress"),
  selectAllCandidates: document.getElementById("select-all-candidates"),
  candidatesList: document.getElementById("candidates-list"),
  candidatesEmpty: document.getElementById("candidates-empty"),
  // Settings tab
  settingsForm: document.getElementById("settings-form"),
  serverUrl: document.getElementById("setting-server-url"),
  email: document.getElementById("setting-email"),
  password: document.getElementById("setting-password"),
  engine: document.getElementById("setting-engine"),
  refreshDriveStatusBtn: document.getElementById("refresh-drive-status-btn"),
  driveStatusRow: document.getElementById("drive-status-row"),
  driveStatusLabel: document.getElementById("drive-status-label"),
  driveStatusHint: document.getElementById("drive-status-hint"),
  monitorDriveLine: document.getElementById("monitor-drive-line"),
  monitorDriveLabel: document.getElementById("monitor-drive-label"),
  monitorRefreshDriveBtn: document.getElementById("monitor-refresh-drive-btn"),
  fetchPeriod: document.getElementById("setting-fetch-period"),
  maxTry: document.getElementById("setting-max-try"),
  maxWait: document.getElementById("setting-max-wait"),
  startChat: document.getElementById("setting-start-chat"),
  retryChat: document.getElementById("setting-retry-chat"),
  threadReset: document.getElementById("setting-thread-reset"),
  threadResetAfter: document.getElementById("setting-thread-reset-after"),
  chatModeModel: document.getElementById("setting-chat-mode-model"),
  workModeModel: document.getElementById("setting-work-mode-model"),
  testChatGptModelBtn: document.getElementById("test-chatgpt-model-btn"),
  testChatGptModelHint: document.getElementById("test-chatgpt-model-hint"),
  autoClaim: document.getElementById("setting-auto-claim"),
  savedHint: document.getElementById("settings-saved"),
  exportConfigBtn: document.getElementById("export-config-btn"),
  importConfigBtn: document.getElementById("import-config-btn"),
  importConfigFile: document.getElementById("import-config-file"),
  configIoHint: document.getElementById("config-io-hint"),
};

// Resolved once on load - every message to background.js carries this so it
// knows which window (and therefore which currently-active ChatGPT tab) this
// panel instance is scoped to. Each window that opens the side panel gets its
// own independent sidepanel.js document, so this never changes at runtime.
let myWindowId = null;

// Latest candidate list + queue-status map, kept so a storage change (this
// window finishing an application) can re-render the Applications list in place.
let candidates = [];
let queueStatusCache = {};
// The saved default (fallback) template, used to decide whether a template-less
// application is runnable and what chip to show for it.
els.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.tabButtons.forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    els.panels.forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "settings") {
      void refreshDriveStatus();
    }
    if (btn.dataset.tab === "monitor") {
      void refreshDriveStatus();
    }
    if (btn.dataset.tab === "applications") loadCandidatesFromStorage();
  });
});

function applyDriveStatusUi(state, statusText, hint, detailText) {
  const status = String(statusText || "").trim() || "Unknown";
  const detail = detailText != null ? String(detailText).trim() : "";

  if (els.driveStatusRow) els.driveStatusRow.dataset.state = state;
  if (els.driveStatusLabel) {
    els.driveStatusLabel.textContent = detail ? `${status} · ${detail}` : status;
  }
  if (els.driveStatusHint && hint != null) els.driveStatusHint.textContent = hint;
  if (els.monitorDriveLine) {
    els.monitorDriveLine.hidden = false;
    els.monitorDriveLine.dataset.state = state;
  }
  if (els.monitorDriveLabel) {
    els.monitorDriveLabel.textContent = detail ? `${status} · ${detail}` : status;
  }
}

/** Checks the JobStrike sign-in with the values in the form (saved or not). */
async function refreshDriveStatus() {
  applyDriveStatusUi("loading", "Checking…", null, "");
  try {
    const saved = await autogenGetSettings();
    const settings = {
      ...saved,
      serverBaseUrl: els.serverUrl?.value?.trim().replace(/\/+$/, "") || saved.serverBaseUrl,
      username: els.email?.value?.trim() || saved.username,
      password: els.password?.value || saved.password,
    };
    if (!settings.username || !settings.password) {
      applyDriveStatusUi("unknown", "Sign in required", "Enter Username and Password, then Save Settings.", "");
      return;
    }
    const user = await autogenFetchMe(settings);
    if (!user) {
      applyDriveStatusUi("error", "Not signed in", "JobStrike did not accept the extension key.", "");
      return;
    }
    const engineNote =
      (els.engine?.value || settings.engine) === "api"
        ? "Engine: API key. The JobStrike server generates with its OpenAI key."
        : "Engine: ChatGPT tab. Keep a signed-in chatgpt.com tab active in each running window.";
    applyDriveStatusUi("connected", "Connected", engineNote, user.username || settings.username);
  } catch (error) {
    applyDriveStatusUi(
      "error",
      "Check failed",
      "Verify Server URL, Username and Password, then try again.",
      String(error?.message || error),
    );
  }
}

if (els.refreshDriveStatusBtn) {
  els.refreshDriveStatusBtn.addEventListener("click", () => refreshDriveStatus());
}
if (els.monitorRefreshDriveBtn) {
  els.monitorRefreshDriveBtn.addEventListener("click", () => refreshDriveStatus());
}

/* ------------------------------------------------------------------ *
 * Settings: form load/save + config import/export                     *
 * ------------------------------------------------------------------ */

async function isThisWindowRunning() {
  const data = await chrome.storage.local.get({ autogenRunningWindows: {} });
  const running = data.autogenRunningWindows && typeof data.autogenRunningWindows === "object" ? data.autogenRunningWindows : {};
  return Boolean(running[myWindowId]);
}

function updateRunButton(running) {
  els.toggleRunBtn.textContent = running ? "Stop background run" : "Run in background";
  els.toggleRunBtn.classList.toggle("running", running);
  const label = running ? "Stop background auto-claim in this window" : "Start background auto-claim in this window";
  els.toggleRunBtn.title = label;
  els.toggleRunBtn.setAttribute("aria-label", label);
}

async function loadSettings() {
  const settings = await autogenGetSettings();
  els.serverUrl.value = settings.serverBaseUrl;
  els.email.value = settings.username;
  els.password.value = settings.password;
  if (els.engine) els.engine.value = settings.engine;
  els.fetchPeriod.value = settings.fetchPeriodSeconds;
  els.maxTry.value = settings.maxTryCount;
  els.maxWait.value = settings.maxWaitSeconds;
  if (els.startChat) els.startChat.value = settings.startChatMode;
  if (els.retryChat) els.retryChat.value = settings.retryChatMode;
  if (els.threadReset) els.threadReset.value = settings.threadResetMode;
  if (els.threadResetAfter) els.threadResetAfter.value = settings.threadResetAfter;
  if (els.chatModeModel) els.chatModeModel.value = settings.chatModeModel || settings.chatgptModel;
  if (els.workModeModel) els.workModeModel.value = settings.workModeModel || settings.chatgptModel;
  els.autoClaim.checked = settings.autoClaim;
  updateRunButton(await isThisWindowRunning());
  renderCandidates();
}

els.toggleRunBtn.addEventListener("click", async () => {
  const running = await isThisWindowRunning();
  if (!running) {
    // "Run in background" implies auto-claim - starting this window's worker
    // alone does nothing for background auto-claim work unless the autoClaim
    // preference is also on, so this button turns both on together (matching
    // what the single old on/off toggle used to do in one click). The
    // Settings checkbox still exists for turning it on ahead of time, or for
    // a window that's only meant to drain "Run selected" picks.
    await autogenSaveSettings({ autoClaim: true });
    els.autoClaim.checked = true;
  }
  const type = running ? "AUTOGEN_STOP_WINDOW" : "AUTOGEN_START_WINDOW";
  chrome.runtime.sendMessage({ type, windowId: myWindowId }, () => updateRunButton(!running));
});

if (els.testChatGptModelBtn) {
  els.testChatGptModelBtn.addEventListener("click", async () => {
    const hint = els.testChatGptModelHint;
    const btn = els.testChatGptModelBtn;
    btn.disabled = true;
    if (hint) hint.textContent = "Applying the model on the open ChatGPT tab…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AUTOGEN_TEST_CHATGPT_MODEL",
        windowId: myWindowId,
        chatModeModel: els.chatModeModel?.value || "asis",
        workModeModel: els.workModeModel?.value || "asis",
      });
      if (hint) {
        hint.textContent = response?.detail || response?.error || "Model test finished.";
      }
    } catch (error) {
      if (hint) hint.textContent = String(error?.message || error);
    } finally {
      btn.disabled = false;
    }
  });
}

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await autogenSaveSettings({
    serverBaseUrl: els.serverUrl.value,
    username: els.email.value,
    password: els.password.value,
    engine: els.engine?.value || AUTOGEN_DEFAULT_SETTINGS.engine,
    fetchPeriodSeconds: els.fetchPeriod.value,
    maxTryCount: els.maxTry.value,
    maxWaitSeconds: els.maxWait.value,
    startChatMode: els.startChat?.value || AUTOGEN_DEFAULT_SETTINGS.startChatMode,
    retryChatMode: els.retryChat?.value || AUTOGEN_DEFAULT_SETTINGS.retryChatMode,
    threadResetMode: els.threadReset?.value || AUTOGEN_DEFAULT_SETTINGS.threadResetMode,
    threadResetAfter: els.threadResetAfter?.value || AUTOGEN_DEFAULT_SETTINGS.threadResetAfter,
    // Keep chatgptModel in sync as a backward-compatible fallback for older configs/workers.
    chatgptModel: els.chatModeModel?.value || AUTOGEN_DEFAULT_SETTINGS.chatgptModel,
    chatModeModel: els.chatModeModel?.value || AUTOGEN_DEFAULT_SETTINGS.chatModeModel,
    workModeModel: els.workModeModel?.value || AUTOGEN_DEFAULT_SETTINGS.workModeModel,
    modelModeSettingsVersion: 1,
    autoClaim: els.autoClaim.checked,
  });
  await loadSettings();
  els.savedHint.classList.remove("hidden");
  setTimeout(() => els.savedHint.classList.add("hidden"), 1500);
  void refreshDriveStatus();
});

function showConfigHint(message, ok = true) {
  els.configIoHint.textContent = message;
  els.configIoHint.style.color = ok ? "#1a7f37" : "#cf222e";
  els.configIoHint.classList.remove("hidden");
  setTimeout(() => els.configIoHint.classList.add("hidden"), 3000);
}

els.exportConfigBtn.addEventListener("click", async () => {
  const settings = await autogenGetSettings();
  const config = {};
  for (const key of AUTOGEN_EXPORTABLE_KEYS) config[key] = settings[key];
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "autogen-config.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showConfigHint("Config exported.");
});

els.importConfigBtn.addEventListener("click", () => els.importConfigFile.click());

els.importConfigFile.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = ""; // allow re-importing the same file
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Not a JSON object");
    }
    const partial = {};
    for (const key of AUTOGEN_EXPORTABLE_KEYS) {
      if (key in parsed) partial[key] = parsed[key];
    }
    await autogenSaveSettings(partial); // normalizes + clamps, ignores unknown keys
    await loadSettings();
    showConfigHint("Config imported.");
  } catch (error) {
    showConfigHint(`Import failed: ${String(error?.message || error)}`, false);
  }
});

/* ------------------------------------------------------------------ *
 * Applications tab: candidate list + run/stop                         *
 * ------------------------------------------------------------------ */

/** Loads whatever was cached from the last Fetch (if any) - no network call, so
 * switching to the Applications tab is instant and doesn't hit the server on its
 * own. Use the "Fetch" button for an on-demand, up-to-date pull from the server. */
async function loadCandidatesFromStorage() {
  const data = await chrome.storage.local.get({ autogenCandidates: [] });
  candidates = Array.isArray(data.autogenCandidates) ? data.autogenCandidates : [];
  renderCandidates();
}

/** Pulls the current application list (each with its current `status`) from the
 * server and persists it to chrome.storage.local so it survives closing the panel. */
async function refreshCandidates() {
  els.candidatesList.innerHTML = "";
  els.candidatesEmpty.textContent = "Fetching…";
  els.candidatesEmpty.classList.remove("hidden");
  try {
    const settings = await autogenGetSettings();
    candidates = await autogenFetchCandidates(settings);
    await chrome.storage.local.set({ autogenCandidates: candidates });
    renderCandidates();
  } catch (error) {
    candidates = [];
    els.candidatesList.innerHTML = "";
    els.candidatesEmpty.textContent = `Failed to fetch: ${String(error?.message || error)}`;
    els.candidatesEmpty.classList.remove("hidden");
  }
}

function queueStatusToBadge(status) {
  switch (status) {
    case "completed":
      return { label: "Completed", cls: "success" };
    case "failed":
      return { label: "Failed", cls: "error" };
    case "skipped":
      return { label: "Skipped", cls: "neutral" };
    case "processing":
      return { label: "Processing", cls: "pending" };
    case "queued":
      return { label: "Queued", cls: "pending" };
    default:
      return null;
  }
}

function renderCandidates() {
  els.candidatesList.innerHTML = "";
  els.candidatesEmpty.classList.toggle("hidden", candidates.length > 0);
  if (candidates.length === 0) {
    els.candidatesEmpty.textContent = "No applications need generation.";
  }

  for (const app of candidates) {
    const hasProfile = app.profile_id != null;
    // A generating row belongs to a worker; queue and failed rows can be run (failed ones are re-queued first).
    const runnable = hasProfile && app.status !== "generating";
    const row = document.createElement("label");
    row.className = `candidate-row${runnable ? "" : " no-template"}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "candidate-checkbox";
    checkbox.dataset.id = app.id;
    checkbox.dataset.status = app.status || "";
    checkbox.disabled = !runnable;

    const body = document.createElement("div");
    body.className = "candidate-body";

    const queued = queueStatusCache[app.id];
    const queueBadge = queued ? queueStatusToBadge(queued.status) : null;
    const serverStatus = String(app.status || "");
    const badge = queueBadge || {
      label:
        serverStatus === "queue"
          ? "Queue"
          : serverStatus === "failed"
            ? "Failed"
            : serverStatus === "generating"
              ? "Generating"
              : serverStatus,
      cls: serverStatus === "failed" ? "error" : "pending",
    };

    const templateChip = hasProfile
      ? `<span class="template-chip">${escapeHtml(app.candidate || `Profile ${app.profile_id}`)}</span>`
      : `<span class="template-chip missing">No profile</span>`;
    const error = (queued && queued.error) || (serverStatus === "failed" ? app.generation_error : "");

    body.innerHTML = `
      <div class="candidate-title">
        <span class="candidate-seq">#${escapeHtml(app.id)}</span>
        <span class="candidate-role">${escapeHtml(app.role || "(no role)")}</span>
        <span class="candidate-meta-right">
          <span class="status-badge status-${badge.cls}">${escapeHtml(badge.label)}</span>
        </span>
      </div>
      <div class="candidate-sub">
        <span>${escapeHtml(app.company_name || "")}</span>
        ${templateChip}
        <span>${escapeHtml(formatDate(app.created_at))}</span>
      </div>
      ${error ? `<div class="candidate-sub">${escapeHtml(String(error))}</div>` : ""}
    `;

    row.appendChild(checkbox);
    row.appendChild(body);
    els.candidatesList.appendChild(row);
  }

  syncSelectionUi();
}

function selectableCheckboxes() {
  return [...els.candidatesList.querySelectorAll(".candidate-checkbox:not(:disabled)")];
}

function syncSelectionUi() {
  const boxes = selectableCheckboxes();
  const checked = boxes.filter((b) => b.checked);
  els.runSelectedBtn.disabled = checked.length === 0;
  els.selectAllCandidates.checked = boxes.length > 0 && checked.length === boxes.length;
  els.selectAllCandidates.indeterminate = checked.length > 0 && checked.length < boxes.length;
}

els.candidatesList.addEventListener("change", (event) => {
  if (event.target.classList.contains("candidate-checkbox")) syncSelectionUi();
});

els.selectAllCandidates.addEventListener("change", () => {
  const checked = els.selectAllCandidates.checked;
  selectableCheckboxes().forEach((b) => {
    b.checked = checked;
  });
  syncSelectionUi();
});

els.fetchCandidatesBtn.addEventListener("click", () => refreshCandidates());

els.clearCandidatesBtn.addEventListener("click", async () => {
  candidates = [];
  await chrome.storage.local.set({ autogenCandidates: [] });
  // Also resets the "N queued/processing/completed/failed" progress readout -
  // that comes from autogenQueueStatus, not the candidate list, so clearing
  // just the list alone left old done/failed counts on screen.
  chrome.runtime.sendMessage({ type: "AUTOGEN_CLEAR_QUEUE_STATUS" });
  renderCandidates();
});

els.runSelectedBtn.addEventListener("click", async () => {
  const checked = selectableCheckboxes().filter((b) => b.checked);
  const ids = checked.map((b) => b.dataset.id);
  if (ids.length === 0) return;
  // Only queued rows can be claimed: put failed ones back in the queue first.
  const failedIds = checked.filter((b) => b.dataset.status === "failed").map((b) => Number(b.dataset.id));
  if (failedIds.length) {
    try {
      await autogenRequeue(await autogenGetSettings(), failedIds);
    } catch (error) {
      els.candidatesProgress.textContent = `Could not re-queue failed rows: ${String(error?.message || error)}`;
      return;
    }
  }
  // Queues the ids on the shared queue, then starts THIS window's worker so
  // it (and any other already-running window) starts draining them with the
  // configured engine.
  chrome.runtime.sendMessage({ type: "AUTOGEN_ENQUEUE", ids }, () => {
    chrome.runtime.sendMessage({ type: "AUTOGEN_START_WINDOW", windowId: myWindowId }, () => updateRunButton(true));
  });
  els.selectAllCandidates.checked = false;
  selectableCheckboxes().forEach((b) => {
    b.checked = false;
  });
  syncSelectionUi();
});

els.stopSelectedBtn.addEventListener("click", () => {
  // Stops ONLY this window's worker - the shared queue and any other running
  // window are left untouched. Immediate feedback here; background.js's own
  // status updates follow shortly after via the storage listener below.
  els.candidatesProgress.textContent = "Stopping this window…";
  els.candidatesProgress.classList.remove("idle");
  els.candidatesProgress.classList.add("busy");
  chrome.runtime.sendMessage({ type: "AUTOGEN_STOP_WINDOW", windowId: myWindowId }, () => updateRunButton(false));
});

function renderQueueProgress(statusMap) {
  const counts = { queued: 0, processing: 0, completed: 0, failed: 0, skipped: 0 };
  for (const v of Object.values(statusMap)) {
    if (v && counts[v.status] != null) counts[v.status] += 1;
  }
  const active = counts.queued + counts.processing;
  const done = counts.completed;
  const bad = counts.failed + counts.skipped;
  if (active === 0 && done === 0 && bad === 0) {
    els.candidatesProgress.textContent = "";
    els.candidatesProgress.classList.add("idle");
    els.candidatesProgress.classList.remove("busy");
    return;
  }
  const parts = [];
  if (active > 0) parts.push(`${counts.processing} running`);
  if (counts.queued > 0) parts.push(`${counts.queued} queued`);
  if (done > 0) parts.push(`${done} done`);
  if (bad > 0) parts.push(`${bad} failed`);
  els.candidatesProgress.textContent = parts.join(" · ");
  els.candidatesProgress.classList.toggle("busy", active > 0);
  els.candidatesProgress.classList.toggle("idle", active === 0);
}

/* ------------------------------------------------------------------ *
 * Monitor tab: this window's status card + activity log               *
 * ------------------------------------------------------------------ */

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("error") || s.includes("interrupted")) return "error";
  if (s.includes("retry") || s.includes("processing") || s.includes("claimed")) return "pending";
  if (s.includes("completed")) return "success";
  return "neutral";
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

function isInFlightStatus(status) {
  const s = String(status || "").toLowerCase();
  return s.includes("retry") || s.includes("processing") || s.includes("claimed");
}

/** Shown only while this window is working on an application. Idle windows
 * keep history in the activity log and the session counters. */
function renderCurrentJob(row, busy) {
  els.windowCardContainer.innerHTML = "";
  if (!busy || !row || !isInFlightStatus(row.status)) return;

  const title = [row.company, row.jobTitle].filter(Boolean).join(" · ") || "Application";
  const card = document.createElement("div");
  card.className = "card current-job-card";
  card.setAttribute("role", "status");
  card.innerHTML = `
    <div class="field-label">Current job</div>
    <div class="current-job-line">
      <span class="status-badge status-${statusClass(row.status)}">${escapeHtml(row.status)}</span>
      <span class="current-job-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
    </div>
  `;
  els.windowCardContainer.appendChild(card);
}

/** Renders the "This window" status tile + session-total stat tiles at the
 * top of the Monitor tab. Session totals cover every window; "This window"
 * reflects only whether THIS panel's window currently has work in flight. */
function renderSummary({ busy, running }) {
  els.summaryWindowStatus.textContent = busy ? "Busy" : running ? "Idle (running)" : "Idle";
}

els.resetStatsBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ autogenSessionStats: { completed: 0, failed: 0, skipped: 0 } });
});

function formatActivityEntry(entry) {
  const timestamp = new Date(entry.timestamp || Date.now()).toLocaleString();
  let tag = "";
  if (entry.tabLabel) tag = `[${String(entry.tabLabel).slice(0, 40)}] `;
  else if (entry.windowId != null) tag = `[Win ${entry.windowId}] `;
  return `[${timestamp}] - ${tag}${entry.message}`;
}

function renderActivityLog(entries) {
  els.activityLog.value = entries.map(formatActivityEntry).join("\n");
  els.activityLog.scrollTop = els.activityLog.scrollHeight;
}

els.clearActivityLogBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ autogenActivityLog: [] });
  renderActivityLog([]);
});

async function refresh() {
  const data = await chrome.storage.local.get({
    autogenWindowStatus: {},
    autogenWindowBusy: {},
    autogenRunningWindows: {},
    autogenActivityLog: [],
    autogenQueueStatus: {},
    autogenSessionStats: { completed: 0, failed: 0, skipped: 0 },
  });

  const windowStatus = data.autogenWindowStatus && typeof data.autogenWindowStatus === "object" ? data.autogenWindowStatus : {};
  const windowBusy = data.autogenWindowBusy && typeof data.autogenWindowBusy === "object" ? data.autogenWindowBusy : {};
  const runningWindows = data.autogenRunningWindows && typeof data.autogenRunningWindows === "object" ? data.autogenRunningWindows : {};

  renderCurrentJob(windowStatus[myWindowId] || null, Boolean(windowBusy[myWindowId]));
  renderActivityLog(Array.isArray(data.autogenActivityLog) ? data.autogenActivityLog : []);

  queueStatusCache = data.autogenQueueStatus && typeof data.autogenQueueStatus === "object" ? data.autogenQueueStatus : {};
  renderQueueProgress(queueStatusCache);

  renderSummary({
    busy: Boolean(windowBusy[myWindowId]),
    running: Boolean(runningWindows[myWindowId]),
  });
  updateRunButton(Boolean(runningWindows[myWindowId]));

  const stats = data.autogenSessionStats && typeof data.autogenSessionStats === "object" ? data.autogenSessionStats : {};
  els.summaryCompleted.textContent = String(stats.completed || 0);
  els.summaryFailed.textContent = String(stats.failed || 0);
  els.summarySkipped.textContent = String(stats.skipped || 0);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.autogenSettings) {
    void loadSettings();
  }
  if (changes.autogenWindowStatus || changes.autogenWindowBusy || changes.autogenRunningWindows || changes.autogenSessionStats) {
    refresh();
  }
  if (changes.autogenActivityLog) {
    renderActivityLog(Array.isArray(changes.autogenActivityLog.newValue) ? changes.autogenActivityLog.newValue : []);
  }
  if (changes.autogenQueueStatus) {
    queueStatusCache =
      changes.autogenQueueStatus.newValue && typeof changes.autogenQueueStatus.newValue === "object"
        ? changes.autogenQueueStatus.newValue
        : {};
    renderQueueProgress(queueStatusCache);
    renderCandidates(); // reflect per-row status live as windows finish
  }
});

if (window.SmartJobTheme) {
  window.SmartJobTheme.initTheme();
  window.SmartJobTheme.wireThemeToggle();
  window.SmartJobTheme.wireThemeOptions();
}

(async () => {
  myWindowId = (await chrome.windows.getCurrent()).id;
  await loadSettings();
  void refreshDriveStatus();
  await refresh();
})();
