-- Per-stage visibility on the Job Pipeline board (Manage stages + column toggle).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pipeline_stages'
      AND column_name = 'is_visible'
  ) THEN
    ALTER TABLE pipeline_stages
      ADD COLUMN is_visible BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

UPDATE pipeline_stages SET is_visible = true WHERE is_visible IS NULL;
