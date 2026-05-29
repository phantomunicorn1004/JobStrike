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
  Download,
  ExternalLink,
  Eye,
  FileJson,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Workflow,
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const [togglingRow, setTogglingRow] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);

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
  }, [search, pageSize]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
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
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, filtered.length);

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

  const downloadJson = async (row: ResumeDbRow) => {
    try {
      const res = await fetch(
        `/api/resume-db/export?id=${row.rowIndex}&download=1`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resume-db-${row.entryId || row.rowIndex}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("JSON downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
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
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Registered applications</CardTitle>
                <CardDescription>
                  Preview documents, export JSON, or send to the job pipeline.
                </CardDescription>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 rounded-xl bg-muted/30 border-border/60"
                  placeholder="Search company, role, ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
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
                  : "No matches for your search."}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-muted/30">
                        <TableHead className="font-semibold w-[72px]">ID</TableHead>
                        <TableHead className="font-semibold">Company</TableHead>
                        <TableHead className="font-semibold">Job link</TableHead>
                        <TableHead className="font-semibold">Job title</TableHead>
                        <TableHead className="font-semibold">Resume</TableHead>
                        <TableHead className="font-semibold">Cover letter</TableHead>
                        <TableHead className="font-semibold w-[120px]">Pipeline</TableHead>
                        <TableHead className="font-semibold w-[160px]">Applied</TableHead>
                        <TableHead className="font-semibold text-right w-[88px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((row) => (
                        <TableRow
                          key={row.rowIndex}
                          className="group hover:bg-muted/20 transition-colors"
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {String(row.entryId || row.rowIndex).slice(0, 12)}
                          </TableCell>
                          <TableCell className="font-medium max-w-[120px] truncate">
                            {row.company || "—"}
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
                            <div className="flex justify-end gap-0.5 opacity-80 group-hover:opacity-100">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                title="Download JSON"
                                onClick={() => downloadJson(row)}
                              >
                                <FileJson className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                                title="Delete"
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

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20 rounded-b-2xl">
                  <p className="text-xs text-muted-foreground">
                    Showing {rangeStart}–{rangeEnd} of {filtered.length}
                    {search.trim() ? ` (filtered from ${rows.length})` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Rows per page</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(v) => setPageSize(Number(v))}
                      >
                        <SelectTrigger className="h-8 w-[72px] rounded-lg" size="sm">
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
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-lg"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs tabular-nums min-w-[80px] text-center">
                        Page {safePage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-lg"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <PreviewDialog
          open={preview != null}
          onOpenChange={(open) => !open && setPreview(null)}
          title={preview?.title ?? "Preview"}
          url={preview?.url ?? ""}
        />
      </div>
    </JobsLayout>
  );
}
