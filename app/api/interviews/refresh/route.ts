import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { extractInterviewsFromEmails, syncUserCalendars } from "@/lib/interviews/process";

export const maxDuration = 60;

/** The Calendar page's Refresh: reads the calendars now, then any interview emails not read yet. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const deadline = Date.now() + 50_000;
    await syncUserCalendars(user.id);
    const emails = await extractInterviewsFromEmails(user.id, deadline);
    return NextResponse.json({ ok: true, emails });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Interview refresh failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not refresh." }, { status: 500 });
  }
}
