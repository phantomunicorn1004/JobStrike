import { timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { findAccountBySubscription, saveSubscription, type SyncAccount } from "@/lib/mail/sync-repository";
import { ensureLiveUpdates, hashClientState, syncAccount } from "@/lib/mail/sync";

export const maxDuration = 60;

type Notification = {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  /** Set on lifecycle notifications: reauthorizationRequired, subscriptionRemoved, missed. */
  lifecycleEvent?: string;
};

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Microsoft change notifications for connected Outlook mailboxes. Microsoft first checks the
 * address (validationToken), then posts "new message" and lifecycle events. Each one must carry
 * the secret clientState of its subscription. The answer must come within 3 seconds, so the sync
 * itself runs after the response.
 */
export async function POST(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  if (validationToken !== null) {
    return new NextResponse(validationToken, { headers: { "Content-Type": "text/plain" } });
  }

  const body = (await request.json().catch(() => null)) as { value?: Notification[] } | null;
  const notifications = Array.isArray(body?.value) ? body.value : [];

  const toSync = new Set<string>();
  /** Lifecycle events: the subscription must be renewed ("reauthorizationRequired") or replaced. */
  const toRenew = new Map<string, { account: SyncAccount; removed: boolean }>();
  for (const n of notifications) {
    if (!n.subscriptionId || !n.clientState) continue;
    const account = await findAccountBySubscription(n.subscriptionId).catch(() => null);
    if (!account?.subscription_secret_hash || account.status !== "active") continue;
    if (!sameHash(hashClientState(n.clientState), account.subscription_secret_hash)) continue;

    if (n.lifecycleEvent === "reauthorizationRequired" || n.lifecycleEvent === "subscriptionRemoved") {
      toRenew.set(account.id, { account, removed: n.lifecycleEvent === "subscriptionRemoved" });
    }
    // New mail, or "missed" (notifications were dropped): read the mailbox.
    toSync.add(account.id);
  }

  if (toSync.size > 0) {
    after(async () => {
      const deadline = Date.now() + 50_000;
      for (const [id, { account, removed }] of toRenew) {
        try {
          if (removed) await saveSubscription(id, null);
          // Treat the subscription as expiring, so it is renewed now (or created when removed).
          await ensureLiveUpdates({
            ...account,
            subscription_id: removed ? null : account.subscription_id,
            subscription_expires_at: null,
          });
        } catch (error) {
          console.warn(`Renewing live updates for account ${id} failed:`, error instanceof Error ? error.message : error);
        }
      }
      for (const id of toSync) {
        if (Date.now() > deadline - 10_000) break;
        await syncAccount(id, deadline);
      }
    });
  }
  return new NextResponse(null, { status: 202 });
}
