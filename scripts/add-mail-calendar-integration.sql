-- Email and calendar integration (docs/EMAIL_CALENDAR_INTEGRATION.md, section 3).
-- Safe to run more than once; later phases add their tables to this file.
--
-- Every table has row-level security on and no policy: only the server's service-role key can
-- read or write them. Tokens are stored encrypted (lib/crypto/secret-box.ts), never in plain text.

-- One row per connected mailbox + calendar. A user may connect several, one per candidate profile.
CREATE TABLE IF NOT EXISTS public.mail_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  profile_id        bigint REFERENCES public.profiles(id) ON DELETE SET NULL,
  provider          text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  email             text NOT NULL,
  scopes            text[] NOT NULL DEFAULT '{}',
  refresh_token_enc text NOT NULL,
  access_token_enc  text,
  access_expires_at timestamptz,
  mail_cursor       text,          -- Gmail historyId / Graph mail deltaLink
  calendar_cursor   text,          -- Google syncToken / Graph calendarView deltaLink
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reauth_required', 'disabled')),
  automation        text NOT NULL DEFAULT 'auto' CHECK (automation IN ('off', 'suggest', 'auto')),
  last_sync_at      timestamptz,
  last_error        text,
  sync_lock_until   timestamptz,   -- keeps two sync runs off one account
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email)
);

CREATE INDEX IF NOT EXISTS mail_accounts_user_idx ON public.mail_accounts (user_id);

ALTER TABLE public.mail_accounts ENABLE ROW LEVEL SECURITY;

-- Step 2: sync. Progress of the current scan, and Microsoft change notifications ("live updates").
ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_progress            jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_requested_at        timestamptz,   -- new mail arrived while a sync was running
  ADD COLUMN IF NOT EXISTS subscription_id          text,
  ADD COLUMN IF NOT EXISTS subscription_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_secret_hash text;          -- sha256 of the clientState Microsoft echoes back

CREATE INDEX IF NOT EXISTS mail_accounts_subscription_idx ON public.mail_accounts (subscription_id);

-- Job-related messages only, as metadata plus a short excerpt (never whole emails).
CREATE TABLE IF NOT EXISTS public.mail_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  provider_id      text NOT NULL,          -- Gmail message id / Graph id
  thread_id        text,
  received_at      timestamptz NOT NULL,
  from_name        text,
  from_email       text NOT NULL,
  to_email         text,
  subject          text,
  snippet          text,                   -- at most 500 characters
  web_link         text,                   -- opens the message in Gmail / Outlook
  prefilter_reason text,                   -- why the sync kept it (ats sender, company, wording)
  category         text NOT NULL DEFAULT 'unclassified',
  confidence       real,
  summary          text,
  extracted        jsonb NOT NULL DEFAULT '{}'::jsonb,
  application_id   bigint REFERENCES public.resume_db_applications(id) ON DELETE SET NULL,
  match_score      real,
  match_reason     text,
  action           jsonb,
  action_status    text NOT NULL DEFAULT 'none' CHECK (action_status IN ('none', 'suggested', 'applied', 'dismissed')),
  classified_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider_id)
);

CREATE INDEX IF NOT EXISTS mail_messages_user_received_idx ON public.mail_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS mail_messages_application_idx ON public.mail_messages (application_id);
CREATE INDEX IF NOT EXISTS mail_messages_unclassified_idx ON public.mail_messages (created_at) WHERE category = 'unclassified';

ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;

-- Step 3: sorting and matching. Who decided (the AI or the user), and retries of failed sorting.
ALTER TABLE public.mail_messages
  ADD COLUMN IF NOT EXISTS category_source   text NOT NULL DEFAULT 'ai',    -- 'ai' / 'user'
  ADD COLUMN IF NOT EXISTS link_source       text NOT NULL DEFAULT 'auto',  -- 'auto' / 'user'
  ADD COLUMN IF NOT EXISTS classify_attempts smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS mail_messages_user_category_idx ON public.mail_messages (user_id, category, received_at DESC);

-- Senders and domains the user marked as not job-related; the sync skips their mail.
CREATE TABLE IF NOT EXISTS public.mail_rules (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('ignore_sender', 'ignore_domain')),
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, value)
);

ALTER TABLE public.mail_rules ENABLE ROW LEVEL SECURITY;

-- Ask PostgREST to see the new table right away.
NOTIFY pgrst, 'reload schema';
