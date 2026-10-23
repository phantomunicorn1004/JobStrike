import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import type { ActivityEntry } from "@/lib/mail/categories";
import { listPipelineEvents } from "@/lib/pipeline-events/repository";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 50;

/** GET ?before= : board moves, newest first, with their application. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const before = request.nextUrl.searchParams.get("before");
    const page = await listPipelineEvents(user.id, {
      before: before && !Number.isNaN(Date.parse(before)) ? before : null,
      limit: PAGE_SIZE,
    });

    const appIds = [...new Set(page.events.map((e) => e.applicationId))];
    const { data } = appIds.length
      ? await getSupabaseAdminClient()
          .from("resume_db_applications")
          .select("id, company, job_title, candidate_name")
          .eq("user_id", user.id)
          .in("id", appIds)
      : { data: [] };
    const apps = new Map(
      ((data ?? []) as { id: number; company: string | null; job_title: string | null; candidate_name: string | null }[]).map((a) => [
        a.id,
        { id: a.id, company: a.company ?? "", jobTitle: a.job_title ?? "", candidateName: a.candidate_name ?? "" },
      ]),
    );

    const entries: ActivityEntry[] = page.events.map((e) => ({
      id: e.id,
      at: e.at,
      fromStage: e.fromStage,
      toStage: e.toStage,
      source: e.source,
      reason: e.reason,
      undone: Boolean(e.undoneAt),
      application: apps.get(e.applicationId) ?? null,
    }));
    return NextResponse.json({ entries, hasMore: page.hasMore });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Activity error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the activity." }, { status: 500 });
  }
}
