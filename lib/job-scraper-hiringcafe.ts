import "server-only";

import type { Browser, Page } from "playwright-core";
import {
  getScrapeProxyConfig,
  launchScrapeBrowser,
} from "@/lib/job-scraper-browser";
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

const PAGE_LOAD_TIMEOUT_MS = 60_000;

export type HiringCafeScrapeProgress = {
  step:
    | "launching"
    | "warming"
    | "session_ready"
    | "fetching_page"
    | "page_done"
    | "closing";
  message: string;
  page?: number;
  maxPages?: number;
  jobsSoFar?: number;
  pagesFetched?: number;
};

export type HiringCafeScrapeOptions = {
  maxPages?: number;
  delayMs?: number;
  onProgress?: (event: HiringCafeScrapeProgress) => void;
};

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

function buildHiringCafeUrl(dateWindow: JobScraperDateWindow, page: number): string {
  const url = new URL(HIRING_CAFE_BASE);
  url.searchParams.set("searchState", JSON.stringify(buildSearchState(dateWindow)));
  url.searchParams.set("page", String(page));
  return url.toString();
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

function formatFetchError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function looksLikeCloudflareChallenge(html: string): boolean {
  const sample = html.slice(0, 12_000);
  return (
    /just a moment/i.test(sample) ||
    /cf-browser-verification|challenge-platform|turnstile/i.test(sample)
  );
}

function parseNextDataScript(html: string): {
  buildId: string | null;
  pageProps: Record<string, unknown> | null;
} {
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!nextDataMatch?.[1]) {
    return { buildId: null, pageProps: null };
  }

  try {
    const parsed = JSON.parse(nextDataMatch[1]) as {
      buildId?: string;
      props?: { pageProps?: Record<string, unknown> };
      pageProps?: Record<string, unknown>;
    };
    const buildId =
      typeof parsed.buildId === "string" && parsed.buildId.trim()
        ? parsed.buildId.trim()
        : null;
    const pageProps = parsed.props?.pageProps ?? parsed.pageProps ?? null;
    return { buildId, pageProps };
  } catch {
    return { buildId: null, pageProps: null };
  }
}

function extractBuildIdFromHtml(html: string): string | null {
  return parseNextDataScript(html).buildId;
}

function extractPagePropsFromNextData(html: string): Record<string, unknown> | null {
  return parseNextDataScript(html).pageProps;
}

function hasSsrHits(pageProps: Record<string, unknown> | null): boolean {
  return Array.isArray(pageProps?.ssrHits);
}

async function createBrowserPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({
    userAgent: USER_AGENT,
    extraHTTPHeaders: {
      "Accept-Language": HIRING_CAFE_FETCH_HEADERS["Accept-Language"],
    },
  });
  page.setDefaultTimeout(PAGE_LOAD_TIMEOUT_MS);
  return page;
}

async function warmHiringCafeSession(page: Page): Promise<string> {
  await page.goto(HIRING_CAFE_BASE, {
    waitUntil: "domcontentloaded",
    timeout: PAGE_LOAD_TIMEOUT_MS,
  });

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const hasTurnstile = await page.locator('iframe[src*="cloudflare"]').count();
  if (hasTurnstile > 0) {
    await page
      .waitForFunction(() => !document.querySelector('iframe[src*="cloudflare"]'), {
        timeout: 10_000,
      })
      .catch(() => {});
  }

  await page.waitForSelector("script#__NEXT_DATA__", { timeout: 10_000 }).catch(() => {});

  const html = await page.content();
  const buildId = extractBuildIdFromHtml(html);
  if (!buildId) {
    throw new Error("Could not read HiringCafe build ID. The site layout may have changed.");
  }
  return buildId;
}

function extractPagePropsFromJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as {
      pageProps?: Record<string, unknown>;
      props?: { pageProps?: Record<string, unknown> };
    };
    return parsed.pageProps ?? parsed.props?.pageProps ?? null;
  } catch {
    return null;
  }
}

async function fetchSearchPagePropsViaHtml(
  page: Page,
  dateWindow: JobScraperDateWindow,
  pageIndex: number,
): Promise<{ pageProps: Record<string, unknown> | null; blocked: boolean }> {
  const url = buildHiringCafeUrl(dateWindow, pageIndex);
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: PAGE_LOAD_TIMEOUT_MS,
  });

  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector("script#__NEXT_DATA__", { timeout: 15_000 }).catch(() => {});

  const html = await page.content();
  const pageProps = extractPagePropsFromNextData(html);
  if (hasSsrHits(pageProps)) {
    return { pageProps, blocked: false };
  }

  const status = response?.status() ?? 0;
  const blocked =
    looksLikeCloudflareChallenge(html) ||
    status === 403 ||
    status === 429 ||
    status === 503;
  return { pageProps: null, blocked };
}

async function fetchSearchPageProps(
  page: Page,
  buildId: string,
  dateWindow: JobScraperDateWindow,
  pageIndex: number,
): Promise<{
  pageProps: Record<string, unknown> | null;
  staleBuildId: boolean;
  blocked: boolean;
}> {
  const dataUrl = buildHiringCafeDataUrl(buildId, dateWindow, pageIndex);

  // Fast path: Next.js data JSON in the same browser context (keeps CF cookies).
  try {
    const response = await page.request.get(dataUrl, {
      headers: {
        Accept: "*/*",
        "x-nextjs-data": "1",
        Referer: HIRING_CAFE_BASE,
      },
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });

    const status = response.status();
    if (status === 404) {
      return { pageProps: null, staleBuildId: true, blocked: false };
    }

    if (status >= 200 && status < 300) {
      const text = await response.text();
      const pageProps = extractPagePropsFromJson(text);
      if (hasSsrHits(pageProps)) {
        return { pageProps, staleBuildId: false, blocked: false };
      }
      // 200 with HTML/challenge/empty payload — fall through to HTML navigation.
    }
  } catch (error) {
    console.error("HiringCafe data URL fetch failed:", formatFetchError(error));
  }

  // Reliable path (same as the extension): load the search HTML and read __NEXT_DATA__.
  try {
    const htmlResult = await fetchSearchPagePropsViaHtml(page, dateWindow, pageIndex);
    return {
      pageProps: htmlResult.pageProps,
      staleBuildId: false,
      blocked: htmlResult.blocked,
    };
  } catch (error) {
    console.error("HiringCafe HTML page fetch failed:", formatFetchError(error));
    return { pageProps: null, staleBuildId: false, blocked: true };
  }
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
    company_name:
      serializeField(company.name) ||
      serializeField(processed.company_name) ||
      serializeField(jobInfo.company_name) ||
      serializeField(hit.company_name),
    company_tagline: serializeField(company.tagline),
    application_site: detectPlatform(applyUrl),
  };
}

export async function scrapeHiringCafeJobs(
  dateWindow: JobScraperDateWindow,
  options?: HiringCafeScrapeOptions,
): Promise<ScrapeJobsResult> {
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? 8, 20));
  // Shorter pause between pages — one shared browser session already has CF cookies.
  const delayMs = Math.max(200, Math.min(options?.delayMs ?? 400, 3000));
  const onProgress = options?.onProgress;
  const jobs: ScrapedJob[] = [];
  let reportedTotal: number | null = null;
  let lastHitId = "";
  let pagesFetched = 0;
  let blocked = false;

  onProgress?.({
    step: "launching",
    message: "Starting browser…",
    maxPages,
  });
  const browser = await launchScrapeBrowser();
  try {
    const page = await createBrowserPage(browser);

    let buildId: string;
    try {
      onProgress?.({
        step: "warming",
        message: "Opening HiringCafe (Cloudflare check)…",
        maxPages,
      });
      buildId = await warmHiringCafeSession(page);
      onProgress?.({
        step: "session_ready",
        message: "Session ready — fetching job pages…",
        maxPages,
      });
    } catch (error) {
      const message = formatFetchError(error);
      const proxyHint = getScrapeProxyConfig()
        ? " Check that your residential proxy is working correctly (Webshare host/port/user/pass)."
        : " Set HIRING_CAFE_PROXY_URL (or HIRING_CAFE_PROXY) to route through an ISP proxy.";
      throw new Error(`Could not reach HiringCafe: ${message}.${proxyHint}`);
    }

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      onProgress?.({
        step: "fetching_page",
        message: `Fetching page ${pageIndex + 1} of up to ${maxPages}…`,
        page: pageIndex + 1,
        maxPages,
        jobsSoFar: jobs.length,
        pagesFetched,
      });

      let result = await fetchSearchPageProps(page, buildId, dateWindow, pageIndex);

      if (result.staleBuildId) {
        onProgress?.({
          step: "warming",
          message: "Build ID stale — refreshing HiringCafe session…",
          maxPages,
          jobsSoFar: jobs.length,
        });
        buildId = await warmHiringCafeSession(page);
        result = await fetchSearchPageProps(page, buildId, dateWindow, pageIndex);
      }

      blocked = blocked || result.blocked;
      const pageProps = result.pageProps;
      if (!pageProps) break;

      const hits = Array.isArray(pageProps.ssrHits)
        ? (pageProps.ssrHits as Record<string, unknown>[])
        : [];
      const isLastPage = Boolean(pageProps.ssrIsLastPage);
      reportedTotal =
        typeof pageProps.ssrTotalCount === "number" ? pageProps.ssrTotalCount : reportedTotal;

      if (hits.length === 0) break;

      const firstHitId = serializeField(hits[0]?.id) ?? "";
      if (pageIndex > 0 && firstHitId && firstHitId === lastHitId) break;
      lastHitId = serializeField(hits[hits.length - 1]?.id) ?? lastHitId;

      for (const hit of hits) {
        jobs.push(extractJobFields(hit));
      }
      pagesFetched += 1;

      onProgress?.({
        step: "page_done",
        message: `Page ${pageIndex + 1} done — ${jobs.length} jobs so far`,
        page: pageIndex + 1,
        maxPages,
        jobsSoFar: jobs.length,
        pagesFetched,
      });

      if (isLastPage) {
        onProgress?.({
          step: "closing",
          message: "Closing browser…",
          jobsSoFar: jobs.length,
          pagesFetched,
          maxPages,
        });
        return { jobs, pagesFetched, reportedTotal };
      }

      if (pageIndex < maxPages - 1) {
        await sleep(delayMs);
      }
    }
  } finally {
    onProgress?.({
      step: "closing",
      message: "Closing browser…",
      jobsSoFar: jobs.length,
      pagesFetched,
      maxPages,
    });
    await browser.close().catch(() => {});
  }

  if (pagesFetched === 0) {
    const proxyHint = getScrapeProxyConfig()
      ? " Check that your residential proxy is working correctly."
      : " Set HIRING_CAFE_PROXY_URL (or HIRING_CAFE_PROXY) to route through an ISP proxy.";
    throw new Error(
      blocked
        ? `HiringCafe blocked the job-page request (Cloudflare/challenge).${proxyHint}`
        : `HiringCafe returned no job pages. The search may be empty, or the site layout changed.${proxyHint}`,
    );
  }

  return {
    jobs,
    pagesFetched,
    reportedTotal,
  };
}

export type { ScrapeProxyConfig } from "@/lib/job-scraper-browser";
export { getHiringCafeProxyConfig, getScrapeProxyConfig } from "@/lib/job-scraper-browser";

