import "server-only";

import { google } from "googleapis";
import {
  getUserGoogleOAuthCredentials,
  type StoredGoogleOAuthCredentials,
} from "@/lib/auth/google-drive-repository";

const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

export type GoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleOAuthRedirectUri(origin: string): string {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || origin.replace(/\/+$/, "");
  return `${base}/api/integrations/google-drive/callback`;
}

function credentialsFromEnv(origin: string): GoogleOAuthCredentials | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: getGoogleOAuthRedirectUri(origin),
  };
}

function credentialsFromStored(
  stored: StoredGoogleOAuthCredentials,
  origin: string,
): GoogleOAuthCredentials | null {
  if (!stored.clientId || !stored.clientSecret) return null;
  return {
    clientId: stored.clientId,
    clientSecret: stored.clientSecret,
    redirectUri: getGoogleOAuthRedirectUri(origin),
  };
}

export async function resolveGoogleOAuthCredentials(
  userId: string,
  origin: string,
): Promise<GoogleOAuthCredentials | null> {
  return (
    credentialsFromEnv(origin) ??
    credentialsFromStored(await getUserGoogleOAuthCredentials(userId), origin)
  );
}

export function isGoogleOAuthWebConfigured(): boolean {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

export async function isGoogleOAuthConfiguredForUser(
  userId: string,
  origin: string,
): Promise<boolean> {
  if (isGoogleOAuthWebConfigured()) return true;
  const creds = await resolveGoogleOAuthCredentials(userId, origin);
  return Boolean(creds?.clientId && creds?.clientSecret);
}

export function createOAuth2Client(credentials: GoogleOAuthCredentials) {
  return new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri,
  );
}

export function getAuthorizationUrl(
  credentials: GoogleOAuthCredentials,
  state: string,
): string {
  const oauth2 = createOAuth2Client(credentials);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCodeForTokens(
  credentials: GoogleOAuthCredentials,
  code: string,
) {
  const oauth2 = createOAuth2Client(credentials);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect the app in your Google Account and connect again.",
    );
  }
  return tokens;
}

export function oauth2ClientWithRefreshToken(
  credentials: GoogleOAuthCredentials,
  refreshToken: string,
) {
  const oauth2 = createOAuth2Client(credentials);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}
