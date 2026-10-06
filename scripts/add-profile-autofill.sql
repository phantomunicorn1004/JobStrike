-- Application-form answers per profile (work eligibility, education, links,
-- voluntary demographics). Read by the extension's Autofill and AI answers.
-- One JSONB column so new answer fields need no further migration.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS autofill JSONB NOT NULL DEFAULT '{}'::jsonb;
