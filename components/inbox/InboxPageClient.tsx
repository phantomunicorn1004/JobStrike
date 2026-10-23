"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  HelpCircle,
  Inbox as InboxIcon,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Unlink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  APPLICATION_CATEGORIES,
  MAIL_CATEGORIES,
  MAIL_CATEGORY_LABELS,
  type InboxApplication,
  type InboxItem,
  type InboxResponse,
  type InboxView,
  type MailCategory,
  type ActivityEntry,
} from "@/lib/mail/categories";
import { cn } from "@/lib/utils";

const VIEWS: { id: InboxView; label: string; hint: string }[] = [
  { id: "inbox", label: "Inbox", hint: "Interviews, assessments, offers, rejections, updates and recruiters" },
  { id: "suggested", label: "Suggestions", hint: "Board moves waiting for your OK" },
  { id: "review", label: "Needs review", hint: "Emails JobStrike could not link to an application with confidence" },
  { id: "interviews", label: "Interviews", hint: "Interviews and assessments" },
  { id: "rejections", label: "Rejections", hint: "Applications that will not move forward" },
  { id: "applied", label: "Applied", hint: "Application confirmations" },
  { id: "unmatched", label: "Not in Resume DB", hint: "Confirmations for applications Resume DB does not have" },
  { id: "all", label: "All", hint: "Everything kept, including emails marked not job-related" },
];

const CATEGORY_STYLE: Record<MailCategory | "unclassified", string> = {
  interview: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  assessment: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  offer: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejection: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  update: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  confirmation: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  outreach: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  other: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  not_job: "border-transparent bg-muted text-muted-foreground",
  unclassified: "border-transparent bg-muted text-muted-foreground",
};

/** Below this, a match is shown as "check this" (same threshold as the server's review tab). */
const SURE_MATCH = 0.6;

function whenText(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whether an item still belongs in a tab after a change (mirrors the server's filters). */
function fitsView(item: InboxItem, view: InboxView): boolean {
  const c = item.category;
  switch (view) {
    case "inbox":
      return ["interview", "assessment", "offer", "rejection", "update", "outreach", "other"].includes(c);
    case "review":
      return (
        ["interview", "assessment", "offer", "rejection", "update", "other"].includes(c) &&
        item.linkSource === "auto" &&
        (!item.application || (item.matchScore ?? 0) < SURE_MATCH)
      );
    case "interviews":
      return c === "interview" || c === "assessment";
    case "rejections":
      return c === "rejection";
    case "applied":
      return c === "confirmation";
    case "unmatched":
      return c === "confirmation" && !item.application;
    case "suggested":
      return item.actionStatus === "suggested";
    default:
      return true;
  }
}

function headline(item: InboxItem): { company: string; title: string } {
  return {
    company: item.application?.company || item.company || item.fromName || item.fromEmail,
    title: item.application?.jobTitle || item.jobTitle || "",
  };
}

export function InboxPageClient() {
  const [view, setView] = useState<InboxView>("inbox");
  const [profileId, setProfileId] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<InboxResponse | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const [linkFor, setLinkFor] = useState<InboxItem | null>(null);
  const [addFor, setAddFor] = useState<InboxItem | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [confirmApplyAll, setConfirmApplyAll] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const mounted = useRef(true);
  const requestId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Search waits until typing pauses.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const query = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ view });
      if (profileId !== "all") params.set("profileId", profileId);
      if (search) params.set("q", search);
      if (before) params.set("before", before);
      return `/api/inbox?${params}`;
    },
    [view, profileId, search],
  );

  const load = useCallback(
    async (quiet = false) => {
      const id = ++requestId.current;
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(query(), { credentials: "same-origin" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Could not load the inbox.");
        // A newer request (another tab or filter) wins.
        if (id !== requestId.current || !mounted.current) return;
        setData(body as InboxResponse);
        setItems((body as InboxResponse).items);
        setError(null);
        if (!quiet) {
          setFocused(0);
          setExpanded(null);
        }
      } catch (e) {
        if (id === requestId.current) setError(e instanceof Error ? e.message : "Could not load the inbox.");
      } finally {
        if (id === requestId.current && mounted.current) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await fetch(query(last.receivedAt), { credentials: "same-origin" });
      const body = (await res.json()) as InboxResponse;
      if (!res.ok) throw new Error("Could not load more.");
      setItems((prev) => [...prev, ...body.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setData((prev) => (prev ? { ...prev, hasMore: body.hasMore } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  // Sort the backlog while the page is open: each call sorts for up to ~45 s, then the list
  // refreshes and the next round starts. A round that sorted nothing waits 30 s first.
  const pending = data?.pending ?? 0;
  const sortingRef = useRef(false);
  const [sortTick, setSortTick] = useState(0);
  useEffect(() => {
    if (pending === 0 || sortingRef.current) return;
    sortingRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/inbox/process", { method: "POST", credentials: "same-origin" });
        const body = await res.json().catch(() => ({}));
        if (body.aiUnavailable) toast.error("AI sorting is not set up on the server (OPENAI_API_KEY).");
        if (!res.ok || body.aiUnavailable || (body.sorted ?? 0) === 0) {
          await new Promise((r) => window.setTimeout(r, 30_000));
        }
      } finally {
        sortingRef.current = false;
        if (mounted.current) {
          await load(true);
          setSortTick((t) => t + 1);
        }
      }
    })();
  }, [pending, sortTick, load]);

  const replaceItem = useCallback(
    (updated: InboxItem) => {
      setItems((prev) =>
        prev.flatMap((i) => (i.id !== updated.id ? [i] : fitsView(updated, view) ? [updated] : [])),
      );
      void load(true);
    },
    [view, load],
  );

  const stageName = useCallback(
    (id: string | null) => (id === null ? "Registered" : data?.stages.find((st) => st.id === id)?.name ?? id),
    [data],
  );

  const act = useCallback(
    async (item: InboxItem, what: "apply" | "dismiss" | "undo") => {
      try {
        const res = await fetch(`/api/inbox/${item.id}/action`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ do: what }),
        });
        const body = await res.json();
        if (body.item) replaceItem(body.item as InboxItem);
        if (!res.ok) throw new Error(body.message || body.error || "Could not update the board.");
        if (what === "apply") toast.success(`Moved to ${stageName(item.action?.toStage ?? null)}.`);
        if (what === "undo") toast.success("Move undone.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update the board.");
      }
    },
    [replaceItem, stageName],
  );

  const applyAll = async () => {
    setConfirmApplyAll(false);
    setApplyingAll(true);
    const progress = toast.loading("Updating the board…");
    let applied = 0;
    try {
      // Each call works for up to ~45 s; repeat while suggestions remain and progress is made.
      for (let round = 0; round < 20; round++) {
        const res = await fetch("/api/inbox/actions", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ do: "apply-all" }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Could not apply the suggestions.");
        applied += body.applied ?? 0;
        toast.loading(`Updating the board… ${applied} moved`, { id: progress });
        if (body.remaining === 0 || (body.applied ?? 0) + (body.skipped ?? 0) === 0) break;
      }
      toast.success(`${applied} ${applied === 1 ? "card" : "cards"} moved. Undo any of them under Activity.`, { id: progress });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the suggestions.", { id: progress });
    } finally {
      setApplyingAll(false);
      void load(true);
    }
  };

  const patch = useCallback(
    async (item: InboxItem, body: Record<string, unknown>, done?: string) => {
      try {
        const res = await fetch(`/api/inbox/${item.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Could not save.");
        replaceItem(result.item as InboxItem);
        if (done) {
          const extra = result.alsoIgnored > 0 ? ` (${result.alsoIgnored} more from this sender)` : "";
          toast.success(done + extra, {
            action:
              body.category !== undefined
                ? { label: "Undo", onClick: () => void patch(result.item, { category: item.category }) }
                : undefined,
          });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save.");
      }
    },
    [replaceItem],
  );

  // Keyboard: J/K move, Enter opens details, O opens the email, X marks not job-related.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]"))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const item = items[focused];
      if (event.key === "j") setFocused((f) => Math.min(items.length - 1, f + 1));
      else if (event.key === "k") setFocused((f) => Math.max(0, f - 1));
      else if (event.key === "Enter" && item) setExpanded((e) => (e === item.id ? null : item.id));
      else if (event.key === "o" && item?.webLink) window.open(item.webLink, "_blank", "noopener");
      else if (event.key === "x" && item) void patch(item, { category: "not_job" }, "Marked not job-related");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, focused, patch]);

  useEffect(() => {
    document.querySelector(`[data-inbox-index="${focused}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  const counts = data?.counts;
  const currentView = VIEWS.find((v) => v.id === view)!;

  if (error && !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader />
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <AlertTriangle className="mx-auto mb-2 h-5 w-5" />
          {error}
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (data && !data.hasMailbox) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader />
        <div className="rounded-xl border bg-card p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">Connect a mailbox</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            JobStrike reads each candidate&apos;s mailbox, finds recruiter emails and links them to applications.
          </p>
          <Button asChild className="mt-4">
            <Link href="/settings">Open Settings</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {data && data.profiles.length > 1 ? (
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Candidate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All candidates</SelectItem>
                {data.profiles.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search sender, subject…"
              className="h-9 pl-8"
              aria-label="Search emails"
            />
          </div>
        </div>
      </div>

      {pending > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Sorting <strong>{pending.toLocaleString()}</strong> {pending === 1 ? "email" : "emails"} with AI. They appear
            here as they are sorted; you can leave this page.
          </span>
          <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-primary" />
        </div>
      ) : null}

      {data && data.suggestions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          <ArrowRight className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>{data.counts.suggested.toLocaleString()}</strong> suggested board{" "}
            {data.counts.suggested === 1 ? "update" : "updates"}:{" "}
            {data.suggestions.map((sg, i) => (
              <span key={sg.toStage}>
                {i > 0 ? ", " : ""}
                {sg.count} → {stageName(sg.toStage)}
              </span>
            ))}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setActivityOpen(false);
                setView("suggested");
              }}
            >
              Review
            </Button>
            <Button size="sm" disabled={applyingAll} onClick={() => setConfirmApplyAll(true)}>
              {applyingAll ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Apply all
            </Button>
          </div>
        </div>
      ) : null}

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Inbox views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={!activityOpen && view === v.id}
            title={v.hint}
            onClick={() => {
              setActivityOpen(false);
              setView(v.id);
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              !activityOpen && view === v.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {v.label}
            {counts ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  !activityOpen && view === v.id ? "bg-primary-foreground/20" : "bg-muted",
                  (v.id === "review" || v.id === "suggested") &&
                    counts[v.id] > 0 &&
                    (activityOpen || view !== v.id) &&
                    "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                )}
              >
                {counts[v.id].toLocaleString()}
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={activityOpen}
          title="Board moves made from emails and by hand, with Undo"
          onClick={() => setActivityOpen(true)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
            activityOpen
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Activity
        </button>
      </div>

      {activityOpen ? (
        <ActivityPanel stageName={stageName} onChanged={() => void load(true)} />
      ) : (
      <>
      <div className="overflow-hidden rounded-xl border bg-card">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <InboxIcon className="mx-auto mb-2 h-6 w-6" />
            {search
              ? "No emails match your search."
              : view === "review" || view === "suggested"
                ? "All caught up — nothing to review."
                : `Nothing in ${currentView.label} yet.`}
          </div>
        ) : (
          <ul className={cn("divide-y", loading && "opacity-60")}>
            {items.map((item, index) => (
              <InboxRow
                key={item.id}
                item={item}
                index={index}
                focused={index === focused}
                expanded={expanded === item.id}
                onFocus={() => setFocused(index)}
                onToggle={() => setExpanded((e) => (e === item.id ? null : item.id))}
                onPatch={patch}
                onLink={() => setLinkFor(item)}
                onAdd={() => setAddFor(item)}
                onAct={act}
                stageName={stageName}
              />
            ))}
          </ul>
        )}
      </div>

      {data?.hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ChevronDown className="mr-2 h-4 w-4" />}
            Load more
          </Button>
        </div>
      ) : null}
      </>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Keys: <kbd className="rounded border px-1">J</kbd>/<kbd className="rounded border px-1">K</kbd> move ·{" "}
        <kbd className="rounded border px-1">Enter</kbd> details · <kbd className="rounded border px-1">O</kbd> open email ·{" "}
        <kbd className="rounded border px-1">X</kbd> not job-related
      </p>

      <LinkDialog
        item={linkFor}
        onClose={() => setLinkFor(null)}
        onPick={(app) => {
          const item = linkFor;
          setLinkFor(null);
          if (item) void patch(item, { applicationId: app.id }, `Linked to ${app.company}`);
        }}
      />
      <Dialog open={confirmApplyAll} onOpenChange={setConfirmApplyAll}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply all suggestions?</DialogTitle>
            <DialogDescription>
              {data?.counts.suggested.toLocaleString()} cards move on the board, each dated by its email. Cards that are
              already further along are skipped. Every move can be undone under Activity.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApplyAll(false)}>
              Cancel
            </Button>
            <Button onClick={() => void applyAll()}>Apply all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddDialog
        item={addFor}
        onClose={() => setAddFor(null)}
        onAdded={(updated) => {
          setAddFor(null);
          replaceItem(updated);
          toast.success("Added to Resume DB.");
        }}
      />
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
      <p className="text-sm text-muted-foreground">Job emails from connected mailboxes, linked to your applications.</p>
    </div>
  );
}

function MatchChip({ item, onLink, onAdd }: { item: InboxItem; onLink: () => void; onAdd: () => void }) {
  const needsApplication = item.category !== "unclassified" && APPLICATION_CATEGORIES.includes(item.category);
  if (item.application) {
    const sure = (item.matchScore ?? 0) >= SURE_MATCH || item.linkSource === "user";
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5",
          sure ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        )}
        title={item.matchReason ?? undefined}
      >
        {sure ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <HelpCircle className="h-3 w-3 shrink-0" />}
        <span className="truncate">
          {sure ? "" : "Check: "}
          {item.application.company}
          {item.application.jobTitle ? ` · ${item.application.jobTitle}` : ""}
          {item.application.candidateName ? ` · ${item.application.candidateName}` : ""}
        </span>
      </span>
    );
  }
  if (!needsApplication) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">No matching application</span>
      <button type="button" className="rounded px-1 text-primary hover:underline" onClick={(e) => (e.stopPropagation(), onLink())}>
        Link…
      </button>
      {item.category === "confirmation" ? (
        <button type="button" className="rounded px-1 text-primary hover:underline" onClick={(e) => (e.stopPropagation(), onAdd())}>
          Add to Resume DB
        </button>
      ) : null}
    </span>
  );
}

function InboxRow(props: {
  item: InboxItem;
  index: number;
  focused: boolean;
  expanded: boolean;
  onFocus: () => void;
  onToggle: () => void;
  onPatch: (item: InboxItem, body: Record<string, unknown>, done?: string) => Promise<void>;
  onLink: () => void;
  onAdd: () => void;
  onAct: (item: InboxItem, what: "apply" | "dismiss" | "undo") => Promise<void>;
  stageName: (id: string | null) => string;
}) {
  const { item, focused, expanded } = props;
  const { company, title } = headline(item);
  const category = item.category;

  return (
    <li
      data-inbox-index={props.index}
      className={cn("group relative transition-colors", focused ? "bg-muted/50" : "hover:bg-muted/30")}
      onMouseEnter={props.onFocus}
    >
      {focused ? <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden /> : null}
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={props.onToggle}
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("shrink-0", CATEGORY_STYLE[category])}>
              {MAIL_CATEGORY_LABELS[category]}
            </Badge>
            <span className="truncate font-medium">
              {company}
              {title ? <span className="font-normal text-muted-foreground"> · {title}</span> : null}
            </span>
            <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground" title={new Date(item.receivedAt).toLocaleString()}>
              {whenText(item.receivedAt)}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{item.summary || item.subject}</p>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          {item.webLink ? (
            <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Open the email">
              <a href={item.webLink} target="_blank" rel="noopener noreferrer" aria-label="Open the email">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Change type</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={category}
                    onValueChange={(v) => void props.onPatch(item, { category: v }, `Changed to ${MAIL_CATEGORY_LABELS[v as MailCategory]}`)}
                  >
                    {MAIL_CATEGORIES.map((c) => (
                      <DropdownMenuRadioItem key={c} value={c}>
                        {MAIL_CATEGORY_LABELS[c]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={props.onLink}>
                <Link2 className="mr-2 h-4 w-4" />
                {item.application ? "Link to another application…" : "Link to an application…"}
              </DropdownMenuItem>
              {item.application ? (
                <DropdownMenuItem onSelect={() => void props.onPatch(item, { applicationId: null }, "Unlinked")}>
                  <Unlink className="mr-2 h-4 w-4" />
                  Unlink
                </DropdownMenuItem>
              ) : category === "confirmation" ? (
                <DropdownMenuItem onSelect={props.onAdd}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Resume DB…
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void props.onPatch(item, { category: "not_job" }, "Marked not job-related")}>
                <Ban className="mr-2 h-4 w-4" />
                Not job-related
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void props.onPatch(item, { category: "not_job", ignoreSender: true }, `Ignoring ${item.fromEmail}`)
                }
              >
                <Ban className="mr-2 h-4 w-4" />
                Not job-related, ignore sender
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-3 text-xs text-muted-foreground">
        <span className="truncate">{item.fromName || item.fromEmail}</span>
        <MatchChip item={item} onLink={props.onLink} onAdd={props.onAdd} />
      </div>

      <ActionLine item={item} onAct={props.onAct} stageName={props.stageName} />

      {expanded ? (
        <div className="mx-4 mb-3 space-y-2 rounded-lg border bg-background p-3 text-sm">
          <p className="font-medium">{item.subject || "(no subject)"}</p>
          <p className="text-xs text-muted-foreground">
            {item.fromName ? `${item.fromName} · ` : ""}
            {item.fromEmail} · {new Date(item.receivedAt).toLocaleString()} · to {item.accountEmail}
          </p>
          {item.snippet ? <p className="whitespace-pre-line text-muted-foreground">{item.snippet}</p> : null}
          {item.matchReason ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Why linked: </span>
              {item.matchReason}
              {item.matchScore !== null && item.linkSource === "auto" ? ` (${Math.round(item.matchScore * 100)}%)` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {item.webLink ? (
              <Button asChild size="sm" variant="outline">
                <a href={item.webLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open email
                </a>
              </Button>
            ) : null}
            {item.application ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/resume-db?q=${encodeURIComponent(item.application.company)}`}>Show in Resume DB</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function LinkDialog({
  item,
  onClose,
  onPick,
}: {
  item: InboxItem | null;
  onClose: () => void;
  onPick: (app: InboxApplication) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<InboxApplication[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) setQ(item.company || item.application?.company || "");
  }, [item]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        const params = new URLSearchParams({ q });
        if (item.profileId !== null) params.set("profileId", String(item.profileId));
        const res = await fetch(`/api/inbox/applications?${params}`, { credentials: "same-origin" });
        const body = await res.json();
        if (!cancelled) setResults(res.ok ? body.applications : []);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, item]);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to an application</DialogTitle>
          <DialogDescription className="line-clamp-2">{item?.subject}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company or job title" className="pl-8" autoFocus />
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {busy && results.length === 0 ? (
            <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </li>
          ) : results.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">No applications found.</li>
          ) : (
            results.map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => onPick(app)}
                >
                  <span className="font-medium">{app.company}</span>
                  {app.jobTitle ? <span className="text-muted-foreground"> · {app.jobTitle}</span> : null}
                  <span className="block text-xs text-muted-foreground">
                    {app.candidateName ? `${app.candidateName} · ` : ""}applied {new Date(app.appliedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function AddDialog({
  item,
  onClose,
  onAdded,
}: {
  item: InboxItem | null;
  onClose: () => void;
  onAdded: (item: InboxItem) => void;
}) {
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) {
      setCompany(item.company ?? "");
      setJobTitle(item.jobTitle ?? "");
    }
  }, [item]);

  const add = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inbox/${item.id}/application`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, jobTitle }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not add.");
      onAdded(body.item as InboxItem);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add.");
    } finally {
      setBusy(false);
    }
  };

  const applied = useMemo(() => (item ? new Date(item.receivedAt).toLocaleDateString() : ""), [item]);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Resume DB</DialogTitle>
          <DialogDescription>
            Registers this application as applied on {applied}, linked to this email.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="add-company">Company</Label>
            <Input id="add-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-title">Job title</Label>
            <Input id="add-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void add()} disabled={busy || !company.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The board move an email suggests (Apply / Dismiss) or made (Undo). */
function ActionLine({
  item,
  onAct,
  stageName,
}: {
  item: InboxItem;
  onAct: (item: InboxItem, what: "apply" | "dismiss" | "undo") => Promise<void>;
  stageName: (id: string | null) => string;
}) {
  const [busy, setBusy] = useState(false);
  const action = item.action;
  if (!action || (item.actionStatus !== "suggested" && item.actionStatus !== "applied")) return null;
  const run = async (what: "apply" | "dismiss" | "undo") => {
    setBusy(true);
    try {
      await onAct(item, what);
    } finally {
      setBusy(false);
    }
  };

  if (item.actionStatus === "suggested") {
    return (
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300" title={action.reason}>
          <ArrowRight className="h-3 w-3" />
          Suggested: {stageName(action.fromStage)} → <strong>{stageName(action.toStage)}</strong>
        </span>
        <Button size="sm" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => void run("apply")}>
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Apply
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void run("dismiss")}>
          Dismiss
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1" title={action.reason}>
        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        Moved {stageName(action.fromStage)} → {stageName(action.toStage)}
      </span>
      {action.eventId ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void run("undo")}>
          <RotateCcw className="mr-1 h-3 w-3" />
          Undo
        </Button>
      ) : null}
    </div>
  );
}

/** Board moves, newest first, with Undo. */
function ActivityPanel({ stageName, onChanged }: { stageName: (id: string | null) => string; onChanged: () => void }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchPage = useCallback(async (before?: string) => {
    const res = await fetch(`/api/inbox/activity${before ? `?before=${encodeURIComponent(before)}` : ""}`, {
      credentials: "same-origin",
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Could not load the activity.");
    return body as { entries: ActivityEntry[]; hasMore: boolean };
  }, []);

  useEffect(() => {
    fetchPage()
      .then((page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore);
      })
      .catch((e) => {
        setEntries([]);
        toast.error(e instanceof Error ? e.message : "Could not load the activity.");
      });
  }, [fetchPage]);

  const undo = async (entry: ActivityEntry) => {
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/inbox/activity/${entry.id}`, { method: "POST", credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || body.error || "Could not undo.");
      setEntries((prev) => prev?.map((e) => (e.id === entry.id ? { ...e, undone: true } : e)) ?? prev);
      toast.success("Move undone.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not undo.");
    } finally {
      setBusyId(null);
    }
  };

  if (entries === null) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
        No board moves yet. Moves made from emails (and by hand in Resume DB) appear here.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {entries.map((entry) => (
          <li key={entry.id} className={cn("flex items-start gap-3 px-4 py-3", entry.undone && "opacity-60")}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-medium">{entry.application?.company || "Application"}</span>
                {entry.application?.jobTitle ? (
                  <span className="text-muted-foreground">· {entry.application.jobTitle}</span>
                ) : null}
                {entry.application?.candidateName ? (
                  <span className="text-muted-foreground">· {entry.application.candidateName}</span>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm">
                <span className={cn(entry.undone && "line-through")}>
                  {stageName(entry.fromStage)} → <strong>{stageName(entry.toStage)}</strong>
                </span>
                {entry.undone ? <span className="ml-2 text-xs text-muted-foreground">Undone</span> : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.source === "email" ? entry.reason || "From an email" : "Moved by hand"} ·{" "}
                {new Date(entry.at).toLocaleString()}
              </p>
            </div>
            {!entry.undone ? (
              <Button size="sm" variant="ghost" disabled={busyId === entry.id} onClick={() => void undo(entry)}>
                {busyId === entry.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                Undo
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() =>
              void fetchPage(entries[entries.length - 1]?.at).then((page) => {
                setEntries((prev) => [...(prev ?? []), ...page.entries]);
                setHasMore(page.hasMore);
              })
            }
          >
            <ChevronDown className="mr-2 h-4 w-4" />
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
