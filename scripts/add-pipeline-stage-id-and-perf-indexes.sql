-- Denormalize Resume DB ↔ pipeline stage + indexes for list/dashboard performance.
-- Run in Supabase SQL editor (or psql) once per environment.

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS pipeline_stage_id TEXT;

COMMENT ON COLUMN resume_db_applications.pipeline_stage_id IS
  'Cached pipeline stage id (e.g. applied, technical, final). NULL = Registered (not in pipeline).';

-- Backfill "applied" from existing pipeline_job_id links.
UPDATE resume_db_applications
SET pipeline_stage_id = 'applied'
WHERE pipeline_job_id IS NOT NULL
  AND (pipeline_stage_id IS NULL OR pipeline_stage_id = '');

-- Backfill technical/final stages from marker text in technical_jobs.
-- Apps linked only via "Resume DB #<id>" in job_description (no pipeline_job_id).
UPDATE resume_db_applications AS a
SET pipeline_stage_id = COALESCE(NULLIF(t.stage_id, ''), 'technical')
FROM technical_jobs AS t
WHERE a.user_id = t.user_id
  AND a.pipeline_job_id IS NULL
  AND (a.pipeline_stage_id IS NULL OR a.pipeline_stage_id = '')
  AND t.job_description ILIKE '%Resume DB #' || a.id::text || '%';

-- Default Resume DB list sort
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_id_id_desc
  ON resume_db_applications (user_id, id DESC);

-- Date filters use applied_at
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_applied_at
  ON resume_db_applications (user_id, applied_at DESC);

-- Status filters by denormalized stage
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_pipeline_stage
  ON resume_db_applications (user_id, pipeline_stage_id);

-- Pipeline board / dashboard user-scoped listing
CREATE INDEX IF NOT EXISTS idx_jobs_user_id_id_desc
  ON jobs (user_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_technical_jobs_user_id_id_desc
  ON technical_jobs (user_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_technical_jobs_user_stage
  ON technical_jobs (user_id, stage_id);
