"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, CalendarClock, CheckCircle2, Mail } from "lucide-react";
import { useOverview } from "@/components/overview-provider";
import { cn } from "@/lib/utils";
import { TONE_PILL, type Tone } from "@/lib/ui/tone";

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

function Tile({
  href, icon: Icon, tone, label, value, hint,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50",
        tone === "attention" ? "border-amber-500/30" : "border-border/70",
      )}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONE_PILL[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-base font-semibold tracking-tight">{value}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
    </Link>
  );
}

/** What needs doing now: stopped Auto-bid jobs, emails to review, the next interview. */
export function TodayPanel() {
  const { overview } = useOverview();
  if (!overview) return null;

  const next = overview.upcoming[0];
  const stuck = overview.autobidAttention;
  const mail = overview.inboxAttention;

  return (
    <section aria-label="Today" className="grid gap-3 md:grid-cols-3">
      <Tile
        href="/autobid"
        icon={stuck > 0 ? Bot : CheckCircle2}
        tone={stuck > 0 ? "attention" : "success"}
        label="Auto-bid"
        value={stuck > 0 ? `${stuck} job${stuck === 1 ? " needs" : "s need"} you` : "Nothing needs you"}
        hint={overview.autobidActive > 0 ? `${overview.autobidActive} in progress` : "No jobs in progress"}
      />
      <Tile
        href="/inbox"
        icon={Mail}
        tone={mail > 0 ? "attention" : "idle"}
        label="Inbox"
        value={mail > 0 ? `${mail} email${mail === 1 ? "" : "s"} to review` : "Inbox is clear"}
        hint="Recruiter replies and interview invites"
      />
      <Tile
        href="/calendar"
        icon={CalendarClock}
        tone={next ? "progress" : "idle"}
        label="Next interview"
        value={next ? `${next.company || "Interview"} · ${when(next.startsAt)}` : "None this week"}
        hint={
          next
            ? [next.candidate, overview.upcoming.length > 1 ? `${overview.upcoming.length - 1} more this week` : ""].filter(Boolean).join(" · ") ||
              next.jobTitle
            : "Interviews from email and calendar show here"
        }
      />
    </section>
  );
}
