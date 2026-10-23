import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { writableCalendars } from "@/lib/interviews/actions";
import { insertInterview, listInterviews, nextInterviewByApplication } from "@/lib/interviews/repository";
import { parseInterviewBody } from "@/lib/interviews/validate";
import type { InterviewsResponse } from "@/lib/interviews/types";
import { listProfiles, getApplicationById } from "@/lib/resume-db/repository";
import { normalizeTimeZone } from "@/lib/timezone";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json(unauthorizedJson(), { status: 401 });
  }
  if (error instanceof MailSetupRequiredError) {
    return NextResponse.json({ error: error.message, setupRequired: true }, { status: 409 });
  }
  console.error("Interviews error:", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * GET              → interviews from 60 days back on (Calendar page).
 * GET ?next=1      → next interview per application (board cards).
 * GET ?upcoming=1  → scheduled interviews from now on (Interview Assistant).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const params = request.nextUrl.searchParams;
    if (params.get("next") === "1") {
      return NextResponse.json({ next: await nextInterviewByApplication(user.id) });
    }

    const upcoming = params.get("upcoming") === "1";
    const from = new Date(Date.now() - (upcoming ? 2 * 3_600_000 : 60 * 86_400_000)).toISOString();
    const [interviews, calendars, profiles] = await Promise.all([
      listInterviews(user.id, { from }),
      writableCalendars(user.id).catch(() => []),
      listProfiles(user.id),
    ]);
    const body: InterviewsResponse = {
      interviews: upcoming ? interviews.filter((i) => i.status === "scheduled") : interviews,
      timezone: normalizeTimeZone(user.timezone),
      canAddToCalendar: calendars.length > 0,
      profiles: profiles.map((p) => ({ id: p.id, fullName: p.full_name })),
    };
    return NextResponse.json(body);
  } catch (error) {
    return failure(error, "Could not load interviews.");
  }
}

/** Adds an interview by hand. Body: see parseInterviewBody (startsAt required). */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const parsed = parseInterviewBody(await request.json().catch(() => ({})), true);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (parsed.fields.application_id) {
      const app = await getApplicationById(parsed.fields.application_id, user.id);
      if (!app) return NextResponse.json({ error: "Application not found." }, { status: 400 });
    }
    const created = await insertInterview(user.id, {
      ...parsed.fields,
      starts_at: parsed.fields.starts_at!,
      source: "manual",
      status: parsed.fields.status ?? "scheduled",
    });
    return NextResponse.json({ id: created.id });
  } catch (error) {
    return failure(error, "Could not add the interview.");
  }
}
