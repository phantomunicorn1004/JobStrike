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
import { normalizeCompanyName } from "@/lib/job-scraper";
import { toast } from "sonner";

type DateWindow = "1d" | "3d" | "7d";

type BlockedCompany = {
  id: string;
  companyName: string;
  note: string | null;
  createdAt: string;
};

type CandidateOption = {
  key: string;
  label: string;
};

type JobRow = {
  apply_url: string | null;
  title: string | null;
  core_job_title: string | null;
  requirements_summary: string | null;
  technical_tools: string | null;
  job_category: string | null;
  estimated_publish_date: string | null;
  role_activities: string | null;
  company_name: string | null;
  company_tagline: string | null;
  application_site: string;
};

type ScrapeResponse = {
  jobs: JobRow[];
  csv: string;
  stats: {
    scraped: number;
    deduped: number;
    removedBlocked: number;
    removedResumeDb: number;
    remaining: number;
    pagesFetched: number;
    reportedTotal: number | null;
  };
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
  const [excludeResumeDb, setExcludeResumeDb] = useState(true);
  const [candidateFilter, setCandidateFilter] = useState("");
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [blockedCompanies, setBlockedCompanies] = useState<BlockedCompany[]>([]);
  const [resumeDbCompanies, setResumeDbCompanies] = useState<string[]>([]);
  const [resumeDbCompanyCount, setResumeDbCompanyCount] = useState(0);
  const [newBlockedCompany, setNewBlockedCompany] = useState("");
  const [bulkBlockedCompanies, setBulkBlockedCompanies] = useState("");
  const [searchDraft, setSearchDraft] = useState(search);
  const [loadingBlocked, setLoadingBlocked] = useState(true);
  const [savingBlocked, setSavingBlocked] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [blockedDialogOpen, setBlockedDialogOpen] = useState(false);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft === search) return;
      updateParams({
        q: searchDraft.trim() || null,
        page: "1",
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, searchDraft, updateParams]);

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
      setCandidates(data.candidates ?? []);
      setResumeDbCompanies(data.resumeDbCompanies ?? []);
      setResumeDbCompanyCount(Number(data.resumeDbCompanyCount ?? 0));
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
    if (excludeResumeDb && !candidateFilter) {
      toast.error("Select a candidate before excluding Resume DB companies.");
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
          excludeResumeDb,
          candidateFilter,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ScrapeResponse> & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Scrape failed.");
      setResult(data as ScrapeResponse);
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
      setBlockedCompanies(data.blockedCompanies ?? []);
      setNewBlockedCompany("");
      setBulkBlockedCompanies("");
      setResult((current) => {
        if (!current) return current;
        const nextJobs = current.jobs.filter((job) => {
          const addedNames = (data.added ?? []) as BlockedCompany[];
          const jobName = normalizeCompanyName(job.company_name);
          return !addedNames.some(
            (company) => normalizeCompanyName(company.companyName) === jobName,
          );
        });
        return {
          ...current,
          jobs: nextJobs,
          stats: {
            ...current.stats,
            removedBlocked:
              current.stats.removedBlocked + (current.jobs.length - nextJobs.length),
            remaining: nextJobs.length,
          },
        };
      });
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
      toast.success("Blocked company removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const addCompanyFromRow = async (companyName: string | null) => {
    if (!companyName?.trim()) return;
    await saveBlockedCompanies({ companyName });
  };

  const copyLinks = async () => {
    const links = collectLinks(result?.jobs ?? []);
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
    const links = collectLinks(result?.jobs ?? []);
    if (links.length === 0) {
      toast.error("No links to download.");
      return;
    }
    downloadTextFile(links.join("\n"), "hiring-cafe-links.txt", "text/plain;charset=utf-8");
    toast.success("Links downloaded.");
  };

  const filteredJobs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return result?.jobs ?? [];
    return (result?.jobs ?? []).filter((job) => {
      return [job.company_name, job.title, job.application_site, job.job_category]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [result?.jobs, search]);

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
                    Registered companies for {selectedCandidateLabel}, plus blocked companies.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4">
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
                Blocked
              </label>
              <label className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Checkbox
                  checked={excludeResumeDb}
                  onCheckedChange={(checked) => setExcludeResumeDb(Boolean(checked))}
                  disabled={!candidateFilter}
                />
                Resume DB ({resumeDbCompanyCount})
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
                {result?.stats ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="secondary">Scraped {result.stats.scraped}</Badge>
                    <Badge variant="secondary">Deduped {result.stats.deduped}</Badge>
                    <Badge variant="secondary">Blocked {result.stats.removedBlocked}</Badge>
                    <Badge variant="secondary">Resume DB {result.stats.removedResumeDb}</Badge>
                    <Badge>Remaining {result.stats.remaining}</Badge>
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
                    result?.csv &&
                    downloadTextFile(result.csv, "hiring-cafe-jobs.csv", "text/csv;charset=utf-8")
                  }
                  disabled={!result?.csv}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadLinks}
                  disabled={!result?.jobs?.length}
                >
                  <Link2 className="mr-1.5 h-3.5 w-3.5" />
                  Links file
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyLinks}
                  disabled={!result?.jobs?.length}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy links
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <ListFilter className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Search company, title, site…"
                  className="h-8 pl-8"
                />
              </div>
              {result?.stats ? (
                <span className="text-xs text-muted-foreground">
                  Pages fetched: {result.stats.pagesFetched}
                  {result.stats.reportedTotal != null
                    ? ` · hiring.cafe total: ${result.stats.reportedTotal}`
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
