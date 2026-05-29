"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ResumeDBEditDialog } from "@/components/resume-tailor/ResumeDBEditDialog";
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
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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

function SortableHead({
  label,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  active: boolean;
  direction: SortDir;
  onSort: () => void;
  className?: string;
}) {
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-1 font-semibold hover:text-foreground transition-colors",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </button>
    </TableHead>
  );
}

function fileNameFromUrl(url: string, fallback: string): string {
  if (!url) return fallback;
  try {
    const path = new URL(url).pathname;
    const segment = path.split("/").filter(Boolean).pop();
    return segment && segment.length < 80 ? decodeURIComponent(segment) : fallback;
  } catch {
    return fallback;
  }
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
  const name = fileNameFromUrl(url, label);
  return (
    <div className="flex flex-col gap-1.5 min-w-[130px]">
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs rounded-lg"
          onClick={() => onPreview(`${label} — ${company}`, url)}
        >
          <Eye className="h-3 w-3 mr-1" />
          Preview
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer" download>
            <Download className="h-3 w-3 mr-1" />
            Download
          </a>
        </Button>
      </div>
      <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={name}>
        {name}
      </span>
    </div>
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

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/resume-db");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load Resume DB.");
      }
      const data = await res.json();
      setRows(data.resumes ?? []);
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
  }, [search, pageSize, dateFrom, dateTo, sortKey, sortDir]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, dateFrom, dateTo]);

  const handleSort = (key: Exclude<SortKey, null>) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const hasActiveFilters = Boolean(search.trim() || dateFrom || dateTo);

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
      if (!isWithinAppliedDateRange(r.appliedAt, dateFrom, dateTo)) return false;
      return true;
    });
  }, [rows, search, dateFrom, dateTo]);

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
      <div className="flex flex-col gap-6 max-w-[1400px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Resume Management</h1>
            <p className="text-sm text-muted-foreground">
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
            className="rounded-xl shadow-sm"
            onClick={loadRows}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <Card className="rounded-2xl border-border/60 shadow-sm">
          <CardHeader className="pb-3 space-y-3">
            <div>
              <CardTitle className="text-lg">Registered applications</CardTitle>
              <CardDescription>
                Preview documents, export JSON, or send to the job pipeline.
              </CardDescription>
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-end gap-2">
              <div className="relative flex-1 xl:max-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-9 rounded-xl bg-muted/30 border-border/60 h-9"
                  placeholder="Search company, role, ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                  <span className="sr-only">Applied from</span>
                  <span aria-hidden="true">From</span>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-9 w-[140px] rounded-xl bg-muted/30 border-border/60 text-xs"
                    aria-label="Applied date from"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                  <span className="sr-only">Applied to</span>
                  <span aria-hidden="true">To</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                    className="h-9 w-[140px] rounded-xl bg-muted/30 border-border/60 text-xs"
                    aria-label="Applied date to"
                  />
                </label>

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
                    }}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Clear
                  </Button>
                )}

                <div className="flex items-center gap-1.5 ml-auto xl:ml-0 shrink-0 border-l border-border/60 pl-2">
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
                    {sorted.length === 0
                      ? "0 / 0"
                      : `${safePage} / ${totalPages}`}
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
            </div>

            {!isLoading && selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="text-sm font-medium">
                  {selectedIds.size} selected
                </span>
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
            {!isLoading && (
              <p className="text-xs text-muted-foreground">
                {filtered.length === 0
                  ? rows.length === 0
                    ? "No applications yet."
                    : "No matches for your filters."
                  : `Showing ${rangeStart}–${rangeEnd} of ${sorted.length}${
                      hasActiveFilters ? ` (${rows.length} total)` : ""
                    }`}
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading applications…
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-8 text-sm text-muted-foreground text-center">
                {rows.length === 0
                  ? "No entries yet. Use the extension Register tab on a job posting."
                  : "No matches for your search or date filters."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-muted/30">
                        <TableHead className="w-[44px]">
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
                        </TableHead>
                        <TableHead className="font-semibold w-[52px]">No</TableHead>
                        <TableHead className="font-semibold">Job link</TableHead>
                        <SortableHead
                          label="Company"
                          active={sortKey === "company"}
                          direction={sortDir}
                          onSort={() => handleSort("company")}
                        />
                        <SortableHead
                          label="Job title"
                          active={sortKey === "jobTitle"}
                          direction={sortDir}
                          onSort={() => handleSort("jobTitle")}
                          className="max-w-[160px]"
                        />
                        <TableHead className="font-semibold">Resume</TableHead>
                        <TableHead className="font-semibold">Cover letter</TableHead>
                        <SortableHead
                          label="Pipeline"
                          active={sortKey === "pipeline"}
                          direction={sortDir}
                          onSort={() => handleSort("pipeline")}
                          className="w-[120px]"
                        />
                        <TableHead className="font-semibold w-[160px]">Applied</TableHead>
                        <TableHead className="font-semibold w-[72px]">JSON</TableHead>
                        <TableHead className="font-semibold text-right w-[88px]">Actions</TableHead>
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
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(row.rowIndex)}
                              onCheckedChange={() => toggleSelectRow(row.rowIndex)}
                              aria-label={`Select ${row.company || "application"}`}
                            />
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-muted-foreground">
                            {rangeStart + index}
                          </TableCell>
                          <TableCell>
                            {row.jobLink ? (
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-primary"
                                asChild
                              >
                                <a
                                  href={row.jobLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Open
                                  <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                              </Button>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="font-medium max-w-[120px] truncate">
                            {row.company || "—"}
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate">
                            {row.jobTitle || "—"}
                          </TableCell>
                          <TableCell>
                            {row.resumeUrl ? (
                              <DocActions
                                url={row.resumeUrl}
                                label="Resume"
                                company={row.company}
                                onPreview={(title, url) => setPreview({ title, url })}
                              />
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.coverLetterUrl ? (
                              <DocActions
                                url={row.coverLetterUrl}
                                label="Cover letter"
                                company={row.company}
                                onPreview={(title, url) => setPreview({ title, url })}
                              />
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={row.inPipeline}
                                disabled={togglingRow === row.rowIndex}
                                onCheckedChange={(checked) =>
                                  handlePipelineToggle(row, checked)
                                }
                                aria-label={`Add ${row.company} to pipeline`}
                              />
                              {togglingRow === row.rowIndex ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              ) : row.inPipeline ? (
                                <Link
                                  href="/jobs"
                                  className="text-[10px] text-primary flex items-center gap-0.5 hover:underline"
                                  title="View in pipeline"
                                >
                                  <Workflow className="h-3 w-3" />
                                  Pipeline
                                </Link>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">
                                  Off
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                            {formatApplied(row.appliedAt, row.date)}
                          </TableCell>
                          <TableCell>
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
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-0.5 opacity-80 group-hover:opacity-100">
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
                          </TableCell>
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
