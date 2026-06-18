-- Per-user Job Pipeline (jobs + technical_jobs scoped to app_users)
-- Run after create-app-users-table.sql, create-jobs-table.sql, create-technical-jobs-table.sql

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;

ALTER TABLE technical_jobs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_technical_jobs_user_id ON technical_jobs(user_id);

-- Assign existing pipeline rows to stevenspiethdev@gmail.com (same as Resume DB migration)
UPDATE jobs
SET user_id = (
  SELECT id FROM app_users
  WHERE username = 'stevenspiethdev@gmail.com'
  LIMIT 1
)
WHERE user_id IS NULL;

UPDATE technical_jobs
SET user_id = (
  SELECT id FROM app_users
  WHERE username = 'stevenspiethdev@gmail.com'
  LIMIT 1
)
WHERE user_id IS NULL;
