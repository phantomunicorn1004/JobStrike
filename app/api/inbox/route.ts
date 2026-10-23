import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { listMailAccounts, MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { INBOX_VIEWS, type InboxResponse, type InboxView } from "@/lib/mail/categories";
import {
  accountIdsForProfile,
  countInboxViews,
  countPendingMessages,
  listInboxItems,
} from "@/lib/mail/inbox-repository";
import { listProfiles } from "@/lib/resume-db/repository";

const PAGE_SIZE = 40;

/** GET ?view=inbox|review|interviews|rejections|applied|unmatched|all &profileId= &q= &before= */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const params = request.nextUrl.searchParams;
    const view = (INBOX_VIEWS as readonly string[]).includes(params.get("view") ?? "")
      ? (params.get("view") as InboxView)
      : "inbox";
    const profileId = Number(params.get("profileId"));
    const filters = {
      accountIds: Number.isInteger(profileId) && profileId > 0 ? await accountIdsForProfile(user.id, profileId) : null,
      search: (params.get("q") ?? "").slice(0, 100),
    };
    const before = params.get("before");

    const [accounts, profiles, page, counts, pending] = await Promise.all([
      listMailAccounts(user.id),
      listProfiles(user.id),
      listInboxItems(user.id, view, filters, { before: before && !Number.isNaN(Date.parse(before)) ? before : null, limit: PAGE_SIZE }),
      countInboxViews(user.id, INBOX_VIEWS, filters),
      countPendingMessages(user.id),
    ]);

    const body: InboxResponse = {
      items: page.items,
      hasMore: page.hasMore,
      counts,
      pending,
      hasMailbox: accounts.length > 0,
      profiles: profiles.map((p) => ({ id: p.id, fullName: p.full_name })),
    };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    if (error instanceof MailSetupRequiredError) {
      return NextResponse.json({ error: error.message, setupRequired: true }, { status: 409 });
    }
    console.error("Inbox error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the inbox." }, { status: 500 });
  }
}
