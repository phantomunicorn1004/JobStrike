import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId } from "@/lib/integrations/accounts-repository";
import { getGoogleMessageText } from "@/lib/integrations/google/calendar";
import { getMicrosoftMessageText } from "@/lib/integrations/microsoft/calendar";
import { MailAuthError } from "@/lib/integrations/providers";
import { accessTokenFor } from "@/lib/mail/sync";
import { getSyncAccount } from "@/lib/mail/sync-repository";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

/** Longest text shown in the reading pane. */
const MAX_TEXT = 60_000;

/**
 * The reading pane: the email's full text, read live from the mailbox as plain text (no HTML,
 * so nothing in it can run). Not stored; the browser may keep it for a few minutes.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return NextResponse.json({ error: "Email not found." }, { status: 404 });

    const { data } = await getSupabaseAdminClient()
      .from("mail_messages")
      .select("account_id, provider_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    const message = data as { account_id: string; provider_id: string } | null;
    if (!message) return NextResponse.json({ error: "Email not found." }, { status: 404 });

    const account = await getSyncAccount(message.account_id);
    if (!account || account.status !== "active") {
      return NextResponse.json({ error: "Reconnect this mailbox in Settings to read the email here." }, { status: 409 });
    }
    const token = await accessTokenFor(account);
    const text =
      account.provider === "microsoft"
        ? await getMicrosoftMessageText(token, message.provider_id)
        : await getGoogleMessageText(token, message.provider_id);

    const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
    return NextResponse.json({ text: clean }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    if (error instanceof MailAuthError) return NextResponse.json({ error: error.message }, { status: 409 });
    // Deleted in the mailbox, or the provider is unreachable.
    console.error("Reading pane failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The email could not be loaded. Open it in your mailbox instead." }, { status: 502 });
  }
}
