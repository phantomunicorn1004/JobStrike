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

export type JobScraperDateWindow =
  | "2h"
  | "4h"
  | "8h"
  | "1d"
  | "2d"
  | "3d"
  | "7d";

export const JOB_SCRAPER_DATE_WINDOWS: readonly JobScraperDateWindow[] = [
  "2h",
  "4h",
  "8h",
  "1d",
  "2d",
  "3d",
  "7d",
] as const;

export function isJobScraperDateWindow(value: unknown): value is JobScraperDateWindow {
  return (
    typeof value === "string" &&
    (JOB_SCRAPER_DATE_WINDOWS as readonly string[]).includes(value)
  );
}

/** Coerce stored/API values to a known window; invalid → fallback. */
export function normalizeJobScraperDateWindow(
  value: unknown,
  fallback: JobScraperDateWindow = "8h",
): JobScraperDateWindow {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (isJobScraperDateWindow(raw)) return raw;
  return fallback;
}

export type FreshnessWindow = {
  kind: "hours" | "days";
  amount: number;
  label: string;
  /** Whole days for HiringCafe dateFetchedPastNDays (hour windows → 1). */
  hcDays: number;
};

export function parseFreshnessWindow(
  dateWindow: JobScraperDateWindow | number | string,
): FreshnessWindow {
  if (typeof dateWindow === "number" && Number.isFinite(dateWindow)) {
    const days = Math.max(1, Math.round(dateWindow));
    return { kind: "days", amount: days, label: `${days}d`, hcDays: days };
  }
  const raw = String(dateWindow || "").trim().toLowerCase();
  const hourMatch = raw.match(/^(\d+)\s*h$/);
  if (hourMatch) {
    const hours = Math.max(1, Number(hourMatch[1]));
    return { kind: "hours", amount: hours, label: `${hours}h`, hcDays: 1 };
  }
  const dayMatch = raw.match(/^(\d+)\s*d$/);
  if (dayMatch) {
    const days = Math.max(1, Number(dayMatch[1]));
    return { kind: "days", amount: days, label: `${days}d`, hcDays: days };
  }
  if (raw === "1d") return { kind: "days", amount: 1, label: "1d", hcDays: 1 };
  if (raw === "7d") return { kind: "days", amount: 7, label: "7d", hcDays: 7 };
  return { kind: "days", amount: 3, label: "3d", hcDays: 3 };
}

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
  /** Jobright apply/member count when available (e.g. "75+"). */
  applicants_count?: string | null;
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
  ["Jobright", (h) => h.includes("jobright.ai")],
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function dateWindowDays(dateWindow: JobScraperDateWindow): number {
  return parseFreshnessWindow(dateWindow).hcDays;
}

export function dateWindowCutoffMs(
  dateWindow: JobScraperDateWindow,
  nowMs: number = Date.now(),
): number {
  const parsed = parseFreshnessWindow(dateWindow);
  if (parsed.kind === "hours") {
    return nowMs - parsed.amount * 60 * 60 * 1000;
  }
  return nowMs - parsed.amount * 24 * 60 * 60 * 1000;
}

/** Keep jobs whose estimated_publish_date is within the selected rolling window. */
export function filterJobsByPublishDate(
  jobs: ScrapedJob[],
  dateWindow: JobScraperDateWindow,
  nowMs: number = Date.now(),
  options?: { keepUndated?: boolean },
) {
  const cutoffMs = dateWindowCutoffMs(dateWindow, nowMs);
  let removedByDate = 0;
  const filtered: ScrapedJob[] = [];
  const keepUndated = Boolean(options?.keepUndated);

  for (const job of jobs) {
    const raw = job.estimated_publish_date?.trim();
    if (!raw) {
      if (keepUndated) {
        filtered.push(job);
      } else {
        removedByDate += 1;
      }
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
    "applicants_count",
  ] as const;

  const escape = (value: string | null | undefined) => {
    const text = value ?? "";
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    headers.join(","),
    ...jobs.map((job) =>
      headers.map((header) => escape(job[header] ?? null)).join(","),
    ),
  ].join("\n");
}
