"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileQuestion,
  HelpCircle,
  History,
  Inbox as InboxIcon,
  Layers,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Unlink,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  APPLICATION_CATEGORIES,
  MAIL_CATEGORIES,
  MAIL_CATEGORY_LABELS,
  type ActivityEntry,
  type InboxApplication,
  type InboxItem,
  type InboxResponse,
  type InboxView,
  type MailCategory,
} from "@/lib/mail/categories";
import { cn } from "@/lib/utils";

type Folder = InboxView | "activity";

const FOLDERS: { id: Folder; label: string; icon: LucideIcon; hint: string; attention?: boolean }[] = [
  { id: "inbox", label: "Inbox", icon: InboxIcon, hint: "Interviews, assessments, offers, rejections, updates and recruiters" },
  { id: "suggested", label: "Suggestions", icon: Sparkles, hint: "Board moves waiting for your OK", attention: true },
  { id: "review", label: "Needs review", icon: FileQuestion, hint: "Not linked to an application with confidence", attention: true },
  { id: "interviews", label: "Interviews", icon: Briefcase, hint: "Interviews and assessments" },
  { id: "rejections", label: "Rejections", icon: XCircle, hint: "Applications that will not move forward" },
  { id: "applied", label: "Applied", icon: FileCheck2, hint: "Application confirmations" },
  { id: "unmatched", label: "Not in Resume DB", icon: ClipboardCheck, hint: "Confirmations for applications Resume DB does not have" },
  { id: "all", label: "All mail", icon: Layers, hint: "Everything kept, including not job-related" },
];

/** Category accents: a dot in the list, a soft label in the reading pane. */
const CATEGORY_DOT: Record<MailCategory | "unclassified", string> = {
  interview: "bg-violet-500",
  assessment: "bg-indigo-500",
  offer: "bg-emerald-500",
  rejection: "bg-rose-500",
  update: "bg-sky-500",
  confirmation: "bg-slate-400",
  outreach: "bg-amber-500",
  other: "bg-zinc-400",
  not_job: "bg-zinc-300 dark:bg-zinc-600",
  unclassified: "bg-zinc-300 dark:bg-zinc-600",
};
const CATEGORY_LABEL_STYLE: Record<MailCategory | "unclassified", string> = {
  interview: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  assessment: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  offer: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejection: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  update: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  confirmation: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  outreach: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  other: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  not_job: "bg-muted text-muted-foreground",
  unclassified: "bg-muted text-muted-foreground",
};

/** Below this, a match is shown as "check this" (same threshold as the server's review tab). */
const SURE_MATCH = 0.6;

const AVATAR_COLORS = ["bg-sky-600", "bg-violet-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-indigo-600", "bg-teal-600"];

function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

function listTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - date.getTime() < 6 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whether an item still belongs in a folder after a change (mirrors the server's filters). */
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

function senderName(item: InboxItem): string {
  return item.fromName || item.fromEmail.split("@")[0];
}

function headline(item: InboxItem): { company: string; title: string } {
  return {
    company: item.application?.company || item.company || senderName(item),
    title: item.application?.jobTitle || item.jobTitle || "",
  };
}

export function InboxPageClient() {
  const [folder, setFolder] = useState<Folder>("inbox");
  const view: InboxView = folder === "activity" ? "inbox" : folder;
  const [profileId, setProfileId] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<InboxResponse | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<InboxItem | null>(null);
  const [addFor, setAddFor] = useState<InboxItem | null>(null);
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
        // A newer request (another folder or filter) wins.
        if (id !== requestId.current || !mounted.current) return;
        setData(body as InboxResponse);
        setItems((body as InboxResponse).items);
        setError(null);
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
      setItems((prev) => prev.flatMap((i) => (i.id !== updated.id ? [i] : fitsView(updated, view) ? [updated] : [])));
      void load(true);
    },
    [view, load],
  );

  const stageName = useCallback(
    (id: string | null) => (id === null ? "Registered" : data?.stages.find((st) => st.id === id)?.name ?? id),
    [data],
  );

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

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const selectedIndex = selected ? items.indexOf(selected) : -1;

  // Keyboard: J/K next and previous, O opens in the mailbox, X not job-related, Esc closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        const next = items[Math.min(items.length - 1, selectedIndex + 1)];
        if (next) setSelectedId(next.id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        const prev = items[Math.max(0, selectedIndex - 1)];
        if (prev) setSelectedId(prev.id);
      } else if (event.key === "o" && selected?.webLink) window.open(selected.webLink, "_blank", "noopener");
      else if (event.key === "x" && selected) void patch(selected, { category: "not_job" }, "Marked not job-related");
      else if (event.key === "Escape") setSelectedId(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, selectedIndex, patch]);

  useEffect(() => {
    if (selectedId) document.querySelector(`[data-mail-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const counts = data?.counts;
  const pickFolder = (f: Folder) => {
    setFolder(f);
    setSelectedId(null);
  };

  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-sm text-muted-foreground">
        <AlertTriangle className="mx-auto mb-2 h-5 w-5" />
        {error}
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (data && !data.hasMailbox) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Mail className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">Connect a mailbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          JobStrike reads each candidate&apos;s mailbox, finds recruiter emails and links them to applications.
        </p>
        <Button asChild className="mt-5">
          <Link href="/settings">Open Settings</Link>
        </Button>
      </div>
    );
  }

  const suggestionsBar =
    data && data.suggestions.length > 0 && (folder === "inbox" || folder === "suggested") ? (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b bg-amber-500/[0.06] px-4 py-2.5 text-xs">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1">
          <strong>{data.counts.suggested.toLocaleString()}</strong> board {data.counts.suggested === 1 ? "update" : "updates"} waiting:{" "}
          {data.suggestions.map((sg, i) => (
            <span key={sg.toStage} className="text-muted-foreground">
              {i > 0 ? ", " : ""}
              {sg.count} → {stageName(sg.toStage)}
            </span>
          ))}
        </span>
        <div className="flex gap-1.5">
          {folder !== "suggested" ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => pickFolder("suggested")}>
              Review
            </Button>
          ) : null}
          <Button size="sm" className="h-7 px-2.5 text-xs" disabled={applyingAll} onClick={() => setConfirmApplyAll(true)}>
            {applyingAll ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Apply all
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <div className="-m-3 flex h-[calc(100dvh-3rem)] min-h-0 sm:-m-4 md:h-dvh">
      {/* Folders */}
      <nav className="hidden w-56 shrink-0 flex-col border-r bg-muted/30 lg:flex" aria-label="Mail folders">
        <div className="space-y-3 px-3 pb-2 pt-4">
          <h1 className="px-2 text-lg font-semibold tracking-tight">Inbox</h1>
          {data && data.profiles.length > 1 ? (
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger className="h-8 w-full bg-background text-xs" aria-label="Candidate">
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
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
          {FOLDERS.map((f) => (
            <FolderButton
              key={f.id}
              icon={f.icon}
              label={f.label}
              hint={f.hint}
              count={counts?.[f.id as InboxView]}
              attention={f.attention}
              active={folder === f.id}
              onClick={() => pickFolder(f.id)}
            />
          ))}
          <div className="mx-2 my-2 border-t" />
          <FolderButton icon={History} label="Activity" hint="Board moves, with Undo" active={folder === "activity"} onClick={() => pickFolder("activity")} />
        </div>
        {pending > 0 ? (
          <div className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Sorting {pending.toLocaleString()} new {pending === 1 ? "email" : "emails"}…
          </div>
        ) : null}
      </nav>

      {folder === "activity" ? (
        <div className="min-w-0 flex-1 overflow-y-auto">
          <MobileFolderBar folder={folder} counts={counts} onPick={pickFolder} />
          <div className="mx-auto max-w-3xl p-4 sm:p-6">
            <h2 className="mb-1 text-xl font-semibold tracking-tight">Activity</h2>
            <p className="mb-4 text-sm text-muted-foreground">Board moves made from emails and by hand. Undo any of them.</p>
            <ActivityPanel stageName={stageName} onChanged={() => void load(true)} />
          </div>
        </div>
      ) : (
        <>
          {/* Message list */}
          <section
            className={cn(
              "flex min-h-0 w-full shrink-0 flex-col border-r md:w-[360px] xl:w-[420px]",
              selected && "hidden md:flex",
            )}
            aria-label="Emails"
          >
            <MobileFolderBar folder={folder} counts={counts} onPick={pickFolder} />
            <div className="border-b p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search sender, subject…"
                  className="h-9 border-transparent bg-muted/60 pl-8 shadow-none focus-visible:bg-background"
                  aria-label="Search emails"
                />
              </div>
            </div>
            {suggestionsBar}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && items.length === 0 ? (
                <ListSkeleton />
              ) : items.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                  <InboxIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />
                  {search
                    ? "No emails match your search."
                    : folder === "review" || folder === "suggested"
                      ? "All caught up."
                      : "Nothing here yet."}
                </div>
              ) : (
                <ul className={cn(loading && "opacity-60")}>
                  {items.map((item) => (
                    <MessageRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      stageName={stageName}
                      onSelect={() => setSelectedId(item.id)}
                    />
                  ))}
                  {data?.hasMore ? (
                    <li className="flex justify-center p-3">
                      <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                        {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ChevronDown className="mr-2 h-4 w-4" />}
                        Load more
                      </Button>
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          </section>

          {/* Reading pane */}
          <section className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")} aria-label="Email">
            {selected ? (
              <ReadingPane
                key={selected.id}
                item={selected}
                stageName={stageName}
                onBack={() => setSelectedId(null)}
                onPatch={patch}
                onAct={act}
                onLink={() => setLinkFor(selected)}
                onAdd={() => setAddFor(selected)}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-10 w-10 opacity-30" />
                <p>Select an email to read it</p>
                <p className="text-xs">
                  <kbd className="rounded border px-1">J</kbd> <kbd className="rounded border px-1">K</kbd> move ·{" "}
                  <kbd className="rounded border px-1">O</kbd> open in mailbox · <kbd className="rounded border px-1">X</kbd> not job-related
                </p>
              </div>
            )}
          </section>
        </>
      )}

      <LinkDialog
        item={linkFor}
        onClose={() => setLinkFor(null)}
        onPick={(app) => {
          const item = linkFor;
          setLinkFor(null);
          if (item) void patch(item, { applicationId: app.id }, `Linked to ${app.company}`);
        }}
      />
      <AddDialog
        item={addFor}
        onClose={() => setAddFor(null)}
        onAdded={(updated) => {
          setAddFor(null);
          replaceItem(updated);
          toast.success("Added to Resume DB.");
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
    </div>
  );
}

function FolderButton(props: {
  icon: LucideIcon;
  label: string;
  hint: string;
  count?: number;
  attention?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      title={props.hint}
      onClick={props.onClick}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        props.active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>
      {props.count ? (
        <span
          className={cn(
            "text-xs tabular-nums",
            props.attention ? "rounded-full bg-amber-500/15 px-1.5 font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground",
          )}
        >
          {props.count.toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}

/** Folders as a scrolling strip on screens without the folder pane. */
function MobileFolderBar({
  folder,
  counts,
  onPick,
}: {
  folder: Folder;
  counts: Record<InboxView, number> | undefined;
  onPick: (f: Folder) => void;
}) {
  return (
    <div className="flex w-0 min-w-full gap-1 overflow-x-auto border-b px-3 py-2 lg:hidden">
      {[...FOLDERS, { id: "activity" as Folder, label: "Activity" }].map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onPick(f.id)}
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs transition-colors",
            folder === f.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {f.label}
          {f.id !== "activity" && counts?.[f.id as InboxView] ? ` ${counts[f.id as InboxView].toLocaleString()}` : ""}
        </button>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul>
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="space-y-2 border-b px-4 py-3">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}

function MessageRow({
  item,
  selected,
  stageName,
  onSelect,
}: {
  item: InboxItem;
  selected: boolean;
  stageName: (id: string | null) => string;
  onSelect: () => void;
}) {
  const { company, title } = headline(item);
  const needsLink = item.category !== "unclassified" && APPLICATION_CATEGORIES.includes(item.category) && !item.application;
  return (
    <li data-mail-id={item.id}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "relative block w-full border-b px-4 py-3 text-left transition-colors",
          selected ? "bg-primary/[0.07]" : "hover:bg-muted/50",
        )}
      >
        {selected ? <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden /> : null}
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", CATEGORY_DOT[item.category])} title={MAIL_CATEGORY_LABELS[item.category]} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{senderName(item)}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{listTime(item.receivedAt)}</span>
        </div>
        <p className="mt-0.5 truncate pl-4 text-sm">
          {company}
          {title ? <span className="text-muted-foreground"> · {title}</span> : null}
        </p>
        <p className="mt-0.5 line-clamp-1 pl-4 text-xs text-muted-foreground">{item.summary || item.subject}</p>
        {item.actionStatus === "suggested" && item.action ? (
          <p className="mt-1.5 pl-4">
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <ArrowRight className="h-3 w-3" />
              {stageName(item.action.toStage)}
            </span>
          </p>
        ) : needsLink ? (
          <p className="mt-1.5 pl-4">
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              No application
            </span>
          </p>
        ) : null}
      </button>
    </li>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Plain text with clickable links (the text is never interpreted as HTML). */
function EmailText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part.replace(/[.,;]+$/, "")} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}

function ReadingPane({
  item,
  stageName,
  onBack,
  onPatch,
  onAct,
  onLink,
  onAdd,
}: {
  item: InboxItem;
  stageName: (id: string | null) => string;
  onBack: () => void;
  onPatch: (item: InboxItem, body: Record<string, unknown>, done?: string) => Promise<void>;
  onAct: (item: InboxItem, what: "apply" | "dismiss" | "undo") => Promise<void>;
  onLink: () => void;
  onAdd: () => void;
}) {
  const [body, setBody] = useState<{ text?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBody(null);
    fetch(`/api/inbox/${item.id}/body`, { credentials: "same-origin" })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (!cancelled) setBody(ok ? { text: data.text ?? "" } : { error: data.error || "The email could not be loaded." });
      })
      .catch(() => !cancelled && setBody({ error: "The email could not be loaded." }));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const run = async (what: "apply" | "dismiss" | "undo") => {
    setBusy(true);
    try {
      await onAct(item, what);
    } finally {
      setBusy(false);
    }
  };

  const name = senderName(item);
  const needsApplication = item.category !== "unclassified" && APPLICATION_CATEGORIES.includes(item.category);
  const sure = item.application && ((item.matchScore ?? 0) >= SURE_MATCH || item.linkSource === "user");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5 sm:px-4">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        {item.webLink ? (
          <Button asChild variant="ghost" size="sm">
            <a href={item.webLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Open in mailbox</span>
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onLink}>
          <Link2 className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">{item.application ? "Change link" : "Link"}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Tag className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Type</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={item.category}
              onValueChange={(v) => void onPatch(item, { category: v }, `Changed to ${MAIL_CATEGORY_LABELS[v as MailCategory]}`)}
            >
              {MAIL_CATEGORIES.map((c) => (
                <DropdownMenuRadioItem key={c} value={c}>
                  <span className={cn("mr-2 h-2 w-2 rounded-full", CATEGORY_DOT[c])} />
                  {MAIL_CATEGORY_LABELS[c]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={() => void onPatch(item, { category: "not_job" }, "Marked not job-related")}>
          <Ban className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Not job-related</span>
        </Button>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {item.application ? (
                <DropdownMenuItem onSelect={() => void onPatch(item, { applicationId: null }, "Unlinked")}>
                  <Unlink className="mr-2 h-4 w-4" />
                  Unlink the application
                </DropdownMenuItem>
              ) : item.category === "confirmation" ? (
                <DropdownMenuItem onSelect={onAdd}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Resume DB…
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void onPatch(item, { category: "not_job", ignoreSender: true }, `Ignoring ${item.fromEmail}`)}
              >
                <UserX className="mr-2 h-4 w-4" />
                Not job-related, ignore sender
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
          {/* Header */}
          <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium", CATEGORY_LABEL_STYLE[item.category])}>
            <span className={cn("h-1.5 w-1.5 rounded-full", CATEGORY_DOT[item.category])} />
            {MAIL_CATEGORY_LABELS[item.category]}
          </span>
          <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{item.subject || "(no subject)"}</h2>
          {item.summary ? <p className="mt-1.5 text-sm text-muted-foreground">{item.summary}</p> : null}

          <div className="mt-5 flex items-start gap-3">
            <div
              className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", avatarColor(item.fromEmail))}
              aria-hidden
            >
              {initials(name)}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate">
                <span className="font-medium">{name}</span>{" "}
                <span className="text-muted-foreground">&lt;{item.fromEmail}&gt;</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                To {item.accountEmail} · {new Date(item.receivedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          </div>

          {/* What JobStrike made of it */}
          <div className="mt-6 space-y-2">
            {item.application ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                {sure ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <HelpCircle className="h-4 w-4 shrink-0 text-amber-600" />}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">
                    <span className="font-medium">{item.application.company}</span>
                    {item.application.jobTitle ? <span className="text-muted-foreground"> · {item.application.jobTitle}</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      item.application.candidateName,
                      `applied ${new Date(item.application.appliedAt).toLocaleDateString()}`,
                      sure ? item.matchReason : `Check: ${item.matchReason ?? "unsure match"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                  <Link href={`/resume-db?q=${encodeURIComponent(item.application.company)}`}>Resume DB</Link>
                </Button>
              </div>
            ) : needsApplication ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
                <HelpCircle className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="min-w-0 flex-1 text-sm">No matching application{item.company ? ` for ${item.company}` : ""}.</p>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onLink}>
                  Link…
                </Button>
                {item.category === "confirmation" ? (
                  <Button size="sm" className="h-7 text-xs" onClick={onAdd}>
                    Add to Resume DB
                  </Button>
                ) : null}
              </div>
            ) : null}

            {item.action && item.actionStatus === "suggested" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="min-w-0 flex-1 text-sm">
                  Move the card {stageName(item.action.fromStage)} → <strong>{stageName(item.action.toStage)}</strong>
                  <span className="block text-xs text-muted-foreground">{item.action.reason}</span>
                </p>
                <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void run("apply")}>
                  {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  Apply
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => void run("dismiss")}>
                  Dismiss
                </Button>
              </div>
            ) : item.action && item.actionStatus === "applied" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <p className="min-w-0 flex-1 text-sm">
                  Card moved {stageName(item.action.fromStage)} → <strong>{stageName(item.action.toStage)}</strong>
                  <span className="block text-xs text-muted-foreground">{item.action.reason}</span>
                </p>
                {item.action.eventId ? (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => void run("undo")}>
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Undo
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* The email */}
          <div className="mt-6 border-t pt-6">
            {body === null ? (
              <div className="space-y-2">
                {[90, 75, 85, 60, 70].map((w, i) => (
                  <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : body.error ? (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>{body.error}</p>
                {item.snippet ? <EmailText text={item.snippet} /> : null}
              </div>
            ) : (
              <EmailText text={body.text || item.snippet || "(empty)"} />
            )}
          </div>
        </article>
      </div>
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

  if (entries === null) return <ListSkeleton />;
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No board moves yet. Moves made from emails (and by hand in Resume DB) appear here.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {entries.map((entry) => (
          <li key={entry.id} className={cn("flex items-start gap-3 px-4 py-3", entry.undone && "opacity-60")}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium">{entry.application?.company || "Application"}</span>
                <span className="text-muted-foreground">
                  {[entry.application?.jobTitle, entry.application?.candidateName].filter(Boolean).map((v) => ` · ${v}`).join("")}
                </span>
              </p>
              <p className="mt-0.5 text-sm">
                <span className={cn(entry.undone && "line-through")}>
                  {stageName(entry.fromStage)} → <strong>{stageName(entry.toStage)}</strong>
                </span>
                {entry.undone ? <span className="ml-2 text-xs text-muted-foreground">Undone</span> : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.source === "email" ? entry.reason || "From an email" : entry.reason || "Moved by hand"} ·{" "}
                {new Date(entry.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
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
            variant="ghost"
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
                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onPick(app)}>
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

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Resume DB</DialogTitle>
          <DialogDescription>
            Registers this application as applied on {item ? new Date(item.receivedAt).toLocaleDateString() : ""}, linked to this
            email.
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
