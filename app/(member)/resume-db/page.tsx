import React, { Suspense } from "react";
import { ResumeDBPageClient } from "@/components/resume-tailor/ResumeDBPageClient";

export const dynamic = "force-dynamic";

export default function ResumeDBPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <ResumeDBPageClient />
    </Suspense>
  );
}

