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
  Link2,
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
  applyOptionalScrapeFilters,
  jobsToCsv,
  normalizeAtsName,
  normalizeCompanyName,
  type RegisteredJobRef,
  type ScrapedJob,
} from "@/lib/job-scraper";
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

type CandidateOption = {
  key: string;
  label: string;
};

type JobRow = ScrapedJob;

type FilterContext = {
  blockedCompanies: string[];
  blockedAts: string[];
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
  const [excludeRegisteredJobs, setExcludeRegisteredJobs] = useState(true);
  const [excludeRegisteredCompanies, setExcludeRegisteredCompanies] = useState(true);
  const [candidateFilter, setCandidateFilter] = useState("");
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [blockedCompanies, setBlockedCompanies] = useState<BlockedCompany[]>([]);
  const [blockedAts, setBlockedAts] = useState<BlockedAts[]>([]);
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
  const [scraping, setScraping] = useState(false);
  const [baseJobs, setBaseJobs] = useState<JobRow[]>([]);
  const [filterContext, setFilterContext] = useState<FilterContext | null>(null);
  const [scrapeMeta, setScrapeMeta] = useState<Pick<
    ScrapeStats,
    "scraped" | "deduped" | "removedByDate" | "baseRemaining" | "pagesFetched" | "reportedTotal" | "dateCutoff" | "dateWindow"
  > | null>(null);
  const [blockedDialogOpen, setBlockedDialogOpen] = useState(false);
  const [blockedAtsDialogOpen, setBlockedAtsDialogOpen] = useState(false);
  const [companiesSheetOpen, setCompaniesSheetOpen] = useState(false);

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
      toast.error("Select a candidate before using Resume DB filters.");
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
      setFilterContext(
        data.filterContext ?? {
          blockedCompanies: blockedCompanies.map((c) => c.companyName),
          blockedAts: blockedAts.map((a) => a.atsName),
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

  const filteredResult = useMemo(() => {
    if (!scrapeMeta) return null;
    const context = filterContext ?? {
      blockedCompanies: blockedCompanies.map((c) => c.companyName),
      blockedAts: blockedAts.map((a) => a.atsName),
      registeredCompanies: resumeDbCompanies,
      registeredJobs: [],
      registeredJobCount,
      registeredCompanyCount: resumeDbCompanyCount,
    };
    const { filtered, stats: optionalStats } = applyOptionalScrapeFilters(baseJobs, {
      excludeRegisteredJobs: Boolean(candidateFilter) && excludeRegisteredJobs,
      excludeRegisteredCompanies: Boolean(candidateFilter) && excludeRegisteredCompanies,
      excludeBlockedCompanies: excludeBlocked,
      excludeBlockedAts,
      registeredJobs: context.registeredJobs,
      registeredCompanies: context.registeredCompanies,
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
        removedBlocked: excludeBlocked ? optionalStats.removedBlocked : 0,
        removedAts: excludeBlockedAts ? optionalStats.removedAts : 0,
        remaining: filtered.length,
      } satisfies ScrapeStats,
    };
  }, [
    baseJobs,
    blockedAts,
    blockedCompanies,
    candidateFilter,
    excludeBlocked,
    excludeBlockedAts,
    excludeRegisteredCompanies,
    excludeRegisteredJobs,
    filterContext,
    registeredJobCount,
    resumeDbCompanies,
    resumeDbCompanyCount,
    scrapeMeta,
  ]);

  const copyLinks = async () => {
    const links = collectLinks(filteredResult?.jobs ?? []);
    if (links.length === 0) {
      toast.error("No links to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(links.join("\n"));
      toast.success("Job links copied.");
    } catch {
      toast.error("Copy failed.");
    }
  };

  const downloadLinks = () => {
    const links = collectLinks(filteredResult?.jobs ?? []);
    if (links.length === 0) {
      toast.error("No links to download.");
      return;
    }
    downloadTextFile(links.join("\n"), "hiring-cafe-links.txt", "text/plain;charset=utf-8");
    toast.success("Links downloaded.");
  };

  const filteredJobs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return filteredResult?.jobs ?? [];
    return (filteredResult?.jobs ?? []).filter((job) => {
      return [job.company_name, job.title, job.application_site, job.job_category]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [filteredResult?.jobs, search]);

  const totalFiltered = filteredJobs.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);
  const rangeStart = totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = totalFiltered === 0 ? 0 : Math.min(safePage * pageSize, totalFiltered);
  const pagedJobs = filteredJobs.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page !== safePage) {
      updateParams({ page: String(safePage) });
    }
  }, [page, safePage, updateParams]);

  const selectedCandidateLabel =
    candidates.find((candidate) => candidate.key === candidateFilter)?.label ?? "No candidate";

  return (
    <JobsLayout>
      <div className="relative flex h-full min-h-0 w-full flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Job Scraper</h1>
            <p className="text-sm text-muted-foreground">
              Results-first scrape review for hiring.cafe.
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
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
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
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
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
              <SheetContent side="right" className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Company lists</SheetTitle>
                  <SheetDescription>
                    Registered companies/jobs for {selectedCandidateLabel}, plus your blocked lists.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4">
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">
                    Registered jobs for candidate:{" "}
                    <span className="font-medium text-foreground">{registeredJobCount}</span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border p-3">
                    <div className="text-sm font-medium">
                      Resume DB companies ({resumeDbCompanyCount})
                    </div>
                    {!candidateFilter ? (
                      <p className="text-sm text-muted-foreground">
                        Select a candidate to load registered companies.
                      </p>
                    ) : loadingBlocked ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading…
                      </div>
                    ) : resumeDbCompanies.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No registered companies for this candidate.
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
                className="border-input bg-card dark:bg-input/30 h-8 min-w-[180px] rounded-md border px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                aria-label="Candidate"
              >
                <option value="">Select candidate…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Checkbox
                  checked={excludeBlocked}
                  onCheckedChange={(checked) => setExcludeBlocked(Boolean(checked))}
                />
                Blocked ({blockedCompanies.length})
              </label>
              <label className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Checkbox
                  checked={excludeBlockedAts}
                  onCheckedChange={(checked) => setExcludeBlockedAts(Boolean(checked))}
                />
                ATS ({blockedAts.length})
              </label>
              <label className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Checkbox
                  checked={excludeRegisteredJobs}
                  onCheckedChange={(checked) => setExcludeRegisteredJobs(Boolean(checked))}
                  disabled={!candidateFilter}
                />
                Reg. jobs ({registeredJobCount})
              </label>
              <label className="flex items-center gap-1.5 text-xs sm:text-sm">
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
                <CardTitle className="text-lg">Scrape results</CardTitle>
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

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    filteredResult?.csv &&
                    downloadTextFile(
                      filteredResult.csv,
                      "hiring-cafe-jobs.csv",
                      "text/csv;charset=utf-8",
                    )
                  }
                  disabled={!filteredResult?.csv}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadLinks}
                  disabled={!filteredResult?.jobs?.length}
                >
                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  Links file
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyLinks}
                  disabled={!filteredResult?.jobs?.length}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy links
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
                    ? ` · hiring.cafe total: ${filteredResult.stats.reportedTotal}`
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
                    <TableHead className="bg-background">Company</TableHead>
                    <TableHead className="bg-background">Title</TableHead>
                    <TableHead className="bg-background">ATS</TableHead>
                    <TableHead className="bg-background">Published</TableHead>
                    <TableHead className="bg-background">Link</TableHead>
                    <TableHead className="bg-background">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedJobs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        {scraping ? "Scraping jobs…" : "No jobs on this page."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedJobs.map((job, index) => (
                      <TableRow
                        key={`${job.apply_url ?? job.company_name ?? "job"}-${rangeStart + index}`}
                      >
                        <TableCell className="max-w-[180px] whitespace-normal">
                          <div className="font-medium">{job.company_name || "—"}</div>
                          {job.company_tagline ? (
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {job.company_tagline}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[280px] whitespace-normal">
                          <div>{job.title || "—"}</div>
                          {job.job_category ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {job.job_category}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>{job.application_site || "Unknown"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
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
                          <div className="flex flex-col gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => addCompanyFromRow(job.company_name)}
                              disabled={!job.company_name || savingBlocked}
                            >
                              <Ban className="mr-1 h-4 w-4" />
                              Block
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => addAtsFromRow(job.application_site)}
                              disabled={
                                !job.application_site ||
                                job.application_site === "Unknown" ||
                                savingAts
                              }
                            >
                              <ShieldBan className="mr-1 h-4 w-4" />
                              Block ATS
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="text-xs text-muted-foreground">
                Showing {rangeStart}-{rangeEnd} of {totalFiltered}
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
