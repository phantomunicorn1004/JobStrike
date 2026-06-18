"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Download, Loader2 } from "lucide-react";
import type { PipelineCardJob } from "./JobPipelineCard";
import type { StageDates } from "@/lib/jobs/pipelineCardUtils";
import {
  cardNotes,
  fromDateLocalValue,
  toDateLocalValue,
} from "@/lib/jobs/pipelineCardUtils";

export type PipelineCardDetailsUpdate = {
  stage_dates: StageDates;
  recruiter_name: string;
  recruiter_contact: string;
  notes: string;
};

type StageOption = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: PipelineCardJob | null;
  currentStageId: string;
  stages: StageOption[];
  onSave: (
    job: PipelineCardJob,
    update: PipelineCardDetailsUpdate,
  ) => Promise<void>;
};

export function JobPipelineDetailDialog({
  open,
  onOpenChange,
  job,
  currentStageId,
  stages,
  onSave,
}: Props) {
  const [stageDates, setStageDates] = useState<Record<string, string>>({});
  const [recruiterName, setRecruiterName] = useState("");
  const [recruiterContact, setRecruiterContact] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!job || !open) return;
    const initialDates: Record<string, string> = {};
    for (const stage of stages) {
      const iso = job.stage_dates?.[stage.id] ?? "";
      initialDates[stage.id] = toDateLocalValue(iso);
    }
    if (!initialDates[currentStageId]) {
      initialDates[currentStageId] = toDateLocalValue(
        job.stage_entered_at || job.created_at,
      );
    }
    setStageDates(initialDates);
    setRecruiterName(job.recruiter_name ?? "");
    setRecruiterContact(job.recruiter_contact ?? "");
    setNotes(cardNotes(job));
  }, [job, open, stages, currentStageId]);

  if (!job) return null;

  const handleSave = async () => {
    const parsedDates: StageDates = {};
    for (const stage of stages) {
      const iso = fromDateLocalValue(stageDates[stage.id] ?? "");
      if (iso) parsedDates[stage.id] = iso;
    }

    setSaving(true);
    try {
      await onSave(job, {
        stage_dates: parsedDates,
        recruiter_name: recruiterName.trim(),
        recruiter_contact: recruiterContact.trim(),
        notes: notes.trim(),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Application details</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="rounded-lg border bg-muted/20 p-3 text-sm space-y-1.5">
            <p>
              <span className="text-muted-foreground">Profile: </span>
              <span className="font-medium">{job.name || "—"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Title: </span>
              <span className="font-medium">{job.title || "—"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Company: </span>
              <span className="font-medium">{job.company_name || "—"}</span>
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Registered date per stage</Label>
            <p className="text-xs text-muted-foreground">
              Set or edit when this application entered each stage.
            </p>
            <div className="grid gap-2">
              {stages.map((stage) => (
                <label
                  key={stage.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-sm"
                >
                  <span className="truncate text-muted-foreground">{stage.name}</span>
                  <Input
                    type="date"
                    value={stageDates[stage.id] ?? ""}
                    onChange={(e) =>
                      setStageDates((prev) => ({
                        ...prev,
                        [stage.id]: e.target.value,
                      }))
                    }
                    className="h-8 w-[150px] text-xs"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pipeline-recruiter">Recruiter name</Label>
              <Input
                id="pipeline-recruiter"
                value={recruiterName}
                onChange={(e) => setRecruiterName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pipeline-recruiter-contact">Recruiter contact</Label>
              <Input
                id="pipeline-recruiter-contact"
                value={recruiterContact}
                onChange={(e) => setRecruiterContact(e.target.value)}
                placeholder="Email, phone, LinkedIn…"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pipeline-notes">Notes & description</Label>
            <Textarea
              id="pipeline-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Interview notes, requirements, follow-ups…"
              rows={4}
              className="resize-y"
            />
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            {"job_link" in job && job.job_link ? (
              <a
                href={job.job_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Job posting
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            {job.resume_link ? (
              <a
                href={job.resume_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Resume
                <Download className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
