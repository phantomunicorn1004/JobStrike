/**
 * Canonical job URL for duplicate matching (extension copy of lib/job-url.ts).
 * Compares host + path only (no query, hash, protocol, or www).
 */
(function (global) {
  function canonicalJobUrl(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      let host = parsed.hostname.toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);

      let path = parsed.pathname || "";
      try {
        path = decodeURIComponent(path);
      } catch (_) {
        /* keep encoded path */
      }
      path = path.toLowerCase();
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

      return `${host}${path}`;
    } catch (_) {
      return "";
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
})(typeof window !== "undefined" ? window : self);
