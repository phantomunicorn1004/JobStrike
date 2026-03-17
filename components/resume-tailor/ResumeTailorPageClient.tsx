"use client";

import React, { useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { ResumeTailor } from "@/components/resume-tailor/ResumeTailor";
import { ResumeTailorWorkflow } from "@/components/resume-tailor/workflow";
import { Button } from "@/components/ui/button";
import { Workflow, FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";

export function ResumeTailorPageClient() {
  const [view, setView] = useState<"workflow" | "classic">("workflow");

  return (
    <JobsLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex rounded-lg border border-border p-1 bg-muted/30">
            <Button
              variant={view === "workflow" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("workflow")}
              className={cn("gap-2", view !== "workflow" && "text-muted-foreground")}
            >
              <Workflow className="h-4 w-4" />
              Workflow
            </Button>
            <Button
              variant={view === "classic" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("classic")}
              className={cn("gap-2", view !== "classic" && "text-muted-foreground")}
            >
              <FileEdit className="h-4 w-4" />
              Classic
            </Button>
          </div>
        </div>
        {view === "workflow" ? (
          <ResumeTailorWorkflow />
        ) : (
          <ResumeTailor />
        )}
      </div>
    </JobsLayout>
  );
}
