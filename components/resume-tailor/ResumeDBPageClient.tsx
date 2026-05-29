"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import {
  Download,
  ExternalLink,
  Eye,
  FileJson,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

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
};

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
              className="w-full flex-1 min-h-[480px] rounded-md border bg-muted"
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

export function ResumeDBPageClient() {
  const [rows, setRows] = useState<ResumeDbRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    url: string;
  } | null>(null);

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
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

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
      toast.success("Row deleted.");
      loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setRemovingRow(null);
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Resume Management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {rows.length} application{rows.length === 1 ? "" : "s"} — register
              new jobs via the Smart Job extension.
            </p>
          </div>
          <Button variant="outline" onClick={loadRows} disabled={isLoading}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search company, role, resume file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Registered applications</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading applications…
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {rows.length === 0
                  ? "No entries yet. Use the extension Register tab on a job posting."
                  : "No matches for your search."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[56px]">ID</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Job link</TableHead>
                      <TableHead>Job title</TableHead>
                      <TableHead>Resume</TableHead>
                      <TableHead>Cover letter</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Applied</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => {
                      const resumeName = fileNameFromUrl(
                        row.resumeUrl,
                        "resume",
                      );
                      const coverName = fileNameFromUrl(
                        row.coverLetterUrl,
                        "cover letter",
                      );
                      return (
                        <TableRow key={row.rowIndex}>
                          <TableCell className="font-mono text-xs">
                            {row.entryId || row.rowIndex}
                          </TableCell>
                          <TableCell className="font-medium max-w-[140px] truncate">
                            {row.company || "—"}
                          </TableCell>
                          <TableCell>
                            {row.jobLink ? (
                              <Button variant="link" size="sm" className="h-auto p-0" asChild>
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
                          <TableCell className="max-w-[160px] truncate">
                            {row.jobTitle || "—"}
                          </TableCell>
                          <TableCell>
                            {row.resumeUrl ? (
                              <div className="flex flex-col gap-1 min-w-[140px]">
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      setPreview({
                                        title: `Resume — ${row.company}`,
                                        url: row.resumeUrl,
                                      })
                                    }
                                  >
                                    <Eye className="h-3 w-3 mr-1" />
                                    Preview
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    asChild
                                  >
                                    <a
                                      href={row.resumeUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      download
                                    >
                                      <Download className="h-3 w-3 mr-1" />
                                      Download
                                    </a>
                                  </Button>
                                </div>
                                <span
                                  className="text-[10px] text-muted-foreground truncate"
                                  title={resumeName}
                                >
                                  {resumeName}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.coverLetterUrl ? (
                              <div className="flex flex-col gap-1 min-w-[140px]">
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      setPreview({
                                        title: `Cover letter — ${row.company}`,
                                        url: row.coverLetterUrl,
                                      })
                                    }
                                  >
                                    <Eye className="h-3 w-3 mr-1" />
                                    Preview
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    asChild
                                  >
                                    <a
                                      href={row.coverLetterUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      download
                                    >
                                      <Download className="h-3 w-3 mr-1" />
                                      Download
                                    </a>
                                  </Button>
                                </div>
                                <span
                                  className="text-[10px] text-muted-foreground truncate"
                                  title={coverName}
                                >
                                  {coverName}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-normal">
                              {row.apply || "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {row.date || "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Download JSON"
                                onClick={() => downloadJson(row)}
                              >
                                <FileJson className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                title="Delete row"
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
                      );
                    })}
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
      </div>
    </JobsLayout>
  );
}
