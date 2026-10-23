import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { deleteMailMessagesOlderThan, listActiveSyncAccounts } from "@/lib/mail/sync-repository";
import { ensureLiveUpdates, syncAccount, type SyncResult } from "@/lib/mail/sync";

export const maxDuration = 60;

/** A mailbox is due when it was not synced for this long (change notifications cover the rest). */
const DUE_AFTER_MS = 8 * 60_000;
/** Stored job emails are removed after this many days (section 10). */
const RETENTION_DAYS = 180;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || !given) return false;
  // Compare digests: equal length, constant time.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Called every 10 minutes by Supabase pg_cron (scripts/schedule-mail-sync.sql): keeps change
 * notifications alive, syncs mailboxes that are due, and removes old job emails.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deadline = Date.now() + 50_000;
  try {
    const accounts = await listActiveSyncAccounts();

    let liveUpdates = 0;
    for (const account of accounts) {
      if (Date.now() > deadline - 20_000) break;
      try {
        if (await ensureLiveUpdates(account)) liveUpdates++;
      } catch (error) {
        console.warn(`Live updates for account ${account.id} failed:`, error instanceof Error ? error.message : error);
      }
    }

    const results: SyncResult[] = [];
    const now = Date.now();
    for (const account of accounts) {
      if (Date.now() > deadline - 10_000) break;
      const due =
        !account.last_sync_at ||
        account.sync_progress?.phase === "initial" ||
        now - new Date(account.last_sync_at).getTime() > DUE_AFTER_MS ||
        (account.sync_requested_at !== null && account.sync_requested_at > account.last_sync_at);
      if (due) results.push(await syncAccount(account.id, deadline));
    }

    const removed = await deleteMailMessagesOlderThan(RETENTION_DAYS);
    return NextResponse.json({ ok: true, accounts: accounts.length, liveUpdates, synced: results, removed });
  } catch (error) {
    if (error instanceof MailSetupRequiredError) return NextResponse.json({ ok: true, setupRequired: true });
    console.error("Mail cron failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Mail sync failed." }, { status: 500 });
  }
}
