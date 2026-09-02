import "server-only";

import { ProxyAgent, type Dispatcher } from "undici";
import {
  detectPlatform,
  type JobScraperDateWindow,
  type ScrapeJobsResult,
  type ScrapedJob,
  dateWindowDays,
} from "@/lib/job-scraper";

const HIRING_CAFE_BASE = "https://hiringcafe.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const HIRING_CAFE_FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Referer: HIRING_CAFE_BASE,
} as const;

const RETRYABLE_HTTP_STATUSES = new Set([403, 429, 500, 502, 503, 504]);

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

function buildSearchState(dateWindow: JobScraperDateWindow) {
  return {
    ...DEFAULT_SEARCH_STATE,
    dateFetchedPastNDays: dateWindowDays(dateWindow),
  };
}

function buildHiringCafeDataUrl(
  buildId: string,
  dateWindow: JobScraperDateWindow,
  page: number,
): string {
  const url = new URL(`_next/data/${buildId}/index.json`, HIRING_CAFE_BASE);
  url.searchParams.set("searchState", JSON.stringify(buildSearchState(dateWindow)));
  url.searchParams.set("page", String(page));
  return url.toString();
}

type HiringCafeFetchResult = {
  ok: boolean;
  status: number;
  text: string;
  error?: string;
};

function formatFetchError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function fetchHiringCafe(
  url: string,
  extraHeaders: Record<string, string> = {},
  maxRetries = 3,
): Promise<HiringCafeFetchResult> {
  let lastStatus = 0;
  let lastText = "";
  let lastError: string | undefined;

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
      lastError = undefined;

      if (response.ok) {
        return { ok: true, status: response.status, text: lastText };
      }

      if (!RETRYABLE_HTTP_STATUSES.has(response.status)) {
        break;
      }
    } catch (error) {
      lastError = formatFetchError(error);
    }

    if (attempt < maxRetries - 1) {
      await sleep(2 ** attempt * 1000);
    }
  }

  return { ok: false, status: lastStatus, text: lastText, error: lastError };
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

    const usingProxy = Boolean(getHiringCafeProxyUrl());
    const statusLabel = home.status > 0 ? `HTTP ${home.status}` : "no HTTP response";
    const detail = home.error ? ` ${home.error}` : "";
    const proxyHint = usingProxy
      ? " Check HIRING_CAFE_PROXY_URL / HIRING_CAFE_PROXY (host, port, user, pass) and that Proxy-Seller allows Vercel's IP."
      : "";
    throw new Error(`Could not reach HiringCafe (${statusLabel}).${detail}${proxyHint}`);
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
