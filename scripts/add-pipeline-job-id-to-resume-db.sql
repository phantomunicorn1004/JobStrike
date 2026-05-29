-- Link Resume DB applications to jobs pipeline (Applied stage)
ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS pipeline_job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_pipeline_job_id
  ON resume_db_applications(pipeline_job_id);
