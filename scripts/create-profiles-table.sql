-- Create profiles table for User Profiles feature
CREATE TABLE IF NOT EXISTS profiles (
  id BIGSERIAL PRIMARY KEY,
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

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (you can restrict this later)
CREATE POLICY "Allow all operations on profiles" ON profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Insert initial data
INSERT INTO profiles (full_name, dob, work_emails, phone_numbers, ssn, address, city, state, postal_code, university, linkedin) VALUES
  ('Andrew Garcia', '07/20/1995', ARRAY['andrewgarman@zohomail.com', 'andrewgpulse@hotmail.com', 'andygpulse95@outlook.com'], ARRAY['+1 (818) 921-4009'], '2694', '21930 VALERIO ST', 'Canoga Park', 'California', '91303', 'University of Redlands (2013-2017)', 'https://www.linkedin.com/in/andrew-garcia-0a59913a5'),
  ('Jerry Vang', '04/12/1998', ARRAY['jerryvangit@zohomail.com', 'jerryvman@outlook.com'], ARRAY['+1 (818) 806-6652'], '5215', '21930 VALERIO ST', 'Sacramento', 'California', '91303', 'Nanyang Technological University (NTU) (2012-2016)', 'https://www.linkedin.com/in/jerry-vang-493a323a4'),
  ('Heming Tian', '03/02/1994', ARRAY['hemingchtian@yahoo.com'], ARRAY['+1 (818) 806-6652'], '2440', '3401 W Parmer Ln', 'Austin', 'Texas', '78727', 'Nanyang Technological University (NTU) (2012-2016)', 'https://www.linkedin.com/in/heming-tian-8b86a13a5');
