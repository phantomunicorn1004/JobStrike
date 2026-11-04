import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { claimNextBid, countSentSince } from "@/lib/autobid/claim";
import { readAutobidConfig } from "@/lib/autobid/config";
import { autogenRoute } from "@/lib/autogen/route";
import { startOfDayUtcIso, todayInTimeZone } from "@/lib/timezone";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autobid/next — claims the freshest job whose resume is generated
 * and that was never sent or attempted: { job } with its resume JSON and the
 * claim, or { job: null, reason? } when there is nothing to apply to, or the
 * day's limit (on the user's clock) is reached. Every panel obeys the same limit.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid next", async (user) => {
    const dayStart = startOfDayUtcIso(todayInTimeZone(user.timezone), user.timezone);
    const [config, sentToday] = await Promise.all([readAutobidConfig(user.id), countSentSince(user.id, dayStart)]);
    if (sentToday >= config.dailyLimit) {
      return corsJson({ job: null, reason: `Daily limit reached: ${sentToday} of ${config.dailyLimit} sent today.` });
    }
    return corsJson({ job: await claimNextBid(user.id) });
  });
}
