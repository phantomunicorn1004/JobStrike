import { jobLinksMatch } from "@/lib/job-url";

export type BlockedJobRef = {
  jobLink: string;
  jobTitle?: string | null;
  companyName?: string | null;
};

export function jobMatchesBlockedJobs(
  applyUrl: string | null | undefined,
  blockedJobs: BlockedJobRef[],
): boolean {
  if (!blockedJobs.length) return false;
  return blockedJobs.some((blocked) => jobLinksMatch(applyUrl, blocked.jobLink));
}
