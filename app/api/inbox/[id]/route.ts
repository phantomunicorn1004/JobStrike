import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId, MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { INTERVIEW_STAGES, type InterviewStage } from "@/lib/interviews/types";
import { applyPendingActions } from "@/lib/mail/actions";
import { APPLICATION_CATEGORIES, parseMailCategory } from "@/lib/mail/categories";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getInboxItem, ignoreSender, updateInboxItem } from "@/lib/mail/inbox-repository";
import { getApplicationById } from "@/lib/resume-db/repository";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Corrections. Body: { category?, interviewStage?, applicationId?: number | null, ignoreSender?: true }.
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

    // The interview stage: it also makes the email an interview (or keeps it an assessment),
    // renames the round of the interview it created, and redoes its board suggestion.
    let restage = false;
    if (body.interviewStage !== undefined) {
      if (!INTERVIEW_STAGES.includes(body.interviewStage as InterviewStage)) {
        return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
      }
      const stage = body.interviewStage as InterviewStage;
      const db = getSupabaseAdminClient();
      const { data: row } = await db.from("mail_messages").select("extracted, action_status").eq("id", id).eq("user_id", user.id).maybeSingle();
      const current = row as { extracted: Record<string, unknown> | null; action_status: string } | null;
      patch.extracted = { ...(current?.extracted ?? {}), interviewStage: stage };
      patch.category_source = "user";
      const category = (patch.category as string | undefined) ?? item.category;
      if (category !== "interview" && category !== "assessment") patch.category = "interview";
      if (current?.action_status !== "applied") {
        Object.assign(patch, { action: null, action_status: "none", action_checked_at: null });
        restage = true;
      }
      const roundUpdate = await db
        .from("interviews")
        .update({ round: stage, round_source: "user" } as never)
        .eq("user_id", user.id)
        .eq("source_ref", id);
      if (roundUpdate.error) {
        // Before the round_source column exists.
        await db.from("interviews").update({ round: stage } as never).eq("user_id", user.id).eq("source_ref", id);
      }
    }

    if (body.ignoreSender === true) {
      alsoIgnored = await ignoreSender(user.id, item.fromEmail);
    }

    let updated = Object.keys(patch).length > 0 ? await updateInboxItem(user.id, id, patch) : await getInboxItem(user.id, id);
    if (restage) {
      // The suggestion for the new stage, right away.
      await applyPendingActions(user.id, Date.now() + 15_000).catch(() => undefined);
      updated = await getInboxItem(user.id, id);
    }
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
