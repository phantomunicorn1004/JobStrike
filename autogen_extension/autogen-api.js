/**
 * Talks to JobStrike (app/api/autogen/*, /api/auth/*).
 *
 * Sign-in: POST /api/auth/login {username, password} returns the account's
 * extension API key, sent as X-Extension-Key on every call (the same key the
 * JobStrike extension uses). A 401 signs in again once.
 *
 * Two engines produce the resume JSON; everything else is shared:
 *   chatgpt  this extension pastes the prompt into a chatgpt.com tab and sends
 *            the raw reply to submit-answer;
 *   api      the server calls OpenAI with its own key (generate).
 * Either way the server extracts the JSON, puts back the kit's facts, checks
 * every placeholder and saves it, answering
 * { status: "Success" } | { status: "Error", detail, retryable, claimLost? }.
 */

const AUTOGEN_DEFAULT_SETTINGS = {
  serverBaseUrl: "http://localhost:3000",
  username: "",
  password: "",
  engine: "chatgpt",
  fetchPeriodSeconds: 15,
  maxTryCount: 3,
  maxWaitSeconds: 600,
  // Each application starts in a fresh temporary chat, so no earlier job,
  // candidate or ChatGPT memory is in context.
  startChatMode: "temporary",
  retryChatMode: "temporary",
  // Only matters with "Use the open chat": a fresh temporary chat after this many.
  threadResetMode: "temporary",
  threadResetAfter: 10,
  chatgptModel: "high",
  chatModeModel: "high",
  workModeModel: "extra-high",
  modelModeSettingsVersion: 1,
  // When a running window's selected queue is empty, claim the oldest queued application.
  autoClaim: false,
};

/** Moved between machines by Export / Import config. The password is never exported. */
const AUTOGEN_EXPORTABLE_KEYS = [
  "serverBaseUrl",
  "username",
  "engine",
  "fetchPeriodSeconds",
  "maxTryCount",
  "maxWaitSeconds",
  "retryChatMode",
  "startChatMode",
  "threadResetMode",
  "threadResetAfter",
  "chatgptModel",
  "chatModeModel",
  "workModeModel",
  "modelModeSettingsVersion",
  "autoClaim",
];

const AUTOGEN_ENGINES = ["chatgpt", "api"];
const AUTOGEN_RETRY_CHAT_MODES = ["reuse", "reload", "new", "temporary", "delete-new"];
const AUTOGEN_START_CHAT_MODES = ["asis", "temporary"];
const AUTOGEN_THREAD_RESET_MODES = ["keep", "temporary"];
const AUTOGEN_CHATGPT_MODELS = [
  "asis",
  "instant",
  "medium",
  "high",
  "extra-high",
  "pro",
  "pro-standard",
  "pro-extended",
];

function autogenClampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function autogenPickMode(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function autogenNormalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const hasSeparateModeModels = Number(source.modelModeSettingsVersion) >= 1;
  return {
    serverBaseUrl: String(source.serverBaseUrl || AUTOGEN_DEFAULT_SETTINGS.serverBaseUrl)
      .trim()
      .replace(/\/+$/, ""),
    // Older configs called the JobStrike username "email".
    username: String(source.username || source.email || "").trim(),
    password: String(source.password || ""),
    engine: autogenPickMode(source.engine, AUTOGEN_ENGINES, AUTOGEN_DEFAULT_SETTINGS.engine),
    fetchPeriodSeconds: autogenClampInt(source.fetchPeriodSeconds, 5, 60, AUTOGEN_DEFAULT_SETTINGS.fetchPeriodSeconds),
    maxTryCount: autogenClampInt(source.maxTryCount, 1, 10, AUTOGEN_DEFAULT_SETTINGS.maxTryCount),
    maxWaitSeconds: autogenClampInt(source.maxWaitSeconds, 30, 1200, AUTOGEN_DEFAULT_SETTINGS.maxWaitSeconds),
    retryChatMode: autogenPickMode(source.retryChatMode, AUTOGEN_RETRY_CHAT_MODES, AUTOGEN_DEFAULT_SETTINGS.retryChatMode),
    startChatMode: autogenPickMode(source.startChatMode, AUTOGEN_START_CHAT_MODES, AUTOGEN_DEFAULT_SETTINGS.startChatMode),
    threadResetMode: autogenPickMode(
      source.threadResetMode,
      AUTOGEN_THREAD_RESET_MODES,
      AUTOGEN_DEFAULT_SETTINGS.threadResetMode,
    ),
    threadResetAfter: autogenClampInt(source.threadResetAfter, 1, 50, AUTOGEN_DEFAULT_SETTINGS.threadResetAfter),
    chatgptModel: autogenPickMode(source.chatgptModel, AUTOGEN_CHATGPT_MODELS, AUTOGEN_DEFAULT_SETTINGS.chatgptModel),
    chatModeModel: autogenPickMode(
      hasSeparateModeModels ? source.chatModeModel || source.chatgptModel : source.chatgptModel,
      AUTOGEN_CHATGPT_MODELS,
      AUTOGEN_DEFAULT_SETTINGS.chatModeModel,
    ),
    workModeModel: autogenPickMode(
      hasSeparateModeModels ? source.workModeModel || source.chatModeModel || source.chatgptModel : source.chatgptModel,
      AUTOGEN_CHATGPT_MODELS,
      AUTOGEN_DEFAULT_SETTINGS.workModeModel,
    ),
    modelModeSettingsVersion: 1,
    autoClaim: Boolean(source.autoClaim ?? source.enabled),
  };
}

async function autogenGetSettings() {
  const data = await chrome.storage.local.get({ autogenSettings: AUTOGEN_DEFAULT_SETTINGS });
  return autogenNormalizeSettings(data.autogenSettings);
}

async function autogenSaveSettings(partial) {
  const current = await autogenGetSettings();
  const incoming = partial && typeof partial === "object" ? { ...partial } : {};
  // Legacy configs only knew chatgptModel: apply it to both Chat and Work mode.
  if (
    Object.prototype.hasOwnProperty.call(incoming, "chatgptModel") &&
    Number(incoming.modelModeSettingsVersion || 0) < 1
  ) {
    incoming.chatModeModel = incoming.chatgptModel;
    incoming.workModeModel = incoming.chatgptModel;
  }
  const next = autogenNormalizeSettings({ ...current, ...incoming, modelModeSettingsVersion: 1 });
  await chrome.storage.local.set({ autogenSettings: next });
  if (next.serverBaseUrl !== current.serverBaseUrl || next.username !== current.username || next.password !== current.password) {
    await autogenClearAuth();
  }
  return next;
}

function autogenParseApiBody(text, status) {
  const raw = String(text || "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_e) {
    if (/ngrok|ERR_NGROK|<!doctype html/i.test(raw)) {
      throw new Error(
        `JobStrike answered with a web page instead of JSON (HTTP ${status}). Check the Server URL.`,
      );
    }
    return { message: raw || `HTTP ${status}` };
  }
}

/* ------------------------------------------------------------------ *
 * Sign-in: the account's extension API key                           *
 * ------------------------------------------------------------------ */

async function autogenClearAuth() {
  await chrome.storage.local.set({ autogenAuth: null });
}

/** Signs in and caches the extension key for this server + username. */
async function autogenLogin(settings) {
  if (!settings.username || !settings.password) {
    throw new Error("Set Username and Password in AutoGen Settings.");
  }
  const res = await fetch(`${settings.serverBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
    body: JSON.stringify({ username: settings.username, password: settings.password }),
  });
  const data = autogenParseApiBody(await res.text(), res.status);
  if (!res.ok) {
    throw new Error(`Sign-in failed (${res.status}): ${data.error || data.message || "unknown error"}`);
  }
  const key = String(data.extensionApiKey || "").trim();
  if (!key) throw new Error("Sign-in succeeded but JobStrike returned no extension key.");
  const auth = {
    key,
    username: settings.username,
    serverBaseUrl: settings.serverBaseUrl,
    displayName: data.user?.username || settings.username,
  };
  await chrome.storage.local.set({ autogenAuth: auth });
  return auth;
}

async function autogenGetAuth(settings) {
  const data = await chrome.storage.local.get({ autogenAuth: null });
  const cached = data.autogenAuth;
  if (cached && cached.key && cached.username === settings.username && cached.serverBaseUrl === settings.serverBaseUrl) {
    return cached;
  }
  return autogenLogin(settings);
}

/**
 * Calls JobStrike with the extension key. A 401 signs in again once.
 * Throws on any other non-2xx status with the server's message.
 */
async function autogenApiFetch(settings, path, options = {}) {
  const send = async (key) => {
    const headers = {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...(options.headers || {}),
      "X-Extension-Key": key,
    };
    const res = await fetch(`${settings.serverBaseUrl}${path}`, { ...options, headers });
    return { res, data: autogenParseApiBody(await res.text(), res.status) };
  };

  let auth = await autogenGetAuth(settings);
  let { res, data } = await send(auth.key);
  if (res.status === 401) {
    await autogenClearAuth();
    auth = await autogenLogin(settings);
    ({ res, data } = await send(auth.key));
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && (data.error || data.detail || data.message)
        ? data.error || data.detail || data.message
        : JSON.stringify(data);
    throw new Error(`JobStrike ${path} failed (${res.status}): ${message}`);
  }
  return data;
}

function autogenJsonPost(body) {
  return { method: "POST", body: JSON.stringify(body || {}) };
}

/** Signed-in account, for the Settings connection check. */
async function autogenFetchMe(settings) {
  const data = await autogenApiFetch(settings, "/api/auth/me", { method: "GET" });
  return data.user || null;
}

/* ------------------------------------------------------------------ *
 * Queue                                                              *
 * ------------------------------------------------------------------ */

/** Queued, generating and failed applications, newest first (Applications tab). */
async function autogenFetchCandidates(settings) {
  const data = await autogenApiFetch(settings, "/api/autogen/applications", { method: "GET" });
  return Array.isArray(data.applications) ? data.applications : [];
}

/** Puts failed (or completed) applications back in the queue: { queued: n }. */
async function autogenRequeue(settings, ids) {
  return autogenApiFetch(settings, "/api/autogen/enqueue", autogenJsonPost({ ids }));
}

/**
 * Claims the oldest queued application with its prompt:
 * { application } or { application: null, skipped: [{ id, reason }] }.
 */
async function autogenFetchNextApplication(settings) {
  return autogenApiFetch(settings, "/api/autogen/next-application", { method: "GET" });
}

/**
 * Claims one chosen application: { application } or
 * { application: null, reason, detail } (not_found | not_claimable | no_profile |
 * no_kit | no_job_description | fictional_kit | kit_invalid; the server marks the
 * last five failed with the detail).
 */
async function autogenClaimApplicationById(settings, applicationId) {
  return autogenApiFetch(settings, `/api/autogen/applications/${applicationId}/claim`, autogenJsonPost({}));
}

/**
 * Heartbeat while still working: { ok: true, claimedAt } (use the new stamp) or
 * { ok: false } when another worker has taken the application over.
 */
async function autogenRefreshClaim(settings, applicationId, claimedAt) {
  return autogenApiFetch(
    settings,
    `/api/autogen/applications/${applicationId}/refresh-claim`,
    autogenJsonPost({ claimedAt }),
  );
}

/** Network or server failures become a retryable Error outcome, like a bad answer. */
async function autogenOutcome(promise) {
  try {
    const result = await promise;
    if (result && (result.status === "Success" || result.status === "Error")) return result;
    return { status: "Error", detail: "JobStrike sent an unexpected answer.", retryable: true };
  } catch (error) {
    return { status: "Error", detail: String(error?.message || error), retryable: true };
  }
}

/** ChatGPT engine: the tab's raw reply; the server extracts and checks the JSON. */
async function autogenSubmitAnswer(settings, applicationId, { answer, claimedAt, attempt, chatgptModel }) {
  return autogenOutcome(
    autogenApiFetch(
      settings,
      `/api/autogen/applications/${applicationId}/submit-answer`,
      autogenJsonPost({ answer, claimedAt, attempt, chatgptModel }),
    ),
  );
}

/** API engine: the server generates with its OpenAI key, then checks and saves. */
async function autogenGenerateViaApi(settings, applicationId, { claimedAt, attempt }) {
  return autogenOutcome(
    autogenApiFetch(
      settings,
      `/api/autogen/applications/${applicationId}/generate`,
      autogenJsonPost({ claimedAt, attempt }),
    ),
  );
}

/** Out of retries: the application becomes failed with the reason. */
async function autogenReportFailure(settings, applicationId, claimedAt, detail) {
  return autogenApiFetch(
    settings,
    `/api/autogen/applications/${applicationId}/report-failure`,
    autogenJsonPost({ claimedAt, detail: detail || "" }),
  );
}

/** Stopped or blocked: the application goes back to the queue for later. */
async function autogenReleaseClaim(settings, applicationId, claimedAt) {
  return autogenApiFetch(
    settings,
    `/api/autogen/applications/${applicationId}/release`,
    autogenJsonPost({ claimedAt }),
  );
}
