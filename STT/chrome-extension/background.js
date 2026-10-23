/**
 * Background service worker: WebSocket bridge, toggle state, caption fan-out.
 */

const DEFAULT_HOTKEY = "Ctrl+Shift+Space";
const DEFAULT_CLEAR_HOTKEY = "Ctrl+Shift+Backspace";
const WS_URL = "ws://127.0.0.1:8000/ws";
const TARGET_URL_PATTERNS = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://chat.deepseek.com/*",
  "https://www.deepseek.com/*",
];

let running = false;
let connected = false;
let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let lastError = "";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    { hotkey: DEFAULT_HOTKEY, clearHotkey: DEFAULT_CLEAR_HOTKEY },
    (data) => {
      const updates = {};
      if (!data.hotkey) updates.hotkey = DEFAULT_HOTKEY;
      if (!data.clearHotkey) updates.clearHotkey = DEFAULT_CLEAR_HOTKEY;
      if (Object.keys(updates).length) {
        chrome.storage.sync.set(updates);
      }
    }
  );
  persistUiState();
  connectWebSocket();
});

chrome.runtime.onStartup.addListener(() => {
  connectWebSocket();
});

connectWebSocket();

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-captions") {
    toggleCaptions();
  } else if (command === "clear-input") {
    forwardClearToTargets();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && message.type;

  if (type === "toggle") {
    toggleCaptions().then(() => sendResponse({ ok: true, running, connected }));
    return true;
  }

  if (type === "start") {
    setRunning(true).then(() => sendResponse({ ok: true, running, connected }));
    return true;
  }

  if (type === "stop") {
    setRunning(false).then(() => sendResponse({ ok: true, running, connected }));
    return true;
  }

  if (type === "getState") {
    sendResponse({
      running,
      connected,
      server: "localhost:8000",
      lastError,
    });
    return false;
  }

  return false;
});

async function toggleCaptions() {
  await setRunning(!running);
}

async function setRunning(next) {
  running = Boolean(next);
  await persistUiState();

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    lastError = "Server disconnected";
    await persistUiState();
    connectWebSocket();
    return;
  }

  const command = running ? "start" : "stop";
  try {
    socket.send(JSON.stringify({ command }));
    lastError = "";
  } catch (err) {
    lastError = "Server disconnected";
    connected = false;
  }
  await persistUiState();
}

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    connected = false;
    lastError = "Server disconnected";
    persistUiState();
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    connected = true;
    reconnectDelay = 1000;
    lastError = "";
    persistUiState();

    // Re-sync server side if extension thinks it is running
    if (running) {
      try {
        socket.send(JSON.stringify({ command: "start" }));
      } catch (_e) {
        /* ignore */
      }
    }
  });

  socket.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (_e) {
      return;
    }

    if (data.type === "status" && data.state) {
      running = data.state === "running";
      persistUiState();
      return;
    }

    if (data.type === "caption" && typeof data.text === "string") {
      forwardCaptionToTargets(data.text);
      return;
    }

    if (data.type === "error" && data.message) {
      lastError = String(data.message);
      persistUiState();
    }
  });

  socket.addEventListener("close", () => {
    connected = false;
    lastError = "Server disconnected";
    persistUiState();
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    connected = false;
    lastError = "Server disconnected";
    persistUiState();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
  }, reconnectDelay);
}

async function forwardClearToTargets() {
  const tabs = await chrome.tabs.query({
    url: TARGET_URL_PATTERNS,
  });

  if (!tabs.length) {
    console.warn("[Caption-STT] No ChatGPT/DeepSeek tab found to clear input");
    return;
  }

  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "clear" });
    } catch (err) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        await chrome.tabs.sendMessage(tab.id, { type: "clear" });
      } catch (err2) {
        console.warn("[Caption-STT] Failed to clear input on tab", tab.id, err2);
      }
    }
  }
}

async function forwardCaptionToTargets(text) {
  const tabs = await chrome.tabs.query({
    url: TARGET_URL_PATTERNS,
  });

  if (!tabs.length) {
    console.warn("[Caption-STT] No ChatGPT/DeepSeek tab found for caption:", text);
    return;
  }

  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "caption",
        text,
      });
    } catch (err) {
      // Content script may not be injected yet — try to inject, then retry once.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        await chrome.tabs.sendMessage(tab.id, {
          type: "caption",
          text,
        });
      } catch (err2) {
        console.warn("[Caption-STT] Failed to deliver caption to tab", tab.id, err2);
      }
    }
  }
}

function persistUiState() {
  return chrome.storage.local.set({
    uiState: {
      running,
      connected,
      lastError,
      server: "localhost:8000",
      updatedAt: Date.now(),
    },
  });
}
