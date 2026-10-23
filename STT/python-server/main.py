"""Entry point for the Caption-STT Python WebSocket server."""

from __future__ import annotations

import uvicorn

from config import SERVER_HOST, SERVER_PORT
from websocket_server import app


def main() -> None:
    print(f"Caption-STT server listening on ws://{SERVER_HOST}:{SERVER_PORT}/ws")
    print("Localhost only. Press Ctrl+C to stop.")
    uvicorn.run(
        app,
        host=SERVER_HOST,
        port=SERVER_PORT,
        log_level="info",
        ws_ping_interval=20,
        ws_ping_timeout=20,
    )


if __name__ == "__main__":
    main()
