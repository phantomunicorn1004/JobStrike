"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { ExternalLink, Download, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/** Stage id: "applied" is reserved for jobs table; others are technical_jobs.stage_id */
export type PipelineStageId = string;

/** Applied job from `jobs` table */
export type AppliedJob = {
  id: number;
  source: "jobs";
  name: string;
  title: string;
  company_name: string;
  job_link: string;
  resume_link: string;
  note: string;
  created_at: string;
};

/** Technical/Final job from `technical_jobs` table */
export type TechnicalJob = {
  id: number;
  source: "technical_jobs";
  stage_id?: string | null;
  name: string;
  company_name: string;
  title: string;
  resume_link: string;
  recruiter_name?: string | null;
  recruiter_contact?: string | null;
  first_round_date?: string | null;
  first_round_result?: string | null;
  second_round_date?: string | null;
  second_round_result?: string | null;
  third_round_date?: string | null;
  third_round_result?: string | null;
  status?: string | null;
  created_at?: string;
};

export type PipelineCardJob = AppliedJob | TechnicalJob;

function isTechnicalJob(job: PipelineCardJob): job is TechnicalJob {
  return job.source === "technical_jobs";
}

const StatusDot = ({ result }: { result?: string | null }) => {
  if (result === "success")
    return <span className="h-2 w-2 rounded-full bg-green-500" title="Success" />;
  if (result === "fail")
    return <span className="h-2 w-2 rounded-full bg-red-500" title="Failed" />;
  return <span className="h-2 w-2 rounded-full bg-amber-500" title="Ongoing" />;
};

type JobPipelineCardProps = {
  job: PipelineCardJob;
  stageId: PipelineStageId;
  isDragging?: boolean;
};

export function JobPipelineCard({ job, stageId, isDragging }: JobPipelineCardProps) {
  const technical = isTechnicalJob(job) ? job : null;

  return (
    <Card
      className={cn(
        "cursor-grab active:cursor-grabbing rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        isDragging && "opacity-60 shadow-lg"
      )}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            source: job.source,
            id: job.id,
            stageId: stageId,
            ...(job.source === "technical_jobs" && "stage_id" in job && { stage_id: (job as TechnicalJob).stage_id }),
          })
        );
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 touch-none cursor-grab text-muted-foreground" title="Drag to move">
          <GripVertical className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium text-foreground truncate" title={job.title}>
            {job.title}
          </p>
          <p className="text-sm text-muted-foreground truncate" title={job.company_name}>
            {job.company_name}
          </p>
          {technical?.recruiter_name && (
            <p className="text-xs text-muted-foreground truncate">
              {technical.recruiter_name}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {"job_link" in job && job.job_link && (
              <a
                href={job.job_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
                Job
              </a>
            )}
            {job.resume_link && (
              <a
                href={job.resume_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-3 w-3" />
                Resume
              </a>
            )}
            {technical && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <StatusDot result={technical.status} />
                {technical.status || "ongoing"}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
