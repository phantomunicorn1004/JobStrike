"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  CalendarDays,
  Columns3,
  Database,
  FileEdit,
  Inbox,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  Search,
  SearchCode,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandLogo } from "@/components/brand-logo";
import { CommandPalette, useCommandPaletteHotkey, type PaletteItem } from "@/components/command-palette";
import { ActiveProfileProvider, ActiveProfileSwitcher } from "@/components/active-profile";
import { OverviewProvider, useOverview } from "@/components/overview-provider";
import type { OverviewResponse } from "@/app/api/overview/route";
import { TONE_PILL, type Tone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
  exact?: boolean;
};

type NavSection = { label?: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: "home stats", exact: true }],
  },
  {
    label: "Find",
    items: [
      { href: "/job-scraper", label: "Job Scraper", icon: SearchCode, keywords: "hiringcafe jobright search" },
      { href: "/autobid", label: "Auto-bid", icon: Bot, keywords: "auto apply automation copilot" },
    ],
  },
  {
    label: "Apply",
    items: [
      { href: "/resume-tailor", label: "Resume Tailor", icon: FileEdit, keywords: "tailor match" },
      { href: "/resume-builder", label: "Resume Builder", icon: NotebookPen, keywords: "prompt kit" },
      { href: "/prompt-builder", label: "Prompt Builder", icon: Sparkles, keywords: "ai prompt" },
    ],
  },
  {
    label: "Track",
    items: [
      { href: "/resume-db", label: "Resume DB", icon: Database, keywords: "applications bids" },
      { href: "/jobs", label: "Job Pipeline", icon: Columns3, keywords: "kanban board stages", exact: true },
      { href: "/inbox", label: "Inbox", icon: Inbox, keywords: "email mail recruiter" },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, keywords: "interviews schedule" },
    ],
  },
];

const ACCOUNT_ITEMS: NavItem[] = [
  { href: "/profile", label: "Profiles", icon: Users, keywords: "candidate people" },
  { href: "/settings", label: "Settings", icon: Settings, keywords: "integrations mailbox drive timezone" },
];

function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

const NAV_BADGES: Record<string, { count: (o: OverviewResponse) => number; tone: Tone; title: string }> = {
  "/autobid": { count: (o) => o.autobidAttention, tone: "attention", title: "Jobs that need you" },
  "/inbox": { count: (o) => o.inboxAttention, tone: "attention", title: "Emails that need attention" },
  "/calendar": { count: (o) => o.interviewsNext24h, tone: "progress", title: "Interviews in the next 24 hours" },
};

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = isActive(item, pathname);
  const { overview } = useOverview();
  const badge = NAV_BADGES[item.href];
  const count = badge && overview ? badge.count(overview) : 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        className="h-9 rounded-md font-medium text-sidebar-foreground data-[active=true]:font-semibold"
      >
        <Link href={item.href}>
          <Icon className="h-4 w-4 shrink-0" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {count > 0 && (
        <SidebarMenuBadge title={badge.title} className={cn("top-2 rounded-full px-1.5 text-[11px] font-semibold", TONE_PILL[badge.tone])}>
          {count > 99 ? "99+" : count}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ActiveProfileProvider>
      <OverviewProvider>
        <JobsShell>{children}</JobsShell>
      </OverviewProvider>
    </ActiveProfileProvider>
  );
}

function JobsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteHotkey(setPaletteOpen);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }, [router]);

  const current = useMemo(() => {
    for (const section of NAV_SECTIONS) {
      const item = section.items.find((i) => isActive(i, pathname));
      if (item) return { section: section.label ?? "Home", item };
    }
    const account = ACCOUNT_ITEMS.find((i) => isActive(i, pathname));
    return account ? { section: "Account", item: account } : null;
  }, [pathname]);

  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...NAV_SECTIONS.flatMap((section) =>
        section.items.map((item) => ({
          label: item.label,
          group: "Go to",
          icon: item.icon,
          href: item.href,
          keywords: `${section.label ?? ""} ${item.keywords ?? ""}`,
        })),
      ),
      ...ACCOUNT_ITEMS.map((item) => ({ label: item.label, group: "Go to", icon: item.icon, href: item.href, keywords: item.keywords })),
      { label: "Sign out", group: "Account", icon: LogOut, keywords: "logout", run: () => void handleLogout() },
    ],
    [handleLogout],
  );

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="h-14 min-w-0 justify-center overflow-hidden px-3">
          <BrandLogo className="min-w-0" />
        </SidebarHeader>

        <SidebarContent className="min-w-0 gap-0 overflow-x-hidden px-1.5 pb-4">
          <div className="px-1 pb-1 pt-1 group-data-[collapsible=icon]:hidden">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border bg-muted px-1.5 text-[10px] font-medium">Ctrl K</kbd>
            </button>
          </div>
          {NAV_SECTIONS.map((section) => (
            <SidebarGroup key={section.label ?? "home"} className="px-1 py-1.5">
              {section.label && (
                <SidebarGroupLabel className="h-7 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                  {section.label}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {section.items.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SidebarMenu className="gap-0.5">
            {ACCOUNT_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Sign out"
                className="h-9 rounded-md font-medium text-sidebar-foreground"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-4">
          <SidebarTrigger className="-ml-1" />
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          {current && (
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="hidden text-muted-foreground sm:inline">{current.section}</span>
              <span className="hidden text-muted-foreground/50 sm:inline">/</span>
              <span className="truncate font-medium">{current.item.label}</span>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <ActiveProfileSwitcher />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
              className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Search className="h-4 w-4" />
              <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-medium md:inline">Ctrl K</kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 lg:p-6">{children}</div>
      </SidebarInset>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
    </SidebarProvider>
  );
}
