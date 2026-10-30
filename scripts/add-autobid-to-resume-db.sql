-- Auto-bid state on Resume DB rows (the JobStrike extension's Auto-bid runner).
-- Run once in the Supabase SQL editor, after add-autogen-to-resume-db.sql. Safe to run again.
--
-- bid_state:
--   none       not attempted (every existing row; a generated, queued row waits here)
--   bidding    claimed by the runner (bid_claimed_at says when)
--   submitted  the application was sent and the site confirmed it
--   needs_you  stopped before or at Submit; bid_error says what to do (CAPTCHA,
--              a required question, an unsupported site, a dry run, no confirmation)
--   failed     could not be attempted (no form, page did not load); bid_error says why
--
-- The runner never takes a row again once it left none, so nothing is sent twice.

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS bid_state TEXT NOT NULL DEFAULT 'none';

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS bid_claimed_at TIMESTAMPTZ;

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS bid_error TEXT NOT NULL DEFAULT '';

-- How it was sent (auto / dry run), the site, the fields left open, timings.
ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS bid_meta JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'resume_db_applications_bid_state_check'
  ) THEN
    ALTER TABLE resume_db_applications
      ADD CONSTRAINT resume_db_applications_bid_state_check
      CHECK (bid_state IN ('none', 'bidding', 'submitted', 'needs_you', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_bid_state
  ON resume_db_applications (user_id, bid_state, id);
