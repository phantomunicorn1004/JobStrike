import { NextRequest, NextResponse } from "next/server";
import {
  fetchGoogleEmailFromRefreshToken,
  oauthPopupResultHtml,
  verifyGoogleOAuthState,
} from "@/lib/auth/google-oauth-state";
import { saveUserGoogleDriveConnection } from "@/lib/auth/google-drive-repository";
import {
  exchangeCodeForTokens,
  resolveGoogleOAuthCredentials,
} from "@/lib/google-drive/oauth-web";

function callbackResponse(
  request: NextRequest,
  popup: boolean,
  result: { ok: boolean; reason?: string },
) {
  const origin = new URL(request.url).origin;
  if (popup) {
    return new NextResponse(oauthPopupResultHtml(origin, result), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const settingsUrl = new URL("/settings", request.url);
  settingsUrl.searchParams.set("google", result.ok ? "connected" : "error");
  if (!result.ok && result.reason) {
    settingsUrl.searchParams.set("reason", result.reason);
  }
  return NextResponse.redirect(settingsUrl);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  let popup = false;
  let userId: string | null = null;

  if (state) {
    try {
      const verified = verifyGoogleOAuthState(state);
      userId = verified.userId;
      popup = verified.popup;
    } catch {
      return callbackResponse(request, popup, {
        ok: false,
        reason: "invalid_state",
      });
    }
  }

  if (error) {
    return callbackResponse(request, popup, { ok: false, reason: error });
  }

  if (!code || !state || !userId) {
    return callbackResponse(request, popup, {
      ok: false,
      reason: "missing_code",
    });
  }

  try {
    const origin = new URL(request.url).origin;
    const credentials = await resolveGoogleOAuthCredentials(userId, origin);
    if (!credentials) {
      return callbackResponse(request, popup, {
        ok: false,
        reason: "missing_oauth_credentials",
      });
    }

    const tokens = await exchangeCodeForTokens(credentials, code);
    if (!tokens.refresh_token) {
      throw new Error("No refresh token returned.");
    }

    let googleEmail: string | null = null;
    try {
      googleEmail = await fetchGoogleEmailFromRefreshToken(
        tokens.refresh_token,
        credentials,
      );
    } catch {
      /* optional */
    }

    await saveUserGoogleDriveConnection(userId, {
      refreshToken: tokens.refresh_token,
      googleEmail,
    });

    return callbackResponse(request, popup, { ok: true });
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return callbackResponse(request, popup, {
      ok: false,
      reason: err instanceof Error ? err.message : "callback_failed",
    });
  }
}
