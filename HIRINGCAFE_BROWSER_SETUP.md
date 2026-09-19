# Job scraper browser setup (HiringCafe + Jobright)

Web scrapes use **Playwright + Chromium** through your residential proxy (`HIRING_CAFE_PROXY`).

## Sources

- **HiringCafe** — multi-page Next.js data scrape (default)
- **Jobright** — SSR search + swan-api pagination when session cookies allow; undated jobs are kept (not fake-dated as "now")

## Local setup

1. `npx playwright install chromium`
2. In `.env.local`:
   ```
   HIRING_CAFE_PROXY=host:port:username:password
   ```
3. Restart `npm run dev`

## Proxy format

```
HIRING_CAFE_PROXY=p.webshare.io:80:YOUR_USERNAME:YOUR_PASSWORD
```

Playwright uses separate `server` + `username` + `password` fields (handled in code).

## Jobright notes

- Prefer real `applyLink` when present; otherwise falls back to `jobright.ai/jobs/info/{id}`
- After the first SSR page, the scraper tries swan-api pagination with browser cookies (correct multi-page when the API accepts the session)
- If Jobright shows a security check, retry later or use the extension while signed in
