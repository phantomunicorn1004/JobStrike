-- Application users (username + password auth, separate from candidate profiles)
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_users_username_unique UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS app_users_username_idx ON app_users (username);
CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users (role);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Service role / admin client bypasses RLS; block anon direct access.
DROP POLICY IF EXISTS "No anon access to app_users" ON app_users;
CREATE POLICY "No anon access to app_users" ON app_users
  FOR ALL
  USING (false)
  WITH CHECK (false);
