import type {
  BlockedJobRef,
  JobScraperDateWindow,
  RegisteredJobRef,
  ScrapedJob,
} from "@/lib/job-scraper";

export const JOB_SCRAPER_STORAGE_KEY = "rwh.job-scraper.session.v1";

export type JobScraperPersistedSession = {
  version: 1;
  savedAt: string;
  dateWindow: JobScraperDateWindow;
  candidateFilter: string;
  excludeBlocked: boolean;
  excludeBlockedAts: boolean;
  excludeBlockedJobs: boolean;
  excludeRegisteredJobs: boolean;
  excludeRegisteredCompanies: boolean;
  baseJobs: ScrapedJob[];
  filterContext: {
    blockedCompanies: string[];
    blockedAts: string[];
    blockedJobs: BlockedJobRef[];
    registeredCompanies: string[];
    registeredJobs: RegisteredJobRef[];
    registeredJobCount: number;
    registeredCompanyCount: number;
  } | null;
  scrapeMeta: {
    scraped: number;
    deduped: number;
    removedByDate: number;
    baseRemaining: number;
    pagesFetched: number;
    reportedTotal: number | null;
    dateCutoff?: string;
    dateWindow?: JobScraperDateWindow;
  } | null;
};

export function loadJobScraperSession(): JobScraperPersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(JOB_SCRAPER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JobScraperPersistedSession;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.baseJobs)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveJobScraperSession(session: JobScraperPersistedSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(JOB_SCRAPER_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota / private mode — ignore persistence failures.
  }
}

export function clearJobScraperSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(JOB_SCRAPER_STORAGE_KEY);
  } catch {
    // ignore
  }
}
