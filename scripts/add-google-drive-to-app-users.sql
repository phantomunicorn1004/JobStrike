-- Per-user Google Drive OAuth (website) + optional default document links
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS google_email TEXT,
  ADD COLUMN IF NOT EXISTS google_drive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS google_token_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS default_resume_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS default_cover_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS google_oauth_client_id TEXT,
  ADD COLUMN IF NOT EXISTS google_oauth_client_secret TEXT;

-- Track Drive file IDs for delete-on-row-remove
ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS resume_drive_file_id TEXT,
  ADD COLUMN IF NOT EXISTS cover_drive_file_id TEXT;
