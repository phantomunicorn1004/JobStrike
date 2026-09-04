import { companiesMatch } from "@/lib/company-name";
import { jobLinksMatch } from "@/lib/job-url";

export type BlockedJobRef = {
  jobLink: string;
  jobTitle?: string | null;
  companyName?: string | null;
};

type ScrapedJobLike = {
  apply_url?: string | null;
  title?: string | null;
  company_name?: string | null;
};

function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function jobTitleCompanyMatch(
  job: ScrapedJobLike,
  blocked: BlockedJobRef,
): boolean {
  const jobTitle = normalizeTitle(job.title);
  const blockedTitle = normalizeTitle(blocked.jobTitle);
  if (!jobTitle || !blockedTitle || jobTitle !== blockedTitle) return false;
  return companiesMatch(job.company_name, blocked.companyName);
}

export function jobMatchesBlockedJobs(
  applyUrlOrJob: string | null | undefined | ScrapedJobLike,
  blockedJobs: BlockedJobRef[],
): boolean {
  if (!blockedJobs.length) return false;

  const job: ScrapedJobLike =
    applyUrlOrJob && typeof applyUrlOrJob === "object"
      ? applyUrlOrJob
      : { apply_url: applyUrlOrJob ?? null };

  return blockedJobs.some((blocked) => {
    if (jobLinksMatch(job.apply_url, blocked.jobLink)) return true;
    return jobTitleCompanyMatch(job, blocked);
  });
}
