import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { readBidFields } from "@/lib/autobid/claim";
import { autogenRoute, idParam, type IdContext } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * GET /api/autobid/:id/fields — { fields }: every form field of the job's last
 * attempt, with what was entered, where it came from and how filling went.
 */
export async function GET(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "auto-bid fields", async (user) => {
    const id = await idParam(context);
    if (!id) return corsJson({ error: "id is required." }, { status: 400 });
    return corsJson({ fields: await readBidFields(user.id, id) });
  });
}
