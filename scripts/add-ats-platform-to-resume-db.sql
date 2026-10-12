-- ATS platform of each registered bid ("Greenhouse", "Workday", …), saved at
-- registration. Rows registered earlier keep NULL here; the website works the
-- platform out from their job link when it shows them.
ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS ats_platform TEXT;

CREATE INDEX IF NOT EXISTS resume_db_applications_user_ats_platform_idx
  ON resume_db_applications (user_id, ats_platform);
