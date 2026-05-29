-- Per-stage registration dates and recruiter fields for pipeline cards
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS stage_dates JSONB DEFAULT '{}'::jsonb;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS recruiter_name TEXT;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS recruiter_contact TEXT;

ALTER TABLE technical_jobs
  ADD COLUMN IF NOT EXISTS stage_dates JSONB DEFAULT '{}'::jsonb;

-- Backfill from stage_entered_at / created_at when present
UPDATE jobs
SET stage_dates = jsonb_build_object('applied', COALESCE(stage_entered_at, created_at)::text)
WHERE stage_dates IS NULL OR stage_dates = '{}'::jsonb;

UPDATE technical_jobs
SET stage_dates = jsonb_build_object(
  COALESCE(stage_id, 'technical'),
  COALESCE(stage_entered_at, created_at)::text
)
WHERE stage_dates IS NULL OR stage_dates = '{}'::jsonb;
