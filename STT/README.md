# Caption-STT

Stream **Windows Live Captions** into the **ChatGPT** message box in real time.

Press a configurable hotkey (default **Ctrl+Shift+Space**) to start. Press again to stop.

## Architecture

```
Chrome extension  <──WebSocket──>  Python server  <──UI Automation──>  Windows Live Captions
     │                                      │
     └── inserts text into ChatGPT          └── sends only NEW caption deltas
```

| Component | Role |
|-----------|------|
| `chrome-extension/` | Hotkey toggle, WebSocket client, ChatGPT input insertion |
| `python-server/` | Local FastAPI WebSocket server + Live Captions reader |

Communication is **localhost only** (`127.0.0.1:8000`).

## Requirements

- Windows 11 (Live Captions)
- Python **3.11+**
- Google Chrome (Manifest V3)
- Windows Live Captions available (`Win + Ctrl + L`)

## Installation

### 1. Python server

```powershell
cd python-server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `chrome-extension` folder in this repo

## Running

### Start the server

```powershell
cd python-server
.\.venv\Scripts\Activate.ps1
python main.py
```

You should see:

```text
Caption-STT server listening on ws://127.0.0.1:8000/ws
```

### Start Live Captions

- Press **Win + Ctrl + L**, or  
- Settings → Accessibility → Captions → **Live captions**

### Open ChatGPT

Open [https://chatgpt.com](https://chatgpt.com) (or chat.openai.com).

### Toggle capture

| Action | Result |
|--------|--------|
| First hotkey press | Extension sends `START` → server reads captions → streams new text into ChatGPT |
| Second hotkey press | Extension sends `STOP` → server stops |

Default hotkey: **Ctrl + Shift + Space**

Change it in the extension popup (**Change Hotkey**), or remap the command at `chrome://extensions/shortcuts`.

## Protocol

**Extension → Server**

```json
{"command": "start"}
```

```json
{"command": "stop"}
```

**Server → Extension**

```json
{"type": "caption", "text": "and I work as engineer"}
```

```json
{"type": "status", "state": "running"}
```

```json
{"type": "status", "state": "stopped"}
```

```json
{"type": "error", "message": "Live Caption window not found"}
```

## Test flow

1. Start Python: `python main.py`
2. Load the unpacked extension
3. Open https://chatgpt.com
4. Open Windows Live Captions
5. Press the hotkey (START)
6. Speak: **"Hello ChatGPT"**
7. Expect Live Captions to show the phrase, then the ChatGPT input to contain **Hello ChatGPT**
8. Press the hotkey again (STOP) — Python stops reading

## Popup UI

- **Connection:** Connected / Disconnected  
- **Server:** localhost:8000  
- **State:** STOPPED / LISTENING  
- **Start / Stop** buttons  
- **Current hotkey** + Change Hotkey  

## Windows permissions / notes

- The server uses **UI Automation** (`uiautomation` + `pywin32`) to read the Live Captions window. No special admin rights are normally required.
- Keep the Live Captions window open while listening.
- If Windows blocks accessibility for some apps, ensure Live Captions itself is running and visible.

## Configuration

Edit [`python-server/config.json`](python-server/config.json):

```json
{
  "server_host": "127.0.0.1",
  "server_port": 8000,
  "websocket_path": "/ws",
  "poll_interval_ms": 200,
  "default_hotkey": "Ctrl+Shift+Space"
}
```

Host must remain loopback for security.

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Popup shows **Server disconnected** | Start `python main.py`; confirm nothing else uses port 8000 |
| Error: Live Caption window not found | Open Live Captions (`Win+Ctrl+L`) before/while listening |
| Hotkey does nothing | Focus the ChatGPT tab; check popup hotkey; also try `chrome://extensions/shortcuts` |
| Text not inserted | Refresh ChatGPT; ensure the composer is visible; check the extension is enabled for the site |
| Port already in use | Change `server_port` in `config.json` and update the extension WS URL in `background.js` if needed |
| Duplicate / missing words | Speak clearly; Live Captions sometimes revises lines — the reader sends deltas only |

## Project layout

```text
caption-STT/
├── chrome-extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   ├── styles.css
│   └── icons/
├── python-server/
│   ├── main.py
│   ├── websocket_server.py
│   ├── caption_reader.py
│   ├── config.py
│   ├── config.json
│   ├── requirements.txt
│   └── README.md
└── README.md
```

## License

MIT (or your preferred license).
