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
