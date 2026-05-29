"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  FileEdit,
  Database,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
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
    icon: ClipboardList,
    isActive: (pathname) => pathname === "/jobs",
  },
  {
    href: "/resume-tailor",
    label: "Resume Tailor",
    icon: FileEdit,
    isActive: (pathname) => pathname.startsWith("/resume-tailor"),
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
          <Icon className="h-5 w-5" />
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

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" className="border-r-0">
        <SidebarHeader className="border-b border-border bg-background px-2 py-3">
          <div
            className={cn(
              "flex items-center justify-between gap-2",
              "group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center",
            )}
          >
            <Link
              href="/dashboard"
              className="flex min-w-0 shrink items-center overflow-hidden"
            >
              <img
                src="/logo.png"
                alt="Remote work helper"
                className={cn(
                  "h-[72px] w-auto py-1 transition-all duration-200",
                  "group-data-[collapsible=icon]:hidden",
                )}
              />
              <img
                src="/logo-icon.png"
                alt=""
                aria-hidden="true"
                className={cn(
                  "hidden h-9 w-9 shrink-0 rounded-xl object-contain",
                  "group-data-[collapsible=icon]:block",
                )}
              />
            </Link>
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

        <SidebarContent className="bg-background px-1 py-6">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <NavLink item={NAV_ITEMS[0]} pathname={pathname} />
                <SidebarSeparator className="my-2" />
                <NavLink item={NAV_ITEMS[1]} pathname={pathname} />
                <NavLink item={NAV_ITEMS[2]} pathname={pathname} />
                <SidebarSeparator className="my-2" />
                <NavLink item={NAV_ITEMS[3]} pathname={pathname} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-border bg-background p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Profile"
                size="lg"
                isActive={pathname.startsWith("/profile")}
                className="rounded-lg"
              >
                <Link href="/profile" className="justify-center md:justify-start">
                  <img
                    src="/placeholder-user.jpg"
                    alt="Profile"
                    className="h-8 w-8 shrink-0 rounded-full border-2 border-border object-cover transition hover:border-primary"
                  />
                  <span>Profile</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-medium text-muted-foreground">Menu</span>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
