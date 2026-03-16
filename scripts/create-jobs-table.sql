-- Create jobs table for Rson Remote Team platform
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  job_link TEXT NOT NULL,
  resume_link TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (you can restrict this later)
CREATE POLICY "Allow all operations on jobs" ON jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Insert sample data
INSERT INTO jobs (name, title, company_name, job_link, resume_link, note) VALUES
  ('Sarah Johnson', 'Senior Frontend Developer', 'TechCorp Inc.', 'https://example.com/job/1', '/resumes/sarah-johnson.pdf', 'Strong React experience, available immediately'),
  ('Michael Chen', 'Full Stack Engineer', 'StartupXYZ', 'https://example.com/job/2', '/resumes/michael-chen.pdf', 'Excellent communication skills, remote preferred'),
  ('Emily Rodriguez', 'UI/UX Designer', 'Design Studio Co.', 'https://example.com/job/3', '/resumes/emily-rodriguez.pdf', 'Portfolio available, Figma expert'),
  ('David Kim', 'Backend Developer', 'CloudServices Ltd.', 'https://example.com/job/4', '/resumes/david-kim.pdf', 'AWS certified, 5+ years experience'),
  ('Jessica Taylor', 'Product Manager', 'Innovate Corp', 'https://example.com/job/5', '/resumes/jessica-taylor.pdf', 'Led multiple successful product launches');
