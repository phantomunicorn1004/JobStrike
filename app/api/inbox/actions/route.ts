import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { applyAllSuggestions } from "@/lib/mail/actions";

export const maxDuration = 60;

/** Body: { do: "apply-all" }. Applies suggestions for ~45 s; the page calls again while some remain. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => ({}))) as { do?: unknown };
    if (body.do !== "apply-all") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json(await applyAllSuggestions(user.id, Date.now() + 50_000));
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Apply all suggestions failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not apply the suggestions." }, { status: 500 });
  }
}
