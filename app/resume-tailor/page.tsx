import React, { Suspense } from "react";
import { ResumeTailorPageClient } from "@/components/resume-tailor/ResumeTailorPageClient";

// Force dynamic rendering to prevent static prerendering
// Page uses Suspense with client components that may have Supabase dependencies
export const dynamic = "force-dynamic";

export default function ResumeTailorPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <ResumeTailorPageClient />
    </Suspense>
  );
}
