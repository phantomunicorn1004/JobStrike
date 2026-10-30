import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { listAutobidJobs } from "@/lib/autobid/claim";
import { autogenRoute } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/** GET /api/autobid/jobs — { jobs }: the jobs in the automatic chain with each step's time, for the Auto-bid page. */
export async function GET(request: NextRequest) {
  return autogenRoute(request, "auto-bid jobs", async (user) => corsJson({ jobs: await listAutobidJobs(user.id) }));
}
