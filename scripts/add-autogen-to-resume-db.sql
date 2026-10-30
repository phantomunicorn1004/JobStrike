-- Resume generation queue on Resume DB rows (AutoGen: ChatGPT tab or OpenAI API).
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- generation_status:
--   none        not part of generation (every existing row, and bids registered by hand)
--   queue       waiting for a resume to be generated
--   generating  claimed by a worker (autogen_claimed_at says when)
--   completed   built_resume_json saved and checked
--   failed      gave up; generation_error says why

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS job_description TEXT NOT NULL DEFAULT '';

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'none';

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS autogen_claimed_at TIMESTAMPTZ;

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS generation_error TEXT NOT NULL DEFAULT '';

-- Which engine made the resume, the model, token counts, attempts and the fixes applied.
ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS generation_meta JSONB;

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS built_resume_json TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'resume_db_applications_generation_status_check'
  ) THEN
    ALTER TABLE resume_db_applications
      ADD CONSTRAINT resume_db_applications_generation_status_check
      CHECK (generation_status IN ('none', 'queue', 'generating', 'completed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_generation_status
  ON resume_db_applications (user_id, generation_status, id);

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_autogen_claimed_at
  ON resume_db_applications (autogen_claimed_at)
  WHERE autogen_claimed_at IS NOT NULL;
