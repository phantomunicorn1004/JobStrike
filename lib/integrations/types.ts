/** Shared by the server and the Settings card (no secrets here). */

export const MAIL_PROVIDERS = ["google", "microsoft"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const MAIL_AUTOMATION_MODES = ["auto", "suggest", "off"] as const;
export type MailAutomation = (typeof MAIL_AUTOMATION_MODES)[number];

export type MailAccountStatus = "active" | "reauth_required" | "disabled";

export function parseMailProvider(value: unknown): MailProvider | null {
  return MAIL_PROVIDERS.includes(value as MailProvider) ? (value as MailProvider) : null;
}

export function parseMailAutomation(value: unknown): MailAutomation | null {
  return MAIL_AUTOMATION_MODES.includes(value as MailAutomation) ? (value as MailAutomation) : null;
}

export const MAIL_PROVIDER_LABELS: Record<MailProvider, string> = {
  google: "Gmail",
  microsoft: "Outlook",
};

/** A connected mailbox as the browser sees it. */
export type MailAccountView = {
  id: string;
  provider: MailProvider;
  email: string;
  profileId: number | null;
  status: MailAccountStatus;
  automation: MailAutomation;
  canReadMail: boolean;
  canUseCalendar: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type MailAccountsResponse = {
  accounts: MailAccountView[];
  profiles: { id: number; fullName: string }[];
  /** Which providers the server has sign-in credentials for. */
  providers: Record<MailProvider, boolean>;
  /** TOKEN_ENCRYPTION_KEY is set; without it nothing can be connected. */
  encryptionReady: boolean;
  /** scripts/add-mail-calendar-integration.sql has not been run yet. */
  setupRequired: boolean;
};

/** What the OAuth popup posts back to the Settings page. */
export const MAIL_OAUTH_MESSAGE = "mail-oauth";
export type MailOAuthResult = {
  type: typeof MAIL_OAUTH_MESSAGE;
  ok: boolean;
  message: string | null;
  email: string | null;
};
