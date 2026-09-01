/**
 * Canonical job URL for duplicate matching.
 * Compares host + path only (no query, hash, protocol, or www).
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

    return `${host}${path}`;
  } catch {
    return "";
  }
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
