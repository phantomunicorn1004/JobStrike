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
    /^(?:gh_jid|jid|job_?id|job|req_?id|requisition_?id|posting_?id|position_?id|opening_?id|vacancy_?id|currentjobid|jk|vjk|pid|id)$/;

  function jobIdQuery(searchParams) {
    const pairs = [];
    searchParams.forEach((value, key) => {
      const name = key.toLowerCase();
      const id = String(value || '').trim().toLowerCase();
      if (id && JOB_ID_PARAM_RE.test(name)) pairs.push(`${name}=${id}`);
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

      return `${host}${path}${jobIdQuery(parsed.searchParams)}`;
    } catch (_) {
      return '';
    }
  }

  function jobLinksMatch(a, b) {
    const left = canonicalJobUrl(a);
    const right = canonicalJobUrl(b);
    if (!left || !right) return false;
    return left === right;
  }

  global.SmartJobJobUrl = {
    canonicalJobUrl,
    jobLinksMatch,
  };
})(typeof window !== 'undefined' ? window : self);
