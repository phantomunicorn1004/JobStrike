import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { listQueuedApplications } from "@/lib/autogen/claim";
import { toAutogenDto } from "@/lib/autogen/dto";
import { autogenRoute } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** GET /api/autogen/applications — queued, generating and failed rows, newest first. */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "list", async (user) => {
    const rows = await listQueuedApplications(user.id);
    return corsJson({ applications: rows.map((row) => toAutogenDto(row)) });
  });
}
