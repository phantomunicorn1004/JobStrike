-- Add stage_id to technical_jobs if missing (run in Supabase SQL Editor for existing DBs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'technical_jobs' AND column_name = 'stage_id'
  ) THEN
    ALTER TABLE technical_jobs ADD COLUMN stage_id TEXT DEFAULT 'technical';
    UPDATE technical_jobs SET stage_id = 'final' WHERE status = 'success';
    UPDATE technical_jobs SET stage_id = 'technical' WHERE stage_id IS NULL OR (status IS DISTINCT FROM 'success');
  END IF;
END $$;
