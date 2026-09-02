"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  Building2,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Link2,
  Link2Off,
  ListFilter,
  Loader2,
  RefreshCw,
  Search,
  ShieldBan,
} from "lucide-react";
import JobsLayout from "@/app/jobs-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  applyOptionalScrapeFilters,
  classifyJobAgainstResumeDb,
  jobMatchesBlockedJobs,
  jobsToCsv,
  normalizeAtsName,
  normalizeCompanyName,
  type BlockedJobRef,
  type JobDuplicateStatus,
  type RegisteredJobRef,
  type ScrapedJob,
} from "@/lib/job-scraper";
import {
  clearJobScraperSession,
  loadJobScraperSession,
  saveJobScraperSession,
} from "@/lib/job-scraper-storage";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type DateWindow = "1d" | "3d" | "7d";

type BlockedCompany = {
  id: string;
  companyName: string;
  note: string | null;
  createdAt: string;
};

type BlockedAts = {
  id: string;
  atsName: string;
  note: string | null;
  createdAt: string;
};

type BlockedJob = {
  id: string;
  jobLink: string;
  jobTitle: string | null;
  companyName: string | null;
  note: string | null;
  createdAt: string;
};

type CandidateOption = {
  key: string;
  label: string;
};

type JobRow = ScrapedJob;

type FilterContext = {
  blockedCompanies: string[];
  blockedAts: string[];
  blockedJobs: BlockedJobRef[];
  registeredCompanies: string[];
  registeredJobs: RegisteredJobRef[];
  registeredJobCount: number;
  registeredCompanyCount: number;
};

type ScrapeStats = {
  scraped: number;
  deduped: number;
  removedByDate: number;
  baseRemaining: number;
  removedRegisteredJobs: number;
  removedRegisteredCompanies: number;
  removedBlockedJobs: number;
  removedBlocked: number;
  removedAts: number;
  remaining: number;
  pagesFetched: number;
  reportedTotal: number | null;
  dateCutoff?: string;
  dateWindow?: DateWindow;
};

type ScrapeResponse = {
  baseJobs: JobRow[];
  jobs: JobRow[];
  csv: string;
  filterContext: FilterContext;
  stats: ScrapeStats;
};

const DATE_WINDOW_OPTIONS: Array<{ value: DateWindow; label: string }> = [
  { value: "1d", label: "24h" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function collectLinks(jobs: JobRow[]): string[] {
  return jobs
    .map((job) => job.apply_url?.trim())
    .filter((value): value is string => Boolean(value));
}

function getJobKey(job: JobRow): string {
  return [
    job.apply_url ?? "",
    job.company_name ?? "",
    job.title ?? "",
    job.estimated_publish_date ?? "",
    job.application_site ?? "",
  ].join("||");
}

function JobDuplicateBadges({ status }: { status?: JobDuplicateStatus }) {
  if (!status) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {status.registeredJob ? (
        <Badge variant="destructive" className="text-[10px]">
          Reg. job
        </Badge>
      ) : null}
      {status.registeredCompany ? (
        <Badge variant="destructive" className="text-[10px]">
          Reg. company
        </Badge>
      ) : null}
      {status.similarCompany ? (
        <Badge variant="outline" className="text-[10px]">
          Similar co.
        </Badge>
      ) : null}
    </div>
  );
}

const UNCATEGORIZED_CATEGORY = "__uncategorized__";

function getJobCategoryKey(job: JobRow): string {
  const value = job.job_category?.trim();
  return value ? value : UNCATEGORIZED_CATEGORY;
}

function JobCategoryHeaderFilter({
  options,
  selected,
  onChange,
}: {
  options: Array<{ key: string; label: string; count: number }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected));
  const active = selected.size > 0;

  useEffect(() => {
    if (open) setDraft(new Set(selected));
  }, [open, selected]);

  const toggleDraft = (key: string, checked: boolean) => {
    setDraft((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const apply = () => {
    onChange(new Set(draft));
    setOpen(false);
  };

  const clear = () => {
    setDraft(new Set());
    onChange(new Set());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                active
                  ? `Category filter: ${selected.size} selected`
                  : "Filter by job category"
              }
              className={cn(
                "relative h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground",
                active && "text-primary",
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              {active ? (
                <span
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
                  aria-hidden
                />
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {active
            ? `${selected.size} categor${selected.size === 1 ? "y" : "ies"} selected`
            : "Filter by job category"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72 p-3 text-sm [&_button]:text-xs" align="start">
        <p className="mb-2 text-xs font-medium">Filter by category</p>
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">No categories in results.</p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-auto pr-1">
            {options.map((option) => {
              const checked = draft.has(option.key);
              return (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/60"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => toggleDraft(option.key, value === true)}
                    className="mt-0.5"
                    aria-label={option.label}
                  />
                  <span className="min-w-0 flex-1 leading-snug">{option.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{option.count}</span>
                </label>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clear}>
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={apply}
            disabled={options.length === 0}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function JobScraperPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSizeRaw = Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeRaw as (typeof PAGE_SIZE_OPTIONS)[number])
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE;
  const search = searchParams.get("q") ?? "";

  const [dateWindow, setDateWindow] = useState<DateWindow>("3d");
  const [excludeBlocked, setExcludeBlocked] = useState(true);
  const [excludeBlockedAts, setExcludeBlockedAts] = useState(true);
  const [excludeBlockedJobs, setExcludeBlockedJobs] = useState(true);
  const [excludeRegisteredJobs, setExcludeRegisteredJobs] = useState(true);
  const [excludeRegisteredCompanies, setExcludeRegisteredCompanies] = useState(true);
  const [candidateFilter, setCandidateFilter] = useState("");
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [blockedCompanies, setBlockedCompanies] = useState<BlockedCompany[]>([]);
  const [blockedAts, setBlockedAts] = useState<BlockedAts[]>([]);
  const [blockedJobs, setBlockedJobs] = useState<BlockedJob[]>([]);
  const [resumeDbCompanies, setResumeDbCompanies] = useState<string[]>([]);
  const [registeredJobCount, setRegisteredJobCount] = useState(0);
  const [resumeDbCompanyCount, setResumeDbCompanyCount] = useState(0);
  const [newBlockedCompany, setNewBlockedCompany] = useState("");
  const [bulkBlockedCompanies, setBulkBlockedCompanies] = useState("");
  const [newBlockedAts, setNewBlockedAts] = useState("");
  const [bulkBlockedAts, setBulkBlockedAts] = useState("");
  const [searchDraft, setSearchDraft] = useState(search);
  const [loadingBlocked, setLoadingBlocked] = useState(true);
  const [savingBlocked, setSavingBlocked] = useState(false);
  const [savingAts, setSavingAts] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAtsId, setDeletingAtsId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [savingBlockedJob, setSavingBlockedJob] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [baseJobs, setBaseJobs] = useState<JobRow[]>([]);
  const [filterContext, setFilterContext] = useState<FilterContext | null>(null);
  const [scrapeMeta, setScrapeMeta] = useState<Pick<
    ScrapeStats,
    "scraped" | "deduped" | "removedByDate" | "baseRemaining" | "pagesFetched" | "reportedTotal" | "dateCutoff" | "dateWindow"
  > | null>(null);
  const [blockedDialogOpen, setBlockedDialogOpen] = useState(false);
  const [blockedAtsDialogOpen, setBlockedAtsDialogOpen] = useState(false);
  const [companiesSheetOpen, setCompaniesSheetOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const saved = loadJobScraperSession();
    if (saved) {
      setDateWindow(saved.dateWindow || "3d");
      setCandidateFilter(saved.candidateFilter || "");
      setExcludeBlocked(saved.excludeBlocked !== false);
      setExcludeBlockedAts(saved.excludeBlockedAts !== false);
      setExcludeBlockedJobs(saved.excludeBlockedJobs !== false);
      setExcludeRegisteredJobs(saved.excludeRegisteredJobs !== false);
      setExcludeRegisteredCompanies(saved.excludeRegisteredCompanies !== false);
      setBaseJobs(saved.baseJobs ?? []);
      setFilterContext(saved.filterContext ?? null);
      setScrapeMeta(saved.scrapeMeta ?? null);
      if (saved.filterContext) {
        setResumeDbCompanies(saved.filterContext.registeredCompanies ?? []);
        setResumeDbCompanyCount(
          Number(saved.filterContext.registeredCompanyCount ?? 0),
        );
        setRegisteredJobCount(Number(saved.filterContext.registeredJobCount ?? 0));
      }
    }
    setSessionHydrated(true);
  }, []);

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (!sessionHydrated) return;
    if (!scrapeMeta && baseJobs.length === 0) {
      clearJobScraperSession();
      return;
    }
    saveJobScraperSession({
      version: 1,
      savedAt: new Date().toISOString(),
      dateWindow,
      candidateFilter,
      excludeBlocked,
      excludeBlockedAts,
      excludeBlockedJobs,
      excludeRegisteredJobs,
      excludeRegisteredCompanies,
      baseJobs,
      filterContext,
      scrapeMeta,
    });
  }, [
    sessionHydrated,
    dateWindow,
    candidateFilter,
    excludeBlocked,
    excludeBlockedAts,
    excludeBlockedJobs,
    excludeRegisteredJobs,
    excludeRegisteredCompanies,
    baseJobs,
    filterContext,
    scrapeMeta,
  ]);

  const clearSavedResults = () => {
    setBaseJobs([]);
    setFilterContext(null);
    setScrapeMeta(null);
    setSelectedKeys(new Set());
    setSelectedCategories(new Set());
    clearJobScraperSession();
    updateParams({ page: "1", q: null });
    setSearchDraft("");
    toast.success("Saved scrape results cleared.");
  };

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const applySearch = useCallback(() => {
    const nextQuery = searchDraft.trim();
    if (nextQuery === search) {
      if (page !== 1) updateParams({ page: "1" });
      return;
    }
    updateParams({
      q: nextQuery || null,
      page: "1",
    });
  }, [page, search, searchDraft, updateParams]);

  const loadBlockedCompanies = useCallback(async (selectedCandidate?: string) => {
    const filter = selectedCandidate ?? candidateFilter;
    setLoadingBlocked(true);
    try {
      const params = new URLSearchParams();
      if (filter) params.set("candidateFilter", filter);
      const res = await fetch(
        `/api/job-scraper/blocked-companies${params.toString() ? `?${params}` : ""}`,
        { credentials: "same-origin" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load company lists.");
      setBlockedCompanies(data.blockedCompanies ?? []);
      setBlockedAts(data.blockedAts ?? []);
      setBlockedJobs(data.blockedJobs ?? []);
      setCandidates(data.candidates ?? []);
      setResumeDbCompanies(data.resumeDbCompanies ?? []);
      setResumeDbCompanyCount(Number(data.resumeDbCompanyCount ?? 0));
      setRegisteredJobCount(Number(data.registeredJobCount ?? 0));
      setFilterContext((current) => ({
        blockedCompanies:
          (data.blockedCompanies ?? []).map(
            (company: BlockedCompany) => company.companyName,
          ),
        blockedAts: (data.blockedAts ?? []).map((ats: BlockedAts) => ats.atsName),
        blockedJobs: (data.blockedJobs ?? []).map((job: BlockedJob) => ({
          jobLink: job.jobLink,
          jobTitle: job.jobTitle,
          companyName: job.companyName,
        })),
        registeredCompanies: data.resumeDbCompanies ?? current?.registeredCompanies ?? [],
        registeredJobs: data.registeredJobs ?? current?.registeredJobs ?? [],
        registeredJobCount: Number(
          data.registeredJobCount ?? current?.registeredJobCount ?? 0,
        ),
        registeredCompanyCount: Number(
          data.resumeDbCompanyCount ?? current?.registeredCompanyCount ?? 0,
        ),
      }));
      if (!filter && Array.isArray(data.candidates) && data.candidates.length === 1) {
        setCandidateFilter((data.candidates[0] as CandidateOption).key);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load company lists.",
      );
    } finally {
      setLoadingBlocked(false);
    }
  }, [candidateFilter]);

  useEffect(() => {
    void loadBlockedCompanies(candidateFilter);
  }, [candidateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const runScrape = async () => {
    if (
      (excludeRegisteredJobs || excludeRegisteredCompanies) &&
      !candidateFilter
    ) {
      toast.error("Select a profile before using Resume DB filters.");
      return;
    }
    setScraping(true);
    try {
      const res = await fetch("/api/job-scraper/scrape", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateWindow,
          excludeBlocked,
          excludeBlockedAts,
          excludeBlockedJobs,
          excludeRegisteredJobs,
          excludeRegisteredCompanies,
          candidateFilter,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ScrapeResponse> & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Scrape failed.");
      setBaseJobs(data.baseJobs ?? data.jobs ?? []);
      setSelectedKeys(new Set());
      setSelectedCategories(new Set());
      setFilterContext(
        data.filterContext ?? {
          blockedCompanies: blockedCompanies.map((c) => c.companyName),
          blockedAts: blockedAts.map((a) => a.atsName),
          blockedJobs: blockedJobs.map((job) => ({
            jobLink: job.jobLink,
            jobTitle: job.jobTitle,
            companyName: job.companyName,
          })),
          registeredCompanies: resumeDbCompanies,
          registeredJobs: [],
          registeredJobCount: registeredJobCount,
          registeredCompanyCount: resumeDbCompanyCount,
        },
      );
      if (data.stats) {
        setScrapeMeta({
          scraped: data.stats.scraped,
          deduped: data.stats.deduped,
          removedByDate: data.stats.removedByDate,
          baseRemaining: data.stats.baseRemaining ?? (data.baseJobs ?? []).length,
          pagesFetched: data.stats.pagesFetched,
          reportedTotal: data.stats.reportedTotal,
          dateCutoff: data.stats.dateCutoff,
          dateWindow: data.stats.dateWindow,
        });
      }
      if (data.filterContext) {
        setResumeDbCompanies(data.filterContext.registeredCompanies ?? []);
        setResumeDbCompanyCount(
          Number(data.filterContext.registeredCompanyCount ?? 0),
        );
        setRegisteredJobCount(Number(data.filterContext.registeredJobCount ?? 0));
      }
      updateParams({ page: "1" });
      toast.success("Scrape completed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scrape failed.");
    } finally {
      setScraping(false);
    }
  };

  const saveBlockedCompanies = async (payload: Record<string, unknown>) => {
    setSavingBlocked(true);
    try {
      const res = await fetch("/api/job-scraper/blocked-companies", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add blocked company.");
      const nextBlocked = (data.blockedCompanies ?? []) as BlockedCompany[];
      setBlockedCompanies(nextBlocked);
      setNewBlockedCompany("");
      setBulkBlockedCompanies("");
      setFilterContext((current) =>
        current
          ? {
              ...current,
              blockedCompanies: nextBlocked.map((company) => company.companyName),
            }
          : current,
      );
      toast.success("Blocked companies updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add blocked company.",
      );
    } finally {
      setSavingBlocked(false);
    }
  };

  const addBlockedCompanies = async (mode: "single" | "bulk") => {
    const payload =
      mode === "bulk"
        ? { companiesText: bulkBlockedCompanies }
        : { companyName: newBlockedCompany };
    await saveBlockedCompanies(payload);
  };

  const removeBlockedCompany = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/job-scraper/blocked-companies?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      setBlockedCompanies((current) => current.filter((company) => company.id !== id));
      setFilterContext((current) => {
        if (!current) return current;
        const removed = blockedCompanies.find((company) => company.id === id);
        if (!removed) return current;
        return {
          ...current,
          blockedCompanies: current.blockedCompanies.filter(
            (name) => normalizeCompanyName(name) !== normalizeCompanyName(removed.companyName),
          ),
        };
      });
      toast.success("Blocked company removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const saveBlockedAts = async (payload: Record<string, unknown>) => {
    setSavingAts(true);
    try {
      const res = await fetch("/api/job-scraper/blocked-ats", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add blocked ATS.");
      const nextAts = (data.blockedAts ?? []) as BlockedAts[];
      setBlockedAts(nextAts);
      setNewBlockedAts("");
      setBulkBlockedAts("");
      setFilterContext((current) =>
        current
          ? {
              ...current,
              blockedAts: nextAts.map((ats) => ats.atsName),
            }
          : current,
      );
      toast.success("Blocked ATS updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add blocked ATS.");
    } finally {
      setSavingAts(false);
    }
  };

  const addBlockedAtsItems = async (mode: "single" | "bulk") => {
    const payload =
      mode === "bulk" ? { atsText: bulkBlockedAts } : { atsName: newBlockedAts };
    await saveBlockedAts(payload);
  };

  const removeBlockedAtsItem = async (id: string) => {
    setDeletingAtsId(id);
    try {
      const res = await fetch(`/api/job-scraper/blocked-ats?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      setBlockedAts((current) => current.filter((ats) => ats.id !== id));
      setFilterContext((current) => {
        if (!current) return current;
        const removed = blockedAts.find((ats) => ats.id === id);
        if (!removed) return current;
        return {
          ...current,
          blockedAts: current.blockedAts.filter(
            (name) => normalizeAtsName(name) !== normalizeAtsName(removed.atsName),
          ),
        };
      });
      toast.success("Blocked ATS removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingAtsId(null);
    }
  };

  const addCompanyFromRow = async (companyName: string | null) => {
    if (!companyName?.trim()) return;
    await saveBlockedCompanies({ companyName });
  };

  const addAtsFromRow = async (atsName: string | null) => {
    if (!atsName?.trim() || atsName === "Unknown") return;
    await saveBlockedAts({ atsName });
  };

  const saveBlockedJob = async (payload: {
    jobLink: string;
    jobTitle?: string | null;
    companyName?: string | null;
    note?: string | null;
  }) => {
    setSavingBlockedJob(true);
    try {
      const res = await fetch("/api/job-scraper/blocked-jobs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to block job.");
      const nextJobs = (data.blockedJobs ?? []) as BlockedJob[];
      setBlockedJobs(nextJobs);
      setFilterContext((current) =>
        current
          ? {
              ...current,
              blockedJobs: nextJobs.map((job) => ({
                jobLink: job.jobLink,
                jobTitle: job.jobTitle,
                companyName: job.companyName,
              })),
            }
          : current,
      );
      toast.success(
        data.alreadyBlocked ? "Job is already on your blocked list." : "Job blocked.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to block job.");
    } finally {
      setSavingBlockedJob(false);
    }
  };

  const removeBlockedJob = async (id: string) => {
    setDeletingJobId(id);
    try {
      const res = await fetch(`/api/job-scraper/blocked-jobs?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      setBlockedJobs((current) => current.filter((job) => job.id !== id));
      setFilterContext((current) => {
        if (!current) return current;
        const removed = blockedJobs.find((job) => job.id === id);
        if (!removed) return current;
        return {
          ...current,
          blockedJobs: current.blockedJobs.filter(
            (job) => job.jobLink.trim() !== removed.jobLink.trim(),
          ),
        };
      });
      toast.success("Blocked job removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingJobId(null);
    }
  };

  const addJobFromRow = async (job: JobRow) => {
    const jobLink = job.apply_url?.trim();
    if (!jobLink) return;
    await saveBlockedJob({
      jobLink,
      jobTitle: job.title,
      companyName: job.company_name,
    });
  };

  const blockedJobRefs = useMemo<BlockedJobRef[]>(
    () =>
      (filterContext?.blockedJobs ??
        blockedJobs.map((job) => ({
          jobLink: job.jobLink,
          jobTitle: job.jobTitle,
          companyName: job.companyName,
        }))) as BlockedJobRef[],
    [blockedJobs, filterContext?.blockedJobs],
  );

  const duplicateStatuses = useMemo(() => {
    if (!candidateFilter) return new Map<string, JobDuplicateStatus>();
    const context = filterContext ?? {
      blockedCompanies: blockedCompanies.map((c) => c.companyName),
      blockedAts: blockedAts.map((a) => a.atsName),
      blockedJobs: blockedJobRefs,
      registeredCompanies: resumeDbCompanies,
      registeredJobs: [],
      registeredJobCount,
      registeredCompanyCount: resumeDbCompanyCount,
    };
    const map = new Map<string, JobDuplicateStatus>();
    for (const job of baseJobs) {
      map.set(
        getJobKey(job),
        classifyJobAgainstResumeDb(job, {
          registeredJobs: context.registeredJobs,
          registeredCompanies: context.registeredCompanies,
        }),
      );
    }
    return map;
  }, [
    baseJobs,
    blockedAts,
    blockedCompanies,
    candidateFilter,
    filterContext,
    registeredJobCount,
    resumeDbCompanies,
    resumeDbCompanyCount,
  ]);

  const duplicateSummary = useMemo(() => {
    let registeredJob = 0;
    let registeredCompany = 0;
    let similarCompany = 0;
    duplicateStatuses.forEach((status) => {
      if (status.registeredJob) registeredJob += 1;
      if (status.registeredCompany) registeredCompany += 1;
      if (status.similarCompany) similarCompany += 1;
    });
    return { registeredJob, registeredCompany, similarCompany };
  }, [duplicateStatuses]);

  const filteredResult = useMemo(() => {
    if (!scrapeMeta) return null;
    const context = filterContext ?? {
      blockedCompanies: blockedCompanies.map((c) => c.companyName),
      blockedAts: blockedAts.map((a) => a.atsName),
      blockedJobs: blockedJobRefs,
      registeredCompanies: resumeDbCompanies,
      registeredJobs: [],
      registeredJobCount,
      registeredCompanyCount: resumeDbCompanyCount,
    };
    const { filtered, stats: optionalStats } = applyOptionalScrapeFilters(baseJobs, {
      excludeRegisteredJobs: Boolean(candidateFilter) && excludeRegisteredJobs,
      excludeRegisteredCompanies: Boolean(candidateFilter) && excludeRegisteredCompanies,
      excludeBlockedJobs,
      excludeBlockedCompanies: excludeBlocked,
      excludeBlockedAts,
      registeredJobs: context.registeredJobs,
      registeredCompanies: context.registeredCompanies,
      blockedJobs: context.blockedJobs,
      blockedCompanies: context.blockedCompanies,
      blockedAts: context.blockedAts,
    });
    return {
      jobs: filtered,
      csv: jobsToCsv(filtered),
      stats: {
        ...scrapeMeta,
        removedRegisteredJobs:
          candidateFilter && excludeRegisteredJobs
            ? optionalStats.removedRegisteredJobs
            : 0,
        removedRegisteredCompanies:
          candidateFilter && excludeRegisteredCompanies
            ? optionalStats.removedRegisteredCompanies
            : 0,
        removedBlockedJobs: excludeBlockedJobs ? optionalStats.removedBlockedJobs : 0,
        removedBlocked: excludeBlocked ? optionalStats.removedBlocked : 0,
        removedAts: excludeBlockedAts ? optionalStats.removedAts : 0,
        remaining: filtered.length,
      } satisfies ScrapeStats,
    };
  }, [
    baseJobs,
    blockedAts,
    blockedCompanies,
    blockedJobRefs,
    candidateFilter,
    excludeBlocked,
    excludeBlockedAts,
    excludeBlockedJobs,
    excludeRegisteredCompanies,
    excludeRegisteredJobs,
    filterContext,
    registeredJobCount,
    resumeDbCompanies,
    resumeDbCompanyCount,
    scrapeMeta,
  ]);

  const jobCategoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of filteredResult?.jobs ?? []) {
      const key = getJobCategoryKey(job);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({
        key,
        label: key === UNCATEGORIZED_CATEGORY ? "Uncategorized" : key,
        count,
      }))
      .sort((a, b) => {
        if (a.key === UNCATEGORIZED_CATEGORY) return 1;
        if (b.key === UNCATEGORIZED_CATEGORY) return -1;
        return a.label.localeCompare(b.label);
      });
  }, [filteredResult?.jobs]);

  const filteredJobs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (filteredResult?.jobs ?? []).filter((job) => {
      if (selectedCategories.size > 0 && !selectedCategories.has(getJobCategoryKey(job))) {
        return false;
      }
      if (!keyword) return true;
      return [job.company_name, job.title, job.application_site, job.job_category]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [filteredResult?.jobs, search, selectedCategories]);

  const applyCategoryFilter = useCallback(
    (next: Set<string>) => {
      setSelectedCategories(next);
      if (page !== 1) updateParams({ page: "1" });
    },
    [page, updateParams],
  );

  useEffect(() => {
    setSelectedCategories((current) => {
      if (current.size === 0) return current;
      const allowed = new Set(jobCategoryOptions.map((option) => option.key));
      const next = new Set<string>();
      for (const key of current) {
        if (allowed.has(key)) next.add(key);
      }
      return next.size === current.size ? current : next;
    });
  }, [jobCategoryOptions]);

  const totalFiltered = filteredJobs.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);
  const rangeStart = totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = totalFiltered === 0 ? 0 : Math.min(safePage * pageSize, totalFiltered);
  const pagedJobs = filteredJobs.slice((safePage - 1) * pageSize, safePage * pageSize);

  const filteredJobKeys = useMemo(
    () => filteredJobs.map((job) => getJobKey(job)),
    [filteredJobs],
  );
  const pagedJobKeys = useMemo(
    () => pagedJobs.map((job) => getJobKey(job)),
    [pagedJobs],
  );

  useEffect(() => {
    setSelectedKeys((current) => {
      if (current.size === 0) return current;
      const allowed = new Set(filteredJobKeys);
      const next = new Set<string>();
      for (const key of current) {
        if (allowed.has(key)) next.add(key);
      }
      return next.size === current.size ? current : next;
    });
  }, [filteredJobKeys]);

  const selectedJobs = useMemo(() => {
    if (selectedKeys.size === 0) return [];
    return filteredJobs.filter((job) => selectedKeys.has(getJobKey(job)));
  }, [filteredJobs, selectedKeys]);

  const actionJobs = selectedKeys.size > 0 ? selectedJobs : filteredJobs;
  const allPagedSelected =
    pagedJobKeys.length > 0 && pagedJobKeys.every((key) => selectedKeys.has(key));
  const somePagedSelected =
    pagedJobKeys.some((key) => selectedKeys.has(key)) && !allPagedSelected;

  const toggleSelectAllPaged = (checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) {
        for (const key of pagedJobKeys) next.add(key);
      } else {
        for (const key of pagedJobKeys) next.delete(key);
      }
      return next;
    });
  };

  const toggleSelectJob = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const downloadSelectedCsv = () => {
    if (actionJobs.length === 0) {
      toast.error("No jobs to download.");
      return;
    }
    downloadTextFile(
      jobsToCsv(actionJobs),
      selectedKeys.size > 0 ? "hiring-cafe-selected.csv" : "hiring-cafe-jobs.csv",
      "text/csv;charset=utf-8",
    );
    toast.success(
      selectedKeys.size > 0
        ? `CSV downloaded (${actionJobs.length} selected).`
        : "CSV downloaded.",
    );
  };

  const copyLinks = async () => {
    const links = collectLinks(actionJobs);
    if (links.length === 0) {
      toast.error("No links to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(links.join("\n"));
      toast.success(
        selectedKeys.size > 0
          ? `Copied ${links.length} selected link(s).`
          : "Job links copied.",
      );
    } catch {
      toast.error("Copy failed.");
    }
  };

  const downloadLinks = () => {
    const links = collectLinks(actionJobs);
    if (links.length === 0) {
      toast.error("No links to download.");
      return;
    }
    downloadTextFile(
      links.join("\n"),
      selectedKeys.size > 0 ? "hiring-cafe-selected-links.txt" : "hiring-cafe-links.txt",
      "text/plain;charset=utf-8",
    );
    toast.success(
      selectedKeys.size > 0
        ? `Links file downloaded (${links.length} selected).`
        : "Links downloaded.",
    );
  };

  const openLinks = () => {
    const links = collectLinks(actionJobs);
    if (links.length === 0) {
      toast.error("No links to open.");
      return;
    }
    const maxOpen = 20;
    if (links.length > maxOpen) {
      toast.error(`Select at most ${maxOpen} jobs to open at once (selected ${links.length}).`);
      return;
    }
    for (const link of links) {
      window.open(link, "_blank", "noopener,noreferrer");
    }
    toast.success(`Opened ${links.length} link(s).`);
  };

  useEffect(() => {
    if (page !== safePage) {
      updateParams({ page: String(safePage) });
    }
  }, [page, safePage, updateParams]);

  const selectedCandidateLabel =
    candidates.find((candidate) => candidate.key === candidateFilter)?.label ?? "No profile";
  const actionScopeLabel =
    selectedKeys.size > 0 ? `${selectedKeys.size} selected` : "all results";

  return (
    <JobsLayout>
      <div className="relative flex h-full min-h-0 w-full flex-col gap-2.5 text-sm [&_button]:text-xs [&_input]:text-xs [&_textarea]:text-xs [&_[data-slot=badge]]:text-[11px] [&_[data-slot=table]]:text-xs">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Job Scraper</h1>
            <p className="text-xs text-muted-foreground">
              Results-first scrape review for hiringcafe.com.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Dialog open={blockedDialogOpen} onOpenChange={setBlockedDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Ban className="mr-2 h-4 w-4" />
                  Blocked companies
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto text-sm sm:max-w-xl [&_button]:text-xs [&_input]:text-xs [&_textarea]:text-xs">
                <DialogHeader>
                  <DialogTitle>Blocked companies</DialogTitle>
                  <DialogDescription>
                    Manage companies you never want in scrape results. Stored separately from Resume DB.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={newBlockedCompany}
                      onChange={(e) => setNewBlockedCompany(e.target.value)}
                      placeholder="Add one company"
                    />
                    <Button
                      type="button"
                      onClick={() => addBlockedCompanies("single")}
                      disabled={savingBlocked || !newBlockedCompany.trim()}
                    >
                      Add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Textarea
                      value={bulkBlockedCompanies}
                      onChange={(e) => setBulkBlockedCompanies(e.target.value)}
                      placeholder="Bulk add, one company per line"
                      rows={4}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => addBlockedCompanies("bulk")}
                      disabled={savingBlocked || !bulkBlockedCompanies.trim()}
                    >
                      Bulk add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">
                      Current list ({blockedCompanies.length})
                    </div>
                    <div className="max-h-[280px] space-y-2 overflow-auto rounded-md border p-2">
                      {loadingBlocked ? (
                        <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading…
                        </div>
                      ) : blockedCompanies.length === 0 ? (
                        <p className="p-2 text-sm text-muted-foreground">
                          No blocked companies yet.
                        </p>
                      ) : (
                        blockedCompanies.map((company) => (
                          <div
                            key={company.id}
                            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="font-medium">{company.companyName}</div>
                              {company.note ? (
                                <div className="text-xs text-muted-foreground">{company.note}</div>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBlockedCompany(company.id)}
                              disabled={deletingId === company.id}
                            >
                              {deletingId === company.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Remove"
                              )}
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={blockedAtsDialogOpen} onOpenChange={setBlockedAtsDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <ShieldBan className="mr-2 h-4 w-4" />
                  Blocked ATS
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto text-sm sm:max-w-xl [&_button]:text-xs [&_input]:text-xs [&_textarea]:text-xs">
                <DialogHeader>
                  <DialogTitle>Blocked ATS</DialogTitle>
                  <DialogDescription>
                    Exclude jobs from these application sites during scrape (e.g. Greenhouse, Workday).
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={newBlockedAts}
                      onChange={(e) => setNewBlockedAts(e.target.value)}
                      placeholder="Add one ATS (e.g. Greenhouse)"
                    />
                    <Button
                      type="button"
                      onClick={() => addBlockedAtsItems("single")}
                      disabled={savingAts || !newBlockedAts.trim()}
                    >
                      Add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Textarea
                      value={bulkBlockedAts}
                      onChange={(e) => setBulkBlockedAts(e.target.value)}
                      placeholder="Bulk add, one ATS per line"
                      rows={4}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => addBlockedAtsItems("bulk")}
                      disabled={savingAts || !bulkBlockedAts.trim()}
                    >
                      Bulk add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">
                      Current list ({blockedAts.length})
                    </div>
                    <div className="max-h-[280px] space-y-2 overflow-auto rounded-md border p-2">
                      {loadingBlocked ? (
                        <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading…
                        </div>
                      ) : blockedAts.length === 0 ? (
                        <p className="p-2 text-sm text-muted-foreground">
                          No blocked ATS yet.
                        </p>
                      ) : (
                        blockedAts.map((ats) => (
                          <div
                            key={ats.id}
                            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                          >
                            <div className="min-w-0 font-medium">{ats.atsName}</div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBlockedAtsItem(ats.id)}
                              disabled={deletingAtsId === ats.id}
                            >
                              {deletingAtsId === ats.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Remove"
                              )}
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Sheet open={companiesSheetOpen} onOpenChange={setCompaniesSheetOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Building2 className="mr-2 h-4 w-4" />
                  Company lists
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-full text-sm sm:max-w-md [&_button]:text-xs [&_input]:text-xs [&_textarea]:text-xs"
              >
                <SheetHeader>
                  <SheetTitle>Company lists</SheetTitle>
                  <SheetDescription>
                    Registered companies/jobs for {selectedCandidateLabel}, plus your blocked lists.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4">
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">
                    Registered jobs for profile:{" "}
                    <span className="font-medium text-foreground">{registeredJobCount}</span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border p-3">
                    <div className="text-sm font-medium">
                      Resume DB companies ({resumeDbCompanyCount})
                    </div>
                    {!candidateFilter ? (
                      <p className="text-sm text-muted-foreground">
                        Select a profile to load registered companies.
                      </p>
                    ) : loadingBlocked ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading…
                      </div>
                    ) : resumeDbCompanies.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No registered companies for this profile.
                      </p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {resumeDbCompanies.map((company) => (
                          <li key={company} className="rounded-md px-2 py-1 hover:bg-muted/50">
                            {company}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border p-3">
                    <div className="text-sm font-medium">
                      Blocked companies ({blockedCompanies.length})
                    </div>
                    {blockedCompanies.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No blocked companies yet.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {blockedCompanies.map((company) => (
                          <li
                            key={company.id}
                            className="rounded-md px-2 py-1 hover:bg-muted/50"
                          >
                            {company.companyName}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border p-3">
                    <div className="text-sm font-medium">
                      Blocked ATS ({blockedAts.length})
                    </div>
                    {blockedAts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No blocked ATS yet.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {blockedAts.map((ats) => (
                          <li key={ats.id} className="rounded-md px-2 py-1 hover:bg-muted/50">
                            {ats.atsName}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border p-3">
                    <div className="text-sm font-medium">
                      Blocked jobs ({blockedJobs.length})
                    </div>
                    {blockedJobs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No blocked jobs yet.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {blockedJobs.map((job) => (
                          <li
                            key={job.id}
                            className="rounded-md border px-2 py-1.5 hover:bg-muted/50"
                          >
                            <div className="font-medium">
                              {job.companyName || "—"}
                              {job.jobTitle ? ` · ${job.jobTitle}` : ""}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {job.jobLink}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="mt-1 h-7 px-2 text-xs"
                              onClick={() => removeBlockedJob(job.id)}
                              disabled={deletingJobId === job.id}
                            >
                              {deletingJobId === job.id ? "Removing…" : "Unblock"}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <Card className="shrink-0">
          <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5">
                {DATE_WINDOW_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={dateWindow === option.value ? "default" : "outline"}
                    onClick={() => setDateWindow(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>

              <select
                value={candidateFilter}
                onChange={(e) => setCandidateFilter(e.target.value)}
                className="border-input bg-card dark:bg-input/30 h-8 min-w-[180px] rounded-md border px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                aria-label="Profile"
              >
                <option value="">Select profile…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={excludeBlocked}
                  onCheckedChange={(checked) => setExcludeBlocked(Boolean(checked))}
                />
                Blocked ({blockedCompanies.length})
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={excludeBlockedAts}
                  onCheckedChange={(checked) => setExcludeBlockedAts(Boolean(checked))}
                />
                ATS ({blockedAts.length})
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={excludeBlockedJobs}
                  onCheckedChange={(checked) => setExcludeBlockedJobs(Boolean(checked))}
                />
                Blocked jobs ({blockedJobs.length})
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={excludeRegisteredJobs}
                  onCheckedChange={(checked) => setExcludeRegisteredJobs(Boolean(checked))}
                  disabled={!candidateFilter}
                />
                Reg. jobs ({registeredJobCount})
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={excludeRegisteredCompanies}
                  onCheckedChange={(checked) =>
                    setExcludeRegisteredCompanies(Boolean(checked))
                  }
                  disabled={!candidateFilter}
                />
                Reg. companies ({resumeDbCompanyCount})
              </label>

              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => loadBlockedCompanies(candidateFilter)}
                  disabled={loadingBlocked}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
                <Button type="button" size="sm" onClick={runScrape} disabled={scraping}>
                  {scraping ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Scrape
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Scrape results</CardTitle>
                {filteredResult?.stats ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="secondary">Scraped {filteredResult.stats.scraped}</Badge>
                    <Badge variant="secondary">Deduped {filteredResult.stats.deduped}</Badge>
                    <Badge variant="secondary">
                      Outside date {filteredResult.stats.removedByDate ?? 0}
                    </Badge>
                    <Badge variant="secondary">
                      Reg. jobs {filteredResult.stats.removedRegisteredJobs}
                    </Badge>
                    <Badge variant="secondary">
                      Reg. companies {filteredResult.stats.removedRegisteredCompanies}
                    </Badge>
                    <Badge variant="secondary">
                      Blocked jobs {filteredResult.stats.removedBlockedJobs ?? 0}
                    </Badge>
                    {candidateFilter ? (
                      <>
                        <Badge variant="outline">
                          Reg. job tags {duplicateSummary.registeredJob}
                        </Badge>
                        <Badge variant="outline">
                          Reg. co. tags {duplicateSummary.registeredCompany}
                        </Badge>
                        <Badge variant="outline">
                          Similar co. {duplicateSummary.similarCompany}
                        </Badge>
                      </>
                    ) : null}
                    <Badge variant="secondary">
                      Blocked {filteredResult.stats.removedBlocked}
                    </Badge>
                    <Badge variant="secondary">
                      ATS {filteredResult.stats.removedAts ?? 0}
                    </Badge>
                    <Badge>Remaining {filteredResult.stats.remaining}</Badge>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Run a scrape to load jobs into this table.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedKeys.size > 0 ? (
                  <span className="text-xs text-muted-foreground">{actionScopeLabel}</span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadSelectedCsv}
                  disabled={actionJobs.length === 0}
                  title={`Download CSV for ${actionScopeLabel}`}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openLinks}
                  disabled={actionJobs.length === 0}
                  title={`Open links for ${actionScopeLabel} (max 20)`}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open links
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadLinks}
                  disabled={actionJobs.length === 0}
                  title={`Download links file for ${actionScopeLabel}`}
                >
                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  Links file
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyLinks}
                  disabled={actionJobs.length === 0}
                  title={`Copy links for ${actionScopeLabel}`}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy links
                </Button>
                {selectedKeys.size > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedKeys(new Set())}
                  >
                    Clear selection
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSavedResults}
                  disabled={!scrapeMeta && baseJobs.length === 0}
                >
                  Clear results
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-[220px] flex-1 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <ListFilter className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applySearch();
                      }
                    }}
                    placeholder="Search company, title, site…"
                    className="h-8 pl-8"
                  />
                </div>
                <Button type="button" size="sm" variant="outline" onClick={applySearch}>
                  <Search className="mr-1.5 h-3.5 w-3.5" />
                  Search
                </Button>
              </div>
              {filteredResult?.stats ? (
                <span className="text-xs text-muted-foreground">
                  Pages fetched: {filteredResult.stats.pagesFetched}
                  {filteredResult.stats.reportedTotal != null
                    ? ` · hiringcafe.com total: ${filteredResult.stats.reportedTotal}`
                    : ""}
                </span>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))] [&_tr]:border-b-0">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 bg-background px-3">
                      <Checkbox
                        aria-label="Select all on this page"
                        checked={
                          allPagedSelected
                            ? true
                            : somePagedSelected
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) =>
                          toggleSelectAllPaged(checked === true)
                        }
                        disabled={pagedJobs.length === 0}
                      />
                    </TableHead>
                    <TableHead className="h-9 bg-background">Company</TableHead>
                    <TableHead className="h-9 bg-background">
                      <div className="flex items-center gap-1">
                        <span>Title</span>
                        <JobCategoryHeaderFilter
                          options={jobCategoryOptions}
                          selected={selectedCategories}
                          onChange={applyCategoryFilter}
                        />
                      </div>
                    </TableHead>
                    <TableHead className="h-9 bg-background">ATS</TableHead>
                    <TableHead className="h-9 bg-background">Published</TableHead>
                    <TableHead className="h-9 bg-background">Link</TableHead>
                    <TableHead className="h-9 w-[88px] bg-background text-center">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedJobs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        {scraping ? "Scraping jobs…" : "No jobs on this page."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedJobs.map((job, index) => {
                      const jobKey = getJobKey(job);
                      const selected = selectedKeys.has(jobKey);
                      const duplicateStatus = duplicateStatuses.get(jobKey);
                      return (
                        <TableRow
                          key={`${jobKey}-${rangeStart + index}`}
                          className={cn(selected && "bg-primary/5")}
                          data-state={selected ? "selected" : undefined}
                        >
                          <TableCell className="px-3">
                            <Checkbox
                              aria-label={`Select ${job.title || job.company_name || "job"}`}
                              checked={selected}
                              onCheckedChange={(checked) =>
                                toggleSelectJob(jobKey, checked === true)
                              }
                            />
                          </TableCell>
                          <TableCell className="max-w-[180px] whitespace-normal">
                            <div className="font-medium">{job.company_name || "—"}</div>
                            {job.company_tagline ? (
                              <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                                {job.company_tagline}
                              </div>
                            ) : null}
                            <JobDuplicateBadges status={duplicateStatus} />
                            {job.apply_url &&
                            jobMatchesBlockedJobs(job.apply_url, blockedJobRefs) ? (
                              <Badge variant="secondary" className="mt-1 text-[10px]">
                                Blocked
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="max-w-[280px] whitespace-normal">
                            <div>{job.title || "—"}</div>
                            {job.job_category ? (
                              <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                                {job.job_category}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>{job.application_site || "Unknown"}</TableCell>
                          <TableCell className="whitespace-nowrap text-[11px] tabular-nums">
                            {job.estimated_publish_date || "—"}
                          </TableCell>
                          <TableCell>
                            {job.apply_url ? (
                              <Link
                                href={job.apply_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                Open <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-0.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    onClick={() => addJobFromRow(job)}
                                    disabled={!job.apply_url || savingBlockedJob}
                                    aria-label="Block job"
                                  >
                                    <Link2Off className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Block job</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    onClick={() => addCompanyFromRow(job.company_name)}
                                    disabled={!job.company_name || savingBlocked}
                                    aria-label="Block company"
                                  >
                                    <Ban className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Block company</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    onClick={() => addAtsFromRow(job.application_site)}
                                    disabled={
                                      !job.application_site ||
                                      job.application_site === "Unknown" ||
                                      savingAts
                                    }
                                    aria-label="Block ATS"
                                  >
                                    <ShieldBan className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Block ATS</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="text-xs text-muted-foreground">
                Showing {rangeStart}-{rangeEnd} of {totalFiltered}
                {selectedKeys.size > 0 ? ` · ${selectedKeys.size} selected` : ""}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={String(pageSize)}
                  onChange={(e) =>
                    updateParams({
                      pageSize: e.target.value,
                      page: "1",
                    })
                  }
                  className="border-input bg-card dark:bg-input/30 h-8 rounded-md border px-2 text-xs"
                  aria-label="Page size"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size} / page
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={safePage <= 1}
                  onClick={() => updateParams({ page: String(safePage - 1) })}
                >
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {safePage} / {totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={safePage >= totalPages}
                  onClick={() => updateParams({ page: String(safePage + 1) })}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </JobsLayout>
  );
}
