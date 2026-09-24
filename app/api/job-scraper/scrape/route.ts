import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  applyOptionalScrapeFilters,
  dedupeJobs,
  filterJobsByPublishDate,
  jobsToCsv,
  normalizeJobScraperDateWindow,
} from "@/lib/job-scraper";
import {
  scrapeHiringCafeJobs,
  type HiringCafeScrapeProgress,
} from "@/lib/job-scraper-hiringcafe";
import {
  scrapeJobrightJobs,
  type JobrightScrapeProgress,
} from "@/lib/job-scraper-jobright";
import {
  listBlockedAts,
  listBlockedCompanies,
  listBlockedJobs,
  listDistinctResumeDbCompanies,
  listRegisteredJobsForCandidate,
} from "@/lib/job-scraper-repository";

export const runtime = "nodejs";
export const maxDuration = 300;

export function OPTIONS() {
  return corsOptions();
}

type ScrapeBody = {
  source?: string;
  dateWindow?: string;
  excludeBlocked?: boolean;
  excludeBlockedAts?: boolean;
  excludeBlockedJobs?: boolean;
  excludeRegisteredJobs?: boolean;
  excludeRegisteredCompanies?: boolean;
  candidateFilter?: string;
  stream?: boolean;
  titleKeyword?: string;
  location?: string;
};

type ProgressEvent = HiringCafeScrapeProgress | JobrightScrapeProgress;

function encodeNdjson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as ScrapeBody;
    const source = body.source === "jobright" ? "jobright" : "hiringcafe";
    const dateWindow = normalizeJobScraperDateWindow(body.dateWindow, "3d");
    const excludeBlocked = body.excludeBlocked !== false;
    const excludeBlockedAts = body.excludeBlockedAts !== false;
    const excludeRegisteredJobs = body.excludeRegisteredJobs === true;
    const excludeRegisteredCompanies = body.excludeRegisteredCompanies !== false;
    const candidateFilter =
      typeof body.candidateFilter === "string" ? body.candidateFilter.trim() : "";
    const stream = body.stream === true;
    const titleKeyword =
      typeof body.titleKeyword === "string" ? body.titleKeyword.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";

    const excludeBlockedJobs = body.excludeBlockedJobs !== false;

    const needsCandidateData = excludeRegisteredJobs || excludeRegisteredCompanies;
    if (needsCandidateData && !candidateFilter) {
      return corsJson(
        { error: "Select a profile to use Resume DB job/company filters." },
        { status: 400 },
      );
    }

    const runPipeline = async (onProgress?: (event: ProgressEvent) => void) => {
      const [
        scraped,
        blockedCompanies,
        blockedAts,
        blockedJobs,
        registeredCompanies,
        registeredJobs,
      ] = await Promise.all([
        source === "jobright"
          ? scrapeJobrightJobs({
              search: { titleKeyword, location },
              onProgress,
            })
          : scrapeHiringCafeJobs(dateWindow, { onProgress }),
        listBlockedCompanies(user.id),
        listBlockedAts(user.id),
        listBlockedJobs(user.id),
        needsCandidateData
          ? listDistinctResumeDbCompanies(user.id, candidateFilter)
          : Promise.resolve([] as string[]),
        excludeRegisteredJobs
          ? listRegisteredJobsForCandidate(user.id, candidateFilter)
          : Promise.resolve([]),
      ]);

      onProgress?.({
        step: "page_done",
        message: "Applying filters…",
        jobsSoFar: scraped.jobs.length,
        pagesFetched: scraped.pagesFetched,
      });

      const dedupedJobs = dedupeJobs(scraped.jobs);
      // Jobright often omits solid publish dates — keep undated rather than dropping all.
      const {
        filtered: baseJobs,
        removedByDate,
        cutoffIso,
      } = filterJobsByPublishDate(dedupedJobs, dateWindow, Date.now(), {
        keepUndated: source === "jobright",
      });

      const { filtered, stats: optionalStats } = applyOptionalScrapeFilters(baseJobs, {
        excludeRegisteredJobs,
        excludeRegisteredCompanies,
        excludeBlockedJobs,
        excludeBlockedCompanies: excludeBlocked,
        excludeBlockedAts,
        registeredJobs,
        registeredCompanies,
        blockedJobs: blockedJobs.map((job) => ({
          jobLink: job.jobLink,
          jobTitle: job.jobTitle,
          companyName: job.companyName,
        })),
        blockedCompanies: blockedCompanies.map((company) => company.companyName),
        blockedAts: blockedAts.map((ats) => ats.atsName),
      });

      return {
        source,
        baseJobs,
        jobs: filtered,
        csv: jobsToCsv(filtered),
        filterContext: {
          blockedCompanies: blockedCompanies.map((company) => company.companyName),
          blockedAts: blockedAts.map((ats) => ats.atsName),
          blockedJobs: blockedJobs.map((job) => ({
            jobLink: job.jobLink,
            jobTitle: job.jobTitle,
            companyName: job.companyName,
          })),
          registeredCompanies,
          registeredJobs,
          registeredJobCount: registeredJobs.length,
          registeredCompanyCount: registeredCompanies.length,
        },
        stats: {
          scraped: scraped.jobs.length,
          deduped: dedupedJobs.length,
          removedByDate,
          baseRemaining: baseJobs.length,
          removedRegisteredJobs: excludeRegisteredJobs
            ? optionalStats.removedRegisteredJobs
            : 0,
          removedRegisteredCompanies: excludeRegisteredCompanies
            ? optionalStats.removedRegisteredCompanies
            : 0,
          removedBlockedJobs: excludeBlockedJobs ? optionalStats.removedBlockedJobs : 0,
          removedBlocked: excludeBlocked ? optionalStats.removedBlocked : 0,
          removedAts: excludeBlockedAts ? optionalStats.removedAts : 0,
          remaining: filtered.length,
          pagesFetched: scraped.pagesFetched,
          reportedTotal: scraped.reportedTotal,
          dateCutoff: cutoffIso,
          dateWindow,
          source,
        },
      };
    };

    if (!stream) {
      const payload = await runPipeline();
      return corsJson(payload);
    }

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (value: unknown) => {
          controller.enqueue(encodeNdjson(value));
        };

        try {
          send({
            type: "progress",
            step: "launching",
            message:
              source === "jobright" ? "Starting Jobright scrape…" : "Starting scrape…",
          });

          const payload = await runPipeline((event) => {
            send({ type: "progress", ...event });
          });

          send({ type: "result", ...payload });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Scrape failed.";
          send({ type: "error", error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
