import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { countPendingMessages } from "@/lib/mail/inbox-repository";
import { processPendingMessages } from "@/lib/mail/process";

export const maxDuration = 60;

/** Sorts the user's waiting emails for up to ~45 s; the Inbox page calls it while some remain. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const result = await processPendingMessages(user.id, Date.now() + 50_000);
    const remaining = await countPendingMessages(user.id).catch(() => 0);
    return NextResponse.json({ ...result, remaining });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Inbox sorting error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Sorting failed; it will continue automatically." }, { status: 500 });
  }
}
