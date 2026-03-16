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
import {
  JobPipelineCard,
  type PipelineStageId,
  type AppliedJob,
  type TechnicalJob,
  type PipelineCardJob,
} from "./JobPipelineCard";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ClipboardList,
  Workflow,
  CheckCircle,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StageConfig = { id: string; name: string; sort_order: number };

const DEFAULT_STAGES: StageConfig[] = [
  { id: "applied", name: "Applied", sort_order: 0 },
  { id: "technical", name: "Technical", sort_order: 1 },
  { id: "final", name: "Final", sort_order: 2 },
];

type DragPayload = {
  source: "jobs" | "technical_jobs";
  id: number;
  stageId: string;
  stage_id?: string | null;
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

type ProfileOption = { id: number; full_name: string };

export function JobsPipelineBoard() {
  const [stages, setStages] = useState<StageConfig[]>([]);
  const [applied, setApplied] = useState<AppliedJob[]>([]);
  const [jobsByStage, setJobsByStage] = useState<Record<string, TechnicalJob[]>>({});
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [movingId, setMovingId] = useState<{ source: string; id: number } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [newJob, setNewJob] = useState({
    title: "",
    company_name: "",
    job_description: "",
    job_link: "",
    note: "",
  });
  const [isAdding, setIsAdding] = useState(false);
  const [manageStagesOpen, setManageStagesOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const supabase = getSupabaseBrowserClient();

  const fetchStages = useCallback(async (): Promise<StageConfig[]> => {
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("Fetch stages error:", error);
      setStages(DEFAULT_STAGES);
      return DEFAULT_STAGES;
    }
    if (!data || data.length === 0) {
      await supabase.from("pipeline_stages").insert(DEFAULT_STAGES);
      setStages(DEFAULT_STAGES);
      return DEFAULT_STAGES;
    }
    const list = data as StageConfig[];
    setStages(list);
    return list;
  }, [supabase]);

  const fetchAll = useCallback(async () => {
    try {
      const stageList = await fetchStages();
      const [jobsRes, techRes, profilesRes] = await Promise.all([
        supabase.from("jobs").select("*").order("id", { ascending: false }),
        supabase.from("technical_jobs").select("*").order("id", { ascending: false }),
        supabase.from("profiles").select("id, full_name").order("full_name", { ascending: true }),
      ]);
      if (jobsRes.error) throw jobsRes.error;
      if (techRes.error) throw techRes.error;
      if (!profilesRes.error && profilesRes.data) {
        setProfiles(
          (profilesRes.data as { id: number; full_name: string }[]).map((p) => ({
            id: p.id,
            full_name: p.full_name,
          })),
        );
      }

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
        stage_id: (row.stage_id as string | null) ?? null,
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

      const byStage: Record<string, TechnicalJob[]> = {};
      const stageIds = new Set(stageList.map((s) => s.id).filter((id) => id !== "applied"));
      stageIds.forEach((id) => {
        byStage[id] = [];
      });
      techRows.forEach((j) => {
        const sid = j.stage_id ?? (j.status === "success" ? "final" : "technical");
        if (!byStage[sid]) byStage[sid] = [];
        byStage[sid].push(j);
      });
      setJobsByStage(byStage);
    } catch (e) {
      console.error("Error fetching pipeline:", e);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, fetchStages]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const getJobsForStage = useCallback(
    (stageId: string): PipelineCardJob[] => {
      if (stageId === "applied") return applied;
      return jobsByStage[stageId] ?? [];
    },
    [applied, jobsByStage]
  );

  const handleAddJob = useCallback(async () => {
    const profile = profiles.find((p) => p.id === Number(selectedProfileId));
    if (!profile) return;
    if (!newJob.title.trim() || !newJob.company_name.trim()) return;
    setIsAdding(true);
    try {
      const baseNote = newJob.job_description.trim();
      const extraNote = newJob.note.trim();
      const combinedNote =
        baseNote && extraNote ? `${baseNote}\n\n${extraNote}` : baseNote || extraNote || "";
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          name: profile.full_name,
          title: newJob.title.trim(),
          company_name: newJob.company_name.trim(),
          job_link: newJob.job_link.trim() || "",
          resume_link: "",
          note: combinedNote,
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
      setNewJob({ title: "", company_name: "", job_description: "", job_link: "", note: "" });
      setSelectedProfileId("");
      setAddJobOpen(false);
    } catch (e) {
      console.error("Add job failed:", e);
    } finally {
      setIsAdding(false);
    }
  }, [newJob, supabase]);

  const moveCard = useCallback(
    async (payload: DragPayload, targetStageId: string) => {
      if (payload.stageId === targetStageId) return;

      const isTargetApplied = targetStageId === "applied";
      const isSourceApplied = payload.source === "jobs";

      if (isSourceApplied && isTargetApplied) return;
      if (isSourceApplied) {
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
              stage_id: targetStageId,
              status: targetStageId === "final" ? "success" : "ongoing",
            })
            .select();
          if (error) throw error;
          await supabase.from("jobs").delete().eq("id", job.id);
          const newRow = data?.[0] as Record<string, unknown> | undefined;
          if (newRow) {
            setJobsByStage((prev) => ({
              ...prev,
              [targetStageId]: [
                { ...job, id: newRow.id as number, source: "technical_jobs", stage_id: targetStageId } as TechnicalJob,
                ...(prev[targetStageId] ?? []),
              ],
            }));
          }
          setApplied((prev) => prev.filter((j) => j.id !== job.id));
        } catch (e) {
          console.error("Move failed:", e);
        } finally {
          setMovingId(null);
        }
        return;
      }

      if (isTargetApplied) {
        const allTech = Object.values(jobsByStage).flat();
        const job = allTech.find((j) => j.id === payload.id);
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
          setJobsByStage((prev) => {
            const next = { ...prev };
            const sid = job.stage_id ?? "technical";
            if (next[sid]) next[sid] = next[sid].filter((j) => j.id !== job.id);
            return next;
          });
          await fetchAll();
        } catch (e) {
          console.error("Move to applied failed:", e);
        } finally {
          setMovingId(null);
        }
        return;
      }

      const allTech = Object.values(jobsByStage).flat();
      const job = allTech.find((j) => j.id === payload.id);
      if (!job) return;
      setMovingId({ source: "technical_jobs", id: job.id });
      try {
        await supabase
          .from("technical_jobs")
          .update({ stage_id: targetStageId, status: targetStageId === "final" ? "success" : "ongoing" })
          .eq("id", job.id);
        const fromStage = job.stage_id ?? "technical";
        setJobsByStage((prev) => {
          const next = { ...prev };
          if (next[fromStage]) next[fromStage] = next[fromStage].filter((j) => j.id !== job.id);
          next[targetStageId] = [{ ...job, stage_id: targetStageId }, ...(next[targetStageId] ?? [])];
          return next;
        });
      } catch (e) {
        console.error("Move between stages failed:", e);
      } finally {
        setMovingId(null);
      }
    },
    [applied, jobsByStage, supabase, fetchAll]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStageId: string) => {
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
      moveCard(payload, targetStageId);
    },
    [moveCard]
  );

  const handleDragOver = useCallback((e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(stageId);
  }, []);

  const handleDragLeave = useCallback(() => setDragOverColumn(null), []);

  const addStage = useCallback(async () => {
    const name = newStageName.trim();
    if (!name) return;
    let id = slug(name) || `stage-${Date.now()}`;
    const displayStages = stages.length ? stages : DEFAULT_STAGES;
    const maxOrder = displayStages.length ? Math.max(...displayStages.map((s) => s.sort_order)) : 0;
    let { error } = await supabase.from("pipeline_stages").insert({ id, name, sort_order: maxOrder + 1 });
    if (error?.code === "23505") {
      id = `${id}-${Date.now()}`;
      const res = await supabase.from("pipeline_stages").insert({ id, name, sort_order: maxOrder + 1 });
      error = res.error;
    }
    if (!error) {
      setNewStageName("");
      await fetchStages();
      await fetchAll();
    }
  }, [newStageName, stages, supabase, fetchStages, fetchAll]);

  const removeStage = useCallback(
    async (stageId: string) => {
      if (stageId === "applied") return;
      const fallback = stages.find((s) => s.id !== "applied" && s.id !== stageId)?.id ?? "technical";
      const jobsInStage = jobsByStage[stageId] ?? [];
      for (const job of jobsInStage) {
        await supabase.from("technical_jobs").update({ stage_id: fallback }).eq("id", job.id);
      }
      await supabase.from("pipeline_stages").delete().eq("id", stageId);
      await fetchStages();
      await fetchAll();
    },
    [stages, jobsByStage, supabase, fetchStages, fetchAll]
  );

  const renameStage = useCallback(
    async (stageId: string, name: string) => {
      if (!name.trim()) return;
      await supabase.from("pipeline_stages").update({ name: name.trim() }).eq("id", stageId);
      setEditingStageId(null);
      setEditingName("");
      await fetchStages();
    },
    [supabase, fetchStages]
  );

  const displayStages = stages.length ? stages : DEFAULT_STAGES;

  if (isLoading) {
    return (
      <Card className="flex min-h-[400px] w-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Job Pipeline</h1>
        <Dialog open={manageStagesOpen} onOpenChange={setManageStagesOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Manage stages
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Stages</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Add, remove, or rename stages. &quot;Applied&quot; is the default and cannot be removed.
            </p>
            <div className="space-y-2 py-2">
              {displayStages.map((stage) => (
                <div
                  key={stage.id}
                  className="flex items-center gap-2 rounded-lg border p-2"
                >
                  {editingStageId === stage.id ? (
                    <>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameStage(stage.id, editingName);
                          if (e.key === "Escape") setEditingStageId(null);
                        }}
                        className="flex-1"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => renameStage(stage.id, editingName)}>
                        Save
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-medium">{stage.name}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingStageId(stage.id);
                          setEditingName(stage.name);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {stage.id !== "applied" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeStage(stage.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="New stage name"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addStage()}
              />
              <Button onClick={addStage} disabled={!newStageName.trim()}>
                Add stage
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Done</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div
        className="grid flex-1 gap-4"
        style={{ gridTemplateColumns: `repeat(${displayStages.length}, minmax(240px, 1fr))` }}
      >
        {displayStages.map((stage) => {
          const stageId = stage.id;
          const jobs = getJobsForStage(stageId);
          const icon =
            stageId === "applied" ? (
              <ClipboardList className="h-5 w-5" />
            ) : stageId === "technical" ? (
              <Workflow className="h-5 w-5" />
            ) : stageId === "final" ? (
              <CheckCircle className="h-5 w-5" />
            ) : (
              <ClipboardList className="h-5 w-5" />
            );

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
                  <span>{stage.name}</span>
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
                        <div className="space-y-1">
                          <label className="text-sm font-medium">Name *</label>
                          <select
                            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                            value={selectedProfileId}
                            onChange={(e) => setSelectedProfileId(e.target.value)}
                          >
                            <option value="">Select a profile</option>
                            {profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name}
                              </option>
                            ))}
                          </select>
                        </div>
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
                        <Textarea
                          placeholder="Job description"
                          value={newJob.job_description}
                          onChange={(e) => setNewJob((p) => ({ ...p, job_description: e.target.value }))}
                          rows={3}
                          className="resize-y"
                        />
                        <Input
                          placeholder="Job link (optional)"
                          type="url"
                          value={newJob.job_link}
                          onChange={(e) => setNewJob((p) => ({ ...p, job_link: e.target.value }))}
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
                    stageId={stageId}
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
