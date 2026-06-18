-- Pipeline stages: configurable columns for the job board.
-- "applied" is the default first stage (maps to jobs table). Other stages map to technical_jobs.stage_id.
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT true
);

-- Seed default stages (run once; ignore if already present)
INSERT INTO pipeline_stages (id, name, sort_order) VALUES
  ('applied', 'Applied', 0),
  ('technical', 'Technical', 1),
  ('final', 'Final', 2)
ON CONFLICT (id) DO NOTHING;

-- Add stage_id to technical_jobs for configurable stages (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'technical_jobs' AND column_name = 'stage_id'
  ) THEN
    ALTER TABLE technical_jobs ADD COLUMN stage_id TEXT DEFAULT 'technical';
  END IF;
END $$;
UPDATE technical_jobs SET stage_id = 'final' WHERE status = 'success';
UPDATE technical_jobs SET stage_id = 'technical' WHERE stage_id IS NULL OR (status IS DISTINCT FROM 'success');

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on pipeline_stages" ON pipeline_stages;
CREATE POLICY "Allow all on pipeline_stages" ON pipeline_stages FOR ALL USING (true) WITH CHECK (true);
