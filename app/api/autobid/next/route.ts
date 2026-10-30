import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { claimNextBid } from "@/lib/autobid/claim";
import { autogenRoute } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autobid/next — claims the oldest job whose resume is generated and
 * that was never sent or attempted: { job } with its resume JSON and the claim,
 * or { job: null } when there is nothing to apply to.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid next", async (user) => {
    return corsJson({ job: await claimNextBid(user.id) });
  });
}
