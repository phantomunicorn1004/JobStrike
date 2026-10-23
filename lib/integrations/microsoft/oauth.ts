import "server-only";

import {
  CALENDAR_WRITE_SCOPE,
  MAIL_READ_SCOPE,
  MailConnectError,
  mailRedirectUri,
  type MailOAuthProvider,
} from "@/lib/integrations/providers";

/**
 * Outlook.com and Microsoft 365 through the Microsoft identity platform and Graph, with plain
 * fetch. Env: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, optional MICROSOFT_TENANT
 * ("common" = work, school and personal accounts).
 */
const SCOPES = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Read", "Calendars.ReadWrite"];

function config() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const tenant = process.env.MICROSOFT_TENANT?.trim() || "common";
  return { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0` };
}

function requireConfig() {
  const c = config();
  if (!c) throw new MailConnectError("Microsoft sign-in is not set up on this server.");
  return c;
}

/** Microsoft returns Graph scopes either bare ("Mail.Read") or as URLs; compare them bare. */
function grantedScopes(scope: string | undefined): Set<string> {
  return new Set(
    (scope ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase()),
  );
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export const microsoftMailOAuth: MailOAuthProvider = {
  isConfigured: async () => config() !== null,

  async authorizationUrl({ origin, state, codeChallenge, loginHint }) {
    const { clientId, authority } = requireConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      response_mode: "query",
      redirect_uri: mailRedirectUri("microsoft", origin),
      scope: SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    if (loginHint) params.set("login_hint", loginHint);
    return `${authority}/authorize?${params}`;
  },

  async exchangeCode({ origin, code, codeVerifier }) {
    const { clientId, clientSecret, authority } = requireConfig();
    const res = await fetch(`${authority}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: mailRedirectUri("microsoft", origin),
        code_verifier: codeVerifier,
        scope: SCOPES.join(" "),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokens = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !tokens.access_token) {
      // The first line of error_description is readable; the rest is trace ids.
      const detail = tokens.error_description?.split(/\r?\n/)[0] || tokens.error || `HTTP ${res.status}`;
      throw new MailConnectError(`Microsoft sign-in failed: ${detail}`);
    }
    if (!tokens.refresh_token) {
      throw new MailConnectError("Microsoft did not return a lasting sign-in. Please try again.");
    }

    const granted = grantedScopes(tokens.scope);
    if (!granted.has("mail.read")) {
      throw new MailConnectError("Reading email was not allowed. Connect again and accept all permissions.");
    }

    const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const profile = (await me.json().catch(() => ({}))) as { mail?: string | null; userPrincipalName?: string };
    // Personal accounts often have no "mail"; their sign-in name is the address.
    const email = (profile.mail || profile.userPrincipalName || "").trim().toLowerCase();
    if (!me.ok || !email.includes("@")) {
      throw new MailConnectError("Microsoft did not say which account was used.");
    }

    return {
      email,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      scopes: [MAIL_READ_SCOPE, ...(granted.has("calendars.readwrite") ? [CALENDAR_WRITE_SCOPE] : [])],
    };
  },

  // Microsoft has no way to withdraw a single app's token; the account owner removes the app
  // under their account's app permissions. Deleting the stored token ends JobStrike's access.
  revoke: async () => false,
};
