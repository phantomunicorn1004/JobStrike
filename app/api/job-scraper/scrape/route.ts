import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  dedupeJobs,
  filterJobsByCompany,
  jobsToCsv,
  scrapeHiringCafeJobs,
  type JobScraperDateWindow,
} from "@/lib/job-scraper";
import {
  listBlockedAts,
  listBlockedCompanies,
  listDistinctResumeDbCompanies,
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
    const excludeResumeDb = body.excludeResumeDb !== false;
    const candidateFilter =
      typeof body.candidateFilter === "string" ? body.candidateFilter.trim() : "";

    if (excludeResumeDb && !candidateFilter) {
      return corsJson(
        { error: "Select a candidate to exclude Resume DB companies." },
        { status: 400 },
      );
    }

    const [scraped, blockedCompanies, blockedAts, resumeDbCompanies] = await Promise.all([
      scrapeHiringCafeJobs(dateWindow as JobScraperDateWindow),
      excludeBlocked ? listBlockedCompanies(user.id) : Promise.resolve([]),
      excludeBlockedAts ? listBlockedAts(user.id) : Promise.resolve([]),
      excludeResumeDb
        ? listDistinctResumeDbCompanies(user.id, candidateFilter)
        : Promise.resolve([]),
    ]);

    const dedupedJobs = dedupeJobs(scraped.jobs);
    const { filtered, removedBlockedCount, removedResumeCount, removedAtsCount } =
      filterJobsByCompany(
        dedupedJobs,
        blockedCompanies.map((company) => company.companyName),
        resumeDbCompanies,
        blockedAts.map((ats) => ats.atsName),
      );

    return corsJson({
      jobs: filtered,
      csv: jobsToCsv(filtered),
      stats: {
        scraped: scraped.jobs.length,
        deduped: dedupedJobs.length,
        removedBlocked: excludeBlocked ? removedBlockedCount : 0,
        removedAts: excludeBlockedAts ? removedAtsCount : 0,
        removedResumeDb: excludeResumeDb ? removedResumeCount : 0,
        remaining: filtered.length,
        pagesFetched: scraped.pagesFetched,
        reportedTotal: scraped.reportedTotal,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
