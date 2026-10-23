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

-- Ask PostgREST to see the new table right away.
NOTIFY pgrst, 'reload schema';
