CREATE TABLE IF NOT EXISTS resume_db_blocked_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  job_link TEXT NOT NULL,
  job_link_canonical TEXT NOT NULL,
  job_title TEXT,
  company_name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resume_db_blocked_jobs_user_link_unique
  ON resume_db_blocked_jobs (user_id, job_link_canonical);

CREATE INDEX IF NOT EXISTS resume_db_blocked_jobs_user_idx
  ON resume_db_blocked_jobs (user_id);
