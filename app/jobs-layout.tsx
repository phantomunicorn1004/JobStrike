"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Columns3,
  FileEdit,
  Database,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  SearchCode,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandLogo } from "@/components/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    isActive: (pathname) => pathname === "/dashboard",
  },
  {
    href: "/resume-db",
    label: "Resume DB",
    icon: Database,
    isActive: (pathname) => pathname.startsWith("/resume-db"),
  },
  {
    href: "/jobs",
    label: "Job Pipeline",
    icon: Columns3,
    isActive: (pathname) => pathname === "/jobs",
  },
  {
    href: "/resume-tailor",
    label: "Resume Tailor",
    icon: FileEdit,
    isActive: (pathname) => pathname.startsWith("/resume-tailor"),
  },
  {
    href: "/resume-builder",
    label: "Resume Builder",
    icon: NotebookPen,
    isActive: (pathname) => pathname.startsWith("/resume-builder"),
  },
  {
    href: "/prompt-builder",
    label: "Prompt Builder",
    icon: Sparkles,
    isActive: (pathname) => pathname.startsWith("/prompt-builder"),
  },
  {
    href: "/job-scraper",
    label: "Job Scraper",
    icon: SearchCode,
    isActive: (pathname) => pathname.startsWith("/job-scraper"),
  },
];

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={item.isActive(pathname)}
        tooltip={item.label}
        size="lg"
        className="rounded-lg text-base font-medium"
      >
        <Link href={item.href}>
          <Icon className="h-4 w-4 shrink-0" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border shadow-[2px_0_16px_rgba(37,99,235,0.06)]">
        <SidebarHeader className="min-w-0 overflow-hidden border-b border-sidebar-border px-3 py-4">
          <div
            className={cn(
              "flex min-w-0 items-center justify-between gap-2",
              "group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center",
            )}
          >
            <BrandLogo className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none" />
            <div
              className={cn(
                "flex shrink-0 items-center gap-1",
                "group-data-[collapsible=icon]:flex-col",
              )}
            >
              <ThemeToggle />
              <SidebarTrigger className="hidden md:inline-flex" />
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="min-w-0 overflow-x-hidden px-1 py-6">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <NavLink item={NAV_ITEMS[0]} pathname={pathname} />
                <SidebarSeparator className="my-2 group-data-[collapsible=icon]:hidden" />
                <NavLink item={NAV_ITEMS[1]} pathname={pathname} />
                <NavLink item={NAV_ITEMS[2]} pathname={pathname} />
                <SidebarSeparator className="my-2 group-data-[collapsible=icon]:hidden" />
                <NavLink item={NAV_ITEMS[3]} pathname={pathname} />
                <NavLink item={NAV_ITEMS[4]} pathname={pathname} />
                <NavLink item={NAV_ITEMS[5]} pathname={pathname} />
                <NavLink item={NAV_ITEMS[6]} pathname={pathname} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SidebarMenu className="gap-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Profiles"
                size="lg"
                isActive={pathname.startsWith("/profile")}
                className="rounded-lg"
              >
                <Link href="/profile" className="justify-center md:justify-start">
                  <Users className="h-4 w-4 shrink-0" />
                  <span>Profiles</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Settings"
                size="lg"
                isActive={pathname.startsWith("/settings")}
                className="rounded-lg"
              >
                <Link href="/settings" className="justify-center md:justify-start">
                  <Settings className="h-4 w-4 shrink-0" />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Sign out"
                size="lg"
                className="rounded-lg"
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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-medium text-muted-foreground">Menu</span>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
