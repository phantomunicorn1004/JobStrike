"""FastAPI WebSocket server bridging Chrome extension and CaptionReader."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from caption_reader import CaptionReader
from config import POLL_INTERVAL_MS, SERVER_HOST, WEBSOCKET_PATH

app = FastAPI(title="Caption-STT Server", version="1.0.0")

_clients: Set[WebSocket] = set()
_reader = CaptionReader(poll_interval_ms=POLL_INTERVAL_MS)
_running = False
_broadcast_task: Optional[asyncio.Task] = None
_state_lock = asyncio.Lock()


def _is_localhost(websocket: WebSocket) -> bool:
    client = websocket.client
    if client is None:
        return False
    host = (client.host or "").strip().lower()
    return host in {"127.0.0.1", "::1", "localhost"}


async def _send_json(websocket: WebSocket, payload: dict[str, Any]) -> None:
    await websocket.send_text(json.dumps(payload))


async def _broadcast(payload: dict[str, Any]) -> None:
    dead: list[WebSocket] = []
    message = json.dumps(payload)
    for ws in list(_clients):
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _clients.discard(ws)


async def _set_running(value: bool) -> None:
    global _running, _broadcast_task
    async with _state_lock:
        if value and not _running:
            _reader.start()
            _running = True
            if _broadcast_task is None or _broadcast_task.done():
                _broadcast_task = asyncio.create_task(_caption_pump())
            await _broadcast({"type": "status", "state": "running"})
        elif not value and _running:
            _reader.stop()
            _running = False
            await _broadcast({"type": "status", "state": "stopped"})


async def _caption_pump() -> None:
    interval = max(0.05, POLL_INTERVAL_MS / 1000.0)
    while _running:
        error = _reader.get_error()
        while error:
            # Normalize to protocol error message for the extension
            message = error
            if "not running" in error.lower() or "not found" in error.lower():
                message = "Live Caption window not found"
            await _broadcast({"type": "error", "message": message})
            error = _reader.get_error()

        text = _reader.get_new_text()
        while text:
            print(f"[ws] caption -> clients ({len(_clients)}): {text!r}")
            await _broadcast({"type": "caption", "text": text})
            text = _reader.get_new_text()

        await asyncio.sleep(interval)


@app.get("/")
async def root() -> JSONResponse:
    return JSONResponse(
        {
            "service": "caption-stt",
            "host": SERVER_HOST,
            "path": WEBSOCKET_PATH,
            "state": "running" if _running else "stopped",
            "clients": len(_clients),
        }
    )


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True, "state": "running" if _running else "stopped"})


@app.websocket(WEBSOCKET_PATH)
async def websocket_endpoint(websocket: WebSocket) -> None:
    if not _is_localhost(websocket):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    _clients.add(websocket)
    await _send_json(
        websocket,
        {"type": "status", "state": "running" if _running else "stopped"},
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await _send_json(
                    websocket,
                    {"type": "error", "message": "Invalid JSON payload"},
                )
                continue

            command = str(data.get("command", "")).strip().lower()
            if command == "start":
                await _set_running(True)
            elif command == "stop":
                await _set_running(False)
            else:
                await _send_json(
                    websocket,
                    {"type": "error", "message": f"Unknown command: {command}"},
                )
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)
        # If no clients remain and we were running, keep state until explicit stop
        # (extension reconnects). Do not auto-stop on disconnect.
