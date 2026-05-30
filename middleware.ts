import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  defaultHomeForRole,
  isAdminPath,
  isMemberPath,
  isPublicPath,
} from "@/lib/auth/constants";
import { getSessionFromRequest } from "@/lib/auth/session";

const AUTH_API_PREFIX = "/api/auth";
const PUBLIC_API_PREFIXES = [
  "/api/health",
  `${AUTH_API_PREFIX}/login`,
  `${AUTH_API_PREFIX}/signup`,
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isProtectedApi(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (isPublicApi(pathname)) return false;
  if (pathname.startsWith(AUTH_API_PREFIX)) return false;
  return pathname.startsWith("/api/admin/");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await getSessionFromRequest(request);

  if (isPublicApi(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    if (isProtectedApi(pathname)) {
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (session.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    if (session) {
      return NextResponse.redirect(
        new URL(defaultHomeForRole(session.role), request.url),
      );
    }
    return NextResponse.next();
  }

  if (pathname === "/") {
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.redirect(
      new URL(defaultHomeForRole(session.role), request.url),
    );
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session.role === "admin") {
    if (isMemberPath(pathname)) {
      return NextResponse.redirect(new URL("/admin/users", request.url));
    }
    if (pathname === "/admin" || pathname === "/admin/") {
      return NextResponse.redirect(new URL("/admin/users", request.url));
    }
    return NextResponse.next();
  }

  if (session.role === "member") {
    if (isAdminPath(pathname)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
