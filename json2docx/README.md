# JSON to DOCX/PDF Console App

Generate tailored **resume** and **cover letter** files from JSON into your **Downloads** folder.

## Folder layout

```
resume_template/
  Andrew/
    resume.docx
    cover-letter.docx
    Andrew_RESUME_TEMP.txt    # optional empty template JSON skeleton
  Steven/
    resume.docx
    cover-letter.docx

sample_resume_JSON.txt        # completed sample (project root)
```

Each candidate folder (e.g. `Andrew/`, `Steven/`) must contain `resume.docx` and `cover-letter.docx`.

Optional per template folder:
- `fill-schema.json` — flat fill skeleton validated against DOCX placeholders

## Setup

```bash
pip install -r requirements.txt
pip install pywin32   # required for PDF export on Windows (Microsoft Word)
```

## Quick start

**Local HTTP server (for Chrome extension / Resume Builder):**
```bash
pip install -r requirements.txt
python server.py
# or: start_server.bat
```

Listens on `http://127.0.0.1:8765`:
- `GET /health`
- `GET /templates`
- `POST /generate` — body `{ "json": { ... }, "output_mode": "docx"|"pdf"|"both" }`  
  Template folder is read from the JSON field **`resume_template`** (e.g. `"Jose"`, `"Oscar"`).

**Interactive CLI (loop):**
```bash
python main.py
```

**One-shot from sample file:**
```bash
python main.py --template Jose --json-file sample_resume_JSON.txt --output-mode docx --once
```

Or double-click `run_sample.bat` (DOCX only).

## Complete workflow

```
START
  |
  v
[1] Scan + select template folder
      python main.py
      -> scans resume_template/ for candidate folders
      -> pick Andrew, Steven, ... by number or name
      OR: --template Andrew
  |
  v
[2] Load templates (fail fast if missing)
      resume.docx
      cover-letter.docx
      -> prints placeholder counts
  |
  v
[3] LOOP
      Choose output format:
        0 = exit app
        1 = DOCX only
        2 = PDF only
        3 = DOCX + PDF
      |
      v
      Paste completed resume JSON (Ctrl+Z, Enter)
      |
      v
      Process (% progress + timeline)
      [  6%] 14:30:22  JSON received
      [ 25%] 14:30:22  Parse and convert
      [ 40%] 14:30:22  Validate
      [ 75%] 14:30:22  Generate resume
      [100%] 14:30:23  Generate cover letter
      -> Timeline summary printed at end
      |
      v
      Back to step 3
  |
  v
Output -> %USERPROFILE%\Downloads
```

## CLI reference

| Flag | Description |
|------|-------------|
| `--template NAME` | Use `resume_template/NAME/` (skip menu, e.g. `Andrew`) |
| `--json-file PATH` | Load JSON from file (with `--once`) |
| `--template-json-file PATH` | Alias for `--json-file` |
| `--output-mode docx\|pdf\|both` | Output format for `--once` runs (default: both) |
| `--skip-pdf` | Shortcut for `--output-mode docx` |
| `--once` | Single non-interactive run (requires `--json-file`) |
| `--list-templates` | List template folders and exit |
| `--show-schema` | Print full fill JSON skeleton at startup |

## JSON input formats

### 1. Template JSON (recommended)

Nested format like `sample_resume_JSON.txt` or `Andrew_RESUME_TEMP.txt`:

```json
{
  "schema_version": "1.0",
  "resume_filename": "Name_Role_Resume",
  "cover_letter_filename": "Name_Role_Cover_Letter",
  "profile_title": {
    "placeholder": "<<Profile_title>>",
    "text": "Senior Software Engineer",
    "bold_words": ["Senior Software Engineer"]
  }
}
```

- App walks the tree for `placeholder` / `text` / `bold_words`
- `resume_filename` / `cover_letter_filename` set output names
- Cover letter body paragraphs are mapped onto `cover-letter.docx`

### 2. Fill JSON (flat)

```json
{
  "resume": {
    "filename": "Name_Role_Resume",
    "<<Profile_title>>": { "text": "...", "bold-words": [] }
  },
  "cover_letter": {
    "filename": "Name_Role_Cover_Letter",
    "<<Profile-title>>": { "text": "...", "bold-words": [] }
  }
}
```

## What JSON controls vs DOCX template

| From JSON | From DOCX template |
|-----------|-------------------|
| Placeholder text | Fonts, sizes, colors |
| `bold_words` | Margins, alignment |
| Output filenames | Layout, borders, spacing |

## Notes

- Placeholder replacement: **body paragraphs only** (not tables, headers, footers)
- Metadata stripped from output DOCX/PDF when possible
- PDF export: Windows + Microsoft Word + pywin32
- Exit code: `0` success, `1` error (for scripting)

## Project modules

| File | Role |
|------|------|
| `main.py` | CLI entry point |
| `server.py` | Local HTTP API (`/health`, `/templates`, `/generate`) |
| `pipeline.py` | JSON processing orchestration + progress |
| `templates.py` | Template discovery, loading, fill schema |
| `json_io.py` | JSON parse, validate, generation plan |
| `template_json_converter.py` | Nested template JSON -> fill format |
| `generator.py` | DOCX/PDF generation to Downloads |
| `output_mode.py` | Output format enum (DOCX / PDF / both) |
| `docx_utils.py` | Placeholder extraction + DOCX fill |
| `replacements.py` | Shared text/filename normalization |
| `constants.py` | Shared constants |
| `progress.py` | Console progress reporter |
| `word_export.py` | DOCX -> PDF via Word COM |
| `metadata_utils.py` | Strip file metadata |
