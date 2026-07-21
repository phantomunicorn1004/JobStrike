"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Ban, Download, ExternalLink, Loader2, RefreshCw, Search, Copy } from "lucide-react";
import JobsLayout from "@/app/jobs-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  { value: "1d", label: "Within 24 hours" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
];

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hiring-cafe-jobs.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function JobScraperPageClient() {
  const [dateWindow, setDateWindow] = useState<DateWindow>("3d");
  const [excludeBlocked, setExcludeBlocked] = useState(true);
  const [excludeResumeDb, setExcludeResumeDb] = useState(true);
  const [candidateFilter, setCandidateFilter] = useState("");
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [blockedCompanies, setBlockedCompanies] = useState<BlockedCompany[]>([]);
  const [resumeDbCompanyCount, setResumeDbCompanyCount] = useState(0);
  const [newBlockedCompany, setNewBlockedCompany] = useState("");
  const [bulkBlockedCompanies, setBulkBlockedCompanies] = useState("");
  const [search, setSearch] = useState("");
  const [loadingBlocked, setLoadingBlocked] = useState(true);
  const [savingBlocked, setSavingBlocked] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [result, setResult] = useState<ScrapeResponse | null>(null);

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
      if (!res.ok) throw new Error(data.error || "Failed to load blocked companies.");
      setBlockedCompanies(data.blockedCompanies ?? []);
      setCandidates(data.candidates ?? []);
      setResumeDbCompanyCount(Number(data.resumeDbCompanyCount ?? 0));
      if (!filter && Array.isArray(data.candidates) && data.candidates.length === 1) {
        setCandidateFilter((data.candidates[0] as CandidateOption).key);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load blocked companies.",
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
            removedBlocked: current.stats.removedBlocked + (current.jobs.length - nextJobs.length),
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
    const links = (result?.jobs ?? [])
      .map((job) => job.apply_url?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n");
    if (!links) {
      toast.error("No links to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(links);
      toast.success("Job links copied.");
    } catch {
      toast.error("Copy failed.");
    }
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

  return (
    <JobsLayout>
      <div className="flex h-full min-h-0 w-full flex-col gap-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Job Scraper</h1>
          <p className="text-sm text-muted-foreground">
            Scrape hiring.cafe with a date-only filter, exclude blocked companies, and review CSV-ready results.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Scrape jobs</CardTitle>
            <CardDescription>
              Other hiring.cafe filters stay fixed. Only the date window is configurable here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {DATE_WINDOW_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={dateWindow === option.value ? "default" : "outline"}
                  onClick={() => setDateWindow(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,280px)_1fr] sm:items-end">
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  Candidate (for Resume DB company filter)
                </span>
                <select
                  value={candidateFilter}
                  onChange={(e) => setCandidateFilter(e.target.value)}
                  className="border-input bg-card dark:bg-input/30 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="">Select candidate…</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground sm:pb-2">
                Resume DB exclusion uses only companies registered for this candidate under your account.
              </p>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={excludeBlocked}
                  onCheckedChange={(checked) => setExcludeBlocked(Boolean(checked))}
                />
                Exclude blocked companies
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={excludeResumeDb}
                  onCheckedChange={(checked) => setExcludeResumeDb(Boolean(checked))}
                  disabled={!candidateFilter}
                />
                Exclude this candidate&apos;s Resume DB companies ({resumeDbCompanyCount})
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={runScrape} disabled={scraping}>
                {scraping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Scrape jobs
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => loadBlockedCompanies(candidateFilter)}
                disabled={loadingBlocked}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh company lists
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.4fr_0.8fr]">
          <Card className="min-h-0">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Scrape results</CardTitle>
                  <CardDescription>
                    Review jobs before exporting or sending links to the extension launcher.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => result?.csv && downloadCsv(result.csv)}
                    disabled={!result?.csv}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download CSV
                  </Button>
                  <Button type="button" variant="outline" onClick={copyLinks} disabled={!result?.jobs?.length}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy links
                  </Button>
                </div>
              </div>

              {result?.stats ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Scraped {result.stats.scraped}</Badge>
                  <Badge variant="secondary">Deduped {result.stats.deduped}</Badge>
                  <Badge variant="secondary">Blocked removed {result.stats.removedBlocked}</Badge>
                  <Badge variant="secondary">Resume DB removed {result.stats.removedResumeDb}</Badge>
                  <Badge>Remaining {result.stats.remaining}</Badge>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search company, title, site..."
                  className="max-w-sm"
                />
                {result?.stats ? (
                  <span className="text-xs text-muted-foreground">
                    Pages fetched: {result.stats.pagesFetched}
                    {result.stats.reportedTotal != null
                      ? ` • hiring.cafe total: ${result.stats.reportedTotal}`
                      : ""}
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="min-h-0">
              <div className="max-h-[560px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>ATS</TableHead>
                      <TableHead>Published</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJobs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          {scraping ? "Scraping jobs..." : "No jobs loaded yet."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredJobs.map((job, index) => (
                        <TableRow key={`${job.apply_url ?? job.company_name ?? "job"}-${index}`}>
                          <TableCell className="max-w-[180px] whitespace-normal">
                            <div className="font-medium">{job.company_name || "—"}</div>
                            {job.company_tagline ? (
                              <div className="mt-1 text-xs text-muted-foreground">
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
                          <TableCell>{job.estimated_publish_date || "—"}</TableCell>
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
            </CardContent>
          </Card>

          <div className="flex min-h-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Blocked companies</CardTitle>
                <CardDescription>
                  Add companies you never want to see in Job Scraper results, even if they are not in Resume DB.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
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
                    placeholder={"Bulk add, one company per line"}
                    rows={5}
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
              </CardContent>
            </Card>

            <Card className="min-h-0">
              <CardHeader>
                <CardTitle>Current list</CardTitle>
                <CardDescription>
                  Stored separately from Resume DB applications.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-h-0">
                <div className="max-h-[320px] overflow-auto space-y-2">
                  {loadingBlocked ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading blocked companies...
                    </div>
                  ) : blockedCompanies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No blocked companies yet.</p>
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
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </JobsLayout>
  );
}
