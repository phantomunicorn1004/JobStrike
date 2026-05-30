-- Per-user Resume DB + candidate profiles (scoped to app_users)
-- Run after create-app-users-table.sql and create-resume-db-applications.sql

ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS extension_api_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_extension_api_key_unique
  ON app_users (extension_api_key)
  WHERE extension_api_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_id
  ON resume_db_applications(user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id
  ON profiles(user_id);

-- Assign all existing data to stevenspiethdev@gmail.com
UPDATE resume_db_applications
SET user_id = (
  SELECT id FROM app_users
  WHERE username = 'stevenspiethdev@gmail.com'
  LIMIT 1
)
WHERE user_id IS NULL;

UPDATE profiles
SET user_id = (
  SELECT id FROM app_users
  WHERE username = 'stevenspiethdev@gmail.com'
  LIMIT 1
)
WHERE user_id IS NULL;
