import "server-only";

import { google } from "googleapis";

const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function isGoogleOAuthWebConfigured(): boolean {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

export function getGoogleOAuthRedirectUri(origin: string): string {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || origin.replace(/\/+$/, "");
  return `${base}/api/integrations/google-drive/callback`;
}

export function createOAuth2Client(origin: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    getGoogleOAuthRedirectUri(origin),
  );
}

export function getAuthorizationUrl(origin: string, state: string): string {
  const oauth2 = createOAuth2Client(origin);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCodeForTokens(origin: string, code: string) {
  const oauth2 = createOAuth2Client(origin);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect the app in your Google Account and connect again.",
    );
  }
  return tokens;
}

export function oauth2ClientWithRefreshToken(
  origin: string,
  refreshToken: string,
) {
  const oauth2 = createOAuth2Client(origin);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}
