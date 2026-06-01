import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createGoogleOAuthState } from "@/lib/auth/google-oauth-state";
import {
  getAuthorizationUrl,
  isGoogleOAuthWebConfigured,
} from "@/lib/google-drive/oauth-web";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || session.role !== "member") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/settings");
    return NextResponse.redirect(loginUrl);
  }

  if (!isGoogleOAuthWebConfigured()) {
    return NextResponse.redirect(
      new URL("/settings?google=error&reason=not_configured", request.url),
    );
  }

  const origin = new URL(request.url).origin;
  const state = createGoogleOAuthState(session.id);
  const url = getAuthorizationUrl(origin, state);
  return NextResponse.redirect(url);
}
