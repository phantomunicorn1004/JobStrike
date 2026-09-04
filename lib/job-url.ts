/**
 * Canonical job URL for duplicate matching.
 * Compares host + path only (no query, hash, protocol, or www),
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

    return `${host}${path}`;
  } catch {
    return "";
  }
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
