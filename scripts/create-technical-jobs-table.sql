-- Create a dedicated technical_jobs table for Technical Jobs Page
CREATE TABLE IF NOT EXISTS technical_jobs (
  id BIGSERIAL PRIMARY KEY,
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
  status TEXT, -- ADDED status COLUMN
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and allow all insert/select/update/delete
ALTER TABLE technical_jobs ENABLE ROW LEVEL SECURITY;

-- Allow ALL (for dev only)
CREATE POLICY "Allow full access on technical_jobs" ON technical_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);
