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
