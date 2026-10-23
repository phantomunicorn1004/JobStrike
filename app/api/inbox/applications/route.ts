import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import type { InboxApplication } from "@/lib/mail/categories";
import { applicationEmailStatus } from "@/lib/mail/inbox-repository";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * GET ?q=&profileId=   → applications to link an email to (company or title contains q).
 * GET ?statusFor=1,2,3 → per application: confirmation date and latest email (Resume DB rows).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const params = request.nextUrl.searchParams;

    const statusFor = params.get("statusFor");
    if (statusFor !== null) {
      const ids = statusFor
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 300);
      const statuses = await applicationEmailStatus(user.id, ids).catch(() => ({}));
      return NextResponse.json({ statuses });
    }

    const q = (params.get("q") ?? "").replace(/[,()%*\\"]/g, " ").trim().slice(0, 80);
    const profileId = Number(params.get("profileId"));
    let query = getSupabaseAdminClient()
      .from("resume_db_applications")
      .select("id, company, job_title, candidate_name, job_link, applied_at")
      .eq("user_id", user.id);
    if (Number.isInteger(profileId) && profileId > 0) query = query.eq("profile_id", profileId);
    if (q) query = query.or(`company.ilike.*${q}*,job_title.ilike.*${q}*`);
    const { data, error } = await query.order("applied_at", { ascending: false }).limit(25);
    if (error) throw new Error(error.message);

    const applications: InboxApplication[] = (
      (data ?? []) as { id: number; company: string | null; job_title: string | null; candidate_name: string | null; job_link: string | null; applied_at: string }[]
    ).map((a) => ({
      id: a.id,
      company: a.company ?? "",
      jobTitle: a.job_title ?? "",
      candidateName: a.candidate_name ?? "",
      jobLink: a.job_link ?? "",
      appliedAt: a.applied_at,
    }));
    return NextResponse.json({ applications });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Inbox applications error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load applications." }, { status: 500 });
  }
}
