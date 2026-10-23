"""Server configuration loaded from config.json with safe defaults."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CONFIG_PATH = Path(__file__).resolve().parent / "config.json"

_DEFAULTS: dict[str, Any] = {
    "server_host": "127.0.0.1",
    "server_port": 8000,
    "websocket_path": "/ws",
    "poll_interval_ms": 200,
    "default_hotkey": "Ctrl+Shift+Space",
}


def load_config() -> dict[str, Any]:
    config = dict(_DEFAULTS)
    if _CONFIG_PATH.is_file():
        try:
            with _CONFIG_PATH.open(encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                config.update({k: v for k, v in data.items() if k in _DEFAULTS})
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[config] Failed to load config.json, using defaults: {exc}")
    return config


CONFIG = load_config()

SERVER_HOST: str = str(CONFIG["server_host"])
SERVER_PORT: int = int(CONFIG["server_port"])
WEBSOCKET_PATH: str = str(CONFIG["websocket_path"])
POLL_INTERVAL_MS: int = int(CONFIG["poll_interval_ms"])
DEFAULT_HOTKEY: str = str(CONFIG["default_hotkey"])
