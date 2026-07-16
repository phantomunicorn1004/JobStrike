ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

UPDATE app_users
SET timezone = 'America/New_York'
WHERE timezone IS NULL OR timezone = '';
