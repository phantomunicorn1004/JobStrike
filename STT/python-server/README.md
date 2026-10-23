# Caption-STT Python Server

Local FastAPI WebSocket server that reads **Windows Live Captions** and streams caption deltas to the Chrome extension.

## Setup

```powershell
cd python-server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run

```powershell
python main.py
```

Listens on `ws://127.0.0.1:8000/ws` (localhost only).

Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

## Modules

| File | Purpose |
|------|---------|
| `main.py` | Uvicorn entry point |
| `websocket_server.py` | FastAPI app, `/ws`, START/STOP, broadcast |
| `caption_reader.py` | UI Automation reader + delta detection |
| `config.py` / `config.json` | Host, port, poll interval |

## WebSocket protocol

### Client → server

```json
{"command": "start"}
```

```json
{"command": "stop"}
```

### Server → client

```json
{"type": "status", "state": "running"}
```

```json
{"type": "status", "state": "stopped"}
```

```json
{"type": "caption", "text": "new words only"}
```

```json
{"type": "error", "message": "Live Caption window not found"}
```

## Caption deltas

The reader keeps the last full caption string. When Live Captions grows from:

`Hello my name is John`

to:

`Hello my name is John and I work as engineer`

only this is sent:

`and I work as engineer`

## Config

`config.json`:

```json
{
  "server_host": "127.0.0.1",
  "server_port": 8000,
  "websocket_path": "/ws",
  "poll_interval_ms": 200,
  "default_hotkey": "Ctrl+Shift+Space"
}
```

`server_host` should stay `127.0.0.1`. Non-loopback WebSocket clients are rejected.

## Dependencies

- `fastapi`
- `uvicorn[standard]`
- `websockets`
- `pywin32`
- `uiautomation`

## Troubleshooting

- **Windows Live Captions is not running** — start Live Captions before pressing Start/hotkey.
- **Import errors for uiautomation/pywin32** — reinstall requirements inside the venv on Windows.
- **No captions streaming** — confirm Live Captions shows text, then check server console for errors.
