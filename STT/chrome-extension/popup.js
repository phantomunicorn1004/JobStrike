const DEFAULT_HOTKEY = "Ctrl+Shift+Space";
const DEFAULT_CLEAR_HOTKEY = "Ctrl+Shift+Backspace";

const elConnection = document.getElementById("connection");
const elServer = document.getElementById("server");
const elState = document.getElementById("state");
const elError = document.getElementById("error");
const elHotkey = document.getElementById("hotkey-display");
const elChromeHotkey = document.getElementById("chrome-hotkey-display");
const elClearHotkey = document.getElementById("clear-hotkey-display");
const elHint = document.getElementById("hotkey-hint");
const elClearHint = document.getElementById("clear-hotkey-hint");
const elHotkeyNote = document.getElementById("hotkey-note");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnHotkey = document.getElementById("btn-hotkey");
const btnClearHotkey = document.getElementById("btn-clear-hotkey");
const btnChromeShortcuts = document.getElementById("btn-chrome-shortcuts");

/** @type {null | "toggle" | "clear"} */
let capturingMode = null;

refresh();
const refreshTimer = setInterval(refresh, 1000);

btnStart.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "start" }, () => refresh());
});

btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop" }, () => refresh());
});

btnHotkey.addEventListener("click", () => {
  setCaptureMode(capturingMode === "toggle" ? null : "toggle");
});

btnClearHotkey.addEventListener("click", () => {
  setCaptureMode(capturingMode === "clear" ? null : "clear");
});

btnChromeShortcuts.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

document.addEventListener("keydown", (event) => {
  if (!capturingMode) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    setCaptureMode(null);
    return;
  }

  if (!(event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)) {
    const hint = capturingMode === "clear" ? elClearHint : elHint;
    hint.textContent = "Include a modifier (Ctrl / Alt / Shift)…";
    hint.classList.remove("hidden");
    return;
  }

  const combo = eventToHotkey(event);
  if (!combo) return;

  if (capturingMode === "toggle") {
    chrome.storage.sync.set({ hotkey: combo }, () => {
      elHotkey.textContent = formatHotkeyDisplay(combo);
      updateHotkeyNote(combo);
      setCaptureMode(null);
    });
    return;
  }

  chrome.storage.sync.set({ clearHotkey: combo }, () => {
    elClearHotkey.textContent = formatHotkeyDisplay(combo);
    setCaptureMode(null);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.uiState) {
    applyState(changes.uiState.newValue || {});
  }
  if (area === "sync" && changes.hotkey) {
    elHotkey.textContent = formatHotkeyDisplay(changes.hotkey.newValue || DEFAULT_HOTKEY);
  }
  if (area === "sync" && changes.clearHotkey) {
    elClearHotkey.textContent = formatHotkeyDisplay(
      changes.clearHotkey.newValue || DEFAULT_CLEAR_HOTKEY
    );
  }
});

window.addEventListener("unload", () => clearInterval(refreshTimer));

function setCaptureMode(mode) {
  capturingMode = mode;
  const listening = mode !== null;

  btnHotkey.classList.toggle("listening-capture", mode === "toggle");
  btnHotkey.textContent =
    mode === "toggle" ? "Listening… (Esc to cancel)" : "Change Page Toggle";

  btnClearHotkey.classList.toggle("listening-capture", mode === "clear");
  btnClearHotkey.textContent =
    mode === "clear" ? "Listening… (Esc to cancel)" : "Change Clear Hotkey";

  elHint.classList.toggle("hidden", mode !== "toggle");
  elClearHint.classList.toggle("hidden", mode !== "clear");

  if (!listening) {
    elHint.textContent = "Press a new key combination…";
    elClearHint.textContent = "Press a new key combination…";
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "getState" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      applyState({ connected: false, running: false, lastError: "Server disconnected" });
      return;
    }
    applyState(response);
  });

  chrome.storage.sync.get(
    { hotkey: DEFAULT_HOTKEY, clearHotkey: DEFAULT_CLEAR_HOTKEY },
    (data) => {
      const pageHotkey = data.hotkey || DEFAULT_HOTKEY;
      elHotkey.textContent = formatHotkeyDisplay(pageHotkey);
      elClearHotkey.textContent = formatHotkeyDisplay(
        data.clearHotkey || DEFAULT_CLEAR_HOTKEY
      );
      updateHotkeyNote(pageHotkey);
    }
  );

  chrome.commands.getAll((commands) => {
    const toggle = commands.find((item) => item.name === "toggle-captions");
    const shortcut = toggle && toggle.shortcut ? toggle.shortcut : "(not set)";
    elChromeHotkey.textContent = formatHotkeyDisplay(shortcut);
  });
}

function updateHotkeyNote(pageHotkey) {
  const combo = String(pageHotkey || "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (combo === "ctrl+space" || combo === "control+space") {
    elHotkeyNote.textContent =
      "Ctrl+Space is used by Windows IME and often ignored on DeepSeek. The Chrome toggle (Ctrl+Shift+Space unless you change it) still works. Set both to the same combo under Chrome shortcut settings if you want one shortcut everywhere.";
    return;
  }
  elHotkeyNote.textContent =
    "Page toggle can lose to the site or Windows IME. Chrome toggle still works even when the page steals keys.";
}

function applyState(state) {
  const connected = Boolean(state.connected);
  const running = Boolean(state.running);
  const server = state.server || "localhost:8000";
  const lastError = state.lastError || "";

  elServer.textContent = server;

  elConnection.textContent = connected ? "Connected" : "Disconnected";
  elConnection.classList.toggle("connected", connected);
  elConnection.classList.toggle("disconnected", !connected);

  elState.textContent = running ? "LISTENING" : "STOPPED";
  elState.classList.toggle("listening", running);
  elState.classList.toggle("stopped", !running);

  if (!connected) {
    elError.textContent = "Server disconnected";
    elError.classList.remove("hidden");
  } else if (lastError) {
    elError.textContent = lastError;
    elError.classList.remove("hidden");
  } else {
    elError.textContent = "";
    elError.classList.add("hidden");
  }
}

function eventToHotkey(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  let keyLabel = "";
  if (event.code === "Space" || event.key === " ") {
    keyLabel = "Space";
  } else if (event.code === "Backspace" || event.key === "Backspace") {
    keyLabel = "Backspace";
  } else if (event.code === "Delete" || event.key === "Delete") {
    keyLabel = "Delete";
  } else if (event.key.length === 1) {
    keyLabel = event.key.toUpperCase();
  } else if (!["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
    keyLabel = event.key;
  }

  if (!keyLabel) return null;
  parts.push(keyLabel);
  return parts.join("+");
}

function formatHotkeyDisplay(hotkey) {
  return String(hotkey || DEFAULT_HOTKEY)
    .split("+")
    .map((p) => p.trim().toUpperCase())
    .join(" + ");
}
