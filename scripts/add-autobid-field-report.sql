-- Auto-bid's per-field report (docs/AUTOBID_PLAN.md, phase 2): for every
-- application attempt, each form field with what was entered, where the value
-- came from and how filling went. Its own column, read only when a job is
-- opened on the Auto-bid page, so the page's 20-second refresh stays small.
-- Run once in the Supabase SQL editor. Safe to run again.

ALTER TABLE public.resume_db_applications
  ADD COLUMN IF NOT EXISTS bid_fields jsonb;
