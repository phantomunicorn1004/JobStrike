import { NextRequest, NextResponse } from "next/server";
import {
  fetchGoogleEmailFromRefreshToken,
  GOOGLE_OAUTH_NONCE_COOKIE,
  oauthPopupResultHtml,
  peekGoogleOAuthPopup,
  verifyGoogleOAuthState,
} from "@/lib/auth/google-oauth-state";
import { getSessionUser } from "@/lib/auth/session";
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
  let response: NextResponse;
  if (popup) {
    response = new NextResponse(oauthPopupResultHtml(origin, result), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else {
    const settingsUrl = new URL("/settings", request.url);
    settingsUrl.searchParams.set("google", result.ok ? "connected" : "error");
    if (!result.ok && result.reason) {
      settingsUrl.searchParams.set("reason", result.reason);
    }
    response = NextResponse.redirect(settingsUrl);
  }
  // A connect flow can be completed once.
  response.cookies.set(GOOGLE_OAUTH_NONCE_COOKIE, "", { path: "/api/integrations", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  let popup = peekGoogleOAuthPopup(state);
  let userId: string | null = null;

  if (state) {
    try {
      const verified = verifyGoogleOAuthState(state, request.cookies.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value);
      // The account is linked to whoever is signed in here, and only if that is who started it.
      const session = await getSessionUser();
      if (!session || session.id !== verified.userId) {
        throw new Error("Signed-in user does not match the connect request.");
      }
      userId = verified.userId;
      popup = verified.popup;
    } catch (stateError) {
      console.warn("Google OAuth state rejected:", stateError instanceof Error ? stateError.message : stateError);
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
