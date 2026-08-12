"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { JobPipelineDetailDialog, type PipelineCardDetailsUpdate } from "./JobPipelineDetailDialog";
import {
  mergeStageDate,
  cardNotes,
} from "@/lib/jobs/pipelineCardUtils";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  Eye,
  EyeOff,
  ClipboardList,
  Workflow,
  CheckCircle,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  Pencil,
  GripVertical,
  Search,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StageConfig = {
  id: string;
  name: string;
  sort_order: number;
  is_visible: boolean;
};

const DEFAULT_STAGES: StageConfig[] = [
  { id: "applied", name: "Applied", sort_order: 0, is_visible: true },
  { id: "technical", name: "Technical", sort_order: 1, is_visible: true },
  { id: "final", name: "Final", sort_order: 2, is_visible: true },
];

function stageIsVisible(stage: StageConfig): boolean {
  return stage.is_visible !== false;
}

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

function reorderList<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

type ProfileOption = { id: number; full_name: string };

function stageEnteredNow(): string {
  return new Date().toISOString();
}

function jobMatchesSearch(job: PipelineCardJob, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const parts = [
    job.name,
    job.title,
    job.company_name,
    job.resume_link,
    "job_link" in job ? job.job_link : "",
    "note" in job ? job.note : "",
  ];
  if (job.source === "technical_jobs") {
    parts.push(
      job.recruiter_name ?? "",
      job.recruiter_contact ?? "",
      job.status ?? "",
      job.job_description ?? "",
    );
  }
  return parts.join(" ").toLowerCase().includes(q);
}

function moveKey(source: string, id: number): string {
  return `${source}:${id}`;
}

function relocateTechnicalJobInState(
  setJobsByStage: React.Dispatch<React.SetStateAction<Record<string, TechnicalJob[]>>>,
  job: TechnicalJob,
  targetStageId: string,
  patch: Partial<TechnicalJob>,
): void {
  setJobsByStage((prev) => {
    const next: Record<string, TechnicalJob[]> = {};
    for (const [sid, list] of Object.entries(prev)) {
      next[sid] = list.filter((j) => j.id !== job.id);
    }
    const updated: TechnicalJob = {
      ...job,
      ...patch,
      source: "technical_jobs",
      stage_id: targetStageId,
    };
    next[targetStageId] = [updated, ...(next[targetStageId] ?? [])];
    return next;
  });
}

function removeTechnicalJobFromState(
  setJobsByStage: React.Dispatch<React.SetStateAction<Record<string, TechnicalJob[]>>>,
  jobId: number,
): void {
  setJobsByStage((prev) => {
    const next: Record<string, TechnicalJob[]> = {};
    for (const [sid, list] of Object.entries(prev)) {
      next[sid] = list.filter((j) => j.id !== jobId);
    }
    return next;
  });
}
function buildCandidateOptions(
  profiles: ProfileOption[],
  jobs: PipelineCardJob[],
): string[] {
  const names = new Set<string>();
  for (const profile of profiles) {
    const name = profile.full_name.trim();
    if (name) names.add(name);
  }
  for (const job of jobs) {
    const name = job.name.trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function JobsPipelineBoard() {
  const [stages, setStages] = useState<StageConfig[]>([]);
  const [applied, setApplied] = useState<AppliedJob[]>([]);
  const [jobsByStage, setJobsByStage] = useState<Record<string, TechnicalJob[]>>({});
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [movingId, setMovingId] = useState<{ source: string; id: number } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [manageStagesOpen, setManageStagesOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [stageDragId, setStageDragId] = useState<string | null>(null);
  const [stageDropTargetId, setStageDropTargetId] = useState<string | null>(null);
  const [savingStageOrder, setSavingStageOrder] = useState(false);
  const [search, setSearch] = useState("");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [candidateFilterOpen, setCandidateFilterOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{
    job: PipelineCardJob;
    stageId: string;
    stageName: string;
  } | null>(null);
  const supabase = getSupabaseBrowserClient();
  const moveInFlightRef = useRef<string | null>(null);

  const fetchStages = useCallback(async (): Promise<StageConfig[]> => {
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("id, name, sort_order, is_visible")
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
    const list = (data as StageConfig[]).map((stage) => ({
      ...stage,
      is_visible: stage.is_visible !== false,
    }));
    setStages(list);
    return list;
  }, [supabase]);

  const fetchAll = useCallback(async () => {
    try {
      const stageList = await fetchStages();
      const [pipelineRes, profilesRes] = await Promise.all([
        fetch("/api/pipeline", { credentials: "same-origin" }),
        fetch("/api/profiles", { credentials: "same-origin" }),
      ]);
      if (!pipelineRes.ok) {
        const err = await pipelineRes.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || "Failed to load pipeline.",
        );
      }
      const pipelineData = await pipelineRes.json();
      if (profilesRes.ok) {
        const profileData = await profilesRes.json().catch(() => ({}));
        setProfiles(
          ((profileData.profiles ?? []) as { id: number; full_name: string }[]).map(
            (p) => ({
              id: p.id,
              full_name: p.full_name,
            }),
          ),
        );
      }

      const appliedRows: AppliedJob[] = (pipelineData.applied ?? []).map(
        (row: AppliedJob) => ({ ...row, source: "jobs" as const }),
      );

      const techRows: TechnicalJob[] = (pipelineData.technicalJobs ?? []).map(
        (row: TechnicalJob) => ({ ...row, source: "technical_jobs" as const }),
      );

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
  }, [fetchStages]);

  const pipelineFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const res = await fetch(url, { credentials: "same-origin", ...init });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Pipeline request failed.",
        );
      }
      return data;
    },
    [],
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const getJobsForStage = useCallback(
    (stageId: string): PipelineCardJob[] => {
      if (stageId === "applied") return applied;
      return jobsByStage[stageId] ?? [];
    },
    [applied, jobsByStage],
  );

  const allPipelineJobs = useMemo(
    () => [...applied, ...Object.values(jobsByStage).flat()],
    [applied, jobsByStage],
  );

  const candidateOptions = useMemo(
    () => buildCandidateOptions(profiles, allPipelineJobs),
    [profiles, allPipelineJobs],
  );

  const hasActiveFilters = Boolean(search.trim() || candidateFilter);

  const filterJob = useCallback(
    (job: PipelineCardJob) => {
      if (!jobMatchesSearch(job, search)) return false;
      if (candidateFilter && job.name.trim() !== candidateFilter) return false;
      return true;
    },
    [search, candidateFilter],
  );

  const getFilteredJobsForStage = useCallback(
    (stageId: string) => getJobsForStage(stageId).filter(filterJob),
    [getJobsForStage, filterJob],
  );

  const patchJobInState = useCallback((updated: PipelineCardJob) => {
    if (updated.source === "jobs") {
      setApplied((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    } else {
      const stageId = updated.stage_id ?? "technical";
      setJobsByStage((prev) => {
        const next: Record<string, TechnicalJob[]> = {};
        for (const [sid, list] of Object.entries(prev)) {
          next[sid] = list.filter((j) => j.id !== updated.id);
        }
        if (!next[stageId]) next[stageId] = [];
        next[stageId] = [updated, ...next[stageId]];
        return next;
      });
    }
    setDetailTarget((prev) =>
      prev &&
      prev.job.source === updated.source &&
      prev.job.id === updated.id
        ? { ...prev, job: updated }
        : prev,
    );
  }, []);

  const handleSaveCardDetails = useCallback(
    async (job: PipelineCardJob, update: PipelineCardDetailsUpdate) => {
      const currentStageId =
        job.source === "jobs"
          ? detailTarget?.stageId ?? "applied"
          : (job as TechnicalJob).stage_id ?? detailTarget?.stageId ?? "technical";
      const stageEnteredAt =
        update.stage_dates[currentStageId] ?? job.stage_entered_at ?? job.created_at;

      try {
        await pipelineFetch("/api/pipeline/cards", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: job.source,
            id: job.id,
            currentStageId,
            update,
          }),
        });
        if (job.source === "jobs") {
          patchJobInState({
            ...job,
            stage_dates: update.stage_dates,
            recruiter_name: update.recruiter_name || null,
            recruiter_contact: update.recruiter_contact || null,
            note: update.notes,
            stage_entered_at: stageEnteredAt,
          });
        } else {
          patchJobInState({
            ...job,
            stage_dates: update.stage_dates,
            recruiter_name: update.recruiter_name || null,
            recruiter_contact: update.recruiter_contact || null,
            job_description: update.notes,
            stage_entered_at: stageEnteredAt,
          } as TechnicalJob);
        }
        toast.success("Application details saved.");
      } catch (e) {
        console.error("Save card details failed:", e);
        toast.error("Failed to save application details.");
        throw e;
      }
    },
    [patchJobInState, detailTarget?.stageId, pipelineFetch],
  );

  const moveCard = useCallback(
    async (payload: DragPayload, targetStageId: string) => {
      if (payload.stageId === targetStageId) return;

      const key = moveKey(payload.source, payload.id);
      if (moveInFlightRef.current === key) return;
      moveInFlightRef.current = key;
      setMovingId({ source: payload.source, id: payload.id });

      const finishMove = () => {
        if (moveInFlightRef.current === key) {
          moveInFlightRef.current = null;
        }
        setMovingId((current) =>
          current?.source === payload.source && current.id === payload.id ? null : current,
        );
      };

      const isTargetApplied = targetStageId === "applied";
      const isSourceApplied = payload.source === "jobs";

      if (isSourceApplied && isTargetApplied) {
        finishMove();
        return;
      }

      if (isSourceApplied) {
        const job = applied.find((j) => j.id === payload.id);
        if (!job) {
          finishMove();
          return;
        }
        const enteredAt = stageEnteredNow();
        const sourceStageId = payload.stageId;
        const stageDates = mergeStageDate(
          mergeStageDate(job.stage_dates, sourceStageId, job.stage_entered_at ?? job.created_at),
          targetStageId,
          enteredAt,
        );
        const status = targetStageId === "final" ? "success" : "ongoing";
        const optimisticTech: TechnicalJob = {
          id: job.id,
          source: "technical_jobs",
          stage_id: targetStageId,
          name: job.name ?? "",
          company_name: job.company_name ?? "",
          title: job.title ?? "",
          resume_link: job.resume_link ?? "",
          job_description: cardNotes(job),
          recruiter_name: job.recruiter_name ?? null,
          recruiter_contact: job.recruiter_contact ?? null,
          created_at: job.created_at,
          stage_entered_at: enteredAt,
          stage_dates: stageDates,
          status,
        };
        setApplied((prev) => prev.filter((j) => j.id !== job.id));
        relocateTechnicalJobInState(setJobsByStage, optimisticTech, targetStageId, {});
        try {
          const result = await pipelineFetch("/api/pipeline/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: payload.source,
              id: payload.id,
              stageId: payload.stageId,
              targetStageId,
            }),
          });
          const newId = (result as { id?: number }).id;
          if (newId != null && newId !== job.id) {
            setJobsByStage((prev) => {
              const next: Record<string, TechnicalJob[]> = {};
              for (const [sid, list] of Object.entries(prev)) {
                next[sid] = list.map((j) =>
                  j.id === job.id ? { ...j, id: newId } : j,
                );
              }
              return next;
            });
          }
        } catch (e) {
          const msg =
            e instanceof Error
              ? e.message
              : e && typeof e === "object" && "message" in e
                ? String((e as { message: unknown }).message)
                : String(e);
          console.error("Move failed:", msg || "Unknown error", e);
          toast.error("Failed to move card. Refreshing pipeline…");
          await fetchAll();
        } finally {
          finishMove();
        }
        return;
      }

      if (isTargetApplied) {
        const allTech = Object.values(jobsByStage).flat();
        const job = allTech.find((j) => j.id === payload.id);
        if (!job) {
          finishMove();
          return;
        }
        const enteredAt = stageEnteredNow();
        const sourceStageId = payload.stageId;
        const stageDates = mergeStageDate(
          mergeStageDate(
            job.stage_dates,
            sourceStageId,
            job.stage_entered_at ?? job.created_at ?? enteredAt,
          ),
          targetStageId,
          enteredAt,
        );
        removeTechnicalJobFromState(setJobsByStage, job.id);
        const optimisticApplied: AppliedJob = {
          id: job.id,
          source: "jobs",
          name: job.name,
          title: job.title,
          company_name: job.company_name,
          job_link: "",
          resume_link: job.resume_link,
          note: cardNotes(job),
          created_at: job.created_at ?? enteredAt,
          stage_entered_at: enteredAt,
          stage_dates: stageDates,
          recruiter_name: job.recruiter_name ?? null,
          recruiter_contact: job.recruiter_contact ?? null,
        };
        setApplied((prev) => [optimisticApplied, ...prev.filter((j) => j.id !== job.id)]);
        try {
          const result = await pipelineFetch("/api/pipeline/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: payload.source,
              id: payload.id,
              stageId: payload.stageId,
              targetStageId,
            }),
          });
          const newId = (result as { id?: number }).id;
          if (newId != null && newId !== job.id) {
            setApplied((prev) =>
              prev.map((j) =>
                j.id === job.id
                  ? {
                      ...j,
                      id: newId,
                    }
                  : j,
              ),
            );
          }
        } catch (e) {
          const msg =
            e instanceof Error
              ? e.message
              : e && typeof e === "object" && "message" in e
                ? String((e as { message: unknown }).message)
                : String(e);
          console.error("Move to applied failed:", msg || "Unknown error", e);
          toast.error("Failed to move card. Refreshing pipeline…");
          await fetchAll();
        } finally {
          finishMove();
        }
        return;
      }

      const allTech = Object.values(jobsByStage).flat();
      const job = allTech.find((j) => j.id === payload.id);
      if (!job) {
        finishMove();
        return;
      }
      const enteredAt = stageEnteredNow();
      const stageDates = mergeStageDate(job.stage_dates, targetStageId, enteredAt);
      const status = targetStageId === "final" ? "success" : "ongoing";
      relocateTechnicalJobInState(setJobsByStage, job, targetStageId, {
        stage_entered_at: enteredAt,
        stage_dates: stageDates,
        status,
      });
      try {
        await pipelineFetch("/api/pipeline/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: payload.source,
            id: payload.id,
            stageId: payload.stageId,
            targetStageId,
          }),
        });
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : e && typeof e === "object" && "message" in e
              ? String((e as { message: unknown }).message)
              : String(e);
        console.error("Move between stages failed:", msg || "Unknown error", e);
        toast.error("Failed to move card. Refreshing pipeline…");
        await fetchAll();
      } finally {
        finishMove();
      }
    },
    [applied, jobsByStage, fetchAll, pipelineFetch],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStageId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverColumn(null);
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      let payload: DragPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      void moveCard(payload, targetStageId);
    },
    [moveCard],
  );

  const handleDragOver = useCallback((e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(stageId);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOverColumn(null);
  }, []);

  const addStage = useCallback(async () => {
    const name = newStageName.trim();
    if (!name) return;
    let id = slug(name) || `stage-${Date.now()}`;
    const displayStages = stages.length ? stages : DEFAULT_STAGES;
    const maxOrder = displayStages.length ? Math.max(...displayStages.map((s) => s.sort_order)) : 0;
    let { error } = await supabase
      .from("pipeline_stages")
      .insert({ id, name, sort_order: maxOrder + 1, is_visible: true });
    if (error?.code === "23505") {
      id = `${id}-${Date.now()}`;
      const res = await supabase
        .from("pipeline_stages")
        .insert({ id, name, sort_order: maxOrder + 1, is_visible: true });
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
      await pipelineFetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reassignStage",
          fromStageId: stageId,
          toStageId: fallback,
        }),
      });
      await supabase.from("pipeline_stages").delete().eq("id", stageId);
      await fetchStages();
      await fetchAll();
    },
    [stages, supabase, fetchStages, fetchAll, pipelineFetch],
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

  const toggleStageVisibility = useCallback(
    async (stageId: string, visible: boolean) => {
      const current = stages.length ? stages : DEFAULT_STAGES;
      const visibleCount = current.filter(stageIsVisible).length;
      if (!visible && visibleCount <= 1) {
        toast.error("At least one stage must remain visible.");
        return;
      }

      const { error } = await supabase
        .from("pipeline_stages")
        .update({ is_visible: visible })
        .eq("id", stageId);
      if (error) {
        console.error("Toggle stage visibility error:", error);
        toast.error("Could not update stage visibility.");
        return;
      }
      await fetchStages();
    },
    [stages, supabase, fetchStages],
  );

  const persistStageOrder = useCallback(
    async (ordered: StageConfig[]) => {
      const withOrder = ordered.map((stage, index) => ({
        ...stage,
        sort_order: index,
      }));
      setStages(withOrder);
      const results = await Promise.all(
        withOrder.map((stage) =>
          supabase
            .from("pipeline_stages")
            .update({ sort_order: stage.sort_order })
            .eq("id", stage.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    [supabase],
  );

  const handleStageDragStart = (e: React.DragEvent, stageId: string) => {
    e.dataTransfer.setData("text/stage-id", stageId);
    e.dataTransfer.effectAllowed = "move";
    setStageDragId(stageId);
  };

  const handleStageDragEnd = () => {
    setStageDragId(null);
    setStageDropTargetId(null);
  };

  const handleStageDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (stageDropTargetId !== targetId) setStageDropTargetId(targetId);
  };

  const handleStageDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/stage-id");
    setStageDragId(null);
    setStageDropTargetId(null);
    if (!sourceId || sourceId === targetId || savingStageOrder) return;

    const current = stages.length ? stages : DEFAULT_STAGES;
    const fromIndex = current.findIndex((s) => s.id === sourceId);
    const toIndex = current.findIndex((s) => s.id === targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    setSavingStageOrder(true);
    try {
      await persistStageOrder(reorderList(current, fromIndex, toIndex));
    } catch (error) {
      console.error("Reorder stages error:", error);
      await fetchStages();
    } finally {
      setSavingStageOrder(false);
    }
  };

  const displayStages = stages.length ? stages : DEFAULT_STAGES;
  const visibleStages = useMemo(
    () => displayStages.filter(stageIsVisible),
    [displayStages],
  );

  if (isLoading) {
    return (
      <Card className="flex min-h-[400px] w-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
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
              Drag stages to reorder. Add, remove, or rename stages. Use the eye icon to
              show or hide a column on the board. &quot;Applied&quot; is the default and
              cannot be removed.
            </p>
            <div className="space-y-2 py-2">
              {displayStages.map((stage) => (
                <div
                  key={stage.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-2 transition-colors",
                    stageDragId === stage.id && "opacity-50",
                    stageDropTargetId === stage.id &&
                      stageDragId !== stage.id &&
                      "border-primary bg-primary/5",
                    !stageIsVisible(stage) && "opacity-60 bg-muted/20",
                  )}
                  onDragOver={(e) => handleStageDragOver(e, stage.id)}
                  onDrop={(e) => handleStageDrop(e, stage.id)}
                >
                  <button
                    type="button"
                    draggable={!savingStageOrder && editingStageId !== stage.id}
                    onDragStart={(e) => handleStageDragStart(e, stage.id)}
                    onDragEnd={handleStageDragEnd}
                    disabled={savingStageOrder || editingStageId === stage.id}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                      "cursor-grab active:cursor-grabbing hover:bg-muted hover:text-foreground",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                    aria-label={`Drag to reorder ${stage.name}`}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
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
                        title={stageIsVisible(stage) ? "Hide column" : "Show column"}
                        aria-label={
                          stageIsVisible(stage)
                            ? `Hide ${stage.name} column`
                            : `Show ${stage.name} column`
                        }
                        onClick={() =>
                          void toggleStageVisibility(stage.id, !stageIsVisible(stage))
                        }
                      >
                        {stageIsVisible(stage) ? (
                          <Eye className="h-4 w-4" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="h-9 pl-9 rounded-lg bg-muted/30"
            placeholder="Search title, company, profile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Popover open={candidateFilterOpen} onOpenChange={setCandidateFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-9 gap-1.5 rounded-lg shrink-0 max-w-[200px]",
                candidateFilter && "border-primary/60 bg-primary/5 text-primary",
              )}
            >
              <User className="h-4 w-4 shrink-0" />
              <span className="truncate hidden sm:inline">
                {candidateFilter || "Profile"}
              </span>
              {candidateFilter && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium shrink-0">
                  On
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <p className="text-sm font-medium mb-3">Filter by profile</p>
            <Select
              value={candidateFilter || "__all__"}
              onValueChange={(v) => setCandidateFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="All profiles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All profiles</SelectItem>
                {candidateOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => {
                  setCandidateFilter("");
                  setCandidateFilterOpen(false);
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={() => setCandidateFilterOpen(false)}
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-lg text-xs px-2"
            onClick={() => {
              setSearch("");
              setCandidateFilter("");
            }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {visibleStages.length === 0 ? (
        <Card className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-8 text-center">
          <EyeOff className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            All stages are hidden. Open Manage stages and use the eye icon to show at
            least one column.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setManageStagesOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
            Manage stages
          </Button>
        </Card>
      ) : (
      <div
        className="grid min-h-0 w-full flex-1 gap-4"
        style={{ gridTemplateColumns: `repeat(${visibleStages.length}, minmax(0, 1fr))` }}
      >
        {visibleStages.map((stage) => {
          const stageId = stage.id;
          const jobs = getFilteredJobsForStage(stageId);
          const totalInStage = getJobsForStage(stageId).length;
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
                    {hasActiveFilters && jobs.length !== totalInStage
                      ? `${jobs.length}/${totalInStage}`
                      : jobs.length}
                  </span>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  title={`Hide ${stage.name}`}
                  aria-label={`Hide ${stage.name} column`}
                  onClick={() => void toggleStageVisibility(stage.id, false)}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                {jobs.map((job) => (
                  <JobPipelineCard
                    key={`${job.source}-${job.id}`}
                    job={job}
                    stageId={stageId}
                    isMoving={
                      movingId?.source === job.source && movingId?.id === job.id
                    }
                    onDetail={() =>
                      setDetailTarget({ job, stageId, stageName: stage.name })
                    }
                  />
                ))}
                {jobs.length === 0 && !hasActiveFilters && stageId === "applied" && (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    Register via Resume DB or the extension, then enable Pipeline on that row.
                  </p>
                )}
                {jobs.length === 0 && hasActiveFilters && totalInStage > 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No matches in this stage
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      <JobPipelineDetailDialog
        open={detailTarget != null}
        onOpenChange={(open) => !open && setDetailTarget(null)}
        job={detailTarget?.job ?? null}
        currentStageId={detailTarget?.stageId ?? "applied"}
        stages={displayStages.map((s) => ({ id: s.id, name: s.name }))}
        onSave={handleSaveCardDetails}
      />
    </div>
  );
}
