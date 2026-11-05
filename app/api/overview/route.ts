import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { countAutobidGroups } from "@/lib/autobid/claim";
import { listInterviews } from "@/lib/interviews/repository";
import { countInboxViews } from "@/lib/mail/inbox-repository";

export type OverviewResponse = {
  /** Auto-bid jobs waiting for you. */
  autobidAttention: number;
  autobidActive: number;
  /** Emails in the Inbox "attention" view. */
  inboxAttention: number;
  /** Scheduled interviews in the next 7 days, soonest first (at most 5). */
  upcoming: Array<{ id: string; company: string; jobTitle: string; startsAt: string; meetingUrl: string | null; candidate: string }>;
  interviewsNext24h: number;
};

/** GET /api/overview — the counts behind the sidebar badges and the Today panel. Each part fails soft to 0. */
export async function GET(request: NextRequest) {
  let user;
  try {
    user = await requireRequestUser(request);
  } catch {
    return NextResponse.json(unauthorizedJson(), { status: 401 });
  }

  const now = Date.now();
  const [groups, inbox, interviews] = await Promise.all([
    countAutobidGroups(user.id).catch(() => null),
    countInboxViews(user.id, ["attention"], { accountIds: null, search: "" }).catch(() => null),
    listInterviews(user.id, {
      from: new Date(now - 60 * 60_000).toISOString(),
      to: new Date(now + 7 * 86_400_000).toISOString(),
    }).catch(() => []),
  ]);

  const scheduled = interviews.filter((i) => i.status === "scheduled");
  const body: OverviewResponse = {
    autobidAttention: groups?.attention ?? 0,
    autobidActive: groups?.active ?? 0,
    inboxAttention: inbox?.attention ?? 0,
    upcoming: scheduled.slice(0, 5).map((i) => ({
      id: i.id,
      company: i.company,
      jobTitle: i.jobTitle,
      startsAt: i.startsAt,
      meetingUrl: i.meetingUrl,
      candidate: i.application?.candidateName ?? "",
    })),
    interviewsNext24h: scheduled.filter((i) => new Date(i.startsAt).getTime() - now < 86_400_000).length,
  };
  return NextResponse.json(body);
}
