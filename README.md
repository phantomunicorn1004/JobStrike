# RemoteWorkSheet

Member app + Chrome extension for remote job applications: Resume DB, pipeline, Job Scraper, Resume Builder / Tailor, and autofill.

## Resume Builder + local DOCX

Generate tailored resume/cover DOCX (or PDF) from built resume JSON via a **local** Python server:

- Flow, settings, troubleshooting, smoke checklist: [`docs/RESUME_BUILDER_FLOW.md`](docs/RESUME_BUILDER_FLOW.md)
- Server / CLI: [`json2docx/README.md`](json2docx/README.md)
- Extension Register usage: [`smart_job_extension/README.md`](smart_job_extension/README.md)

Quick start:

```bash
cd json2docx
pip install -r requirements.txt
python server.py
```

Then enable json2docx in website **Settings** and/or the extension **Settings** (`http://127.0.0.1:8765`).

## Windows: build error with path containing `#`

If you see:

```text
TypeError [ERR_INVALID_ARG_VALUE]: The argument 'path' must be a string ... without null bytes.
Received 'C:\\\x00#GitHub_proj\\...'
```

your project path contains `#` (e.g. `C:\#GitHub_proj\remote-work-helper`). Tailwind/PostCSS on Windows can then produce invalid paths and the build fails.

**Fix:** Move the repo to a path **without** `#`, for example:

- `C:\GitHub_proj\remote-work-helper` (rename the folder from `#GitHub_proj` to `GitHub_proj`), or  
- `C:\dev\remote-work-helper`

Then run `npm run build` again from the new location.
