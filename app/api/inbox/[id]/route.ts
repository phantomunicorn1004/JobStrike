import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId, MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { APPLICATION_CATEGORIES, parseMailCategory } from "@/lib/mail/categories";
import { getInboxItem, ignoreSender, updateInboxItem } from "@/lib/mail/inbox-repository";
import { getApplicationById } from "@/lib/resume-db/repository";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Corrections. Body: { category?, applicationId?: number | null, ignoreSender?: true }.
 * What the user sets is kept (category_source / link_source = user) and teaches later sorting.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return NextResponse.json({ error: "Email not found." }, { status: 404 });
    const item = await getInboxItem(user.id, id);
    if (!item) return NextResponse.json({ error: "Email not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let alsoIgnored = 0;

    if (body.category !== undefined) {
      const category = parseMailCategory(body.category);
      if (!category) return NextResponse.json({ error: "Unknown type." }, { status: 400 });
      patch.category = category;
      patch.category_source = "user";
      if (!APPLICATION_CATEGORIES.includes(category)) {
        Object.assign(patch, { application_id: null, match_score: null, match_reason: null });
      }
    }

    if (body.applicationId !== undefined) {
      if (body.applicationId === null) {
        Object.assign(patch, { application_id: null, match_score: null, match_reason: "Unlinked by you", link_source: "user" });
      } else {
        const appId = Number(body.applicationId);
        const app = Number.isInteger(appId) ? await getApplicationById(appId, user.id) : null;
        if (!app) return NextResponse.json({ error: "Application not found." }, { status: 400 });
        Object.assign(patch, { application_id: app.id, match_score: 1, match_reason: "Linked by you", link_source: "user" });
      }
    }

    if (body.ignoreSender === true) {
      alsoIgnored = await ignoreSender(user.id, item.fromEmail);
    }

    const updated = Object.keys(patch).length > 0 ? await updateInboxItem(user.id, id, patch) : await getInboxItem(user.id, id);
    return NextResponse.json({ item: updated, alsoIgnored });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    if (error instanceof MailSetupRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Inbox update error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
  }
}
