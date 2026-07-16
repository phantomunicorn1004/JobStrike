"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Table,
  TableBody,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ResumeDBEditDialog } from "@/components/resume-tailor/ResumeDBEditDialog";
import {
  extractGoogleDriveFileId,
  googleDriveViewUrl,
} from "@/lib/google-drive/urls";
import {
  ResizableSortableHead,
  ResizableTableCell,
  ResizableTableHead,
} from "@/components/resume-tailor/ResumeDBResizableTable";
import {
  useResizableColumns,
  RESUME_DB_COLUMN_DEFAULTS,
  type ResumeDBColumnId,
} from "@/components/resume-tailor/useResizableColumns";
import {
  COLUMN_ORDER,
  FLEX_COLUMN_IDS,
  getNeighborColumnId,
  measureColumnFitPx,
} from "@/components/resume-tailor/resumeDbTableConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  pipelineStageId: string | null;
  inPipeline: boolean;
};

type PipelineStageOption = {
  id: string;
  name: string;
  sort_order: number;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 150, 200] as const;

type SortKey = "company" | "jobTitle" | "pipeline" | null;
type SortDir = "asc" | "desc";

function getDocumentViewUrl(url: string): string {
  const fileId = extractGoogleDriveFileId(url);
  if (fileId) return googleDriveViewUrl(fileId);
  return url;
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain?.[1]?.trim() || null;
}

async function downloadApplicationFile(
  applicationId: number,
  kind: "resume" | "cover",
  fallbackName: string,
) {
  const res = await fetch(
    `/api/resume-db/download?id=${applicationId}&kind=${kind}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Download failed");
  }

  const blob = await res.blob();
  const fileName =
    filenameFromContentDisposition(res.headers.get("content-disposition")) ||
    fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function ResumeFileActions({
  applicationId,
  url,
  company,
}: {
  applicationId: number;
  url: string;
  company: string;
}) {
  const viewUrl = getDocumentViewUrl(url);

  return (
    <div className="flex items-center justify-center gap-1 mx-auto w-fit">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 rounded-md shrink-0"
        title={`Open resume on Google Drive — ${company}`}
        onClick={() => window.open(viewUrl, "_blank", "noopener,noreferrer")}
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="sr-only">Open resume in new tab</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 rounded-md shrink-0"
        title={`Download resume — ${company}`}
        onClick={() => {
          void downloadApplicationFile(
            applicationId,
            "resume",
            `${company || "resume"}-resume.docx`,
          ).catch((error) => {
            toast.error(
              error instanceof Error ? error.message : "Download failed.",
            );
          });
        }}
      >
        <Download className="h-3.5 w-3.5" />
        <span className="sr-only">Download resume</span>
      </Button>
    </div>
  );
}

function DocActions({
  applicationId,
  url,
  label,
  company,
}: {
  applicationId: number;
  url: string;
  label: string;
  company: string;
}) {
  const kind = label.toLowerCase().includes("cover") ? "cover" : "resume";
  const viewUrl = getDocumentViewUrl(url);

  return (
    <div className="flex items-center justify-center gap-1 mx-auto w-fit">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 rounded-md shrink-0"
        title={`Open ${label} on Google Drive — ${company}`}
        onClick={() => window.open(viewUrl, "_blank", "noopener,noreferrer")}
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="sr-only">Open {label} in new tab</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 rounded-md shrink-0"
        title={`Download ${label}`}
        onClick={() => {
          void downloadApplicationFile(
            applicationId,
            kind,
            `${company || "document"}-${kind === "cover" ? "cover-letter" : "resume"}.docx`,
          ).catch((error) => {
            toast.error(
              error instanceof Error ? error.message : "Download failed.",
            );
          });
        }}
      >
        <Download className="h-3.5 w-3.5" />
        <span className="sr-only">Download {label}</span>
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
  orphanCandidateNames: string[] = [],
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
  for (const rawName of orphanCandidateNames) {
    const name = rawName.trim();
    if (!name) continue;
    const normalized = name.toLowerCase();
    if (profileNames.has(normalized)) continue;
    orphanNames.set(normalized, name);
  }

  // Fallback: also consider any orphan candidates present in the current page.
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
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={
                active && selectedLabel
                  ? `Candidate filter: ${selectedLabel}`
                  : "Filter by candidate"
              }
              className={cn(
                "relative h-9 w-9 rounded-xl shrink-0",
                active && "border-primary/60 bg-primary/5 text-primary",
              )}
            >
              <User className="h-4 w-4" />
              {active && (
                <span
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
                  aria-hidden
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {active && selectedLabel ? `Candidate: ${selectedLabel}` : "Filter by candidate"}
        </TooltipContent>
      </Tooltip>
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

  const activeLabel =
    dateFrom && dateTo
      ? `${dateFrom} – ${dateTo}`
      : dateFrom
        ? `From ${dateFrom}`
        : dateTo
          ? `Until ${dateTo}`
          : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={
                active && activeLabel
                  ? `Applied date filter: ${activeLabel}`
                  : "Filter by applied date"
              }
              className={cn(
                "relative h-9 w-9 rounded-xl shrink-0",
                active && "border-primary/60 bg-primary/5 text-primary",
              )}
            >
              <CalendarRange className="h-4 w-4" />
              {active && (
                <span
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
                  aria-hidden
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {active && activeLabel ? `Applied date: ${activeLabel}` : "Filter by applied date"}
        </TooltipContent>
      </Tooltip>
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

function StatusFilter({
  value,
  stages,
  onApply,
  onClear,
}: {
  value: string;
  stages: PipelineStageOption[];
  onApply: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const active = value !== "__all__";

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  const clear = () => {
    setDraft("__all__");
    onClear();
    setOpen(false);
  };

  const selectedLabel =
    draft === "__all__"
      ? "All statuses"
      : draft === "registered"
        ? "Registered"
        : stages.find((s) => s.id === draft)?.name ?? "Status";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={
                active
                  ? `Status filter: ${selectedLabel}`
                  : "Filter by status"
              }
              className={cn(
                "relative h-9 w-9 rounded-xl shrink-0",
                active && "border-primary/60 bg-primary/5 text-primary",
              )}
            >
              <Workflow className="h-4 w-4" />
              {active && (
                <span
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
                  aria-hidden
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {active ? `Status: ${selectedLabel}` : "Filter by status"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 p-3" align="start">
        <p className="text-sm font-medium mb-3">Filter by status</p>
        <Select
          value={draft || "__all__"}
          onValueChange={(v) => setDraft(v)}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            <SelectItem value="registered">Registered</SelectItem>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stages.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Loading statuses…
          </p>
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

export function ResumeDBPageClient() {
  const [rows, setRows] = useState<ResumeDbRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const [updatingStageRow, setUpdatingStageRow] = useState<number | null>(null);
  const [pipelineStages, setPipelineStages] = useState<PipelineStageOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [editRow, setEditRow] = useState<ResumeDbRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const { percents, resizePair, fitColumn } = useResizableColumns();
  const [profiles, setProfiles] = useState<{ id: number; full_name: string }[]>([]);
  const [candidateFilter, setCandidateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [orphanCandidateNames, setOrphanCandidateNames] = useState<string[]>([]);
  const [orphanCandidateNamesLoaded, setOrphanCandidateNamesLoaded] = useState(false);

  const loadProfiles = useCallback(async () => {
    try {
      const profilesRes = await fetch("/api/profiles", {
        credentials: "same-origin",
      });
      if (!profilesRes.ok) return;
      const profileData = (await profilesRes.json().catch(() => ({}))) as {
        profiles?: { id: number; full_name: string }[];
      };
      setProfiles(profileData.profiles ?? []);
    } catch {
      // ignore profile load errors (table still works)
    }
  }, []);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (candidateFilter) params.set("candidateFilter", candidateFilter);
      if (statusFilter && statusFilter !== "__all__") {
        params.set("statusFilter", statusFilter);
      }
      if (!orphanCandidateNamesLoaded) {
        params.set("includeOrphans", "1");
      }
      if (sortKey) params.set("sortKey", sortKey);
      params.set("sortDir", sortDir);

      const url = `/api/resume-db?${params.toString()}`;
      const resumeRes = await fetch(url, { credentials: "same-origin" });
      if (!resumeRes.ok) {
        const err = await resumeRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load Resume DB.");
      }
      const data = await resumeRes.json();
      setRows(data.resumes ?? []);
      setPipelineStages(data.pipelineStages ?? []);
      setTotalCount(Number(data.total ?? 0));
      if (!orphanCandidateNamesLoaded) {
        setOrphanCandidateNames(data.orphanCandidateNames ?? []);
        setOrphanCandidateNamesLoaded(true);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load Resume DB.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    page,
    pageSize,
    search,
    dateFrom,
    dateTo,
    candidateFilter,
    statusFilter,
    sortKey,
    sortDir,
    orphanCandidateNamesLoaded,
  ]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    pageSize,
    dateFrom,
    dateTo,
    candidateFilter,
    statusFilter,
    sortKey,
    sortDir,
  ]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, dateFrom, dateTo, candidateFilter, statusFilter]);

  const candidateFilterOptions = useMemo(
    () =>
      buildCandidateFilterOptions(
        profiles,
        rows,
        orphanCandidateNames,
      ),
    [profiles, rows, orphanCandidateNames],
  );

  const handleSort = (key: Exclude<SortKey, null>) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const hasActiveFilters = Boolean(
    search.trim() || dateFrom || dateTo || candidateFilter || (statusFilter && statusFilter !== "__all__"),
  );

  // Server-side pagination/filtering/sorting: `rows` is already the current page.
  const filtered = rows;
  const sorted = rows;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows;

  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(safePage * pageSize, totalCount);

  const handleAutoFitColumn = useCallback(
    (columnId: ResumeDBColumnId) => {
      const tableWidth = tableRef.current?.offsetWidth ?? 1000;
      const fitPx = measureColumnFitPx(columnId, pageRows);
      fitColumn(columnId, (fitPx / tableWidth) * 100, FLEX_COLUMN_IDS);
    },
    [pageRows, fitColumn],
  );

  const columnResizeProps = useCallback(
    (columnId: ResumeDBColumnId) => ({
      columnId,
      widthPercent: percents[columnId],
      rightColumnId: getNeighborColumnId(columnId),
      tableRef,
      onResizePair: resizePair,
      onAutoFit: handleAutoFitColumn,
    }),
    [percents, resizePair, handleAutoFitColumn],
  );

  const handleDelete = async (rowIndex: number) => {
    if (!confirm("Delete this application?")) return;
    setRemovingRow(rowIndex);
    try {
      const res = await fetch(`/api/resume-db?id=${rowIndex}`, {
        method: "DELETE",
        credentials: "same-origin",
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

  const handlePipelineStageChange = async (
    row: ResumeDbRow,
    pipelineStageId: string,
  ) => {
    setUpdatingStageRow(row.rowIndex);
    try {
      const res = await fetch("/api/resume-db", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          rowIndex: row.rowIndex,
          pipelineStageId:
            pipelineStageId === "registered" ? "" : pipelineStageId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update status.");
      }
      setRows((prev) =>
        prev.map((r) =>
          r.rowIndex === row.rowIndex
            ? {
                ...r,
                pipelineStageId: data.pipelineStageId ?? null,
                inPipeline: data.inPipeline ?? Boolean(data.pipelineStageId),
                apply: data.apply ?? r.apply,
                pipelineJobId: data.pipelineJobId ?? r.pipelineJobId,
              }
            : r,
        ),
      );
      toast.success("Status updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Status update failed.");
    } finally {
      setUpdatingStageRow(null);
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
      const res = await fetch(`/api/resume-db/export?id=${row.rowIndex}`, {
        credentials: "same-origin",
      });
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
          const res = await fetch(`/api/resume-db/export?id=${id}`, {
            credentials: "same-origin",
          });
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
          const res = await fetch(`/api/resume-db?id=${id}`, {
            method: "DELETE",
            credentials: "same-origin",
          });
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
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Resume DB</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {totalCount} application{totalCount === 1 ? "" : "s"} — register via
              the Smart Job extension. Set status to move jobs through the{" "}
              <Link href="/jobs" className="text-primary underline-offset-4 hover:underline">
                pipeline
              </Link>
              .
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg shadow-sm shrink-0"
                onClick={loadRows}
                disabled={isLoading}
                aria-label="Refresh applications"
              >
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="relative min-w-[160px] flex-1 sm:max-w-xs lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 rounded-xl bg-card h-9"
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

          <StatusFilter
            value={statusFilter}
            stages={pipelineStages}
            onApply={setStatusFilter}
            onClear={() => setStatusFilter("__all__")}
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
                setStatusFilter("__all__");
              }}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear filters
            </Button>
          )}

          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            {!isLoading && (
              <span className="text-xs text-muted-foreground whitespace-nowrap mr-1 hidden md:inline">
                {totalCount === 0
                  ? hasActiveFilters
                    ? "No matches"
                    : "No applications"
                  : `${rangeStart}–${rangeEnd} of ${totalCount}`}
              </span>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline whitespace-nowrap">
              Rows
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(Number(v))}
            >
              <SelectTrigger className="h-9 w-[76px] rounded-xl" size="sm">
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
              disabled={safePage <= 1 || totalCount === 0}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs tabular-nums min-w-[72px] text-center text-muted-foreground">
              {totalCount === 0 ? "0 / 0" : `${safePage} / ${totalPages}`}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl"
              disabled={safePage >= totalPages || totalCount === 0}
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

        <Card className="flex min-h-0 flex-1 flex-col gap-0 rounded-xl py-0">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground sm:p-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading applications…
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center sm:p-6">
                {hasActiveFilters
                  ? "No matches for your search, date, candidate, or status filters."
                  : "No entries yet. Use the extension Register tab on a job posting."}
              </p>
            ) : (
              <div>
                <p className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border/40">
                  Drag a column border to resize. Double-click a border to fit the left column.
                </p>
                <Table
                  ref={tableRef}
                  scrollable
                  className="table-fixed w-full min-w-[1280px]"
                >
                  <colgroup>
                    {COLUMN_ORDER.map((id) => (
                      <col
                        key={id}
                        style={{
                          width: `${percents[id] ?? RESUME_DB_COLUMN_DEFAULTS[id]}%`,
                        }}
                      />
                    ))}
                  </colgroup>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/40">
                      <ResizableTableHead
                        {...columnResizeProps("select")}
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
                        {...columnResizeProps("no")}
                        align="center"
                      >
                        No
                      </ResizableTableHead>
                      <ResizableTableHead {...columnResizeProps("profile")}>
                        Profile
                      </ResizableTableHead>
                      <ResizableTableHead {...columnResizeProps("jobLink")}>
                        Job link
                      </ResizableTableHead>
                      <ResizableSortableHead
                        {...columnResizeProps("company")}
                        label="Company"
                        active={sortKey === "company"}
                        direction={sortDir}
                        onSort={() => handleSort("company")}
                      />
                      <ResizableSortableHead
                        {...columnResizeProps("jobTitle")}
                        label="Job title"
                        active={sortKey === "jobTitle"}
                        direction={sortDir}
                        onSort={() => handleSort("jobTitle")}
                      />
                      <ResizableTableHead
                        {...columnResizeProps("resume")}
                        align="center"
                      >
                        Resume
                      </ResizableTableHead>
                      <ResizableTableHead
                        {...columnResizeProps("coverLetter")}
                        align="center"
                      >
                        Cover letter
                      </ResizableTableHead>
                      <ResizableSortableHead
                        {...columnResizeProps("pipeline")}
                        label="Status"
                        active={sortKey === "pipeline"}
                        direction={sortDir}
                        onSort={() => handleSort("pipeline")}
                        align="center"
                      />
                      <ResizableTableHead {...columnResizeProps("applied")}>
                        Applied
                      </ResizableTableHead>
                      <ResizableTableHead
                        {...columnResizeProps("json")}
                        align="center"
                      >
                        JSON
                      </ResizableTableHead>
                      <ResizableTableHead
                        {...columnResizeProps("actions")}
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
                        <ResizableTableCell widthPercent={percents.select} align="center">
                          <Checkbox
                            checked={selectedIds.has(row.rowIndex)}
                            onCheckedChange={() => toggleSelectRow(row.rowIndex)}
                            aria-label={`Select ${row.company || "application"}`}
                          />
                        </ResizableTableCell>
                        <ResizableTableCell
                          widthPercent={percents.no}
                          align="center"
                          className="tabular-nums text-muted-foreground"
                        >
                          {rangeStart + index}
                        </ResizableTableCell>
                        <ResizableTableCell widthPercent={percents.profile}>
                          <span className="block truncate" title={row.candidate || undefined}>
                            {row.candidate || "—"}
                          </span>
                        </ResizableTableCell>
                        <ResizableTableCell widthPercent={percents.jobLink}>
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
                        <ResizableTableCell widthPercent={percents.company} className="font-medium text-primary">
                          <span className="block truncate" title={row.company || undefined}>
                            {row.company || "—"}
                          </span>
                        </ResizableTableCell>
                        <ResizableTableCell widthPercent={percents.jobTitle}>
                          <span className="block truncate" title={row.jobTitle || undefined}>
                            {row.jobTitle || "—"}
                          </span>
                        </ResizableTableCell>
                        <ResizableTableCell widthPercent={percents.resume} align="center">
                          {row.resumeUrl ? (
                            <ResumeFileActions
                              applicationId={row.rowIndex}
                              url={row.resumeUrl}
                              company={row.company}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </ResizableTableCell>
                        <ResizableTableCell widthPercent={percents.coverLetter} align="center">
                          {row.coverLetterUrl ? (
                            <DocActions
                              applicationId={row.rowIndex}
                              url={row.coverLetterUrl}
                              label="Cover letter"
                              company={row.company}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </ResizableTableCell>
                        <ResizableTableCell
                          widthPercent={percents.pipeline}
                          align="center"
                          className="overflow-hidden"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <Select
                              value={row.pipelineStageId ?? "registered"}
                              disabled={updatingStageRow === row.rowIndex}
                              onValueChange={(value) =>
                                void handlePipelineStageChange(row, value)
                              }
                            >
                              <SelectTrigger
                                className="h-8 min-w-[108px] max-w-full rounded-lg border-border/70 bg-background px-2 text-xs"
                                size="sm"
                                aria-label={`Status for ${row.company || "application"}`}
                              >
                                <SelectValue placeholder="Status" />
                              </SelectTrigger>
                              <SelectContent align="end">
                                <SelectItem value="registered">Applied</SelectItem>
                                {pipelineStages.map((stage) => (
                                  <SelectItem key={stage.id} value={stage.id}>
                                    {stage.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {updatingStageRow === row.rowIndex ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                            ) : row.pipelineStageId ? (
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
                          widthPercent={percents.applied}
                          className="text-xs tabular-nums text-muted-foreground whitespace-nowrap"
                        >
                          {formatApplied(row.appliedAt, row.date)}
                        </ResizableTableCell>
                        <ResizableTableCell
                          widthPercent={percents.json}
                          align="center"
                          className="overflow-hidden"
                        >
                          <div className="flex items-center justify-center">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 shrink-0 p-0 rounded-lg"
                              title="Download JSON"
                              onClick={() => downloadJson(row)}
                            >
                              <FileJson className="h-3.5 w-3.5" />
                              <span className="sr-only">Download JSON</span>
                            </Button>
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell
                          widthPercent={percents.actions}
                          align="center"
                          className="overflow-hidden"
                        >
                          <div className="flex items-center justify-center gap-0.5 opacity-80 group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 rounded-lg"
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
                              className="h-8 w-8 shrink-0 rounded-lg text-destructive hover:text-destructive"
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
