import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId } from "@/lib/integrations/accounts-repository";
import { applySuggestion, dismissSuggestion, undoPipelineEvent } from "@/lib/mail/actions";
import { getInboxItem } from "@/lib/mail/inbox-repository";

type RouteContext = { params: Promise<{ id: string }> };

/** Body: { do: "apply" | "dismiss" | "undo" } for this email's board move. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return NextResponse.json({ error: "Email not found." }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { do?: unknown };

    let outcome = { ok: true, message: "" };
    if (body.do === "apply") outcome = await applySuggestion(user.id, id);
    else if (body.do === "dismiss") await dismissSuggestion(user.id, id);
    else if (body.do === "undo") {
      const item = await getInboxItem(user.id, id);
      const eventId = item?.action?.eventId;
      outcome = eventId ? await undoPipelineEvent(user.id, eventId) : { ok: false, message: "There is nothing to undo." };
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const item = await getInboxItem(user.id, id);
    return NextResponse.json({ ...outcome, item }, { status: outcome.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Inbox action error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not update the board." }, { status: 500 });
  }
}
