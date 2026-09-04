"""
Local HTTP API for JSON → DOCX/PDF generation.

Bind: 127.0.0.1 only (default port 8765)
CLI:  python server.py
      python server.py --port 8765
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from output_mode import OutputMode
from pipeline import process_json
from templates import (
    downloads_dir,
    list_template_dirs,
    load_template_bundle,
    resolve_template_dir,
    scan_template_dirs,
)

APP_VERSION = "1.1.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
ALLOWED_DOWNLOAD_SUFFIXES = {".docx", ".pdf"}

ROOT = Path(__file__).resolve().parent

# Absolute paths of files produced by this server process (best-effort allowlist).
_GENERATED_PATHS: set[str] = set()

app = FastAPI(title="json2docx local server", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    """Resume JSON body. Template folder is taken from json.resume_template."""

    model_config = ConfigDict(populate_by_name=True)

    resume_json: Any = Field(
        ...,
        alias="json",
        description="Built resume JSON object or raw JSON string",
    )
    output_mode: str = Field(
        default="both",
        description="docx | pdf | both (default: both)",
    )


def _as_json_object(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        text = payload.strip()
        if not text:
            raise ValueError("json string is empty")
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("json must be an object")
        return data
    raise ValueError("json must be an object or JSON string")


def _resolve_resume_template_name(data: dict[str, Any]) -> str:
    name = str(data.get("resume_template") or "").strip()
    if not name:
        raise ValueError(
            'Built resume JSON must include a non-empty "resume_template" field '
            "(folder name under resume_template/, e.g. \"Jose\" or \"Oscar\")."
        )
    return name


def _file_payload(kind: str, path: Path) -> dict[str, str]:
    return {
        "kind": kind,
        "format": path.suffix.lower().lstrip(".") or "docx",
        "path": str(path.resolve()),
        "filename": path.name,
    }


def _downloads_root() -> Path:
    return downloads_dir().resolve()


def _is_under_downloads(path: Path) -> bool:
    try:
        path.resolve().relative_to(_downloads_root())
        return True
    except (OSError, ValueError):
        return False


def _register_generated(paths: list[Path]) -> None:
    for path in paths:
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if _is_under_downloads(resolved) and resolved.is_file():
            _GENERATED_PATHS.add(str(resolved))


def _resolve_download_target(*, path: str | None, filename: str | None) -> Path:
    downloads = _downloads_root()

    if path and str(path).strip():
        candidate = Path(str(path).strip()).expanduser()
        if not candidate.is_absolute():
            candidate = downloads / candidate.name
        target = candidate.resolve()
    elif filename and str(filename).strip():
        name = Path(str(filename).strip()).name
        if not name or name in {".", ".."}:
            raise ValueError("Invalid filename")
        target = (downloads / name).resolve()
    else:
        raise ValueError("Provide path= or filename=")

    if not _is_under_downloads(target):
        raise PermissionError("Download path must be under the Downloads folder")
    if target.suffix.lower() not in ALLOWED_DOWNLOAD_SUFFIXES:
        raise PermissionError("Only .docx and .pdf downloads are allowed")
    if not target.is_file():
        raise FileNotFoundError(f"File not found: {target.name}")

    # Prefer files this server generated; still allow same-basename under Downloads
    # so a restarted server can serve the latest generate output by filename/path.
    return target


def _media_type_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return "application/octet-stream"


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": APP_VERSION,
        "downloads": str(downloads_dir()),
        "root": str(ROOT),
    }


@app.get("/templates")
def templates() -> dict[str, Any]:
    scanned = scan_template_dirs(ROOT)
    items = []
    for path, missing in scanned:
        items.append(
            {
                "name": path.name,
                "ready": not missing,
                "missing": missing,
            }
        )
    ready = [p.name for p, missing in scanned if not missing]
    return {"ok": True, "templates": items, "ready": ready}


@app.post("/generate")
def generate(body: GenerateRequest) -> JSONResponse:
    try:
        data = _as_json_object(body.resume_json)
    except (ValueError, json.JSONDecodeError) as exc:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": f"Invalid json: {exc}"},
        )

    try:
        template_name = _resolve_resume_template_name(data)
        mode = OutputMode.from_cli(body.output_mode)
        bundle = load_template_bundle(resolve_template_dir(ROOT, template_name))
    except Exception as exc:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": str(exc)},
        )

    raw = json.dumps(data, ensure_ascii=False)
    result = process_json(raw, bundle, output_mode=mode)
    if not result.ok:
        return JSONResponse(
            status_code=422,
            content={
                "ok": False,
                "template": template_name,
                "output_mode": mode.value,
                "error": result.error or "Generation failed. Check server console for details.",
                "files": [],
            },
        )

    files = [_file_payload(item.kind, item.path) for item in result.outputs]
    _register_generated([item.path for item in result.outputs])
    return JSONResponse(
        content={
            "ok": True,
            "template": template_name,
            "output_mode": mode.value,
            "files": files,
            "downloads": str(downloads_dir()),
        }
    )


@app.get("/download")
def download(
    path: str | None = Query(default=None, description="Absolute file path under Downloads"),
    filename: str | None = Query(default=None, description="Basename under Downloads"),
):
    try:
        target = _resolve_download_target(path=path, filename=filename)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})
    except PermissionError as exc:
        return JSONResponse(status_code=403, content={"ok": False, "error": str(exc)})
    except FileNotFoundError as exc:
        return JSONResponse(status_code=404, content={"ok": False, "error": str(exc)})
    except Exception as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})

    return FileResponse(
        path=str(target),
        media_type=_media_type_for(target),
        filename=target.name,
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="json2docx local HTTP server")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Bind host (default {DEFAULT_HOST})")
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Bind port (default {DEFAULT_PORT})",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        # Safety: do not expose on LAN by default CLI misuse without explicit opt-in later.
        print(f"WARNING: binding to {args.host}; prefer 127.0.0.1 for extension use.")

    try:
        ready = list_template_dirs(ROOT)
        print(f"json2docx server {APP_VERSION}")
        print(f"  templates ready: {', '.join(p.name for p in ready)}")
        print(f"  downloads: {downloads_dir()}")
        print(f"  listen: http://{args.host}:{args.port}")
    except Exception as exc:
        print(f"WARNING: template scan: {exc}")

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
