/**
 * Content script: chat input insertion (ChatGPT + DeepSeek) + hotkey toggle.
 */

const DEFAULT_HOTKEY = "Ctrl+Shift+Space";
const DEFAULT_CLEAR_HOTKEY = "Ctrl+Shift+Backspace";

let cachedHotkey = DEFAULT_HOTKEY;
let cachedClearHotkey = DEFAULT_CLEAR_HOTKEY;
let inputEl = null;
let findTimer = null;

chrome.storage.sync.get(
  { hotkey: DEFAULT_HOTKEY, clearHotkey: DEFAULT_CLEAR_HOTKEY },
  (data) => {
    cachedHotkey = normalizeHotkey(data.hotkey || DEFAULT_HOTKEY);
    cachedClearHotkey = normalizeHotkey(data.clearHotkey || DEFAULT_CLEAR_HOTKEY);
  }
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hotkey) {
    cachedHotkey = normalizeHotkey(changes.hotkey.newValue || DEFAULT_HOTKEY);
  }
  if (area === "sync" && changes.clearHotkey) {
    cachedClearHotkey = normalizeHotkey(changes.clearHotkey.newValue || DEFAULT_CLEAR_HOTKEY);
  }
});

ensureInputWatcher();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (window !== window.top) {
    return false;
  }
  if (message && message.type === "caption" && typeof message.text === "string") {
    insertText(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message && message.type === "clear") {
    clearInput()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});

window.addEventListener(
  "keydown",
  (event) => {
    if (matchesHotkey(event, cachedClearHotkey)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      clearInput().catch(() => {});
      return;
    }
    if (!matchesHotkey(event, cachedHotkey)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: "toggle" }).catch(() => {});
  },
  true
);

function ensureInputWatcher() {
  if (window !== window.top) return;
  if (findTimer) return;
  findChatInput().then((el) => {
    inputEl = el;
  });
  findTimer = setInterval(() => {
    const el = locateInputNow();
    if (el) inputEl = el;
  }, 1000);
}

/**
 * Locate chat composer (textarea or contenteditable). Retries until found.
 */
function findChatInput() {
  return new Promise((resolve) => {
    const found = locateInputNow();
    if (found) {
      resolve(found);
      return;
    }

    const started = Date.now();
    const timer = setInterval(() => {
      const el = locateInputNow();
      if (el) {
        clearInterval(timer);
        resolve(el);
        return;
      }
      if (Date.now() - started > 60000) {
        clearInterval(timer);
        resolve(null);
      }
    }, 1000);
  });
}

function locateInputNow() {
  const host = location.hostname || "";
  const preferred = host.includes("deepseek")
    ? deepSeekSelectors()
    : chatGptSelectors();

  for (const selector of preferred) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (!isVisible(node)) continue;
      const editable = resolveEditable(node);
      if (editable && isVisible(editable)) {
        return editable;
      }
    }
  }
  return null;
}

function chatGptSelectors() {
  return [
    "#prompt-textarea",
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]#prompt-textarea',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="Ask"]',
    "#prompt-textarea textarea",
    "textarea",
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"]',
  ];
}

function deepSeekSelectors() {
  // chat.deepseek.com: #chat-input and "Message DeepSeek" textarea are most stable
  return [
    "#chat-input",
    "textarea#chat-input",
    'textarea[placeholder*="Message DeepSeek"]',
    'textarea[placeholder*="DeepSeek"]',
    'textarea[placeholder*="Send a message"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="输入"]',
    ".chat-input textarea",
    '[class*="chat-input"] textarea',
    '[class*="ChatInput"] textarea',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    "textarea",
  ];
}

/**
 * Wrapper nodes may contain an inner textarea/contenteditable.
 */
function resolveEditable(el) {
  if (!el) return null;
  if (el instanceof HTMLTextAreaElement) return el;
  if (el.isContentEditable) return el;

  const inner =
    el.querySelector("textarea") ||
    el.querySelector('div.ProseMirror[contenteditable="true"]') ||
    el.querySelector('[contenteditable="true"]');
  if (inner instanceof HTMLElement) return inner;
  return null;
}

function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Append caption text into the chat input as if the user typed it.
 */
async function insertText(text) {
  const chunk = String(text || "").trim();
  if (!chunk) return;

  let el = inputEl || locateInputNow();
  if (!el) {
    el = await findChatInput();
  }
  if (!el) {
    console.warn("[Caption-STT] Chat input not found");
    return;
  }
  inputEl = el;
  console.log("[Caption-STT] inserting into", el.tagName, el.id || el.className, chunk);

  if (el instanceof HTMLTextAreaElement || el.tagName === "TEXTAREA") {
    insertIntoTextarea(el, chunk);
    return;
  }

  insertIntoContentEditable(el, chunk);
}

/**
 * Clear the chat input field (ChatGPT / DeepSeek).
 */
async function clearInput() {
  let el = inputEl || locateInputNow();
  if (!el) {
    el = await findChatInput();
  }
  if (!el) {
    console.warn("[Caption-STT] Chat input not found for clear");
    return;
  }
  inputEl = el;
  el.focus();

  if (el instanceof HTMLTextAreaElement || el.tagName === "TEXTAREA") {
    clearTextarea(el);
    return;
  }

  clearContentEditable(el);
}

function clearTextarea(el) {
  const proto = window.HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, "");
  } else {
    el.value = "";
  }

  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    })
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));

  try {
    el.selectionStart = el.selectionEnd = 0;
  } catch (_e) {
    /* ignore */
  }
}

function clearContentEditable(el) {
  el.focus();

  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  let cleared = false;
  try {
    cleared = document.execCommand("delete");
  } catch (_e) {
    cleared = false;
  }

  if (!cleared || readEditableText(el).trim()) {
    const prose = el.querySelector(".ProseMirror") || el;
    if (prose.querySelector("p")) {
      prose.innerHTML = "<p><br></p>";
    } else {
      prose.textContent = "";
    }
  }

  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    })
  );
}

function insertIntoTextarea(el, chunk) {
  el.focus();
  const existing = el.value || "";
  const needsSpace = existing.length > 0 && !/\s$/.test(existing);
  const next = existing + (needsSpace ? " " : "") + chunk;

  const proto = window.HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, next);
  } else {
    el.value = next;
  }

  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: chunk })
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));

  try {
    el.selectionStart = el.selectionEnd = next.length;
  } catch (_e) {
    /* ignore */
  }
}

function insertIntoContentEditable(el, chunk) {
  el.focus();

  const existing = readEditableText(el);
  const needsSpace = existing.length > 0 && !/\s$/.test(existing);
  const toInsert = (needsSpace ? " " : "") + chunk;

  placeCaretAtEnd(el);

  // 1) Preferred: execCommand insertText (works with many React/ProseMirror editors)
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, toInsert);
  } catch (_e) {
    ok = false;
  }
  if (ok && readEditableText(el).endsWith(chunk)) {
    return;
  }

  // 2) beforeinput + input events (Lexical / newer editors)
  try {
    const before = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: toInsert,
    });
    const cancelled = !el.dispatchEvent(before);
    if (!cancelled) {
      // If the framework did not insert, fall through to manual insert
      if (!readEditableText(el).endsWith(chunk)) {
        manualInsert(el, existing, toInsert);
      }
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: toInsert,
        })
      );
      return;
    }
  } catch (_e) {
    /* ignore */
  }

  // 3) Manual DOM update + input event
  manualInsert(el, existing, toInsert);
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: toInsert,
    })
  );
}

function readEditableText(el) {
  return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "");
}

function placeCaretAtEnd(el) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function manualInsert(el, existing, toInsert) {
  // Prefer updating a trailing <p> if ProseMirror-like
  const lastP = el.querySelector("p:last-child");
  if (lastP) {
    const cur = (lastP.textContent || "").replace(/\u00a0/g, " ");
    if (!cur || cur === "\n" || cur === "") {
      lastP.textContent = toInsert.replace(/^\s+/, "");
    } else {
      lastP.textContent = cur + toInsert;
    }
    return;
  }
  el.textContent = existing + toInsert;
}

function normalizeHotkey(value) {
  return String(value || DEFAULT_HOTKEY)
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lower = p.toLowerCase();
      if (lower === "control" || lower === "ctrl") return "Ctrl";
      if (lower === "shift") return "Shift";
      if (lower === "alt" || lower === "option") return "Alt";
      if (lower === "meta" || lower === "cmd" || lower === "command") return "Meta";
      if (lower === " ") return "Space";
      if (lower === "space") return "Space";
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

function matchesHotkey(event, hotkey) {
  const parts = normalizeHotkey(hotkey).split("+");
  const keyPart = parts[parts.length - 1];
  const needCtrl = parts.includes("Ctrl");
  const needShift = parts.includes("Shift");
  const needAlt = parts.includes("Alt");
  const needMeta = parts.includes("Meta");

  if (!!event.ctrlKey !== needCtrl) return false;
  if (!!event.shiftKey !== needShift) return false;
  if (!!event.altKey !== needAlt) return false;
  if (!!event.metaKey !== needMeta) return false;

  const eventKey = event.key;
  if (keyPart === "Space") {
    return event.code === "Space" || eventKey === " " || eventKey === "Spacebar";
  }
  if (keyPart === "Backspace") {
    return event.code === "Backspace" || eventKey === "Backspace";
  }
  if (keyPart === "Delete") {
    return event.code === "Delete" || eventKey === "Delete";
  }
  if (keyPart.length === 1) {
    return eventKey.toUpperCase() === keyPart.toUpperCase();
  }
  return eventKey.toLowerCase() === keyPart.toLowerCase() || event.code === keyPart;
}
