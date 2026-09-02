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
import { ProxyAgent, type Dispatcher } from "undici";

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

const HIRING_CAFE_BASE = "https://hiringcafe.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const HIRING_CAFE_FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Referer: HIRING_CAFE_BASE,
} as const;

const RETRYABLE_HTTP_STATUSES = new Set([403, 429, 500, 502, 503, 504]);

type HiringCafeFetchInit = RequestInit & { dispatcher?: Dispatcher };

let hiringCafeProxyAgent: ProxyAgent | undefined;
let hiringCafeProxyAgentUrl: string | undefined;

/** Full URL (`http://user:pass@host:port`) or `host:port:username:password` (Proxy-Seller style). */
export function getHiringCafeProxyUrl(): string | undefined {
  const direct = process.env.HIRING_CAFE_PROXY_URL?.replace(/^["']|["']$/g, "").trim();
  if (direct) return direct;

  const proxyConfig = process.env.HIRING_CAFE_PROXY?.replace(/^["']|["']$/g, "").trim();
  if (!proxyConfig) return undefined;

  const parts = proxyConfig.split(":");
  if (parts.length < 4) return undefined;

  const [host, port, username, ...passwordParts] = parts;
  const password = passwordParts.join(":");
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

function getHiringCafeProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = getHiringCafeProxyUrl();
  if (!proxyUrl) return undefined;

  if (!hiringCafeProxyAgent || hiringCafeProxyAgentUrl !== proxyUrl) {
    hiringCafeProxyAgent = new ProxyAgent(proxyUrl);
    hiringCafeProxyAgentUrl = proxyUrl;
  }

  return hiringCafeProxyAgent;
}

const DEFAULT_SEARCH_STATE = {
  locations: [
    {
      id: "FxY1yZQBoEtHp_8UEq7V",
      types: ["country"],
      address_components: [
        {
          long_name: "United States",
          short_name: "US",
          types: ["country"],
        },
      ],
      formatted_address: "United States",
      population: 327167434,
      workplace_types: ["Remote"],
      options: {
        flexible_regions: ["anywhere_in_world", "anywhere_in_continent"],
      },
    },
  ],
  commitmentTypes: ["Full Time", "Part Time", "Contract", "Temporary", "Seasonal"],
  dateFetchedPastNDays: 3,
  departments: [
    "Engineering",
    "Software Development",
    "Information Technology",
    "Data and Analytics",
  ],
  excludeAllLicensesAndCertifications: true,
  securityClearances: ["None"],
  sortBy: "date",
  jobTitleQuery:
    'NOT ("Consultant" OR "Manager" OR "Director") AND ("Software" OR "Data" OR "AI" OR "Developer" OR "Engineer")',
} as const;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function buildSearchState(dateWindow: JobScraperDateWindow) {
  return {
    ...DEFAULT_SEARCH_STATE,
    dateFetchedPastNDays: dateWindowDays(dateWindow),
  };
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

export function buildHiringCafeDataUrl(
  buildId: string,
  dateWindow: JobScraperDateWindow,
  page: number,
): string {
  const url = new URL(`_next/data/${buildId}/index.json`, HIRING_CAFE_BASE);
  url.searchParams.set("searchState", JSON.stringify(buildSearchState(dateWindow)));
  url.searchParams.set("page", String(page));
  return url.toString();
}

/** @deprecated Use buildHiringCafeDataUrl — hiring.cafe now redirects to hiringcafe.com. */
export function buildHiringCafeUrl(dateWindow: JobScraperDateWindow, page: number): string {
  const url = new URL(HIRING_CAFE_BASE);
  url.searchParams.set("searchState", JSON.stringify(buildSearchState(dateWindow)));
  url.searchParams.set("page", String(page));
  return url.toString();
}

type HiringCafeFetchResult = {
  ok: boolean;
  status: number;
  text: string;
};

async function fetchHiringCafe(
  url: string,
  extraHeaders: Record<string, string> = {},
  maxRetries = 3,
): Promise<HiringCafeFetchResult> {
  let lastStatus = 0;
  let lastText = "";

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const dispatcher = getHiringCafeProxyAgent();
      const response = await fetch(url, {
        headers: {
          ...HIRING_CAFE_FETCH_HEADERS,
          ...extraHeaders,
        },
        cache: "no-store",
        redirect: "follow",
        ...(dispatcher ? { dispatcher } : {}),
      } as HiringCafeFetchInit);
      lastStatus = response.status;
      lastText = await response.text();

      if (response.ok) {
        return { ok: true, status: response.status, text: lastText };
      }

      if (!RETRYABLE_HTTP_STATUSES.has(response.status)) {
        break;
      }
    } catch {
      // retry below
    }

    if (attempt < maxRetries - 1) {
      await sleep(2 ** attempt * 1000);
    }
  }

  return { ok: false, status: lastStatus, text: lastText };
}

function extractBuildIdFromHtml(html: string): string | null {
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!nextDataMatch?.[1]) return null;

  try {
    const parsed = JSON.parse(nextDataMatch[1]) as { buildId?: string };
    return typeof parsed.buildId === "string" && parsed.buildId.trim()
      ? parsed.buildId.trim()
      : null;
  } catch {
    return null;
  }
}

async function fetchBuildId(): Promise<string> {
  const home = await fetchHiringCafe(HIRING_CAFE_BASE, { Accept: "text/html,application/xhtml+xml" });
  if (!home.ok) {
    if (home.status === 403 || home.text.includes("Just a moment")) {
      const proxyHint = getHiringCafeProxyUrl()
        ? ""
        : " Set HIRING_CAFE_PROXY_URL (or HIRING_CAFE_PROXY) to route through an ISP proxy.";
      throw new Error(
        `HiringCafe blocked the scrape request (HTTP 403).${proxyHint} Try again later or scrape from a different network.`,
      );
    }
    throw new Error(`Could not reach HiringCafe (HTTP ${home.status || "unknown"}).`);
  }

  const buildId = extractBuildIdFromHtml(home.text);
  if (!buildId) {
    throw new Error("Could not read HiringCafe build ID. The site layout may have changed.");
  }

  return buildId;
}

function extractPagePropsFromJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as { pageProps?: Record<string, unknown> };
    return parsed.pageProps ?? null;
  } catch {
    return null;
  }
}

async function fetchSearchPageProps(
  buildId: string,
  dateWindow: JobScraperDateWindow,
  page: number,
): Promise<{ pageProps: Record<string, unknown> | null; staleBuildId: boolean }> {
  const url = buildHiringCafeDataUrl(buildId, dateWindow, page);
  const response = await fetchHiringCafe(url, {
    Accept: "*/*",
    "x-nextjs-data": "1",
  });

  if (response.status === 404) {
    return { pageProps: null, staleBuildId: true };
  }

  if (!response.ok) {
    return { pageProps: null, staleBuildId: false };
  }

  return {
    pageProps: extractPagePropsFromJson(response.text),
    staleBuildId: false,
  };
}

function extractJobFields(hit: Record<string, unknown>): ScrapedJob {
  const jobInfo = (hit.job_information as Record<string, unknown> | undefined) ?? {};
  const processed = (hit.v5_processed_job_data as Record<string, unknown> | undefined) ?? {};
  const company = (hit.enriched_company_data as Record<string, unknown> | undefined) ?? {};
  const applyUrl = serializeField(hit.apply_url);

  return {
    apply_url: applyUrl,
    title: serializeField(jobInfo.title),
    core_job_title: serializeField(processed.core_job_title),
    requirements_summary: serializeField(processed.requirements_summary),
    technical_tools: serializeField(processed.technical_tools),
    job_category: serializeField(processed.job_category),
    estimated_publish_date: serializeField(processed.estimated_publish_date),
    role_activities: serializeField(processed.role_activities),
    company_name: serializeField(company.name),
    company_tagline: serializeField(company.tagline),
    application_site: detectPlatform(applyUrl),
  };
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
    if (blockedJobs.length > 0 && jobMatchesBlockedJobs(job.apply_url, blockedJobs)) {
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

export async function scrapeHiringCafeJobs(
  dateWindow: JobScraperDateWindow,
  options?: { maxPages?: number; delayMs?: number },
): Promise<ScrapeJobsResult> {
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? 8, 20));
  const delayMs = Math.max(500, Math.min(options?.delayMs ?? 1000, 3000));
  const jobs: ScrapedJob[] = [];
  let reportedTotal: number | null = null;
  let lastHitId = "";
  let pagesFetched = 0;
  let buildId = await fetchBuildId();

  for (let page = 0; page < maxPages; page += 1) {
    let { pageProps, staleBuildId } = await fetchSearchPageProps(buildId, dateWindow, page);

    if (staleBuildId) {
      buildId = await fetchBuildId();
      ({ pageProps, staleBuildId } = await fetchSearchPageProps(buildId, dateWindow, page));
    }

    if (!pageProps) break;

    const hits = Array.isArray(pageProps.ssrHits)
      ? (pageProps.ssrHits as Record<string, unknown>[])
      : [];
    const isLastPage = Boolean(pageProps.ssrIsLastPage);
    reportedTotal =
      typeof pageProps.ssrTotalCount === "number" ? pageProps.ssrTotalCount : reportedTotal;

    if (hits.length === 0) break;

    const firstHitId = serializeField(hits[0]?.id) ?? "";
    if (page > 0 && firstHitId && firstHitId === lastHitId) break;
    lastHitId = serializeField(hits[hits.length - 1]?.id) ?? lastHitId;

    for (const hit of hits) {
      jobs.push(extractJobFields(hit));
    }
    pagesFetched += 1;

    if (isLastPage) {
      return { jobs, pagesFetched, reportedTotal };
    }

    if (page < maxPages - 1) {
      await sleep(delayMs);
    }
  }

  if (pagesFetched === 0) {
    throw new Error(
      "HiringCafe returned no job pages. The site may be blocking automated requests.",
    );
  }

  return {
    jobs,
    pagesFetched,
    reportedTotal,
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
