import { NextRequest, NextResponse } from "next/server";

/**
 * Get Google OAuth authorization URL
 * This initiates the OAuth flow for Google Drive access
 */
export async function GET(request: NextRequest) {
  try {
    // Google OAuth 2.0 configuration
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/google-drive/callback`;
    const scopes = [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ].join(" ");

    if (!clientId) {
      return NextResponse.json(
        { error: "Google Drive API not configured. Missing GOOGLE_CLIENT_ID." },
        { status: 500 }
      );
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch (error) {
    console.error("Google Drive auth error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get authorization URL",
      },
      { status: 500 }
    );
  }
}
