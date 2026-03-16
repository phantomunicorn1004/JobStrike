import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * OAuth callback handler for Google Drive
 * Exchanges authorization code for access token
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      // User denied access or error occurred
      return NextResponse.redirect(
        new URL(
          `/resume-tailor?drive_auth_error=${encodeURIComponent(error)}`,
          request.url
        )
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL("/resume-tailor?drive_auth_error=no_code", request.url)
      );
    }

    // Exchange code for tokens
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/google-drive/callback`;

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL("/resume-tailor?drive_auth_error=not_configured", request.url)
      );
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error("Token exchange error:", errorData);
      return NextResponse.redirect(
        new URL(
          `/resume-tailor?drive_auth_error=${encodeURIComponent(
            errorData.error || "token_exchange_failed"
          )}`,
          request.url
        )
      );
    }

    const tokens = await tokenResponse.json();

    // Store tokens securely in httpOnly cookie
    // In production, consider encrypting these tokens
    const cookieStore = await cookies();
    cookieStore.set("google_drive_access_token", tokens.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60, // 1 hour (access token expiry)
    });

    if (tokens.refresh_token) {
      cookieStore.set("google_drive_refresh_token", tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }

    // Redirect back to resume tailor page
    return NextResponse.redirect(
      new URL("/resume-tailor?drive_auth_success=true", request.url)
    );
  } catch (error) {
    console.error("Google Drive callback error:", error);
    return NextResponse.redirect(
      new URL(
        `/resume-tailor?drive_auth_error=${encodeURIComponent(
          error instanceof Error ? error.message : "unknown_error"
        )}`,
        request.url
      )
    );
  }
}
