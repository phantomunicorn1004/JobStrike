import { Suspense } from "react";
import { JobScraperPageClient } from "@/components/job-scraper/JobScraperPageClient";

export const dynamic = "force-dynamic";

export default function JobScraperPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <JobScraperPageClient />
    </Suspense>
  );
}
