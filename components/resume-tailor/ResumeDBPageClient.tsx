"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ResumeDBEditDialog } from "@/components/resume-tailor/ResumeDBEditDialog";
import {
  ResizableSortableHead,
  ResizableTableCell,
  ResizableTableHead,
} from "@/components/resume-tailor/ResumeDBResizableTable";
import {
  useResizableColumns,
  type ResumeDBColumnId,
} from "@/components/resume-tailor/useResizableColumns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  User,
  Download,
  ExternalLink,
  Eye,
  FileJson,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type ResumeDbRow = {
  rowIndex: number;
  entryId: string;
  candidate: string;
  profileId: number | null;
  jobLink: string;
  apply: string;
  jobTitle: string;
  company: string;
  resumeUrl: string;
  coverLetterUrl: string;
  date: string;
  appliedAt: string;
  pipelineJobId: number | null;
  inPipeline: boolean;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

type SortKey = "company" | "jobTitle" | "pipeline" | null;
type SortDir = "asc" | "desc";

const COLUMN_ORDER: ResumeDBColumnId[] = [
  "select",
  "no",
  "jobLink",
  "company",
  "jobTitle",
  "resume",
  "coverLetter",
  "pipeline",
  "applied",
  "json",
  "actions",
];

function DocActions({
  url,
  label,
  company,
  onPreview,
}: {
  url: string;
  label: string;
  company: string;
  onPreview: (title: string, url: string) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1 mx-auto w-fit">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 rounded-md shrink-0"
        title={`Preview ${label}`}
        onClick={() => onPreview(`${label} — ${company}`, url)}
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="sr-only">Preview {label}</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 rounded-md shrink-0"
        asChild
        title={`Download ${label}`}
      >
        <a href={url} target="_blank" rel="noopener noreferrer" download>
          <Download className="h-3.5 w-3.5" />
          <span className="sr-only">Download {label}</span>
        </a>
      </Button>
    </div>
  );
}

function formatApplied(iso: string, fallback: string): string {
  if (!iso) return fallback || "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback || "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isWithinAppliedDateRange(
  appliedAt: string,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;
  const d = new Date(appliedAt);
  if (Number.isNaN(d.getTime())) return false;
  if (from) {
    const start = new Date(`${from}T00:00:00`);
    if (d < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999`);
    if (d > end) return false;
  }
  return true;
}

function PreviewDialog({
  open,
  onOpenChange,
  title,
  url,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  url: string;
}) {
  const previewUrl = url.includes("drive.google.com")
    ? url.replace("/view", "/preview").replace("?usp=sharing", "")
    : url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {url ? (
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            <iframe
              src={previewUrl}
              title={title}
              className="w-full flex-1 min-h-[480px] rounded-lg border bg-muted/40"
            />
            <Button variant="outline" size="sm" asChild className="w-fit">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in new tab
              </a>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No link available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type CandidateFilterOption = { key: string; label: string };

function matchesCandidateFilter(row: ResumeDbRow, filterKey: string): boolean {
  if (!filterKey) return true;
  if (filterKey.startsWith("profile-")) {
    const id = Number(filterKey.slice(8));
    return row.profileId === id;
  }
  if (filterKey.startsWith("name-")) {
    const name = decodeURIComponent(filterKey.slice(5));
    return row.profileId == null && row.candidate.trim() === name;
  }
  return true;
}

function buildCandidateFilterOptions(
  profiles: { id: number; full_name: string }[],
  rows: ResumeDbRow[],
): CandidateFilterOption[] {
  const profileNames = new Set(profiles.map((p) => p.full_name.trim().toLowerCase()));
  const profileIdsInOptions = new Set<number>();
  const options: CandidateFilterOption[] = profiles.map((p) => {
    profileIdsInOptions.add(p.id);
    return {
      key: `profile-${p.id}`,
      label: p.full_name,
    };
  });

  for (const row of rows) {
    if (row.profileId != null && !profileIdsInOptions.has(row.profileId)) {
      profileIdsInOptions.add(row.profileId);
      options.push({
        key: `profile-${row.profileId}`,
        label: row.candidate.trim() || `Profile #${row.profileId}`,
      });
    }
  }

  const orphanNames = new Map<string, string>();
  for (const row of rows) {
    const name = row.candidate.trim();
    if (!name || row.profileId != null) continue;
    const normalized = name.toLowerCase();
    if (profileNames.has(normalized)) continue;
    orphanNames.set(normalized, name);
  }

  for (const name of orphanNames.values()) {
    options.push({
      key: `name-${encodeURIComponent(name)}`,
      label: name,
    });
  }

  return options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function CandidateFilter({
  value,
  options,
  onApply,
  onClear,
}: {
  value: string;
  options: CandidateFilterOption[];
  onApply: (key: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const active = Boolean(value);
  const selectedLabel = options.find((o) => o.key === value)?.label;

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  const clear = () => {
    setDraft("");
    onClear();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5 rounded-xl shrink-0 max-w-[200px]",
            active && "border-primary/60 bg-primary/5 text-primary",
          )}
        >
          <User className="h-4 w-4 shrink-0" />
          <span className="truncate hidden sm:inline">
            {active && selectedLabel ? selectedLabel : "Candidate"}
          </span>
          {active && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium shrink-0">
              On
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <p className="text-sm font-medium mb-3">Filter by candidate</p>
        <Select
          value={draft || "__all__"}
          onValueChange={(v) => setDraft(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="All candidates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All candidates</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">No profiles or candidates yet.</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clear}>
            Clear
          </Button>
          <Button type="button" size="sm" className="h-8" onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AppliedDateFilter({
  dateFrom,
  dateTo,
  onApply,
  onClear,
}: {
  dateFrom: string;
  dateTo: string;
  onApply: (from: string, to: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(dateFrom);
  const [draftTo, setDraftTo] = useState(dateTo);
  const active = Boolean(dateFrom || dateTo);

  useEffect(() => {
    if (open) {
      setDraftFrom(dateFrom);
      setDraftTo(dateTo);
    }
  }, [open, dateFrom, dateTo]);

  const apply = () => {
    onApply(draftFrom, draftTo);
    setOpen(false);
  };

  const clear = () => {
    setDraftFrom("");
    setDraftTo("");
    onClear();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5 rounded-xl shrink-0",
            active && "border-primary/60 bg-primary/5 text-primary",
          )}
        >
          <CalendarRange className="h-4 w-4" />
          <span className="hidden sm:inline">Applied date</span>
          {active && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium">
              On
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <p className="text-sm font-medium mb-3">Filter by applied date</p>
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            From
            <Input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-8 text-xs"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            To
            <Input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              min={draftFrom || undefined}
              className="h-8 text-xs"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clear}>
            Clear
          </Button>
          <Button type="button" size="sm" className="h-8" onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ResumeDBPageClient() {
  const [rows, setRows] = useState<ResumeDbRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const [togglingRow, setTogglingRow] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [editRow, setEditRow] = useState<ResumeDbRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);
  const { widths, setColumnWidth } = useResizableColumns();

  const tableWidth = useMemo(
    () => COLUMN_ORDER.reduce((sum, id) => sum + widths[id], 0),
    [widths],
  );

  const handleColumnResize = useCallback(
    (id: ResumeDBColumnId, width: number) => setColumnWidth(id, width),
    [setColumnWidth],
  );
  const [profiles, setProfiles] = useState<{ id: number; full_name: string }[]>([]);
  const [candidateFilter, setCandidateFilter] = useState("");

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      const [resumeRes, profilesRes] = await Promise.all([
        fetch("/api/resume-db"),
        fetch("/api/profiles"),
      ]);
      if (!resumeRes.ok) {
        const err = await resumeRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load Resume DB.");
      }
      const data = await resumeRes.json();
      setRows(data.resumes ?? []);

      if (profilesRes.ok) {
        const profileData = await profilesRes.json().catch(() => ({}));
        setProfiles(profileData.profiles ?? []);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load Resume DB.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, dateFrom, dateTo, candidateFilter, sortKey, sortDir]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, dateFrom, dateTo, candidateFilter]);

  const candidateFilterOptions = useMemo(
    () => buildCandidateFilterOptions(profiles, rows),
    [profiles, rows],
  );

  const handleSort = (key: Exclude<SortKey, null>) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const hasActiveFilters = Boolean(search.trim() || dateFrom || dateTo || candidateFilter);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const haystack = [
          r.entryId,
          r.company,
          r.jobTitle,
          r.candidate,
          r.jobLink,
          r.apply,
          r.date,
          r.appliedAt,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (!matchesCandidateFilter(r, candidateFilter)) return false;
      if (!isWithinAppliedDateRange(r.appliedAt, dateFrom, dateTo)) return false;
      return true;
    });
  }, [rows, search, candidateFilter, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (!sortKey) return list;
    list.sort((a, b) => {
      if (sortKey === "pipeline") {
        const av = a.inPipeline ? 0 : 1;
        const bv = b.inPipeline ? 0 : 1;
        const cmp = av - bv;
        return sortDir === "asc" ? cmp : -cmp;
      }
      const av = (sortKey === "company" ? a.company : a.jobTitle).trim().toLowerCase();
      const bv = (sortKey === "company" ? b.company : b.jobTitle).trim().toLowerCase();
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  const rangeStart = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, sorted.length);

  const handleDelete = async (rowIndex: number) => {
    if (!confirm("Delete this application?")) return;
    setRemovingRow(rowIndex);
    try {
      const res = await fetch(`/api/resume-db?id=${rowIndex}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Delete failed");
      }
      toast.success("Application deleted.");
      loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setRemovingRow(null);
    }
  };

  const handlePipelineToggle = async (row: ResumeDbRow, checked: boolean) => {
    setTogglingRow(row.rowIndex);
    try {
      const res = await fetch("/api/resume-db", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: row.rowIndex, inPipeline: checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update pipeline status.");
      }
      setRows((prev) =>
        prev.map((r) =>
          r.rowIndex === row.rowIndex
            ? {
                ...r,
                inPipeline: data.inPipeline ?? checked,
                apply: data.apply ?? (checked ? "In Pipeline" : "Registered"),
                pipelineJobId: data.pipelineJobId ?? r.pipelineJobId,
              }
            : r,
        ),
      );
      toast.success(
        checked
          ? "Added to job pipeline (Applied stage)."
          : "Removed from job pipeline.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Pipeline update failed.",
      );
    } finally {
      setTogglingRow(null);
    }
  };

  const filteredIds = useMemo(
    () => sorted.map((r) => r.rowIndex),
    [sorted],
  );

  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someFilteredSelected =
    filteredIds.some((id) => selectedIds.has(id)) && !allFilteredSelected;

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  };

  const toggleSelectRow = (rowIndex: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const downloadJsonBlob = (fileName: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = async (row: ResumeDbRow) => {
    try {
      const res = await fetch(`/api/resume-db/export?id=${row.rowIndex}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const data = await res.json();
      downloadJsonBlob(
        `resume-db-${row.entryId || row.rowIndex}.json`,
        data.job ?? data,
      );
      toast.success("JSON downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  };

  const downloadSelectedJson = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkExporting(true);
    try {
      const jobs = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/resume-db/export?id=${id}`);
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Export failed for #${id}`);
          }
          const data = await res.json();
          return data.job ?? data;
        }),
      );
      downloadJsonBlob(
        `resume-db-export-${ids.length}-${Date.now()}.json`,
        jobs,
      );
      toast.success(`Downloaded JSON for ${ids.length} application(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk export failed");
    } finally {
      setBulkExporting(false);
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} selected application${ids.length === 1 ? "" : "s"}?`,
      )
    ) {
      return;
    }
    setBulkRemoving(true);
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/resume-db?id=${id}`, { method: "DELETE" });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Delete failed for #${id}`);
          }
        }),
      );
      void results;
      toast.success(`Deleted ${ids.length} application(s).`);
      setSelectedIds(new Set());
      loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk delete failed");
    } finally {
      setBulkRemoving(false);
    }
  };

  const handleEditSaved = (updated: Partial<ResumeDbRow>) => {
    if (updated.rowIndex == null) return;
    setRows((prev) =>
      prev.map((r) =>
        r.rowIndex === updated.rowIndex ? { ...r, ...updated } : r,
      ),
    );
  };

  return (
    <JobsLayout>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 sm:gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0 space-y-0.5">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Resume Management</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {rows.length} application{rows.length === 1 ? "" : "s"} — register via
              the Smart Job extension. Toggle status to add jobs to the{" "}
              <Link href="/jobs" className="text-primary underline-offset-4 hover:underline">
                pipeline
              </Link>
              .
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg shadow-sm shrink-0"
            onClick={loadRows}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-4 w-4 sm:mr-2", isLoading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="relative min-w-[160px] flex-1 sm:max-w-xs lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 rounded-xl bg-muted/30 border-border/60 h-9"
              placeholder="Search company, role, ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <AppliedDateFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onApply={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
            onClear={() => {
              setDateFrom("");
              setDateTo("");
            }}
          />

          <CandidateFilter
            value={candidateFilter}
            options={candidateFilterOptions}
            onApply={setCandidateFilter}
            onClear={() => setCandidateFilter("")}
          />

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 rounded-xl text-xs px-2"
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
                setCandidateFilter("");
              }}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear filters
            </Button>
          )}

          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            {!isLoading && (
              <span className="text-xs text-muted-foreground whitespace-nowrap mr-1 hidden md:inline">
                {filtered.length === 0
                  ? rows.length === 0
                    ? "No applications"
                    : "No matches"
                  : `${rangeStart}–${rangeEnd} of ${sorted.length}`}
              </span>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline whitespace-nowrap">
              Rows
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(Number(v))}
            >
              <SelectTrigger className="h-9 w-[68px] rounded-xl" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl"
              disabled={safePage <= 1 || sorted.length === 0}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs tabular-nums min-w-[72px] text-center text-muted-foreground">
              {sorted.length === 0 ? "0 / 0" : `${safePage} / ${totalPages}`}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl"
              disabled={safePage >= totalPages || sorted.length === 0}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!isLoading && selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              disabled={bulkExporting}
              onClick={downloadSelectedJson}
            >
              {bulkExporting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileJson className="h-3.5 w-3.5 mr-1.5" />
              )}
              Download JSON
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg text-destructive hover:text-destructive"
              disabled={bulkRemoving}
              onClick={deleteSelected}
            >
              {bulkRemoving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Remove selected
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg ml-auto"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
          </div>
        )}

        <Card className="flex min-h-0 flex-1 flex-col gap-0 rounded-xl border-border/60 py-0 shadow-sm">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground sm:p-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading applications…
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center sm:p-6">
                {rows.length === 0
                  ? "No entries yet. Use the extension Register tab on a job posting."
                  : "No matches for your search or date filters."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <p className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border/40">
                  Drag the right edge of a column header to resize, like a spreadsheet.
                </p>
                <Table
                  className="table-fixed w-max min-w-full"
                  style={{ width: Math.max(tableWidth, 960) }}
                >
                  <colgroup>
                    {COLUMN_ORDER.map((id) => (
                      <col key={id} style={{ width: widths[id] }} />
                    ))}
                  </colgroup>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/40">
                      <ResizableTableHead
                        columnId="select"
                        width={widths.select}
                        onResize={handleColumnResize}
                        align="center"
                      >
                        <Checkbox
                          checked={
                            allFilteredSelected
                              ? true
                              : someFilteredSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all filtered applications"
                        />
                      </ResizableTableHead>
                      <ResizableTableHead
                        columnId="no"
                        width={widths.no}
                        onResize={handleColumnResize}
                        align="center"
                      >
                        No
                      </ResizableTableHead>
                      <ResizableTableHead
                        columnId="jobLink"
                        width={widths.jobLink}
                        onResize={handleColumnResize}
                      >
                        Job link
                      </ResizableTableHead>
                      <ResizableSortableHead
                        columnId="company"
                        width={widths.company}
                        onResize={handleColumnResize}
                        label="Company"
                        active={sortKey === "company"}
                        direction={sortDir}
                        onSort={() => handleSort("company")}
                      />
                      <ResizableSortableHead
                        columnId="jobTitle"
                        width={widths.jobTitle}
                        onResize={handleColumnResize}
                        label="Job title"
                        active={sortKey === "jobTitle"}
                        direction={sortDir}
                        onSort={() => handleSort("jobTitle")}
                      />
                      <ResizableTableHead
                        columnId="resume"
                        width={widths.resume}
                        onResize={handleColumnResize}
                        align="center"
                      >
                        Resume
                      </ResizableTableHead>
                      <ResizableTableHead
                        columnId="coverLetter"
                        width={widths.coverLetter}
                        onResize={handleColumnResize}
                        align="center"
                      >
                        Cover letter
                      </ResizableTableHead>
                      <ResizableSortableHead
                        columnId="pipeline"
                        width={widths.pipeline}
                        onResize={handleColumnResize}
                        label="Pipeline"
                        active={sortKey === "pipeline"}
                        direction={sortDir}
                        onSort={() => handleSort("pipeline")}
                        align="center"
                      />
                      <ResizableTableHead
                        columnId="applied"
                        width={widths.applied}
                        onResize={handleColumnResize}
                      >
                        Applied
                      </ResizableTableHead>
                      <ResizableTableHead
                        columnId="json"
                        width={widths.json}
                        onResize={handleColumnResize}
                        align="center"
                      >
                        JSON
                      </ResizableTableHead>
                      <ResizableTableHead
                        columnId="actions"
                        width={widths.actions}
                        onResize={handleColumnResize}
                        align="center"
                      >
                        Actions
                      </ResizableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((row, index) => (
                      <TableRow
                        key={row.rowIndex}
                        className={cn(
                          "group hover:bg-muted/20 transition-colors",
                          selectedIds.has(row.rowIndex) && "bg-primary/5",
                        )}
                      >
                        <ResizableTableCell width={widths.select} align="center">
                          <Checkbox
                            checked={selectedIds.has(row.rowIndex)}
                            onCheckedChange={() => toggleSelectRow(row.rowIndex)}
                            aria-label={`Select ${row.company || "application"}`}
                          />
                        </ResizableTableCell>
                        <ResizableTableCell
                          width={widths.no}
                          align="center"
                          className="tabular-nums text-muted-foreground"
                        >
                          {rangeStart + index}
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.jobLink}>
                          {row.jobLink ? (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto max-w-full p-0 text-primary truncate inline-flex"
                              asChild
                            >
                              <a
                                href={row.jobLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={row.jobLink}
                              >
                                Open
                                <ExternalLink className="h-3 w-3 ml-1 shrink-0" />
                              </a>
                            </Button>
                          ) : (
                            "—"
                          )}
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.company} className="font-medium">
                          <span className="block truncate" title={row.company || undefined}>
                            {row.company || "—"}
                          </span>
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.jobTitle}>
                          <span className="block truncate" title={row.jobTitle || undefined}>
                            {row.jobTitle || "—"}
                          </span>
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.resume} align="center">
                          {row.resumeUrl ? (
                            <DocActions
                              url={row.resumeUrl}
                              label="Resume"
                              company={row.company}
                              onPreview={(title, url) => setPreview({ title, url })}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.coverLetter} align="center">
                          {row.coverLetterUrl ? (
                            <DocActions
                              url={row.coverLetterUrl}
                              label="Cover letter"
                              company={row.company}
                              onPreview={(title, url) => setPreview({ title, url })}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.pipeline} align="center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Switch
                              checked={row.inPipeline}
                              disabled={togglingRow === row.rowIndex}
                              onCheckedChange={(checked) =>
                                handlePipelineToggle(row, checked)
                              }
                              aria-label={`Add ${row.company} to pipeline`}
                            />
                            {togglingRow === row.rowIndex ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                            ) : row.inPipeline ? (
                              <Link
                                href="/jobs"
                                className="text-primary shrink-0"
                                title="View in pipeline"
                              >
                                <Workflow className="h-3 w-3" />
                              </Link>
                            ) : null}
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell
                          width={widths.applied}
                          className="text-xs tabular-nums text-muted-foreground whitespace-nowrap"
                        >
                          {formatApplied(row.appliedAt, row.date)}
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.json} align="center">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0 rounded-lg"
                            title="Download JSON"
                            onClick={() => downloadJson(row)}
                          >
                            <FileJson className="h-3.5 w-3.5" />
                            <span className="sr-only">Download JSON</span>
                          </Button>
                        </ResizableTableCell>
                        <ResizableTableCell width={widths.actions} align="center">
                          <div className="flex items-center justify-center gap-0.5 opacity-80 group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg"
                              title="Edit"
                              onClick={() => {
                                setEditRow(row);
                                setEditOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                              title="Remove"
                              disabled={removingRow === row.rowIndex}
                              onClick={() => handleDelete(row.rowIndex)}
                            >
                              {removingRow === row.rowIndex ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </ResizableTableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <PreviewDialog
          open={preview != null}
          onOpenChange={(open) => !open && setPreview(null)}
          title={preview?.title ?? "Preview"}
          url={preview?.url ?? ""}
        />

        <ResumeDBEditDialog
          row={editRow}
          open={editOpen}
          onOpenChange={(open) => {
            setEditOpen(open);
            if (!open) setEditRow(null);
          }}
          onSaved={handleEditSaved}
        />
      </div>
    </JobsLayout>
  );
}
