import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth/types";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/session-core";

/** Session lookup for the proxy (proxy.ts), which has no next/headers. */
export async function getSessionFromRequest(
  request: NextRequest,
): Promise<SessionUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
