-- JobStrike — fresh Supabase install (single run)
-- Paste into Supabase → SQL Editor → Run
-- Idempotent: safe to re-run. No sample rows. No legacy user backfills.
--
-- After this succeeds:
-- 1. Dashboard → Storage → confirm bucket "resume-db" exists (created below)
-- 2. Retry Sign up on your Vercel site

-- ---------------------------------------------------------------------------
-- 1) Auth users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  extension_api_key TEXT,
  google_refresh_token TEXT,
  google_email TEXT,
  google_drive_folder_id TEXT,
  google_token_updated_at TIMESTAMPTZ,
  default_resume_url TEXT DEFAULT '',
  default_cover_url TEXT DEFAULT '',
  google_oauth_client_id TEXT,
  google_oauth_client_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_users_username_unique UNIQUE (username)
);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS extension_api_key TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_email TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_drive_folder_id TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_token_updated_at TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS default_resume_url TEXT DEFAULT '';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS default_cover_url TEXT DEFAULT '';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_oauth_client_id TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_oauth_client_secret TEXT;

CREATE INDEX IF NOT EXISTS app_users_username_idx ON app_users (username);
CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users (role);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_extension_api_key_unique
  ON app_users (extension_api_key)
  WHERE extension_api_key IS NOT NULL;

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No anon access to app_users" ON app_users;
CREATE POLICY "No anon access to app_users" ON app_users
  FOR ALL USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 2) Candidate profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  dob TEXT NOT NULL,
  work_emails TEXT[] NOT NULL DEFAULT '{}',
  phone_numbers TEXT[] NOT NULL DEFAULT '{}',
  ssn TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  university TEXT NOT NULL,
  linkedin TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on profiles" ON profiles;
CREATE POLICY "Allow all operations on profiles" ON profiles
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3) Job pipeline — applied stage cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  job_link TEXT NOT NULL,
  resume_link TEXT NOT NULL,
  note TEXT DEFAULT '',
  recruiter_name TEXT,
  recruiter_contact TEXT,
  stage_entered_at TIMESTAMPTZ DEFAULT NOW(),
  stage_dates JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recruiter_name TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recruiter_contact TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage_dates JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id_id_desc ON jobs (user_id, id DESC);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on jobs" ON jobs;
CREATE POLICY "Allow all operations on jobs" ON jobs
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4) Job pipeline — later stages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technical_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  title TEXT NOT NULL,
  job_description TEXT,
  resume_link TEXT NOT NULL,
  recruiter_name TEXT,
  recruiter_contact TEXT,
  first_round_date DATE,
  first_round_result TEXT,
  second_round_date DATE,
  second_round_result TEXT,
  third_round_date DATE,
  third_round_result TEXT,
  status TEXT,
  stage_id TEXT DEFAULT 'technical',
  stage_entered_at TIMESTAMPTZ DEFAULT NOW(),
  stage_dates JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE technical_jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE technical_jobs ADD COLUMN IF NOT EXISTS stage_id TEXT DEFAULT 'technical';
ALTER TABLE technical_jobs ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE technical_jobs ADD COLUMN IF NOT EXISTS stage_dates JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_technical_jobs_user_id ON technical_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_technical_jobs_user_id_id_desc ON technical_jobs (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_technical_jobs_user_stage ON technical_jobs (user_id, stage_id);

ALTER TABLE technical_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access on technical_jobs" ON technical_jobs;
CREATE POLICY "Allow full access on technical_jobs" ON technical_jobs
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5) Pipeline stage config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

INSERT INTO pipeline_stages (id, name, sort_order, is_visible) VALUES
  ('applied', 'Applied', 0, true),
  ('technical', 'Technical', 1, true),
  ('final', 'Final', 2, true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on pipeline_stages" ON pipeline_stages;
CREATE POLICY "Allow all on pipeline_stages" ON pipeline_stages
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 6) Resume DB applications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resume_db_applications (
  id BIGSERIAL PRIMARY KEY,
  entry_id TEXT UNIQUE NOT NULL,
  profile_id BIGINT REFERENCES profiles(id) ON DELETE SET NULL,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
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
  pipeline_stage_id TEXT,
  resume_drive_file_id TEXT,
  cover_drive_file_id TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE resume_db_applications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE resume_db_applications ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE resume_db_applications ADD COLUMN IF NOT EXISTS pipeline_job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE resume_db_applications ADD COLUMN IF NOT EXISTS pipeline_stage_id TEXT;
ALTER TABLE resume_db_applications ADD COLUMN IF NOT EXISTS resume_drive_file_id TEXT;
ALTER TABLE resume_db_applications ADD COLUMN IF NOT EXISTS cover_drive_file_id TEXT;

CREATE INDEX IF NOT EXISTS idx_resume_db_applications_profile_id
  ON resume_db_applications(profile_id);
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_created_at
  ON resume_db_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_id
  ON resume_db_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_pipeline_job_id
  ON resume_db_applications(pipeline_job_id);
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_id_id_desc
  ON resume_db_applications (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_applied_at
  ON resume_db_applications (user_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_resume_db_applications_user_pipeline_stage
  ON resume_db_applications (user_id, pipeline_stage_id);

ALTER TABLE resume_db_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on resume_db_applications" ON resume_db_applications;
CREATE POLICY "Allow all on resume_db_applications" ON resume_db_applications
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 7) Job scraper block lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resume_db_blocked_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  company_name_normalized TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resume_db_blocked_companies_user_company_unique
  ON resume_db_blocked_companies (user_id, company_name_normalized);
CREATE INDEX IF NOT EXISTS resume_db_blocked_companies_user_idx
  ON resume_db_blocked_companies (user_id);

CREATE TABLE IF NOT EXISTS resume_db_blocked_ats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  ats_name TEXT NOT NULL,
  ats_name_normalized TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resume_db_blocked_ats_user_ats_unique
  ON resume_db_blocked_ats (user_id, ats_name_normalized);
CREATE INDEX IF NOT EXISTS resume_db_blocked_ats_user_idx
  ON resume_db_blocked_ats (user_id);

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

-- ---------------------------------------------------------------------------
-- 8) Resume Builder prompt kits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_prompt_kits (
  profile_id BIGINT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  prompt_template TEXT NOT NULL DEFAULT '',
  resume_template_json TEXT NOT NULL DEFAULT '',
  job_description TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_prompt_kits_user_id
  ON profile_prompt_kits(user_id);

ALTER TABLE profile_prompt_kits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on profile_prompt_kits" ON profile_prompt_kits;
CREATE POLICY "Allow all operations on profile_prompt_kits" ON profile_prompt_kits
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 9) Storage bucket for resume/cover uploads
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('resume-db', 'resume-db', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read resume-db bucket" ON storage.objects;
CREATE POLICY "Public read resume-db bucket" ON storage.objects
  FOR SELECT USING (bucket_id = 'resume-db');

DROP POLICY IF EXISTS "Allow upload resume-db bucket" ON storage.objects;
CREATE POLICY "Allow upload resume-db bucket" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'resume-db');

DROP POLICY IF EXISTS "Allow delete resume-db bucket" ON storage.objects;
CREATE POLICY "Allow delete resume-db bucket" ON storage.objects
  FOR DELETE USING (bucket_id = 'resume-db');
