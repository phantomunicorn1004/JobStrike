"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { JobPipelineCard, type PipelineStage, type AppliedJob, type TechnicalJob, type PipelineCardJob } from "./JobPipelineCard";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ClipboardList, Workflow, CheckCircle, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES: { id: PipelineStage; label: string; icon: React.ReactNode }[] = [
  { id: "applied", label: "Applied", icon: <ClipboardList className="h-5 w-5" /> },
  { id: "technical", label: "Technical", icon: <Workflow className="h-5 w-5" /> },
  { id: "final", label: "Final", icon: <CheckCircle className="h-5 w-5" /> },
];

type DragPayload = { source: "jobs" | "technical_jobs"; id: number; stage: PipelineStage };

export function JobsPipelineBoard() {
  const [applied, setApplied] = useState<AppliedJob[]>([]);
  const [technical, setTechnical] = useState<TechnicalJob[]>([]);
  const [final, setFinal] = useState<TechnicalJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [movingId, setMovingId] = useState<{ source: string; id: number } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<PipelineStage | null>(null);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [newJob, setNewJob] = useState({
    name: "",
    title: "",
    company_name: "",
    job_link: "",
    resume_link: "",
    note: "",
  });
  const [isAdding, setIsAdding] = useState(false);
  const supabase = getSupabaseBrowserClient();

  const fetchAll = useCallback(async () => {
    try {
      const [jobsRes, techRes] = await Promise.all([
        supabase.from("jobs").select("*").order("id", { ascending: false }),
        supabase.from("technical_jobs").select("*").order("id", { ascending: false }),
      ]);
      if (jobsRes.error) throw jobsRes.error;
      if (techRes.error) throw techRes.error;

      const appliedRows: AppliedJob[] = (jobsRes.data || []).map((row: Record<string, unknown>) => ({
        id: row.id as number,
        source: "jobs",
        name: row.name as string,
        title: row.title as string,
        company_name: row.company_name as string,
        job_link: row.job_link as string,
        resume_link: row.resume_link as string,
        note: (row.note as string) ?? "",
        created_at: row.created_at as string,
      }));
      const techRows: TechnicalJob[] = (techRes.data || []).map((row: Record<string, unknown>) => ({
        id: row.id as number,
        source: "technical_jobs",
        name: row.name as string,
        company_name: row.company_name as string,
        title: row.title as string,
        resume_link: row.resume_link as string,
        recruiter_name: row.recruiter_name as string | null,
        recruiter_contact: row.recruiter_contact as string | null,
        first_round_date: row.first_round_date as string | null,
        first_round_result: row.first_round_result as string | null,
        second_round_date: row.second_round_date as string | null,
        second_round_result: row.second_round_result as string | null,
        third_round_date: row.third_round_date as string | null,
        third_round_result: row.third_round_result as string | null,
        status: row.status as string | null,
        created_at: row.created_at as string,
      }));

      setApplied(appliedRows);
      setTechnical(techRows.filter((j) => j.status !== "success"));
      setFinal(techRows.filter((j) => j.status === "success"));
    } catch (e) {
      console.error("Error fetching pipeline:", e);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleAddJob = useCallback(async () => {
    if (!newJob.name.trim() || !newJob.title.trim() || !newJob.company_name.trim() || !newJob.job_link.trim() || !newJob.resume_link.trim()) {
      return;
    }
    setIsAdding(true);
    try {
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          name: newJob.name.trim(),
          title: newJob.title.trim(),
          company_name: newJob.company_name.trim(),
          job_link: newJob.job_link.trim(),
          resume_link: newJob.resume_link.trim(),
          note: newJob.note.trim() || "",
        })
        .select();
      if (error) throw error;
      const row = data?.[0] as Record<string, unknown> | undefined;
      if (row) {
        setApplied((prev) => [
          {
            id: row.id as number,
            source: "jobs",
            name: row.name as string,
            title: row.title as string,
            company_name: row.company_name as string,
            job_link: row.job_link as string,
            resume_link: row.resume_link as string,
            note: (row.note as string) ?? "",
            created_at: row.created_at as string,
          },
          ...prev,
        ]);
      }
      setNewJob({ name: "", title: "", company_name: "", job_link: "", resume_link: "", note: "" });
      setAddJobOpen(false);
    } catch (e) {
      console.error("Add job failed:", e);
    } finally {
      setIsAdding(false);
    }
  }, [newJob, supabase]);

  const moveToTechnical = useCallback(
    async (payload: DragPayload) => {
      if (payload.source === "jobs" && payload.stage === "applied") {
        const job = applied.find((j) => j.id === payload.id);
        if (!job) return;
        setMovingId({ source: "jobs", id: job.id });
        try {
          const { data, error } = await supabase
            .from("technical_jobs")
            .insert({
              name: job.name,
              company_name: job.company_name,
              title: job.title,
              resume_link: job.resume_link,
              status: "ongoing",
            })
            .select();
          if (error) throw error;
          await supabase.from("jobs").delete().eq("id", job.id);
          const newRow = data?.[0];
          if (newRow)
            setTechnical((prev) => [
              { ...newRow, source: "technical_jobs" as const } as TechnicalJob,
              ...prev,
            ]);
          setApplied((prev) => prev.filter((j) => j.id !== job.id));
        } catch (e) {
          console.error("Move to technical failed:", e);
        } finally {
          setMovingId(null);
        }
      }
      if (payload.source === "technical_jobs" && payload.stage === "final") {
        const job = final.find((j) => j.id === payload.id);
        if (!job) return;
        setMovingId({ source: "technical_jobs", id: job.id });
        try {
          await supabase.from("technical_jobs").update({ status: "ongoing" }).eq("id", job.id);
          setFinal((prev) => prev.filter((j) => j.id !== job.id));
          setTechnical((prev) => [job, ...prev]);
        } catch (e) {
          console.error("Move back to technical failed:", e);
        } finally {
          setMovingId(null);
        }
      }
    },
    [applied, final, supabase]
  );

  const moveToFinal = useCallback(
    async (payload: DragPayload) => {
      if (payload.source !== "technical_jobs") return;
      const job = technical.find((j) => j.id === payload.id);
      if (!job) return;
      setMovingId({ source: "technical_jobs", id: job.id });
      try {
        await supabase.from("technical_jobs").update({ status: "success" }).eq("id", job.id);
        setTechnical((prev) => prev.filter((j) => j.id !== job.id));
        setFinal((prev) => [{ ...job, status: "success" }, ...prev]);
      } catch (e) {
        console.error("Move to final failed:", e);
      } finally {
        setMovingId(null);
      }
    },
    [technical, supabase]
  );

  const moveToApplied = useCallback(
    async (payload: DragPayload) => {
      if (payload.source !== "technical_jobs") return;
      const job = technical.find((j) => j.id === payload.id) || final.find((j) => j.id === payload.id);
      if (!job) return;
      setMovingId({ source: "technical_jobs", id: job.id });
      try {
        const { error } = await supabase.from("jobs").insert({
          name: job.name,
          title: job.title,
          company_name: job.company_name,
          job_link: "",
          resume_link: job.resume_link,
          note: "",
        });
        if (error) throw error;
        await supabase.from("technical_jobs").delete().eq("id", job.id);
        setTechnical((prev) => prev.filter((j) => j.id !== job.id));
        setFinal((prev) => prev.filter((j) => j.id !== job.id));
        await fetchAll();
      } catch (e) {
        console.error("Move to applied failed:", e);
      } finally {
        setMovingId(null);
      }
    },
    [technical, final, supabase, fetchAll]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStage: PipelineStage) => {
      e.preventDefault();
      setDragOverColumn(null);
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      let payload: DragPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (payload.stage === targetStage) return;

      if (targetStage === "applied") moveToApplied(payload);
      else if (targetStage === "technical") moveToTechnical(payload);
      else if (targetStage === "final") moveToFinal(payload);
    },
    [moveToApplied, moveToTechnical, moveToFinal]
  );

  const handleDragOver = useCallback((e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(stage);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  if (isLoading) {
    return (
      <Card className="flex min-h-[400px] w-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <h1 className="text-2xl font-semibold">Job Pipeline</h1>
      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        {STAGES.map(({ id: stageId, label, icon }) => {
          let jobs: PipelineCardJob[] = [];
          if (stageId === "applied") jobs = applied;
          if (stageId === "technical") jobs = technical;
          if (stageId === "final") jobs = final;

          return (
            <div
              key={stageId}
              className={cn(
                "flex min-h-[320px] flex-col rounded-xl border-2 border-dashed bg-muted/30 p-3 transition-colors",
                dragOverColumn === stageId && "border-primary bg-muted/50"
              )}
              onDragOver={(e) => handleDragOver(e, stageId)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stageId)}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  {icon}
                  <span>{label}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-sm text-muted-foreground">
                    {jobs.length}
                  </span>
                </div>
                {stageId === "applied" && (
                  <Dialog open={addJobOpen} onOpenChange={setAddJobOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="shrink-0 gap-1">
                        <Plus className="h-4 w-4" />
                        Add
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>Add applied job</DialogTitle>
                      </DialogHeader>
                      <div className="grid gap-3 py-2">
                        <Input
                          placeholder="Name *"
                          value={newJob.name}
                          onChange={(e) => setNewJob((p) => ({ ...p, name: e.target.value }))}
                        />
                        <Input
                          placeholder="Job title *"
                          value={newJob.title}
                          onChange={(e) => setNewJob((p) => ({ ...p, title: e.target.value }))}
                        />
                        <Input
                          placeholder="Company name *"
                          value={newJob.company_name}
                          onChange={(e) => setNewJob((p) => ({ ...p, company_name: e.target.value }))}
                        />
                        <Input
                          placeholder="Job link *"
                          type="url"
                          value={newJob.job_link}
                          onChange={(e) => setNewJob((p) => ({ ...p, job_link: e.target.value }))}
                        />
                        <Input
                          placeholder="Resume link *"
                          type="url"
                          value={newJob.resume_link}
                          onChange={(e) => setNewJob((p) => ({ ...p, resume_link: e.target.value }))}
                        />
                        <Textarea
                          placeholder="Note (optional)"
                          value={newJob.note}
                          onChange={(e) => setNewJob((p) => ({ ...p, note: e.target.value }))}
                          rows={2}
                          className="resize-none"
                        />
                      </div>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button type="button" variant="outline">
                            Cancel
                          </Button>
                        </DialogClose>
                        <Button onClick={handleAddJob} disabled={isAdding}>
                          {isAdding ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Adding…
                            </>
                          ) : (
                            "Add job"
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                {jobs.map((job) => (
                  <JobPipelineCard
                    key={`${job.source}-${job.id}`}
                    job={job}
                    stage={stageId}
                    isDragging={movingId?.source === job.source && movingId?.id === job.id}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
