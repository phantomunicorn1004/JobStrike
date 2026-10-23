# Email and calendar integration: design and implementation plan

JobStrike reads the candidate mailboxes (Gmail or Outlook / Microsoft 365) and calendars. It finds
recruiter emails and interview invites, links them to Resume DB applications, moves the pipeline
cards, records interview dates and times, and shows upcoming interviews. That includes in
Interview Assistant.

The plan builds on the existing code: `googleapis`, the OpenAI SDK, the company and job-link
matching in `lib/company-name.ts` / `lib/job-url.ts`, and `setApplicationPipelineStage` in
`lib/resume-db/pipeline-stages.ts`.

---

## 0. Findings that shape the plan

| # | Finding | Where | Consequence |
|---|---|---|---|
| F1 | Requests with no session and no key are treated as the default owner whenever `EXTENSION_API_KEY` is unset | `lib/auth/resolve-request-user.ts:58-60` | Anyone could read that user's data. With mail access this would expose mailboxes. **Fix first.** |
| F2 | Row-level security is on, but every table except `app_users` has `USING (true) WITH CHECK (true)` | `scripts/fresh-install-jobstrike.sql:79-302` | The anon key ships in the browser bundle, so anyone can read and write profiles (SSN, DOB, address), applications and cards. `getSupabaseAdminClient` even falls back to the anon key. |
| F3 | Several API routes have no auth check | `ats-check`, `jd-parse`, `resume-tailor*`, `generate-resume`, `resume-parse*`, `resume-download`, `upload-download` | Anyone can spend the server's OpenAI key. |
| F4 | Refresh tokens, OAuth client secrets and SSNs are stored as plain text, and there is no encryption helper | `app_users.google_*`, `profiles.ssn` | Mail tokens grant access to whole mailboxes, so they must be encrypted. |
| F5 | The OAuth `state` is HMAC-signed only: no expiry, no nonce check, no cookie binding, and the callback does not compare it with the session | `lib/auth/google-oauth-state.ts`, `google-drive/callback` | Login-CSRF and replay are possible. Mail connect needs a stricter flow. |
| F6 | No cron, queue or webhook exists, and there is no `vercel.json` | — | Sync needs a scheduler (section 4.1). |
| F7 | Google OAuth apps in **Testing** status with external users get refresh tokens that **expire after 7 days** | Google policy | This is very likely the "expired Google Drive sign-in" problem. Gmail would expire weekly too (section 2.1). |
| F8 | `pipeline_stages` is global (no `user_id`). Interview round dates are `DATE` only, and only the legacy table writes them. `stage_dates` records when a card entered a column, not interview times | SQL, `technical-job-table.tsx` | Interview times need their own table (`interviews`). |
| F9 | No email address is stored on an application; the profile's `work_emails` / `autofill.applicationEmail` implies it | `lib/resume-db/profile-autofill.ts:120` | Each mailbox is linked to a profile, and the address that received the mail identifies the candidate. |
| F10 | "Responses" on the dashboard are inferred from `stage_dates`; there is no event log | `lib/dashboard/stage-stats.ts` | Add `pipeline_events`; emails then give real response data. |

---

## 1. Phase 0: security prerequisites (must ship before any mail access)

1. **Close the default-owner fallback (F1).**
   - `resolveRequestUser` returns `null` when no session and no valid key are present.
   - Keep the old behaviour only behind an explicit `ALLOW_ANONYMOUS_DEFAULT_OWNER=true` for local development.
   - Set `AUTH_SECRET` and `EXTENSION_API_KEY` in Vercel.
   - The extension already sends `X-Extension-Key`, so it keeps working.
2. **Require auth on every route (F3).**
   - Add `requireRequestUser` to the AI and file routes.
   - Add a simple per-user rate limit on the AI routes, e.g. a counter in a table, N calls per minute.
3. **Lock the database (F2).**
   - Change every policy to `USING (false)` for `anon`.
   - Make `getSupabaseAdminClient` service-role only (remove the anon fallback).
   - Move the three components that query the database from the browser to API routes: `job-table.tsx`, `JobsPipelineBoard.tsx` (pipeline_stages) and `technical-job-table.tsx`.
   - Make the `resume-db` storage bucket private and serve files through `/api/resume-db/download` or signed URLs.
4. **Add an encryption helper (F4).**
   - Create `lib/crypto/secret-box.ts`: AES-256-GCM with the key from `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64).
   - Format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`, so the key can be rotated later (`v2`).
   - Encrypt the new mail tokens, migrate `google_refresh_token` and `google_oauth_client_secret`, and ideally `profiles.ssn`.
5. **Harden the OAuth state (F5).** Create `lib/integrations/oauth-state.ts`:
   - Random state stored in an httpOnly, SameSite=Lax cookie, valid for 10 minutes and usable once.
   - The callback requires a session, a matching cookie and `session.id === state.userId`.
   - Use PKCE (`code_challenge`) for both providers.

Estimate: 1.5–2 days.

---

## 2. Providers

### 2.1 Google (Gmail and Google Calendar)
- **Library:** the existing `googleapis` (`google.gmail('v1')`, `google.calendar('v3')`).
- **Scopes:** `openid email`, `gmail.readonly` (*restricted*), `calendar.events` (*sensitive*; read and create events). Use `calendar.readonly` if JobStrike should never write to the calendar.
- **Auth request:** `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, and `login_hint=<profile work email>`, so the right account is chosen for each candidate.
- **The 7-day problem (F7).** The options:
  - **(a) Publish the app** to "In production". Restricted Gmail scopes then need Google verification plus a yearly CASA security assessment, which costs money and takes weeks. Needed only if strangers use JobStrike.
  - **(b) Google Workspace accounts:** set the app's user type to *Internal*. No verification is needed and tokens do not expire weekly.
  - **(c) Stay in Testing:** accept a weekly reconnect. JobStrike shows a "Reconnect" banner, and the sync stops cleanly on `invalid_grant`.
  - **(d) Fallback for personal Gmail:** IMAP with an app password (needs 2-step verification on the account). No OAuth review, and it never expires, but it is mail only (no calendar) and less safe to hold.

  **Recommendation:** use (b) where the mailboxes are Workspace; otherwise (c), plus Outlook where possible.

### 2.2 Microsoft (Outlook.com and Microsoft 365)
- **Registration:** an Entra ID app for "accounts in any organizational directory and personal Microsoft accounts".
- **Scopes:** `offline_access openid email User.Read Mail.Read Calendars.ReadWrite`.
- **No review:** no verification or assessment is needed.
- **Token lifetime:** refresh tokens last 90 days and renew whenever they are used.
- **Library:** plain `fetch` to `https://login.microsoftonline.com/common/oauth2/v2.0/{authorize,token}` and Graph `https://graph.microsoft.com/v1.0`. No SDK is needed.
- **Throttling:** Graph returns `429` with `Retry-After`, which the client must honour.

---

## 3. Data model (`scripts/add-mail-calendar-integration.sql`)

Every new table gets `ENABLE ROW LEVEL SECURITY` with **no anon policy**. Only the service role can access them.

```sql
-- One row per connected mailbox / calendar (a user may connect several, one per candidate profile)
CREATE TABLE mail_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  profile_id       bigint REFERENCES profiles(id) ON DELETE SET NULL,   -- which candidate this mailbox belongs to
  provider         text NOT NULL CHECK (provider IN ('google','microsoft')),
  email            text NOT NULL,
  scopes           text[] NOT NULL DEFAULT '{}',
  refresh_token_enc text NOT NULL,                                       -- secret-box
  access_token_enc  text,
  access_expires_at timestamptz,
  mail_cursor      text,          -- Gmail historyId / Graph mail deltaLink
  calendar_cursor  text,          -- Google syncToken / Graph calendarView deltaLink
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reauth_required','disabled')),
  automation       text NOT NULL DEFAULT 'suggest' CHECK (automation IN ('off','suggest','auto')),
  last_sync_at     timestamptz,
  last_error       text,
  sync_lock_until  timestamptz,   -- prevents two sync runs on one account
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email)
);

-- Only job-related messages are kept, and only metadata plus a short snippet (never full bodies)
CREATE TABLE mail_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  provider_id      text NOT NULL,          -- Gmail message id / Graph id
  thread_id        text,
  received_at      timestamptz NOT NULL,
  from_name        text, from_email text NOT NULL,
  to_email         text,
  subject          text,
  snippet          text,                   -- at most 500 chars
  web_link         text,                   -- opens the mail in Gmail/Outlook
  category         text NOT NULL,          -- see 5.2
  confidence       real,
  extracted        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- company, title, interview time, link, round…
  application_id   bigint REFERENCES resume_db_applications(id) ON DELETE SET NULL,
  match_score      real,
  match_reason     text,
  action           jsonb,                  -- the proposed change, e.g. {"stage":"technical","interview":{…}}
  action_status    text NOT NULL DEFAULT 'none' CHECK (action_status IN ('none','suggested','applied','dismissed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider_id)
);
CREATE INDEX ON mail_messages (user_id, received_at DESC);
CREATE INDEX ON mail_messages (application_id);

-- Interviews with real date and time (the round columns on technical_jobs are DATE only)
CREATE TABLE interviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  application_id   bigint REFERENCES resume_db_applications(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz,
  round            smallint,
  kind             text,                   -- hr / technical / final / other
  title            text,
  meeting_url      text,
  location         text,
  interviewers     text,
  source           text NOT NULL CHECK (source IN ('email','calendar','manual')),
  source_ref       text,                   -- mail_messages.id or calendar event id
  calendar_event_id text,                  -- event JobStrike created or matched
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled')),
  result           text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON interviews (user_id, starts_at);

-- Real history of the pipeline (also feeds the dashboard's response statistics)
CREATE TABLE pipeline_events (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  application_id   bigint NOT NULL REFERENCES resume_db_applications(id) ON DELETE CASCADE,
  type             text NOT NULL,          -- stage_changed / email_received / interview_scheduled / rejected / offer
  from_stage       text, to_stage text,
  source           text NOT NULL,          -- manual / email / calendar / extension
  ref_id           text,
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pipeline_events (user_id, at DESC);
```

---

## 4. Sync engine

### 4.1 Scheduling (F6)
- **Endpoint:** `GET /api/cron/mail-sync` with header `Authorization: Bearer ${CRON_SECRET}` and `export const maxDuration = 60`.
- **What triggers it:**
  - **Vercel Cron**, in `vercel.json`: `{ "crons": [{ "path": "/api/cron/mail-sync", "schedule": "*/10 * * * *" }] }`. This needs the **Pro** plan; Hobby only runs crons once a day.
  - **Otherwise Supabase** `pg_cron` plus `pg_net`, calling the endpoint every 10 minutes (free).
  - **Also:** a **Sync now** button (`POST /api/integrations/mail/sync`), and a sync when the Inbox page opens and the last sync is more than 5 minutes old.
- **Each run:**
  - Take up to N accounts with `status='active'`, oldest `last_sync_at` first.
  - Lock each one (`sync_lock_until = now()+2min`, conditional update), process it, then release the lock.
  - Stay inside the time budget. Anything left continues on the next run.

### 4.2 Incremental fetch
- **Gmail, first sync:**
  - Run `messages.list` with `q="newer_than:45d -category:promotions -category:social"`, at most 300 messages.
  - Store `historyId` from `users.getProfile`.
- **Gmail, after that:**
  - Run `history.list(startHistoryId, historyTypes=['messageAdded'])`.
  - On `404` (the history window has expired), do a limited full sync again.
- **Gmail, per message:** fetch `messages.get(format='metadata', metadataHeaders=[From,To,Subject,Date,List-Unsubscribe])` plus the snippet.
  - The full body (`format='full'`, text/plain part) is fetched **only** for messages that pass the prefilter, and only in memory.
- **Outlook mail:** use `/me/mailFolders/inbox/messages/delta?$select=id,conversationId,from,toRecipients,subject,receivedDateTime,bodyPreview,webLink,internetMessageHeaders` and store the `@odata.deltaLink`.
- **Calendar:**
  - Google: `events.list(singleEvents=true, timeMin=now-1d, timeMax=now+60d, syncToken)`.
  - Outlook: `/me/calendarView/delta?startDateTime&endDateTime`.
- **Tokens:**
  - Keep the access token, encrypted, with its expiry, and refresh it 2 minutes before it expires.
  - On `invalid_grant` or an `AADSTS` error: set `status='reauth_required'`, stop that account, and show a banner.

### 4.3 Cheap prefilter (no AI): `lib/mail/prefilter.ts`
A message is a **candidate** when any of these holds:
- **ATS sender:** the sender domain is an ATS domain (reuse `PLATFORM_DOMAINS` from `lib/ats-platform.ts`, plus `greenhouse-mail.io`, `hire.lever.co`, `ashbyhq.com`, `myworkday.com`, `smartrecruiters.com`, `icims.com`, `workablemail.com`, `jobvite.com`, `bamboohr.com`, `breezy.hr`, `recruitee.com`, `calendly.com`, `goodtime.io`, `zoom.us`, `teams.microsoft.com`).
- **Known company:** the sender domain or display name matches the company of an application from the last 120 days (`companyMatchLevel` is `definite` or `possible`).
- **Keywords:** the subject or snippet contains interview, schedule, availability, next steps, assessment, coding challenge, offer, unfortunately, regret, not moving forward, application received, thank you for applying, candidacy, or a calendar invite (`text/calendar` / `invite.ics`).

Messages are **dropped** when they are job-alert digests (LinkedIn, Indeed or ZipRecruiter alerts, `List-Unsubscribe` with no keyword), newsletters, or mail sent by the user.

This keeps AI calls to a few per day.

---

## 5. Understanding and matching

### 5.1 Matching candidates: `lib/mail/match.ts`
For each candidate message, score the user's applications from the last 180 days, limited to the mailbox's profile when it is linked:

| Signal | Points |
|---|---|
| Company in the sender domain or display name, subject or snippet (`companyMatchLevel`: definite / possible) | 0.45 / 0.25 |
| Sender domain equals the domain of `job_link`, or the same ATS platform as `ats_platform` | 0.20 |
| Job title similarity (token overlap ≥ 0.6) | 0.15 |
| `to_email` is one of the profile's `work_emails` / `applicationEmail` | 0.10 |
| Applied within the last 60 days | 0.05 |
| Same thread as an email already linked to the application | → 0.95 |

The top 5 applications, with ids, company, title, applied date and current stage, go into the AI prompt. The model chooses one id or `null`, and that choice decides.

### 5.2 AI classification: `lib/mail/classify.ts`
- **Model call:** OpenAI SDK as elsewhere (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_PROXY`), `gpt-4o-mini`, `response_format: json_schema`, validated with **zod** (already installed).
- **Output schema:**
  ```ts
  {
    category: 'interview_invite' | 'scheduling' | 'reschedule_or_cancel' | 'assessment' | 'rejection'
            | 'offer' | 'application_received' | 'recruiter_outreach' | 'other',
    confidence: number,                 // 0..1
    application_id: number | null,      // one of the candidates given, or null
    company: string | null, job_title: string | null,
    interview: { start: string | null,  // ISO 8601 with offset; null if no fixed time yet
                 end: string | null, timezone: string | null, round_hint: 'hr'|'technical'|'final'|null,
                 meeting_url: string | null, interviewers: string | null } | null,
    summary: string                     // ≤ 160 chars, shown in the Inbox
  }
  ```
- **Context given to the model:** the user's timezone (`app_users.timezone`) and the email's `Date`, so "Tuesday at 2pm ET" becomes an exact time.
- **Prompt-injection safety:** email text is **data**.
  - The model only returns this JSON.
  - The server validates every field: the application id must be one of those offered, and dates must fall within ±1 year.
  - The server only performs the fixed actions in 6.1. It never follows instructions written in an email.
- **Limits:**
  - Body truncated to 6,000 chars; quoted replies and signatures stripped.
  - 20 s timeout and one retry.
  - Daily per-user cap (e.g. 300 classifications).

### 5.3 Calendar events
- **Rules first:**
  - The event title or description contains a company or job title from the candidate applications.
  - An attendee domain matches.
  - The event was created by a scheduling tool.
- **AI fallback:** only when the rules are ambiguous.
- **Result:** create or update an `interviews` row (`source='calendar'`).
- **Duplicates:** an email interview and a calendar event within ±30 minutes of each other for the same application are merged into one interview.

---

## 6. Actions on the pipeline

### 6.1 Allowed actions (whitelist): `lib/mail/actions.ts`
| Category | Action |
|---|---|
| interview_invite / scheduling | Move to the first interview stage after Screening, unless the card is already further on. Create an `interviews` row when there is a time. |
| assessment | Move to *Technical* (or the first interview stage). |
| reschedule_or_cancel | Update or cancel the matching `interviews` row. |
| rejection | Move to the reject stage (name matches `REJECTION_STAGE_RE`, as in `stage-stats.ts`). |
| offer | Move to *Final*, plus a `pipeline_events` row of type `offer`. |
| application_received / recruiter_outreach / other | No stage change; just linked. |

- **Moving:** stages move only through the existing `setApplicationPipelineStage(applicationId, userId, stageId)`. Cards **never move backwards** automatically, except into rejection.
- **Round dates:** also write the date to `technical_jobs.first|second|third_round_date`, so the old table keeps showing it. The card is found through the `Resume DB #<id>` marker; make `getPipelineCardForApplication` public.
- **History:** every applied action adds a row to `pipeline_events`.

### 6.2 Automation modes (per mailbox)
- **off:** emails are only listed.
- **suggest** (default): the action is stored as `action_status='suggested'`. The Inbox shows **Apply / Change application / Dismiss**.
- **auto:** applied straight away when `confidence ≥ 0.85` **and** `match_score ≥ 0.7`; everything else is suggested. An **Undo** within 7 days restores `from_stage` from `pipeline_events`.

### 6.3 Writing to the calendar (optional)
- **Add to calendar:** for an interview found in email that is not on the calendar yet.
- **The event holds:** company, title and round in the title; the job link, the resume link from `resume_url` and the meeting URL in the description; a 30-minute reminder.
- **Duplicates:** the event carries a private id, Google `extendedProperties.private.jobstrikeInterviewId` or Graph `singleValueExtendedProperties`, so it is never created twice.

---

## 7. API routes

| Route | Purpose |
|---|---|
| `GET /api/integrations/mail/[provider]/connect?profileId=` | Starts OAuth (PKCE, state cookie, `login_hint` from the profile's email) |
| `GET /api/integrations/mail/[provider]/callback` | Exchanges the code, stores encrypted tokens, runs the first sync in the background (`after()` in Next 16) |
| `GET /api/integrations/mail/accounts` | Lists mailboxes: email, profile, status, last sync, automation |
| `PATCH /api/integrations/mail/accounts/[id]` | Changes profile link or automation mode |
| `DELETE /api/integrations/mail/accounts/[id]` | Revokes the token (Google `https://oauth2.googleapis.com/revoke`; for Microsoft, delete only) and deletes the account and its stored messages |
| `POST /api/integrations/mail/sync` | Sync now (user) |
| `GET /api/cron/mail-sync` | Scheduled sync (`CRON_SECRET`) |
| `GET /api/inbox?category=&status=&cursor=` | Job-related emails with their linked application and suggested action |
| `POST /api/inbox/[id]/apply`, `/dismiss`, `PATCH /api/inbox/[id]` (change application) | Act on a suggestion |
| `GET /api/interviews?from=&to=` · `POST` · `PATCH /api/interviews/[id]` | Calendar data; manual interviews |
| `POST /api/interviews/[id]/calendar` | Add the interview to the connected calendar |

All of them use `requireRequestUser` and always filter by `user_id`.

---

## 8. User interface

- **Settings → "Email & Calendar"** (`components/settings/MailCalendarSettingsCard.tsx`):
  - **Connect Google / Connect Microsoft**, done per profile (each candidate has its own mailbox).
  - Status chip (Active, Reconnect needed, Syncing…), last sync time, automation mode, Disconnect.
  - Clear text on what is read and stored.
- **Inbox** (`app/(member)/inbox/page.tsx`, added to `NAV_ITEMS` and `MEMBER_ROUTE_PREFIXES`):
  - A list of job emails with a category badge, the linked application (company, title, candidate) and the AI summary.
  - Suggested action buttons and **Open in Gmail/Outlook** (`web_link`).
  - Filters: Needs review, Interviews, Rejections, All.
- **Calendar / Interviews** (`app/(member)/calendar/page.tsx`):
  - An agenda of upcoming interviews (today, this week), using `react-day-picker`, which is already installed, for the month view.
  - Each entry shows time in the user's timezone, company, round, meeting link, and **Prepare** (opens the application).
- **Board cards:** a "Next interview" chip and the latest email, read from `interviews` / `mail_messages`.
- **Dashboard:** response statistics from `pipeline_events` (real first-response times, interview and rejection rates).
- **Interview Assistant:**
  - Call `GET /api/interviews?upcoming=1` and show "Next interview: Aflac · Technical · in 2 h". **Load** fills the call prompt from that application.
  - Uses the existing JobStrike client (`JobStrikeClient.cs`).

---

## 9. Code layout

```
lib/crypto/secret-box.ts                 AES-256-GCM encrypt/decrypt (TOKEN_ENCRYPTION_KEY)
lib/integrations/oauth-state.ts          cookie-bound, expiring, single-use state + PKCE
lib/integrations/accounts-repository.ts  mail_accounts CRUD, token get/refresh with lock
lib/integrations/google/{oauth,gmail,calendar}.ts
lib/integrations/microsoft/{oauth,mail,calendar}.ts
lib/mail/{prefilter,match,classify,actions,sync}.ts
lib/interviews/repository.ts
lib/pipeline-events/repository.ts
app/api/integrations/mail/...            (section 7)
app/api/inbox/..., app/api/interviews/..., app/api/cron/mail-sync/route.ts
components/settings/MailCalendarSettingsCard.tsx, components/inbox/*, components/calendar/*
app/(member)/inbox/page.tsx, app/(member)/calendar/page.tsx
scripts/add-mail-calendar-integration.sql
vercel.json                              (cron, if on Pro)
```

New environment variables:
- `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`
- The existing `GOOGLE_OAUTH_*` gets the new scopes and redirect URI.
- `AUTH_SECRET` and `EXTENSION_API_KEY` must be set.

---

## 10. Privacy and operations

- **Data minimization:**
  - Only job-related messages are stored, as metadata plus a 500-character snippet.
  - Bodies are processed in memory and never stored or logged.
  - Snippets are deleted after 180 days, and everything is deleted on Disconnect.
- **Logs:** never contain tokens, bodies or full addresses; use `account_id` and message ids instead.
- **Google Limited Use policy:** mail data is used only for this feature, never for anything else and never shared. State this in the Settings card and the privacy text.
- **Rate limits:**
  - Gmail: 250 quota units per user per second. `messages.get` costs 5 units, so batch in parallel 10 at a time.
  - Graph: honour `Retry-After`.
- **Failures:**
  - One failing account never blocks the others.
  - `last_error` is shown in Settings.
  - **Dry-run mode** (`MAIL_SYNC_DRY_RUN=1`): classifies and logs suggestions but changes nothing. Used for the first week.

---

## 11. Testing

- **Unit tests:** fixtures of 40–60 real-looking emails per category (anonymised): interview invites from Greenhouse, Lever and Ashby; Calendly confirmations; rejections; offers; job-alert digests that must be dropped. Run them through `prefilter` → `match` → `classify` (with a recorded model response).
- **Timezones:** "Tuesday 2pm ET" received on a Monday by a user in Asia/Ho_Chi_Minh gives the correct UTC `starts_at`.
- **Integration:** a dedicated test Gmail account and a test Outlook.com account, end to end in dry-run, then in `suggest` mode.
- **Security:**
  - Calls without a session or key get 401.
  - The anon key can no longer read `profiles`.
  - OAuth callback with someone else's state gets 403.
  - Disconnect revokes the token.

---

## 12. Delivery order and estimate

| Phase | Content | Estimate |
|---|---|---|
| 0 | Security prerequisites (section 1) | 1.5–2 days |
| 1 | Microsoft and Google connect, encrypted accounts, Settings card | 2 days |
| 2 | Sync engine + prefilter + cron | 2–3 days |
| 3 | Matching + AI classification + Inbox page (suggest mode) | 3 days |
| 4 | Actions on the pipeline, `interviews`, `pipeline_events`, undo, auto mode | 2 days |
| 5 | Calendar read + "Add to calendar" + Calendar page | 2–3 days |
| 6 | Board chips, dashboard from events, Interview Assistant "Next interview" | 1–2 days |

About 2.5–3 weeks in total. Each phase ships on its own, and the first useful version (Phases 0–3) shows job emails linked to applications, with suggested actions.

---

## 13. Decisions (agreed)

1. **Mailboxes:** any number, Google and Microsoft both, each linked to a candidate profile.
   Gmail needs Google verification (section 2.1, option a) because other users will use JobStrike;
   until then Google mailboxes reconnect weekly, and Microsoft mailboxes are unaffected.
2. **Automation:** `auto` is the default for new mailboxes (confident results are applied, the rest
   suggested), with Undo and manual Apply / Change / Dismiss in the Inbox.
3. **Calendar:** read and write (`calendar.events`, `Calendars.ReadWrite`).
4. **Hosting:** Vercel Hobby, so scheduling uses Supabase `pg_cron` + `pg_net` every 10 minutes
   (section 4.1), plus Sync now and sync-on-open.
5. **Other users:** yes. Phase 0 is mandatory, and a privacy policy plus Google verification
   are needed before Gmail is offered to them.

## 14. Status

- **Phase 0 done and deployed** (`146af51`):
  - Default-owner fallback removed: only possible with `ALLOW_ANONYMOUS_DEFAULT_OWNER=true` in development.
  - Sign-in required on the AI and file routes.
  - Browser database access replaced by `/api/pipeline/stages` and `/api/jobs/legacy`.
  - `scripts/lock-down-row-level-security.sql` run; the public key reads nothing.
  - `lib/crypto/secret-box.ts` added; the Drive token and client secret are now encrypted.
  - Google OAuth state now expires, is bound to a cookie and to the signed-in user, and is single-use.
- **Phase 1 done** (connect mailboxes):
  - `scripts/add-mail-calendar-integration.sql`: `mail_accounts` (re-runnable; later phases add to it).
    New mailboxes default to `automation = 'auto'` (section 13).
  - `lib/integrations/oauth-state.ts`: one signed httpOnly cookie per flow (state, PKCE verifier,
    user, provider, profile), 10 minutes, cleared on use.
  - `lib/integrations/{google,microsoft}/oauth.ts`: PKCE, `login_hint` from the profile, the
    account's address from the ID token (Google) or Graph `/me` (Microsoft), and a refusal when
    mail reading was unticked. Google uses the same OAuth client as Drive but never asks for Drive
    (no `include_granted_scopes`).
  - Routes: `/api/integrations/mail/[provider]/{connect,callback}`,
    `/api/integrations/mail/accounts` (GET) and `/accounts/[id]` (PATCH, DELETE).
  - Disconnect revokes the Google grant, except when Drive is connected to the same Google
    account (Google would end Drive too). Microsoft has no single-app revoke, so it only deletes.
  - Settings → **Email & Calendar** card.
- **Setup per environment:**
  - Run `scripts/add-mail-calendar-integration.sql`.
  - Google: enable the Gmail API and Google Calendar API, add the `gmail.readonly` and
    `calendar.events` scopes to the consent screen, add test users while in Testing, and add the
    redirect URI `<app>/api/integrations/mail/google/callback`.
  - Microsoft: an Entra app registration (any organizational directory and personal accounts), web
    redirect URI `<app>/api/integrations/mail/microsoft/callback`, delegated permissions
    `offline_access openid email profile User.Read Mail.Read Calendars.ReadWrite`, a client secret;
    env `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (optional `MICROSOFT_TENANT`).
- **Next: Phase 2**, the sync engine.
