import { after, NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId, MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { listActiveSyncAccounts } from "@/lib/mail/sync-repository";
import { processPendingMessages } from "@/lib/mail/process";
import { ensureLiveUpdates, syncAccount, type SyncResult } from "@/lib/mail/sync";
import type { SyncAccount } from "@/lib/mail/sync-repository";

export const maxDuration = 60;

/** Live updates renew here too, so they do not depend on the timer alone (no-op until due). */
async function keepLive(account: SyncAccount) {
  try {
    await ensureLiveUpdates(account);
  } catch (error) {
    console.warn(`Live updates for account ${account.id} failed:`, error instanceof Error ? error.message : error);
  }
}

/** "Sync on open" skips mailboxes synced more recently than this. */
const AUTO_AFTER_MS = 3 * 60_000;

/**
 * Body: { accountId?: string, auto?: boolean }.
 * - Sync now (no `auto`): syncs the user's mailboxes (or one) within this request and reports.
 * - Sync on open (`auto: true`): answers at once and syncs stale mailboxes in the background.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => ({}))) as { accountId?: unknown; auto?: unknown };
    const accountId = typeof body.accountId === "string" ? body.accountId : null;
    if (accountId && !isMailAccountId(accountId)) {
      return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
    }

    let accounts = await listActiveSyncAccounts(user.id);
    if (accountId) accounts = accounts.filter((a) => a.id === accountId);

    if (body.auto === true) {
      const stale = accounts.filter(
        (a) =>
          !a.last_sync_at ||
          a.sync_progress?.phase === "initial" ||
          Date.now() - new Date(a.last_sync_at).getTime() > AUTO_AFTER_MS,
      );
      if (stale.length > 0) {
        after(async () => {
          const deadline = Date.now() + 50_000;
          for (const account of stale) {
            if (Date.now() > deadline - 10_000) break;
            await keepLive(account);
            await syncAccount(account.id, deadline);
          }
          await processPendingMessages(user.id, deadline);
        });
      }
      return NextResponse.json({ started: stale.length });
    }

    const deadline = Date.now() + 45_000;
    const results: SyncResult[] = [];
    for (const account of accounts) {
      if (Date.now() > deadline - 10_000) break;
      await keepLive(account);
      results.push(await syncAccount(account.id, deadline));
    }
    const sorted = await processPendingMessages(user.id, deadline);
    return NextResponse.json({ results, sorted });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    if (error instanceof MailSetupRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Mail sync request failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Sync failed. Please try again." }, { status: 500 });
  }
}
