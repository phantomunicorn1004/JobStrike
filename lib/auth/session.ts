import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/auth/types";
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth/constants";
import { signSessionToken, verifySessionToken } from "@/lib/auth/session-core";

const sessionCookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Preferred for auth route handlers — sets cookie on the response object. */
export async function createSessionJsonResponse(
  body: Record<string, unknown>,
  user: SessionUser,
): Promise<NextResponse> {
  const token = await signSessionToken(user);
  const response = NextResponse.json(body);
  response.cookies.set(SESSION_COOKIE, token, {
    ...sessionCookieBase,
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return response;
}

export function createLogoutJsonResponse(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieBase,
    maxAge: 0,
  });
  return response;
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const cookieStore = await cookies();
  const token = await signSessionToken(user);
  cookieStore.set(SESSION_COOKIE, token, {
    ...sessionCookieBase,
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    ...sessionCookieBase,
    maxAge: 0,
  });
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function requireAdminUser(): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (user.role !== "admin") throw new Error("Forbidden");
  return user;
}
