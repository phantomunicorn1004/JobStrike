import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { fetchGmailPage } from "@/lib/integrations/google/gmail";
import {
  createMicrosoftSubscription,
  deleteMicrosoftSubscription,
  fetchMicrosoftMailPage,
  renewMicrosoftSubscription,
} from "@/lib/integrations/microsoft/mail";
import { getMailOAuthProvider, MailAuthError, MailThrottledError } from "@/lib/integrations/providers";
import { listIgnoreRules } from "@/lib/mail/inbox-repository";
import { buildCompanyIndex, prefilterMessage, type PrefilterContext } from "@/lib/mail/prefilter";
import {
  claimSync,
  decryptRefreshToken,
  finishSync,
  getSyncAccount,
  insertMailMessages,
  listAppliedCompanies,
  releaseSync,
  requestSync,
  saveAccessTokens,
  saveSubscription,
  saveSubscriptionExpiry,
  saveSyncError,
  saveSyncPosition,
  type SyncAccount,
} from "@/lib/mail/sync-repository";
import { MailCursorExpiredError, type MailSyncProgress } from "@/lib/mail/types";

/** How far back the first scan of a mailbox reads. */
export const INITIAL_SCAN_DAYS = 30;
/** Longer than one run may take (Vercel Hobby stops functions at 60 s). */
const LOCK_SECONDS = 75;
/** A fresh access token is fetched when the stored one has less than this left. */
const TOKEN_MARGIN_MS = 2 * 60_000;
/** At most this many extra passes when new mail arrives during a run. */
const MAX_PASSES = 3;

export type SyncResult = {
  accountId: string;
  outcome: "done" | "partial" | "busy" | "reauth" | "throttled" | "error" | "skipped";
  scanned: number;
  kept: number;
};

/** A working access token, refreshed (and saved, encrypted) when needed. */
export async function accessTokenFor(account: SyncAccount): Promise<string> {
  const expires = account.access_expires_at ? new Date(account.access_expires_at).getTime() : 0;
  if (account.access_token_enc && expires - Date.now() > TOKEN_MARGIN_MS) {
    return decryptSecret(account.access_token_enc);
  }
  const provider = await getMailOAuthProvider(account.provider);
  const fresh = await provider.refreshAccess(decryptRefreshToken(account), account.user_id);
  await saveAccessTokens(account.id, fresh);
  // Later calls in this run use the new token too.
  account.access_token_enc = encryptSecret(fresh.accessToken);
  account.access_expires_at = fresh.accessExpiresAt;
  return fresh.accessToken;
}

function fetchPageFor(account: SyncAccount) {
  return account.provider === "microsoft" ? fetchMicrosoftMailPage : fetchGmailPage;
}

/** Where a new scan starts: 30 days back the first time, otherwise a day before the last sync. */
function scanStart(account: SyncAccount): Date {
  const firstScan = new Date(Date.now() - INITIAL_SCAN_DAYS * 86_400_000);
  if (!account.last_sync_at) return firstScan;
  const resume = new Date(new Date(account.last_sync_at).getTime() - 86_400_000);
  return resume > firstScan ? resume : firstScan;
}

/**
 * Reads new mail of one mailbox until it is up to date or `deadline` (ms timestamp) is near, keeps
 * the job-related messages, and saves its position after every page. Safe to call from several
 * places at once: only one run holds a mailbox; the others ask it to read once more.
 */
export async function syncAccount(accountId: string, deadline: number): Promise<SyncResult> {
  const result: SyncResult = { accountId, outcome: "partial", scanned: 0, kept: 0 };
  if (!(await claimSync(accountId, LOCK_SECONDS))) {
    await requestSync(accountId);
    return { ...result, outcome: "busy" };
  }

  try {
    const account = await getSyncAccount(accountId);
    if (!account || account.status !== "active") return { ...result, outcome: "skipped" };

    const accessToken = await accessTokenFor(account);
    const [companies, ignored] = await Promise.all([
      listAppliedCompanies(account.user_id),
      listIgnoreRules(account.user_id),
    ]);
    const context: PrefilterContext = { accountEmail: account.email, companies: buildCompanyIndex(companies), ignored };
    const fetchPage = fetchPageFor(account);

    let cursor = account.mail_cursor;
    let progress: MailSyncProgress = account.sync_progress ?? {};
    let since = scanStart(account);
    if (!cursor) {
      progress = { phase: "initial", scanned: 0, kept: 0, startedAt: new Date().toISOString() };
    }

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const passStarted = new Date().toISOString();
      let done = false;
      // Leave time to save and answer before the function is stopped.
      while (Date.now() < deadline - 5_000) {
        let page;
        try {
          page = await fetchPage({ accessToken, accountEmail: account.email, cursor, since });
        } catch (error) {
          if (!(error instanceof MailCursorExpiredError) || !cursor) throw error;
          // The stored position is too old: scan again from a day before the last sync.
          cursor = null;
          since = scanStart(account);
          progress = { phase: "initial", scanned: 0, kept: 0, startedAt: new Date().toISOString() };
          continue;
        }

        const kept = page.messages
          .map((message) => ({ message, verdict: prefilterMessage(message, context) }))
          .filter((m) => m.verdict.keep)
          .map((m) => ({ message: m.message, reason: m.verdict.reason }));
        const inserted = await insertMailMessages(account, kept);

        cursor = page.cursor;
        result.scanned += page.messages.length;
        result.kept += inserted;
        progress = {
          ...progress,
          scanned: (progress.scanned ?? 0) + page.messages.length,
          kept: (progress.kept ?? 0) + inserted,
        };
        await saveSyncPosition(account.id, cursor, progress);
        if (page.done) {
          done = true;
          break;
        }
      }
      if (!done) return result;

      progress = { ...progress, phase: "ready", finishedAt: new Date().toISOString() };
      await finishSync(account.id, progress);
      result.outcome = "done";

      // New mail was announced while this pass ran: read once more.
      const latest = await getSyncAccount(account.id);
      if (!latest?.sync_requested_at || latest.sync_requested_at < passStarted) break;
    }
    return result;
  } catch (error) {
    if (error instanceof MailAuthError) {
      await saveSyncError(accountId, error.message, "reauth_required");
      return { ...result, outcome: "reauth" };
    }
    if (error instanceof MailThrottledError) return { ...result, outcome: "throttled" };
    // Only the type of failure is logged: never addresses, subjects or tokens.
    console.error(`Mail sync failed for account ${accountId}:`, error instanceof Error ? error.message : error);
    await saveSyncError(accountId, "The last sync failed; it will try again automatically.").catch(() => {});
    return { ...result, outcome: "error" };
  } finally {
    await releaseSync(accountId).catch(() => {});
  }
}

// --- Live updates (Microsoft change notifications) ---------------------------------------------

/** Public https address Microsoft can reach; none on a developer's machine. */
export function liveUpdatesUrl(): string | null {
  // Vercel sets VERCEL_PROJECT_PRODUCTION_URL ("job-strike.vercel.app") on its own.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || (vercel ? `https://${vercel}` : "")).replace(/\/+$/, "");
  return base?.startsWith("https://") ? `${base}/api/integrations/mail/webhook/microsoft` : null;
}

export function hashClientState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Renew within a day of expiry, or create when missing. */
const RENEW_WITHIN_MS = 24 * 3_600_000;

/** Makes sure a Microsoft mailbox gets change notifications. Returns false when not possible here. */
export async function ensureLiveUpdates(account: SyncAccount): Promise<boolean> {
  const url = liveUpdatesUrl();
  if (account.provider !== "microsoft" || account.status !== "active" || !url) return false;

  const expires = account.subscription_expires_at ? new Date(account.subscription_expires_at).getTime() : 0;
  if (account.subscription_id && expires - Date.now() > RENEW_WITHIN_MS) return true;

  const accessToken = await accessTokenFor(account);
  if (account.subscription_id) {
    const renewed = await renewMicrosoftSubscription(accessToken, account.subscription_id);
    if (renewed) {
      await saveSubscriptionExpiry(account.id, renewed);
      return true;
    }
  }
  const clientState = randomBytes(24).toString("base64url");
  const created = await createMicrosoftSubscription(accessToken, url, clientState);
  await saveSubscription(account.id, { id: created.id, expiresAt: created.expiresAt, secretHash: hashClientState(clientState) });
  return true;
}

/** Ends change notifications (on disconnect). Best effort. */
export async function stopLiveUpdates(account: SyncAccount): Promise<void> {
  if (account.provider !== "microsoft" || !account.subscription_id) return;
  try {
    await deleteMicrosoftSubscription(await accessTokenFor(account), account.subscription_id);
  } catch {
    // Unreachable or already gone; it expires within three days anyway.
  }
}
