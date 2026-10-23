import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  createGoogleOAuthState,
  GOOGLE_OAUTH_NONCE_COOKIE,
  OAUTH_STATE_MAX_AGE_SEC,
} from "@/lib/auth/google-oauth-state";
import {
  getAuthorizationUrl,
  isGoogleOAuthConfiguredForUser,
  resolveGoogleOAuthCredentials,
} from "@/lib/google-drive/oauth-web";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || session.role !== "member") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/settings");
    return NextResponse.redirect(loginUrl);
  }

  const origin = new URL(request.url).origin;
  const popup = request.nextUrl.searchParams.get("popup") === "1";

  if (!(await isGoogleOAuthConfiguredForUser(session.id, origin))) {
    const settingsUrl = new URL("/settings", request.url);
    settingsUrl.searchParams.set("google", "error");
    settingsUrl.searchParams.set("reason", "missing_oauth_credentials");
    return NextResponse.redirect(settingsUrl);
  }

  const credentials = await resolveGoogleOAuthCredentials(session.id, origin);
  if (!credentials) {
    const settingsUrl = new URL("/settings", request.url);
    settingsUrl.searchParams.set("google", "error");
    settingsUrl.searchParams.set("reason", "missing_oauth_credentials");
    return NextResponse.redirect(settingsUrl);
  }

  const { state, nonce } = createGoogleOAuthState(session.id, popup);
  const url = getAuthorizationUrl(credentials, state);
  const response = NextResponse.redirect(url);
  // Ties the flow to this browser; the callback checks and clears it.
  response.cookies.set(GOOGLE_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations",
    maxAge: OAUTH_STATE_MAX_AGE_SEC,
  });
  return response;
}
