import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createGoogleOAuthState } from "@/lib/auth/google-oauth-state";
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

  const state = createGoogleOAuthState(session.id, popup);
  const url = getAuthorizationUrl(credentials, state);
  return NextResponse.redirect(url);
}
