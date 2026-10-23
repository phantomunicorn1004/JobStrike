"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { CalendarClock, ExternalLink, Download, GripVertical, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { statusDot } from "@/lib/ui/semanticColors";
import type { StageDates } from "@/lib/jobs/pipelineCardUtils";

export type { StageDates };

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
  stage_entered_at?: string | null;
  stage_dates?: StageDates;
  recruiter_name?: string | null;
  recruiter_contact?: string | null;
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
  job_description?: string | null;
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
  stage_entered_at?: string | null;
  stage_dates?: StageDates;
};

export type PipelineCardJob = AppliedJob | TechnicalJob;

function isTechnicalJob(job: PipelineCardJob): job is TechnicalJob {
  return job.source === "technical_jobs";
}

const StatusDot = ({ result }: { result?: string | null }) => {
  if (result === "success")
    return <span className={cn("h-2 w-2 rounded-full", statusDot.success)} title="Success" />;
  if (result === "fail")
    return <span className={cn("h-2 w-2 rounded-full", statusDot.fail)} title="Failed" />;
  return <span className={cn("h-2 w-2 rounded-full", statusDot.pending)} title="Ongoing" />;
};

type JobPipelineCardProps = {
  job: PipelineCardJob;
  stageId: PipelineStageId;
  isDragging?: boolean;
  isMoving?: boolean;
  onDetail?: () => void;
  /** The application's next interview, shown as a chip. */
  nextInterview?: NextInterview;
};

export type NextInterview = { startsAt: string; round: string };

/** The Resume DB application a card belongs to ("Resume DB #123" in its notes). */
export function applicationIdOfCard(job: PipelineCardJob): number | null {
  const text = ("note" in job ? job.note : (job as TechnicalJob).job_description) ?? "";
  const match = /Resume DB #(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

const ROUND_NAMES: Record<string, string> = { screen: "Screen", technical: "Technical", final: "Final" };

function interviewChipText(next: NextInterview): string {
  const date = new Date(next.startsAt);
  const days = (date.getTime() - Date.now()) / 86_400_000;
  const when =
    days < 6
      ? date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
      : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${ROUND_NAMES[next.round] ?? "Interview"} ${when}`;
}

export function JobPipelineCard({ job, stageId, isDragging, isMoving, onDetail, nextInterview }: JobPipelineCardProps) {
  const technical = isTechnicalJob(job) ? job : null;

  return (
    <Card
      className={cn(
        "cursor-grab active:cursor-grabbing rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        (isDragging || isMoving) && "pointer-events-none opacity-50",
      )}
      draggable={!isMoving}
      onDragStart={(e) => {
        if (isMoving) {
          e.preventDefault();
          return;
        }
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
          {job.name && (
            <p className="text-xs text-muted-foreground truncate" title={job.name}>
              {job.name}
            </p>
          )}
          {nextInterview ? (
            <a
              href="/calendar"
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-500/15 dark:text-violet-300"
              title="Next interview: open the Calendar"
              onClick={(e) => e.stopPropagation()}
            >
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span className="truncate">{interviewChipText(nextInterview)}</span>
            </a>
          ) : null}
          {technical?.recruiter_name && (
            <p className="text-xs text-muted-foreground truncate">
              {technical.recruiter_name}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onDetail && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs rounded-md"
                onClick={(e) => {
                  e.stopPropagation();
                  onDetail();
                }}
              >
                <Info className="h-3 w-3 mr-1" />
                Detail
              </Button>
            )}
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
