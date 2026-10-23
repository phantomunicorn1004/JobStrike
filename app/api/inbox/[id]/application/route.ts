import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId } from "@/lib/integrations/accounts-repository";
import { getInboxItem, updateInboxItem } from "@/lib/mail/inbox-repository";
import { createApplication, getProfileById } from "@/lib/resume-db/repository";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * "Add to Resume DB": an application confirmed by email but never registered. Body (optional):
 * { company?, jobTitle? } to correct what the email said. Applied date = the email's date.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return NextResponse.json({ error: "Email not found." }, { status: 404 });
    const item = await getInboxItem(user.id, id);
    if (!item) return NextResponse.json({ error: "Email not found." }, { status: 404 });
    if (item.application) return NextResponse.json({ error: "This email is already linked to an application." }, { status: 409 });

    const body = (await request.json().catch(() => ({}))) as { company?: unknown; jobTitle?: unknown };
    const company = (typeof body.company === "string" ? body.company : item.company ?? "").trim();
    const jobTitle = (typeof body.jobTitle === "string" ? body.jobTitle : item.jobTitle ?? "").trim();
    if (!company) return NextResponse.json({ error: "Enter the company first." }, { status: 400 });

    const profile = item.profileId !== null ? await getProfileById(user.id, item.profileId) : null;
    const created = await createApplication(user.id, {
      entryId: randomUUID(),
      profileId: profile?.id ?? null,
      candidateName: profile?.full_name ?? "",
      jobLink: "",
      jobTitle,
      company,
      note: "Added from a confirmation email",
      resumeUrl: "",
    });
    // Applied when the confirmation came, not now.
    await getSupabaseAdminClient()
      .from("resume_db_applications")
      .update({ applied_at: item.receivedAt } as never)
      .eq("id", created.id)
      .eq("user_id", user.id);

    const updated = await updateInboxItem(user.id, id, {
      application_id: created.id,
      match_score: 1,
      match_reason: "Added to Resume DB from this email",
      link_source: "user",
    });
    return NextResponse.json({ item: updated, applicationId: created.id });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Add to Resume DB from email failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not add the application." }, { status: 500 });
  }
}
