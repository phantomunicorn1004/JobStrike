"use client";

import React from "react";
import JobsLayout from "@/app/jobs-layout";
import { ResumeTailor } from "@/components/resume-tailor/ResumeTailor";

export function ResumeTailorPageClient() {
  return (
    <JobsLayout>
      <ResumeTailor />
    </JobsLayout>
  );
}
