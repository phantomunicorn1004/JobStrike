-- Live status of the machines doing the automatic bidding, for the website's
-- Auto-bid page: what the JobStrike panel's Auto-bid runner (and Live) is doing,
-- and which AutoGen windows are running. Each extension reports about once a
-- minute; the page shows a runner as stopped when its report is old.
-- Run once in the Supabase SQL editor. Safe to run again.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS autobid_status JSONB;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS autogen_status JSONB;
