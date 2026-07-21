import type { UserRole } from "@/lib/auth/types";

export const SESSION_COOKIE = "rwh_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export const DEFAULT_ADMIN_USERNAME = "ideapulse@remote.helper.com";

/** Existing Resume DB data owner (migration default). */
export const DEFAULT_RESUME_DB_OWNER_USERNAME = "stevenspiethdev@gmail.com";

/** App pages for regular members (admins are redirected away). */
export const MEMBER_ROUTE_PREFIXES = [
  "/dashboard",
  "/resume-db",
  "/resume-tailor",
  "/prompt-builder",
  "/job-scraper",
  "/jobs",
  "/jobs-applied",
  "/jobs-technical",
  "/jobs-final",
  "/profile",
  "/settings",
] as const;

/** Admin-only routes. */
export const ADMIN_ROUTE_PREFIXES = ["/admin"] as const;

export const PUBLIC_PATHS = ["/login"] as const;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isMemberPath(pathname: string): boolean {
  return MEMBER_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isAdminPath(pathname: string): boolean {
  return ADMIN_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function defaultHomeForRole(role: UserRole): string {
  return role === "admin" ? "/admin/users" : "/dashboard";
}
