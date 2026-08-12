import React, { Suspense } from "react";
import { ResumeBuilderPageClient } from "@/components/resume-builder/ResumeBuilderPageClient";

export const dynamic = "force-dynamic";

export default function ResumeBuilderPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <ResumeBuilderPageClient />
    </Suspense>
  );
}
