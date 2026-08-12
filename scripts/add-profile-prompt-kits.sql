-- Per-profile Resume Builder prompt kit (server-side storage for website + extension)
-- Run in Supabase SQL editor after profiles + app_users exist.

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profile_prompt_kits'
      AND policyname = 'Allow all operations on profile_prompt_kits'
  ) THEN
    CREATE POLICY "Allow all operations on profile_prompt_kits" ON profile_prompt_kits
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
