-- The all-in-one Auto-bid setup (Start/Stop, profile, dry run or submit, daily
-- limit, ChatGPT windows, Live hours and sources), edited from the website's
-- Auto-bid page or the JobStrike panel's Auto-bid tab; the panel on the VPS
-- follows it. Run once in the Supabase SQL editor. Safe to run again.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS autobid_config JSONB;
