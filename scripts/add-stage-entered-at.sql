-- Track when a pipeline card entered its current stage
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE technical_jobs
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ DEFAULT NOW();

UPDATE jobs SET stage_entered_at = COALESCE(stage_entered_at, created_at);
UPDATE technical_jobs SET stage_entered_at = COALESCE(stage_entered_at, created_at);
