from __future__ import annotations

import argparse
import json
from pathlib import Path

from constants import (
    COVER_LETTER_DOCX_NAME,
    FILL_SCHEMA_NAME,
    RESUME_DOCX_NAME,
    TEMPLATE_ROOT_NAME,
)
from output_mode import OutputMode
from pipeline import process_json
from templates import (
    downloads_dir,
    list_template_dirs,
    load_fill_schema,
    load_template_bundle,
    resolve_template_dir,
    scan_template_dirs,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="JSON to DOCX/PDF console app")
    parser.add_argument(
        "--template",
        help=f"Candidate folder name under {TEMPLATE_ROOT_NAME}/ (e.g. Andrew)",
    )
    parser.add_argument(
        "--output-mode",
        choices=["docx", "pdf", "both"],
        help="Output format for --once runs (default: both, or docx if --skip-pdf).",
    )
    parser.add_argument(
        "--skip-pdf",
        action="store_true",
        help="Shortcut for --output-mode docx (DOCX only).",
    )
    parser.add_argument("--json-file", help="Load JSON from file (used with --once).")
    parser.add_argument(
        "--template-json-file",
        dest="json_file",
        help="Alias for --json-file.",
    )
    parser.add_argument("--show-schema", action="store_true", help="Print full fill JSON schema.")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Single non-interactive run (requires --json-file and --output-mode or --skip-pdf).",
    )
    parser.add_argument("--list-templates", action="store_true", help="List templates and exit.")
    return parser.parse_args()


def _print_banner() -> None:
    print("JSON to DOCX/PDF Console App")
    print("----------------------------")
    print("Workflow:")
    print(f"  1. Scan + select template ({TEMPLATE_ROOT_NAME}/Andrew/, Steven/, ...)")
    print(f"  2. Load {RESUME_DOCX_NAME} + {COVER_LETTER_DOCX_NAME}")
    print("  3. Loop:")
    print("       0 = exit")
    print("       1 = DOCX only  |  2 = PDF only  |  3 = DOCX + PDF")
    print("       -> paste completed resume JSON")
    print("       -> % progress + timeline")
    print("       -> back to menu")


def _ask_output_mode() -> OutputMode | None:
    print("\nOutput format:")
    print("  0 = exit app")
    print("  1 = DOCX only")
    print("  2 = PDF only")
    print("  3 = DOCX + PDF")
    while True:
        choice = input("Choose [0-3]: ").strip()
        if choice == "0":
            return None
        mode = OutputMode.from_menu_choice(choice)
        if mode is not None:
            print(f"Selected: {mode.label()}")
            return mode
        print("Invalid choice. Enter 0, 1, 2, or 3.")


def _read_multiline_json_input() -> str:
    print("\nPaste completed resume JSON.")
    print("Press Ctrl+Z then Enter when finished.")
    lines: list[str] = []
    try:
        while True:
            lines.append(input())
    except EOFError:
        pass
    text = "\n".join(lines).strip()
    if text:
        print("\n--- Input received, starting generation ---", flush=True)
    return text


def _cli_output_mode(args: argparse.Namespace) -> OutputMode:
    if args.output_mode:
        return OutputMode.from_cli(args.output_mode)
    if args.skip_pdf:
        return OutputMode.DOCX_ONLY
    return OutputMode.BOTH


def main() -> int:
    args = _parse_args()
    root = Path(__file__).resolve().parent
    _print_banner()

    if args.list_templates:
        try:
            scanned = scan_template_dirs(root)
            print(f"\nScanned {TEMPLATE_ROOT_NAME}/:")
            if not scanned:
                print("  (no subfolders found)")
            for path, missing in scanned:
                if missing:
                    print(f"  {path.name}/  incomplete (missing {', '.join(missing)})")
                else:
                    print(f"  {path.name}/  ready")
        except Exception as exc:
            print(f"\nERROR: {exc}")
            return 1
        return 0

    try:
        bundle = load_template_bundle(resolve_template_dir(root, args.template))
    except Exception as exc:
        print(f"\nERROR: {exc}")
        return 1

    print(f"\nTemplates loaded from {TEMPLATE_ROOT_NAME}/{bundle.dir.name}/")
    print(f"  OK  {RESUME_DOCX_NAME} ({len(bundle.resume_placeholders)} placeholders)")
    print(f"  OK  {COVER_LETTER_DOCX_NAME} ({len(bundle.cover_placeholders)} placeholders)")

    try:
        schema, schema_path = load_fill_schema(bundle)
    except Exception as exc:
        print(f"\nERROR: {exc}")
        return 1

    if schema_path:
        print(f"\nFill JSON schema file: {schema_path}")
    else:
        print(f"\nFill JSON schema: auto-generated ({FILL_SCHEMA_NAME} not found)")
    print(
        f"  Resume placeholders: {len(bundle.resume_placeholders)} | "
        f"Cover letter placeholders: {len(bundle.cover_placeholders)}"
    )
    if args.show_schema:
        print("\nFull fill JSON schema:")
        print(json.dumps(schema, indent=2, ensure_ascii=False))
    else:
        print("  (use --show-schema to print the full JSON skeleton)")

    print(f"\nOutput folder: {downloads_dir()}")

    json_file = (args.json_file or "").strip()
    if args.once:
        if not json_file:
            print("\nERROR: --once requires --json-file")
            return 1
        try:
            raw = Path(json_file).read_text(encoding="utf-8")
            mode = _cli_output_mode(args)
            print(f"\nLoaded JSON file: {json_file}")
            print(f"Output mode: {mode.label()}")
            result = process_json(raw, bundle, output_mode=mode)
            return 0 if result.ok else 1
        except Exception as exc:
            print(f"\nERROR: {exc}")
            return 1

    last_ok = True
    while True:
        mode = _ask_output_mode()
        if mode is None:
            print("\nExiting.")
            break

        raw = _read_multiline_json_input()
        if not raw.strip():
            print("\nEmpty JSON. Returning to menu.")
            continue

        result = process_json(raw, bundle, output_mode=mode)
        last_ok = result.ok

    return 0 if last_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
