# Resume Builder + json2docx flow

End-to-end path: **profile prompt kit → GPT resume JSON → local DOCX/PDF → Register / Resume DB**.

This doc covers the Chrome extension Register tab, website Resume Builder / Settings, and the local `json2docx` Python server.

---

## Components

| Piece | Role |
|-------|------|
| Website `/resume-builder` | Per-profile prompt kit (browser `localStorage` + sync to extension) |
| Website `/settings` | Enable json2docx URL + output mode; Test connection |
| Website `/prompt-builder`, `/resume-tailor` | Original tools (unchanged) |
| Extension Register | Prompt kit (`chrome.storage`), Build & Copy Prompt, paste JSON, Generate Files, Register |
| Extension Settings | Website sign-in + json2docx enable / URL / output mode |
| `json2docx/server.py` | Local API on `127.0.0.1:8765` → writes files to Downloads |

**Note:** Prompt kits sync between website Resume Builder and the extension when the extension is installed and this site is open (content-script bridge → `chrome.storage` key `promptKit_v1_{profileId}`). Without the extension, the website keeps a localStorage cache only.

---

## Built resume JSON contract

GPT / paste JSON **must** include these top-level fields (strings):

| Field | Purpose |
|-------|---------|
| `resume_template` | Folder name under `json2docx/resume_template/` (e.g. `Jose`, `Oscar`) |
| `job_title` | Register job title |
| `company_name` | Register company |
| `job_description` | Register Note / JD |

Also keep existing fill structure (`placeholder` / `text` / `bold_words`) and filenames (`resume_filename`, `cover_letter_filename`) expected by the DOCX templates.

---

## Optimized Register workflow

```
Select Profile
    → Edit kit (original prompt + resume_template_json) once
    → Note / scrape fills job description
    → Build & Copy Prompt → paste into GPT
    → Paste built JSON into Register
    → Generate Files (json2docx) → auto-attach (removable)
    → Mark Applied / Register
```

**Source of truth after JSON is present**

| Field | Source |
|-------|--------|
| Profile | Extension profile select |
| Job link | Current tab / Refresh |
| Job title / Company / Note | Built resume JSON |
| Resume / cover files | json2docx Downloads → auto-attach |

---

## Start the local server

```bash
cd json2docx
pip install -r requirements.txt
python server.py
# or double-click start_server.bat
```

Listens on **`http://127.0.0.1:8765`** only.

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Alive check (`ok`, `version`, `downloads`) |
| `GET /templates` | List template folders + readiness |
| `POST /generate` | Body `{ "json": {…}, "output_mode": "docx"\|"pdf"\|"both" }` |
| `GET /download?path=` or `?filename=` | Fetch a generated `.docx`/`.pdf` from Downloads |

Template folder is taken from JSON **`resume_template`**, not from a separate API argument.

PDF mode needs **Windows + Microsoft Word + `pywin32`**.

---

## Extension setup

1. Load unpacked: `smart_job_extension/` (`chrome://extensions` → Developer mode).
2. **Settings → Website connection:** sign in (loads profiles).
3. **Settings → json2docx:** enable, URL `http://127.0.0.1:8765`, output mode (default DOCX).
4. Start `json2docx/server.py`, then **Test connection** (or watch the Register status dot).
5. Register tab: select **Profile**, Edit kit → Save, then use **Build & Copy Prompt**.

Reload the extension after code updates.

---

## Website setup

1. Sign in as a member.
2. **Settings → json2docx local server:** enable + Test (browser calls localhost; CORS is open on the Python server).
3. **Resume Builder:** select Profile, edit/save kit, Build + Copy.
4. Keep **Resume Tailor** for the workflow-canvas path.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Health / Test = offline | Server not running | `python server.py` or `start_server.bat` |
| Connection refused | Wrong host/port | Use `127.0.0.1:8765` (not a LAN IP) |
| Generate: missing `resume_template` | GPT omitted field | Ensure kit + default prompt require it; fix JSON |
| Generate: template not found | Name ≠ folder | Match `resume_template/` folder exactly (`Jose`, `Oscar`, …) |
| PDF fails | No Word / no pywin32 | Use DOCX mode, or install Word + `pip install pywin32` |
| Files not attached | json2docx disabled / generate error | Enable in Settings; check progress/error on Register |
| Download blocked | Path outside Downloads | Server only serves Downloads `.docx`/`.pdf` |
| CORS in browser Settings | Old server without CORS | Update / restart `server.py` (allows `*`) |
| Build & Copy empty JD | Note empty | Scrape / paste JD into Note, or save JD in kit |
| Website kit ≠ extension kit | Extension not loaded / outdated | Reload extension; reopen `/resume-builder` and Save kit again |

---

## Smoke checklist

### A. json2docx server

- [ ] `pip install -r json2docx/requirements.txt`
- [ ] `python json2docx/server.py` starts without error
- [ ] `GET http://127.0.0.1:8765/health` → `{ "ok": true, … }`
- [ ] `GET /templates` lists ready folders (e.g. Jose, Oscar)
- [ ] `POST /generate` with sample JSON + `"resume_template":"Jose"` writes files under Downloads
- [ ] `GET /download?filename=…` returns the file

### B. Website

- [ ] `/settings` → enable json2docx → Test connection succeeds while server runs
- [ ] `/resume-builder` → select Profile → Save kit → Build + Copy
- [ ] `/prompt-builder` and `/resume-tailor` still open (unchanged)

### C. Extension Register

- [ ] Sign in; Profile dropdown lists profiles (label says **Profile**)
- [ ] json2docx status dot goes green when server is up
- [ ] Edit kit → Save → **Build & Copy Prompt** puts text on clipboard
- [ ] Paste valid built JSON → title / company / note fill; job link stays from tab
- [ ] **Generate Files** → progress → attach chips appear and can be removed
- [ ] Register / Mark Applied succeeds with JSON-backed draft

### D. Naming

- [ ] UI says Profile (not Candidate) on Register, Resume DB filters, Job Scraper, Dashboard
- [ ] ATS field ids like `candidate-location` still work (not renamed)

---

## Related docs

- [`json2docx/README.md`](../json2docx/README.md) — CLI + server modules
- [`smart_job_extension/README.md`](../smart_job_extension/README.md) — load / autofill overview
- [`docs/RESUME_TEMPLATE_GUIDE.md`](./RESUME_TEMPLATE_GUIDE.md) — resume JSON / template structure
