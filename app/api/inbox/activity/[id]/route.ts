import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { undoPipelineEvent } from "@/lib/mail/actions";

type RouteContext = { params: Promise<{ id: string }> };

/** POST: undo this board move. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Change not found." }, { status: 404 });
    const outcome = await undoPipelineEvent(user.id, id);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Undo failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not undo the change." }, { status: 500 });
  }
}
