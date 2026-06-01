import { NextRequest, NextResponse } from "next/server";
import {
  fetchGoogleEmailFromRefreshToken,
  verifyGoogleOAuthState,
} from "@/lib/auth/google-oauth-state";
import {
  saveUserGoogleDriveConnection,
} from "@/lib/auth/google-drive-repository";
import { exchangeCodeForTokens } from "@/lib/google-drive/oauth-web";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const settingsUrl = new URL("/settings", request.url);

  if (error) {
    settingsUrl.searchParams.set("google", "error");
    settingsUrl.searchParams.set("reason", error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("google", "error");
    settingsUrl.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const userId = verifyGoogleOAuthState(state);
    const origin = new URL(request.url).origin;
    const tokens = await exchangeCodeForTokens(origin, code);
    if (!tokens.refresh_token) {
      throw new Error("No refresh token returned.");
    }

    let googleEmail: string | null = null;
    try {
      googleEmail = await fetchGoogleEmailFromRefreshToken(
        tokens.refresh_token,
        origin,
      );
    } catch {
      /* optional */
    }

    await saveUserGoogleDriveConnection(userId, {
      refreshToken: tokens.refresh_token,
      googleEmail,
    });

    settingsUrl.searchParams.set("google", "connected");
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    settingsUrl.searchParams.set("google", "error");
    settingsUrl.searchParams.set(
      "reason",
      err instanceof Error ? err.message : "callback_failed",
    );
    return NextResponse.redirect(settingsUrl);
  }
}
