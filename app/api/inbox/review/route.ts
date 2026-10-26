import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId } from "@/lib/integrations/accounts-repository";
import { getInboxItem } from "@/lib/mail/inbox-repository";
import type { InboxItem } from "@/lib/mail/categories";
import type { ReviewStats } from "@/lib/mail/response-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Emails per review session, and how many of each kind. */
const SESSION = 30;
const QUOTAS: [string[], number][] = [
  [["interview", "assessment"], 9],
  [["rejection"], 7],
  [["offer", "update", "other", "outreach"], 5],
  [["not_job"], 5],
  [["confirmation"], 4],
];


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
        .select("id, category")
        .eq("user_id", user.id)
        .eq("category_source", "ai")
        .neq("category", "unclassified")
        .order("received_at", { ascending: false })
        .limit(3000),
      db.from("mail_reviews").select("message_id").eq("user_id", user.id).limit(5000),
      stats(user.id),
    ]);
    const reviewed = new Set(((reviewedRes.data ?? []) as { message_id: string }[]).map((r) => r.message_id));
    const pool = ((candidates ?? []) as { id: string; category: string }[]).filter((c) => !reviewed.has(c.id));
    const shuffle = <T,>(list: T[]) => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    };
    // Weighted towards what decides a status; "application received" is most mail but matters least.
    const picked: string[] = [];
    for (const [categories, quota] of QUOTAS) {
      picked.push(...shuffle(pool.filter((c) => categories.includes(c.category))).slice(0, quota).map((c) => c.id));
    }
    // Fill up from the rest when a group has too few.
    const rest = shuffle(pool.filter((c) => !picked.includes(c.id)));
    while (picked.length < SESSION && rest.length) picked.push(rest.pop()!.id);
    const items = (await Promise.all(shuffle(picked).map((id) => getInboxItem(user.id, id)))).filter(
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
