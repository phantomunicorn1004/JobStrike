import "server-only";

import { Auth } from "googleapis";
import {
  createOAuth2Client,
  isGoogleOAuthConfiguredForUser,
  resolveGoogleOAuthCredentials,
} from "@/lib/google-drive/oauth-web";
import {
  CALENDAR_WRITE_SCOPE,
  MAIL_READ_SCOPE,
  MailConnectError,
  mailRedirectUri,
  type MailOAuthProvider,
} from "@/lib/integrations/providers";

const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_EVENTS = "https://www.googleapis.com/auth/calendar.events";

/**
 * Only what the feature needs. Drive is deliberately not included (no include_granted_scopes), so
 * a mail token cannot reach the user's files.
 */
const SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email", GMAIL_READONLY, CALENDAR_EVENTS];

/** Same Google OAuth client as Google Drive (server's or the user's own), with the mail callback. */
async function credentials(userId: string, origin: string) {
  const resolved = await resolveGoogleOAuthCredentials(userId, origin);
  if (!resolved) throw new MailConnectError("Google sign-in is not set up on this server.");
  return { ...resolved, redirectUri: mailRedirectUri("google", origin) };
}

export const googleMailOAuth: MailOAuthProvider = {
  isConfigured: (userId, origin) => isGoogleOAuthConfiguredForUser(userId, origin),

  async authorizationUrl({ userId, origin, state, codeChallenge, loginHint }) {
    const client = createOAuth2Client(await credentials(userId, origin));
    return client.generateAuthUrl({
      access_type: "offline",
      // Always ask, so Google always returns a refresh token (also on reconnect).
      prompt: "consent",
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: Auth.CodeChallengeMethod.S256,
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
  },

  async exchangeCode({ userId, origin, code, codeVerifier }) {
    const creds = await credentials(userId, origin);
    const client = createOAuth2Client(creds);
    const { tokens } = await client.getToken({ code, codeVerifier });

    if (!tokens.refresh_token) {
      throw new MailConnectError("Google did not return a lasting sign-in. Please try again.");
    }
    // Google lets the user untick permissions on the consent screen.
    const granted = new Set((tokens.scope ?? "").split(/\s+/));
    if (!granted.has(GMAIL_READONLY)) {
      throw new MailConnectError(
        'Reading email was not allowed. Connect again and keep "View your email messages" ticked.',
      );
    }

    if (!tokens.id_token) throw new MailConnectError("Google did not say which account was used.");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: creds.clientId });
    const email = ticket.getPayload()?.email?.trim().toLowerCase();
    if (!email) throw new MailConnectError("Google did not say which account was used.");

    return {
      email,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? null,
      accessExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: [MAIL_READ_SCOPE, ...(granted.has(CALENDAR_EVENTS) ? [CALENDAR_WRITE_SCOPE] : [])],
    };
  },

  async revoke(refreshToken) {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
    // 400 invalid_token: already revoked or expired, so access is gone either way.
    return res.ok || res.status === 400;
  },
};
