import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { INTERVIEW_STAGES, type InterviewStage } from "@/lib/interviews/types";
import { listApplicationResponses } from "@/lib/mail/application-status";
import type { ResponseStatus, ResponsesResponse } from "@/lib/mail/response-types";

const PAGE_SIZE = 100;
const STATUSES: ResponseStatus[] = ["not_responded", "interviewing", "rejected", "offer"];

/**
 * GET ?status=not_responded|interviewing|rejected|offer &stage= &profileId= &q= &offset=
 * Application statuses from emails; the summary always covers all tracked applications.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const params = request.nextUrl.searchParams;
    const profileId = Number(params.get("profileId"));
    const status = STATUSES.includes(params.get("status") as ResponseStatus) ? (params.get("status") as ResponseStatus) : null;
    const stage = INTERVIEW_STAGES.includes(params.get("stage") as InterviewStage) ? (params.get("stage") as InterviewStage) : null;
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const offset = Math.max(0, Number(params.get("offset")) || 0);

    const { items, summary, trackingSince } = await listApplicationResponses(user.id, {
      profileId: Number.isInteger(profileId) && profileId > 0 ? profileId : null,
    });
    const filtered = items.filter(
      (i) =>
        (!status || i.status === status) &&
        (!stage || i.stage === stage) &&
        (!q || `${i.company} ${i.jobTitle} ${i.candidateName}`.toLowerCase().includes(q)),
    );
    const body: ResponsesResponse = {
      summary,
      items: filtered.slice(offset, offset + PAGE_SIZE),
      hasMore: filtered.length > offset + PAGE_SIZE,
      trackingSince,
    };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    if (error instanceof MailSetupRequiredError) {
      return NextResponse.json({ error: error.message, setupRequired: true }, { status: 409 });
    }
    console.error("Responses error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load application statuses." }, { status: 500 });
  }
}
