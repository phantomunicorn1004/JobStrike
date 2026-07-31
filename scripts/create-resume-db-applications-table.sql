-- Resume DB applications (extension + website; no Google Sheets)
CREATE TABLE IF NOT EXISTS resume_db_applications (
  id BIGSERIAL PRIMARY KEY,
  entry_id TEXT UNIQUE NOT NULL,
  profile_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL,
  candidate_name TEXT NOT NULL DEFAULT '',
  job_link TEXT NOT NULL,
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  apply TEXT DEFAULT 'Registered',
  resume_url TEXT NOT NULL,
  cover_letter_url TEXT DEFAULT '',
  resume_storage_path TEXT,
  cover_letter_storage_path TEXT,
  pipeline_job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_profile_id
  ON resume_db_applications(profile_id);

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_created_at
  ON resume_db_applications(created_at DESC);

ALTER TABLE resume_db_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on resume_db_applications" ON resume_db_applications;
CREATE POLICY "Allow all on resume_db_applications" ON resume_db_applications
  FOR ALL USING (true) WITH CHECK (true);

-- Supabase Storage: create bucket "resume-db" (public) in dashboard, or:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('resume-db', 'resume-db', true);

DROP POLICY IF EXISTS "Public read resume-db bucket" ON storage.objects;
CREATE POLICY "Public read resume-db bucket" ON storage.objects
  FOR SELECT USING (bucket_id = 'resume-db');

DROP POLICY IF EXISTS "Allow upload resume-db bucket" ON storage.objects;
CREATE POLICY "Allow upload resume-db bucket" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'resume-db');

DROP POLICY IF EXISTS "Allow delete resume-db bucket" ON storage.objects;
CREATE POLICY "Allow delete resume-db bucket" ON storage.objects
  FOR DELETE USING (bucket_id = 'resume-db');
