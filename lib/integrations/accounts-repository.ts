import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { CALENDAR_WRITE_SCOPE, MAIL_READ_SCOPE, type ConnectedMailbox } from "@/lib/integrations/providers";
import type {
  MailAccountStatus,
  MailAccountView,
  MailAutomation,
  MailProvider,
} from "@/lib/integrations/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type MailAccountRow = {
  id: string;
  provider: MailProvider;
  email: string;
  profile_id: number | null;
  scopes: string[] | null;
  status: MailAccountStatus;
  automation: MailAutomation;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
};

/** Everything except tokens and cursors. */
const VIEW_COLUMNS =
  "id, provider, email, profile_id, scopes, status, automation, last_sync_at, last_error, created_at";

/** Thrown while scripts/add-mail-calendar-integration.sql has not been run. */
export class MailSetupRequiredError extends Error {
  constructor() {
    super("Email & Calendar is not set up in the database yet (scripts/add-mail-calendar-integration.sql).");
  }
}

function failOn(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  // 42P01: no such table; PGRST205: PostgREST does not know the table.
  const message = error.message ?? "";
  if (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/mail_accounts/.test(message) && /does not exist|schema cache/i.test(message))
  ) {
    throw new MailSetupRequiredError();
  }
  throw new Error(message || "Database request failed.");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMailAccountId(value: string): boolean {
  return UUID.test(value);
}

function toView(row: MailAccountRow): MailAccountView {
  const scopes = row.scopes ?? [];
  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    profileId: row.profile_id,
    status: row.status,
    automation: row.automation,
    canReadMail: scopes.includes(MAIL_READ_SCOPE),
    canUseCalendar: scopes.includes(CALENDAR_WRITE_SCOPE),
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export async function listMailAccounts(userId: string): Promise<MailAccountView[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from("mail_accounts")
    .select(VIEW_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  failOn(error);
  return ((data ?? []) as MailAccountRow[]).map(toView);
}

/**
 * Saves a mailbox after the user agreed. Connecting the same address again (reconnect) replaces
 * its tokens and makes it active again, and keeps its automation mode and sync position.
 */
export async function saveConnectedMailAccount(
  userId: string,
  provider: MailProvider,
  profileId: number | null,
  mailbox: ConnectedMailbox,
): Promise<MailAccountView> {
  const row: Record<string, unknown> = {
    user_id: userId,
    provider,
    email: mailbox.email,
    scopes: mailbox.scopes,
    refresh_token_enc: encryptSecret(mailbox.refreshToken),
    access_token_enc: mailbox.accessToken ? encryptSecret(mailbox.accessToken) : null,
    access_expires_at: mailbox.accessExpiresAt,
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  if (profileId !== null) row.profile_id = profileId;

  const { data, error } = await getSupabaseAdminClient()
    .from("mail_accounts")
    .upsert(row as never, { onConflict: "user_id,provider,email" })
    .select(VIEW_COLUMNS)
    .single();
  failOn(error);
  return toView(data as unknown as MailAccountRow);
}

export async function updateMailAccountSettings(
  userId: string,
  id: string,
  changes: { profileId?: number | null; automation?: MailAutomation },
): Promise<MailAccountView | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (changes.profileId !== undefined) patch.profile_id = changes.profileId;
  if (changes.automation !== undefined) patch.automation = changes.automation;

  const { data, error } = await getSupabaseAdminClient()
    .from("mail_accounts")
    .update(patch as never)
    .eq("id", id)
    .eq("user_id", userId)
    .select(VIEW_COLUMNS)
    .maybeSingle();
  failOn(error);
  return data ? toView(data as MailAccountRow) : null;
}

/** Removes the mailbox (and, through the foreign keys, everything stored from it). */
export async function deleteMailAccount(
  userId: string,
  id: string,
): Promise<{ provider: MailProvider; email: string; refreshToken: string | null } | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("provider, email, refresh_token_enc")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  failOn(error);
  if (!data) return null;

  const row = data as { provider: MailProvider; email: string; refresh_token_enc: string };
  let refreshToken: string | null = null;
  try {
    refreshToken = decryptSecret(row.refresh_token_enc);
  } catch {
    // Unreadable (key changed): the mailbox is still removed.
  }

  const { error: deleteError } = await supabase.from("mail_accounts").delete().eq("id", id).eq("user_id", userId);
  failOn(deleteError);
  return { provider: row.provider, email: row.email, refreshToken };
}
