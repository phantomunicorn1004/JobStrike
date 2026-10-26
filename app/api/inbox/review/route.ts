import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId } from "@/lib/integrations/accounts-repository";
import { getInboxItem } from "@/lib/mail/inbox-repository";
import type { InboxItem } from "@/lib/mail/categories";
import type { ReviewStats } from "@/lib/mail/response-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Emails per review session. */
const SESSION = 30;


async function stats(userId: string): Promise<ReviewStats | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("mail_reviews")
    .select("type_ok, stage_ok, link_ok")
    .eq("user_id", userId)
    .limit(5000);
  if (error) return null;
  const rows = (data ?? []) as { type_ok: boolean; stage_ok: boolean | null; link_ok: boolean | null }[];
  const share = (values: (boolean | null)[]) => {
    const known = values.filter((v): v is boolean => v !== null);
    return known.length ? known.filter(Boolean).length / known.length : null;
  };
  return {
    reviewed: rows.length,
    type: share(rows.map((r) => r.type_ok)),
    stage: share(rows.map((r) => r.stage_ok)),
    link: share(rows.map((r) => r.link_ok)),
  };
}

/** GET: a random sample of emails the AI handled and the user has not reviewed, plus the scores. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const db = getSupabaseAdminClient();
    const [{ data: candidates }, reviewedRes, score] = await Promise.all([
      db
        .from("mail_messages")
        .select("id")
        .eq("user_id", user.id)
        .eq("category_source", "ai")
        .neq("category", "unclassified")
        .order("received_at", { ascending: false })
        .limit(3000),
      db.from("mail_reviews").select("message_id").eq("user_id", user.id).limit(5000),
      stats(user.id),
    ]);
    const reviewed = new Set(((reviewedRes.data ?? []) as { message_id: string }[]).map((r) => r.message_id));
    const pool = ((candidates ?? []) as { id: string }[]).map((c) => c.id).filter((id) => !reviewed.has(id));
    // A fair random sample (Fisher–Yates on the first SESSION places).
    for (let i = 0; i < Math.min(SESSION, pool.length); i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const items = (await Promise.all(pool.slice(0, SESSION).map((id) => getInboxItem(user.id, id)))).filter(
      (i): i is InboxItem => i !== null,
    );
    return NextResponse.json({ items, stats: score, setupRequired: score === null });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Review sample error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load emails to review." }, { status: 500 });
  }
}

/** POST { messageId, typeOk, stageOk?, linkOk? }: the user's verdict (fixes are saved separately). */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const messageId = String(body.messageId ?? "");
    if (!isMailAccountId(messageId) || typeof body.typeOk !== "boolean") {
      return NextResponse.json({ error: "Invalid review." }, { status: 400 });
    }
    const asFlag = (v: unknown) => (typeof v === "boolean" ? v : null);
    const { error } = await getSupabaseAdminClient()
      .from("mail_reviews")
      .upsert(
        {
          message_id: messageId,
          user_id: user.id,
          type_ok: body.typeOk,
          stage_ok: asFlag(body.stageOk),
          link_ok: asFlag(body.linkOk),
          reviewed_at: new Date().toISOString(),
        } as never,
        { onConflict: "message_id" },
      );
    if (error) {
      return NextResponse.json({ error: "Run scripts/add-mail-calendar-integration.sql in Supabase first." }, { status: 409 });
    }
    return NextResponse.json({ stats: await stats(user.id) });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Review save error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not save the review." }, { status: 500 });
  }
}
