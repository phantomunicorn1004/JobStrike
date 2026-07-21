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
    const excludeResumeDb = body.excludeResumeDb !== false;

    const [scraped, blockedCompanies, resumeDbCompanies] = await Promise.all([
      scrapeHiringCafeJobs(dateWindow as JobScraperDateWindow),
      excludeBlocked ? listBlockedCompanies(user.id) : Promise.resolve([]),
      excludeResumeDb ? listDistinctResumeDbCompanies(user.id) : Promise.resolve([]),
    ]);

    const dedupedJobs = dedupeJobs(scraped.jobs);
    const { filtered, removedBlockedCount, removedResumeCount } = filterJobsByCompany(
      dedupedJobs,
      blockedCompanies.map((company) => company.companyName),
      resumeDbCompanies,
    );

    return corsJson({
      jobs: filtered,
      csv: jobsToCsv(filtered),
      stats: {
        scraped: scraped.jobs.length,
        deduped: dedupedJobs.length,
        removedBlocked: excludeBlocked ? removedBlockedCount : 0,
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
