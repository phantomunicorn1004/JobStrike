"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  INTERVIEW_ROUNDS,
  INTERVIEW_ROUND_LABELS,
  OUTCOME_PROMPT_DAYS,
  type InterviewRound,
  type InterviewView,
  type InterviewsResponse,
} from "@/lib/interviews/types";
import type { InboxApplication } from "@/lib/mail/categories";
import { formatIsoInTimeZone, getDayKeyInTimeZone, zonedLocalToUtcIso } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const ROUND_STYLE: Record<InterviewRound, string> = {
  ai_screening: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  screening: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  hr: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  technical: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  final: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  other: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

const DURATIONS = [15, 30, 45, 60, 90, 120];

function fmt(iso: string, tz: string, options: Intl.DateTimeFormatOptions) {
  return formatIsoInTimeZone(iso, tz, options);
}

function timeRange(i: InterviewView, tz: string): string {
  const start = fmt(i.startsAt, tz, { hour: "numeric", minute: "2-digit" });
  const end = i.endsAt ? fmt(i.endsAt, tz, { hour: "numeric", minute: "2-digit" }) : null;
  const zone = fmt(i.startsAt, tz, { timeZoneName: "short" }).split(" ").pop();
  return `${start}${end ? `–${end}` : ""} ${zone ?? ""}`.trim();
}

function minutesOf(i: InterviewView): number | null {
  return i.endsAt ? Math.round((new Date(i.endsAt).getTime() - new Date(i.startsAt).getTime()) / 60000) : null;
}

function countdown(iso: string, now: number): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60000);
  if (minutes <= 0) return minutes > -60 ? "now" : "started";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h ${minutes % 60} min`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/** 24-hour "HH:mm" of an instant in a timezone (for the edit form). */
function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

type CalView = "day" | "week" | "month" | "agenda";
const VIEWS: { id: CalView; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "agenda", label: "Agenda" },
];
const HOUR_PX = 52;

/** Event blocks in the time grid, by round. */
const BLOCK_STYLE: Record<InterviewRound, string> = {
  ai_screening: "border-cyan-500 bg-cyan-500/15 text-cyan-950 dark:text-cyan-100",
  screening: "border-sky-500 bg-sky-500/15 text-sky-950 dark:text-sky-100",
  hr: "border-amber-500 bg-amber-500/15 text-amber-950 dark:text-amber-100",
  technical: "border-violet-500 bg-violet-500/15 text-violet-950 dark:text-violet-100",
  final: "border-emerald-500 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100",
  other: "border-zinc-400 bg-zinc-500/10 text-zinc-900 dark:text-zinc-100",
};
const DOT_STYLE: Record<InterviewRound, string> = {
  ai_screening: "bg-cyan-500",
  screening: "bg-sky-500",
  hr: "bg-amber-500",
  technical: "bg-violet-500",
  final: "bg-emerald-500",
  other: "bg-zinc-400",
};

// Date keys ("2026-10-23") are calendar days in the user's timezone; plain arithmetic on them.
function ymdAdd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function ymdWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function ymdLabel(ymd: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function dateToYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function minutesInTz(iso: string, tz: string): number {
  const [h, m] = hhmm(iso, tz).split(":").map(Number);
  return h * 60 + m;
}
function endOf(i: InterviewView): string {
  return i.endsAt ?? new Date(new Date(i.startsAt).getTime() + 45 * 60_000).toISOString();
}

export function CalendarPageClient() {
  const [data, setData] = useState<InterviewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("all");
  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<InterviewView | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Phones start with the agenda; the week grid needs width.
  useEffect(() => {
    if (window.innerWidth < 768) setView("agenda");
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/interviews", { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load interviews.");
      setData(body as InterviewsResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load interviews.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Countdowns and the "now" line stay current; the list follows new interviews.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const reload = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/interviews/refresh", { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Still checking; the list updates on its own.");
      toast.success("Calendar and interview emails checked.");
    } catch (e) {
      toast.message(e instanceof Error ? e.message : "Still checking; the list updates on its own.");
    } finally {
      // Whatever the server finished (even when the request ran out of time) shows now.
      await load();
      setRefreshing(false);
    }
  };

  const post = useCallback(
    async (interview: InterviewView, body: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/interviews/${interview.id}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.message || result.error || "Could not complete that.");
        toast.success(result.message || "Done.");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not complete that.");
      }
    },
    [load],
  );

  const patch = useCallback(
    async (interview: InterviewView, body: Record<string, unknown>, done: string) => {
      try {
        const res = await fetch(`/api/interviews/${interview.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not save.");
        toast.success(done);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save.");
      }
    },
    [load],
  );

  const remove = useCallback(
    async (interview: InterviewView) => {
      if (!window.confirm(`Delete the ${interview.company} interview?`)) return;
      const res = await fetch(`/api/interviews/${interview.id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.ok) {
        setOpenId(null);
        toast.success("Deleted.");
        await load();
      } else toast.error("Could not delete.");
    },
    [load],
  );

  const tz = data?.timezone ?? "America/New_York";
  const today = getDayKeyInTimeZone(new Date(now).toISOString(), tz);
  const focus = anchor ?? today;

  const all = useMemo(() => {
    const list = data?.interviews ?? [];
    return profileId === "all" ? list : list.filter((i) => String(i.application?.profileId ?? "") === profileId);
  }, [data, profileId]);

  const byDay = useMemo(() => {
    const map = new Map<string, InterviewView[]>();
    for (const i of all) {
      const key = getDayKeyInTimeZone(i.startsAt, tz);
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return map;
  }, [all, tz]);

  const scheduled = all.filter((i) => i.status === "scheduled");
  const next = scheduled.find((i) => new Date(endOf(i)).getTime() > now - 30 * 60_000) ?? null;
  const outcome = scheduled.filter((i) => {
    const end = new Date(endOf(i)).getTime();
    return end < now && end > now - OUTCOME_PROMPT_DAYS * 86_400_000;
  });

  // Days shown and the toolbar title.
  const weekStart = ymdAdd(focus, -ymdWeekday(focus));
  const monthFirst = `${focus.slice(0, 7)}-01`;
  const days =
    view === "day" ? [focus] : view === "week" ? Array.from({ length: 7 }, (_, i) => ymdAdd(weekStart, i)) : [];
  const monthDays = Array.from({ length: 42 }, (_, i) => ymdAdd(ymdAdd(monthFirst, -ymdWeekday(monthFirst)), i));
  const title =
    view === "day"
      ? ymdLabel(focus, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : view === "week"
        ? `${ymdLabel(days[0], { month: "short", day: "numeric" })} – ${
            days[0].slice(5, 7) === days[6].slice(5, 7) ? Number(days[6].slice(8)) : ymdLabel(days[6], { month: "short", day: "numeric" })
          }, ${days[6].slice(0, 4)}`
        : view === "month"
          ? ymdLabel(monthFirst, { month: "long", year: "numeric" })
          : "Upcoming";

  const step = (dir: 1 | -1) => {
    if (view === "day") setAnchor(ymdAdd(focus, dir));
    else if (view === "week") setAnchor(ymdAdd(focus, 7 * dir));
    else if (view === "month") {
      const [y, m] = focus.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      setAnchor(d.toISOString().slice(0, 10));
    }
  };

  const opened = openId ? all.find((i) => i.id === openId) ?? null : null;
  const actions = {
    tz,
    canAddToCalendar: Boolean(data?.canAddToCalendar),
    onCalendar: (i: InterviewView) => void post(i, { do: "calendar" }),
    onEdit: (i: InterviewView) => setEditing(i),
    onCancel: (i: InterviewView) => void patch(i, { status: "cancelled" }, "Marked cancelled."),
    onRestore: (i: InterviewView) => void patch(i, { status: "scheduled" }, "Restored."),
    onDelete: (i: InterviewView) => void remove(i),
  };

  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-sm text-muted-foreground">
        {error}
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="-m-3 flex h-[calc(100dvh-3rem)] min-h-0 sm:-m-4 md:h-dvh">
      {/* Side pane */}
      <aside className="hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-muted/30 p-3 lg:flex">
        <h1 className="px-2 pt-1 text-lg font-semibold tracking-tight">Calendar</h1>
        <Button className="w-full justify-start" onClick={() => setEditing("new")}>
          <Plus className="mr-2 h-4 w-4" />
          New interview
        </Button>
        <Calendar
          mode="single"
          selected={ymdToDate(focus)}
          onSelect={(date) => date && setAnchor(dateToYmd(date))}
          month={ymdToDate(focus)}
          onMonthChange={(date) => setAnchor(dateToYmd(date))}
          modifiers={{ interview: [...byDay.keys()].map(ymdToDate) }}
          modifiersClassNames={{
            interview:
              "relative after:absolute after:bottom-0.5 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
          }}
          className="mx-auto rounded-lg bg-background p-2 [--cell-size:1.85rem]"
        />
        {data && data.profiles.length > 1 ? (
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger className="h-8 bg-background text-xs" aria-label="Candidate">
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

        {next ? (
          <button
            type="button"
            onClick={() => setOpenId(next.id)}
            className="rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/50"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Clock className="h-3.5 w-3.5" />
              Next {countdown(next.startsAt, now)}
            </p>
            <p className="mt-1 truncate text-sm font-semibold">{next.company}</p>
            <p className="truncate text-xs text-muted-foreground">
              {INTERVIEW_ROUND_LABELS[next.round]} · {fmt(next.startsAt, tz, { weekday: "short", hour: "numeric", minute: "2-digit" })}
            </p>
            {next.meetingUrl ? (
              <a
                href={next.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Video className="h-3.5 w-3.5" />
                Join
              </a>
            ) : null}
          </button>
        ) : null}

        {outcome.length ? (
          <div>
            <p className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">How did it go?</p>
            <ul className="space-y-1">
              {outcome.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(i.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_STYLE[i.round])} />
                    <span className="min-w-0 flex-1 truncate">{i.company}</span>
                    <span className="text-xs text-muted-foreground">{fmt(i.startsAt, tz, { month: "short", day: "numeric" })}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-auto space-y-1.5 px-1 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {INTERVIEW_ROUNDS.map((r) => (
              <span key={r} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", DOT_STYLE[r])} />
                {INTERVIEW_ROUND_LABELS[r]}
              </span>
            ))}
          </div>
          <p>
            Times in {tz} ·{" "}
            <Link href="/settings" className="underline">
              change
            </Link>
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
          <Button variant="outline" size="sm" onClick={() => setAnchor(null)}>
            Today
          </Button>
          {view !== "agenda" ? (
            <div className="flex">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(-1)} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(1)} aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          <h2 className="min-w-0 truncate text-base font-semibold sm:text-lg">{title}</h2>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Calendar view">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:px-3",
                    view === v.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    v.id === "week" && "hidden sm:block",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
            <Button size="sm" className="lg:hidden" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">New</span>
            </Button>
          </div>
        </div>

        {!data ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : view === "day" || view === "week" ? (
          <TimeGrid days={days} byDay={byDay} tz={tz} now={now} today={today} onOpen={(i) => setOpenId(i.id)} />
        ) : view === "month" ? (
          <MonthGrid
            days={monthDays}
            month={monthFirst.slice(0, 7)}
            byDay={byDay}
            tz={tz}
            today={today}
            onOpen={(i) => setOpenId(i.id)}
            onDay={(ymd) => {
              setAnchor(ymd);
              setView("day");
            }}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
              {next ? (
                <NextUp interview={next} tz={tz} now={now} canAddToCalendar={actions.canAddToCalendar} onCalendar={actions.onCalendar} />
              ) : (
                <Empty text="No upcoming interviews. They appear from interview emails and your calendar, or add one." />
              )}
              {outcome.length ? (
                <Section title="How did it go?">
                  {outcome.map((i) => (
                    <OutcomeRow key={i.id} interview={i} tz={tz} onOutcome={(result) => void post(i, { do: "outcome", result })} />
                  ))}
                </Section>
              ) : null}
              <AgendaGroups list={scheduled.filter((i) => new Date(endOf(i)).getTime() > now - 30 * 60_000)} today={today} onOpen={(i) => setOpenId(i.id)} {...actions} />
            </div>
          </div>
        )}
      </main>

      <DetailsSheet
        interview={opened}
        now={now}
        onClose={() => setOpenId(null)}
        onOutcome={(i, result) => void post(i, { do: "outcome", result })}
        {...actions}
      />
      <EditDialog
        value={editing}
        tz={tz}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </div>
  );
}

/** Week or day: hours down, days across, interviews as blocks (overlaps side by side). */
function TimeGrid({
  days,
  byDay,
  tz,
  now,
  today,
  onOpen,
}: {
  days: string[];
  byDay: Map<string, InterviewView[]>;
  tz: string;
  now: number;
  today: string;
  onOpen: (i: InterviewView) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const shown = days.flatMap((d) => byDay.get(d) ?? []);
  const startHour = Math.min(7, ...shown.map((i) => Math.floor(minutesInTz(i.startsAt, tz) / 60)));
  const endHour = Math.max(20, ...shown.map((i) => Math.min(24, Math.ceil(Math.max(minutesInTz(endOf(i), tz), minutesInTz(i.startsAt, tz) + 30) / 60))));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const nowMinutes = minutesInTz(new Date(now).toISOString(), tz);

  // Open near the current hour (or 8 AM).
  useEffect(() => {
    const hour = days.includes(today) ? Math.floor(nowMinutes / 60) - 1 : 8;
    scroller.current?.scrollTo({ top: Math.max(0, (hour - startHour) * HOUR_PX) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-20 flex border-b bg-background">
        <div className="w-14 shrink-0" />
        {days.map((d) => (
          <div key={d} className="min-w-0 flex-1 border-l px-2 py-2 text-center">
            <p className="text-xs uppercase text-muted-foreground">{ymdLabel(d, { weekday: "short" })}</p>
            <p
              className={cn(
                "mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold",
                d === today && "bg-primary text-primary-foreground",
              )}
            >
              {Number(d.slice(8))}
            </p>
          </div>
        ))}
      </div>
      <div>
        <div className="relative flex pt-2" style={{ height: hours.length * HOUR_PX + 8 }}>
          <div className="w-14 shrink-0">
            {hours.map((h) => (
              <div key={h} className="relative text-right" style={{ height: HOUR_PX }}>
                <span className="absolute -top-2 right-2 text-[11px] text-muted-foreground">
                  {h === 0 ? "" : new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" })}
                </span>
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={cn("relative min-w-0 flex-1 border-l", d === today && "bg-primary/[0.03]")}>
              {hours.map((h) => (
                <div key={h} className="border-t border-border/60" style={{ height: HOUR_PX }} />
              ))}
              {layoutDay(byDay.get(d) ?? [], tz).map(({ interview: i, start, end, column, columns }) => {
                const top = ((start - startHour * 60) / 60) * HOUR_PX;
                const height = Math.max(22, ((end - start) / 60) * HOUR_PX - 2);
                const cancelled = i.status === "cancelled";
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => onOpen(i)}
                    className={cn(
                      "absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs shadow-sm transition-[filter] hover:brightness-95",
                      BLOCK_STYLE[i.round],
                      cancelled && "opacity-50",
                    )}
                    style={{ top, height, left: `calc(${(column / columns) * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)` }}
                    title={`${i.company} · ${INTERVIEW_ROUND_LABELS[i.round]}`}
                  >
                    <p className={cn("truncate font-semibold", cancelled && "line-through")}>{i.company}</p>
                    {height > 34 ? (
                      <p className="truncate opacity-80">
                        {fmt(i.startsAt, tz, { hour: "numeric", minute: "2-digit" })}
                        {i.jobTitle ? ` · ${i.jobTitle}` : ""}
                      </p>
                    ) : null}
                  </button>
                );
              })}
              {d === today && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60 ? (
                <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: ((nowMinutes - startHour * 60) / 60) * HOUR_PX }}>
                  <div className="relative h-0.5 bg-red-500">
                    <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Interviews of one day in columns: overlapping ones share the width. */
function layoutDay(list: InterviewView[], tz: string) {
  const items = list
    .map((interview) => {
      const start = minutesInTz(interview.startsAt, tz);
      const end = Math.max(start + 30, Math.min(24 * 60, minutesInTz(endOf(interview), tz) || 24 * 60));
      return { interview, start, end, column: 0, columns: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: typeof items = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];
  const close = () => {
    for (const item of cluster) item.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };
  for (const item of items) {
    if (item.start >= clusterEnd) close();
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column < 0) {
      column = columnEnds.length;
      columnEnds.push(item.end);
    } else columnEnds[column] = item.end;
    item.column = column;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  close();
  return items;
}

function MonthGrid({
  days,
  month,
  byDay,
  tz,
  today,
  onOpen,
  onDay,
}: {
  days: string[];
  month: string;
  byDay: Map<string, InterviewView[]>;
  tz: string;
  today: string;
  onOpen: (i: InterviewView) => void;
  onDay: (ymd: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b">
        {days.slice(0, 7).map((d) => (
          <p key={d} className="py-2 text-center text-xs uppercase text-muted-foreground">
            {ymdLabel(d, { weekday: "short" })}
          </p>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-y-auto">
        {days.map((d) => {
          const list = (byDay.get(d) ?? []).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const outside = !d.startsWith(month);
          return (
            <div
              key={d}
              role="button"
              tabIndex={0}
              onClick={() => onDay(d)}
              onKeyDown={(e) => e.key === "Enter" && onDay(d)}
              className={cn(
                "min-h-24 cursor-pointer border-b border-r p-1 transition-colors hover:bg-muted/40",
                outside && "bg-muted/20 text-muted-foreground",
              )}
            >
              <p
                className={cn(
                  "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  d === today && "bg-primary text-primary-foreground",
                )}
              >
                {Number(d.slice(8))}
              </p>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(i);
                    }}
                    className={cn(
                      "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted",
                      i.status === "cancelled" && "line-through opacity-50",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_STYLE[i.round])} />
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(i.startsAt, tz, { hour: "numeric", minute: "2-digit" })}</span>
                    <span className="truncate font-medium">{i.company}</span>
                  </button>
                ))}
                {list.length > 3 ? <p className="px-1 text-[11px] text-muted-foreground">+{list.length - 3} more</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaGroups({
  list,
  tz,
  today,
  onOpen,
  ...actions
}: {
  list: InterviewView[];
  tz: string;
  today: string;
  onOpen: (i: InterviewView) => void;
  canAddToCalendar: boolean;
  onCalendar: (i: InterviewView) => void;
  onEdit: (i: InterviewView) => void;
  onCancel: (i: InterviewView) => void;
  onRestore: (i: InterviewView) => void;
  onDelete: (i: InterviewView) => void;
}) {
  const groups = new Map<string, InterviewView[]>();
  for (const i of list) {
    const d = getDayKeyInTimeZone(i.startsAt, tz);
    groups.set(d, [...(groups.get(d) ?? []), i]);
  }
  if (groups.size === 0) return null;
  return (
    <>
      {[...groups].map(([d, items]) => (
        <Section
          key={d}
          title={d === today ? "Today" : d === ymdAdd(today, 1) ? "Tomorrow" : ymdLabel(d, { weekday: "long", month: "short", day: "numeric" })}
          count={items.length}
        >
          {items.map((i) => (
            <Row key={i.id} interview={i} tz={tz} onOpen={onOpen} {...actions} />
          ))}
        </Section>
      ))}
    </>
  );
}

function OutcomeRow({
  interview: i,
  tz,
  onOutcome,
}: {
  interview: InterviewView;
  tz: string;
  onOutcome: (result: "passed" | "waiting" | "rejected") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {i.company}
          {i.jobTitle ? <span className="font-normal text-muted-foreground"> · {i.jobTitle}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {INTERVIEW_ROUND_LABELS[i.round]} · {fmt(i.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })}
        </p>
      </div>
      <OutcomeButtons onOutcome={onOutcome} />
    </div>
  );
}

function OutcomeButtons({ onOutcome }: { onOutcome: (result: "passed" | "waiting" | "rejected") => void }) {
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" onClick={() => onOutcome("passed")}>
        Went well
      </Button>
      <Button size="sm" variant="outline" onClick={() => onOutcome("waiting")}>
        Waiting
      </Button>
      <Button size="sm" variant="outline" className="text-rose-600 hover:text-rose-700" onClick={() => onOutcome("rejected")}>
        Rejected
      </Button>
    </div>
  );
}

/** Everything about one interview, at the side (Outlook's event peek). */
function DetailsSheet({
  interview: i,
  now,
  tz,
  canAddToCalendar,
  onClose,
  onOutcome,
  onCalendar,
  onEdit,
  onCancel,
  onRestore,
  onDelete,
}: {
  interview: InterviewView | null;
  now: number;
  tz: string;
  canAddToCalendar: boolean;
  onClose: () => void;
  onOutcome: (i: InterviewView, result: "passed" | "waiting" | "rejected") => void;
  onCalendar: (i: InterviewView) => void;
  onEdit: (i: InterviewView) => void;
  onCancel: (i: InterviewView) => void;
  onRestore: (i: InterviewView) => void;
  onDelete: (i: InterviewView) => void;
}) {
  const ended = i ? new Date(endOf(i)).getTime() < now : false;
  return (
    <Sheet open={i !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {i ? (
          <>
            <SheetHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", DOT_STYLE[i.round])} />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {INTERVIEW_ROUND_LABELS[i.round]} interview
                </span>
                {i.status === "cancelled" ? <Badge variant="secondary">Cancelled</Badge> : null}
                {i.result ? (
                  <Badge variant="secondary">{i.result === "passed" ? "Went well" : i.result === "waiting" ? "Waiting" : "Rejected"}</Badge>
                ) : null}
              </div>
              <SheetTitle className={cn("text-xl", i.status === "cancelled" && "line-through")}>{i.company}</SheetTitle>
              <SheetDescription>{[i.jobTitle, i.application?.candidateName].filter(Boolean).join(" · ") || i.title || ""}</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4 px-4 text-sm">
              <div className="flex gap-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">{fmt(i.startsAt, tz, { weekday: "long", month: "long", day: "numeric" })}</p>
                  <p>{timeRange(i, tz)}</p>
                  {i.timezone ? (
                    <p className="text-xs text-muted-foreground">
                      Recruiter&apos;s time: {fmt(i.startsAt, i.timezone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                    </p>
                  ) : null}
                  {!ended ? <p className="mt-1 text-xs font-medium text-primary">{countdown(i.startsAt, now)}</p> : null}
                </div>
              </div>
              {i.meetingUrl ? (
                <div className="flex gap-3">
                  <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <a href={i.meetingUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-primary hover:underline">
                    {i.meetingUrl}
                  </a>
                </div>
              ) : null}
              {i.location ? (
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p>{i.location}</p>
                </div>
              ) : null}
              {i.interviewers ? (
                <div className="flex gap-3">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p>{i.interviewers}</p>
                </div>
              ) : null}
              {i.notes ? <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3">{i.notes}</p> : null}
              <p className="text-xs text-muted-foreground">
                From {i.source === "email" ? "an email" : i.source === "calendar" ? "your calendar" : "you"}
                {i.inCalendar ? " · in your calendar" : ""}
              </p>
            </div>

            <div className="mt-6 space-y-3 px-4 pb-6">
              {i.meetingUrl && i.status !== "cancelled" && !ended ? (
                <Button asChild className="w-full">
                  <a href={i.meetingUrl} target="_blank" rel="noopener noreferrer">
                    <Video className="mr-2 h-4 w-4" />
                    Join
                  </a>
                </Button>
              ) : null}
              {ended && i.status === "scheduled" ? (
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-medium">How did it go?</p>
                  <OutcomeButtons onOutcome={(result) => onOutcome(i, result)} />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {!i.inCalendar && canAddToCalendar && i.status !== "cancelled" ? (
                  <Button variant="outline" onClick={() => onCalendar(i)}>
                    <CalendarPlus className="mr-2 h-4 w-4" />
                    Add to calendar
                  </Button>
                ) : null}
                {i.emailLink ? (
                  <Button asChild variant="outline">
                    <a href={i.emailLink} target="_blank" rel="noopener noreferrer">
                      <Mail className="mr-2 h-4 w-4" />
                      Open email
                    </a>
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => onEdit(i)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                {i.status === "cancelled" ? (
                  <Button variant="outline" onClick={() => onRestore(i)}>
                    Not cancelled
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => onCancel(i)}>
                    Mark cancelled
                  </Button>
                )}
              </div>
              <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={() => onDelete(i)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {count ? <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span> : null}
        <div className="ml-auto">{action}</div>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function NextUp({
  interview: i,
  tz,
  now,
  canAddToCalendar,
  onCalendar,
}: {
  interview: InterviewView;
  tz: string;
  now: number;
  canAddToCalendar: boolean;
  onCalendar: (i: InterviewView) => void;
}) {
  const soon = new Date(i.startsAt).getTime() - now < 15 * 60_000;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b bg-primary/5 px-5 py-2 text-sm">
        <Clock className="h-4 w-4 text-primary" />
        <span className="font-medium text-primary">Next interview {countdown(i.startsAt, now)}</span>
      </div>
      <div className="space-y-4 p-5">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={ROUND_STYLE[i.round]}>
              {INTERVIEW_ROUND_LABELS[i.round]}
            </Badge>
            <h2 className="truncate text-lg font-semibold">{i.company}</h2>
          </div>
          {i.jobTitle || i.application?.candidateName ? (
            <p className="text-sm text-muted-foreground">
              {[i.jobTitle, i.application?.candidateName].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <p className="text-sm">
            {fmt(i.startsAt, tz, { weekday: "long", month: "long", day: "numeric" })} · {timeRange(i, tz)}
          </p>
          {i.timezone ? (
            <p className="text-xs text-muted-foreground">
              Recruiter&apos;s time: {fmt(i.startsAt, i.timezone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
            </p>
          ) : null}
          {i.interviewers ? (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {i.interviewers}
            </p>
          ) : null}
          {i.location && !i.meetingUrl ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {i.location}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {i.meetingUrl ? (
            <Button asChild size="lg" variant={soon ? "default" : "outline"}>
              <a href={i.meetingUrl} target="_blank" rel="noopener noreferrer">
                <Video className="mr-2 h-4 w-4" />
                Join
              </a>
            </Button>
          ) : null}
          {!i.inCalendar && canAddToCalendar ? (
            <Button size="lg" variant="outline" onClick={() => onCalendar(i)}>
              <CalendarPlus className="mr-2 h-4 w-4" />
              Add to calendar
            </Button>
          ) : null}
          {i.emailLink ? (
            <Button asChild size="lg" variant="ghost">
              <a href={i.emailLink} target="_blank" rel="noopener noreferrer">
                <Mail className="mr-2 h-4 w-4" />
                Email
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({
  interview: i,
  tz,
  showDate,
  onOpen,
  canAddToCalendar,
  onCalendar,
  onEdit,
  onCancel,
  onRestore,
  onDelete,
}: {
  interview: InterviewView;
  tz: string;
  showDate?: boolean;
  onOpen?: (i: InterviewView) => void;
  canAddToCalendar: boolean;
  onCalendar: (i: InterviewView) => void;
  onEdit: (i: InterviewView) => void;
  onCancel: (i: InterviewView) => void;
  onRestore: (i: InterviewView) => void;
  onDelete: (i: InterviewView) => void;
}) {
  const cancelled = i.status === "cancelled";
  const minutes = minutesOf(i);
  return (
    <div className={cn("flex items-start gap-4 px-4 py-3", cancelled && "opacity-60")}>
      <div className="w-24 shrink-0 text-sm tabular-nums">
        {showDate ? (
          <p className="text-xs text-muted-foreground">{fmt(i.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })}</p>
        ) : null}
        <p className={cn("font-medium", cancelled && "line-through")}>{fmt(i.startsAt, tz, { hour: "numeric", minute: "2-digit" })}</p>
        {minutes ? <p className="text-xs text-muted-foreground">{minutes} min</p> : null}
      </div>
      <button type="button" className="min-w-0 flex-1 space-y-1 text-left" onClick={() => onOpen?.(i)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("truncate font-medium", cancelled && "line-through")}>{i.company}</span>
          <Badge variant="outline" className={ROUND_STYLE[i.round]}>
            {INTERVIEW_ROUND_LABELS[i.round]}
          </Badge>
          {cancelled ? <Badge variant="secondary">Cancelled</Badge> : null}
          {i.result ? (
            <Badge variant="secondary">{i.result === "passed" ? "Went well" : i.result === "waiting" ? "Waiting" : "Rejected"}</Badge>
          ) : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {[i.jobTitle, i.application?.candidateName, i.interviewers].filter(Boolean).join(" · ") || i.title || " "}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {i.meetingUrl && !cancelled ? (
          <Button asChild size="sm" variant="outline">
            <a href={i.meetingUrl} target="_blank" rel="noopener noreferrer">
              <Video className="mr-1.5 h-3.5 w-3.5" />
              Join
            </a>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!i.inCalendar && canAddToCalendar && !cancelled ? (
              <DropdownMenuItem onSelect={() => onCalendar(i)}>
                <CalendarPlus className="mr-2 h-4 w-4" />
                Add to calendar
              </DropdownMenuItem>
            ) : null}
            {i.emailLink ? (
              <DropdownMenuItem asChild>
                <a href={i.emailLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open the email
                </a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => onEdit(i)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            {cancelled ? (
              <DropdownMenuItem onSelect={() => onRestore(i)}>Not cancelled</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onCancel(i)}>Mark cancelled</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(i)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function EditDialog({
  value,
  tz,
  onClose,
  onSaved,
}: {
  value: InterviewView | "new" | null;
  tz: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = value && value !== "new" ? value : null;
  const [app, setApp] = useState<InboxApplication | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InboxApplication[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("45");
  const [round, setRound] = useState<InterviewRound>("screening");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [location, setLocation] = useState("");
  const [interviewers, setInterviewers] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    if (existing) {
      setApp(existing.application ? { ...existing.application, jobLink: "", appliedAt: "" } : null);
      setDate(getDayKeyInTimeZone(existing.startsAt, tz));
      setTime(hhmm(existing.startsAt, tz));
      setDuration(String(minutesOf(existing) ?? 45));
      setRound(existing.round);
      setMeetingUrl(existing.meetingUrl ?? "");
      setLocation(existing.location ?? "");
      setInterviewers(existing.interviewers ?? "");
      setNotes(existing.notes ?? "");
    } else {
      setApp(null);
      setDate(getDayKeyInTimeZone(new Date(Date.now() + 86_400_000).toISOString(), tz));
      setTime("10:00");
      setDuration("45");
      setRound("screening");
      setMeetingUrl("");
      setLocation("");
      setInterviewers("");
      setNotes("");
    }
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!value || app) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const res = await fetch(`/api/inbox/applications?q=${encodeURIComponent(query)}`, { credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!cancelled) setResults(res.ok ? body.applications ?? [] : []);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, value, app]);

  const save = async () => {
    const startsAt = zonedLocalToUtcIso(`${date}T${time}`, tz);
    if (!startsAt) {
      toast.error("Enter a date and time.");
      return;
    }
    const endsAt = new Date(new Date(startsAt).getTime() + Number(duration) * 60_000).toISOString();
    setBusy(true);
    try {
      const res = await fetch(existing ? `/api/interviews/${existing.id}` : "/api/interviews", {
        method: existing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: app?.id ?? null,
          startsAt,
          endsAt,
          round,
          meetingUrl: meetingUrl.trim() || null,
          location,
          interviewers,
          notes,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save.");
      toast.success(existing ? "Saved." : "Interview added.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit interview" : "Add interview"}</DialogTitle>
          <DialogDescription>Times are in your timezone ({tz}).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Application</Label>
            {app ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <strong>{app.company}</strong>
                  {app.jobTitle ? ` · ${app.jobTitle}` : ""}
                  {app.candidateName ? ` · ${app.candidateName}` : ""}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setApp(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company or job title" />
                <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
                  {results.length === 0 ? (
                    <li className="p-2 text-xs text-muted-foreground">No applications found.</li>
                  ) : (
                    results.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => setApp(r)}>
                          <span className="font-medium">{r.company}</span>
                          {r.jobTitle ? <span className="text-muted-foreground"> · {r.jobTitle}</span> : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 space-y-1.5 sm:col-span-1">
              <Label htmlFor="iv-date">Date</Label>
              <Input id="iv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iv-time">Start</Label>
              <Input id="iv-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Length</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...DURATIONS, Number(duration)])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} min
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Round</Label>
            <Select value={round} onValueChange={(v) => setRound(v as InterviewRound)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVIEW_ROUNDS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {INTERVIEW_ROUND_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iv-link">Meeting link</Label>
            <Input id="iv-link" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://zoom.us/j/…" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="iv-where">Location</Label>
              <Input id="iv-where" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Phone, address…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iv-who">Interviewers</Label>
              <Input id="iv-who" value={interviewers} onChange={(e) => setInterviewers(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iv-notes">Notes</Label>
            <Textarea id="iv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !date || !time}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {existing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
