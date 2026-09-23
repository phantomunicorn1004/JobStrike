import "server-only";

import type { Browser, Page, Response } from "playwright-core";
import {
  getScrapeProxyConfig,
  launchScrapeBrowser,
} from "@/lib/job-scraper-browser";
import {
  detectPlatform,
  type ScrapeJobsResult,
  type ScrapedJob,
} from "@/lib/job-scraper";

const JOBRIGHT_SITE = "https://jobright.ai";
const SWAN_API = "https://swan-api.jobright.ai";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PAGE_LOAD_TIMEOUT_MS = 60_000;
const DEFAULT_SEARCH = {
  titleKeyword: "Software Engineer",
  location: "United States",
};

export type JobrightSearch = {
  titleKeyword: string;
  location: string;
};

export type JobrightScrapeProgress = {
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

export type JobrightScrapeOptions = {
  search?: Partial<JobrightSearch>;
  /** Max pagination offsets to request (page size ~20). Default 5 (~100 jobs). */
  maxPages?: number;
  delayMs?: number;
  onProgress?: (event: JobrightScrapeProgress) => void;
};

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

function joinList(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts = value.map((item) => String(item ?? "").trim()).filter(Boolean);
    return parts.length ? parts.join("\n") : null;
  }
  return serializeField(value);
}

function formatFetchError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function normalizeJobrightSearch(search?: Partial<JobrightSearch>): JobrightSearch {
  const titleKeyword = String(search?.titleKeyword ?? "").trim();
  const location = String(search?.location ?? "").trim();
  return {
    titleKeyword: titleKeyword || DEFAULT_SEARCH.titleKeyword,
    location: location || DEFAULT_SEARCH.location,
  };
}

export function buildJobrightSearchUrl(search: Partial<JobrightSearch>, page = 0): string {
  const normalized = normalizeJobrightSearch(search);
  const url = new URL(`${JOBRIGHT_SITE}/jobs/search`);
  url.searchParams.set("titleKeyword", normalized.titleKeyword);
  if (normalized.location) url.searchParams.set("location", normalized.location);
  url.searchParams.set("visit", "search");
  if (page > 0) url.searchParams.set("page", String(page));
  return url.toString();
}

function parseRelativePublishDesc(desc: unknown, nowMs = Date.now()): string | null {
  const s = String(desc || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/just now|moments? ago|today|a few seconds/.test(s)) {
    return new Date(nowMs).toISOString();
  }

  let amount: number | undefined;
  let unit: string | undefined;
  let match = s.match(
    /(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|mos?|years?|yrs?)\s*ago/,
  );
  if (match) {
    amount = Number(match[1]);
    unit = match[2];
  } else {
    match = s.match(/(\d+)\s*(h|d|w)\s*ago/);
    if (!match) return null;
    amount = Number(match[1]);
    unit = match[2];
  }

  if (!Number.isFinite(amount) || amount < 0 || !unit) return null;

  let ms = 0;
  if (/^min/.test(unit)) ms = amount * 60 * 1000;
  else if (/^h/.test(unit)) ms = amount * 60 * 60 * 1000;
  else if (/^d/.test(unit)) ms = amount * 24 * 60 * 60 * 1000;
  else if (/^w/.test(unit)) ms = amount * 7 * 24 * 60 * 60 * 1000;
  else if (/^mo/.test(unit)) ms = amount * 30 * 24 * 60 * 60 * 1000;
  else if (/^y/.test(unit)) ms = amount * 365 * 24 * 60 * 60 * 1000;
  else return null;

  return new Date(nowMs - ms).toISOString();
}

/** Prefer real timestamps; return null when unknown (do not fake "now"). */
export function parseJobrightPublishDate(
  jr: Record<string, unknown>,
  nowMs = Date.now(),
): string | null {
  const raw =
    jr.publishTime ??
    jr.publishedAt ??
    jr.publishTimestamp ??
    jr.postedAt ??
    jr.createTime;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string" && raw.trim() && !Number.isNaN(Date.parse(raw))) {
    return new Date(raw).toISOString();
  }
  return parseRelativePublishDesc(jr.publishTimeDesc || jr.posted, nowMs);
}

/** Local display: 2026-09-18 21:34 */
export function formatJobrightPostedAtLocal(value: unknown): string {
  if (value == null || value === "") return "";
  const raw = String(value).trim();
  let d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const match = raw.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?Z?$/,
    );
    if (match) {
      d = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
      );
    }
  }
  if (Number.isNaN(d.getTime())) return raw;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function extractJobrightJobFields(raw: unknown): ScrapedJob & {
  id?: string | null;
  posted_at?: string | null;
  source?: string;
} {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const jr = (
    row.jobResult && typeof row.jobResult === "object"
      ? row.jobResult
      : row
  ) as Record<string, unknown>;
  const cr = (
    row.companyResult && typeof row.companyResult === "object"
      ? row.companyResult
      : {}
  ) as Record<string, unknown>;

  const jobId = serializeField(jr.jobId || jr.id || row.jobId);
  const applyUrl =
    serializeField(jr.applyLink || jr.applyUrl || jr.applicationUrl) ||
    (jobId ? `${JOBRIGHT_SITE}/jobs/info/${jobId}` : null);
  const postedAt = parseJobrightPublishDate(jr);
  const applicantsRaw =
    jr.applicantsCount ?? jr.applicantCount ?? jr.applyCount ?? jr.numApplicants;
  let applicants_count: string | null = null;
  if (typeof applicantsRaw === "number" && Number.isFinite(applicantsRaw)) {
    applicants_count = String(Math.round(applicantsRaw));
  } else if (applicantsRaw != null && String(applicantsRaw).trim()) {
    applicants_count = String(applicantsRaw).trim();
  }

  return {
    id: jobId,
    apply_url: applyUrl,
    posted_at: formatJobrightPostedAtLocal(postedAt),
    title: serializeField(jr.jobTitle || jr.title),
    company_name:
      serializeField(cr.companyName) ||
      serializeField(jr.companyName) ||
      serializeField(row.companyName),
    application_site: detectPlatform(applyUrl),
    applicants_count,
    // Compat for shared ScrapedJob / date filtering.
    core_job_title: null,
    requirements_summary: null,
    technical_tools: null,
    job_category: null,
    estimated_publish_date: postedAt,
    role_activities: null,
    company_tagline: null,
    source: "jobright",
  };
}

function postedAtSortKey(job: {
  estimated_publish_date?: string | null;
  posted_at?: string | null;
}): number {
  const raw = job.estimated_publish_date || job.posted_at || "";
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

function companyKey(job: { company_name?: string | null }): string {
  return String(job.company_name || "")
    .trim()
    .toLowerCase();
}

/** ATS Z→A, company A→Z (same company adjacent), newest posted first. */
export function sortJobrightJobsForCsv<T extends ScrapedJob & { posted_at?: string | null }>(
  jobs: T[],
): T[] {
  return [...jobs].sort((a, b) => {
    const atsA = String(a.application_site || "").toLowerCase();
    const atsB = String(b.application_site || "").toLowerCase();
    if (atsA !== atsB) return atsB.localeCompare(atsA);
    const coA = companyKey(a);
    const coB = companyKey(b);
    if (coA !== coB) return coA.localeCompare(coB);
    return postedAtSortKey(b) - postedAtSortKey(a);
  });
}

export function jobrightJobsToCsv(
  jobs: Array<ScrapedJob & { posted_at?: string | null }>,
): string {
  const headers = [
    "Application Link",
    "Date Posted",
    "Job Title",
    "Company",
    "Applicants",
    "Source Platform",
  ] as const;

  const escape = (value: string | null | undefined) => {
    const text = value ?? "";
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const sorted = sortJobrightJobsForCsv(jobs);
  const rows = sorted.map((job) =>
    [
      job.apply_url ?? "",
      formatJobrightPostedAtLocal(job.posted_at || job.estimated_publish_date || ""),
      job.title ?? "",
      job.company_name ?? "",
      job.applicants_count ?? "",
      job.application_site ?? "",
    ]
      .map(escape)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** SpreadsheetML (.xls) with white 14pt header text on dark blue. */
export function jobrightJobsToExcelXml(
  jobs: Array<ScrapedJob & { posted_at?: string | null }>,
): string {
  const headers = [
    "Application Link",
    "Date Posted",
    "Job Title",
    "Company",
    "Applicants",
    "Source Platform",
  ] as const;
  const sorted = sortJobrightJobsForCsv(jobs);
  const headerCells = headers
    .map(
      (h) =>
        `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`,
    )
    .join("");
  const dataRows = sorted
    .map((job) => {
      const values = [
        job.apply_url ?? "",
        formatJobrightPostedAtLocal(job.posted_at || job.estimated_publish_date || ""),
        job.title ?? "",
        job.company_name ?? "",
        job.applicants_count ?? "",
        job.application_site ?? "",
      ];
      const cells = values
        .map((v) => `<Cell><Data ss:Type="String">${escapeXml(v)}</Data></Cell>`)
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="14" ss:FontName="Calibri"/>
   <Interior ss:Color="#1B4F72" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Jobs">
  <Table>
   <Column ss:Width="280"/>
   <Column ss:Width="110"/>
   <Column ss:Width="220"/>
   <Column ss:Width="120"/>
   <Column ss:Width="80"/>
   <Column ss:Width="120"/>
   <Row ss:StyleID="Header">${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function collectJobRowsFromPayload(payload: unknown, out: unknown[]): void {
  if (!payload) return;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        if (row.jobResult || row.jobTitle || row.jobId || row.applyLink) {
          out.push(item);
        } else {
          collectJobRowsFromPayload(item, out);
        }
      }
    }
    return;
  }
  if (typeof payload !== "object") return;
  const obj = payload as Record<string, unknown>;
  for (const key of ["jobList", "jobs", "list", "result", "data", "records"]) {
    if (obj[key] != null) collectJobRowsFromPayload(obj[key], out);
  }
}

function extractJobListFromNextData(html: string): {
  jobList: unknown[];
  totalJobs: number | null;
} {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) return { jobList: [], totalJobs: null };
  try {
    const data = JSON.parse(match[1]) as {
      props?: { pageProps?: Record<string, unknown> };
    };
    const pageProps = data?.props?.pageProps ?? {};
    const jobList = Array.isArray(pageProps.jobList)
      ? pageProps.jobList
      : Array.isArray(pageProps.jobs)
        ? pageProps.jobs
        : Array.isArray((pageProps.result as { jobList?: unknown })?.jobList)
          ? ((pageProps.result as { jobList: unknown[] }).jobList)
          : [];
    const totalJobs =
      typeof pageProps.totalJobs === "number"
        ? pageProps.totalJobs
        : typeof pageProps.total === "number"
          ? pageProps.total
          : typeof (pageProps.result as { totalJobs?: number })?.totalJobs === "number"
            ? (pageProps.result as { totalJobs: number }).totalJobs
            : null;
    return { jobList, totalJobs };
  } catch {
    return { jobList: [], totalJobs: null };
  }
}

async function createBrowserPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({
    userAgent: USER_AGENT,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  page.setDefaultTimeout(PAGE_LOAD_TIMEOUT_MS);
  return page;
}

async function waitForJobrightReady(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const challengeUrl = /\/_jr\/security\/challenge/i.test(page.url());
  const hasTurnstile = await page.locator('iframe[src*="cloudflare"]').count();
  if (challengeUrl || hasTurnstile > 0) {
    await page
      .waitForFunction(
        () =>
          !/\/_jr\/security\/challenge/i.test(location.href) &&
          !document.querySelector('iframe[src*="cloudflare"]'),
        { timeout: 25_000 },
      )
      .catch(() => {});
  }

  await page.waitForSelector("script#__NEXT_DATA__", { timeout: 15_000 }).catch(() => {});
}

/**
 * After SSR first page, paginate via swan-api using cookies from the browser session.
 * Falls back gracefully if the API shape changes or auth is required.
 */
async function fetchSearchApiPage(
  page: Page,
  search: JobrightSearch,
  position: number,
  count: number,
): Promise<{ rows: unknown[]; total: number | null }> {
  const candidates = [
    `${SWAN_API}/swan/search/list/jobs?titleKeyword=${encodeURIComponent(search.titleKeyword)}&location=${encodeURIComponent(search.location)}&position=${position}&count=${count}`,
    `${SWAN_API}/swan/job/search/list?titleKeyword=${encodeURIComponent(search.titleKeyword)}&location=${encodeURIComponent(search.location)}&position=${position}&count=${count}`,
    `${SWAN_API}/swan/recommend/list/jobs?position=${position}&count=${count}${position === 0 ? "&refresh=true" : ""}`,
  ];

  for (const url of candidates) {
    try {
      const response = await page.request.get(url, {
        headers: {
          Accept: "application/json",
          Referer: `${JOBRIGHT_SITE}/`,
          Origin: JOBRIGHT_SITE,
        },
        timeout: 30_000,
      });
      if (!response.ok()) continue;
      const json = (await response.json().catch(() => null)) as unknown;
      if (!json) continue;
      const rows: unknown[] = [];
      collectJobRowsFromPayload(json, rows);
      if (rows.length === 0) continue;
      const total =
        typeof (json as { total?: number }).total === "number"
          ? (json as { total: number }).total
          : typeof (json as { totalJobs?: number }).totalJobs === "number"
            ? (json as { totalJobs: number }).totalJobs
            : typeof (json as { result?: { total?: number } }).result?.total === "number"
              ? (json as { result: { total: number } }).result.total
              : null;
      return { rows, total };
    } catch {
      /* try next endpoint */
    }
  }

  return { rows: [], total: null };
}

export async function scrapeJobrightJobs(
  options?: JobrightScrapeOptions,
): Promise<ScrapeJobsResult> {
  const search = normalizeJobrightSearch(options?.search);
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? 5, 15));
  const delayMs = Math.max(250, Math.min(options?.delayMs ?? 500, 3000));
  const onProgress = options?.onProgress;
  const pageSize = 20;

  const byId = new Map<string, ScrapedJob>();
  let reportedTotal: number | null = null;
  let pagesFetched = 0;

  const addRows = (rows: unknown[]) => {
    for (const row of rows) {
      const job = extractJobrightJobFields(row);
      const key =
        String(job.id || "").trim() ||
        String(job.apply_url || "").trim() ||
        `${job.company_name || ""}::${job.title || ""}`;
      if (!key || byId.has(key)) continue;
      const { id: _id, ...scraped } = job;
      byId.set(key, scraped);
    }
  };

  onProgress?.({
    step: "launching",
    message: "Starting browser…",
    maxPages,
  });

  const browser = await launchScrapeBrowser();
  try {
    const page = await createBrowserPage(browser);
    const networkRows: unknown[] = [];

    page.on("response", (response: Response) => {
      const url = response.url();
      if (!/swan-api\.jobright\.ai/i.test(url)) return;
      if (!response.ok()) return;
      void response
        .json()
        .then((json) => {
          collectJobRowsFromPayload(json, networkRows);
        })
        .catch(() => {});
    });

    onProgress?.({
      step: "warming",
      message: `Opening Jobright search (${search.titleKeyword})…`,
      maxPages,
    });

    const searchUrl = buildJobrightSearchUrl(search, 0);
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await waitForJobrightReady(page);

    const html = await page.content();
    if (/\/_jr\/security\/challenge/i.test(page.url()) || /one quick security check/i.test(html)) {
      throw new Error(
        "Jobright blocked the scrape with a security check. Try again later, or scrape from the extension while signed in.",
      );
    }

    const initial = extractJobListFromNextData(html);
    addRows(initial.jobList);
    reportedTotal = initial.totalJobs;
    pagesFetched = initial.jobList.length > 0 ? 1 : 0;

    onProgress?.({
      step: "session_ready",
      message:
        reportedTotal != null
          ? `SSR loaded ${byId.size} jobs (Jobright reports ${reportedTotal} total)`
          : `SSR loaded ${byId.size} jobs`,
      maxPages,
      jobsSoFar: byId.size,
      pagesFetched,
    });

    // Scroll to trigger client-side loads, then harvest intercepted swan-api payloads.
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 2400);
      await sleep(700);
    }
    addRows(networkRows);

    // Paginate via swan-api with session cookies (correct multi-page path when available).
    for (let pageIndex = pagesFetched > 0 ? 1 : 0; pageIndex < maxPages; pageIndex += 1) {
      const position = pageIndex * pageSize;
      if (reportedTotal != null && byId.size >= reportedTotal) break;

      onProgress?.({
        step: "fetching_page",
        message: `Fetching Jobright API page ${pageIndex + 1} of up to ${maxPages}…`,
        page: pageIndex + 1,
        maxPages,
        jobsSoFar: byId.size,
        pagesFetched,
      });

      const before = byId.size;
      const { rows, total } = await fetchSearchApiPage(page, search, position, pageSize);
      if (total != null) reportedTotal = total;

      if (rows.length === 0) {
        // Fallback: reload SSR URL with page=N (often identical — stop if no new jobs).
        if (pageIndex > 0) {
          await page.goto(buildJobrightSearchUrl(search, pageIndex), {
            waitUntil: "domcontentloaded",
            timeout: PAGE_LOAD_TIMEOUT_MS,
          });
          await waitForJobrightReady(page);
          const again = extractJobListFromNextData(await page.content());
          addRows(again.jobList);
          if (again.totalJobs != null) reportedTotal = again.totalJobs;
        }
        if (byId.size === before) break;
      } else {
        addRows(rows);
        if (byId.size === before) break;
      }

      pagesFetched += 1;
      onProgress?.({
        step: "page_done",
        message: `Page ${pageIndex + 1} done — ${byId.size} jobs so far`,
        page: pageIndex + 1,
        maxPages,
        jobsSoFar: byId.size,
        pagesFetched,
      });

      if (pageIndex < maxPages - 1) await sleep(delayMs);
    }
  } catch (error) {
    const message = formatFetchError(error);
    if (byId.size === 0) {
      const proxyHint = getScrapeProxyConfig()
        ? " Check that your residential proxy is working."
        : " Set HIRING_CAFE_PROXY (Webshare) if Cloudflare blocks you.";
      throw new Error(`Could not scrape Jobright: ${message}.${proxyHint}`);
    }
  } finally {
    onProgress?.({
      step: "closing",
      message: "Closing browser…",
      jobsSoFar: byId.size,
      pagesFetched,
      maxPages,
    });
    await browser.close().catch(() => {});
  }

  const jobs = Array.from(byId.values());
  if (jobs.length === 0) {
    throw new Error(
      "Jobright returned no jobs. Try a different keyword, complete any security check, or scrape while signed in via the extension.",
    );
  }

  return {
    jobs,
    pagesFetched: Math.max(pagesFetched, 1),
    reportedTotal,
  };
}
