import {
  companiesMatch,
  companyMatchLevelInList,
  companyMatchesList,
  normalizeCompanyName,
} from "@/lib/company-name";
import {
  classifyJobAgainstResumeDb,
  jobMatchesRegisteredJobRef,
  type JobDuplicateStatus,
  type RegisteredJobRef,
} from "@/lib/job-duplicate";
import { jobMatchesBlockedJobs, type BlockedJobRef } from "@/lib/job-block";
import { canonicalJobUrl } from "@/lib/job-url";

export type { BlockedJobRef, JobDuplicateStatus, RegisteredJobRef };
export {
  classifyJobAgainstResumeDb,
  companiesMatch,
  companyMatchLevelInList,
  companyMatchesList,
  jobMatchesBlockedJobs,
  jobMatchesRegisteredJobRef,
  normalizeCompanyName,
};

export type JobScraperDateWindow = "1d" | "3d" | "7d";

export type ScrapedJob = {
  apply_url: string | null;
  title: string | null;
  core_job_title: string | null;
  requirements_summary: string | null;
  technical_tools: string | null;
  job_category: string | null;
  estimated_publish_date: string | null;
  role_activities: string | null;
  company_name: string | null;
  company_tagline: string | null;
  application_site: string;
};

export type ScrapeJobsResult = {
  jobs: ScrapedJob[];
  pagesFetched: number;
  reportedTotal: number | null;
};

const PLATFORM_RULES: Array<
  [string, (host: string, path: string) => boolean]
> = [
  ["Greenhouse", (h) => h.includes("greenhouse.io")],
  ["Lever", (h) => h.includes("lever.co")],
  ["Workday", (h) => h.includes("myworkdayjobs.com") || h.includes("workday.com")],
  ["iCIMS", (h) => h.includes("icims.com")],
  ["Gem", (h) => h.includes("jobs.gem.com")],
  ["Ashby", (h) => h.includes("ashbyhq.com")],
  ["Rippling", (h) => h.includes("rippling.com") || h.includes("atsrecruiting.com")],
  ["Jobvite", (h) => h.includes("jobvite.com")],
  ["SmartRecruiters", (h) => h.includes("smartrecruiters.com")],
  ["BambooHR", (h) => h.includes("bamboohr.com")],
  ["Taleo", (h) => h.includes("taleo.net")],
  ["Indeed", (h) => h.includes("indeed.com")],
  ["LinkedIn", (h) => h.includes("linkedin.com")],
  ["Wellfound", (h) => h.includes("wellfound.com") || h.includes("angel.co")],
  ["Recruitee", (h) => h.includes("recruitee.com")],
  ["Breezy", (h) => h.includes("breezy.hr")],
  ["Workable", (h) => h.includes("workable.com")],
  ["JazzHR", (h) => h.includes("jazz.co") || h.includes("applytojob.com")],
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function dateWindowDays(dateWindow: JobScraperDateWindow): number {
  return dateWindow === "1d" ? 1 : dateWindow === "7d" ? 7 : 3;
}

/** Keep jobs whose estimated_publish_date is within the selected rolling window. */
export function filterJobsByPublishDate(
  jobs: ScrapedJob[],
  dateWindow: JobScraperDateWindow,
  nowMs: number = Date.now(),
) {
  const days = dateWindowDays(dateWindow);
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  let removedByDate = 0;
  const filtered: ScrapedJob[] = [];

  for (const job of jobs) {
    const raw = job.estimated_publish_date?.trim();
    if (!raw) {
      removedByDate += 1;
      continue;
    }
    const publishedMs = Date.parse(raw);
    if (Number.isNaN(publishedMs) || publishedMs < cutoffMs) {
      removedByDate += 1;
      continue;
    }
    filtered.push(job);
  }

  return { filtered, removedByDate, cutoffIso: new Date(cutoffMs).toISOString() };
}

export function detectPlatform(url: string | null | undefined): string {
  if (!url?.trim()) return "Unknown";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    for (const [name, rule] of PLATFORM_RULES) {
      if (rule(host, path)) return name;
    }
    return host || "Unknown";
  } catch {
    return "Unknown";
  }
}

export function dedupeJobs(jobs: ScrapedJob[]): ScrapedJob[] {
  const seenUrls = new Set<string>();
  const seenCompanyTitle = new Set<string>();
  const unique: ScrapedJob[] = [];

  for (const job of jobs) {
    const urlKey = canonicalJobUrl(job.apply_url);
    if (urlKey && seenUrls.has(urlKey)) continue;

    const companyKey = normalizeCompanyName(job.company_name);
    const titleKey = normalizeText(job.title);
    const companyTitleKey = companyKey && titleKey ? `${companyKey}::${titleKey}` : "";
    if (companyTitleKey && seenCompanyTitle.has(companyTitleKey)) continue;

    if (urlKey) seenUrls.add(urlKey);
    if (companyTitleKey) seenCompanyTitle.add(companyTitleKey);
    unique.push(job);
  }

  return unique;
}

export function normalizeAtsName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function atsMatchesList(
  jobAts: string | null | undefined,
  atsList: string[],
): boolean {
  const atsKey = normalizeAtsName(jobAts);
  if (!atsKey) return false;
  return atsList.some((ats) => {
    const blocked = normalizeAtsName(ats);
    return Boolean(blocked) && (atsKey === blocked || atsKey.includes(blocked) || blocked.includes(atsKey));
  });
}

export function jobMatchesRegisteredJobs(
  job: ScrapedJob,
  registeredJobs: RegisteredJobRef[],
): boolean {
  return registeredJobs.some((registered) => jobMatchesRegisteredJobRef(job, registered));
}

export type OptionalScrapeFilters = {
  excludeRegisteredJobs?: boolean;
  excludeRegisteredCompanies?: boolean;
  excludeBlockedJobs?: boolean;
  excludeBlockedCompanies?: boolean;
  excludeBlockedAts?: boolean;
  registeredJobs?: RegisteredJobRef[];
  registeredCompanies?: string[];
  blockedJobs?: BlockedJobRef[];
  blockedCompanies?: string[];
  blockedAts?: string[];
};

export type OptionalFilterStats = {
  removedRegisteredJobs: number;
  removedRegisteredCompanies: number;
  removedBlockedJobs: number;
  removedBlocked: number;
  removedAts: number;
};

export function applyOptionalScrapeFilters(
  jobs: ScrapedJob[],
  filters: OptionalScrapeFilters,
): { filtered: ScrapedJob[]; stats: OptionalFilterStats } {
  const registeredJobs =
    filters.excludeRegisteredJobs === true ? filters.registeredJobs ?? [] : [];
  const registeredCompanies =
    filters.excludeRegisteredCompanies === true ? filters.registeredCompanies ?? [] : [];
  const blockedJobs =
    filters.excludeBlockedJobs === true ? filters.blockedJobs ?? [] : [];
  const blockedCompanies =
    filters.excludeBlockedCompanies === true ? filters.blockedCompanies ?? [] : [];
  const blockedAts = filters.excludeBlockedAts === true ? filters.blockedAts ?? [] : [];

  let removedRegisteredJobs = 0;
  let removedRegisteredCompanies = 0;
  let removedBlockedJobs = 0;
  let removedBlocked = 0;
  let removedAts = 0;
  const filtered: ScrapedJob[] = [];

  for (const job of jobs) {
    if (blockedJobs.length > 0 && jobMatchesBlockedJobs(job, blockedJobs)) {
      removedBlockedJobs += 1;
      continue;
    }
    if (registeredJobs.length > 0 && jobMatchesRegisteredJobs(job, registeredJobs)) {
      removedRegisteredJobs += 1;
      continue;
    }
    if (
      registeredCompanies.length > 0 &&
      companyMatchesList(job.company_name, registeredCompanies)
    ) {
      removedRegisteredCompanies += 1;
      continue;
    }
    if (blockedAts.length > 0 && atsMatchesList(job.application_site, blockedAts)) {
      removedAts += 1;
      continue;
    }
    if (
      blockedCompanies.length > 0 &&
      companyMatchesList(job.company_name, blockedCompanies)
    ) {
      removedBlocked += 1;
      continue;
    }
    filtered.push(job);
  }

  return {
    filtered,
    stats: {
      removedRegisteredJobs,
      removedRegisteredCompanies,
      removedBlockedJobs,
      removedBlocked,
      removedAts,
    },
  };
}

/** @deprecated Prefer applyOptionalScrapeFilters */
export function filterJobsByCompany(
  jobs: ScrapedJob[],
  blockedCompanies: string[],
  resumeDbCompanies: string[],
  blockedAts: string[] = [],
) {
  const { filtered, stats } = applyOptionalScrapeFilters(jobs, {
    excludeBlockedCompanies: true,
    excludeRegisteredCompanies: true,
    excludeBlockedAts: true,
    blockedCompanies,
    registeredCompanies: resumeDbCompanies,
    blockedAts,
  });
  return {
    filtered,
    removedBlockedCount: stats.removedBlocked,
    removedResumeCount: stats.removedRegisteredCompanies,
    removedAtsCount: stats.removedAts,
  };
}

export function jobsToCsv(jobs: ScrapedJob[]): string {
  const headers = [
    "apply_url",
    "title",
    "core_job_title",
    "requirements_summary",
    "technical_tools",
    "job_category",
    "estimated_publish_date",
    "role_activities",
    "company_name",
    "company_tagline",
    "application_site",
  ] as const;

  const escape = (value: string | null) => {
    const text = value ?? "";
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    headers.join(","),
    ...jobs.map((job) => headers.map((header) => escape(job[header])).join(",")),
  ].join("\n");
}
