-- Extra free-text note for Resume DB applications (extension Register + website).
ALTER TABLE resume_db_applications
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
