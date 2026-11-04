# Auto-bid restructure plan

The website is the brain, the extensions are hands. Every decision (which job, in
what order, how many, whether it fits, what to answer) is made on the server; the
JobStrike panel and AutoGen only find jobs, write resumes and fill forms, and ask
the server what to do next.

```
found → skipped | queued → generating → ready → applying → sent | needs_you | expired
```

## Rules

| Rule | Value |
|---|---|
| Order | Newest posting first, at AutoGen and at the runner. An in-flight job is never interrupted. |
| Freshness | A job must be sent within 24 h of posting (of being found, when the source gives only a date); past it, it expires with a reason. |
| Queue cap | `room = dailyLimit − sent today − ready − generating`, enforced when queueing. |
| Daily limit | 25 sent, set on the website; enforced by the server. |
| Scraping | HiringCafe every 15 min, posted within 3 h; Jobright every 3 h, 1 day. All day (hours empty). |
| Pace | 2–5 min random gap between applications. |
| Ashby | Not queued automatically (reCAPTCHA drops automated Submits); "Queue anyway" by hand. |
| AI | Server-side, with `OPENAI_API_KEY` on Vercel: job fit check before queueing, form answers while applying. |
| Panels | Any number; jobs are claimed atomically, so none is applied twice. |

## Phase 0 — baseline (user)
One VPS Chrome with the panel, AutoGen and json2docx; Donald's profile answers
filled; Dry run → Test run. `OPENAI_API_KEY` set on Vercel.
Done when one Greenhouse and one Lever job are sent with AI on.

## Phase 1 — the server decides what is queued
1. Migration: `autobid_candidates`, `autobid_workers`, `resume_db_applications.posted_at`, purge job.
2. Rule check `lib/autobid/screen.ts` (site, country, title words, JD phrases).
3. AI fit check `lib/autobid/fit.ts` (port of the extension's compatibility check).
4. `POST /api/autobid/found`: lite batch → rule check → JD for the passing ones → fit → cap → queue.
5. Newest first, 24 h freshness and the daily limit in both `next` queries; `expired` stage.
6. One worker row per panel / AutoGen; the one-panel block removed.
7. Setup defaults (15 min, hours empty, Ashby off, freshness 3 h, random gap).
8. Extension posts found jobs instead of queueing them itself.
9. "Found today" list on the Auto-bid page.

Done when a Live check shows every job as found / skipped (reason) / queued, the
queue never exceeds the cap, and the newest job goes next.

## Phase 2 — the apply worker
1. Per-field report on every attempt (`bid_meta.fields`), shown on the website.
2. `POST /api/autobid/[id]/answers`: basic fields from the profile, the rest by AI, with confidence.
3. The extension's Autofill uses it.
4. Low-confidence required answer → Needs you.
5. Profile readiness check at Start.
6. Fixes: Greenhouse country dropdown, `embed/job_app` links, "years of X", yes/no defaults.
7. Runner extracted to `apply-worker.js`; polls every 15 s.
8. Ten dry runs in a row fill every required field.

## Phase 3 — one control surface
1. Pipeline board on the Auto-bid page (age, reason, one action per job).
2. Machine cards, one per worker.
3. The panel's Auto-bid tab shows worker status only (no setup, no Start).
4. AI key removed from the extension; Live switches locked while running.
5. Verified on a fresh VPS Chrome.

## Phase 4 — hardening
1. AutoGen reloads ChatGPT when the prompt box is missing; failed generations retried once.
2. Tests for order, cap, expiry, screening, readiness, answers, field classifier.
3. `docs/AUTOBID.md`: how the chain works.
