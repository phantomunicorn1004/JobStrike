import {
  companiesMatch,
  companyMatchLevelInList,
  type CompanyMatchLevel,
} from "@/lib/company-name";
import { jobLinksMatch } from "@/lib/job-url";

export type RegisteredJobRef = {
  jobLink: string | null;
  jobTitle: string | null;
  company: string | null;
};

export type ScrapedJobRef = {
  apply_url: string | null;
  company_name: string | null;
  title: string | null;
};

export type JobDuplicateStatus = {
  registeredJob: boolean;
  registeredCompany: boolean;
  similarCompany: boolean;
  companyLevel: CompanyMatchLevel;
};

function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function jobMatchesRegisteredJobRef(
  job: ScrapedJobRef,
  registered: RegisteredJobRef,
): boolean {
  if (jobLinksMatch(job.apply_url, registered.jobLink)) return true;

  const jobTitle = normalizeTitle(job.title);
  const registeredTitle = normalizeTitle(registered.jobTitle);
  if (
    jobTitle &&
    registeredTitle &&
    jobTitle === registeredTitle &&
    companiesMatch(job.company_name, registered.company)
  ) {
    return true;
  }

  return false;
}

export function classifyJobAgainstResumeDb(
  job: ScrapedJobRef,
  context: {
    registeredJobs: RegisteredJobRef[];
    registeredCompanies: string[];
  },
): JobDuplicateStatus {
  const registeredJob = context.registeredJobs.some((registered) =>
    jobMatchesRegisteredJobRef(job, registered),
  );
  const companyLevel = companyMatchLevelInList(
    job.company_name,
    context.registeredCompanies,
  );
  const registeredCompany = companyLevel === "definite";
  const similarCompany =
    !registeredJob && !registeredCompany && companyLevel === "possible";

  return {
    registeredJob,
    registeredCompany,
    similarCompany,
    companyLevel,
  };
}
