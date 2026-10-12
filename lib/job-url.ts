/**
 * Canonical job URL for duplicate matching.
 * Compares host + path plus job-id query parameters (no tracking query, hash,
 * protocol, or www),
 * with ATS host/path aliases so common apply-link variants still match.
 */
export function canonicalJobUrl(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);

    let path = parsed.pathname || "";
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep encoded path */
    }
    path = path.toLowerCase();
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

    ({ host, path } = normalizeAtsHostPath(host, path));

    return `${host}${path}${jobIdQuery(parsed.searchParams, host, path)}`;
  } catch {
    return "";
  }
}

// Query parameters that name the job itself. Boards that put the job in the
// query (company.com/careers?gh_jid=123) would otherwise all share one key.
const JOB_ID_PARAM_RE =
  /^(?:gh_jid|ashby_jid|jid|job_?id|job|req_?id|requisition_?id|career_job_req_id|posting_?id|position_?id|opening_?id|opportunity_?id|vacancy_?id|currentjobid|jk|jvi|pid|id)$/;
// A long number or a UUID in the path already names the job.
const PATH_HAS_JOB_ID_RE = /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-/;

function jobIdQuery(searchParams: URLSearchParams, host: string, path: string): string {
  // Then the query adds nothing, and ?gh_jid=123 on /jobs/123 must not split one job in two.
  if (PATH_HAS_JOB_ID_RE.test(path)) return "";
  const pairs: string[] = [];
  searchParams.forEach((value, key) => {
    const name = key.toLowerCase();
    const id = String(value || "").trim().toLowerCase();
    if (!id) return;
    // Greenhouse embeds: /embed/job_app?for=acme&token=123
    const greenhouseToken = name === "token" && host.endsWith("greenhouse.io");
    if (greenhouseToken || JOB_ID_PARAM_RE.test(name)) pairs.push(`${name}=${id}`);
  });
  return pairs.length ? `?${pairs.sort().join("&")}` : "";
}

function normalizeAtsHostPath(
  host: string,
  path: string,
): { host: string; path: string } {
  // Greenhouse migrated boards.* -> job-boards.*; treat as the same board host.
  if (host === "job-boards.greenhouse.io" || host === "boards.greenhouse.io") {
    host = "boards.greenhouse.io";
  } else if (host.endsWith(".greenhouse.io")) {
    // Keep tenant subdomains, but collapse job-boards alias if present.
    host = host.replace(/^job-boards\./, "boards.");
  }

  // Lever regional hosts (jobs.eu.lever.co, jobs.lever.co) share the same path shape.
  if (/^jobs(?:\.[a-z0-9-]+)?\.lever\.co$/.test(host)) {
    host = "jobs.lever.co";
  }

  // Ashby sometimes serves app.ashbyhq.com vs jobs.ashbyhq.com with same path.
  if (host === "app.ashbyhq.com" || host === "jobs.ashbyhq.com") {
    host = "jobs.ashbyhq.com";
  }

  // The application form of a posting is the same job as the posting.
  if (host === "jobs.lever.co") path = path.replace(/\/apply\/?$/i, "");
  if (host === "jobs.ashbyhq.com") path = path.replace(/\/application\/?$/i, "");

  // Workday locale prefixes (/en-us/, /en-gb/, etc.) are often optional in apply links.
  if (host.includes("myworkdayjobs.com") || host.endsWith("workday.com")) {
    path = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/, "");
    if (!path) path = "/";
  }

  return { host, path };
}

export function jobLinksMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = canonicalJobUrl(a);
  const right = canonicalJobUrl(b);
  if (!left || !right) return false;
  return left === right;
}
