import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isMailAccountId } from "@/lib/integrations/accounts-repository";
import { addInterviewToCalendar, recordInterviewOutcome } from "@/lib/interviews/actions";
import { deleteInterview, updateInterview } from "@/lib/interviews/repository";
import { parseInterviewBody } from "@/lib/interviews/validate";
import { getApplicationById } from "@/lib/resume-db/repository";

type RouteContext = { params: Promise<{ id: string }> };

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json(unauthorizedJson(), { status: 401 });
  }
  console.error("Interview error:", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

const notFound = () => NextResponse.json({ error: "Interview not found." }, { status: 404 });

/** Edit. Body: see parseInterviewBody. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return notFound();
    const parsed = parseInterviewBody(await request.json().catch(() => ({})), false);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (parsed.fields.application_id && !(await getApplicationById(parsed.fields.application_id, user.id))) {
      return NextResponse.json({ error: "Application not found." }, { status: 400 });
    }
    // A round chosen here is the user's: the automatic stage order leaves it alone.
    const updated = await updateInterview(user.id, id, parsed.fields.round ? { ...parsed.fields, round_source: "user" } : parsed.fields);
    return updated ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) {
    return failure(error, "Could not save the interview.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return notFound();
    await deleteInterview(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "Could not delete the interview.");
  }
}

/** Body: { do: "calendar" } adds it to the calendar; { do: "outcome", result } records how it went. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return notFound();
    const body = (await request.json().catch(() => ({}))) as { do?: unknown; result?: unknown };
    let outcome;
    if (body.do === "calendar") outcome = await addInterviewToCalendar(user.id, id);
    else if (body.do === "outcome" && (body.result === "passed" || body.result === "waiting" || body.result === "rejected")) {
      outcome = await recordInterviewOutcome(user.id, id, body.result);
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 409 });
  } catch (error) {
    return failure(error, "Could not complete that.");
  }
}
