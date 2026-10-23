"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarPlus,
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
  X,
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
  screen: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
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

export function CalendarPageClient() {
  const [data, setData] = useState<InterviewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("all");
  const [day, setDay] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<InterviewView | "new" | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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

  // Countdowns stay current; the list follows new interviews (every minute, and on return to the tab).
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
        toast.success("Deleted.");
        await load();
      } else toast.error("Could not delete.");
    },
    [load],
  );

  const tz = data?.timezone ?? "America/New_York";
  const all = useMemo(() => {
    const list = data?.interviews ?? [];
    return profileId === "all" ? list : list.filter((i) => String(i.application?.profileId ?? "") === profileId);
  }, [data, profileId]);

  const groups = useMemo(() => {
    const today = getDayKeyInTimeZone(new Date(now).toISOString(), tz);
    const tomorrow = getDayKeyInTimeZone(new Date(now + 86_400_000).toISOString(), tz);
    const weekEnd = now + 7 * 86_400_000;
    const scheduled = all.filter((i) => i.status === "scheduled");
    const upcoming = scheduled.filter((i) => new Date(i.endsAt ?? i.startsAt).getTime() > now - 30 * 60_000);
    const keyOf = (i: InterviewView) => getDayKeyInTimeZone(i.startsAt, tz);
    return {
      next: upcoming[0] ?? null,
      outcome: scheduled.filter((i) => {
        const end = new Date(i.endsAt ?? i.startsAt).getTime() + (i.endsAt ? 0 : 45 * 60_000);
        return end < now && end > now - OUTCOME_PROMPT_DAYS * 86_400_000;
      }),
      today: upcoming.filter((i) => keyOf(i) === today),
      tomorrow: upcoming.filter((i) => keyOf(i) === tomorrow),
      week: upcoming.filter((i) => keyOf(i) !== today && keyOf(i) !== tomorrow && new Date(i.startsAt).getTime() <= weekEnd),
      later: upcoming.filter((i) => new Date(i.startsAt).getTime() > weekEnd),
      past: all
        .filter((i) => i.status !== "scheduled" || new Date(i.endsAt ?? i.startsAt).getTime() < now - OUTCOME_PROMPT_DAYS * 86_400_000)
        .reverse(),
    };
  }, [all, now, tz]);

  const daysWithInterviews = useMemo(() => {
    const keys = new Set(all.filter((i) => i.status !== "cancelled").map((i) => getDayKeyInTimeZone(i.startsAt, tz)));
    return [...keys].map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m - 1, d);
    });
  }, [all, tz]);

  const onDay = day ? all.filter((i) => getDayKeyInTimeZone(i.startsAt, tz) === day) : null;
  const rowProps = {
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
      <div className="mx-auto max-w-6xl space-y-4">
        <Header />
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
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

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Header />
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
          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus className="mr-2 h-4 w-4" />
            Add interview
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            {onDay ? (
              <Section
                title={fmt(`${day}T12:00:00Z`, "UTC", { weekday: "long", month: "long", day: "numeric" })}
                action={
                  <Button size="sm" variant="ghost" onClick={() => setDay(null)}>
                    <X className="mr-1 h-4 w-4" />
                    Show all
                  </Button>
                }
              >
                {onDay.length ? onDay.map((i) => <Row key={i.id} interview={i} {...rowProps} />) : <Empty text="No interviews that day." />}
              </Section>
            ) : (
              <>
                {groups.next ? (
                  <NextUp interview={groups.next} tz={tz} now={now} canAddToCalendar={rowProps.canAddToCalendar} onCalendar={rowProps.onCalendar} />
                ) : (
                  <div className="rounded-xl border bg-card p-8 text-center">
                    <CalendarDays className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                    <p className="font-medium">No upcoming interviews</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Interviews appear here from interview emails and your calendar. Add one by hand anytime.
                    </p>
                  </div>
                )}

                {groups.outcome.length ? (
                  <Section title="How did it go?">
                    {groups.outcome.map((i) => (
                      <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {i.company}
                            {i.jobTitle ? <span className="font-normal text-muted-foreground"> · {i.jobTitle}</span> : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {INTERVIEW_ROUND_LABELS[i.round]} · {fmt(i.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })}
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => void post(i, { do: "outcome", result: "passed" })}>
                            Went well
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void post(i, { do: "outcome", result: "waiting" })}>
                            Waiting
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-600 hover:text-rose-700"
                            onClick={() => void post(i, { do: "outcome", result: "rejected" })}
                          >
                            Rejected
                          </Button>
                        </div>
                      </div>
                    ))}
                  </Section>
                ) : null}

                {(
                  [
                    ["Today", groups.today],
                    ["Tomorrow", groups.tomorrow],
                    ["This week", groups.week],
                    ["Later", groups.later],
                  ] as const
                ).map(([title, list]) =>
                  list.length ? (
                    <Section key={title} title={title} count={list.length}>
                      {list.map((i) => (
                        <Row key={i.id} interview={i} showDate={title !== "Today" && title !== "Tomorrow"} {...rowProps} />
                      ))}
                    </Section>
                  ) : null,
                )}

                {groups.past.length ? (
                  <div>
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPast((v) => !v)}
                    >
                      {showPast ? "Hide" : "Show"} past and cancelled ({groups.past.length})
                    </button>
                    {showPast ? (
                      <div className="mt-2">
                        <Section title="Past">
                          {groups.past.map((i) => (
                            <Row key={i.id} interview={i} showDate {...rowProps} />
                          ))}
                        </Section>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border bg-card p-2">
              <Calendar
                mode="single"
                selected={
                  day
                    ? (() => {
                        const [y, m, d] = day.split("-").map(Number);
                        return new Date(y, m - 1, d);
                      })()
                    : undefined
                }
                onSelect={(date) =>
                  setDay(
                    date
                      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
                      : null,
                  )
                }
                modifiers={{ interview: daysWithInterviews }}
                modifiersClassNames={{
                  interview:
                    "relative font-semibold after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
                }}
                className="mx-auto"
              />
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              Times are in your timezone ({tz}),{" "}
              <Link href="/settings" className="underline">
                change it in Settings
              </Link>
              . Interviews come from interview emails and the calendars of connected mailboxes.
            </p>
          </aside>
        </div>
      )}

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

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
      <p className="text-sm text-muted-foreground">Your interviews, from emails, your calendar and what you add.</p>
    </div>
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
      <div className="min-w-0 flex-1 space-y-1">
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
      </div>
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
  const [round, setRound] = useState<InterviewRound>("screen");
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
      setRound("screen");
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
