# Smart Job Autofill Assistant

A Chrome Manifest V3 extension for job application workflows.

It combines two features:

1. Saved job tracking with JSON export.
2. Job application autofill with a user profile and custom question answer bank.

The extension is intentionally review-first. It does **not** auto-submit applications.

## Main Features

- Open a side panel on any job application page.
- Save a reusable user profile.
- Scan application forms for inputs, textareas, selects, radio buttons, checkboxes, and file inputs.
- Match normal fields to saved profile values.
- Match unusual application questions against a custom question answer bank.
- Let the user edit suggested answers before filling.
- Fill only selected fields.
- Skip legal/consent checkboxes for safety.
- Keep saved jobs in the same JSON shape as the previous extension:

```json
{
  "name": "Jerry Vang",
  "title": "Staff Software Engineer",
  "company_name": "Example Company",
  "job_link": "https://example.com/job",
  "note": ""
}
```

## Extension Files

```text
manifest.json
icons/                 # extension + toolbar icons (teal lightning mark)
background.js
field-registry.js
content.js
sidepanel.html
sidepanel.js
sidepanel.css
README.md
```

## Extension icon

Toolbar and Chrome Web Store icons use the same teal squircle + lightning mark as the side panel header (`icons/icon.svg`). To regenerate PNGs after editing the SVG:

```bash
python scripts/generate-icons.py
```

## How to Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked**.
4. Select this extension folder.
5. Pin the extension from the Chrome toolbar.

## Resume Builder / Register (json2docx)

Register tab flow for tailored resumes:

1. **Settings → Website connection** — sign in so **Profile** options load.
2. Start local server: `json2docx/start_server.bat` or `python json2docx/server.py` (`http://127.0.0.1:8765`).
3. **Settings → json2docx** — enable, confirm URL, choose DOCX / PDF / both, Test connection.
4. **Register** — select Profile → **Edit kit** (original prompt + resume JSON) → Save.
5. Put JD in **Note** (or scrape) → **Build & Copy Prompt** → GPT → paste built JSON.
6. **Generate Files** → review/remove attach chips → Register / Mark Applied.

Required JSON fields: `resume_template`, `job_title`, `company_name`, `job_description`.

Full checklist and troubleshooting: [`docs/RESUME_BUILDER_FLOW.md`](../docs/RESUME_BUILDER_FLOW.md).

## How to Use

### 1. Open the side panel

Click the extension icon in the Chrome toolbar. The autofill side panel opens directly (no popup).

### 2. Save your profile

Open the **Profile** tab and fill in your common application details.

Examples:

- Name
- Email
- Phone
- LinkedIn
- GitHub
- Portfolio
- Work authorization answer
- Sponsorship answer
- Desired salary
- Relocation preference

Click **Save Profile**.

**Demographics & EEO** uses dropdowns with standard answers (Yes/No, Man/Woman, common race categories, etc.). You do not need to type exact job-board wording — the extension maps your choices when filling applications.

### 3. Add custom answers

Open the **Questions** tab.

Create reusable answers for questions such as:

- Why are you interested in this role?
- Why do you want to work here?
- Describe your React experience.
- Describe your AI/LLM experience.
- Are you willing to relocate?

Each custom answer supports multiple question patterns. The scanner compares detected application questions to these patterns.

### 4. Scan an application page

Open a job application page, then click **Scan Current Page** in the Autofill tab.

The extension will show:

- Detected question/label
- Field category
- Suggested value
- Source
- Confidence
- Status

Review the suggestions carefully.

### 5. Fill selected fields

Select the fields you want to fill, edit answers if needed, then click **Fill Selected**.

The extension does not submit the application. You must review the page and submit manually.

## Safety Rules

The extension does not:

- Auto-submit job applications.
- Bypass CAPTCHA.
- Bypass job site protections.
- Invent profile data.
- Send page data to external servers.
- Store Google tokens.
- Automatically check legal consent, certification, privacy, or terms agreement boxes.

## File Upload Limitation

Resume and cover letter **file inputs** can be filled from your **default application kit** (Profile → Application kits). The content script reads kit files directly from extension storage (so large PDFs are not sent through the tab message channel). It attaches the stored file (PDF, DOC, DOCX; cover letters also TXT) when the page’s `accept` attribute allows that type. On **Greenhouse**, this targets the hidden `#resume` and `#cover_letter` inputs behind the **Attach** / Dropbox / Enter manually pill buttons. On **Lever**, it targets `data-qa="input-resume"` / `#resume-upload-input` and `data-qa="application-file-upload"` without opening the native file picker. On **Rippling**, it uses `data-testid` resume/cover inputs plus drag-drop when needed.

If no file is in the default kit, or the site rejects the file type, the field stays marked for manual upload.

## Current Limitations

This is a vanilla-JavaScript MVP. It works best on standard HTML forms and many common ATS pages, but complex sites may need platform-specific adapters.

Recommended next adapters:

1. Ashby (partial)
2. SmartRecruiters (partial)
3. Workday (Phase 0 — My Information)
4. iCIMS
5. Taleo

Implemented: **Greenhouse**, **Lever**, **Rippling**, **Workday** (Phase 0 — My Information; see ATS adapters below).

## Developer Notes

Storage keys kept for backward compatibility:

```js
scraped_jobs
job_scraper_user_name
job_scraper_daily_date
job_scraper_daily_count
job_scraper_daily_limit
```

New storage keys:

```js
autofill_profile             // chrome.storage.local (single profile field data: name, email, etc.)
autofill_application_kits    // chrome.storage.local (array of resume + cover letter + work experience kits)
custom_question_bank         // chrome.storage.local
autofill_settings            // chrome.storage.local (thresholds + daily limit)
autofill_session_scan        // chrome.storage.session (last scan + plan)
autofill_hide_filled_fields  // chrome.storage.local (UI toggle for hiding fillable rows)
autofill_hero_dismissed      // chrome.storage.local (whether the autofill hero card is dismissed)
autofill_total_filled        // chrome.storage.local (lifetime field-fill counter)
promptKit_v1_{profileId}     // per-profile kit (synced from website /resume-builder Save)
json2docx_enabled            // local json2docx server toggle
json2docx_base_url           // default http://127.0.0.1:8765
json2docx_output_mode        // docx | pdf | both
```

## Profile & application kits

The **Profile** tab has two parts:

1. **Profile fields** — one shared set of values (name, email, phone, etc.) used for normal application fields during autofill.

2. **Application kits** — multiple resume + cover letter pairs, each with its own **work experience**:
   - `role_title` per role (e.g. "Senior Software Engineer — Acme Corp")
   - Optional employer, dates, location, phone, reason for leaving (used on Lever **Employment** cards)
   - `role_bullets` — bullet points for that role (one per line in the UI; maps to “responsibilities” fields)

Use different kits for different job targets (e.g. "Frontend SWE" vs "Backend SWE"). Mark one kit as **default** for future file-upload autofill.

Accepted file types: resumes `.pdf`, `.doc`, `.docx`; cover letters also `.txt`. Per-file cap is 10 MB. Files are stored as base64 data URLs inside `autofill_application_kits`. The `unlimitedStorage` permission avoids quota issues with larger files.

Older installs that used `autofill_profiles` are migrated automatically: active profile data becomes `autofill_profile`, and each uploaded resume/cover pair becomes a kit.

## Settings

The **Settings** tab in the side panel exposes the previously hard-coded matching thresholds:

- *Custom question similarity* — minimum similarity (0–1) to suggest a saved answer.
- *Select option match* — minimum similarity to pick a dropdown option.
- *Radio/checkbox match* — minimum similarity to pick a radio choice.
- *Auto-select confidence* — required confidence before a custom answer is pre-checked.
- *Daily save limit* — caps how many new jobs you can save per day.
- *Remember scan results* — when enabled, your current scan + checkbox state survive closing/reopening the side panel via `chrome.storage.session`.

## Cross-platform demographics (field registry)

EEO and demographic questions use different **wording** and **answer lists** on each ATS (Greenhouse, Lever, Workday, Rippling, etc.). The extension handles that in three layers:

| Layer | Role | Example |
|-------|------|---------|
| **Profile** | One semantic value per field (`race`, `genderIdentity`, `veteranStatus`, …) | `Asian`, `Man`, `No` |
| **`field-registry.js`** | Maps labels, `name`/`id`, and platform IDs → category; expands profile values into likely option text | Label “Please identify your race” → `race`; profile `Asian` → also try `Asian (Not Hispanic or Latino)` |
| **ATS adapters** | Host detection, scan root, DOM quirks (react-select, Lever `eeo[...]`, Workday `data-automation-id`) | Greenhouse `#application_form`; Lever voluntary EEO not prefilled |

**Detection order** for a field: adapter `resolveFieldCategory` (registry + platform IDs) → adapter `mapNameToCategory` / `mapIdToCategory` → generic `classifyField` (registry label patterns + heuristics).

**Fill order** for dropdowns: registry `getDemographicCandidates` + `demographicOptionScore` (prefix match, yes/no long labels) → shared combobox/select/radio fill.

To support a new site or wording, prefer editing **`field-registry.js`** (`PROFILE_FIELD_DEFS` label/name patterns, race/veteran aliases). Add platform-specific IDs under `PLATFORM_FIELD_IDS` only when labels are unreliable. Add a new adapter when you need a dedicated scan root or host score (e.g. Workday, Rippling).

## ATS Adapters

The extension auto-detects supported ATS platforms during a scan and uses platform-specific selectors when available. Currently shipped:

- **Greenhouse** — detects `boards.greenhouse.io`, `job-boards.greenhouse.io`, and pages containing `job_application[...]` field names. Improves label extraction via `.field` containers and maps `job_application[first_name]`, `job_application[urls_linkedin]`, etc. directly to the right category. **Location (City)** (`#candidate-location`) is a react-select combobox: autofill types your city, waits for async suggestions, then picks the best match (same approach as Lever current location). **Field templates** map standard embed IDs and labels (e.g. `first_name`, `question_*` + “LinkedIn Profile”, EEO `gender` / `hispanic_ethnicity`, U.S. demographic numeric IDs) to profile categories so they are not treated as custom questions. **Gender identity** (“How would you describe your gender identity?”) is separate from EEO **Gender** and uses the **Gender identity** profile value (e.g. Man, Woman, Non-binary). **Sexual orientation** uses the **Sexual orientation** profile value (e.g. Heterosexual, Gay, Lesbian, Bisexual). For Greenhouse multi-select demographic dropdowns, autofill **clears existing tags** and picks **one** option that best matches your profile (use a single value per field, e.g. `East Asian` rather than `Asian/East Asian`).

### Hybrid AI autofill (optional)

- **Without OpenAI** — same as before: profile, application kits, and custom Q&A; per-field **Fill** uses your saved values.
- **With OpenAI** — Settings → enable **AI fill buttons** and save your API key (stored locally). Each field gets two actions: regular **Fill** and purple **✨ Fill** (AI). The main card also shows **Autofill with AI**, which generates missing answers then fills the page.
- AI uses your profile, default kit work experience, custom answers, and detected job title/company. File uploads still use kits; use regular Fill for resume/cover when a kit file is attached.
- **Lever** — detects `jobs.lever.co` (and `*.lever.co` career subdomains), `.application-page`, `#application-form`, and `data-qa` markers (`input-resume`, `name-input`, `email-input`, `phone-input`, `location-input`, `org-input`, `application-file-upload`, `multiple-choice`, `checkboxes`, `additional-cards`). Reads questions from `.application-label .text` (strips required `✱` markers); card sections merge `[data-qa="card-name"]` with field labels when helpful. Maps standard fields via `name` / `data-qa` (`name` → full name, `org` → current company, `urls[LinkedIn]` → LinkedIn, etc.). Custom **cards** (`cards[uuid][fieldN]`) classify from question text (work authorization, sponsorship, education, address, and other profile-backed labels) or fall back to **custom question**. **Acknowledgments** (“I have read this” on long disclaimers / employment-history intros) autofill when detected. **Employment** cards map numbered employer blocks to your default application kit’s work experience (employer, title, dates, responsibilities, reason for leaving, current employer Yes/No). **Resume** and **cover letter** attach from your default kit via hidden `.application-file-input` (no click on the “Attach” overlay). **Current location** uses Lever’s async dropdown (`location-input` + `selectedLocation` hidden field). EEO (`eeo[...]`) and `surveysResponses[...]` are voluntary (not prefilled). Fixture: `fixtures/lever-sample.html`.
- **Ashby** — detects `jobs.ashbyhq.com` / `*.ashbyhq.com` application pages (`#form`, `.ashby-application-form-container`) and `data-field-path` tokens (`_systemfield_name`, `_systemfield_email`, `_systemfield_resume`, `_systemfield_location`, EEO `_systemfield_eeoc_*`). Skips the built-in **Autofill from resume** uploader (top pane) so only the application **Resume** field is filled from your kit. **Yes/No** questions use Ashby’s button UI (sponsorship, work authorization, etc.). **Location** uses the `role="combobox"` search input. **Résumé** attaches via hidden file input without opening the OS file picker. Fixture: `fixtures/ashby-sample.html`.
- **SmartRecruiters** — detects `*.smartrecruiters.com` and embedded application forms (`data-automation="job-application-form"`). Maps `firstName`, `lastName`, `email`, `resume`, etc. Diversity / EEO blocks are marked voluntary (not prefilled).
- **Workday** — detects `*.workday.com` / `myworkdayjobs.com` apply flows. **Phase 0 (My Information)** scans `[data-automation-id="applyFlowPage"]` / `applyFlowMyInfoPage`, reads labels from `formField-*` blocks (`data-automation-id="formField-legalName--firstName"`, etc.), and maps name/address/phone/country fields to profile categories. Supports Workday listbox **buttons** (`aria-haspopup="listbox"`), multiselect search inputs, styled text inputs (React `value` setter), and yes/no radios (`true`/`false` values). Skips progress bar, footer, hidden value mirrors (`.css-77hcv`), and SMS opt-in legal checkbox. Suggested defaults: former employee → **No**, phone device type → **Mobile**. Fixture: `fixtures/workday-sample.html`. Later phases: Experience, Application Questions, Voluntary Disclosures, multi-step re-scan.
- **Rippling** — detects `*.rippling.com` apply forms via `data-testid` field tokens (`first_name`, `linkedin_link`, `eeoc.gender`, `eeoc.race`, etc.). Maps obfuscated `name` attributes using `data-input` / `data-testid` wrappers (`[data-testid="field"]` + `[id$="-label"]`). Supports Rippling select controllers (search combobox + button-style combobox), location autocomplete, and résumé/cover file uploads. EEO fields prefill from profile demographics. Skips phone country code, hidden place IDs, Turnstile, and SMS opt-in.

### Adapter detection (Phase 0)

- **Scoring registry** — each adapter returns a score; the highest score at or above the threshold (25) wins. Otherwise the generic `default` adapter is used.
- **Scoped scan** — Greenhouse and Lever scan only their application form root (`#application_form`, `#application-form`) to reduce footer/nav noise.
- **Debug panel** — Autofill tab → **Adapter detection** shows active adapter, scan root, score table, and field counts. Use **Refresh detection** without a full autofill run.
- **Fixtures** — open `fixtures/greenhouse-sample.html`, `fixtures/lever-sample.html`, or `fixtures/workday-sample.html` locally to verify detection (see `fixtures/README.md`).

The active adapter name is shown in the scan status message (e.g. *"Scan complete. Found 24 fields (lever adapter)."*).

### Radio / checkbox groups (Lever `data-qa="multiple-choice"`)

Lever uses `<input type="radio">` inside `<ul data-qa="multiple-choice">` — this is a **single-choice radio group** (`radio-group`), not a checkbox list. Checkbox lists on Lever use `<ul data-qa="checkboxes">` with multiple `type="checkbox"` sharing a name (`checkbox-group`). All options appear in the side panel; fill picks the closest match to your saved answer.

### Lever-specific risks

| Risk | Mitigation |
|------|------------|
| **Voluntary EEO / survey sections** scanned | Shown as optional; no profile autofill suggested |
| **Resume file input** often invisible (`invisible-resume-upload`, Greenhouse `visually-hidden`) | Detected via `#resume` / `#cover_letter`; filled from default kit when `accept` matches |
| **Location autocomplete** needs pick-from-list | Uses `search-autocomplete` fill (type, wait, click result) |
| **Other extensions** (e.g. Simplify shadow DOM) | Scan targets `#application-form` only; shadow roots are not pierced |
| **False adapter match** on non-Lever pages | Detect requires `#application-form` or Lever host + form markers |
| **`host.endsWith('.lever.co')` removed** | Was too broad; now `jobs.lever.co` or `*.lever.co` career hosts only |

## Keyboard Shortcut

The extension includes a command:

```text
Ctrl+Shift+J / Command+Shift+J
```

It scrapes the current job title/company/link and saves it to the saved jobs list when possible.

You can change the shortcut at `chrome://extensions/shortcuts`.
