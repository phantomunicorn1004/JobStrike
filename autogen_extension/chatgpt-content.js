/**
 * Runs on chatgpt.com / chat.openai.com. Selectors below match ChatGPT's UI as of
 * writing and are the most likely thing to break if OpenAI changes their markup -
 * check these first if AutoGen starts failing with "prompt box not found".
 *
 * Message protocol so the background script can poll status (and log
 * "thinking" ticks / stay interruptible) instead of one long blocking call:
 *   AUTOGEN_PING              - liveness check; background injects this script if unanswered.
 *   AUTOGEN_INSERT_AND_SEND   - types the prompt and clicks send, responds once sent.
 *   AUTOGEN_DELETE_CURRENT_CHAT - deletes the open saved conversation when ChatGPT shows a delete control.
 *   AUTOGEN_CHECK_STATUS      - reports {state: "thinking"} or {state: "done", answer}.
 *   AUTOGEN_SET_MODEL         - sets an available ChatGPT model/reasoning choice once.
 *   AUTOGEN_ENSURE_HIGH_MODEL - no-op kept for older callers.
 */
const AUTOGEN_SELECTORS = {
  promptBox: "#prompt-textarea",
  composer: "form[data-chatgpt-composer]",
  composerBox: 'div.ProseMirror[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]',
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[type="submit"][aria-label="Send"]',
  legacySendButton: '[data-testid="send-button"]',
  modelTrigger: 'button[aria-label="Select ChatGPT model"]',
  stopButton: '[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Stop"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  assistantMarkdown: '[data-markdown-text-style="assistant-message"]',
  conversationTurn: '[data-testid^="conversation-turn-"]',
  conversationTurnKey: "[data-turn-key]",
  jsonCodeBlock: '[data-markdown-copy="code-block"]',
  citationChip: "[data-content-reference-start]",
  fileCitation: 'button[data-testid="chatgpt-library-file-citation"]',
};

/**
 * ChatGPT's send button marks itself disabled via `aria-disabled="true"`
 * rather than the native `disabled` attribute/property - it stays a live,
 * focusable, click()-able DOM node the whole time, and its own onClick
 * handler is what actually checks aria-disabled and no-ops if it's "true".
 * `sendBtn.disabled` therefore always reads `false` on this button no matter
 * its real state, which used to make every caller here think it was always
 * enabled and fire a `.click()` that ChatGPT silently swallowed while it was
 * genuinely still disabled (e.g. mid paste-to-attachment processing).
 */
function autogenIsSendButtonEnabled(btn) {
  return Boolean(btn) && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
}

// Visible labels on ChatGPT's composer model/reasoning picker. Matching is by
// semantic text rather than hashed classes. Availability varies by plan/workspace.
const AUTOGEN_MODEL_LABELS = [
  "Instant",
  "Medium",
  "High",
  "Extra high",
  "Extra High",
  "Extra-high",
  "Pro",
  "Pro Standard",
  "Pro Extended",
];
const AUTOGEN_MODEL_CHOICES = {
  instant: ["Instant"],
  medium: ["Medium"],
  high: ["High"],
  "extra-high": ["Extra high", "Extra High", "Extra-high"],
  pro: ["Pro"],
  "pro-standard": ["Pro Standard", "Pro - Standard"],
  "pro-extended": ["Pro Extended", "Pro - Extended"],
};
// `data-selected-reasoning-effort`/related semantic values on the picker button.
const AUTOGEN_MODEL_EFFORTS = {
  instant: ["instant"],
  medium: ["medium"],
  high: ["high"],
  "extra-high": ["extra-high", "extra_high", "extrahigh", "xhigh"],
  pro: ["pro"],
  "pro-standard": ["pro-standard", "pro_standard", "prostandard"],
  "pro-extended": ["pro-extended", "pro_extended", "proextended"],
};
// Only these choices map to positions on the Chat reasoning-effort slider.
const AUTOGEN_MODEL_ORDER = ["instant", "medium", "high", "extra-high"];

// True once the stop button has been observed at least once for the current
// prompt, so AUTOGEN_CHECK_STATUS doesn't report "done" before generation
// actually starts (there's a brief gap between clicking send and the stop
// button appearing).
let autogenGenerationStarted = false;
let autogenAnswerBaseline = "";

// The stop button disappearing means the network stream closed, but React
// committing the final chunk(s) of that stream into the DOM is a separate,
// asynchronous step - under load (e.g. many lanes' background windows
// competing for CPU) that commit can lag behind the stop button by long
// enough for a poll to land in between and read a truncated mid-render
// snapshot. Requiring the extracted text to be identical across two
// consecutive polls (with the stop button absent both times) confirms the
// DOM has actually settled before treating an answer as final.
let autogenPendingStableAnswer = null;
let autogenPendingStableSince = 0;
let autogenStopObserved = false;
let autogenAnswerBaselineRoot = null;
// A missing/renamed Stop control must not keep the worker in "thinking" forever.
// Such responses need a longer quiet interval to avoid mistaking a stalled render
// for a completed one. Polling currently runs every three seconds.
const AUTOGEN_SETTLE_AFTER_STOP_MS = 3000;
const AUTOGEN_SETTLE_WITHOUT_STOP_MS = 12000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AUTOGEN_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "AUTOGEN_DELETE_CURRENT_CHAT") {
    autogenDeleteCurrentChat()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "AUTOGEN_INSERT_AND_SEND") {
    autogenInsertAndSend(message.prompt || "")
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "AUTOGEN_CHECK_STATUS") {
    try {
      sendResponse(autogenCheckStatus());
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
    return false;
  }
  if (message?.type === "AUTOGEN_SELF_TEST") {
    autogenSelfTest()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "AUTOGEN_GET_MODE") {
    return sendResponse({ ok: true, mode: window.AutoGenModeDetector?.detect?.() || "chat" });
  }

  if (message?.type === "AUTOGEN_WAIT_COMPOSER") {
    autogenWaitForPromptBox(20000)
      .then((box) => sendResponse({ ok: Boolean(box) }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "AUTOGEN_SET_MODEL") {
    autogenSetModel(message.model, message.waitMs)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "AUTOGEN_ENSURE_HIGH_MODEL") {
    // Kept for older callers; no longer switches models (Option A: use current).
    sendResponse({ ok: true, skipped: true, model: autogenReadModelLabel() || "current" });
    return false;
  }
  return undefined;
});

function autogenControlText(el) {
  return autogenNormalizeLabel(`${el?.textContent || ""} ${el?.getAttribute?.("aria-label") || ""}`);
}

function autogenHoverElement(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const common = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + Math.min(12, rect.width / 2),
    clientY: rect.top + rect.height / 2,
  };
  el.dispatchEvent(new PointerEvent("pointerover", common));
  el.dispatchEvent(new MouseEvent("mouseover", common));
}

/** Options button for the open saved chat. Sidebar ••• is the current control; the old header label still counts. */
function autogenFindCurrentChatMenuButton() {
  const named =
    document.querySelector('button[data-testid="conversation-options-button"]') ||
    document.querySelector('button[aria-label="Open conversation options"]');
  if (named) return named;

  const path = location.pathname.replace(/\/$/, "");
  const link = document.querySelector(`a[href="${path}"], a[href="${path}/"]`);
  let node = link?.parentElement || null;
  for (let depth = 0; depth < 6 && node; depth += 1) {
    const button = [...node.querySelectorAll("button")].find((btn) => {
      if (link && (btn === link || link.contains(btn))) return false;
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      const testId = (btn.getAttribute("data-testid") || "").toLowerCase();
      return (
        /option|more action|chat menu/.test(label) ||
        /option|history/.test(testId) ||
        btn.getAttribute("aria-haspopup") === "menu"
      );
    });
    if (button) return button;
    node = node.parentElement;
  }

  return [...document.querySelectorAll("button")].find((btn) => {
    if (btn.closest("form[data-chatgpt-composer]")) return false;
    return /conversation options|chat options|more options/i.test(btn.getAttribute("aria-label") || "");
  });
}

function autogenFindDeleteMenuItem() {
  const nodes = document.querySelectorAll(
    '[role="menuitem"], [role="menuitemradio"], [data-testid="delete-chat-menu-item"], button',
  );
  for (const el of nodes) {
    if (el.closest("form[data-chatgpt-composer]")) continue;
    const text = autogenControlText(el);
    if (/^delete( chat| conversation)?$/i.test(text)) return el;
  }
  return null;
}

function autogenFindDeleteConfirm(deleteItem) {
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  const scopes = dialogs.length ? dialogs : [document];
  for (const scope of scopes) {
    const buttons = scope.querySelectorAll("button, [role='button']");
    for (const el of buttons) {
      if (el === deleteItem) continue;
      if (/^delete$/i.test(autogenControlText(el))) return el;
    }
  }
  return null;
}

async function autogenWaitForControl(read, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = read();
    if (found) return found;
    await autogenDelay(150);
  }
  return read();
}

/** Deletes the open saved conversation from the sidebar ••• menu, then confirms. */
async function autogenDeleteCurrentChat() {
  if (!/\/c\/[^/]+/i.test(location.pathname)) {
    return { ok: true, skipped: true };
  }

  const path = location.pathname.replace(/\/$/, "");
  const link = document.querySelector(`a[href="${path}"], a[href="${path}/"]`);
  autogenHoverElement(link);
  autogenHoverElement(link?.parentElement);
  await autogenDelay(200);

  const menuBtn = autogenFindCurrentChatMenuButton();
  if (menuBtn) {
    autogenClickElement(menuBtn);
  }

  const deleteItem = await autogenWaitForControl(autogenFindDeleteMenuItem, 2000);
  if (!deleteItem) {
    return { ok: false, error: "Delete control was not found." };
  }
  autogenClickElement(deleteItem);

  const confirm = await autogenWaitForControl(() => autogenFindDeleteConfirm(deleteItem), 2000);
  if (confirm) {
    autogenClickElement(confirm);
    await autogenDelay(600);
  }
  return { ok: true };
}

async function autogenInsertAndSend(prompt) {
  autogenGenerationStarted = false;
  autogenPendingStableAnswer = null;
  autogenPendingStableSince = 0;
  autogenStopObserved = false;
  autogenAnswerBaselineRoot = autogenFindLastAssistantRoot();
  autogenAnswerBaseline = autogenExtractLastAnswer();
  const box = await autogenWaitForPromptBox(15000);
  if (!box) throw new Error("ChatGPT prompt box not found (selector may be outdated).");
  // Option A: use whatever model/effort is already selected in this ChatGPT tab.
  // Do not force "High" — ChatGPT UI selectors break often and blocked generation.

  autogenPruneOldTurns();
  await autogenInsertPromptText(box, prompt);

  const sendBtn = await autogenWaitForEnabledSend(box, 20000);
  if (!autogenIsSendButtonEnabled(sendBtn)) {
    // A synthetic Enter key is not a trusted user action in Chrome, so it can
    // be ignored by ChatGPT. Never declare a prompt sent unless Send is ready.
    throw new Error("ChatGPT Send button stayed disabled; prompt was not sent.");
  }
  sendBtn.click();
  return { ok: true, sent: "button" };
}

function autogenIsGenerating() {
  const nodes = document.querySelectorAll(AUTOGEN_SELECTORS.stopButton);
  for (const btn of nodes) {
    if (autogenIsVisible(btn)) return true;
  }
  const form = document.querySelector(AUTOGEN_SELECTORS.composer);
  if (!form) return false;
  for (const btn of form.querySelectorAll("button")) {
    const label = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
    if (label.startsWith("stop") && autogenIsVisible(btn)) return true;
    if ((btn.getAttribute("data-testid") || "").toLowerCase().includes("stop") && autogenIsVisible(btn)) {
      return true;
    }
  }
  return false;
}

function autogenCheckStatus() {
  const generating = autogenIsGenerating();
  // IMPORTANT: read the actual latest assistant response, not a parsed JSON
  // candidate. Parsing can hold the snapshot at an earlier example/template
  // while a later answer keeps streaming, making progress invisible.
  const root = autogenFindLastAssistantRoot();
  const answer = autogenExtractLastAnswer();
  const hasNewAnswer = Boolean(answer) && (
    answer !== autogenAnswerBaseline || (root && root !== autogenAnswerBaselineRoot)
  );

  if (generating) {
    autogenGenerationStarted = true;
    autogenStopObserved = true;
    autogenPendingStableAnswer = null;
    autogenPendingStableSince = 0;
    return { ok: true, state: "thinking", phase: "streaming", answerChars: answer.length };
  }
  if (hasNewAnswer) autogenGenerationStarted = true;
  if (!autogenGenerationStarted || !hasNewAnswer) {
    // Nothing is coming: a usage limit, sign-out or verification page would wait forever.
    const blocked = autogenDetectBlock();
    if (blocked) return { ok: true, state: "blocked", blocked, answerChars: answer.length };
    return { ok: true, state: "thinking", phase: "awaiting-response", answerChars: answer.length };
  }
  if (autogenPendingStableAnswer !== answer) {
    autogenPendingStableAnswer = answer;
    autogenPendingStableSince = Date.now();
    return { ok: true, state: "thinking", phase: "settling", answerChars: answer.length };
  }
  const settleMs = autogenStopObserved
    ? AUTOGEN_SETTLE_AFTER_STOP_MS
    : AUTOGEN_SETTLE_WITHOUT_STOP_MS;
  if (Date.now() - autogenPendingStableSince < settleMs) {
    return { ok: true, state: "thinking", phase: "settling", answerChars: answer.length };
  }

  // Generation status and JSON validity are independent. Once the UI is idle
  // and the DOM is stable, return the response even if its JSON is malformed.
  // The background parser then reports a specific error and can retry promptly
  // instead of waiting the full configured timeout for balanced braces.
  autogenPendingStableAnswer = null;
  autogenPruneOldTurns();
  return { ok: true, state: "done", answer };
}

function autogenNormalizeLabel(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function autogenLabelMatches(text, aliases) {
  const normalized = autogenNormalizeLabel(text).toLowerCase();
  return aliases.some((alias) => {
    const want = alias.toLowerCase();
    if (want === "pro") return normalized === want;
    return normalized === want || normalized.startsWith(`${want} `);
  });
}

/**
 * Finds the model/effort picker. The current control is labeled
 * "Select ChatGPT model" and stores the effort on `data-selected-reasoning-effort`.
 * Its visible text is "Thinking effort" plus a nested label, so the whole
 * button string is not the effort name. Older builds used that name as the
 * whole button label.
 */
function autogenFindModelTriggerButton() {
  const adapted = window.AutoGenModelAdapter?.findTrigger?.();
  if (adapted) return adapted;

  const labeled = document.querySelectorAll(AUTOGEN_SELECTORS.modelTrigger);
  for (const btn of labeled) {
    if (autogenIsVisible(btn)) return btn;
  }
  if (labeled.length) return labeled[0];
  const buttons = document.querySelectorAll("button[aria-haspopup], button[data-selected-reasoning-effort]");
  for (const btn of buttons) {
    const semanticText = [
      btn.getAttribute("aria-label"),
      btn.getAttribute("data-selected-reasoning-effort"),
      btn.textContent,
    ]
      .filter(Boolean)
      .join(" ");
    if (autogenLabelMatches(semanticText, AUTOGEN_MODEL_LABELS) || /model|thinking effort|reasoning effort/i.test(semanticText)) {
      return btn;
    }
  }
  return null;
}

function autogenTriggerMatchesChoice(btn, aliases, choice) {
  const effort = (btn.getAttribute("data-selected-reasoning-effort") || "").trim().toLowerCase();
  const effortAliases = AUTOGEN_MODEL_EFFORTS[choice] || [];
  if (effort && effortAliases.includes(effort)) return true;
  const leaves = btn.querySelectorAll("span, div");
  for (const node of leaves) {
    if (node.children.length) continue;
    if (autogenLabelMatches(node.textContent, aliases)) return true;
  }
  return autogenLabelMatches(btn.textContent, aliases);
}

/** Reads the current effort from the attribute, then a nested label, then the whole button. */
function autogenReadModelLabel() {
  const btn = autogenFindModelTriggerButton();
  if (!btn) return null;
  const effort = (btn.getAttribute("data-selected-reasoning-effort") || "").trim().toLowerCase();
  for (const [choice, values] of Object.entries(AUTOGEN_MODEL_EFFORTS)) {
    if (values.includes(effort)) return AUTOGEN_MODEL_CHOICES[choice][0];
  }
  const leaves = btn.querySelectorAll("span, div");
  for (const node of leaves) {
    if (node.children.length) continue;
    if (autogenLabelMatches(node.textContent, AUTOGEN_MODEL_LABELS)) {
      return autogenNormalizeLabel(node.textContent);
    }
  }
  const whole = autogenNormalizeLabel(btn.textContent);
  return whole || null;
}

async function autogenWaitForModelTrigger(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const btn = autogenFindModelTriggerButton();
    if (btn) return btn;
    await autogenDelay(400);
  }
  return null;
}

function autogenPressEscape() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
  );
}

function autogenSliderBounds(slider) {
  const min = Number(slider.min ?? slider.getAttribute("aria-valuemin") ?? 0);
  const max = Number(slider.max ?? slider.getAttribute("aria-valuemax") ?? 3);
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) && max > min ? max : min + 3,
  };
}

function autogenSliderNow(slider) {
  const now = Number(slider.value ?? slider.getAttribute("aria-valuenow"));
  return Number.isFinite(now) ? now : null;
}

function autogenEffortTargetValue(choice, min, max) {
  const want = AUTOGEN_MODEL_ORDER.indexOf(choice);
  if (want < 0) return null;
  const positions = Math.round(max - min) + 1;
  if (choice === "extra-high" && positions < 4) return null;
  const idx = Math.min(want, positions - 1);
  return min + idx;
}

function autogenFindEffortSlider() {
  const nodes = document.querySelectorAll('[role="slider"], input[type="range"]');
  for (const el of nodes) {
    if (autogenIsVisible(el)) return el;
  }
  return null;
}

/** Visible Instant/Medium/High/Extra high control in the open popover. Skips the trigger and the "High >" heading. */
function autogenFindEffortChoiceControl(aliases) {
  const trigger = autogenFindModelTriggerButton();
  const nodes = document.querySelectorAll(
    'button, [role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"]',
  );
  for (const el of nodes) {
    if (!autogenIsVisible(el)) continue;
    if (trigger && (el === trigger || trigger.contains(el))) continue;
    const text = autogenNormalizeLabel(el.textContent);
    if (/>\s*$/.test(text)) continue;
    if (autogenLabelMatches(text, aliases)) return el;
  }
  return null;
}

function autogenFindProSubmenuControl() {
  const trigger = autogenFindModelTriggerButton();
  const nodes = document.querySelectorAll(
    'button, [role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"]',
  );
  for (const el of nodes) {
    if (!autogenIsVisible(el)) continue;
    if (trigger && (el === trigger || trigger.contains(el))) continue;
    const text = autogenNormalizeLabel(el.textContent).replace(/>\s*$/, "").trim().toLowerCase();
    if (text === "pro") return el;
  }
  return null;
}

async function autogenOpenProSubmenuIfNeeded(choice) {
  if (choice !== "pro-standard" && choice !== "pro-extended") return;
  const targetAliases = AUTOGEN_MODEL_CHOICES[choice] || [];
  if (autogenFindEffortChoiceControl(targetAliases)) return;
  const proControl = autogenFindProSubmenuControl();
  if (!proControl) return;
  autogenClickElement(proControl);
  const started = Date.now();
  while (Date.now() - started < 1500) {
    if (autogenFindEffortChoiceControl(targetAliases)) return;
    await autogenDelay(100);
  }
}

async function autogenWaitForEffortPopover(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (autogenFindEffortSlider()) return true;
    for (const aliases of Object.values(AUTOGEN_MODEL_CHOICES)) {
      if (autogenFindEffortChoiceControl(aliases)) return true;
    }
    await autogenDelay(100);
  }
  return Boolean(autogenFindEffortSlider());
}

function autogenEffortTrackRect(slider) {
  const thumb = slider.getBoundingClientRect();
  let track = slider.parentElement;
  while (track && track.getBoundingClientRect().width < Math.max(40, thumb.width * 2)) {
    track = track.parentElement;
  }
  return (track || slider).getBoundingClientRect();
}

function autogenClickAt(el, clientX, clientY) {
  const common = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", common));
  el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", common));
  el.dispatchEvent(new MouseEvent("click", common));
}

async function autogenSetEffortSlider(slider, target) {
  slider.focus();
  if (slider.tagName === "INPUT") {
    slider.value = String(target);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const { min, max } = autogenSliderBounds(slider);
  const rect = autogenEffortTrackRect(slider);
  const t = max === min ? 0 : (target - min) / (max - min);
  const x = rect.left + Math.min(Math.max(t, 0), 1) * rect.width;
  const y = rect.top + rect.height / 2;
  autogenClickAt(slider, x, y);
  autogenClickAt(slider.parentElement || slider, x, y);
  await autogenDelay(120);

  let now = autogenSliderNow(slider);
  let guard = 0;
  while (now !== null && now !== target && guard < 8) {
    slider.focus();
    const dir = now < target ? "ArrowRight" : "ArrowLeft";
    autogenDispatchKey(dir, { code: dir });
    await autogenDelay(80);
    now = autogenSliderNow(slider);
    guard += 1;
  }
}

async function autogenWaitUntilChoice(choice, aliases, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const trigger = autogenFindModelTriggerButton();
    if (trigger && autogenTriggerMatchesChoice(trigger, aliases, choice)) return true;
    await autogenDelay(100);
  }
  const trigger = autogenFindModelTriggerButton();
  return Boolean(trigger && autogenTriggerMatchesChoice(trigger, aliases, choice));
}

/** Sets the composer effort once. A missing picker or Extra high tick does not throw. */
async function autogenSetModel(choice, waitMs = 8000) {
  const aliases = AUTOGEN_MODEL_CHOICES[choice];
  if (!aliases) return { ok: true, skipped: true };

  const trigger = await autogenWaitForModelTrigger(waitMs);
  if (!trigger) return { ok: false, reason: "picker-missing" };

  const current = autogenReadModelLabel() || autogenNormalizeLabel(trigger.textContent);
  if (autogenTriggerMatchesChoice(trigger, aliases, choice)) {
    return { ok: true, already: true, model: current };
  }

  autogenClickElement(trigger);
  const opened = await autogenWaitForEffortPopover();
  if (!opened) {
    autogenPressEscape();
    return { ok: false, reason: "option-missing", model: current };
  }

  await autogenOpenProSubmenuIfNeeded(choice);
  const labeled = autogenFindEffortChoiceControl(aliases);
  if (labeled) {
    autogenClickElement(labeled);
    const matched = await autogenWaitUntilChoice(choice, aliases);
    autogenPressEscape();
    if (matched) return { ok: true, model: aliases[0] };
  }

  const slider = autogenFindEffortSlider();
  if (!slider) {
    autogenPressEscape();
    return { ok: false, reason: "option-missing", model: current };
  }

  const { min, max } = autogenSliderBounds(slider);
  const target = autogenEffortTargetValue(choice, min, max);
  if (target === null) {
    autogenPressEscape();
    return { ok: false, reason: "option-missing", model: current };
  }

  await autogenSetEffortSlider(slider, target);
  const matched = await autogenWaitUntilChoice(choice, aliases);
  autogenPressEscape();
  if (!matched) return { ok: false, reason: "option-missing", model: autogenReadModelLabel() || current };
  return { ok: true, model: aliases[0] };
}

/** Dispatches a synthetic keydown+keyup pair at whatever currently has focus
 * (falling back to document.body) - the same synthetic-event technique
 * already used for the Enter-to-send fallback below. */
function autogenDispatchKey(key, { ctrlKey = false, shiftKey = false, code } = {}) {
  const target = document.activeElement || document.body;
  const opts = { key, code: code || key, ctrlKey, shiftKey, bubbles: true, cancelable: true, composed: true };
  target.dispatchEvent(new KeyboardEvent("keydown", opts));
  target.dispatchEvent(new KeyboardEvent("keyup", opts));
}

/**
 * Previously forced ChatGPT to "High". Option A: leave the user's selected
 * model alone — this is now a no-op kept only so older message callers don't break.
 */
async function autogenEnsureHighModel() {
  return;
}

/** Dispatches a realistic pointer/mouse event sequence at `el`'s center -
 * more compatible than a bare `.click()` with components (like this slider)
 * that key off pointerdown/mousedown rather than only the synthesized click. */
function autogenClickElement(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const common = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", common));
  el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", common));
  el.dispatchEvent(new MouseEvent("click", common));
}

/**
 * Reusing one long-lived thread means the conversation only ever grows -
 * ChatGPT's own UI doesn't virtualize old turns, so every prior exchange stays
 * fully mounted and rendered forever. Left unchecked, that's what eventually
 * stalls the tab's main thread ("Page Unresponsive"), especially with large
 * JSON answers. This collapses every turn except the most recent one via
 * content-visibility, which skips layout/paint for that subtree entirely while
 * leaving the nodes in the DOM - textContent extraction, querySelector, and
 * React's own reconciliation are all unaffected. Selector may need updating if
 * OpenAI changes their markup (see file header).
 */
function autogenFindConversationTurns() {
  const keyed = [...document.querySelectorAll(AUTOGEN_SELECTORS.conversationTurnKey)].filter(
    (el) => !el.parentElement?.closest(AUTOGEN_SELECTORS.conversationTurnKey),
  );
  if (keyed.length) return keyed;
  return [...document.querySelectorAll(AUTOGEN_SELECTORS.conversationTurn)];
}

function autogenPruneOldTurns() {
  const turns = autogenFindConversationTurns();
  for (let i = 0; i < turns.length - 1; i += 1) {
    const turn = turns[i];
    if (turn.dataset.autogenPruned) continue;
    turn.style.contentVisibility = "hidden";
    turn.style.containIntrinsicSize = "auto 300px";
    turn.dataset.autogenPruned = "1";
  }
}

function autogenComposerHasPayload(box) {
  if (box?.textContent && box.textContent.trim()) return true;
  const form = box?.closest?.("form");
  if (!form) return false;
  if (form.querySelector('[data-testid*="attachment"], [data-testid*="file"]')) return true;
  return /pasted text/i.test(form.innerText || "");
}

/** Puts `text` on the clipboard so a browser paste (not a synthetic event) can read it. */
async function autogenCopyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_e) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.documentElement.appendChild(area);
    area.focus();
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } finally {
      area.remove();
    }
    return ok;
  }
}

/**
 * ChatGPT ignores a script-built ClipboardEvent (isTrusted is false), so the
 * composer stays empty. A browser paste is trusted and still takes the cheap
 * path: a large prompt becomes a "Pasted text" attachment instead of one huge
 * inline edit. If that paste does not land, insert the text in chunks.
 */
async function autogenInsertPromptText(box, text) {
  box.focus();
  document.execCommand("selectAll", false, undefined);
  document.execCommand("delete", false, undefined);

  const copied = await autogenCopyText(text);
  if (copied) {
    box.focus();
    document.execCommand("paste");
  }

  let pasted = await autogenWaitUntil(
    () => autogenComposerHasPayload(box) || autogenIsSendButtonEnabled(autogenFindSendButton(box)),
    3000,
  );

  if (!pasted) {
    box.focus();
    const chunkSize = 4000;
    for (let i = 0; i < text.length; i += chunkSize) {
      document.execCommand("insertText", false, text.slice(i, i + chunkSize));
      await autogenDelay(20);
    }
  }

  // A large paste stays disabled until ChatGPT finishes turning it into an
  // attachment. Wait for that, or for inline text, before calling it a failure.
  pasted = await autogenWaitUntil(() => {
    return autogenComposerHasPayload(box) || autogenIsSendButtonEnabled(autogenFindSendButton(box));
  }, 20000);
  if (!pasted) {
    throw new Error("ChatGPT did not accept the pasted prompt (selectors may be outdated).");
  }
}

/** Types a short instruction alongside the pasted/attached prompt (e.g. "Generate JSON") before Send is clicked - safe as a direct execCommand insert since it's only a few words, not the large prompt itself. */
function autogenInsertShortText(box, text) {
  box.focus();
  document.execCommand("insertText", false, text);
}

function autogenWaitUntil(predicate, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function poll() {
      if (predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(false);
        return;
      }
      setTimeout(poll, 100);
    })();
  });
}

function autogenFindLastAssistantRoot() {
  const turns = autogenFindConversationTurns();
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    // The outer assistant message contains ALL markdown and code blocks. The
    // old logic returned the FIRST inner markdown fragment, which could omit
    // the final JSON code block entirely.
    const message = turn.querySelector(AUTOGEN_SELECTORS.assistantMessage);
    if (message) return message;
    const fragments = turn.querySelectorAll(AUTOGEN_SELECTORS.assistantMarkdown);
    if (fragments.length) return fragments[fragments.length - 1];
  }
  const messages = document.querySelectorAll(AUTOGEN_SELECTORS.assistantMessage);
  if (messages.length) return messages[messages.length - 1];
  const markdowns = document.querySelectorAll(AUTOGEN_SELECTORS.assistantMarkdown);
  return markdowns.length ? markdowns[markdowns.length - 1] : null;
}

function autogenStripCitations(root) {
  root
    .querySelectorAll(`${AUTOGEN_SELECTORS.citationChip}, ${AUTOGEN_SELECTORS.fileCitation}`)
    .forEach((chip) => chip.remove());
}

function autogenCollectCodeTexts(root) {
  const texts = [];
  const seen = new Set();
  const push = (value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    texts.push(text);
  };
  root.querySelectorAll("pre code, code").forEach((node) => push(node.textContent));
  root.querySelectorAll(AUTOGEN_SELECTORS.jsonCodeBlock).forEach((node) => {
    if (node.querySelector("code")) return;
    push(node.textContent);
  });
  return texts;
}

function autogenRememberJsonPick(best, picked) {
  if (!picked) return best;
  if (!best || picked.score > best.score) return picked;
  return best;
}

function autogenExtractLastAnswer() {
  const root = autogenFindLastAssistantRoot();
  if (!root) return "";
  const clone = root.cloneNode(true);
  autogenStripCitations(clone);
  // Preserve the full assistant response. Picking "the best" JSON here can
  // select a valid prompt example and can mask changes to the actual final
  // response, causing false completion or a permanent "thinking" state.
  return String(clone.textContent || "").trim();
}

function autogenIsVisible(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Visible `#prompt-textarea` when that is the on-screen editor; otherwise the composer ProseMirror. */
function autogenFindPromptBox() {
  const legacy = document.querySelector(AUTOGEN_SELECTORS.promptBox);
  if (legacy && autogenIsVisible(legacy)) return legacy;
  const forms = document.querySelectorAll(AUTOGEN_SELECTORS.composer);
  for (const form of forms) {
    const box = form.querySelector(AUTOGEN_SELECTORS.composerBox);
    if (box && autogenIsVisible(box)) return box;
  }
  return null;
}

function autogenWaitForPromptBox(timeoutMs) {
  return new Promise((resolve) => {
    const existing = autogenFindPromptBox();
    if (existing) {
      resolve(existing);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      const found = autogenFindPromptBox();
      if (found || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(found || null);
      }
    }, 200);
  });
}

/** Send replaces Start Voice only after the composer has text. Dictate is a different control. */
function autogenFindSendButton(box) {
  const form = box?.closest?.(AUTOGEN_SELECTORS.composer);
  if (form) {
    return form.querySelector(AUTOGEN_SELECTORS.sendButton) || form.querySelector(AUTOGEN_SELECTORS.legacySendButton);
  }
  return document.querySelector(AUTOGEN_SELECTORS.sendButton) || document.querySelector(AUTOGEN_SELECTORS.legacySendButton);
}

function autogenWaitForEnabledSend(box, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const sendBtn = autogenFindSendButton(box);
      if (autogenIsSendButtonEnabled(sendBtn) || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(autogenFindSendButton(box));
      }
    }, 100);
  });
}

function autogenDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Page states in which ChatGPT will not answer a prompt now. Matched against
// the page's own text only (never the conversation or the composer), so a job
// description that says "too many requests" cannot trip them.
const AUTOGEN_BLOCK_PATTERNS = [
  { reason: "usage limit reached", re: /\b(you['’]ve|you have) (hit|reached) (your|the)\b[^.\n]{0,60}\blimit\b/i },
  { reason: "usage limit reached", re: /\busage (limit|cap)\b[^.\n]{0,60}\b(reached|resets?|try again)\b/i },
  { reason: "too many requests", re: /\btoo many (requests|messages)\b/i },
  { reason: "human verification required", re: /\b(verify you are (a )?human|unusual activity|are you a robot)\b/i },
];

/** Text of the page outside chat messages and editors, capped. */
function autogenPageChromeText(maxChars = 20000) {
  if (!document.body) return "";
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (!el || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (el.closest('[data-message-author-role], [contenteditable="true"], textarea, script, style, noscript')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = "";
  while (walker.nextNode() && text.length < maxChars) text += ` ${walker.currentNode.nodeValue}`;
  return text;
}

/** Why ChatGPT cannot take a prompt right now, or "" when it can. */
function autogenDetectBlock() {
  if (document.querySelector('iframe[src*="challenges.cloudflare.com"], #challenge-form, #cf-challenge-running')) {
    return "human verification required";
  }
  const text = autogenPageChromeText();
  for (const { reason, re } of AUTOGEN_BLOCK_PATTERNS) {
    if (re.test(text)) return reason;
  }
  const loginButton = document.querySelector('[data-testid="login-button"], a[href*="/auth/login"]');
  if (loginButton && autogenIsVisible(loginButton) && !autogenFindPromptBox()) return "signed out of ChatGPT";
  return "";
}

/**
 * Checked before every prompt: is the page usable, and which model is shown.
 * { ok, blocked: "" | reason, missing: string[], model }.
 */
async function autogenSelfTest() {
  const blocked = autogenDetectBlock();
  if (blocked) return { ok: true, blocked, missing: [], model: "" };
  const missing = [];
  // The composer can take a few seconds to mount after a navigation.
  if (!(await autogenWaitForPromptBox(10000))) missing.push("the prompt box");
  return {
    ok: true,
    blocked: autogenDetectBlock(),
    missing,
    model: typeof autogenReadModelLabel === "function" ? autogenReadModelLabel() || "" : "",
  };
}
