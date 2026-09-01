import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  applyOptionalScrapeFilters,
  dedupeJobs,
  filterJobsByPublishDate,
  jobsToCsv,
  scrapeHiringCafeJobs,
  type JobScraperDateWindow,
} from "@/lib/job-scraper";
import {
  listBlockedAts,
  listBlockedCompanies,
  listBlockedJobs,
  listDistinctResumeDbCompanies,
  listRegisteredJobsForCandidate,
} from "@/lib/job-scraper-repository";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const dateWindow =
      body.dateWindow === "1d" || body.dateWindow === "7d" ? body.dateWindow : "3d";
    const excludeBlocked = body.excludeBlocked !== false;
    const excludeBlockedAts = body.excludeBlockedAts !== false;
    const excludeRegisteredJobs = body.excludeRegisteredJobs === true;
    const excludeRegisteredCompanies = body.excludeRegisteredCompanies !== false;
    const candidateFilter =
      typeof body.candidateFilter === "string" ? body.candidateFilter.trim() : "";

    const excludeBlockedJobs = body.excludeBlockedJobs !== false;

    const needsCandidateData = excludeRegisteredJobs || excludeRegisteredCompanies;
    if (needsCandidateData && !candidateFilter) {
      return corsJson(
        { error: "Select a profile to use Resume DB job/company filters." },
        { status: 400 },
      );
    }

    const [scraped, blockedCompanies, blockedAts, blockedJobs, registeredCompanies, registeredJobs] =
      await Promise.all([
        scrapeHiringCafeJobs(dateWindow as JobScraperDateWindow),
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

    const dedupedJobs = dedupeJobs(scraped.jobs);
    const {
      filtered: baseJobs,
      removedByDate,
      cutoffIso,
    } = filterJobsByPublishDate(dedupedJobs, dateWindow as JobScraperDateWindow);

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

    return corsJson({
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
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
