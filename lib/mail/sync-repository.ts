import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { failOn } from "@/lib/integrations/accounts-repository";
import type { MailAccountStatus, MailProvider } from "@/lib/integrations/types";
import type { FetchedMessage, MailSyncProgress } from "@/lib/mail/types";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Everything the sync needs about a mailbox, tokens still encrypted. */
export type SyncAccount = {
  id: string;
  user_id: string;
  profile_id: number | null;
  provider: MailProvider;
  email: string;
  status: MailAccountStatus;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  mail_cursor: string | null;
  sync_progress: MailSyncProgress | null;
  last_sync_at: string | null;
  sync_requested_at: string | null;
  subscription_id: string | null;
  subscription_expires_at: string | null;
  subscription_secret_hash: string | null;
  scopes: string[] | null;
  /** When the calendar was last read (ISO). */
  calendar_cursor: string | null;
};

const SYNC_COLUMNS =
  "id, user_id, profile_id, provider, email, status, refresh_token_enc, access_token_enc, access_expires_at, mail_cursor, sync_progress, last_sync_at, sync_requested_at, subscription_id, subscription_expires_at, subscription_secret_hash, scopes, calendar_cursor";

const accounts = () => getSupabaseAdminClient().from("mail_accounts");

export async function getSyncAccount(id: string): Promise<SyncAccount | null> {
  const { data, error } = await accounts().select(SYNC_COLUMNS).eq("id", id).maybeSingle();
  failOn(error);
  return (data as SyncAccount | null) ?? null;
}

/** Active mailboxes, least recently synced first (the timer decides which are due). */
export async function listActiveSyncAccounts(userId?: string): Promise<SyncAccount[]> {
  let query = accounts().select(SYNC_COLUMNS).eq("status", "active");
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.order("last_sync_at", { ascending: true, nullsFirst: true });
  failOn(error);
  return (data ?? []) as SyncAccount[];
}

export async function findAccountBySubscription(subscriptionId: string): Promise<SyncAccount | null> {
  const { data, error } = await accounts().select(SYNC_COLUMNS).eq("subscription_id", subscriptionId).maybeSingle();
  failOn(error);
  return (data as SyncAccount | null) ?? null;
}

/**
 * Takes the mailbox for one sync run. False when another run holds it (its lock expires on its
 * own if that run died).
 */
export async function claimSync(id: string, seconds: number): Promise<boolean> {
  const now = new Date();
  const { data, error } = await accounts()
    .update({ sync_lock_until: new Date(now.getTime() + seconds * 1000).toISOString() } as never)
    .eq("id", id)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${now.toISOString()}`)
    .select("id");
  failOn(error);
  return (data ?? []).length > 0;
}

export async function releaseSync(id: string): Promise<void> {
  const { error } = await accounts().update({ sync_lock_until: null } as never).eq("id", id);
  failOn(error);
}

/** New mail arrived while a run held the mailbox: that run reads once more before it stops. */
export async function requestSync(id: string): Promise<void> {
  const { error } = await accounts().update({ sync_requested_at: new Date().toISOString() } as never).eq("id", id);
  failOn(error);
}

export async function saveAccessTokens(
  id: string,
  tokens: { accessToken: string; accessExpiresAt: string; refreshToken: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {
    access_token_enc: encryptSecret(tokens.accessToken),
    access_expires_at: tokens.accessExpiresAt,
  };
  if (tokens.refreshToken) patch.refresh_token_enc = encryptSecret(tokens.refreshToken);
  const { error } = await accounts().update(patch as never).eq("id", id);
  failOn(error);
}

/** Saved after every page, so a run that is cut off continues where it stopped. */
export async function saveSyncPosition(id: string, cursor: string | null, progress: MailSyncProgress): Promise<void> {
  const { error } = await accounts().update({ mail_cursor: cursor, sync_progress: progress } as never).eq("id", id);
  failOn(error);
}

export async function finishSync(id: string, progress: MailSyncProgress): Promise<void> {
  const { error } = await accounts()
    .update({ sync_progress: progress, last_sync_at: new Date().toISOString(), last_error: null } as never)
    .eq("id", id);
  failOn(error);
}

export async function saveSyncError(id: string, message: string, status?: MailAccountStatus): Promise<void> {
  const patch: Record<string, unknown> = { last_error: message.slice(0, 300) };
  if (status) patch.status = status;
  const { error } = await accounts().update(patch as never).eq("id", id);
  failOn(error);
}

export async function saveSubscription(
  id: string,
  subscription: { id: string; expiresAt: string; secretHash: string } | null,
): Promise<void> {
  const { error } = await accounts()
    .update({
      subscription_id: subscription?.id ?? null,
      subscription_expires_at: subscription?.expiresAt ?? null,
      subscription_secret_hash: subscription?.secretHash ?? null,
    } as never)
    .eq("id", id);
  failOn(error);
}

export async function saveSubscriptionExpiry(id: string, expiresAt: string): Promise<void> {
  const { error } = await accounts().update({ subscription_expires_at: expiresAt } as never).eq("id", id);
  failOn(error);
}

export function decryptRefreshToken(account: SyncAccount): string {
  return decryptSecret(account.refresh_token_enc);
}

/** Companies the user applied to, for recognising their mail. */
export async function listAppliedCompanies(userId: string): Promise<string[]> {
  const rows = await fetchAllByRange<{ company: string | null }>((from, to) =>
    getSupabaseAdminClient()
      .from("resume_db_applications")
      .select("company")
      .eq("user_id", userId)
      .range(from, to),
  );
  return rows.map((row) => row.company ?? "").filter(Boolean);
}

const SNIPPET_MAX = 500;

/** Stores kept messages; ones already stored are skipped. Returns how many were new. */
export async function insertMailMessages(
  account: Pick<SyncAccount, "id" | "user_id">,
  messages: { message: FetchedMessage; reason: string }[],
): Promise<number> {
  if (messages.length === 0) return 0;
  const rows = messages.map(({ message, reason }) => ({
    user_id: account.user_id,
    account_id: account.id,
    provider_id: message.providerId,
    thread_id: message.threadId,
    received_at: message.receivedAt,
    from_name: message.fromName?.slice(0, 200) ?? null,
    from_email: message.fromEmail.slice(0, 320),
    to_email: message.toEmail?.slice(0, 320) ?? null,
    subject: message.subject.slice(0, 500),
    snippet: message.preview.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX),
    web_link: message.webLink,
    prefilter_reason: reason,
  }));
  const { data, error } = await getSupabaseAdminClient()
    .from("mail_messages")
    .upsert(rows as never, { onConflict: "account_id,provider_id", ignoreDuplicates: true })
    .select("id");
  failOn(error);
  return (data ?? []).length;
}

/** Retention (section 10): stored job emails are removed after this many days. */
export async function deleteMailMessagesOlderThan(days: number): Promise<number> {
  const { data, error } = await getSupabaseAdminClient()
    .from("mail_messages")
    .delete()
    .lt("received_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .select("id");
  failOn(error);
  return (data ?? []).length;
}

export async function saveCalendarReadAt(id: string, at: string): Promise<void> {
  const { error } = await accounts().update({ calendar_cursor: at } as never).eq("id", id);
  failOn(error);
}

export async function saveSyncProgress(id: string, progress: MailSyncProgress): Promise<void> {
  const { error } = await accounts().update({ sync_progress: progress } as never).eq("id", id);
  failOn(error);
}

/** "sender|time" of messages already stored around these times (moved mail keeps both). */
export async function storedMessageKeys(accountId: string, receivedAts: string[]): Promise<Set<string>> {
  if (receivedAts.length === 0) return new Set();
  const iso = receivedAts.map((t) => new Date(t).toISOString());
  const { data, error } = await getSupabaseAdminClient()
    .from("mail_messages")
    .select("from_email, received_at")
    .eq("account_id", accountId)
    .in("received_at", iso);
  failOn(error);
  return new Set(((data ?? []) as { from_email: string; received_at: string }[]).map((r) => `${r.from_email}|${new Date(r.received_at).toISOString()}`));
}
