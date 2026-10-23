import "server-only";

import type { MailProvider } from "@/lib/integrations/types";

/** What a provider hands back once the user has agreed. */
export type ConnectedMailbox = {
  email: string;
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: string | null;
  /** Granted permissions, normalised: "mail.read", "calendar.write", … (see grantedScopes). */
  scopes: string[];
};

export type MailOAuthProvider = {
  isConfigured(userId: string, origin: string): Promise<boolean>;
  authorizationUrl(input: {
    userId: string;
    origin: string;
    state: string;
    codeChallenge: string;
    loginHint: string | null;
  }): Promise<string>;
  exchangeCode(input: {
    userId: string;
    origin: string;
    code: string;
    codeVerifier: string;
  }): Promise<ConnectedMailbox>;
  /** A fresh access token. Throws MailAuthError when the user must sign in again. */
  refreshAccess(refreshToken: string, userId: string): Promise<RefreshedAccess>;
  /** Best effort: withdraws JobStrike's access in the provider account, where the provider allows it. */
  revoke(refreshToken: string): Promise<boolean>;
};

export type RefreshedAccess = {
  accessToken: string;
  accessExpiresAt: string;
  /** Microsoft hands out a new refresh token each time; it replaces the stored one. */
  refreshToken: string | null;
};

/** Shown to the user when a provider refused or the user unticked a permission. */
export class MailConnectError extends Error {}

/** The stored sign-in no longer works (expired, revoked, password changed): the user must reconnect. */
export class MailAuthError extends Error {}

/** The provider asked to slow down; the sync stops and continues on its next run. */
export class MailThrottledError extends Error {}

export function mailRedirectUri(provider: MailProvider, origin: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || origin).replace(/\/+$/, "");
  return `${base}/api/integrations/mail/${provider}/callback`;
}

/** Permissions JobStrike uses, in provider-neutral names (stored in mail_accounts.scopes). */
export const MAIL_READ_SCOPE = "mail.read";
export const CALENDAR_WRITE_SCOPE = "calendar.write";

export async function getMailOAuthProvider(provider: MailProvider): Promise<MailOAuthProvider> {
  return provider === "google"
    ? (await import("@/lib/integrations/google/oauth")).googleMailOAuth
    : (await import("@/lib/integrations/microsoft/oauth")).microsoftMailOAuth;
}
