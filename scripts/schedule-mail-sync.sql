-- Runs the mailbox sync every 10 minutes (docs/EMAIL_CALENDAR_INTEGRATION.md, section 4.1).
-- Vercel Hobby has no frequent cron, so Supabase calls the website instead.
--
-- Before running:
--   1. Supabase → Database → Extensions: enable "pg_cron" and "pg_net".
--   2. Replace YOUR_CRON_SECRET below with the CRON_SECRET value set in Vercel.
--   3. If the site is not https://job-strike.vercel.app, change the URL.
-- Running it again replaces the schedule (e.g. after changing the secret).

SELECT cron.unschedule('jobstrike-mail-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jobstrike-mail-sync');

SELECT cron.schedule(
  'jobstrike-mail-sync',
  '*/10 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://job-strike.vercel.app/api/cron/mail-sync',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 60000
  );
  $$
);

-- Check it: the last runs and the website's answers.
-- SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'jobstrike-mail-sync') ORDER BY start_time DESC LIMIT 5;
-- SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 5;
