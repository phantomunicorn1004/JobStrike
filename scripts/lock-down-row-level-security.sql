-- Lock down the database: only the JobStrike server (service-role key) may read or write data.
--
-- Before this, every table except app_users had a policy "USING (true) WITH CHECK (true)". The anon
-- key ships in the website's JavaScript, so anyone could read and change profiles (SSN, date of
-- birth, address), applications and pipeline cards through Supabase's REST API.
--
-- Deploy the app version that no longer queries the database from the browser FIRST
-- (pipeline board, /jobs-applied, /jobs-technical now use /api/pipeline/stages and
-- /api/jobs/legacy), then run this script in the Supabase SQL editor.
--
-- With row-level security enabled and no policy, the anon and authenticated roles get nothing;
-- the service role bypasses row-level security and is unaffected.

DO $$
DECLARE
  t record;
  p record;
BEGIN
  -- Every table in the public schema: drop all policies and make sure RLS is on.
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t.tablename LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t.tablename);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Storage: anyone could list, upload and delete files in the resume-db bucket with the anon key.
-- The bucket stays public, so the existing resume links (…/object/public/resume-db/…) keep working;
-- listing, uploading and deleting are left to the server.
DROP POLICY IF EXISTS "Public read resume-db bucket" ON storage.objects;
DROP POLICY IF EXISTS "Allow upload resume-db bucket" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete resume-db bucket" ON storage.objects;

-- Check: this should list no policies in public (app_users had USING (false), also dropped: same effect).
SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname IN ('public', 'storage');
