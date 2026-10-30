# AutoGen

Chrome extension (side panel) that generates tailored resume JSON for Resume DB
applications queued for generation, with either of two engines:

| Engine | How the JSON is produced | Needs |
|---|---|---|
| **ChatGPT tab** | Pastes the prompt into the chatgpt.com tab that is active in the window, waits for the answer, sends the raw reply to JobStrike | A signed-in chatgpt.com tab, kept active and visible in each running window |
| **API key** | JobStrike's server calls OpenAI with its own key | `OPENAI_API_KEY` on the server (optional `OPENAI_RESUME_MODEL`, `OPENAI_RESUME_REASONING_EFFORT`) |

Both engines use the **same prompt**: the application's profile's own prompt
kit (edited on the website's Resume Builder page or the JobStrike extension's
Edit kit), filled with the profile's resume JSON and the job description. Both
end in the **same server checks** before anything is saved:

1. The JSON is extracted from the answer (fences, prose, examples; curly quotes kept).
2. The kit's facts are put back: contact details, education, and every role's
   employer, title, location, work arrangement and dates. Changes the model
   made are listed in `generation_meta.restored`.
3. Every placeholder of the kit must be present, filled, and free of leftover
   `<<…>>`; bold words must appear verbatim in their text.

Kits that cannot produce a usable resume (fictional mode, a prompt without
`{job_description}` or `{resume_template_json}`, a blank employer or title,
invalid JSON) are refused before any ChatGPT run or API call; the application
becomes `failed` with the reason. The Resume Builder page shows the same check
live while the kit is edited.

## Setup

1. Run `scripts/add-autogen-to-resume-db.sql` once in the Supabase SQL editor.
2. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
3. Open the side panel → **Settings**: Server URL (e.g. `http://localhost:3000`),
   your JobStrike **username** and **password**, and the **Engine**. Save, then
   press ↻ under Connection: it should say *Connected · your username*.

Sign-in uses `POST /api/auth/login {username, password}`; the returned
extension key is sent as `X-Extension-Key` (the same key the JobStrike
extension uses). The password is never included in Export config.

## Running

- **Applications tab** lists queued, generating and failed applications.
  Tick some and press **Run selected** (failed ones are re-queued first), or
  **Run in background** to keep claiming the oldest queued application.
- Each window runs one application at a time. With the ChatGPT engine, every
  application starts in a **new temporary chat** by default, so no earlier job,
  candidate or ChatGPT memory is in context. With the API engine no tab is
  needed. More windows = more in parallel.
- **Stop** gives the in-flight application back to the queue.
- After a Chrome restart, as many restored windows as were running start again
  by themselves: each one whose active tab is ChatGPT (not minimized), for up
  to 15 minutes after the restart. Reloading the extension stops every window.
- Every minute (and when a window starts or stops) it reports its windows to
  JobStrike, for the website's Auto-bid page: running or not, what each one is
  generating, minimized or not on a ChatGPT tab. No prompt or job text is sent.

## Server API (`app/api/autogen/*`)

| Route | Body | Result |
|---|---|---|
| `GET applications` | | `{ applications }` (queue, generating, failed) |
| `GET next-application` | | `{ application }` claimed with `rendered_prompt`, or `{ application: null, skipped }` |
| `POST applications/:id/claim` | | `{ application }` or `{ application: null, reason, detail }` |
| `POST applications/:id/refresh-claim` | `{ claimedAt }` | `{ ok, claimedAt }`; `ok: false` = another worker took it |
| `POST applications/:id/submit-answer` | `{ answer, claimedAt, attempt, chatgptModel }` | `{ status: "Success" }` or `{ status: "Error", detail, retryable, claimLost? }` |
| `POST applications/:id/generate` | `{ claimedAt, attempt }` | same as submit-answer (API engine) |
| `POST applications/:id/report-failure` | `{ claimedAt, detail }` | application → `failed` |
| `POST applications/:id/release` | `{ claimedAt }` | application → `queue` |
| `POST enqueue` | `{ ids }` | `{ queued }`: re-queue failed/completed rows |

Jobs enter the queue through `POST /api/resume-db/capture`
(`apply = "Queued"`, not counted as a bid until it is sent).

Claims are compare-and-swap on `(generation_status, autogen_claimed_at)`: two
workers never get the same application, and only the holder can save,
release or fail it. A claim not refreshed for 10 minutes (window closed,
crash) becomes claimable again.

## ChatGPT blocked states

Before each prompt and while waiting, the content script checks the page
(outside the conversation) for a usage limit, "too many requests", a
human-verification check, or a signed-out page. Any of these pauses the window
and gives the application back to the queue; it does not use up retries.

## Tests

`node tests/test-extraction.js`: answer completion and JSON extraction in the
tab, blocked-page detection, and the fresh-chat default. Server checks are
covered by `npm test` in the repository (`tests/autogen/*`).

## Known limits

- ChatGPT's page markup is not a public contract; selectors in
  `chatgpt-content.js` are the first thing to check if the tab engine stops
  working. The self-test names what it could not find.
- Automated use of chatgpt.com is not something OpenAI's terms allow; the API
  engine is the supported path.
