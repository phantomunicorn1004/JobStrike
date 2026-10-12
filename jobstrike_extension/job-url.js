/**
 * Canonical job URL for duplicate matching (extension copy of lib/job-url.ts).
 * Compares host + path plus job-id query parameters (no tracking query, hash,
 * protocol, or www),
 * with ATS host/path aliases so common apply-link variants still match.
 */
(function (global) {
  function normalizeAtsHostPath(host, path) {
    // Greenhouse migrated boards.* -> job-boards.*; treat as the same board host.
    if (host === 'job-boards.greenhouse.io' || host === 'boards.greenhouse.io') {
      host = 'boards.greenhouse.io';
    } else if (host.endsWith('.greenhouse.io')) {
      host = host.replace(/^job-boards\./, 'boards.');
    }

    // Lever regional hosts (jobs.eu.lever.co, jobs.lever.co) share the same path shape.
    if (/^jobs(?:\.[a-z0-9-]+)?\.lever\.co$/.test(host)) {
      host = 'jobs.lever.co';
    }

    // Ashby sometimes serves app.ashbyhq.com vs jobs.ashbyhq.com with same path.
    if (host === 'app.ashbyhq.com' || host === 'jobs.ashbyhq.com') {
      host = 'jobs.ashbyhq.com';
    }

    // The application form of a posting is the same job as the posting.
    if (host === 'jobs.lever.co') path = path.replace(/\/apply\/?$/i, '');
    if (host === 'jobs.ashbyhq.com') path = path.replace(/\/application\/?$/i, '');

    // Workday locale prefixes (/en-us/, /en-gb/, etc.) are often optional in apply links.
    if (host.includes('myworkdayjobs.com') || host.endsWith('workday.com')) {
      path = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/, '');
      if (!path) path = '/';
    }

    return { host, path };
  }

  // Query parameters that name the job itself. Boards that put the job in the
  // query (company.com/careers?gh_jid=123) would otherwise all share one key.
  const JOB_ID_PARAM_RE =
    /^(?:gh_jid|ashby_jid|jid|job_?id|job|req_?id|requisition_?id|career_job_req_id|posting_?id|position_?id|opening_?id|opportunity_?id|vacancy_?id|currentjobid|jk|jvi|pid|id)$/;
  // A long number or a UUID in the path already names the job.
  const PATH_HAS_JOB_ID_RE = /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-/;

  function jobIdQuery(searchParams, host, path) {
    // Then the query adds nothing, and ?gh_jid=123 on /jobs/123 must not split one job in two.
    if (PATH_HAS_JOB_ID_RE.test(path)) return '';
    const pairs = [];
    searchParams.forEach((value, key) => {
      const name = key.toLowerCase();
      const id = String(value || '').trim().toLowerCase();
      if (!id) return;
      // Greenhouse embeds: /embed/job_app?for=acme&token=123
      const greenhouseToken = name === 'token' && host.endsWith('greenhouse.io');
      if (greenhouseToken || JOB_ID_PARAM_RE.test(name)) pairs.push(`${name}=${id}`);
    });
    return pairs.length ? `?${pairs.sort().join('&')}` : '';
  }

  function canonicalJobUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    try {
      const parsed = new URL(raw);
      let host = parsed.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);

      let path = parsed.pathname || '';
      try {
        path = decodeURIComponent(path);
      } catch (_) {
        /* keep encoded path */
      }
      path = path.toLowerCase();
      if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

      ({ host, path } = normalizeAtsHostPath(host, path));

      return `${host}${path}${jobIdQuery(parsed.searchParams, host, path)}`;
    } catch (_) {
      return '';
    }
  }

  /**
   * True when the canonical form distinguishes one posting from another: a job
   * id in the query, or a long number / UUID in the path. A bare careers page
   * (company.com/careers, or a #/job/1 route, whose hash is dropped) does not,
   * and must not be used to decide that two jobs are the same.
   */
  function urlIdentifiesJob(value) {
    const key = canonicalJobUrl(value);
    if (!key) return false;
    if (key.includes('?')) return true;
    const slash = key.indexOf('/');
    return slash > 0 && PATH_HAS_JOB_ID_RE.test(key.slice(slash));
  }

  function jobLinksMatch(a, b) {
    const left = canonicalJobUrl(a);
    const right = canonicalJobUrl(b);
    if (!left || !right) return false;
    return left === right;
  }

  /**
   * The posting's own page for a link that leads to its application form
   * (Lever ".../apply", Ashby ".../application"). Other links come back unchanged.
   */
  function postingPageUrl(raw) {
    const text = String(raw || '').trim();
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      if (/^jobs(?:\.[a-z0-9-]+)?\.lever\.co$/.test(host) && /\/[0-9a-f-]{36}\/apply\/?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/apply\/?$/i, '');
        return url.toString();
      }
      if (host === 'jobs.ashbyhq.com' && /\/[0-9a-f-]{36}\/application\/?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/application\/?$/i, '');
        return url.toString();
      }
    } catch (_) {
      /* not a link */
    }
    return text;
  }

  global.SmartJobJobUrl = {
    postingPageUrl,
    canonicalJobUrl,
    urlIdentifiesJob,
    jobLinksMatch,
  };
})(typeof window !== 'undefined' ? window : self);
